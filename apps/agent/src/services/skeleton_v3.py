"""V3 deterministic template-selection + image-assignment engine.

This is the V3 path of the deterministic engine (issue #179 / WP0.4). It is a
*new* code path that coexists with the v2 `skeleton.py` engine — the v2 engine
and its quality/hero/scene logic stay untouched until the v1/v2 teardown
(WP6.1 / #197).

The V3 engine is **purely category + image-slot-count driven** (docs/agent/
v3-requirements.md §9 / docs/agent/v3-implementation-plan.md §3 WP0.4):

  * NO photo quality, NO hero protection, NO orientation hard rule, NO scene
    narrowing. Mismatched aspect ratios are absorbed by center-cover rendering at
    draw time, never rejected here.
  * Templates are pooled by their V3 `category` (cover | interior | toc |
    ending), NOT by `slot` (mag-02 is slot=interior but category=toc — pooled by
    category). Within a category, templates are indexed by image-slot count.
  * `select-template` (WP1.4) lets the vision model pick from the *legal
    candidates* this engine exposes (`legal_candidates`); when the LLM call fails
    the deterministic fallback (`pick_template_v3` / `build_page_v3`) picks a
    template whose image-slot count can hold the N photos and slots them in
    order. "10 photos → pick a template that holds 10, slot them in order."

The repeat group (`items`) lets one template hold a variable number of photos:
its declared `images` slots (e.g. ``cells[0].image`` .. ``cells[k].image``) are
the addressable capacity. We treat the flat declared image-slot ids as the
capacity and assign photos to them in declaration order.
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

from src import templates


# V3 template categories. mag-02 is slot=interior but category=toc — the V3
# engine pools strictly by category so category != slot is handled correctly.
Category = str


def template_category(template: templates.TemplateDef) -> Category:
    """The V3 category a template belongs to.

    Prefers the V3 ``category`` field; falls back to the legacy ``slot`` only for
    transitional templates that have not declared a category yet (the loader
    guarantees at least one classification exists). ``slot`` has no ``toc`` value,
    so a slot-only template can never masquerade as toc — exactly the mag-02
    distinction the V3 contract draws."""
    category = template.get("category")
    if category:
        return category
    slot = template.get("slot")
    if slot == "cover":
        return "cover"
    if slot == "ending":
        return "ending"
    return "interior"


def image_capacity(template: templates.TemplateDef) -> int:
    """How many distinct photos a template can hold = its declared image-slot
    count. Bracket-path repeat-group slots (``cells[0].image`` …) are already
    enumerated in ``images`` by the loader, so this is just the slot count."""
    return len(template["images"])


def _build_pools() -> dict[Category, dict[int, list[str]]]:
    """category -> image-capacity -> sorted template ids.

    Deterministic: ids sorted within each bucket so fallback selection is stable
    across runs and processes."""
    pools: dict[Category, dict[int, list[str]]] = {}
    for template_id in templates.TEMPLATE_IDS:
        template = templates.TEMPLATES[template_id]
        category = template_category(template)
        capacity = image_capacity(template)
        pools.setdefault(category, {}).setdefault(capacity, []).append(template_id)
    for by_capacity in pools.values():
        for ids in by_capacity.values():
            ids.sort()
    return pools


# category -> imageCount -> [templateId]; built once from the registry.
POOLS: dict[Category, dict[int, list[str]]] = _build_pools()


def candidate_ids(category: Category, image_count: int) -> list[str]:
    """Templates in `category` whose image-slot count is exactly `image_count`.

    Exact-capacity helper used by tests and callers that need no underfilled
    slots. `legal_candidates` is the select-template API and includes larger
    capacities that can still hold N photos. Sorted for determinism."""
    return list(POOLS.get(category, {}).get(image_count, []))


def legal_candidates(category: Category, image_count: int) -> list[dict[str, Any]]:
    """Legal candidate descriptors for select-template (WP1.4 / V3TemplateCandidate).

    Each entry is shaped like V3TemplateCandidate:
    ``{"templateId": ..., "category": ..., "imageSlotCount": ...}``.
    The legal set is every template in the target category whose image capacity
    can hold N photos. Exact-capacity templates appear first, followed by larger
    capacities in ascending order; ids are stable-sorted inside each bucket.
    """
    out: list[dict[str, Any]] = []
    for capacity in _fallback_capacities(category, image_count):
        for template_id in POOLS.get(category, {}).get(capacity, []):
            out.append(
                {
                    "templateId": template_id,
                    "category": category,
                    "imageSlotCount": capacity,
                }
            )
    return out


def _fallback_capacities(category: Category, image_count: int) -> list[int]:
    """Capacities to try for the fallback, best-fit first.

    §9 fallback: pick a template whose image-slot count can hold the N photos —
    "== N or the closest capacity that is >= N". We try exact N first, then the
    next-larger capacities in ascending order (smallest waste first). Capacities
    below N are never used (they cannot hold all N photos)."""
    available = sorted(POOLS.get(category, {}).keys())
    exact = [c for c in available if c == image_count]
    larger = [c for c in available if c > image_count]
    return exact + larger


def pick_template_v3(category: Category, image_count: int) -> str:
    """Deterministic fallback template pick for `image_count` photos in `category`.

    Pure code, no quality/hero/orientation/scene. Picks a template whose image
    capacity can hold all N photos — exact capacity preferred, else the closest
    larger one — and returns its id (first in the sorted bucket, stable).

    Raises ValueError when no template in the category can hold N photos (e.g.
    asking for more photos than any interior template declares)."""
    for capacity in _fallback_capacities(category, image_count):
        bucket = POOLS.get(category, {}).get(capacity)
        if bucket:
            return bucket[0]
    raise ValueError(
        f"no V3 template in category={category!r} can hold {image_count} image(s)"
    )


def _photo_id(photo: Mapping[str, Any] | str) -> str:
    if isinstance(photo, str):
        return photo
    value = photo.get("photoId")
    if not isinstance(value, str) or not value:
        raise ValueError("photo must carry a non-empty photoId")
    return value


def assign_images_v3(
    template_id: str, photos: Sequence[Mapping[str, Any] | str]
) -> dict[str, str]:
    """Slot photos into `template_id` in declaration order — no matching.

    §9: "slot them in order." Each template image slot (in declaration order)
    receives the next photo's id. NO quality/hero/orientation matching;
    aspect-ratio mismatch is the renderer's center-cover concern, not ours.

    `photos` may be photo-id strings or mappings carrying ``photoId``. The number
    of photos must not exceed the template's image capacity. Extra slots (when a
    closest-larger template was picked) are left unfilled — the V3 renderer shows
    only the filled slots; the deterministic fallback only ever picks a capacity
    >= N so every photo is placed."""
    template = templates.get(template_id)
    if template is None:
        raise ValueError(f"unknown template id: {template_id}")
    slot_ids = templates.image_slot_ids(template)
    if len(photos) > len(slot_ids):
        raise ValueError(
            f"template {template_id} holds {len(slot_ids)} image(s); got {len(photos)}"
        )
    return {slot_id: _photo_id(photo) for slot_id, photo in zip(slot_ids, photos)}


def max_capacity(category: Category) -> int:
    """Largest image-slot count any template in `category` declares (0 when the
    category has none). The body partitioner uses the interior max to decide how
    many photos can share one page."""
    capacities = POOLS.get(category, {}).keys()
    return max(capacities, default=0)


def partition_photos_v3(
    photos: Sequence[Mapping[str, Any] | str],
    *,
    category: Category = "interior",
) -> list[list[Mapping[str, Any] | str]]:
    """Split a chapter's photos into per-page chunks the fallback can place.

    §9 fallback intent — "pick a template that holds the photos, slot them in
    order" — generalized to a library whose templates top out at a finite image
    capacity: pack photos greedily into chunks no larger than the category's
    biggest template, so every chunk maps to exactly one fallback template (exact
    capacity preferred, else closest larger). With the current interior max of 4,
    a 10-photo chapter becomes 4 + 4 + 2. Returns at least one (possibly empty)
    list only when given photos; empty input yields ``[]``."""
    items = list(photos)
    if not items:
        return []
    chunk = max_capacity(category)
    if chunk <= 0:
        raise ValueError(f"no V3 template in category={category!r} holds any image")
    return [items[i : i + chunk] for i in range(0, len(items), chunk)]


def build_page_v3(
    category: Category,
    photos: Sequence[Mapping[str, Any] | str],
    *,
    template_id: str | None = None,
    page_index: int = 0,
) -> dict[str, Any]:
    """Build one flat V3 page dict for `photos` in `category`.

    When `template_id` is given (e.g. the model's select-template choice) it is
    used as-is; otherwise the deterministic fallback picks one. Returns a plain
    dict shaped like `schemas.Page` (pageIndex/templateId/images/texts) with
    empty texts — generic copy/colors are layered on later (WP1.5 / finalize)."""
    image_count = len(photos)
    chosen = template_id or pick_template_v3(category, image_count)
    return {
        "pageIndex": page_index,
        "templateId": chosen,
        "images": assign_images_v3(chosen, photos),
        "texts": {},
    }


def build_skeleton_v3(chapters: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Deterministic V3 skeleton: one interior page per chapter holding that
    chapter's photos, plus a flat page list with sequential `pageIndex`.

    This is the pure-code fallback the analyze pipeline (WP1.1/1.4) falls back to
    when the select-template LLM call fails: every chapter becomes an interior
    page whose template can hold its photo count, photos slotted in order. Cover
    is OPTIONAL in V3 (not forced as page 0) — analyze/cover stages (WP4.1) add it
    separately, so this builds only the body pages.

    A chapter with more photos than the largest interior template holds is split
    across several interior pages (`partition_photos_v3`), each filled by a
    fallback template that can hold its chunk.

    `chapters` is a sequence of mappings each carrying ``photos`` (a sequence of
    photo-id strings or mappings with ``photoId``). Returns a flat list of page
    dicts with sequential pageIndex."""
    pages: list[dict[str, Any]] = []
    for chapter in chapters:
        photos = list(chapter.get("photos", []))
        if not photos:
            continue
        for chunk in partition_photos_v3(photos, category="interior"):
            pages.append(build_page_v3("interior", chunk, page_index=len(pages)))
    return pages
