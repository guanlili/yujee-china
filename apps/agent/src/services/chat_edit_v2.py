"""Stage 6 · v2 edit service (rebuild-tech-plan §1.5 / design.md §13).

A superset of the v1 chat-edit pipeline that operates on the finalized flat
`LayoutV2` and adds the deterministic pickTemplate "tool":

- A single DeepSeek call produces a `layoutPatch` (minimal, page-level edits).
- Re-templating ("换版") is owned by the Agent, not the model: when the user
  asks to change a page's layout, the model flags the page with
  ``{"pageIndex": i, "retemplate": true}`` and the deterministic skeleton engine
  (``skeleton.pick_template`` / ``assign_images`` — rebuild-tech-plan §4.3)
  picks a legal templateId + image assignment. The model never invents a
  templateId for a re-template, so the candidate is legal by construction.
- The patch is applied to the layout and the WHOLE layout is re-validated with
  ``validate_v2`` (the §4.3 business rules with the v2 tweaks: pages bound
  [1, 48]; the fill-in-hero hard rule is exempted for the cover and ending
  pages only — §4.4 — never for chapter pages; every photoId used at most
  twice; cover detected by ``template.category == 'cover'``).
- One repair attempt; a second failure raises ``V2EditError`` (the route maps
  it to 502 ``AGENT_CHAT_FAILED``).

The same flat layout shape backs both new v2 albums and legacy v1 albums, so
this service edits both with one code path (rebuild-tech-plan §6 / §1.5).
"""

from __future__ import annotations

import json
import time
from collections import Counter
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import ValidationError

from ..logging_config import get_logger
from ..schemas import Page, PhotoAnalysis
from ..schemas_v2 import (
    LayoutV2,
    Usage,
    V2EditRequest,
    V2EditResponse,
    V2LayoutPatchEntry,
    V2Models,
)
from ..settings import get_settings
from .. import templates as registry
from . import ai_client, layout_rules, skeleton

log = get_logger("chat_edit_v2")

CompleteFn = Callable[..., Awaitable[dict[str, Any]]]

# v2 page bound: layout.ts has no upper bound, the [1, 48] cap is the Agent-side
# safety net (rebuild-tech-plan §5.2 / M2). LayoutV2 already enforces it on
# construction; kept here for the readable rule message.
_MAX_PAGES = 48


class V2EditError(Exception):
    """Maps to AGENT_CHAT_FAILED (HTTP 502)."""


def _system_prompt() -> str:
    return (
        "You are the art director editing a finalized memoir photo album in "
        "response to a user message. The album is a FLAT layout: a list of "
        "pages, each with a templateId, images (slotKey -> photoId) and texts "
        "(slotKey -> string). Output STRICT JSON only (no code fences):\n"
        "{\n"
        '  "assistantReply": short user-facing message (<=500 chars, same language as the user),\n'
        '  "layoutPatch": [ {\n'
        '      "pageIndex": int,                       // an existing page\n'
        '      "retemplate"?: true,                    // ask the system to pick a fresh layout for this page\n'
        '      "templateId"?: string,                  // ONLY for an explicitly named template\n'
        '      "images"?: { slotKey: photoId },\n'
        '      "texts"?: { slotKey: string }\n'
        "  } ]\n"
        "}\n\n"
        "HARD RULES:\n"
        "  1. layoutPatch is the MINIMUM set of page-level changes needed.\n"
        "  2. Do NOT add or remove pages — only modify existing pageIndex values from the current layout.\n"
        "  3. Do NOT introduce photoIds that are not already in currentLayout.photos.\n"
        "  4. To change a page's LAYOUT or template, set \"retemplate\": true and the system will pick a\n"
        "     valid template and re-place that page's photos for you — do NOT pick a templateId yourself.\n"
        "     Optionally include \"images\" to choose which photoIds go on the re-templated page.\n"
        "  5. Set \"templateId\" directly ONLY when the user names a specific template; then you MUST also\n"
        "     supply the full \"images\" and \"texts\" for that template's slots.\n"
        "  6. After applying your patch, every business rule must still hold: page 0 is a cover, pageIndex\n"
        "     stays sequential from 0, every photoId is used at least once and at most twice, no photoId\n"
        "     repeats on one page, no fill-grade photo in a hero slot (cover/ending pages excepted), slot\n"
        "     keys exist on the chosen template, and every image slot is filled.\n"
        "  7. Use templateIds and slot keys from the TemplateRegistry only.\n\n"
        "SOFT GUIDANCE: orientation is preferred, not required; the renderer center-covers mismatches. "
        "Keep text near each slot's recommended length, but length is not a hard rule.\n"
        "FOCUS: if the payload has \"focusedPageIndex\", the user has SELECTED that page in the editor — a "
        "deictic request (\"change this\", \"this page\", \"改这里/这一页\") targets that page. Patch it unless "
        "the user clearly names a different page.\n\n"
        "TemplateRegistry (id [category] images / texts):\n"
        f"{registry.summarize_for_prompt()}\n"
    )


def _user_payload(req: V2EditRequest) -> str:
    payload: dict[str, Any] = {
        "language": req.language,
        "currentLayout": req.currentLayout.model_dump(),
        "history": [h.model_dump() for h in req.history],
        "userMessage": req.userMessage,
    }
    # The page the user has selected in the editor. When present, a deictic message
    # ("change this", "make this bigger", "改这里/改这一页") refers to this page —
    # default the patch to it unless the user names another page explicitly.
    if req.focusedPageIndex is not None:
        payload["focusedPageIndex"] = req.focusedPageIndex
    return json.dumps(payload, ensure_ascii=False)


# --------------------------------------------------------------------------- #
# parsing                                                                      #
# --------------------------------------------------------------------------- #


def _coerce_response(parsed: Any) -> tuple[str, list[dict[str, Any]]]:
    """Pull (assistantReply, raw layoutPatch entries) out of the model JSON.

    Entries are kept as raw dicts here because a ``retemplate`` flag is part of
    the input protocol, not of the typed ``V2LayoutPatchEntry`` response — it is
    resolved into a concrete templateId+images+texts by ``_resolve_entries``."""
    if not isinstance(parsed, dict):
        raise V2EditError(f"edit response not an object (got {type(parsed).__name__})")
    reply = str(parsed.get("assistantReply") or "").strip()
    patch_raw = parsed.get("layoutPatch")
    if not reply:
        raise V2EditError("edit response missing assistantReply")
    if not isinstance(patch_raw, list) or not patch_raw:
        raise V2EditError("edit response missing layoutPatch[]")

    entries: list[dict[str, Any]] = []
    for idx, item in enumerate(patch_raw):
        if not isinstance(item, dict):
            raise V2EditError(f"layoutPatch[{idx}] not an object")
        try:
            page_index = int(item["pageIndex"])
        except (KeyError, TypeError, ValueError) as exc:
            raise V2EditError(f"layoutPatch[{idx}] missing/invalid pageIndex: {exc}") from exc
        if page_index < 0:
            raise V2EditError(f"layoutPatch[{idx}] pageIndex {page_index} is negative")
        images = item.get("images")
        texts = item.get("texts")
        if images is not None and not isinstance(images, dict):
            raise V2EditError(f"layoutPatch[{idx}] images must be an object")
        if texts is not None and not isinstance(texts, dict):
            raise V2EditError(f"layoutPatch[{idx}] texts must be an object")
        entries.append(
            {
                "pageIndex": page_index,
                "retemplate": bool(item.get("retemplate")),
                "templateId": item.get("templateId"),
                "images": images,
                "texts": texts,
            }
        )
    return reply[:500], entries


# --------------------------------------------------------------------------- #
# re-template (the pickTemplate tool)                                          #
# --------------------------------------------------------------------------- #


def _use_case_for_page(template_id: str) -> str:
    """Same useCase mapping the skeleton engine uses (rebuild-tech-plan §4.1):
    mag-02 is the TOC, cover/closing categories map to themselves, everything
    else is a chapter body page."""
    tpl = registry.get(template_id)
    if template_id == "mag-02":
        return "toc"
    if tpl and tpl["category"] == "cover":
        return "cover"
    if tpl and tpl["category"] == "closing":
        return "closing"
    return "chapter"


def _reflow_texts(old_texts: dict[str, str], new_template_id: str) -> dict[str, str]:
    """Carry the page's existing copy into the new template's text slots by
    position, clamped to each slot's maxChars. Slots beyond the old copy are
    left empty (the user can fill them); extra old copy is dropped. Keeping only
    the new template's own slot keys guarantees the slot-key subset rule."""
    tpl = registry.get(new_template_id)
    if not tpl:
        return {}
    reflowed = {
        slot: value
        for slot, value in zip(tpl["textSlots"].keys(), old_texts.values())
    }
    return layout_rules.clamp_texts_for_template(new_template_id, reflowed)


def _retemplate_entry(
    current: LayoutV2,
    page: Page,
    entry: dict[str, Any],
    *,
    album_id: str,
    attempt: int,
) -> V2LayoutPatchEntry:
    """Resolve a ``retemplate`` request into a concrete patch entry via the
    deterministic pickTemplate engine. The page keeps its current photos (or the
    photoIds the model chose in ``entry['images']``); pickTemplate excludes the
    current template so the layout actually changes, falling back to the legal
    pool when no alternative exists (e.g. the lone closing template)."""
    photos_by_id = {p.photoId: p for p in current.photos}
    requested = entry.get("images")
    if isinstance(requested, dict) and requested:
        photo_ids = list(requested.values())
    else:
        photo_ids = list(page.images.values())

    photos: list[dict[str, Any]] = []
    for pid in photo_ids:
        photo = photos_by_id.get(pid)
        if photo is None:
            raise V2EditError(
                f"page {page.pageIndex}: retemplate references photoId {pid} not in photos[]"
            )
        photos.append(photo.model_dump())

    use_case = _use_case_for_page(page.templateId)
    # Hero protection is exempt on the cover and ending pages — by POSITION, the
    # same basis validate_v2 uses (§4.4), so the engine never refuses a placement
    # the validator would accept.
    exempt_hero = page.pageIndex in (0, len(current.pages) - 1)
    try:
        new_template_id = skeleton.pick_template(
            use_case,
            len(photos),
            photos,
            exclude={page.templateId},
            album_id=album_id,
            chapter_id=f"edit:{page.pageIndex}",
            page_ordinal=page.pageIndex,
            attempt=attempt,
        )
        images = skeleton.assign_images(
            new_template_id, photos, allow_fill_in_hero=exempt_hero
        )
    except ValueError as exc:
        raise V2EditError(f"page {page.pageIndex}: retemplate failed: {exc}") from exc

    # Same-template fallback (e.g. the lone closing template): keep the page's
    # exact texts so a no-op reroll doesn't rekey copy by position (_reflow_texts
    # is positional and only meaningful across DIFFERENT templates).
    if new_template_id == page.templateId:
        texts = layout_rules.clamp_texts_for_template(new_template_id, dict(page.texts))
    else:
        texts = _reflow_texts(page.texts, new_template_id)

    return V2LayoutPatchEntry(
        pageIndex=page.pageIndex,
        templateId=new_template_id,
        images=images,
        texts=texts,
    )


def _resolve_entries(
    current: LayoutV2,
    raw_entries: list[dict[str, Any]],
    *,
    album_id: str,
    attempt: int,
) -> list[V2LayoutPatchEntry]:
    """Turn raw model entries into concrete, schema-valid ``V2LayoutPatchEntry``:
    re-template flags go through the pickTemplate engine; manual edits keep the
    model's templateId/images and have their texts clamped to the effective
    template (the new templateId if the model changed one, else the page's)."""
    by_index = {p.pageIndex: p for p in current.pages}
    resolved: list[V2LayoutPatchEntry] = []
    for entry in raw_entries:
        page = by_index.get(entry["pageIndex"])
        if page is None:
            raise V2EditError(
                f"patch targets pageIndex {entry['pageIndex']} which does not exist"
            )

        if entry["retemplate"]:
            resolved.append(
                _retemplate_entry(current, page, entry, album_id=album_id, attempt=attempt)
            )
            continue

        texts = entry["texts"]
        if texts is not None:
            effective_template = entry["templateId"] or page.templateId
            texts = layout_rules.clamp_texts_for_template(effective_template, texts)
        try:
            resolved.append(
                V2LayoutPatchEntry(
                    pageIndex=entry["pageIndex"],
                    templateId=entry["templateId"],
                    images=entry["images"],
                    texts=texts,
                )
            )
        except ValidationError as exc:
            raise V2EditError(
                f"layoutPatch entry for page {entry['pageIndex']} failed schema: {exc}"
            ) from exc
    return resolved


# --------------------------------------------------------------------------- #
# apply + validate                                                             #
# --------------------------------------------------------------------------- #


def _apply_patch(current: LayoutV2, patch: list[V2LayoutPatchEntry]) -> LayoutV2:
    """Apply resolved patch entries to a copy of the layout. An entry that
    carries a COMPLETE page (templateId + images + texts all present — every
    re-template, and every model-issued template change) replaces the page
    wholesale, so the applied layout matches the returned patch exactly. A
    templateId change without a full spec is rejected (old slot keys no longer
    apply); partial edits replace images wholesale when given and merge texts.
    """
    by_index = {p.pageIndex: p for p in current.pages}
    next_pages: list[Page] = [p.model_copy(deep=True) for p in current.pages]

    for entry in patch:
        original = by_index.get(entry.pageIndex)
        if original is None:
            raise V2EditError(
                f"patch targets pageIndex {entry.pageIndex} which does not exist"
            )

        complete = (
            entry.templateId is not None
            and entry.images is not None
            and entry.texts is not None
        )
        if complete:
            new_page = Page(
                pageIndex=entry.pageIndex,
                templateId=entry.templateId,
                images=dict(entry.images),
                texts=dict(entry.texts),
            )
        elif entry.templateId and entry.templateId != original.templateId:
            raise V2EditError(
                f"page {entry.pageIndex}: templateId change requires both images and texts"
            )
        else:
            new_images = dict(entry.images) if entry.images is not None else dict(original.images)
            new_texts = dict(original.texts)
            if entry.texts is not None:
                new_texts.update(entry.texts)
            new_page = Page(
                pageIndex=entry.pageIndex,
                templateId=original.templateId,
                images=new_images,
                texts=new_texts,
            )

        for i, p in enumerate(next_pages):
            if p.pageIndex == entry.pageIndex:
                next_pages[i] = new_page
                break

    try:
        return LayoutV2(
            magazine=current.magazine,
            photos=current.photos,
            pages=next_pages,
        )
    except ValidationError as exc:
        raise V2EditError(f"patched layout schema failed: {exc.errors()[:1]}") from exc


def validate_v2(layout: LayoutV2) -> str | None:
    """The §4.3 business rules with the v2 adjustments (rebuild-tech-plan §5.2):

    1. pages bound [1, 48] (vs v1's [1, 16]).
    2. page 0 must be a cover-category template (``category == 'cover'``).
    3. pageIndex strictly 0..N-1.
    4. templates and slot keys exist; every image slot is filled.
    5. fill-grade photos may not sit in a hero slot — EXCEPT on the cover and
       ending pages, which have no alternative template (§4.4 hero exemption).
    6. every photoId is referenced at least once and at most twice.

    Returns the first violation as a human-readable string, or None."""
    pages = layout.pages
    photos = layout.photos
    photo_ids = {p.photoId for p in photos}
    by_id: dict[str, PhotoAnalysis] = {p.photoId: p for p in photos}
    last_index = len(pages) - 1

    if not (1 <= len(pages) <= _MAX_PAGES):
        return f"pages count {len(pages)} outside supported range 1..{_MAX_PAGES}"

    first_tpl = registry.get(pages[0].templateId)
    if not first_tpl:
        return f"page 0 templateId {pages[0].templateId} not in TemplateRegistry"
    if first_tpl["category"] != "cover":
        return (
            f"page 0 templateId {pages[0].templateId} category={first_tpl['category']} "
            "(must be cover)"
        )

    for expected_idx, page in enumerate(pages):
        if page.pageIndex != expected_idx:
            return f"pageIndex {page.pageIndex} at position {expected_idx} (must be sequential)"

    used_counts: Counter[str] = Counter()
    for position, page in enumerate(pages):
        tpl = registry.get(page.templateId)
        if not tpl:
            return f"page {page.pageIndex}: templateId {page.templateId} not in TemplateRegistry"

        for slot in page.images.keys():
            if slot not in tpl["imageSlots"]:
                return f"page {page.pageIndex}: image slot '{slot}' not in template {page.templateId}"
        for slot in page.texts.keys():
            if slot not in tpl["textSlots"]:
                return f"page {page.pageIndex}: text slot '{slot}' not in template {page.templateId}"
        for slot in tpl["imageSlots"]:
            if slot not in page.images:
                return f"page {page.pageIndex}: missing image slot '{slot}' in template {page.templateId}"

        hero_exempt = position in (0, last_index)
        seen_on_page: set[str] = set()
        for slot, pid in page.images.items():
            if pid not in photo_ids:
                return f"page {page.pageIndex}: photoId {pid} not in photos[]"
            if pid in seen_on_page:
                return f"page {page.pageIndex}: photoId {pid} used twice on same page"
            seen_on_page.add(pid)
            used_counts[pid] += 1

            if not hero_exempt:
                constraint = tpl["imageSlots"][slot]
                if not layout_rules._quality_ok(by_id[pid], constraint):
                    return (
                        f"page {page.pageIndex} slot '{slot}': "
                        f"fill photo {pid} cannot be placed in hero slot "
                        f"(slot quality {constraint.get('quality')})"
                    )

    unused = [pid for pid in photo_ids if used_counts[pid] == 0]
    if unused:
        return f"unused photos: {unused[:3]}"

    overused = [pid for pid, c in used_counts.items() if c > 2]
    if overused:
        return f"photos reused more than 2 times: {overused[:3]}"

    return None


# --------------------------------------------------------------------------- #
# orchestration                                                               #
# --------------------------------------------------------------------------- #


async def _complete(
    messages: list[dict[str, str]],
    *,
    complete: CompleteFn | None,
) -> dict[str, Any]:
    if complete is not None:
        return await complete(messages=messages)

    settings = get_settings()
    if not settings.deepseek_api_key:
        raise V2EditError("DEEPSEEK_API_KEY missing; cannot run edit")
    return await ai_client.chat_completion(
        base_url=settings.deepseek_base_url,
        api_key=settings.deepseek_api_key,
        model=settings.deepseek_model,
        messages=messages,
        timeout_seconds=settings.deepseek_timeout_seconds,
        response_format={"type": "json_object"} if settings.deepseek_use_json_object else None,
        temperature=0.3,
        max_tokens=4096,
        extra_body=(
            {"thinking": {"type": "disabled"}} if settings.deepseek_disable_thinking else None
        ),
    )


async def run(req: V2EditRequest, *, complete: CompleteFn | None = None) -> V2EditResponse:
    settings = get_settings()
    started = time.monotonic()

    log.info(
        "chat_edit_v2.call.start",
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
            response = await _complete(messages, complete=complete)
        except ai_client.AIRequestError as exc:
            raise V2EditError(f"edit upstream call failed: {exc}") from exc
        pt, ct = ai_client.extract_usage(response)
        total_prompt += pt
        total_completion += ct

        try:
            raw_text = ai_client.extract_text(response)
            parsed = ai_client.parse_json_loose(raw_text)
            reply, raw_entries = _coerce_response(parsed)
            patch = _resolve_entries(
                req.currentLayout, raw_entries, album_id=req.albumId, attempt=attempt
            )
            patched = _apply_patch(req.currentLayout, patch)
        except (ValueError, V2EditError, ValidationError) as exc:
            last_error = str(exc)[:300]
            log.warning("chat_edit_v2.parse_failed", attempt=attempt, error=last_error)
            continue

        rule_violation = validate_v2(patched)
        if rule_violation:
            last_error = f"business rule violation: {rule_violation}"
            log.warning("chat_edit_v2.rules_failed", attempt=attempt, error=last_error)
            continue

        duration_ms = int((time.monotonic() - started) * 1000)
        log.info(
            "chat_edit_v2.call.ok",
            attempt=attempt,
            duration_ms=duration_ms,
            patch_size=len(patch),
            repair_attempts=repair_attempts,
        )
        return V2EditResponse(
            layoutPatch=patch,
            assistantReply=reply,
            usage=Usage(
                durationMs=duration_ms,
                planningInputTokens=total_prompt,
                planningOutputTokens=total_completion,
                repairAttempts=repair_attempts,
                models=V2Models(planning=settings.deepseek_model),
            ),
        )

    raise V2EditError(f"edit failed after repair: {last_error}")
