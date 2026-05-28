"""Synchronous chat-edit pipeline (docs/agent/design.md §13).

Single DeepSeek call → LayoutPatch entries → apply to currentLayout →
validate the resulting layout against AlbumLayoutPlan schema + 9 business
rules. One repair attempt; on second failure raise ChatEditError (route
maps to 502 AGENT_CHAT_FAILED)."""

import json
import time
from typing import Any

from pydantic import ValidationError

from ..logging_config import get_logger
from ..schemas import (
    AlbumLayoutPlan,
    ChatEditRequest,
    ChatEditResponse,
    ChatEditUsage,
    LayoutPatchEntry,
    Page,
)
from ..settings import get_settings
from .. import templates as registry
from . import ai_client, layout_rules

log = get_logger("chat_edit")


class ChatEditError(Exception):
    """Maps to AGENT_CHAT_FAILED (HTTP 502)."""


def _system_prompt() -> str:
    return (
        "You are the art director editing a memoir photo album in response to a user message. "
        "Output STRICT JSON only (no code fences):\n"
        "{\n"
        '  "assistantReply": short user-facing message (<=500 chars, same language as the user),\n'
        '  "layoutPatch": [ { "pageIndex": int, "templateId"?: string, '
        '"images"?: { slotKey: photoId }, "texts"?: { slotKey: string } } ]\n'
        "}\n\n"
        "HARD RULES:\n"
        "  1. layoutPatch is the MINIMUM set of page-level changes needed.\n"
        "  2. Do NOT add or remove pages — only modify existing pageIndex values from the current layout.\n"
        "  3. Do NOT introduce photoIds that are not already in currentLayout.photos.\n"
        "  4. If you change templateId for a page, the patch MUST replace ALL images and texts for that page\n"
        "     (omit fields you want unchanged ONLY if templateId stays the same).\n"
        "  5. After applying your patch, every business rule (cover-first, sequential pageIndex,\n"
        "     orientation+quality slot fit, every photoId used, no >2 reuse, slot keys exist on the chosen\n"
        "     template, text fits maxChars) must still hold.\n"
        "  6. Use templateIds and slot keys from the TemplateRegistry only.\n\n"
        "TemplateRegistry (id [category] images / texts):\n"
        f"{registry.summarize_for_prompt()}\n"
    )


def _user_payload(req: ChatEditRequest) -> str:
    return json.dumps(
        {
            "language": req.language,
            "currentLayout": req.currentLayout.model_dump(),
            "history": [h.model_dump() for h in req.history],
            "userMessage": req.userMessage,
        },
        ensure_ascii=False,
    )


def _coerce_patch(parsed: Any) -> tuple[str, list[LayoutPatchEntry]]:
    if not isinstance(parsed, dict):
        raise ChatEditError(f"chat response not an object (got {type(parsed).__name__})")
    reply = str(parsed.get("assistantReply") or "").strip()
    patch_raw = parsed.get("layoutPatch")
    if not reply:
        raise ChatEditError("chat response missing assistantReply")
    if not isinstance(patch_raw, list) or not patch_raw:
        raise ChatEditError("chat response missing layoutPatch[]")

    entries: list[LayoutPatchEntry] = []
    for idx, item in enumerate(patch_raw):
        if not isinstance(item, dict):
            raise ChatEditError(f"layoutPatch[{idx}] not an object")
        try:
            entries.append(
                LayoutPatchEntry(
                    pageIndex=int(item["pageIndex"]),
                    templateId=item.get("templateId"),
                    images=item.get("images"),
                    texts=item.get("texts"),
                )
            )
        except (KeyError, ValidationError, ValueError, TypeError) as exc:
            raise ChatEditError(f"layoutPatch[{idx}] failed schema: {exc}") from exc

    return reply[:500], entries


def _apply_patch(
    current: AlbumLayoutPlan,
    patch: list[LayoutPatchEntry],
) -> AlbumLayoutPlan:
    by_index: dict[int, Page] = {p.pageIndex: p for p in current.pages}
    next_pages: list[Page] = [p.model_copy(deep=True) for p in current.pages]
    next_by_index = {p.pageIndex: p for p in next_pages}

    for entry in patch:
        if entry.pageIndex not in by_index:
            raise ChatEditError(
                f"patch targets pageIndex {entry.pageIndex} which does not exist"
            )
        original = next_by_index[entry.pageIndex]

        if entry.templateId and entry.templateId != original.templateId:
            # Template change: require full images+texts replacement
            if entry.images is None or entry.texts is None:
                raise ChatEditError(
                    f"page {entry.pageIndex}: templateId change requires both images and texts"
                )
            new_page = Page(
                pageIndex=entry.pageIndex,
                templateId=entry.templateId,
                images=dict(entry.images),
                texts=dict(entry.texts),
            )
        else:
            new_images = dict(original.images)
            new_texts = dict(original.texts)
            if entry.images is not None:
                # Replace whole image map when provided (slot keys may differ).
                new_images = dict(entry.images)
            if entry.texts is not None:
                new_texts.update(entry.texts)
            new_page = Page(
                pageIndex=entry.pageIndex,
                templateId=original.templateId,
                images=new_images,
                texts=new_texts,
            )

        # Replace in place
        for i, p in enumerate(next_pages):
            if p.pageIndex == entry.pageIndex:
                next_pages[i] = new_page
                break

    try:
        return AlbumLayoutPlan(
            magazine=current.magazine,
            photos=current.photos,
            pages=next_pages,
        )
    except ValidationError as exc:
        raise ChatEditError(f"patched layout schema failed: {exc.errors()[:1]}") from exc


async def run(req: ChatEditRequest) -> ChatEditResponse:
    settings = get_settings()
    if not settings.deepseek_api_key:
        raise ChatEditError("DEEPSEEK_API_KEY missing; cannot run chat-edit")

    started = time.monotonic()
    log.info(
        "chat_edit.call.start",
        album_id=req.albumId,
        history_len=len(req.history),
        language=req.language,
    )

    base_messages = [
        {"role": "system", "content": _system_prompt()},
        {"role": "user", "content": _user_payload(req)},
    ]

    repair_attempts = 0
    last_error: str | None = None
    total_prompt = 0
    total_completion = 0

    for attempt in range(2):  # initial + 1 repair
        messages = list(base_messages)
        if attempt == 1 and last_error:
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Your previous response failed validation:\n"
                        f"{last_error}\n"
                        "Re-issue the full JSON with assistantReply and a corrected layoutPatch. "
                        "Re-verify every HARD RULE before responding."
                    ),
                }
            )
            repair_attempts += 1

        try:
            response = await ai_client.chat_completion(
                base_url=settings.deepseek_base_url,
                api_key=settings.deepseek_api_key,
                model=settings.deepseek_model,
                messages=messages,
                timeout_seconds=settings.deepseek_timeout_seconds,
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=2048,
            )
        except ai_client.AIRequestError as exc:
            # Network exhausted both internal attempts — surface as AGENT_CHAT_FAILED.
            raise ChatEditError(f"chat-edit upstream call failed: {exc}") from exc
        pt, ct = ai_client.extract_usage(response)
        total_prompt += pt
        total_completion += ct

        try:
            raw_text = ai_client.extract_text(response)
            parsed = ai_client.parse_json_loose(raw_text)
            reply, patch = _coerce_patch(parsed)
            patched = _apply_patch(req.currentLayout, patch)
        except (ValueError, ChatEditError, ValidationError) as exc:
            last_error = str(exc)[:300]
            log.warning("chat_edit.parse_failed", attempt=attempt, error=last_error)
            continue

        rule_violation = layout_rules.violation(patched)
        if rule_violation:
            last_error = f"business rule violation: {rule_violation}"
            log.warning("chat_edit.rules_failed", attempt=attempt, error=last_error)
            continue

        duration_ms = int((time.monotonic() - started) * 1000)
        log.info(
            "chat_edit.call.ok",
            attempt=attempt,
            duration_ms=duration_ms,
            patch_size=len(patch),
            repair_attempts=repair_attempts,
        )
        return ChatEditResponse(
            layoutPatch=patch,
            assistantReply=reply,
            usage=ChatEditUsage(
                durationMs=duration_ms,
                planningInputTokens=total_prompt,
                planningOutputTokens=total_completion,
                repairAttempts=repair_attempts,
                model=settings.deepseek_model,
            ),
        )

    raise ChatEditError(f"chat-edit failed after repair: {last_error}")
