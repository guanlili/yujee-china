from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from time import perf_counter
from typing import Any

from ..agents.tools import layout as layout_tool
from ..db import agent_edit_repo
from ..schemas import (
    V3EditChatRequest,
    V3EditChatResponse,
    V3EditNavigation,
    V3EditProgressDecision,
    V3LayoutPatchEntry,
    V3PageTextsPatch,
    V3Usage,
)
from . import context, patches, progress
from .schema import EditRepo, EditTools
from .web_client import WebAgentDataClient


class EditChatError(RuntimeError):
    pass


# 兼容旧测试/旧调用方的私有函数名。新代码优先调用 story.patches / story.progress。
_usage = patches.usage
_kind_from_bundle = patches.kind_from_bundle
_op_kind = patches.operation_kind
_wants_layout_swap = patches.wants_layout_swap
_wants_chapter_done = progress.wants_chapter_done
_case4_layout_swap = layout_tool.swap_layout
_chapter_chat_bundle = context.chapter_chat_bundle


async def run(
    req: V3EditChatRequest,
    *,
    repo: EditRepo | None = None,
    tools: EditTools | None = None,
    complete: Callable[..., Awaitable[dict[str, Any]]] | None = None,
    call_intent: Callable[[str], Awaitable[list[str]]] | None = None,
) -> V3EditChatResponse:
    start = perf_counter()
    repo = repo or agent_edit_repo
    tools = tools or WebAgentDataClient()

    turn = await repo.begin_serialized_turn(req.albumId, chapter_id=req.focus.chapterId, limit=20)
    try:
        history = turn.history
        req = patches.with_contextual_page_focus(
            req, session_json=getattr(turn, "session_json", None)
        )

        layout_patches: list[V3LayoutPatchEntry] = []
        pages_texts: list[V3PageTextsPatch] | None = None
        progress_decision: V3EditProgressDecision | None = None
        navigation: V3EditNavigation | None = None
        assistant_reply = "Tell me more about what you want to change."
        usage: V3Usage | None = None

        if progress.wants_chapter_done(req):
            progress_decision = progress.chapter_done_decision()
            assistant_reply = "This chapter is confirmed."
        elif req.focus.chapterId:
            try:
                bundle = await context.chapter_chat_bundle(
                    req,
                    history=history,
                    tools=tools,
                    complete=complete,
                    call_intent=call_intent,
                )
                assistant_reply = bundle.assistant_reply
                pages_texts = bundle.pages_texts
                layout_patches = bundle.layout_patches
                usage = bundle.usage
                navigation = bundle.navigation
                progress_decision = bundle.progress_decision or progress_decision
            except Exception as exc:
                raise EditChatError(f"chapter edit failed: {exc}") from exc

        duration_ms = max(1, int((perf_counter() - start) * 1000))
        usage = usage or patches.usage(duration_ms)
        op_kind = patches.operation_kind(req, pages_texts, layout_patches, progress_decision, navigation)
        payload = {
            "kind": patches.kind_from_bundle(pages_texts, layout_patches),
            "patches": [patch.model_dump(exclude_none=True, mode="json") for patch in layout_patches],
            "pagesTexts": [patch.model_dump(mode="json") for patch in pages_texts] if pages_texts else None,
            "progressDecision": progress_decision.model_dump(mode="json", exclude_none=True)
            if progress_decision
            else None,
            "navigation": navigation.model_dump(mode="json", exclude_none=True) if navigation else None,
            "history": history,
        }
        op_id = await turn.create_pending_turn(
            album_id=req.albumId,
            chapter_id=req.focus.chapterId,
            user_content=req.userMessage,
            assistant_content=assistant_reply,
            kind=op_kind,
            payload=payload,
            usage=usage.model_dump(mode="json"),
        )

        return V3EditChatResponse(
            kind=patches.kind_from_bundle(pages_texts, layout_patches),
            assistantReply=assistant_reply,
            patches=layout_patches,
            pagesTexts=pages_texts,
            progressDecision=progress_decision,
            navigation=navigation,
            opId=op_id,
            usage=usage,
        )
    except BaseException:
        try:
            await asyncio.shield(turn.cancel())
        except BaseException:
            pass
        raise


__all__ = [
    "EditChatError",
    "EditRepo",
    "EditTools",
    "run",
    "_case4_layout_swap",
    "_chapter_chat_bundle",
    "_kind_from_bundle",
    "_op_kind",
    "_usage",
    "_wants_chapter_done",
    "_wants_layout_swap",
]
