"""章节故事 turn 的上下文组装。"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from .. import ai_client
from ..agents.story import handler as story_agent
from ..agents.tools import layout as layout_tool
from ..schemas import (
    V3ChapterChatRequest,
    V3ChatTurn,
    V3EditChatRequest,
    V3LayoutPatchEntry,
    V3PageTextsPatch,
    V3Usage,
)
from ..settings import get_settings
from ..skills import load_prompt
from .patches import usage
from .schema import EditTools

_PROMPT_DIR = Path(__file__).resolve().parents[1] / "agents" / "story"

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
_STORY_TOOLS = [_GET_PAGE_INFO_TOOL, _SWAP_LAYOUT_TOOL]


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
) -> list[dict[str, str]]:
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
    messages: list[dict[str, str]],
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


def _tool_call(response: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    for call in ai_client.extract_tool_calls(response):
        function = call.get("function")
        if not isinstance(function, dict):
            continue
        name = function.get("name")
        if name not in {"get_page_info", "swap_layout"}:
            continue
        try:
            args = ai_client.parse_json_loose(str(function.get("arguments") or "{}"))
        except ValueError:
            args = {}
        if not isinstance(args, dict):
            args = {}
        return str(name), args
    return None


async def _run_tool_router(
    req: V3EditChatRequest,
    *,
    history: list[dict[str, str]],
    tools: EditTools,
    complete: Callable[..., Awaitable[dict[str, Any]]] | None,
) -> tuple[str, Any]:
    try:
        response = await _complete_tool_router(
            _build_tool_router_messages(req, history),
            complete=complete,
        )
        requested = _tool_call(response)
    except Exception:
        requested = None

    if requested and requested[0] == "swap_layout":
        page_index = _tool_page_index(requested[1], req)
        chapter_scope = requested[1].get("chapter") is True
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

    page_index = _tool_page_index(requested[1], req) if requested else None
    scope = "page" if page_index is not None else "chapter"
    page_info = await tools.get_page_info(
        albumId=req.albumId,
        chapterId=req.focus.chapterId or "",
        scope=scope,
        pageIndex=page_index if scope == "page" else None,
    )
    return "page_info", page_info


async def chapter_chat_bundle(
    req: V3EditChatRequest,
    *,
    history: list[dict[str, str]],
    tools: EditTools,
    complete: Callable[..., Awaitable[dict[str, Any]]] | None = None,
    call_intent: Callable[[str], Awaitable[list[str]]] | None = None,
) -> tuple[str, list[V3PageTextsPatch] | None, list[V3LayoutPatchEntry], V3Usage]:
    chapter_id = req.focus.chapterId
    if not chapter_id:
        return "Tell me more about what you want to change.", None, [], usage(1)

    tool_kind, tool_result = await _run_tool_router(
        req,
        history=history,
        tools=tools,
        complete=complete,
    )
    if tool_kind == "swap_layout":
        return "Updated the layout.", None, tool_result or [], usage(1)

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
    return (
        response.assistantReply,
        response.pagesTexts,
        response.layoutPatch or [],
        response.usage,
    )


__all__ = ["chapter_chat_bundle", "history_turns"]
