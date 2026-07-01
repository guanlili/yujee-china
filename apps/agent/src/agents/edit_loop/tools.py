"""主控 AI 的工具注册表:JSON-schema 声明 + 执行分发(实现)。

主控 AI 拿到的「能力清单」就是这里声明的工具(OpenAI function-calling schema)。
它据此自主选择、组合调用。读类工具复用现有 web_client;改类工具复用现有执行器,
edit_text 是新建的干净工具。

工具集(契约 contract.md §6.2.3):
  读:
    - get_page_info(page?)      取某页/本章的当前 texts/images + 章节照片场景。复用 web_client。
    - get_book_tree()           整本结构 + 进度 + 聚焦页。复用 web_client。
    - read_skill(name)          渐进式读取某个编辑 skill 的完整手艺指南(清单在上下文里)。
  改:
    - edit_text(page?, texts)   【新】落地主控写好的文案(零 LLM,只校验)。返回写入后的文案供主控验证。
    - swap_layout(page?|chapter)换版式。复用 tools/layout.swap_layout(candidate_gen + judge)。
    - swap_images(page?)        换图。复用 tools/image_edit.run_image_edit。
    - advance_book()            翻到下一未访问页。复用现有确定性逻辑。
    - confirm_chapter()         标记本章完成。复用 story_progress.chapter_done_decision。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from ...schemas import Page, V3Chapter, V3EditChatRequest, V3LayoutPatchEntry
from ..tools import image_edit as image_edit_tool
from ..tools import layout as layout_tool
from . import navigation as edit_navigation
from . import progress as story_progress
from . import skills_registry


@dataclass(frozen=True)
class ToolResult:
    """工具执行产物。`observation` 回喂给主控;patch/texts/progress 进最终聚合。"""

    observation: dict[str, Any]                    # 回喂给主控 AI 的结果(JSON-able)
    patches: list[Any] | None = None               # V3LayoutPatchEntry[](swap_layout/images)
    pageTexts: tuple[int, dict[str, str]] | None = None  # (pageIndex, texts)(edit_text)
    progressDecision: Any | None = None            # confirm_chapter / advance
    navigation: Any | None = None                  # advance_book


ToolExec = Callable[[dict[str, Any]], Awaitable["ToolResult"]]


@dataclass
class ToolRegistry:
    """主控能调用的工具集:schemas 给 LLM,_execs 做分发执行。"""

    schemas: list[dict[str, Any]]                  # OpenAI tools[]
    _execs: dict[str, ToolExec]

    async def execute(self, name: str, args: dict[str, Any]) -> ToolResult:
        """按名分发执行;未知工具 / 执行异常 => 安全的错误 observation(主控可自纠,绝不抛进 loop)。"""
        exec_fn = self._execs.get(name)
        if exec_fn is None:
            return ToolResult(observation={"error": "unknown_tool", "tool": name})
        try:
            return await exec_fn(args if isinstance(args, dict) else {})
        except Exception as exc:  # noqa: BLE001 —— 工具失败回喂错误,不破坏 loop
            return ToolResult(
                observation={"error": "tool_failed", "tool": name, "detail": str(exc)}
            )


def build_registry(tools_data: Any, ctx: Any) -> ToolRegistry:
    """构建工具注册表。所有工具都是确定性的(零 LLM 子调用)——文案由主控自己写。"""
    # 延迟导入避免与 edit_text -> tools 的循环。
    from . import edit_text as edit_text_tool

    schemas = [
        _SCHEMA_GET_PAGE_INFO,
        _SCHEMA_GET_BOOK_TREE,
        _SCHEMA_READ_SKILL,
        _SCHEMA_EDIT_TEXT,
        _SCHEMA_SWAP_LAYOUT,
        _SCHEMA_SWAP_IMAGES,
        _SCHEMA_ADVANCE,
        _SCHEMA_CONFIRM,
    ]
    execs: dict[str, ToolExec] = {
        "get_page_info": lambda a: _exec_get_page_info(tools_data, ctx, a),
        "get_book_tree": lambda a: _exec_get_book_tree(tools_data, ctx, a),
        "read_skill": lambda a: _exec_read_skill(a),
        "edit_text": lambda a: edit_text_tool.run(ctx, a),
        "swap_layout": lambda a: _exec_swap_layout(tools_data, ctx, a),
        "swap_images": lambda a: _exec_swap_images(tools_data, ctx, a),
        "advance_book": lambda a: _exec_advance(tools_data, ctx, a),
        "confirm_chapter": lambda a: _exec_confirm(ctx, a),
    }
    return ToolRegistry(schemas=schemas, _execs=execs)


# ── 工具执行器 ────────────────────────────────────────────────────────────────


def _page_index_from_arg(ctx: Any, raw_page: Any) -> int | None:
    """1-based 人类页码 -> pageIndex;缺省=聚焦页。"""
    if isinstance(raw_page, bool):
        raw_page = None
    if isinstance(raw_page, int) and raw_page >= 1:
        return raw_page - 1
    if isinstance(raw_page, str) and raw_page.strip().isdigit() and int(raw_page) >= 1:
        return int(raw_page) - 1
    return ctx.focused_page_index


async def _exec_get_page_info(tools_data: Any, ctx: Any, args: dict[str, Any]) -> ToolResult:
    req: V3EditChatRequest = ctx.req
    page_index = _page_index_from_arg(ctx, args.get("page"))
    scope = "page" if page_index is not None else "chapter"
    info = await tools_data.get_page_info(
        albumId=req.albumId,
        chapterId=req.focus.chapterId or "",
        scope=scope,
        pageIndex=page_index if scope == "page" else None,
    )
    return ToolResult(observation=_jsonable(info))


async def _exec_get_book_tree(tools_data: Any, ctx: Any, args: dict[str, Any]) -> ToolResult:
    req: V3EditChatRequest = ctx.req
    tree = await tools_data.get_book_tree(
        albumId=req.albumId,
        chapterId=req.focus.chapterId,
        pageIndex=req.focus.pageIndex,
    )
    return ToolResult(observation=_jsonable(tree))


async def _exec_read_skill(args: dict[str, Any]) -> ToolResult:
    """渐进式读取一个 skill 的完整手艺指南,回喂给主控。未知 name => 回喂可用清单。"""
    name = args.get("name")
    body = skills_registry.read_skill(name) if isinstance(name, str) else None
    if body is None:
        available = [s.name for s in skills_registry.list_skills()]
        return ToolResult(
            observation={
                "error": "unknown_skill",
                "requested": name,
                "availableSkills": available,
            }
        )
    return ToolResult(observation={"skill": name, "content": body})


async def _exec_swap_layout(tools_data: Any, ctx: Any, args: dict[str, Any]) -> ToolResult:
    """复用 tools/layout.swap_layout —— 它要一个 V3EditChatRequest + LayoutDataTools。
    主控用 page(1-based)/chapter 选范围,这里构造范围匹配的请求副本(适配器)。"""
    req: V3EditChatRequest = ctx.req
    chapter_scope = args.get("chapter") is True
    layout_req = req
    if chapter_scope:
        layout_req = req.model_copy(
            update={"focus": req.focus.model_copy(update={"pageIndex": None})}
        )
    else:
        page_index = _page_index_from_arg(ctx, args.get("page"))
        if page_index is not None and page_index != req.focus.pageIndex:
            layout_req = req.model_copy(
                update={"focus": req.focus.model_copy(update={"pageIndex": page_index})}
            )
    patches = await layout_tool.swap_layout(layout_req, tools_data)
    return ToolResult(
        observation={
            "swappedPages": [_jsonable(p.model_dump(exclude_none=True, mode="json")) for p in patches],
            "count": len(patches),
        },
        patches=list(patches),
    )


async def _exec_swap_images(tools_data: Any, ctx: Any, args: dict[str, Any]) -> ToolResult:
    """复用 tools/image_edit.run_image_edit(chapter, page, user_message)。聚焦页缺失 => talk。"""
    req: V3EditChatRequest = ctx.req
    page_index = _page_index_from_arg(ctx, args.get("page"))
    if page_index is None or page_index not in ctx.pages_by_index:
        return ToolResult(observation={"error": "no_target_page", "detail": "换图缺少目标页。"})
    page: Page = ctx.pages_by_index[page_index]
    chapter: V3Chapter | None = ctx.chapter
    if chapter is None:
        return ToolResult(observation={"error": "no_chapter", "detail": "缺章节照片上下文。"})
    patch = await image_edit_tool.run_image_edit(chapter, page, req.userMessage)
    if patch is None:
        return ToolResult(
            observation={
                "pageIndex": page_index,
                "applied": False,
                "detail": "图片编辑无法满足(意图/引擎降级),未改动。",
            }
        )
    return ToolResult(
        observation={
            "pageIndex": page_index,
            "applied": True,
            "patch": _jsonable(patch.model_dump(exclude_none=True, mode="json")),
        },
        patches=[patch],
    )


async def _exec_advance(tools_data: Any, ctx: Any, args: dict[str, Any]) -> ToolResult:
    """翻到下一未访问页。复用旧确定性 _advance_from_book_tree(读 book tree)。"""
    req: V3EditChatRequest = ctx.req
    book_tree = await tools_data.get_book_tree(
        albumId=req.albumId,
        chapterId=req.focus.chapterId,
        pageIndex=req.focus.pageIndex,
    )
    navigation, progress_decision, reply = edit_navigation.advance_from_book_tree(req, book_tree)
    obs: dict[str, Any] = {"reply": reply}
    if navigation is not None:
        obs["navigation"] = _jsonable(navigation.model_dump(exclude_none=True, mode="json"))
    if progress_decision is not None:
        obs["progressDecision"] = _jsonable(
            progress_decision.model_dump(exclude_none=True, mode="json")
        )
    return ToolResult(
        observation=obs,
        navigation=navigation,
        progressDecision=progress_decision,
    )


async def _exec_confirm(ctx: Any, args: dict[str, Any]) -> ToolResult:
    """标记本章完成。复用 story_progress.chapter_done_decision。"""
    decision = story_progress.chapter_done_decision()
    return ToolResult(
        observation={
            "chapterDone": True,
            "progressDecision": _jsonable(decision.model_dump(exclude_none=True, mode="json")),
        },
        progressDecision=decision,
    )


def _jsonable(value: Any) -> Any:
    """把 pydantic / 复杂对象降成 JSON-able(回喂给主控)。已是 dict/list/标量则原样。"""
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        try:
            return dump(mode="json", exclude_none=True)
        except Exception:  # noqa: BLE001
            pass
    return str(value)


# ── 工具 JSON-schema 声明(OpenAI function-calling 形状)。 ──────────────────────
_SCHEMA_GET_PAGE_INFO: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_page_info",
        "description": "查看某一页(或本章)的当前文案、图片、模板、照片场景。改之前先看清当前状态。",
        "parameters": {
            "type": "object",
            "properties": {
                "page": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "人类看到的页码,从 1 开始。不传则读取当前聚焦页/本章。",
                },
            },
            "additionalProperties": False,
        },
    },
}
_SCHEMA_GET_BOOK_TREE: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_book_tree",
        "description": "查看整本书的章节结构、进度、当前聚焦页。无需参数。",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    },
}
_SCHEMA_READ_SKILL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "read_skill",
        "description": (
            "读取一个编辑 skill 的完整手艺指南(怎么把某件事做好的经验)。可用 skill 的清单"
            "已在你的上下文里(每个带一句描述)。当你要动手改文案/换版式/换图,而这方面有对应 "
            "skill 时,先读它再做 —— 它会告诉你该怎么做得更好。只在需要时读,不用全读。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "要读取的 skill 名字(取自上下文里的 skill 清单)。",
                },
            },
            "required": ["name"],
            "additionalProperties": False,
        },
    },
}
_SCHEMA_EDIT_TEXT: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "edit_text",
        "description": (
            "把你写好的新文案落到某一页。你已经在上下文里看到了每页的当前文案和 slot 规格"
            "(id / maxChars / 语言),所以**你自己写好新文案**,用 texts 把每个槽位的新值传进来。"
            "工具只做校验落地(超长截断、丢弃非法键),并回传实际写入的文案供你核对。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "page": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "人类看到的页码,从 1 开始。不传则改当前聚焦页。",
                },
                "texts": {
                    "type": "object",
                    "description": (
                        "要写入的文案,键是 slot id(见该页 slots 规格),值是新文案字符串。"
                        "只需带你要改的槽位;不改的不用传。例:{\"title\": \"A Summer to Remember\"}。"
                    ),
                    "additionalProperties": {"type": "string"},
                },
            },
            "required": ["texts"],
            "additionalProperties": False,
        },
    },
}
_SCHEMA_SWAP_LAYOUT: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "swap_layout",
        "description": "给某页或整章换一套版式。只传 page(1-based)换单页,或传 chapter=true 整章换版。",
        "parameters": {
            "type": "object",
            "properties": {
                "page": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "人类看到的页码,从 1 开始。只换这一页时传。",
                },
                "chapter": {"type": "boolean", "description": "整章换版时传 true。"},
            },
            "additionalProperties": False,
        },
    },
}
_SCHEMA_SWAP_IMAGES: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "swap_images",
        "description": "换某一页的照片。不传 page 时用当前聚焦页。",
        "parameters": {
            "type": "object",
            "properties": {
                "page": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "人类看到的页码,从 1 开始。只换这一页的照片。",
                },
            },
            "additionalProperties": False,
        },
    },
}
_SCHEMA_ADVANCE: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "advance_book",
        "description": "翻到下一未完成的页。无需参数。",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    },
}
_SCHEMA_CONFIRM: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "confirm_chapter",
        "description": "把本章标记为完成(用户明确确认这一章好了、继续下一章时)。无需参数。",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    },
}
