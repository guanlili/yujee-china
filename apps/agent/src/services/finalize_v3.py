"""V3 deterministic finalize — V3 layout tree + pages -> flat AlbumLayoutPlan.

The V3 path of finalize (issue #179 / WP0.4). A *new* code path next to v2
`finalize.py`; the v2 finalize and its quality/hero/page0-cover rules stay
untouched until the v1/v2 teardown (WP6.1 / #197).

V3 finalize (docs/agent/v3-requirements.md §9 / §4.5; v3-implementation-plan §3
WP0.4) differs from v2 finalize:

  * **Cover is optional** — page 0 is NOT forced to be a cover-category
    template (covers can be skipped, §4.4). No "page 0 must be cover" rule.
  * **No quality / hero / orientation** — image slots carry none in V3, so there
    is no fill-in-hero check and no hero-slot protection. Aspect-ratio mismatch is
    the renderer's center-cover concern.
  * **Recognizes V3 template fields** — validation accepts ``svgs`` slots, the
    ``items`` repeat group, ``variableDecor`` flags, ``category``, chapter accent
    color and art font. Repeat-group content is addressed by the declared
    bracket-path slot ids (``cells[0].image``), already enumerated by the loader.

This WP delivers the V3 finalize *basis* (flatten + a V3-shaped validate). The
single merged validate (one path shared by finalize + edit) is WP5.1 — this is
the deterministic core it will build on, and it does not touch v2's
``finalize.validate_v2``.

Scope note: the external render contract ``AlbumLayoutPlan`` still carries the
legacy ``quality`` field on each photo (it mirrors @yujee/contracts
PhotoAnalysis, unchanged this WP). V3 input photos have no quality, so finalize
synthesizes a neutral ``"detail"`` quality on output — quality is inert in V3
(no hero protection consumes it). When the contract drops the field this synth
goes away.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from .. import templates as registry
from ..schemas import (
    AlbumLayoutPlan,
    LayoutPhotoAnalysis,
    Magazine,
    Page,
    V3FinalizeRequest,
)


# V3 flat-layout page bound (matches v2's [1, 48]; the flat schema also enforces
# >= 1). A V3 album with no pages cannot ship.
_MAX_PAGES = 48

# Repeat-group / bracket-path slot key, e.g. ``cells[0].image`` or ``titles[3]``.
# The part before the first ``[`` is the base slot the template declares (image
# slots are enumerated per-index by the loader; repeat text slots stay as the
# base key with a numeric index).
_BASE_SLOT_RE = re.compile(r"^([^\[]+)")

# Neutral inert quality for the external render contract (see module docstring).
_V3_OUTPUT_QUALITY = "detail"

_DEFAULT_TITLE = {"en": "Life in photographs", "zh": "照片里的时光"}


class FinalizeV3Error(Exception):
    """Raised when the flattened V3 layout fails validate_v3."""


def finalize_v3(request: V3FinalizeRequest) -> AlbumLayoutPlan:
    """Flatten a V3 layout tree + preview pages into the external AlbumLayoutPlan.

    Pure function (no LLM/network/DB). Steps:
      ① collect every photo referenced by the tree, shaped to the external
         render contract (synthesizing the inert legacy quality field);
      ② flatten the preview `pages` as-is (cover optional — no forced page 0),
         reindexing pageIndex sequentially;
      ③ build the magazine header from the language + first chapter;
      ④ hard-validate the flat layout (validate_v3) and raise on the first
         violation.
    """
    language = request.language

    photos = _collect_photos(request)
    pages = _flatten_pages(request.pages)
    magazine = _magazine(request, language)

    layout = AlbumLayoutPlan(magazine=magazine, photos=photos, pages=pages)

    problem = validate_v3(layout)
    if problem is not None:
        raise FinalizeV3Error(problem)
    return layout


# ---------- ① photos ----------------------------------------------------------


def _collect_photos(request: V3FinalizeRequest) -> list[LayoutPhotoAnalysis]:
    """Every distinct photo in the tree, in first-seen order, shaped for output.

    Description comes from the chapter photo's ``sceneDescription``; tags default
    empty (V3 has no tag dimension here); ``quality`` is the inert neutral value
    (see module docstring); orientation is carried through; focal is omitted (no
    focal dimension in the V3 chapter photo → renderer 50/50 default)."""
    out: list[LayoutPhotoAnalysis] = []
    seen: set[str] = set()
    for chapter in request.tree.chapters:
        for photo in chapter.photos:
            if photo.photoId in seen:
                continue
            seen.add(photo.photoId)
            out.append(
                LayoutPhotoAnalysis(
                    photoId=photo.photoId,
                    description=photo.sceneDescription,
                    tags=[],
                    quality=_V3_OUTPUT_QUALITY,
                    orientation=photo.orientation,
                )
            )
    return out


# ---------- ② flatten ---------------------------------------------------------


def _flatten_pages(pages: list[Page]) -> list[Page]:
    """Reindex the preview pages sequentially from 0, order preserved.

    Cover optionality lives here: we do NOT inject or require a cover page — the
    pages arrive in their authored order and we only renumber pageIndex so the
    flat layout is contiguous."""
    return [page.model_copy(update={"pageIndex": idx}) for idx, page in enumerate(pages)]


# ---------- ③ magazine header -------------------------------------------------


def _magazine(request: V3FinalizeRequest, language: str) -> Magazine:
    title = _first_nonempty_description(request) or _DEFAULT_TITLE.get(
        language, _DEFAULT_TITLE["en"]
    )
    return Magazine(
        title=_clamp(title, 60),
        subtitle=None,
        style="editorial",
        language=language,
    )


def _first_nonempty_description(request: V3FinalizeRequest) -> str:
    for chapter in request.tree.chapters:
        text = (chapter.description or "").strip()
        if text:
            return text
    return ""


def _clamp(text: str, max_chars: int) -> str:
    return text if len(text) <= max_chars else text[:max_chars].rstrip()


# ---------- ④ validate_v3 -----------------------------------------------------


def _base_slot(slot: str) -> str:
    match = _BASE_SLOT_RE.match(slot)
    return match.group(1) if match else slot


def validate_v3(layout: AlbumLayoutPlan) -> str | None:
    """V3 flat-layout hard rules. Returns the first violation as a human-readable
    string, or None when the layout is shippable.

    Differs from v2 ``finalize.validate_v2``:
      * NO "page 0 must be cover" rule — covers are optional in V3.
      * NO fill-in-hero / quality / orientation check — those dimensions are gone.
      * Recognizes V3 repeat-group / bracket-path slots, ``svgs`` and ``items``
        via the loader's declared slot ids.

    Enforced:
      * 1..48 pages, sequential pageIndex.
      * Every template id is known.
      * Every image/text slot key belongs to its template. V3 allows larger
        templates to be underfilled when a legal candidate only needs capacity
        >= N, so only present image keys are validated.
      * Bracket-path text keys are accepted only for declared repeat bases.
      * Every referenced photoId exists in photos[]; no photo twice on one page;
        no photo reused more than twice across the album; no unused photo.
    """
    pages = layout.pages
    photo_ids = {photo.photoId for photo in layout.photos}

    if not 1 <= len(pages) <= _MAX_PAGES:
        return f"pages count {len(pages)} outside supported range 1..{_MAX_PAGES}"

    for expected_idx, page in enumerate(pages):
        if page.pageIndex != expected_idx:
            return (
                f"pageIndex {page.pageIndex} at position {expected_idx} "
                f"(must be sequential)"
            )

    used_counts: Counter[str] = Counter()
    for page in pages:
        template = registry.get(page.templateId)
        if template is None:
            return f"page {page.pageIndex}: templateId {page.templateId} not in TemplateRegistry"

        image_by_id = registry.image_slot_map(template)
        text_by_id = registry.text_slot_map(template)

        for slot in page.images:
            if slot not in image_by_id:
                return (
                    f"page {page.pageIndex}: image slot '{slot}' not in "
                    f"template {page.templateId}"
                )
        for slot in page.texts:
            base = _base_slot(slot)
            text_slot = text_by_id.get(base)
            if text_slot is None:
                return (
                    f"page {page.pageIndex}: text slot '{slot}' not in "
                    f"template {page.templateId}"
                )
            if "[" in slot and not text_slot.get("repeat"):
                return (
                    f"page {page.pageIndex}: text slot '{slot}' is not a repeat "
                    f"slot in template {page.templateId}"
                )

        seen_on_page: set[str] = set()
        for slot, pid in page.images.items():
            if pid not in photo_ids:
                return f"page {page.pageIndex}: photoId {pid} not in photos[]"
            if pid in seen_on_page:
                return f"page {page.pageIndex}: photoId {pid} used twice on same page"
            seen_on_page.add(pid)
            used_counts[pid] += 1

    unused = [pid for pid in photo_ids if used_counts[pid] == 0]
    if unused:
        return f"unused photos: {sorted(unused)[:3]}"

    # Album-wide reuse cap: a photo may appear at most twice TOTAL. Unlike v2
    # (which exempts page 0 because page 0 is always the cover), V3 has an
    # optional cover, so there is no special first page — every placement counts.
    overused = [pid for pid, count in used_counts.items() if count > 2]
    if overused:
        return f"photos reused more than 2 times: {sorted(overused)[:3]}"

    return None
