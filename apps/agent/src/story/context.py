"""章节故事 turn 的上下文组装。"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from ..agents.story import handler as story_agent
from ..schemas import (
    V3ChapterChatRequest,
    V3ChatTurn,
    V3EditChatRequest,
    V3LayoutPatchEntry,
    V3PageTextsPatch,
    V3Usage,
)
from .patches import usage
from .schema import EditTools


def history_turns(rows: list[dict[str, str]]) -> list[V3ChatTurn]:
    turns: list[V3ChatTurn] = []
    for row in rows:
        role = row.get("role")
        content = row.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            turns.append(V3ChatTurn(role=role, content=content))
    return turns[-20:]


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

    page_info = await tools.get_page_info(
        albumId=req.albumId,
        chapterId=chapter_id,
        scope="chapter",
        pageIndex=None,
    )
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
