"""V3 layout validator business rules. Used after composing and after applying
a patch. Returns the first violation as a human-readable string for the repair
prompt, or None if all pass."""

from collections import Counter
import re

from ..logging_config import get_logger
from ..schemas import AlbumLayoutPlan, Magazine, Page, PhotoAnalysis
from .. import templates as registry

log = get_logger("layout_rules")

# Architecture §6.5 decision 6: photo floor is ≥1. With ≤2 photos, builds bottom
# out in build_text_first_layout when the model can't compose a usable album.
FEW_PHOTO_MAX = 2


def _is_solo_category(tpl: registry.TemplateDef) -> bool:
    """cover / ending sit alone on a page (hero-exempt, not paired)."""
    return tpl["category"] in ("cover", "ending")

# Text-only spreads used to pad a few-photo album to the sanity floor, and as the
# Phase-4 swap target when a page's image slots can't be filled. A pad must carry
# NO image slots at all (top-level or in its repeat group) so dropping a page's
# images leaves nothing blank to render. Derived from the active registry because
# template edits may remove old IDs.
def _has_no_images(tpl: registry.TemplateDef) -> bool:
    return not tpl["images"] and not (tpl.get("items") or {}).get("images")


_TEXT_ONLY_PAD = tuple(
    tid
    for tid in registry.TEMPLATE_IDS
    if (tpl := registry.get(tid)) and _has_no_images(tpl)
)

_TEXT_ONLY_SPREAD = _TEXT_ONLY_PAD[0] if _TEXT_ONLY_PAD else "mag-02"

_ALL_ORIENTATIONS = ("portrait", "landscape", "square")
_ALL_QUALITIES = ("hero", "detail", "fill")
_REPEAT_TEXT_KEY_RE = re.compile(r"^([A-Za-z0-9_-]+)\[\d+\]$")


def _text_slot_constraint(tpl: registry.TemplateDef, slot: str) -> registry.TextSlot | None:
    text_by_id = registry.text_slot_map(tpl)
    cons = text_by_id.get(slot)
    if cons:
        return cons
    match = _REPEAT_TEXT_KEY_RE.fullmatch(slot)
    if not match:
        return None
    cons = text_by_id.get(match.group(1))
    if cons and cons.get("repeat"):
        return cons
    return None


def clamp_text(text: str, max_chars: int) -> str:
    """Trim text to <= max_chars, preferring the last word boundary within the
    limit (falling back to a hard cut). Only ever shortens."""
    if len(text) <= max_chars:
        return text
    hard = text[:max_chars].rstrip()
    space = hard.rfind(" ")
    if space >= max(1, int(max_chars * 0.6)):
        hard = hard[:space].rstrip()
    return hard


def clamp_texts_for_template(template_id: str, texts: dict[str, str]) -> dict[str, str]:
    """Return a copy of `texts` with each slot trimmed to the template's
    maxChars. Unknown template / slots pass through unchanged."""
    tpl = registry.get(template_id)
    if not tpl:
        return dict(texts)
    out = dict(texts)
    for slot, text in texts.items():
        cons = _text_slot_constraint(tpl, slot)
        if not cons:
            continue
        max_chars = cons.get("maxChars")
        if isinstance(max_chars, int):
            out[slot] = clamp_text(text, max_chars)
    return out


def clamp_page_texts(pages: list[Page]) -> list[Page]:
    """Deterministically trim each text slot to its template's maxChars.

    Real planning models (e.g. doubao-seed-lite) routinely overshoot a slot's
    maxChars by a few characters and ignore the repair feedback, which would
    otherwise fail Rule 9 and sink the whole generation over a purely cosmetic
    limit. This only ever shortens text and layout_rules enforces no minChars,
    so it can never introduce a new violation."""
    out: list[Page] = []
    for page in pages:
        new_texts = clamp_texts_for_template(page.templateId, page.texts)
        out.append(page.model_copy(update={"texts": new_texts}) if new_texts != page.texts else page)
    return out


def _quality_ok(photo: PhotoAnalysis, constraint: dict, *, hero_exempt: bool = False) -> bool:
    """Only hard slot quality rule: fill photos cannot occupy hero slots."""
    if hero_exempt:
        return True
    qualities = constraint.get("quality")
    if qualities and "hero" in qualities and photo.quality == "fill":
        return False
    return True


def _slot_orientations(constraint: dict) -> tuple[str, ...]:
    """Missing orientation hints mean the slot can accept any orientation."""
    return tuple(constraint.get("orientation") or _ALL_ORIENTATIONS)


def _slot_qualities(constraint: dict) -> tuple[str, ...]:
    """Missing quality hints mean the slot can accept any quality."""
    return tuple(constraint.get("quality") or _ALL_QUALITIES)


def _orientation_prefers(photo: PhotoAnalysis, constraint: dict) -> bool:
    """Soft preference used for deterministic tie-breaking, never validation."""
    return photo.orientation in _slot_orientations(constraint)


def _quality_prefers(photo: PhotoAnalysis, constraint: dict) -> bool:
    """Soft quality preference after hero protection has passed."""
    qualities = constraint.get("quality")
    if not qualities:
        return True
    if "hero" in qualities:
        return photo.quality == "hero"
    return photo.quality in qualities


def _photo_placeable(photo: PhotoAnalysis, constraint: dict, *, hero_exempt: bool = False) -> bool:
    return _quality_ok(photo, constraint, hero_exempt=hero_exempt)


# For each orientation, the qualities the registry can actually hold in SOME
# image slot. Computed once from the registry so it tracks template edits; the
# few-photo fallback uses it to relax a photo's quality before placing.
_PLACEABLE_QUALITIES: dict[str, set[str]] = {}
for _tpl in registry.TEMPLATES.values():
    for _cons in _tpl["images"]:
        for _o in _slot_orientations(_cons):
            _PLACEABLE_QUALITIES.setdefault(_o, set()).update(_slot_qualities(_cons))

# Preference order when we must demote a photo's quality to make it placeable:
# keep it as prominent as the registry allows.
_QUALITY_RANK = ("hero", "detail", "fill")


def _relax_to_placeable(photo: PhotoAnalysis) -> PhotoAnalysis:
    """Return `photo`, preserving hard fill→hero protection.

    Square hero is relaxed to detail: mag-09 can still hold it, and mag-10 grids
    then become fillable. Orientation is never changed (it reflects the real
    crop), and fill photos are not demoted to bypass hero-slot protection."""
    if photo.orientation == "square" and photo.quality == "hero":
        return photo.model_copy(update={"quality": "detail"})
    return photo


# Qualities a SINGLE-image (one-slot) non-cover template accepts, per orientation.
# The few-photo fallback places one photo per page in such a template (so no
# sibling slot is left empty). At least one single-image slot must remain
# non-hero detail/fill so a lone fill-grade photo has a legal home.
_SINGLE_IMAGE_QUALITIES: dict[str, set[str]] = {}
for _tpl in registry.TEMPLATES.values():
    if _tpl["category"] == "cover" or len(_tpl["images"]) != 1:
        continue
    (_cons,) = _tpl["images"]
    for _o in _slot_orientations(_cons):
        _SINGLE_IMAGE_QUALITIES.setdefault(_o, set()).update(_slot_qualities(_cons))


def _relax_for_single_image(photo: PhotoAnalysis) -> PhotoAnalysis:
    """Demote `photo`'s quality to the most prominent value a single-image
    template accepts for its orientation. Returns the photo unchanged when it
    already has a single-image home for its quality (every orientation now has
    one — square via mag-19), or, defensively, when no single-image template
    accepts that orientation at all."""
    accepts = _SINGLE_IMAGE_QUALITIES.get(photo.orientation, set())
    if photo.quality == "fill" or not accepts or photo.quality in accepts:
        return photo
    for q in _QUALITY_RANK:
        if q in accepts:
            return photo.model_copy(update={"quality": q})
    return photo


def _relax_for_few_photo(photo: PhotoAnalysis) -> PhotoAnalysis:
    """Relax quality for the deterministic 1-2 photo fallback.

    The fallback must prefer a filled legal page over preserving the exact model
    quality label. `detail` is the broadest shared quality for landscape,
    portrait, and square templates, so it lets mixed square albums use active
    multi-image templates while still satisfying hero protection.
    """
    if photo.quality != "fill" and "detail" in _PLACEABLE_QUALITIES.get(photo.orientation, set()):
        return photo.model_copy(update={"quality": "detail"})
    return _relax_for_single_image(photo)


def _template_assignment(
    tpl: dict,
    photos: list[PhotoAnalysis],
    used: Counter[str] | None = None,
    *,
    hero_exempt: bool = False,
) -> dict[str, str] | None:
    """Return a slot→photoId assignment that fills EVERY image slot of `tpl`.

    Each photo can appear at most once on the page. When several photos fit the
    same slot, prefer the one with the lower global use count so re-templating
    preserves photos that would otherwise lose their only home.
    """
    slots = [(slot["id"], slot) for slot in tpl["images"]]
    indexed_photos = list(enumerate(photos))
    used_counts: Counter[str] = used or Counter()

    def search(
        slot_index: int,
        remaining: list[tuple[int, PhotoAnalysis]],
    ) -> dict[str, str] | None:
        if slot_index == len(slots):
            return {}

        slot, cons = slots[slot_index]
        candidates = [
            (idx, photo)
            for idx, photo in remaining
            if _photo_placeable(photo, cons, hero_exempt=hero_exempt)
        ]
        candidates.sort(
            key=lambda item: (
                not _orientation_prefers(item[1], cons),
                not _quality_prefers(item[1], cons),
                used_counts[item[1].photoId],
                item[0],
            )
        )

        for idx, photo in candidates:
            tail = search(
                slot_index + 1,
                [(i, p) for i, p in remaining if i != idx],
            )
            if tail is not None:
                return {slot: photo.photoId, **tail}
        return None

    return search(0, indexed_photos)


def _template_fills_with(tpl: dict, photos: list[PhotoAnalysis]) -> bool:
    """True if `photos` can fill EVERY image slot of `tpl`."""
    return _template_assignment(tpl, photos) is not None


def _retemplate_page(
    category: str,
    photos: list[PhotoAnalysis],
    used: Counter[str],
) -> tuple[str, dict[str, str]] | None:
    """Pick a replacement template (same category preferred) whose every image
    slot is filled by `photos` — favouring the one that keeps the MOST of them
    on this page so a downsize discards as few photos as possible.

    Ties prefer photos with lower global use counts. That preserves a photo's
    only remaining placement before keeping an already-reused photo. Returns
    None when no image-bearing template fits the set (caller then goes text-only).
    """
    if not photos:
        return None

    def candidates(only_category: bool):
        for order, tid in enumerate(registry.TEMPLATE_IDS):
            tpl = registry.TEMPLATES[tid]
            slots = tpl["images"]
            if not slots:
                continue
            if only_category and tpl["category"] != category:
                continue
            if len(slots) > len(photos):
                continue  # can't fill every slot from this set
            assignment = _template_assignment(
                tpl,
                photos,
                used,
                hero_exempt=_is_solo_category(tpl),
            )
            if assignment is None:
                continue
            kept = set(assignment.values())
            only_home_kept = sum(1 for pid in kept if used[pid] <= 1)
            lower_reuse = -sum(used[pid] for pid in kept)
            yield tid, assignment, (len(slots), only_home_kept, lower_reuse, -order)

    for only_category in (True, False):
        # Most image slots filled = most of the page's photos kept; within that,
        # keep photos that would otherwise become unused.
        best = max(candidates(only_category), key=lambda t: t[2], default=None)
        if best is not None:
            return best[0], best[1]
    return None


def coerce_image_slots(layout: AlbumLayoutPlan) -> AlbumLayoutPlan:
    """Deterministically force every image slot to satisfy hard slot rules.

    Runs ONLY after the model's repair budget is exhausted: a bottom-line, not
    a replacement for sound assignment. doubao-seed-lite can mis-assign on 7-8
    photos and a single repair can't always recover it. This keeps the layout
    structurally shippable where deterministic repair can do so.

    Strategy (only touches placements the model got wrong):
      0. Relax photo quality when needed to make filled templates possible (for
         example square hero → detail so mag-10 can hold a full square grid).
         Without this such a photo may be harder to use in existing square grids.
      1. Clear every placement that breaks a hard per-slot rule — bad slot key,
         dangling photoId, fill photo in a hero slot, same-page duplicate, or
         reuse beyond twice. Valid placements are left exactly as arranged.
      2. Re-home each now-unused photo into an empty, compatible slot on a page
         that doesn't already show it (Rule 3: every photo used at least once).
      3. Fill EVERY still-empty image slot so the final layout never renders a
         blank/placeholder slot (#42). For each empty slot, place the best
         available photo whose quality satisfies the hard slot rule, preferring
         orientation matches, then an unused photo, then a photo used fewer
         times, never exceeding the twice-reuse cap (Rule 4) or duplicating on
         the same page (Rule 4). A slot with no compatible photo anywhere
         triggers step 4.
      4. Any non-cover page that still has an unfilled image slot is swapped to
         the active text-only spread, dropping all its image slots so no empty
         slot ships. Cover pages stay covers and surface a violation if no
         active cover can be filled.
      5. Last resort: a photo with no compatible slot anywhere is dropped from
         photos[] (the album omits it) — it is unused, so nothing references it.

    After coerce, violation() returns None for structurally sound layouts that
    can be made no-empty; otherwise the residual violation is surfaced upstream.
    Crucially, every image slot present in the returned layout is filled — there
    are no empty image slots."""
    # Phase 0 — demote square+hero so existing square grids can hold it. Do not
    # demote fill photos; fill→hero is the one remaining hard quality guard.
    layout = layout.model_copy(
        update={"photos": [_relax_to_placeable(p) for p in layout.photos]}
    )

    by_id: dict[str, PhotoAnalysis] = {p.photoId: p for p in layout.photos}
    page_tpls = [registry.get(page.templateId) for page in layout.pages]
    page_images: list[dict[str, str]] = [dict(page.images) for page in layout.pages]

    used: Counter[str] = Counter()
    on_page: list[set[str]] = [set() for _ in layout.pages]

    # Phase 1 — keep only placements that satisfy every per-slot rule.
    ending_index = len(layout.pages) - 1
    for i, (imgs, tpl) in enumerate(zip(page_images, page_tpls)):
        if tpl is None:
            continue
        hero_exempt = i == 0 or i == ending_index
        img_by_id = registry.image_slot_map(tpl)
        for slot in list(imgs.keys()):
            pid = imgs[slot]
            cons = img_by_id.get(slot)
            photo = by_id.get(pid)
            keep = (
                cons is not None
                and photo is not None
                and _photo_placeable(photo, cons, hero_exempt=hero_exempt)
                and pid not in on_page[i]
                and used[pid] < 2
            )
            if keep:
                used[pid] += 1
                on_page[i].add(pid)
            else:
                del imgs[slot]

    def _rehome(pid: str) -> bool:
        """Place an unused photo into an empty compatible slot on a page that
        doesn't already show it. Returns True if placed (Rule 3)."""
        photo = by_id[pid]
        candidates: list[tuple[bool, bool, int, str]] = []
        for i, (imgs, tpl) in enumerate(zip(page_images, page_tpls)):
            if tpl is None or pid in on_page[i]:
                continue
            for cons in tpl["images"]:
                slot = cons["id"]
                if slot not in imgs and _photo_placeable(photo, cons, hero_exempt=i == 0 or i == ending_index):
                    candidates.append((
                        _orientation_prefers(photo, cons),
                        _quality_prefers(photo, cons),
                        -i,
                        slot,
                    ))
        if not candidates:
            return False
        _, _, neg_i, slot = max(candidates)
        i = -neg_i
        page_images[i][slot] = pid
        used[pid] += 1
        on_page[i].add(pid)
        return True

    def _swap_in(pid: str) -> bool:
        """Place an unused photo by replacing a soft-worse occupant."""
        photo = by_id[pid]
        candidates: list[tuple[int, bool, bool, int, str, str]] = []
        for i, (imgs, tpl) in enumerate(zip(page_images, page_tpls)):
            if tpl is None or pid in on_page[i]:
                continue
            img_by_id = registry.image_slot_map(tpl)
            for slot, current_pid in imgs.items():
                cons = img_by_id.get(slot)
                if cons is None or not _photo_placeable(photo, cons, hero_exempt=i == 0 or i == ending_index):
                    continue
                current = by_id.get(current_pid)
                if current is None:
                    continue
                orientation_gain = (
                    _orientation_prefers(photo, cons)
                    and not _orientation_prefers(current, cons)
                )
                quality_gain = (
                    _quality_prefers(photo, cons)
                    and not _quality_prefers(current, cons)
                )
                if used[current_pid] <= 1 and not orientation_gain and not quality_gain:
                    continue
                candidates.append((used[current_pid], orientation_gain, quality_gain, -i, slot, current_pid))

        if not candidates:
            return False
        _, _, _, neg_i, slot, current_pid = max(candidates)
        i = -neg_i
        page_images[i][slot] = pid
        used[current_pid] -= 1
        on_page[i].discard(current_pid)
        used[pid] += 1
        on_page[i].add(pid)
        return True

    # Phase 2 — re-home unused photos into empty, compatible slots (Rule 3).
    for pid in [p.photoId for p in layout.photos]:
        if used[pid] == 0:
            _rehome(pid)

    for _ in range(len(layout.photos)):
        changed = False
        for pid in [p.photoId for p in layout.photos]:
            if used[pid] == 0:
                changed = _rehome(pid) or _swap_in(pid) or changed
        if not changed:
            break

    # Phase 3 — fill every still-empty image slot so nothing renders blank (#42).
    # For each empty slot, pick the best compatible photo: prefer one not yet
    # used, then the least-used, never breaking the twice cap or same-page dup.
    for i, (imgs, tpl) in enumerate(zip(page_images, page_tpls)):
        if tpl is None:
            continue
        for cons in tpl["images"]:
            slot = cons["id"]
            if slot in imgs:
                continue
            candidate = min(
                (
                    p.photoId
                    for p in layout.photos
                    if _photo_placeable(p, cons, hero_exempt=i == 0 or i == ending_index)
                    and p.photoId not in on_page[i]
                    and used[p.photoId] < 2
                ),
                key=lambda pid: (
                    not _orientation_prefers(by_id[pid], cons),
                    not _quality_prefers(by_id[pid], cons),
                    used[pid],
                ),
                default=None,
            )
            if candidate is not None:
                imgs[slot] = candidate
                used[candidate] += 1
                on_page[i].add(candidate)

    # Phase 4 — a page that still has an unfilled image slot can't be made whole
    # under its current template (some slot has no compatible photo). Rather than
    # ship an empty slot, re-template the page: prefer the template that keeps
    # the most page photos, breaking ties toward photos with fewer global uses.
        # If no image template fits a non-cover page's photos, fall all the way
        # to the active text-only template, which frees those photos to re-home
        # elsewhere or, failing that, drop in Phase 5.
    swapped: dict[int, str] = {}
    for i, (imgs, tpl) in enumerate(zip(page_images, page_tpls)):
        if tpl is None:
            continue
        if not any(slot not in imgs for slot in registry.image_slot_ids(tpl)):
            continue  # already full

        current_ids = set(imgs.values())
        candidates = [
            p for p in layout.photos
            if p.photoId in current_ids or used[p.photoId] < 2
        ]
        complete_current = _template_assignment(
            tpl,
            candidates,
            used,
            hero_exempt=i == 0 or i == ending_index,
        )
        if complete_current is not None:
            new_ids = set(complete_current.values())
            for pid in current_ids - new_ids:
                used[pid] -= 1
            for pid in new_ids - current_ids:
                used[pid] += 1
            page_images[i] = complete_current
            on_page[i] = new_ids
            continue

        page_photo_ids = list(imgs.values())
        page_photos = [by_id[pid] for pid in page_photo_ids]
        replacement = _retemplate_page(tpl["category"], page_photos, used)
        if replacement is None:
            if i == 0:
                continue
            # No image template fits these photos as a whole-page set; go
            # text-only and release the photos for re-homing.
            for pid in page_photo_ids:
                used[pid] -= 1
            new_tid = _TEXT_ONLY_SPREAD
            new_images = {}
            new_on_page = set()
        else:
            new_tid, new_images = replacement
            # Photos that didn't make it into the smaller template are released.
            for pid in set(page_photo_ids) - set(new_images.values()):
                used[pid] -= 1
            new_on_page = set(new_images.values())
        swapped[i] = new_tid
        page_tpls[i] = registry.get(new_tid)
        page_images[i] = new_images
        on_page[i] = new_on_page

    # Re-home photos that lost their only home in a Phase-4 swap.
    for pid in [p.photoId for p in layout.photos]:
        if used[pid] == 0:
            _rehome(pid)

    # Phase 5 — drop photos that have no hard-rule-compatible slot anywhere.
    survivors = [p for p in layout.photos if used[p.photoId] > 0]
    dropped = [p.photoId for p in layout.photos if used[p.photoId] == 0]
    if not survivors and layout.photos:
        # Preserve the original photos so violation() surfaces unused photos
        # upstream instead of returning a successful empty album.
        survivors = list(layout.photos)
    if dropped:
        log.warning(
            "composing.coerce.dropped_photos",
            photo_ids=dropped[:5],
            count=len(dropped),
        )
    if swapped:
        log.warning(
            "composing.coerce.text_only_swap",
            pages=sorted(swapped.keys()),
            count=len(swapped),
        )

    new_pages = []
    for i, (page, imgs) in enumerate(zip(layout.pages, page_images)):
        update: dict = {}
        if imgs != page.images:
            update["images"] = imgs
        if i in swapped:
            update["templateId"] = swapped[i]
            # Real, clamped copy for the new template: the old texts keyed off the
            # old template's slots and would break Rule 8, and every text slot is
            # filled so nothing renders a built-in placeholder.
            page_photo = next((by_id[v] for v in imgs.values()), None)
            update["texts"] = _real_texts(
                swapped[i], layout.magazine, i, len(layout.pages), page_photo
            )
        new_pages.append(page.model_copy(update=update) if update else page)
    return layout.model_copy(update={"pages": new_pages, "photos": survivors})


def violation(layout: AlbumLayoutPlan) -> str | None:
    pages = layout.pages
    photos = layout.photos
    photo_ids = {p.photoId for p in photos}
    by_id: dict[str, PhotoAnalysis] = {p.photoId: p for p in photos}

    # Rule 1: page count sanity — actual layout length, bounded by schema.
    if not (1 <= len(pages) <= 16):
        return f"pages count {len(pages)} outside supported range 1..16"

    # Rule 2: first page must be a cover-category template
    first_tpl = registry.get(pages[0].templateId)
    if not first_tpl:
        return f"page 0 templateId {pages[0].templateId} not in TemplateRegistry"
    if first_tpl["category"] != "cover":
        return f"page 0 templateId {pages[0].templateId} category={first_tpl['category']} (must be cover)"

    # Rule 6: pageIndex strictly 0..N-1
    for expected_idx, page in enumerate(pages):
        if page.pageIndex != expected_idx:
            return f"pageIndex {page.pageIndex} at position {expected_idx} (must be sequential)"

    used_counts: Counter[str] = Counter()
    reuse_counts: Counter[str] = Counter()
    for index, page in enumerate(pages):
        tpl = registry.get(page.templateId)
        if not tpl:
            return f"page {page.pageIndex}: templateId {page.templateId} not in TemplateRegistry"

        image_slot_ids = registry.image_slot_ids(tpl)
        image_by_id = registry.image_slot_map(tpl)
        # Rule 8: slot keys subset of template
        for slot in page.images.keys():
            if slot not in image_by_id:
                return f"page {page.pageIndex}: image slot '{slot}' not in template {page.templateId}"
        for slot in page.texts.keys():
            if not _text_slot_constraint(tpl, slot):
                return f"page {page.pageIndex}: text slot '{slot}' not in template {page.templateId}"
        for slot in image_slot_ids:
            if slot not in page.images:
                return f"page {page.pageIndex}: missing image slot '{slot}' in template {page.templateId}"

        # Rule 5 + 4: each assignment fits its slot, no duplicate within a page
        seen_on_page: set[str] = set()
        for slot, pid in page.images.items():
            if pid not in photo_ids:
                return f"page {page.pageIndex}: photoId {pid} not in photos[]"
            if pid in seen_on_page:
                return f"page {page.pageIndex}: photoId {pid} used twice on same page"
            seen_on_page.add(pid)
            used_counts[pid] += 1
            if index != 0:
                reuse_counts[pid] += 1

            constraint = image_by_id[slot]
            photo = by_id[pid]
            if not _quality_ok(photo, constraint, hero_exempt=index == 0 or index == len(pages) - 1):
                return (
                    f"page {page.pageIndex} slot '{slot}': "
                    f"fill photo {pid} cannot be placed in hero slot "
                    f"(slot quality {constraint.get('quality')})"
                )

    # Rule 3: every photoId referenced at least once
    unused = [pid for pid in photo_ids if used_counts[pid] == 0]
    if unused:
        return f"unused photos: {unused[:3]}"

    # Rule 4: single photo reused at most twice
    overused = [pid for pid, c in reuse_counts.items() if c > 2]
    if overused:
        return f"photos reused more than 2 times: {overused[:3]}"

    return None


def repair_instruction(violation_text: str) -> str:
    """Turn a `violation()` string into a SPECIFIC, actionable repair directive
    naming the broken HARD RULE and the exact page/slot to change (#42).

    The bare violation already pins the offending page/slot; this prepends the
    rule number and a concrete 'do this' so the model fixes that one spot instead
    of re-emitting the same JSON. The directive is appended to the raw violation
    so no detail is lost if the heuristic mis-classifies."""
    v = violation_text
    hint: str
    if "fill photo" in v and "hero slot" in v:
        hint = (
            "RULE 5 (hero protection) — fill-grade photos must not be placed in "
            "hero slots. Move this fill photo to a non-hero image slot, or put a "
            "hero/detail photo in the hero slot."
        )
    elif v.startswith("unused photos"):
        hint = (
            "RULE 3 (photo utilization) — these photoIds appear in NO page. Add "
            "each of them to an image slot without breaking hero protection. "
            "Every input photo must be used at least once."
        )
    elif v.startswith("photos reused"):
        hint = (
            "RULE 4 (reuse cap) — these photoIds appear more than twice. Reduce "
            "each to at most two placements across all pages."
        )
    elif "used twice on same page" in v:
        hint = (
            "RULE 4 (same-page duplicate) — the named photo appears twice on one "
            "page. Replace one occurrence with a different compatible photo."
        )
    elif "missing image slot" in v:
        hint = (
            "NO EMPTY IMAGE SLOT (#42) — every image slot declared by the template "
            "must be filled. Add a compatible photo to the missing slot, or switch "
            "the whole page to a text-only template."
        )
    elif "pages count" in v:
        hint = (
            "RULE 1 (page count) — page count is flexible, but the layout must "
            "contain 1..16 pages. Keep page 0 as the cover, use sequential "
            "pageIndex values from 0, and fill every declared image slot."
        )
    elif "category" in v and "must be cover" in v:
        hint = (
            "RULE 2 (cover first) — page 0 is not a cover template. Set "
            "pages[0].templateId to a cover-category template."
        )
    elif "must be sequential" in v:
        hint = (
            "RULE 6 (pageIndex) — pageIndex values are not 0,1,2,…; renumber them "
            "strictly sequentially from 0."
        )
    elif "not in TemplateRegistry" in v:
        hint = (
            "RULE 7 (known template) — an unknown templateId was used. Use only "
            "the registry IDs."
        )
    elif "not in template" in v:
        hint = (
            "RULE 8 (slot keys) — an unknown slot key was used. Use only that "
            "template's exact image/text slot keys."
        )
    else:
        hint = "Fix the exact page/slot named below; re-verify every HARD RULE."
    return f"{hint}\nOffending check: {violation_text}"


# --- few-photo deterministic fallback (architecture §6.5 decision 6) ----------


def _cover_for_photo(photo: PhotoAnalysis | None) -> tuple[str, str]:
    """Return (templateId, imageSlot) for a cover that can hold `photo`."""
    if photo is not None:
        options: list[tuple[bool, str, str]] = []
        for tid in registry.COVER_TEMPLATE_IDS:
            tpl = registry.TEMPLATES[tid]
            for cons in tpl["images"]:
                if _photo_placeable(photo, cons, hero_exempt=True):
                    options.append((_orientation_prefers(photo, cons), tid, cons["id"]))
        if options:
            _, tid, slot = max(options, key=lambda item: (item[0], -registry.TEMPLATE_IDS.index(item[1])))
            return tid, slot
    tid = registry.COVER_TEMPLATE_IDS[0]
    slot = registry.TEMPLATES[tid]["images"][0]["id"]
    return tid, slot


def _page_slot_for_photo(photo: PhotoAnalysis) -> tuple[str, str] | None:
    """First non-cover SINGLE-image (templateId, imageSlot) whose constraint
    can place `photo`. Restricting to one-image templates is what guarantees no
    empty slot (#42): placing one photo into a multi-image template (e.g. mag-04)
    would leave its other slots blank in the PDF. Every orientation has a
    single-image home: landscape/portrait via the constrained templates, square
    via mag-19 (square/[detail,fill] image slot)."""
    options: list[tuple[bool, int, str, str]] = []
    for order, tid in enumerate(registry.TEMPLATE_IDS):
        tpl = registry.TEMPLATES[tid]
        if tpl["category"] == "cover" or len(tpl["images"]) != 1:
            continue
        cons = tpl["images"][0]
        if _photo_placeable(photo, cons):
            options.append((_orientation_prefers(photo, cons), -order, tid, cons["id"]))
    if not options:
        return None
    _, _, tid, slot = max(options)
    return tid, slot


def _filled_content_page_for_photo(
    target: PhotoAnalysis,
    photos: list[PhotoAnalysis],
    used: Counter[str],
) -> tuple[str, dict[str, str]] | None:
    """Find a non-cover image page that includes `target` and has no empty slot.

    Paired fallback for a photo with no usable single-image home of its own (or
    whose home is already taken): it can legally sit in any active filled
    multi-image template. Partner photos may be reused once, never beyond the
    global reuse cap.
    """
    available = [p for p in photos if used[p.photoId] < 2]

    def candidates():
        for order, tid in enumerate(registry.TEMPLATE_IDS):
            tpl = registry.TEMPLATES[tid]
            slots = tpl["images"]
            if tpl["category"] == "cover" or not slots:
                continue
            if len(slots) > len(available):
                continue
            assignment = _template_assignment(tpl, available, used)
            if assignment is None or target.photoId not in assignment.values():
                continue
            lower_reuse = -sum(used[pid] for pid in set(assignment.values()))
            yield tid, assignment, (len(slots), lower_reuse, -order)

    best = max(candidates(), key=lambda t: t[2], default=None)
    if best is None:
        return None
    return best[0], best[1]


def _real_texts(
    template_id: str,
    magazine: Magazine,
    page_index: int,
    total_pages: int,
    photo: PhotoAnalysis | None = None,
) -> dict[str, str]:
    """Fill every text slot of `template_id` with real, clamped copy.

    Each web/PDF template renders a built-in placeholder string for any unfilled
    text slot (mag-02's "Title/Description", mag-03's "Portrait", and similar).
    The few-photo fallback has no model-authored
    copy, so leaving texts={} would ship those placeholders into the finished PDF
    (architecture review §6.5 + codex P2). The agent registry can't tell which
    slots default safely, so we fill them all from real data: the magazine title
    for headings, the subtitle (or title) for body copy, the photo's own
    description for captions, and the page's real folio number for numeric slots.
    """
    tpl = registry.get(template_id)
    if not tpl:
        return {}
    title = magazine.title
    body = magazine.subtitle or magazine.title
    caption = photo.description if photo and photo.description else body
    out: dict[str, str] = {}
    for cons in tpl["texts"]:
        slot = cons["id"]
        max_chars = cons.get("maxChars", 60)
        s = slot.lower()
        if any(tok in s for tok in ("num", "folio", "vol", "date")):
            # decorative index/folio numbers — use the page's real position
            value = str(total_pages) if "total" in s else str(page_index + 1)
        elif "caption" in s or s in ("intro", "credit"):
            value = caption
        elif (
            any(tok in s for tok in ("title", "heading", "name", "issue", "category"))
            or s in ("plate", "topright", "sidetext")
        ):
            value = title
        else:  # body, quote, subtitle, boxText, items, cells, footnote, …
            value = body
        out[slot] = clamp_text(value, max_chars)
    return out


def build_text_first_layout(magazine: Magazine, photos: list[PhotoAnalysis]) -> AlbumLayoutPlan:
    """Deterministic, §4.3-valid album for the 1-2 photo case (architecture §6.5
    decision 6). Used as the composing fallback when the model can't arrange so
    few photos: a cover, each photo placed in a constraint-matching slot, then
    padded at most to the sanity floor with text-only spreads. Unlike the coerce
    path, this never drops the user's photo — every photo still appears, and
    every image slot it uses is filled (no blanks, #42).

    Photo placement prefers single-image content templates (one photo fills the
    whole page) so no sibling slot is left empty. A mixed square album can also
    use a fully-filled two-image template by reusing the non-square photo once.
    Quality is relaxed up front so fallback uses the broadest legal slots before
    dropping a photo.

    SQUARE coverage: mag-19 is the single-image home for square photos (its image
    slot is square/[detail,fill], so a lone square fills the page with no empty
    sibling slot; a square hero relaxes to detail to fit), and mag-01 accepts a
    square cover. A square-only ≤2-photo album is therefore placeable end to end
    — no photo is left unplaced for orientation reasons. (Phase 2: mag-19 is
    title-only; a richer square record layout with a caption would improve it.)"""
    photos = [_relax_for_few_photo(p) for p in photos]
    pages: list[Page] = []
    used: Counter[str] = Counter()
    target_pages = min(16, max(3, 1 + len(photos)))

    cover_photo = photos[0] if photos else None
    cover_id, cover_slot = _cover_for_photo(cover_photo)
    cover_images: dict[str, str] = {}
    if cover_slot and cover_photo is not None:
        cover_images = {cover_slot: cover_photo.photoId}
        used[cover_photo.photoId] += 1
    pages.append(
        Page(
            pageIndex=0,
            templateId=cover_id,
            images=cover_images,
            texts=_real_texts(cover_id, magazine, 0, target_pages, cover_photo),
        )
    )

    # One page per still-unplaced photo. Prefer a single-image template (every
    # orientation has one — square via mag-19); only if none is usable, try a
    # fully-filled paired template using a partner photo at most one more time.
    for photo in photos:
        if used[photo.photoId] > 0:
            continue
        found = _page_slot_for_photo(photo)
        if found is not None:
            tid, slot = found
            images = {slot: photo.photoId}
        else:
            paired = _filled_content_page_for_photo(photo, photos, used)
            if paired is None:
                continue  # no legal page for this photo — reported upstream
            tid, images = paired
        pages.append(
            Page(
                pageIndex=len(pages),
                templateId=tid,
                images=images,
                texts=_real_texts(tid, magazine, len(pages), target_pages, photo),
            )
        )
        for pid in images.values():
            used[pid] += 1

    # Pad only to the few-photo sanity floor, never beyond 16.
    while len(pages) < target_pages and len(pages) < 16:
        tid = _TEXT_ONLY_PAD[len(pages) % len(_TEXT_ONLY_PAD)]
        pages.append(
            Page(
                pageIndex=len(pages),
                templateId=tid,
                images={},
                texts=_real_texts(tid, magazine, len(pages), target_pages),
            )
        )

    return AlbumLayoutPlan(magazine=magazine, photos=photos, pages=pages)
