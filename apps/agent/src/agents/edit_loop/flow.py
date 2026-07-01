"""Stage3 /v3/edit-chat 编排:DB serialized-turn 生命周期 + 主控 agent loop。

旧 story/flow.run 把「单次工具路由」(story/context)包进一个 serialized turn(读 history、
跑业务、落 pending op + opId)。这里保留**完全相同的 DB turn 生命周期**,把内核换成干净的
主控 agent loop(controller.run_edit_loop):

  begin_serialized_turn → run_edit_loop(history=lease.history) → create_pending_turn → 响应

契约不变(V3EditChatResponse):kind / assistantReply / patches / pagesTexts /
progressDecision / navigation / opId / usage 一一对应。opId/ack 机制(Web commit 确认)沿用。
"""

from __future__ import annotations

import asyncio
from time import perf_counter

from ...db import agent_edit_repo
from ...schemas import (
    V3EditChatRequest,
    V3EditChatResponse,
    V3PageTextsPatch,
)
from ...story import patches as edit_patches
from ...story.schema import EditRepo, EditTools
from ...story.web_client import WebAgentDataClient
from . import controller as edit_controller
from . import progress as edit_progress


class EditChatError(RuntimeError):
    """编辑链路失败时抛;路由映射成 502 AGENT_PLANNING_FAILED(同步端点走 HTTP 错误码)。"""


def _pages_texts_from_loop(
    result: edit_controller.EditLoopResult,
) -> list[V3PageTextsPatch] | None:
    """主控 loop 的 pagesTexts(dict[pageIndex -> texts])→ 契约的 V3PageTextsPatch[]。

    无任何文案改动时返回 None(契约里 pagesTexts 是可选项,空则省略)。"""
    if not result.pagesTexts:
        return None
    return [
        V3PageTextsPatch(pageIndex=page_index, texts=texts)
        for page_index, texts in sorted(result.pagesTexts.items())
    ]


async def run(
    req: V3EditChatRequest,
    *,
    repo: EditRepo | None = None,
    tools: EditTools | None = None,
) -> V3EditChatResponse:
    """编辑环节单次请求 = 一个 serialized turn,内部跑主控 agent loop。"""
    start = perf_counter()
    repo = repo or agent_edit_repo
    tools = tools or WebAgentDataClient()

    turn = await repo.begin_serialized_turn(req.albumId, chapter_id=req.focus.chapterId, limit=20)
    try:
        history = turn.history
        req = edit_patches.with_contextual_page_focus(
            req, session_json=getattr(turn, "session_json", None)
        )

        # 明确「确认本章完成」短路:与旧 flow 一致,不必进 loop。
        if edit_progress.wants_chapter_done(req):
            progress_decision = edit_progress.chapter_done_decision()
            assistant_reply = "This chapter is confirmed."
            layout_patches: list = []
            pages_texts: list[V3PageTextsPatch] | None = None
            navigation = None
        else:
            try:
                result = await edit_controller.run_edit_loop(
                    req, tools_data=tools, history=history
                )
            except Exception as exc:  # noqa: BLE001 —— loop 内部已自降级;这里兜底成契约错误
                raise EditChatError(f"chapter edit failed: {exc}") from exc
            assistant_reply = result.assistantReply
            layout_patches = list(result.patches)
            pages_texts = _pages_texts_from_loop(result)
            progress_decision = result.progressDecision
            navigation = result.navigation

        duration_ms = max(1, int((perf_counter() - start) * 1000))
        usage = edit_patches.usage(duration_ms)
        op_kind = edit_patches.operation_kind(
            req, pages_texts, layout_patches, progress_decision, navigation
        )
        payload = {
            "kind": edit_patches.kind_from_bundle(pages_texts, layout_patches),
            "patches": [patch.model_dump(exclude_none=True, mode="json") for patch in layout_patches],
            "pagesTexts": [patch.model_dump(mode="json") for patch in pages_texts]
            if pages_texts
            else None,
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
            kind=edit_patches.kind_from_bundle(pages_texts, layout_patches),
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


__all__ = ["EditChatError", "run"]
