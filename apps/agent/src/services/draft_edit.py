"""Draft-period single-page edit service (#162).

The editor now "展示第一版 + 定点单页调整": the user lands on the complete first
draft (#161) and tweaks one page at a time. Talk (questions/opinions/greetings)
and act (rewrite one page's copy) are PHYSICALLY separated by a tool layer
(services/tools.py) instead of being mixed into one chat blob.

One dialog-model call per turn, with `write_page_copy` offered via OpenAI
function-calling and `tool_choice="auto"`:
  * the model calls the tool  → `tools.dispatch` clamps to the page's template
    slots → kind="act" + pageWrite (G3 may still demote degenerate args → talk);
  * the model just answers     → kind="talk", no pageWrite.

Scope is one page only: the request carries a single skeleton page slice + that
page's photos (no base64, no whole draft tree — invariant 12). Thinking is
disabled for the act-classification call (G2). Model/timeout/parse failure →
DraftEditError, which the route maps to AGENT_CHAT_FAILED / 502 (mirrors
v2_album.submit_edit)."""

from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable
from typing import Any

from . import ai_client, tools, writing_guides
from ..logging_config import get_logger
from ..schemas_v2 import (
    Usage,
    V2DraftEditRequest,
    V2DraftEditResponse,
    V2DraftPageWrite,
    V2Models,
)
from ..settings import get_settings

log = get_logger("draft_edit")

CompleteFn = Callable[..., Awaitable[dict[str, Any]]]


class DraftEditError(Exception):
    """Maps to AGENT_CHAT_FAILED (HTTP 502)."""


def _system_prompt(req: V2DraftEditRequest) -> str:
    """The dialog persona + how to use the tool layer. The tool's own description
    (G1) carries the call/don't-call rules; here we frame the whole turn so the
    model talks by default and only writes when explicitly asked.

    FOCUS block (reused from chat_edit_v2 §97-99): when `focusedPageIndex` is
    present the user has SELECTED this page, so deictic requests ("change this",
    "改这里/这一页") target it."""
    focus = ""
    if req.focusedPageIndex is not None:
        focus = (
            '\nFOCUS: the payload has "focusedPageIndex" — the user has SELECTED '
            'that page in the editor. A deictic request ("change this", "this page", '
            '"改这里/这一页") targets that page. Edit it unless the user clearly names '
            "a different page.\n"
        )
    return (
        writing_guides.persona_block() + "\n\n"
        "You are helping a user edit ONE page of their memoir photo album during "
        "the draft stage. You can do two kinds of things:\n"
        "  1. TALK — answer questions, give opinions, suggest ideas, chat. This is "
        "the DEFAULT. Reply in plain text, in the user's language, <=500 chars.\n"
        "  2. ACT — change the words on the page. To do this, and ONLY this, call "
        "the `write_page_copy` tool with the real final copy. Read the tool's own "
        "description for exactly when to call it and when NOT to.\n"
        "If the user is only asking, greeting, giving an opinion, or says not to "
        "change anything, just TALK — do not call the tool. Never call the tool "
        "with placeholder or dummy text.\n"
        + focus
        + "\n"
        + writing_guides.guides_block()
    )


def _user_payload(req: V2DraftEditRequest) -> str:
    """The single-page slice + that page's photos + history + message. No base64,
    no whole tree (invariant 12). Includes the authored slot specs so the model
    knows which slots exist on this page's template."""
    payload: dict[str, Any] = {
        "language": req.language,
        "theme": req.theme.model_dump(exclude_none=True) if req.theme else None,
        "page": {
            "pageIndex": req.page.pageIndex,
            "templateId": req.page.templateId,
            "texts": req.page.texts,
            "slots": writing_guides.page_slot_specs(req.page.templateId),
        },
        "photos": [p.model_dump(exclude_none=True) for p in req.photos],
        "history": [h.model_dump() for h in req.history],
        "userMessage": req.userMessage,
    }
    if req.focusedPageIndex is not None:
        payload["focusedPageIndex"] = req.focusedPageIndex
    return json.dumps(payload, ensure_ascii=False)


async def _complete(
    messages: list[dict[str, str]],
    *,
    complete: CompleteFn | None,
) -> dict[str, Any]:
    """Run one dialog call offering the enabled tools (tool_choice='auto'), with
    thinking disabled (G2). In mock mode the injected `complete` stands in for the
    real Ark call."""
    enabled_tools = tools.tools_for_prompt()
    if complete is not None:
        return await complete(
            messages=messages, tools=enabled_tools, tool_choice="auto"
        )

    settings = get_settings()
    if not settings.deepseek_api_key:
        raise DraftEditError("dialog model API key missing; cannot run draft-edit")
    return await ai_client.chat_completion(
        base_url=settings.deepseek_base_url,
        api_key=settings.deepseek_api_key,
        model=settings.deepseek_model,
        messages=messages,
        timeout_seconds=settings.deepseek_timeout_seconds,
        temperature=0.3,
        max_tokens=1024,
        tools=enabled_tools,
        tool_choice="auto",
        # G2: disable thinking for the act-classification call (matches the
        # composing/deepseek precedent in settings.py).
        extra_body={"thinking": {"type": "disabled"}},
    )


def _act_confirmation(req: V2DraftEditRequest, model_text: str) -> str:
    """The act-turn assistantReply: the model's text if it volunteered one,
    else a fixed short confirmation."""
    text = model_text.strip()
    if text:
        return text[:500]
    n = req.page.pageIndex
    return f"改好了第 {n} 页" if req.language == "zh" else f"Updated page {n}"


async def run(
    req: V2DraftEditRequest, *, complete: CompleteFn | None = None
) -> V2DraftEditResponse:
    settings = get_settings()
    started = time.monotonic()

    log.info(
        "draft_edit.call.start",
        album_id=req.albumId,
        page_index=req.page.pageIndex,
        focused=req.focusedPageIndex,
        history_len=len(req.history),
        language=req.language,
    )

    messages = [
        {"role": "system", "content": _system_prompt(req)},
        {"role": "user", "content": _user_payload(req)},
    ]

    try:
        response = await _complete(messages, complete=complete)
    except ai_client.AIRequestError as exc:
        raise DraftEditError(f"draft-edit upstream call failed: {exc}") from exc

    prompt_tokens, completion_tokens = ai_client.extract_usage(response)
    model_text = ai_client.extract_text_optional(response)
    tool_calls = ai_client.extract_tool_calls(response)

    # An act turn needs BOTH a write_page_copy tool_call AND non-degenerate args
    # (G3); dispatch returns None on any degenerate/off-page/unknown call → talk.
    ctx = tools.WritePageCopyContext(
        page_index=req.page.pageIndex, template_id=req.page.templateId
    )
    result: tools.ToolResult | None = None
    for call in tool_calls:
        result = tools.dispatch(call, ctx=ctx)
        if result is not None:
            break

    duration_ms = int((time.monotonic() - started) * 1000)
    usage = Usage(
        durationMs=duration_ms,
        planningInputTokens=prompt_tokens,
        planningOutputTokens=completion_tokens,
        models=V2Models(planning=settings.deepseek_model),
    )

    if result is not None and result.tool == "write_page_copy":
        page_write = V2DraftPageWrite(
            pageIndex=result.payload["pageIndex"],
            texts=result.payload["texts"],
        )
        log.info(
            "draft_edit.call.act",
            page_index=page_write.pageIndex,
            slots=len(page_write.texts),
            duration_ms=duration_ms,
        )
        return V2DraftEditResponse(
            kind="act",
            assistantReply=_act_confirmation(req, model_text),
            pageWrite=page_write,
            usage=usage,
        )

    # Talk turn: no (valid) tool call, or G3 demoted a degenerate one. The reply
    # must be non-empty (contract min_length=1); fall back to a neutral line.
    reply = model_text or (
        "好的。" if req.language == "zh" else "Okay."
    )
    log.info("draft_edit.call.talk", had_tool_call=bool(tool_calls), duration_ms=duration_ms)
    return V2DraftEditResponse(
        kind="talk",
        assistantReply=reply[:500],
        pageWrite=None,
        usage=usage,
    )
