"""V3 image-leaning focused-page edit: recognition model emits a structured
INTENT (which photos sit on the page, in what order); the deterministic engine
(`skeleton_v3.pick_template_v3` / `assign_images_v3`) executes it (WP2.3 / #187).

It is invoked by `chapter_chat_v3` ONLY when the per-turn DeepSeek dispatch
classified the focused-page edit as 涉及图片(换图 / 挪图 / 改图文配比). The V3 image
edit is implemented on top of the V3 deterministic engine here.

图文分流 (§4.2(3) / architecture §6.8 第 2 条):

  * 纯文字 turn → DeepSeek rewrites the focused page's texts. NEVER reaches this
    module, so the recognition (vision) model is never invoked for a text-only
    edit. `chapter_chat_v3` owns that path (`_coerce_edit_patch`).
  * 涉及图片 turn → the recognition model is upgraded in, but it emits ONLY a
    structured intent: the ordered list of `photoId`s that should occupy the
    focused page (drawn strictly from THIS chapter's photos). It NEVER emits a
    `templateId` or a `pageIndex`. The deterministic engine then:
      - picks a legal template for that photo count (`pick_template_v3`, exact
        capacity preferred else closest-larger), and
      - slots the chosen photos in declaration order (`assign_images_v3`).
    A photoId outside the chapter is dropped; an empty / unusable intent yields
    None so the caller degrades to a talk turn rather than fabricate a layout.

触发权在用户 (§4.2(3)): this only ever runs in response to THIS turn's user
message — never a proactive re-layout. The vision model is hallucinate-proof by
construction: it cannot inject an illegal templateId (the engine picks it) nor
move a different page (it only ever sees / answers for the focused page).

Stateless / privacy (§3): the intent call sends ONLY text — the focused page's
current photo placement + the chapter's photo scene sentences + the user's
message. NO base64, NO GPS/place. The scene sentences were already authored by
the recognition model in WP1.3; nothing new about the pixels is round-tripped.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from ...logging_config import get_logger
from ...schemas import Page, V3Chapter, V3LayoutPatchEntry
from ...settings import get_settings
from ...prompts import load_prompt
from ... import ai_client
from ...engine import skeleton_v3
from ...vision_provider import (
    VisionSlot,
    VisionSlotError,
    ark_vision_slot,
    openai_vision_slot,
)

_PROMPT_DIR = Path(__file__).resolve().parent

log = get_logger("chat_edit_v3")

# Every focused page in 章节故事 is an interior body page; the legal candidate
# pool is therefore always the interior category (cover/toc/ending are owned by
# later stages, never edited here).
_INTERIOR: skeleton_v3.Category = "interior"


class ChatEditV3Error(Exception):
    """The image-edit intent step failed in a way that must degrade to a talk turn.

    Never surfaced as a hard error — an image edit that the model/engine cannot
    satisfy returns no patch, and `chapter_chat_v3` answers with a talk reply
    asking the user to clarify (never fabricates a layout)."""


# ---------- intent slot (vision provider) ------------------------------------


def _intent_slot(settings: Any) -> VisionSlot:
    """Reuse the describe-content provider policy: OpenAI (GPT-5.5 Mini) primary,
    火山 doubao failover (architecture §6.8 第 2 条). The intent call is text-only,
    so either slot works; pick the primary when configured, else ark. Raises
    ChatEditV3Error when neither is configured (caller degrades to talk)."""
    try:
        return openai_vision_slot(
            settings,
            timeout_seconds=settings.describe_openai_timeout_seconds,
            model=settings.describe_openai_model,
        )
    except VisionSlotError:
        pass
    try:
        return ark_vision_slot(settings)
    except VisionSlotError as exc:
        raise ChatEditV3Error(f"no image-edit intent slot configured: {exc}") from exc


# ---------- prompt assembly ---------------------------------------------------


def _max_interior_capacity() -> int:
    """Largest photo count any interior template can hold — the hard ceiling the
    model's intent is clamped to before the engine ever sees it."""
    return skeleton_v3.max_capacity(_INTERIOR)


def _build_user_content(
    chapter: V3Chapter, page: Page, user_message: str
) -> str:
    """Compact text manifest for the intent call. Carries the chapter's photos (id
    + scene sentence), which photos currently sit on the focused page (so 挪图 /
    换图 is grounded), the capacity ceiling, and the user's request. NO base64, NO
    GPS/place — only text the recognition model already authored (§3 privacy)."""
    photo_lines = "\n".join(
        f"    - {p.photoId}: {p.sceneDescription or '(no description)'}"
        for p in chapter.photos
    )
    current_ids = list(page.images.values())
    current = ", ".join(current_ids) if current_ids else "(none)"
    capacity = _max_interior_capacity()
    return (
        f"Chapter: {chapter.description or '(no description)'}\n\n"
        f"All photos available in this chapter (use these exact photoId values):\n"
        f"{photo_lines}\n\n"
        f"Photos currently on the page being edited, in order: {current}\n\n"
        f"The user's request for THIS page:\n{user_message}\n\n"
        f"A page can hold at most {capacity} photo(s). "
        'Return {"photoIds":[...]} — the ordered list of photoIds that should be on '
        "this page after the change, taken ONLY from the chapter photos above. Do "
        "NOT return a templateId, a pageIndex, or any layout id; the system places "
        "the photos and picks the layout."
    )


def _parse_intent(parsed: Any) -> list[str]:
    """Ordered photoId list from the model's JSON. Tolerant: ignores non-string /
    empty ids and de-dupes (a photo can sit in only one slot). The caller filters
    against the chapter's real photoIds and clamps to capacity, so a drifted model
    can never place a phantom photo or overflow the page."""
    if not isinstance(parsed, dict):
        raise ChatEditV3Error("image-edit intent response is not a JSON object")
    raw = parsed.get("photoIds")
    if not isinstance(raw, list):
        raise ChatEditV3Error("image-edit intent response missing photoIds[] array")
    seen: set[str] = set()
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        pid = item.strip()
        if not pid or pid in seen:
            continue
        seen.add(pid)
        out.append(pid)
    return out


async def _call_model(slot: VisionSlot, manifest: str) -> list[str]:
    messages = [
        {"role": "system", "content": load_prompt(_PROMPT_DIR / "edit_image_intent.md")},
        {"role": "user", "content": manifest},
    ]
    try:
        response = await ai_client.chat_completion(
            base_url=slot.base_url,
            api_key=slot.api_key,
            model=slot.model,
            messages=messages,
            timeout_seconds=slot.timeout_seconds,
            temperature=0.2,
            max_tokens=512,
            response_format=slot.response_format,
            extra_body=slot.extra_body,
        )
    except ai_client.AIRequestError as exc:
        raise ChatEditV3Error(f"image-edit intent upstream call failed: {exc}") from exc
    try:
        raw_text = ai_client.extract_text(response)
        parsed = ai_client.parse_json_loose(raw_text)
    except ValueError as exc:
        raise ChatEditV3Error(f"image-edit intent response unparseable: {exc}") from exc
    return _parse_intent(parsed)


# ---------- deterministic execution ------------------------------------------


def _ground_intent(chapter: V3Chapter, photo_ids: list[str]) -> list[str]:
    """Keep only photoIds that actually belong to THIS chapter, in the model's
    order, de-duped (a photo can occupy only one slot) and clamped to the interior
    capacity ceiling. Drops phantom ids (model hallucination), collapses repeats,
    and trims overflow. The engine never sees an illegal or duplicated photo —
    enforced here so BOTH the real intent call and an injected one are grounded."""
    chapter_ids = {p.photoId for p in chapter.photos}
    grounded: list[str] = []
    seen: set[str] = set()
    for pid in photo_ids:
        if pid in chapter_ids and pid not in seen:
            seen.add(pid)
            grounded.append(pid)
    capacity = _max_interior_capacity()
    return grounded[:capacity] if capacity > 0 else []


def _execute_intent(page: Page, photo_ids: list[str]) -> V3LayoutPatchEntry | None:
    """Run the deterministic engine on a grounded photoId list → a full-page patch.

    Picks a legal interior template for the photo count (`pick_template_v3`: exact
    capacity preferred, else closest-larger) and slots the photos in order
    (`assign_images_v3`). The model never supplied the templateId — it is legal by
    construction. Texts are carried over verbatim (an image change does not rewrite
    copy; pure-text edits own that path). Returns None when there is nothing to
    place."""
    if not photo_ids:
        return None
    try:
        template_id = skeleton_v3.pick_template_v3(_INTERIOR, len(photo_ids))
        images = skeleton_v3.assign_images_v3(template_id, photo_ids)
    except ValueError as exc:
        # No interior template can hold the requested count → degrade to talk.
        log.warning("chat_edit_v3.no_template", reason=str(exc), count=len(photo_ids))
        return None
    return V3LayoutPatchEntry(
        pageIndex=page.pageIndex,
        templateId=template_id,
        images=images,
        # Carry existing texts that still have a home on the new template. An image
        # change keeps the user's words; copy rewrites are the pure-text edit path.
        texts=_carried_texts(page.texts, template_id),
    )


def _carried_texts(old_texts: dict[str, str], template_id: str) -> dict[str, str]:
    """Keep only the old page's texts whose slot id still exists on the new
    template (a re-template can change the slot set). Mirrors v2's reflow guard
    without the v2 machinery: a dropped slot's text is simply not carried."""
    from src.engine import templates

    template = templates.get(template_id)
    if template is None:
        return {}
    allowed = set(templates.text_slot_ids(template))
    return {key: value for key, value in old_texts.items() if key in allowed}


# ---------- public API --------------------------------------------------------


async def run_image_edit(
    chapter: V3Chapter,
    page: Page,
    user_message: str,
    *,
    call_intent: Any = None,
) -> V3LayoutPatchEntry | None:
    """Resolve an image-leaning focused-page edit into a deterministic layout patch.

    The recognition model emits an ordered photoId intent; the deterministic engine
    picks a legal template and slots the photos. NEVER raises: a failed/missing
    provider, an unparseable response, a phantom-only intent, or an oversize
    request all return None so `chapter_chat_v3` degrades to a talk turn (never
    fabricates a layout).

    `call_intent` lets tests inject the intent call (`async (manifest) -> list[str]`)
    so no real vision model is hit; production resolves the slot + provider policy.
    """
    manifest = _build_user_content(chapter, page, user_message)
    try:
        if call_intent is not None:
            photo_ids = await call_intent(manifest)
        else:
            settings = get_settings()
            slot = _intent_slot(settings)
            # Bound the call by the describe budget so a slow model can't hang the
            # 60s sync turn; on timeout we degrade to talk.
            photo_ids = await asyncio.wait_for(
                _call_model(slot, manifest),
                timeout=settings.describe_batch_deadline_seconds,
            )
    except (ChatEditV3Error, asyncio.TimeoutError) as exc:
        log.warning("chat_edit_v3.degrade", reason=str(exc))
        return None
    except Exception as exc:  # noqa: BLE001 — never hard-fail the turn
        log.warning("chat_edit_v3.degrade_unhandled", reason=str(exc))
        return None

    grounded = _ground_intent(chapter, photo_ids)
    patch = _execute_intent(page, grounded)
    if patch is not None:
        log.info(
            "chat_edit_v3.ok",
            page_index=page.pageIndex,
            template_id=patch.templateId,
            photo_count=len(grounded),
        )
    return patch
