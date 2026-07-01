"""主控 AI 的富上下文组装(实现)。

这是「上下文不足」根因的修复点。旧路由喂给模型的 payload 只有
userMessage/chapterId/focusedPageNumber/history —— **没有当前页文案**,所以 AI 改不到点上。

核心事实(已验证):`get_page_info` 早就返回 `{chapter: V3Chapter, pages: Page[]}`,
`Page.texts`/`Page.images` + `V3Chapter.photos[].sceneDescription` 正是需要的 —— 数据一直在,
旧路由只是从没把它喂给模型。这里把它**完整组装进上下文**。

主控上下文必须包含:
  - system:角色 + 能力清单 + 边界(controller.md)。让 AI 知道它能做什么、不能做什么。
  - 聚焦页的**当前文案**(Page.texts) —— 关键:让 AI 看到要改的原文(及其语言)。
  - 本章所有页(Page[]:templateId / images / texts) —— 多页编辑的全貌。
  - slot 规格:每个 text slot 的 id / lang / hint / maxChars(复用 writing 的 page_slot_specs)。
  - 照片场景描述(sceneDescription) —— 写文案的依据。
  - 对话历史(≤20 轮)。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ...schemas import Page, V3Chapter, V3EditChatRequest
from ...skills import load_prompt
from . import helpers
from . import skills_registry

_PROMPT_DIR = Path(__file__).resolve().parent

# 历史回放上限(对齐旧路由 history_turns 的 ≤20)。
MAX_HISTORY_TURNS = 20


@dataclass
class EditContext:
    """组装好的主控上下文:messages(给 LLM)+ 供工具/校验复用的结构化数据。"""

    messages: list[dict[str, Any]] = field(default_factory=list)
    # 结构化镜像(工具执行 + 改后验证用,避免重复 fetch)。
    req: V3EditChatRequest | None = None
    focused_page_index: int | None = None
    pages_by_index: dict[int, Page] = field(default_factory=dict)          # pageIndex -> Page
    current_texts: dict[int, dict[str, str]] = field(default_factory=dict)  # pageIndex -> texts
    slot_specs: dict[int, list[dict[str, Any]]] = field(default_factory=dict)  # pageIndex -> [{id,lang,hint,maxChars}]
    chapter: V3Chapter | None = None                                       # V3Chapter
    page_info: dict[str, Any] = field(default_factory=dict)                 # 原始 get_page_info 回包


def _coerce_page(raw: Any) -> Page | None:
    if isinstance(raw, Page):
        return raw
    try:
        return Page.model_validate(raw)
    except Exception:  # noqa: BLE001 —— 脏数据不入上下文,但绝不让组装崩
        return None


def _coerce_chapter(raw: Any) -> V3Chapter | None:
    if raw is None:
        return None
    if isinstance(raw, V3Chapter):
        return raw
    try:
        return V3Chapter.model_validate(raw)
    except Exception:  # noqa: BLE001
        return None


def slot_specs_for_page(page: Page) -> list[dict[str, Any]]:
    """逐页 text slot 规格,并把 maxChars 合并进每条规格。

    `page_slot_specs` 是 model-facing(只带 id/lang/hint,不带 maxChars —— 例驱动);
    `_template_max_chars` 是服务端钳长护栏的真相源(按 base slot id)。主控需要看到
    maxChars 才能据此写出合身的文案,所以这里把两者合并:每条 spec 带上自己的 maxChars(repeat /
    bracket key 按 base 查表)。"""
    specs = helpers.page_slot_specs(page)
    max_chars = helpers._template_max_chars(page.templateId)
    merged: list[dict[str, Any]] = []
    for spec in specs:
        out = dict(spec)
        cap = helpers._max_chars_for_key(str(spec["id"]), max_chars)
        if cap is not None:
            out["maxChars"] = cap
        merged.append(out)
    return merged


def _raw_history_from_req(req: V3EditChatRequest) -> Any:
    """fallback:V3EditChatRequest 正常不带 history(归 Web/repo,由 flow 注入)。

    仅在请求自带 history 字段时取原始 rows(向后兼容 / 测试便利)——清洗统一交给
    `_clean_history_messages`,这里不做过滤。"""
    return getattr(req, "history", None)


def _clean_history_messages(rows: Any) -> list[dict[str, str]]:
    """把跨轮历史清成给 LLM 的干净对话:只留 user 发言 + assistant 最终回复(≤20 轮)。

    两层记忆的关键防线:**工具调用 / 工具结果 / read_skill 加载的 skill 全文永远不进历史**
    —— 它们只活在产生它们的那一轮 loop 里。历史只承载「用户说了什么 + AI 最终答了什么」。

    正常路径下 flow 落库时就只写了 user/assistant 两种 role(工具产物从不入库),这里再兜一道:
      - 只认 role ∈ {user, assistant};其它(tool / system / 未知)一律丢。
      - 丢掉任何带 `tool_calls` 痕迹的行(防脏数据混入)。
      - content 必须是非空字符串。
    """
    out: list[dict[str, str]] = []
    for row in list(rows or []):
        if isinstance(row, dict):
            role = row.get("role")
            content = row.get("content")
            has_tool_calls = bool(row.get("tool_calls"))
        else:
            role = getattr(row, "role", None)
            content = getattr(row, "content", None)
            has_tool_calls = bool(getattr(row, "tool_calls", None))
        if has_tool_calls:
            continue
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            out.append({"role": role, "content": content})
    return out[-MAX_HISTORY_TURNS:]


async def build_context(
    req: V3EditChatRequest,
    tools_data: Any,
    *,
    history: list[dict[str, str]] | None = None,
) -> EditContext:
    """组装主控 AI 的富上下文。

    1. get_page_info(scope from focus):chapter(含 photos[].sceneDescription)+ pages。
    2. 逐页算 slot_specs(id/lang/hint/maxChars)。
    3. system = controller.md(角色 + 能力 + 边界)。
    4. user = JSON payload,**含当前页文案**(根因修复)。
    5. 追加 history(≤20)。
    6. 填结构化镜像。
    """
    focused = req.focus.pageIndex
    scope = "page" if focused is not None else "chapter"
    page_info = await tools_data.get_page_info(
        albumId=req.albumId,
        chapterId=req.focus.chapterId or "",
        scope=scope,
        pageIndex=focused if scope == "page" else None,
    )

    chapter = _coerce_chapter(page_info.get("chapter"))
    pages_by_index: dict[int, Page] = {}
    current_texts: dict[int, dict[str, str]] = {}
    slot_specs: dict[int, list[dict[str, Any]]] = {}
    for raw in list(page_info.get("pages", []) or []):
        page = _coerce_page(raw)
        if page is None:
            continue
        pages_by_index[page.pageIndex] = page
        current_texts[page.pageIndex] = dict(page.texts)
        slot_specs[page.pageIndex] = slot_specs_for_page(page)

    # 照片场景描述(写文案的依据)。
    photos = (
        [
            {"photoId": p.photoId, "sceneDescription": p.sceneDescription}
            for p in chapter.photos
        ]
        if chapter is not None
        else []
    )

    pages_payload: list[dict[str, Any]] = []
    for idx in sorted(pages_by_index):
        page = pages_by_index[idx]
        pages_payload.append(
            {
                "pageIndex": idx,
                "templateId": page.templateId,
                "images": dict(page.images),
                "texts": current_texts.get(idx, {}),
                "slots": slot_specs.get(idx, []),
            }
        )

    focused_texts = current_texts.get(focused, {}) if focused is not None else {}

    payload: dict[str, Any] = {
        "language": req.language,
        "userMessage": req.userMessage,
        "focusedPageNumber": focused + 1 if focused is not None else None,
        # ★ 根因修复:把聚焦页的当前文案直接放进 payload。
        "focusedPageTexts": focused_texts,
        "pages": pages_payload,
        "photos": photos,
    }

    # skill 清单(只 name+一句描述)嵌进 system —— 主控据此决定读哪个(渐进式加载)。
    system = load_prompt(
        _PROMPT_DIR / "controller.md",
        SKILLS_CATALOG=skills_registry.skills_catalog_text(),
    )

    # 消息结构(两层记忆):
    #   system(角色 + skill 清单)
    #   → 跨轮历史:只有 user 发言 + AI 最终回复(≤20 轮,旧→新;工具/skill 全文永不入史)
    #   → 本轮 user:富上下文 payload(当前文案 + 照片 + userMessage)
    #   → [loop 内运行时:assistant tool_calls / tool 结果 / read_skill 全文 —— 只活这一轮]
    # 历史必须排在本轮 user payload **之前**,时间线才对(旧对话在前,当前诉求在最后)。
    rows = history if history is not None else _raw_history_from_req(req)
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
    messages.extend(_clean_history_messages(rows))
    messages.append({"role": "user", "content": json.dumps(payload, ensure_ascii=False)})

    return EditContext(
        messages=messages,
        req=req,
        focused_page_index=focused,
        pages_by_index=pages_by_index,
        current_texts=current_texts,
        slot_specs=slot_specs,
        chapter=chapter,
        page_info=page_info,
    )


def tool_result_message(tool_call_id: str, name: str, result: Any) -> dict[str, Any]:
    """把工具执行结果包成 OpenAI `tool` message,回喂给主控 AI(loop 的关键回喂步)。

    edit_text 的结果回带**实际写入的文案**(appliedTexts),让主控能验证「改对了没」。"""
    return {
        "role": "tool",
        "tool_call_id": tool_call_id,
        "name": name,
        "content": json.dumps(result, ensure_ascii=False, default=str),
    }
