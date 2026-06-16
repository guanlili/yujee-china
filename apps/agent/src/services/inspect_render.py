"""Vision diagnosis of a mis-positioned photo (#165 Phase 2).

After draft-edit returns kind="inspect", the browser renders + screenshots the
page and posts it to POST /v2/album/inspect-page. This service runs ONE vision
call (火山 Ark `doubao-seed-1-6-vision`, the SAME model + key + image-input
format init's vision.py uses) to look at the rendered page and decide whether a
photo's subject/face is cropped, and how to nudge it.

Graceful failure is the contract: vision error / unparseable JSON / a slot the
model invented all degrade to a diagnosis with problem="unable to inspect" and
confidence 0, so the caller answers with a plain talk message instead of crashing.
A hard upstream failure surfaces as InspectError → AGENT_VISION_FAILED/502 only as
a last resort (mirrors vision.py / submit_edit).

Privacy: the screenshot base64 is passed into the upstream HTTP body and the
local reference is then dropped; we never log it or hand it back (invariant 1,
same posture as the init vision call)."""

from __future__ import annotations

import time
from typing import Any

from ..logging_config import get_logger
from ..schemas_v2 import (
    Usage,
    V2InspectDiagnosis,
    V2InspectRequest,
    V2InspectResponse,
    V2Models,
)
from ..settings import get_settings
from . import ai_client

log = get_logger("inspect_render")


class InspectError(Exception):
    """Hard inspect failure → AGENT_VISION_FAILED (HTTP 502). Used only as a last
    resort; normal vision/parse failures degrade gracefully (see _unable)."""


# Injected `complete` mirrors the other services' test seam: same kwargs as
# ai_client.chat_completion, returns the raw OpenAI-compatible envelope.
CompleteFn = Any


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _system_prompt() -> str:
    return (
        "You inspect ONE rendered page of a memoir photo album to diagnose whether "
        "a photo is badly positioned inside its frame — e.g. a face or main subject "
        "is cut off at an edge, or the framing crops out something important.\n\n"
        "Output STRICT JSON only (no code fences, no commentary), an object with "
        "EXACTLY these keys:\n"
        '  "imageId": the slot id of the offending image. It MUST be one of the '
        "page's image slot ids listed below; if you cannot identify a real "
        "mis-positioned slot, set it to null.\n"
        '  "problem": one short sentence describing what is cut off / wrong (English '
        "or the reader's language).\n"
        '  "suggestedDx": number in [-50, 50] — percentage-point horizontal shift. '
        "Negative reveals more of the LEFT of the photo, positive more of the RIGHT.\n"
        '  "suggestedDy": number in [-50, 50] — percentage-point vertical shift. '
        "Negative reveals more of the TOP (use this when a face/head is cut at the "
        "top), positive more of the BOTTOM.\n"
        '  "suggestedScale": number in [1.0, 2.0] — 1.0 = no zoom; zoom in only when '
        "tighter framing genuinely helps.\n"
        '  "confidence": number in [0, 1] — how sure you are the page is mis-cropped.\n\n'
        "If the page looks fine, return imageId=null, a brief problem note, zero "
        "shifts, scale 1.0, and a low confidence."
    )


def _user_content(req: V2InspectRequest) -> list[dict[str, Any]]:
    slot_lines = "\n".join(
        f"  - slotId={slot} -> photoId={photo_id}" for slot, photo_id in req.page.images.items()
    ) or "  (no image slots on this page)"
    desc_by_id = {p.photoId: p.description for p in req.photos}
    subject_lines = "\n".join(
        f"  - photoId={pid}: {desc_by_id.get(pid, '(no description)')}"
        for pid in req.page.images.values()
    ) or "  (no photos)"
    text = (
        f"templateId={req.page.templateId}, pageIndex={req.page.pageIndex}.\n"
        "Image slots on this page (use one of these exact slotIds as imageId):\n"
        f"{slot_lines}\n\n"
        "What each photo shows (to help you name the cropped subject):\n"
        f"{subject_lines}\n\n"
        f"The user complained: {req.userMessage!r}\n\n"
        "Look at the rendered page image below and diagnose the crop. "
        'Return {"imageId":..,"problem":..,"suggestedDx":..,"suggestedDy":..,'
        '"suggestedScale":..,"confidence":..}.'
    )
    return [
        {"type": "text", "text": text},
        {"type": "image_url", "image_url": {"url": req.screenshot}},
    ]


def _unable(reason: str) -> V2InspectDiagnosis:
    """A graceful no-op diagnosis: imageId null, zero shift, confidence 0 — the
    caller degrades to a talk message. `reason` is logged, not returned."""
    log.info("inspect.unable", reason=reason)
    return V2InspectDiagnosis(
        imageId=None,
        problem="unable to inspect",
        suggestedDx=0.0,
        suggestedDy=0.0,
        suggestedScale=1.0,
        confidence=0.0,
    )


def _coerce(parsed: Any, slot_ids: set[str]) -> V2InspectDiagnosis:
    """Clamp + validate the model's JSON into a diagnosis. Invalid imageId → null
    (and a graceful 'unable to inspect'); bad shapes degrade rather than raise."""
    if not isinstance(parsed, dict):
        return _unable("vision response not a JSON object")

    raw_id = parsed.get("imageId")
    image_id: str | None
    if isinstance(raw_id, str) and raw_id in slot_ids:
        image_id = raw_id
    else:
        image_id = None

    # No real slot to act on → degrade to the graceful no-op (caller talks).
    if image_id is None:
        return _unable("vision returned no valid imageId")

    def _num(key: str, default: float) -> float:
        val = parsed.get(key)
        try:
            return float(val)
        except (TypeError, ValueError):
            return default

    problem = str(parsed.get("problem") or "").strip() or "photo may be mis-positioned"
    dx = _clamp(_num("suggestedDx", 0.0), -50.0, 50.0)
    dy = _clamp(_num("suggestedDy", 0.0), -50.0, 50.0)
    scale = _clamp(_num("suggestedScale", 1.0), 1.0, 2.0)
    confidence = _clamp(_num("confidence", 0.0), 0.0, 1.0)

    return V2InspectDiagnosis(
        imageId=image_id,
        problem=problem[:200],
        suggestedDx=dx,
        suggestedDy=dy,
        suggestedScale=scale,
        confidence=confidence,
    )


def _reply(diagnosis: V2InspectDiagnosis, language: str) -> str:
    """A short user-facing line accompanying the diagnosis."""
    if diagnosis.imageId is None:
        return "我看了这一页,没发现明显的裁切问题。" if language == "zh" else (
            "I looked at the page and didn't spot an obvious cropping problem."
        )
    return "我看了这一页,来调整一下这张照片。" if language == "zh" else (
        "I took a look at the page — let me adjust that photo."
    )


async def diagnose(
    req: V2InspectRequest, *, complete: CompleteFn | None = None
) -> V2InspectResponse:
    """Run ONE vision call to diagnose a reported crop. Never raises on vision /
    parse failure (degrades to an 'unable to inspect' diagnosis); only a hard,
    unexpected upstream error path would raise InspectError."""
    settings = get_settings()
    started = time.monotonic()
    slot_ids = set(req.page.images.keys())

    log.info(
        "inspect.call.start",
        album_id=req.albumId,
        page_index=req.page.pageIndex,
        slots=len(slot_ids),
        language=req.language,
    )

    messages = [
        {"role": "system", "content": _system_prompt()},
        {"role": "user", "content": _user_content(req)},
    ]

    prompt_tokens = 0
    completion_tokens = 0
    diagnosis: V2InspectDiagnosis
    try:
        if complete is not None:
            response = await complete(messages=messages)
        else:
            if not settings.ark_api_key:
                raise ai_client.AIRequestError("ARK_API_KEY missing; cannot run vision inspect")
            response = await ai_client.chat_completion(
                base_url=settings.ark_base_url,
                api_key=settings.ark_api_key,
                model=settings.ark_vision_model,
                messages=messages,
                timeout_seconds=settings.ark_timeout_seconds,
                temperature=0.1,
                max_tokens=512,
                extra_body={"thinking": {"type": "disabled"}},
            )
        # Drop our handle to the messages (with the screenshot base64) before parsing.
        messages = []  # noqa: F841
        del messages

        prompt_tokens, completion_tokens = ai_client.extract_usage(response)
        try:
            raw_text = ai_client.extract_text(response)
            parsed = ai_client.parse_json_loose(raw_text)
        except ValueError as exc:
            diagnosis = _unable(f"vision response unparseable: {exc}")
        else:
            diagnosis = _coerce(parsed, slot_ids)
    except ai_client.AIRequestError as exc:
        # Upstream vision failure → graceful no-op (caller talks). We do NOT raise:
        # a mis-positioned-photo diagnosis failing should never break the turn.
        log.warning("inspect.vision_failed", error=str(exc))
        diagnosis = _unable(f"vision upstream call failed: {exc}")

    duration_ms = int((time.monotonic() - started) * 1000)
    log.info(
        "inspect.call.ok",
        image_id=diagnosis.imageId,
        confidence=diagnosis.confidence,
        duration_ms=duration_ms,
    )
    return V2InspectResponse(
        diagnosis=diagnosis,
        assistantReply=_reply(diagnosis, req.language),
        usage=Usage(
            durationMs=duration_ms,
            visionCallCount=1,
            planningInputTokens=prompt_tokens,
            planningOutputTokens=completion_tokens,
            models=V2Models(vision=settings.ark_vision_model),
        ),
    )
