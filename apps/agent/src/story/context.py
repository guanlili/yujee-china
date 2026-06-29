"""章节故事 turn 的上下文组装。"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .. import ai_client
from ..agents.story import handler as story_agent
from ..agents.tools import image_edit as image_edit_tool
from ..agents.tools import layout as layout_tool
from ..schemas import (
    Page,
    V3ChapterChatRequest,
    V3ChatTurn,
    V3Chapter,
    V3EditChatRequest,
    V3EditNavigation,
    V3EditProgressDecision,
    V3LayoutPatchEntry,
    V3PageTextsPatch,
    V3Usage,
)
from ..settings import get_settings
from ..skills import load_prompt
from .patches import usage
from . import progress as story_progress
from .schema import EditTools

_PROMPT_DIR = Path(__file__).resolve().parents[1] / "agents" / "story"


@dataclass(slots=True)
class ChapterChatBundle:
    assistant_reply: str
    pages_texts: list[V3PageTextsPatch] | None
    layout_patches: list[V3LayoutPatchEntry]
    usage: V3Usage
    navigation: V3EditNavigation | None = None
    progress_decision: V3EditProgressDecision | None = None


_GET_PAGE_INFO_TOOL = {
    "type": "function",
    "function": {
        "name": "get_page_info",
        "description": "读取页面信息。只传人类页码 page；不传 page 时读取当前章节。",
        "parameters": {
            "type": "object",
            "properties": {
                "page": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "人类看到的页码,从 1 开始。例如第 2 页传 2。",
                },
            },
            "additionalProperties": False,
        },
    },
}
_GET_BOOK_TREE_TOOL = {
    "type": "function",
    "function": {
        "name": "get_book_tree",
        "description": "读取整本 book tree 的章节、页码和完成状态。无需参数。",
        "parameters": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
}
_SWAP_LAYOUT_TOOL = {
    "type": "function",
    "function": {
        "name": "swap_layout",
        "description": "换模板/换版式。只传人类页码 page,或传 chapter=true 表示整章换版。",
        "parameters": {
            "type": "object",
            "properties": {
                "page": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "人类看到的页码,从 1 开始。只换这一页时传。",
                },
                "chapter": {
                    "type": "boolean",
                    "description": "整章换版时传 true。",
                },
            },
            "additionalProperties": False,
        },
    },
}
_SWAP_IMAGES_TOOL = {
    "type": "function",
    "function": {
        "name": "swap_images",
        "description": "换图/换照片。只传人类页码 page；未指定时用当前页。",
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
_ADVANCE_BOOK_TOOL = {
    "type": "function",
    "function": {
        "name": "advance_book",
        "description": "用户说继续、下一页、下一个、好了时推进 book tree。无需参数。",
        "parameters": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
    },
}
_STORY_TOOLS = [
    _GET_PAGE_INFO_TOOL,
    _GET_BOOK_TREE_TOOL,
    _SWAP_LAYOUT_TOOL,
    _SWAP_IMAGES_TOOL,
    _ADVANCE_BOOK_TOOL,
]


def history_turns(rows: list[dict[str, str]]) -> list[V3ChatTurn]:
    turns: list[V3ChatTurn] = []
    for row in rows:
        role = row.get("role")
        content = row.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            turns.append(V3ChatTurn(role=role, content=content))
    return turns[-20:]


def _build_tool_router_messages(
    req: V3EditChatRequest, history: list[dict[str, str]]
) -> list[dict[str, Any]]:
    payload = {
        "language": req.language,
        "albumId": req.albumId,
        "chapterId": req.focus.chapterId,
        "userMessage": req.userMessage,
        "history": [turn.model_dump() for turn in history_turns(history)],
        "focusedPageNumber": req.focus.pageIndex + 1 if req.focus.pageIndex is not None else None,
        "defaultToolArgs": {
            **({"page": req.focus.pageIndex + 1} if req.focus.pageIndex is not None else {"chapter": True}),
        },
    }
    return [
        {"role": "system", "content": load_prompt(_PROMPT_DIR / "tool_router.md")},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


async def _complete_tool_router(
    messages: list[dict[str, Any]],
    *,
    complete: Callable[..., Awaitable[dict[str, Any]]] | None,
) -> dict[str, Any]:
    if complete is not None:
        try:
            return await complete(
                messages=messages,
                max_tokens=300,
                temperature=0.1,
                tools=_STORY_TOOLS,
                tool_choice="auto",
            )
        except TypeError:
            return await complete(messages=messages, max_tokens=300, temperature=0.1)

    settings = get_settings()
    if not settings.deepseek_api_key:
        raise story_agent.ChapterChatV3Error("DEEPSEEK_API_KEY missing; cannot route story tools")
    return await ai_client.chat_completion(
        base_url=settings.deepseek_base_url,
        api_key=settings.deepseek_api_key,
        model=settings.deepseek_model,
        messages=messages,
        timeout_seconds=settings.deepseek_timeout_seconds,
        max_tokens=300,
        temperature=0.1,
        extra_body=(
            {"thinking": {"type": "disabled"}} if settings.deepseek_disable_thinking else None
        ),
        tools=_STORY_TOOLS,
        tool_choice="auto",
    )


def _tool_page_index(args: dict[str, Any], req: V3EditChatRequest) -> int | None:
    page = args.get("page")
    if isinstance(page, int) and page >= 1:
        return page - 1
    return req.focus.pageIndex


def _tool_call(response: dict[str, Any]) -> tuple[str, dict[str, Any], dict[str, Any]] | None:
    for call in ai_client.extract_tool_calls(response):
        function = call.get("function")
        if not isinstance(function, dict):
            continue
        name = function.get("name")
        if name not in {"get_page_info", "get_book_tree", "swap_layout", "swap_images", "advance_book"}:
            continue
        try:
            args = ai_client.parse_json_loose(str(function.get("arguments") or "{}"))
        except ValueError:
            args = {}
        if not isinstance(args, dict):
            args = {}
        return str(name), args, call
    return None


async def _fetch_page_info(
    req: V3EditChatRequest,
    tools: EditTools,
    *,
    page_index: int | None,
) -> dict[str, Any]:
    scope = "page" if page_index is not None else "chapter"
    return await tools.get_page_info(
        albumId=req.albumId,
        chapterId=req.focus.chapterId or "",
        scope=scope,
        pageIndex=page_index if scope == "page" else None,
    )


async def _fetch_book_tree(req: V3EditChatRequest, tools: EditTools) -> dict[str, Any]:
    return await tools.get_book_tree(
        albumId=req.albumId,
        chapterId=req.focus.chapterId,
        pageIndex=req.focus.pageIndex,
    )


def _append_tool_result(
    messages: list[dict[str, Any]],
    *,
    call: dict[str, Any],
    name: str,
    result: dict[str, Any],
) -> None:
    tool_call_id = str(call.get("id") or f"call_{name}")
    messages.append({"role": "assistant", "content": "", "tool_calls": [call]})
    messages.append(
        {
            "role": "tool",
            "tool_call_id": tool_call_id,
            "name": name,
            "content": json.dumps(result, ensure_ascii=False),
        }
    )


def _page_from_page_info(page_info: dict[str, Any], page_index: int) -> Page | None:
    for raw in list(page_info.get("pages", []) or []):
        page = raw if isinstance(raw, Page) else Page.model_validate(raw)
        if page.pageIndex == page_index:
            return page
    return None


async def _swap_images(
    req: V3EditChatRequest,
    tools: EditTools,
    *,
    args: dict[str, Any],
    call_intent: Callable[[str], Awaitable[list[str]]] | None,
) -> list[V3LayoutPatchEntry]:
    page_index = _tool_page_index(args, req)
    if page_index is None or not req.focus.chapterId:
        return []

    page_info = await _fetch_page_info(req, tools, page_index=page_index)
    page = _page_from_page_info(page_info, page_index)
    if page is None:
        return []
    chapter = V3Chapter.model_validate(page_info.get("chapter"))
    patch = await image_edit_tool.run_image_edit(
        chapter,
        page,
        req.userMessage,
        call_intent=call_intent,
    )
    return [patch] if patch is not None else []


def _book_tree_chapter(book_tree: dict[str, Any], chapter_id: str | None) -> dict[str, Any] | None:
    for chapter in list(book_tree.get("chapters", []) or []):
        if isinstance(chapter, dict) and chapter.get("chapterId") == chapter_id:
            return chapter
    return None


def _book_tree_focused_page(book_tree: dict[str, Any], req: V3EditChatRequest) -> int | None:
    value = book_tree.get("focusedPageIndex")
    if isinstance(value, int) and value >= 0:
        return value
    return req.focus.pageIndex


def _advance_from_book_tree(
    req: V3EditChatRequest, book_tree: dict[str, Any]
) -> tuple[V3EditNavigation | None, V3EditProgressDecision | None, str]:
    progress = book_tree.get("progress") if isinstance(book_tree.get("progress"), dict) else {}
    chapter_id = req.focus.chapterId or progress.get("currentChapterId")
    chapter = _book_tree_chapter(book_tree, chapter_id if isinstance(chapter_id, str) else None)
    page_indexes = [
        value for value in list((chapter or {}).get("pageIndexes", []) or []) if isinstance(value, int)
    ]
    page_indexes = sorted(set(page_indexes))
    focused = _book_tree_focused_page(book_tree, req)

    if page_indexes:
        if focused is None:
            page_index = page_indexes[0]
            return (
                V3EditNavigation(pageIndex=page_index),
                None,
                "已翻到这一章的第一页。" if req.language == "zh" else "Opening the first page in this chapter.",
            )
        for page_index in page_indexes:
            if page_index > focused:
                return (
                    V3EditNavigation(pageIndex=page_index),
                    None,
                    "已翻到下一页。" if req.language == "zh" else "Opening the next page.",
                )

    if chapter_id:
        return (
            None,
            story_progress.chapter_done_decision(),
            "这一章已确认，继续下一章。" if req.language == "zh" else "This chapter is confirmed. Moving on.",
        )
    return (
        None,
        None,
        "整本书的章节已经确认完成。" if req.language == "zh" else "All chapters are already confirmed.",
    )


async def _run_tool_router(
    req: V3EditChatRequest,
    *,
    history: list[dict[str, str]],
    tools: EditTools,
    complete: Callable[..., Awaitable[dict[str, Any]]] | None,
    call_intent: Callable[[str], Awaitable[list[str]]] | None,
) -> tuple[str, Any]:
    requested: tuple[str, dict[str, Any], dict[str, Any]] | None = None
    messages: list[dict[str, Any]] = _build_tool_router_messages(req, history)
    try:
        for _ in range(2):
            response = await _complete_tool_router(messages, complete=complete)
            requested = _tool_call(response)
            if not requested:
                break
            name, args, call = requested
            if name == "get_book_tree":
                book_tree = await _fetch_book_tree(req, tools)
                _append_tool_result(messages, call=call, name=name, result=book_tree)
                continue
            break
    except Exception:
        requested = None

    if requested:
        name, args, _call = requested
        if name == "swap_layout":
            page_index = _tool_page_index(args, req)
            chapter_scope = args.get("chapter") is True
            layout_req = req
            if page_index is not None and not chapter_scope:
                layout_req = req.model_copy(
                    update={"focus": req.focus.model_copy(update={"pageIndex": page_index})}
                )
            elif chapter_scope:
                layout_req = req.model_copy(
                    update={"focus": req.focus.model_copy(update={"pageIndex": None})}
                )
            return "swap_layout", await layout_tool.swap_layout(layout_req, tools)
        if name == "swap_images":
            return "swap_images", await _swap_images(
                req,
                tools,
                args=args,
                call_intent=call_intent,
            )
        if name == "advance_book":
            book_tree = await _fetch_book_tree(req, tools)
            return "advance_book", _advance_from_book_tree(req, book_tree)
        if name == "get_page_info":
            page_index = _tool_page_index(args, req)
            return "page_info", await _fetch_page_info(req, tools, page_index=page_index)

    page_index = _tool_page_index(requested[1], req) if requested else None
    return "page_info", await _fetch_page_info(req, tools, page_index=page_index)


async def chapter_chat_bundle(
    req: V3EditChatRequest,
    *,
    history: list[dict[str, str]],
    tools: EditTools,
    complete: Callable[..., Awaitable[dict[str, Any]]] | None = None,
    call_intent: Callable[[str], Awaitable[list[str]]] | None = None,
) -> ChapterChatBundle:
    chapter_id = req.focus.chapterId
    if not chapter_id:
        return ChapterChatBundle(
            "Tell me more about what you want to change.",
            None,
            [],
            usage(1),
        )

    tool_kind, tool_result = await _run_tool_router(
        req,
        history=history,
        tools=tools,
        complete=complete,
        call_intent=call_intent,
    )
    if tool_kind == "swap_layout":
        return ChapterChatBundle("Updated the layout.", None, tool_result or [], usage(1))
    if tool_kind == "swap_images":
        return ChapterChatBundle("Updated the images.", None, tool_result or [], usage(1))
    if tool_kind == "advance_book":
        navigation, progress_decision, assistant_reply = tool_result
        return ChapterChatBundle(
            assistant_reply,
            None,
            [],
            usage(1),
            navigation=navigation,
            progress_decision=progress_decision,
        )

    page_info = tool_result
    chapter_req = V3ChapterChatRequest(
        albumId=req.albumId,
        language=req.language,
        chapter=page_info["chapter"],
        pages=page_info["pages"],
        history=history_turns(history),
        userMessage=req.userMessage,
        **({"focusedPageIndex": req.focus.pageIndex} if req.focus.pageIndex is not None else {}),
    )
    response = await story_agent.run(
        chapter_req,
        complete=complete,
        call_intent=call_intent,
    )
    return ChapterChatBundle(
        response.assistantReply,
        response.pagesTexts,
        response.layoutPatch or [],
        response.usage,
    )


__all__ = ["ChapterChatBundle", "chapter_chat_bundle", "history_turns"]
