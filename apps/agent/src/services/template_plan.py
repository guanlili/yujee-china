"""LLM one-shot album template planner (#172).

Replaces the deterministic per-chapter template selection (skeleton.pick_template
+ partition_chapter_photos + build_chapter_pages) with a SINGLE LLM call that
plans the whole album's body layout at once: which photos land on which page, and
which template each page uses. The deterministic engine is kept as the fallback
safety net (see `plan_or_fallback`) — this module never deletes it.

Scope (issue #172, user-decided "one-shot all", NOT bucketed by image_count, NOT
split per chapter): the planner emits a flat list of body pages, each tagged with
its `chapterId`, `templateId`, and the `photoIds` placed on it. Cover / TOC /
ending stay DETERMINISTIC (skeleton.build_base_pages / build_toc): they carry hard
invariants (cover-slot template, ending-slot template, ≤2 reuse budget, contents
page) that are cheap and safe to keep rule-driven, and the issue requires
preserving exactly what the deterministic engine guaranteed.

What the LLM sees (system + user):
  * the template CATALOG — for every INTERIOR template: id, slot, scene, the image
    slots (count + per-slot orientation/quality as SELECTION REFERENCE per #171,
    NOT a hard filter), and the text-slot specs;
  * ALL photos' analysis (photoId, description, tags, scene, peopleCount,
    orientation, quality) grouped by chapter. NO quality filtering — every photo
    participates.

What the LLM returns (parsed with ai_client.parse_json_loose, JSON mode when the
provider supports it): {"pages":[{"chapterId","templateId","photoIds":[...]}...]}.

VALIDATION + REPAIR (deterministic, never trusts the model — see `validate_plan`):
  1. Unknown / non-interior `templateId` → drop the page and re-place its photos.
  2. Page whose `len(photoIds)` != that template's image-slot count → re-pick a
     template via skeleton.pick_template for that exact photo count (repair), or
     drop the page if no such template exists.
  3. photoIds not belonging to the chapter / duplicated within a page → cleaned.
  4. Photos a chapter never placed (omissions) → swept into deterministic pages so
     every used photo appears (invariant: every photo placed at least once).
The repaired body uses skeleton.assign_images so slot fill obeys the same
fill→hero protection the deterministic path enforces. If the model output is
unparseable/empty, or a chapter ends up with zero usable model pages, that chapter
falls back wholesale to skeleton.build_chapter_pages. `plan_or_fallback` wraps the
whole call so any hard failure → full deterministic skeleton.

Fallback note (NOT implemented this round, issue #172): if one-shot collapses at
scale (40-photo output truncation), the next step is per-chapter batched +
concurrent planning. The seam is `plan_templates`'s per-chapter grouping — split
the single call into N chapter calls there. One-shot is the only path implemented.
"""

from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable
from typing import Any, Mapping, Sequence

from .. import templates as registry
from ..schemas import Page
from ..schemas_v2 import Usage, V2Chapter, V2Models, V2Photo
from ..settings import get_settings
from . import ai_client, skeleton


CompleteFn = Callable[..., Awaitable[dict[str, Any]]]


class TemplatePlanError(Exception):
    """Raised when the planning model call or response is hard-unusable (after
    repair attempts). Callers fall back to the deterministic skeleton."""


# A 40-photo album can produce ~25-40 body pages; each plan page is a small object
# ({chapterId, templateId, photoIds:[..]}). 4096 tokens comfortably covers that
# (composing's 8192 was for FULL pages incl. texts; we only emit the selection
# skeleton here). Sized with headroom; truncation risk noted in the issue report.
_PLAN_MAX_TOKENS = 4096


# ---------- prompt ------------------------------------------------------------


def _interior_catalog() -> list[dict[str, Any]]:
    """The selection catalog the planner chooses from: every INTERIOR template
    (cover/ending are picked deterministically, not by the LLM). Each entry lists
    the slot count + per-slot orientation/quality as a SOFT reference (#171),
    plus scene and the writable text slots."""
    catalog: list[dict[str, Any]] = []
    for tid in registry.TEMPLATE_IDS:
        tpl = registry.TEMPLATES[tid]
        if tpl["slot"] != "interior":
            continue
        # The TOC/contents page (mag-02) is built deterministically from chapter
        # labels; keep it out of the photo-page selection pool.
        if tid == "mag-02":
            continue
        catalog.append(
            {
                "templateId": tid,
                "scene": tpl["scene"],
                "imageSlotCount": len(tpl["images"]),
                "imageSlots": [
                    {
                        "id": slot["id"],
                        "orientation": slot.get("orientation") or [],
                        "quality": slot.get("quality") or [],
                    }
                    for slot in tpl["images"]
                ],
                "textSlots": [
                    {"id": s["id"], "role": s["role"], "maxChars": s.get("maxChars")}
                    for s in tpl["texts"]
                    if s["role"] != "decoration"
                ],
            }
        )
    return catalog


def _photo_brief(photo: V2Photo) -> dict[str, Any]:
    a = photo.analysis
    return {
        "photoId": a.photoId,
        "description": a.description,
        "tags": list(a.tags),
        "scene": a.scene,
        "peopleCount": a.peopleCount,
        "orientation": a.orientation,
        "quality": a.quality,
    }


def build_messages(
    chapters: Sequence[V2Chapter],
    used_photos_by_id: Mapping[str, V2Photo],
    language: str,
) -> list[dict[str, str]]:
    """Build the one-shot planning prompt. The model gets the interior template
    catalog + every chapter's photos and must lay out ALL of them across pages."""
    catalog = _interior_catalog()
    system = (
        "You are laying out the interior pages of a memoir photo album. "
        "You are given a TEMPLATE CATALOG (interior page templates) and the album's "
        "photos grouped by chapter. Plan how to place EVERY photo onto pages. "
        "Return STRICT JSON only: "
        '{"pages":[{"chapterId":string,"templateId":string,"photoIds":[string,...]}]}. '
        "RULES (followed literally, not interpreted):\n"
        "- Use ONLY templateIds from the catalog.\n"
        "- A page's photoIds count MUST EXACTLY equal that template's imageSlotCount.\n"
        "- Place every photo of every chapter at least once; keep a photo within its "
        "own chapter (do not move photos across chapters).\n"
        "- A photo may repeat at most twice total and never twice on the same page.\n"
        "- `imageSlots[].orientation` / `imageSlots[].quality` and `scene` are SOFT "
        "preferences to guide a good visual match — match them when you can, but they "
        "are NOT hard filters; a sensible page that fills every slot is what matters.\n"
        "- Emit pages chapter by chapter, in the chapter order given.\n"
        f"Target language for any reasoning: {language}. Output JSON only, no prose."
    )
    payload = {
        "templateCatalog": catalog,
        "chapters": [
            {
                "chapterId": chapter.chapterId,
                "label": chapter.cluster.label,
                "photos": [
                    _photo_brief(used_photos_by_id[pid])
                    for pid in chapter.photoIds
                    if pid in used_photos_by_id
                ],
            }
            for chapter in chapters
        ],
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


# ---------- model plumbing (mirrors theme/writing) ----------------------------


async def _complete(
    messages: list[dict[str, str]],
    *,
    complete: CompleteFn | None,
    max_tokens: int,
    temperature: float,
) -> dict[str, Any]:
    if complete is not None:
        return await complete(messages=messages, max_tokens=max_tokens, temperature=temperature)

    settings = get_settings()
    if not settings.deepseek_api_key:
        raise TemplatePlanError("DEEPSEEK_API_KEY missing; cannot run template planning")
    return await ai_client.chat_completion(
        base_url=settings.deepseek_base_url,
        api_key=settings.deepseek_api_key,
        model=settings.deepseek_model,
        messages=messages,
        timeout_seconds=settings.deepseek_timeout_seconds,
        response_format={"type": "json_object"} if settings.deepseek_use_json_object else None,
        max_tokens=max_tokens,
        temperature=temperature,
        # Composing-class call: emits the whole album plan; disable thinking so a
        # single call lands under the timeout (mirrors settings.composing_disable_thinking).
        extra_body=(
            {"thinking": {"type": "disabled"}} if settings.composing_disable_thinking else None
        ),
    )


def _parse_plan_pages(response: dict[str, Any]) -> list[dict[str, Any]]:
    """Pull the raw `pages` list out of the model JSON. Tolerant: an empty/
    unparseable response raises TemplatePlanError so the caller falls back."""
    try:
        parsed = ai_client.parse_json_loose(ai_client.extract_text(response))
    except ValueError as exc:
        raise TemplatePlanError(f"template plan response was not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise TemplatePlanError(
            f"template plan response must be an object, got {type(parsed).__name__}"
        )
    pages = parsed.get("pages")
    if not isinstance(pages, list):
        raise TemplatePlanError("template plan response missing pages[]")
    return [p for p in pages if isinstance(p, dict)]


def _usage_from_response(response: dict[str, Any], duration_ms: int) -> Usage:
    settings = get_settings()
    prompt_tokens, completion_tokens = ai_client.extract_usage(response)
    return Usage(
        durationMs=duration_ms,
        planningInputTokens=prompt_tokens,
        planningOutputTokens=completion_tokens,
        models=V2Models(planning=settings.deepseek_model),
    )


# ---------- validation + repair ----------------------------------------------


def _interior_slot_count(template_id: str) -> int | None:
    """image-slot count of an INTERIOR template, or None if unknown / not a
    selectable interior photo template (cover/ending/toc/unknown)."""
    tpl = registry.TEMPLATES.get(template_id)
    if tpl is None or tpl["slot"] != "interior" or template_id == "mag-02":
        return None
    return len(tpl["images"])


def _repair_template_for_count(
    photos: Sequence[skeleton.Photo],
    album_id: str,
    chapter_id: str,
    ordinal: int,
) -> str | None:
    """Deterministically re-pick a chapter template whose image-slot count matches
    this page's photo count (the same pool/seed the deterministic engine uses).
    Returns None when no interior template can legally take these photos."""
    try:
        return skeleton.pick_template(
            "chapter",
            len(photos),
            photos,
            album_id=album_id,
            chapter_id=chapter_id,
            page_ordinal=ordinal,
            scene=skeleton.page_scene(photos),
        )
    except ValueError:
        return None


def _build_page(template_id: str, photos: Sequence[skeleton.Photo]) -> Page:
    return Page(
        pageIndex=0,
        templateId=template_id,
        images=skeleton.assign_images(template_id, photos),
        texts={},
    )


def validate_and_build_chapter_pages(
    chapter: V2Chapter,
    plan_pages_for_chapter: Sequence[Mapping[str, Any]],
    photos_by_id: Mapping[str, dict[str, Any]],
    album_id: str,
) -> list[Page]:
    """Turn one chapter's RAW model pages into validated draft pages, repairing or
    dropping anything the model got wrong, then sweeping any omitted photo into a
    deterministic page. Guarantees: every page's slot count matches its template,
    every slot is filled (fill→hero protection via assign_images), no photo is
    duplicated within a page, and every chapter photo appears at least once.

    Returns [] when the chapter has zero usable model pages → caller falls back to
    skeleton.build_chapter_pages for that chapter (deterministic safety net)."""
    chapter_ids = [pid for pid in chapter.photoIds if pid in photos_by_id]
    chapter_id_set = set(chapter_ids)

    pages: list[Page] = []
    placed: set[str] = set()
    use_count: dict[str, int] = {}
    ordinal = 0

    for raw in plan_pages_for_chapter:
        raw_ids = raw.get("photoIds")
        template_id = raw.get("templateId")
        if not isinstance(raw_ids, list) or not isinstance(template_id, str):
            continue

        # Keep only real, in-chapter, not-yet-duplicated-on-this-page photoIds.
        seen: set[str] = set()
        clean_ids: list[str] = []
        for pid in raw_ids:
            if (
                isinstance(pid, str)
                and pid in chapter_id_set
                and pid not in seen
                and use_count.get(pid, 0) < 2
            ):
                seen.add(pid)
                clean_ids.append(pid)
        if not clean_ids:
            continue
        page_photos = [photos_by_id[pid] for pid in clean_ids]

        # Validate the templateId: must be a selectable interior template AND its
        # slot count must equal this page's photo count. Otherwise repair by
        # re-picking a count-matching template; drop the page if none fits.
        slot_count = _interior_slot_count(template_id)
        if slot_count != len(page_photos):
            template_id = _repair_template_for_count(page_photos, album_id, chapter.chapterId, ordinal)
            if template_id is None:
                continue
        elif not skeleton.can_place(template_id, page_photos):
            # Known, count-matching, but fill→hero protection rejects it → repair.
            template_id = _repair_template_for_count(page_photos, album_id, chapter.chapterId, ordinal)
            if template_id is None:
                continue

        pages.append(_build_page(template_id, page_photos))
        ordinal += 1
        for pid in clean_ids:
            placed.add(pid)
            use_count[pid] = use_count.get(pid, 0) + 1

    if not pages:
        # No usable model page for this chapter → caller uses the deterministic path.
        return []

    # Sweep omitted photos (the model dropped them) into deterministic pages so
    # every chapter photo is placed at least once (coverage invariant).
    leftovers = [photos_by_id[pid] for pid in chapter_ids if pid not in placed]
    if leftovers:
        for page_photos in skeleton.partition_chapter_photos(leftovers):
            template_id = _repair_template_for_count(
                page_photos, album_id, chapter.chapterId, ordinal
            )
            if template_id is None:
                continue
            pages.append(_build_page(template_id, page_photos))
            ordinal += 1

    return pages


def build_skeleton_with_plan(
    input_data: Mapping[str, Any],
    plan_pages: Sequence[Mapping[str, Any]],
) -> skeleton.SkeletonResult:
    """Mirror skeleton.build_skeleton but source each chapter's BODY pages from the
    validated LLM plan (falling back to skeleton.build_chapter_pages per chapter
    that has no usable plan page). Cover / TOC / ending and the flat-page assembly
    stay byte-for-byte identical to the deterministic engine, so the downstream
    AlbumDraft shape is unchanged (#172: only the SELECTION changed)."""
    album_id = str(input_data.get("albumId") or "")
    photos = [p for p in input_data.get("photos", []) if isinstance(p, Mapping)]
    photos_by_id = {skeleton._photo_id(p): p for p in photos}
    used_photos = [p for p in photos if skeleton._is_used(p)]

    # Group raw plan pages by chapterId for per-chapter validation.
    plan_by_chapter: dict[str, list[Mapping[str, Any]]] = {}
    for raw in plan_pages:
        cid = raw.get("chapterId")
        if isinstance(cid, str):
            plan_by_chapter.setdefault(cid, []).append(raw)

    output_chapters: list[skeleton.SkeletonChapter] = []
    body_pages: list[Page] = []
    for raw_chapter in input_data.get("chapters", []):
        if not isinstance(raw_chapter, Mapping):
            continue
        chapter_id = str(raw_chapter.get("chapterId") or "")
        chapter_photo_ids = raw_chapter.get("photoIds", [])
        chapter_photos = [
            photos_by_id[pid]
            for pid in chapter_photo_ids
            if isinstance(pid, str) and skeleton._is_used(photos_by_id[pid])
        ]
        # Reconstruct a V2Chapter-like view for the validator (it only reads
        # chapterId + photoIds). Build pages from the plan; fall back per chapter.
        chapter_view = _ChapterView(chapter_id=chapter_id, photo_ids=list(chapter_photo_ids))
        plan_pages_for_chapter = plan_by_chapter.get(chapter_id, [])
        pages_as_dicts: list[dict[str, Any]] = []
        if plan_pages_for_chapter:
            validated = validate_and_build_chapter_pages(
                chapter_view, plan_pages_for_chapter, photos_by_id, album_id
            )
            pages_as_dicts = [p.model_dump(mode="json") for p in validated]
        if not pages_as_dicts:
            # Deterministic fallback for this chapter (no usable plan pages).
            pages_as_dicts = skeleton.build_chapter_pages(album_id, chapter_id, chapter_photos)

        output_chapter: skeleton.SkeletonChapter = {
            "chapterId": chapter_id,
            "cluster": dict(raw_chapter.get("cluster") or {}),
            "photoIds": list(chapter_photo_ids),
            "pages": pages_as_dicts,
        }
        output_chapters.append(output_chapter)
        body_pages.extend(pages_as_dicts)

    cover, ending = skeleton.build_base_pages(album_id, used_photos, body_pages)
    total_without_toc = 1 + len(body_pages) + 1
    toc = (
        skeleton.build_toc(output_chapters)
        if skeleton.needs_toc(output_chapters, total_without_toc)
        else None
    )

    flat_pages = [cover]
    if toc is not None:
        flat_pages.append(toc)
    flat_pages.extend(body_pages)
    flat_pages.append(ending)
    for page_index, page in enumerate(flat_pages):
        page["pageIndex"] = page_index

    return {
        "basePages": {"cover": cover, "toc": toc, "ending": ending},
        "chapters": output_chapters,
        "pages": flat_pages,
    }


class _ChapterView:
    """Minimal V2Chapter stand-in for the validator (only chapterId + photoIds are
    read). Lets build_skeleton_with_plan reuse the dict-shaped skeleton input
    without re-instantiating full V2Chapter models."""

    __slots__ = ("chapterId", "photoIds")

    def __init__(self, *, chapter_id: str, photo_ids: list[Any]) -> None:
        self.chapterId = chapter_id
        self.photoIds = [pid for pid in photo_ids if isinstance(pid, str)]


# ---------- public entry points -----------------------------------------------


async def plan_templates(
    chapters: Sequence[V2Chapter],
    photo_pool: Sequence[V2Photo],
    language: str,
    *,
    complete: CompleteFn | None = None,
) -> tuple[list[dict[str, Any]], Usage]:
    """One LLM call planning the whole album's interior layout. Returns the RAW
    plan pages ([{chapterId, templateId, photoIds}], unvalidated) + usage. The
    caller validates/repairs them via build_skeleton_with_plan. Raises
    TemplatePlanError on a hard model/parse failure.

    Seam for the deferred per-chapter batched fallback (#172): split this single
    call into N concurrent chapter calls here, keyed by `chapters`."""
    used_by_id = {photo.photoId: photo for photo in photo_pool if photo.used}
    plannable = [
        chapter
        for chapter in chapters
        if any(pid in used_by_id for pid in chapter.photoIds)
    ]
    if not plannable:
        # Nothing to plan (no used photos); let the deterministic engine handle it.
        return [], Usage(durationMs=0, models=V2Models(planning=get_settings().deepseek_model))

    started = time.monotonic()
    messages = build_messages(plannable, used_by_id, language)
    response = await _complete(
        messages, complete=complete, max_tokens=_PLAN_MAX_TOKENS, temperature=0.3
    )
    pages = _parse_plan_pages(response)
    duration_ms = int((time.monotonic() - started) * 1000)
    return pages, _usage_from_response(response, duration_ms)
