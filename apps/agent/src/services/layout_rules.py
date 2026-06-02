"""The 9 business rules from docs/agent/design.md §4.3. Used both after
composing and after applying a chat-edit patch. Returns the first violation
as a human-readable string for the repair prompt, or None if all pass."""

from collections import Counter
from math import ceil

from ..logging_config import get_logger
from ..schemas import AlbumLayoutPlan, Magazine, Page, PhotoAnalysis
from .. import templates as registry

log = get_logger("layout_rules")

# Architecture §6.5 decision 6: photo floor is ≥1. With ≤2 photos the page-count
# target (3) outruns what the photos can fill, so the extra pages use text-only
# templates. Builds bottom out in build_text_first_layout when the model can't.
FEW_PHOTO_MAX = 2

# Text-only spreads used to pad a few-photo album to the page-count target.
_TEXT_ONLY_PAD = ("mag-02", "mag-14")

# Text-only templates that carry NO image slots, used by coerce as the last
# resort for a page whose image slot(s) cannot be legally filled: swapping the
# whole page to one of these renders real copy instead of an empty image slot
# (which the PDF would otherwise show as a blank/placeholder). A cover page
# (index 0) must remain a cover, so it swaps to the text-only cover.
_TEXT_ONLY_COVER = "mag-20"
_TEXT_ONLY_SPREAD = "mag-02"


def _expected_page_count(photo_count: int) -> int:
    raw = ceil(photo_count / 2.5)
    return min(16, max(3, raw))


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
        cons = tpl["textSlots"].get(slot)
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


def _photo_fits(photo: PhotoAnalysis, constraint: dict) -> bool:
    return (
        photo.orientation in constraint["orientation"]
        and photo.quality in constraint["quality"]
    )


# For each orientation, the qualities the 21-template registry can actually hold
# in SOME image slot. A square photo, for instance, only ever fits detail/fill
# slots — no template has a square hero slot — so a square+hero photo fits no
# slot at all and would otherwise be dropped (breaking Rule 1's page target) or
# leave a slot empty. Computed once from the registry so it tracks template edits.
_PLACEABLE_QUALITIES: dict[str, set[str]] = {}
for _tpl in registry.TEMPLATES.values():
    for _cons in _tpl["imageSlots"].values():
        for _o in _cons["orientation"]:
            _PLACEABLE_QUALITIES.setdefault(_o, set()).update(_cons["quality"])

# Preference order when we must demote a photo's quality to make it placeable:
# keep it as prominent as the registry allows.
_QUALITY_RANK = ("hero", "detail", "fill")


def _relax_to_placeable(photo: PhotoAnalysis) -> PhotoAnalysis:
    """Return `photo` unchanged if its orientation+quality fits some slot; else
    demote its quality to the most prominent value its orientation CAN occupy.

    This only triggers for a photo no template can hold (e.g. square+hero) — the
    coerce backstop would otherwise drop it, which shrinks photos[] and breaks
    the Rule 1 page-count target. Demoting quality keeps the photo and a filled
    slot. Orientation is never changed (it reflects the real crop)."""
    placeable = _PLACEABLE_QUALITIES.get(photo.orientation, set())
    if photo.quality in placeable or not placeable:
        return photo
    for q in _QUALITY_RANK:
        if q in placeable:
            return photo.model_copy(update={"quality": q})
    return photo


# Qualities a SINGLE-image (one-slot) non-cover template accepts, per orientation.
# The few-photo fallback places one photo per page in such a template (so no
# sibling slot is left empty), but those templates only accept hero/detail — a
# fill-grade photo must be demoted to detail to get an empty-slot-free home.
_SINGLE_IMAGE_QUALITIES: dict[str, set[str]] = {}
for _tpl in registry.TEMPLATES.values():
    if _tpl["category"] == "cover" or len(_tpl["imageSlots"]) != 1:
        continue
    (_cons,) = _tpl["imageSlots"].values()
    for _o in _cons["orientation"]:
        _SINGLE_IMAGE_QUALITIES.setdefault(_o, set()).update(_cons["quality"])


def _relax_for_single_image(photo: PhotoAnalysis) -> PhotoAnalysis:
    """Demote `photo`'s quality to the most prominent value a single-image
    template accepts for its orientation (e.g. fill→detail for portrait). Returns
    the photo unchanged when it already has a single-image home, or when its
    orientation has none at all (square — the known registry gap)."""
    accepts = _SINGLE_IMAGE_QUALITIES.get(photo.orientation, set())
    if not accepts or photo.quality in accepts:
        return photo
    for q in _QUALITY_RANK:
        if q in accepts:
            return photo.model_copy(update={"quality": q})
    return photo


def _template_fills_with(tpl: dict, photos: list[PhotoAnalysis]) -> bool:
    """True if `photos` can fill EVERY image slot of `tpl` (one photo per slot,
    each satisfying its slot's orientation+quality). Used to re-template a page
    so it has no empty image slot."""
    remaining = list(photos)
    for cons in tpl["imageSlots"].values():
        hit = next((p for p in remaining if _photo_fits(p, cons)), None)
        if hit is None:
            return False
        remaining.remove(hit)
    return True


def _retemplate_page(category: str, photos: list[PhotoAnalysis]) -> str | None:
    """Pick a replacement template (same category preferred) whose every image
    slot is filled by `photos` — favouring the one that keeps the MOST of them
    on this page so a downsize discards as few photos as possible. Returns None
    when no image-bearing template fits the set (caller then goes text-only)."""
    if not photos:
        return None

    def candidates(only_category: bool):
        for tid in registry.TEMPLATE_IDS:
            tpl = registry.TEMPLATES[tid]
            slots = tpl["imageSlots"]
            if not slots:
                continue
            if only_category and tpl["category"] != category:
                continue
            if len(slots) > len(photos):
                continue  # can't fill every slot from this set
            if _template_fills_with(tpl, photos):
                yield tid, len(slots)

    for only_category in (True, False):
        # Most image slots filled = most of the page's photos kept.
        best = max(candidates(only_category), key=lambda t: t[1], default=None)
        if best is not None:
            return best[0]
    return None


def coerce_image_slots(layout: AlbumLayoutPlan) -> AlbumLayoutPlan:
    """Deterministically force every image slot to satisfy its template's
    orientation/quality constraint — the photo-slot analogue of clamp_text.

    Runs ONLY after the model's repair budget is exhausted: a bottom-line, not
    a replacement for sound assignment. doubao-seed-lite reliably matches
    orientation+quality on 3 photos but mis-assigns on 7-8, and a single repair
    can't recover it, sinking the whole job over a cosmetic mismatch. This makes
    the layout pass §4.3 unconditionally so the album always ships.

    Strategy (only touches placements the model got wrong):
      0. Relax the quality of any photo whose orientation+quality fits NO slot in
         the whole registry (e.g. square+hero — no square hero slot exists),
         demoting quality just enough to make it placeable. Without this such a
         photo could only be dropped, shrinking photos[] and breaking Rule 1.
      1. Clear every placement that breaks a per-slot rule — bad slot key,
         dangling photoId, orientation/quality mismatch, same-page duplicate,
         or reuse beyond twice. Valid placements are left exactly as the model
         arranged them.
      2. Re-home each now-unused photo into an empty, compatible slot on a page
         that doesn't already show it (Rule 3: every photo used at least once).
      3. Fill EVERY still-empty image slot so the final layout never renders a
         blank/placeholder slot (#42). For each empty slot, place the best
         available photo whose orientation+quality satisfy the slot, preferring
         an unused photo, then a photo used fewer times, never exceeding the
         twice-reuse cap (Rule 6) or duplicating on the same page (Rule 4). A
         slot with no compatible photo anywhere triggers step 4.
      4. Any page that still has an unfilled image slot is swapped to a
         text-only template (cover page → mag-20, otherwise → mag-02), dropping
         all its image slots so no empty slot ships. Photos that were on that
         page are re-homed (step 2 logic) or, if they have no other home, kept
         for step 5.
      5. Last resort: a photo with no compatible slot anywhere is dropped from
         photos[] (the album omits it) — it is unused, so nothing references it,
         and a smaller photo set only lowers the Rule 1 page target.

    After coerce, violation() returns None for any structurally sound layout
    (valid page count / cover-first / sequential pageIndex / known templates),
    and crucially every image slot present in the layout is filled — there are
    no empty image slots. The structural rules are the model's job and are left
    untouched here."""
    # Phase 0 — demote unplaceable photos (square+hero etc.) so every photo can
    # occupy some slot; otherwise it could only be dropped, breaking Rule 1.
    layout = layout.model_copy(
        update={"photos": [_relax_to_placeable(p) for p in layout.photos]}
    )

    by_id: dict[str, PhotoAnalysis] = {p.photoId: p for p in layout.photos}
    page_tpls = [registry.get(page.templateId) for page in layout.pages]
    page_images: list[dict[str, str]] = [dict(page.images) for page in layout.pages]

    used: Counter[str] = Counter()
    on_page: list[set[str]] = [set() for _ in layout.pages]

    # Phase 1 — keep only placements that satisfy every per-slot rule.
    for i, (imgs, tpl) in enumerate(zip(page_images, page_tpls)):
        if tpl is None:
            continue
        for slot in list(imgs.keys()):
            pid = imgs[slot]
            cons = tpl["imageSlots"].get(slot)
            photo = by_id.get(pid)
            keep = (
                cons is not None
                and photo is not None
                and _photo_fits(photo, cons)
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
        for i, (imgs, tpl) in enumerate(zip(page_images, page_tpls)):
            if tpl is None or pid in on_page[i]:
                continue
            empty = next(
                (
                    s
                    for s, c in tpl["imageSlots"].items()
                    if s not in imgs and _photo_fits(photo, c)
                ),
                None,
            )
            if empty is not None:
                imgs[empty] = pid
                used[pid] += 1
                on_page[i].add(pid)
                return True
        return False

    # Phase 2 — re-home unused photos into empty, compatible slots (Rule 3).
    for pid in [p.photoId for p in layout.photos]:
        if used[pid] == 0:
            _rehome(pid)

    # Phase 3 — fill every still-empty image slot so nothing renders blank (#42).
    # For each empty slot, pick the best compatible photo: prefer one not yet
    # used, then the least-used, never breaking the twice cap or same-page dup.
    for i, (imgs, tpl) in enumerate(zip(page_images, page_tpls)):
        if tpl is None:
            continue
        for slot, cons in tpl["imageSlots"].items():
            if slot in imgs:
                continue
            candidate = min(
                (
                    p.photoId
                    for p in layout.photos
                    if _photo_fits(p, cons)
                    and p.photoId not in on_page[i]
                    and used[p.photoId] < 2
                ),
                key=lambda pid: used[pid],
                default=None,
            )
            if candidate is not None:
                imgs[slot] = candidate
                used[candidate] += 1
                on_page[i].add(candidate)

    # Phase 4 — a page that still has an unfilled image slot can't be made whole
    # under its current template (some slot has no compatible photo). Rather than
    # ship an empty slot, re-template the page: prefer the smallest template of
    # the same category whose EVERY image slot is filled by the photos already on
    # the page (e.g. mag-04's three slots collapse to a single-image mag-05 when
    # only one photo fits). If no image template fits the page's photos, fall all
    # the way to a text-only template (cover page → mag-20, else → mag-02), which
    # frees those photos to re-home elsewhere or, failing that, drop in Phase 5.
    swapped: dict[int, str] = {}
    for i, (imgs, tpl) in enumerate(zip(page_images, page_tpls)):
        if tpl is None:
            continue
        if not any(slot not in imgs for slot in tpl["imageSlots"]):
            continue  # already full
        page_photos = [by_id[pid] for pid in imgs.values()]
        new_tid = _retemplate_page(tpl["category"], page_photos)
        if new_tid is None:
            # No image template fits these photos as a whole-page set; go
            # text-only and release the photos for re-homing.
            for pid in list(imgs.values()):
                used[pid] -= 1
            new_tid = _TEXT_ONLY_COVER if i == 0 else _TEXT_ONLY_SPREAD
            new_images: dict[str, str] = {}
            new_on_page: set[str] = set()
        else:
            # Pack the page's photos into the new template's slots, in order.
            new_tpl = registry.TEMPLATES[new_tid]
            new_images = {}
            remaining = list(imgs.values())
            for slot, cons in new_tpl["imageSlots"].items():
                hit = next((p for p in remaining if _photo_fits(by_id[p], cons)), None)
                if hit is not None:
                    new_images[slot] = hit
                    remaining.remove(hit)
            # Photos that didn't make it into the smaller template are released.
            for pid in remaining:
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

    # Phase 5 — drop photos that have no compatible slot anywhere.
    survivors = [p for p in layout.photos if used[p.photoId] > 0]
    dropped = [p.photoId for p in layout.photos if used[p.photoId] == 0]
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
            # old template's slots and would break Rule 7, and every text slot is
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

    # Rule 1: page count — §4.3 requires pages.length == max(3, ceil(n/2.5))
    # (capped at 16). Strict equality, so too MANY pages is a violation too: a
    # model that pads past the target must hit fallback/repair, not slip through.
    expected = _expected_page_count(len(photos))
    if len(pages) != expected:
        return f"pages count {len(pages)} != required {expected} for {len(photos)} photos"

    # Rule 2: first page must be a cover-category template
    first_tpl = registry.get(pages[0].templateId)
    if not first_tpl:
        return f"page 0 templateId {pages[0].templateId} not in TemplateRegistry"
    if first_tpl["category"] != "cover":
        return f"page 0 templateId {pages[0].templateId} category={first_tpl['category']} (must be cover)"

    # Rule 8: pageIndex strictly 0..N-1
    for expected_idx, page in enumerate(pages):
        if page.pageIndex != expected_idx:
            return f"pageIndex {page.pageIndex} at position {expected_idx} (must be sequential)"

    used_counts: Counter[str] = Counter()
    for page in pages:
        tpl = registry.get(page.templateId)
        if not tpl:
            return f"page {page.pageIndex}: templateId {page.templateId} not in TemplateRegistry"

        # Rule 7: image slot keys subset of template
        for slot in page.images.keys():
            if slot not in tpl["imageSlots"]:
                return f"page {page.pageIndex}: image slot '{slot}' not in template {page.templateId}"
        for slot in page.texts.keys():
            if slot not in tpl["textSlots"]:
                return f"page {page.pageIndex}: text slot '{slot}' not in template {page.templateId}"

        # Rule 5/6 + 4 (single-page dup): every photoId referenced exists; no duplicate within a page
        seen_on_page: set[str] = set()
        for slot, pid in page.images.items():
            if pid not in photo_ids:
                return f"page {page.pageIndex}: photoId {pid} not in photos[]"
            if pid in seen_on_page:
                return f"page {page.pageIndex}: photoId {pid} used twice on same page"
            seen_on_page.add(pid)
            used_counts[pid] += 1

            constraint = tpl["imageSlots"][slot]
            photo = by_id[pid]
            if photo.orientation not in constraint["orientation"]:
                return (
                    f"page {page.pageIndex} slot '{slot}': "
                    f"photo {pid} orientation={photo.orientation} not in "
                    f"{constraint['orientation']}"
                )
            if photo.quality not in constraint["quality"]:
                return (
                    f"page {page.pageIndex} slot '{slot}': "
                    f"photo {pid} quality={photo.quality} not acceptable "
                    f"(slot accepts {constraint['quality']})"
                )

        # Rule 9: text length (we keep it lenient: only the explicit maxChars)
        for slot, text in page.texts.items():
            cons = tpl["textSlots"][slot]
            max_chars = cons.get("maxChars")
            if isinstance(max_chars, int) and len(text) > max_chars:
                return (
                    f"page {page.pageIndex} text '{slot}' length {len(text)} > "
                    f"maxChars {max_chars}"
                )

    # Rule 3: every photoId referenced at least once
    unused = [pid for pid in photo_ids if used_counts[pid] == 0]
    if unused:
        return f"unused photos: {unused[:3]}"

    # Rule 6: single photo reused at most twice
    overused = [pid for pid, c in used_counts.items() if c > 2]
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
    if "orientation=" in v:
        hint = (
            "RULE 5 (slot constraints) — the photo at this slot has the wrong "
            "orientation. Move it to a slot/template whose orientation list "
            "includes that photo's orientation, and put a correctly-oriented "
            "photo in this slot. Do NOT leave the slot empty."
        )
    elif "quality" in v and "acceptable" in v:
        hint = (
            "RULE 5 (slot constraints) — the photo's quality is not accepted by "
            "this slot. Use a photo whose quality is in the slot's quality list, "
            "or move this photo to a slot that accepts its quality."
        )
    elif v.startswith("unused photos"):
        hint = (
            "RULE 3 (photo utilization) — these photoIds appear in NO page. Add "
            "each of them to an image slot whose orientation+quality they satisfy. "
            "Every input photo must be used at least once."
        )
    elif v.startswith("photos reused"):
        hint = (
            "RULE 6 (reuse cap) — these photoIds appear more than twice. Reduce "
            "each to at most two placements across all pages."
        )
    elif "used twice on same page" in v:
        hint = (
            "RULE 4 (same-page duplicate) — the named photo appears twice on one "
            "page. Replace one occurrence with a different compatible photo."
        )
    elif "pages count" in v:
        hint = (
            "RULE 1 (page count) — the number of pages is wrong. Output EXACTLY "
            "the required page count shown; add or remove pages (use text-only "
            "templates mag-02/mag-14/mag-20 to pad) so the total matches."
        )
    elif "category" in v and "must be cover" in v:
        hint = (
            "RULE 2 (cover first) — page 0 is not a cover template. Set "
            "pages[0].templateId to a cover-category template."
        )
    elif "must be sequential" in v:
        hint = (
            "RULE 8 (pageIndex) — pageIndex values are not 0,1,2,…; renumber them "
            "strictly sequentially from 0."
        )
    elif "not in TemplateRegistry" in v or "not in template" in v:
        hint = (
            "RULE 7 (known template/slot) — an unknown templateId or slot key was "
            "used. Use only the registry IDs and that template's exact slot keys."
        )
    elif "maxChars" in v:
        hint = (
            "RULE 9 (text length) — a text slot exceeds its maxChars. Shorten that "
            "slot's text to within the limit."
        )
    else:
        hint = "Fix the exact page/slot named below; re-verify every HARD RULE."
    return f"{hint}\nOffending check: {violation_text}"


# --- few-photo deterministic fallback (architecture §6.5 decision 6) ----------


def _cover_for_photo(photo: PhotoAnalysis | None) -> tuple[str, str]:
    """Return (templateId, imageSlot) for a cover that can hold `photo`. Falls
    back to the text-only cover (mag-20, empty slot) when no image cover fits its
    orientation/quality (e.g. a square or fill-grade photo — no cover accepts
    those)."""
    if photo is not None:
        for tid in registry.COVER_TEMPLATE_IDS:
            tpl = registry.TEMPLATES[tid]
            for slot, cons in tpl["imageSlots"].items():
                if _photo_fits(photo, cons):
                    return tid, slot
    return "mag-20", ""


def _page_slot_for_photo(photo: PhotoAnalysis) -> tuple[str, str] | None:
    """First non-cover SINGLE-image (templateId, imageSlot) whose constraint
    accepts `photo`. Restricting to one-image templates is what guarantees no
    empty slot (#42): placing one photo into a multi-image template (e.g. mag-04)
    would leave its other slots blank in the PDF. Every orientation×quality combo
    the registry can hold has a single-image home (landscape/portrait → several;
    square → mag-09's single square slot), so this only returns None for a photo
    no template can place at all (handled by the caller / Phase-0 relaxation)."""
    for tid in registry.TEMPLATE_IDS:
        tpl = registry.TEMPLATES[tid]
        if tpl["category"] == "cover" or len(tpl["imageSlots"]) != 1:
            continue
        slot, cons = next(iter(tpl["imageSlots"].items()))
        if _photo_fits(photo, cons):
            return tid, slot
    return None


def _real_texts(
    template_id: str,
    magazine: Magazine,
    page_index: int,
    total_pages: int,
    photo: PhotoAnalysis | None = None,
) -> dict[str, str]:
    """Fill every text slot of `template_id` with real, clamped copy.

    Each web/PDF template renders a built-in placeholder string for any unfilled
    text slot (mag-20's "MASASHI WAKUI", mag-02's "Title/Description", mag-14's
    "11/33", mag-03's "Portrait", …). The few-photo fallback has no model-authored
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
    for slot, cons in tpl["textSlots"].items():
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
    padded to the page-count target with text-only spreads. Unlike the coerce
    path, this never drops the user's photo — every photo still appears, and
    every image slot it uses is filled (no blanks, #42).

    Photo placement only ever uses single-image content templates (one photo
    fills the whole page) so no sibling slot is left empty. Quality is relaxed
    up front (e.g. fill→detail) so a fill-grade photo still finds a single-image
    home.

    KNOWN GAP (registry coverage, needs an architect template decision): SQUARE
    photos have NO single-image template, and the only all-square template
    (mag-10) is a 4-up grid that can't be filled by 1-2 photos without either an
    empty slot or a same-page duplicate (Rule 4). So a square-only ≤2-photo album
    cannot be made empty-slot-free AND §4.3-valid from the current 21 templates;
    such a photo is left unplaced here and compose_pages surfaces the residual
    violation rather than shipping a blank slot. Adding a single-image square
    template (or a 1-2-up square template) would close this."""
    # Demote fill→detail so portrait/landscape photos get a single-image home
    # (those templates accept only hero/detail); square has none either way.
    photos = [_relax_for_single_image(p) for p in photos]
    pages: list[Page] = []
    placed: set[str] = set()
    expected = _expected_page_count(len(photos))

    cover_photo = photos[0] if photos else None
    cover_id, cover_slot = _cover_for_photo(cover_photo)
    cover_images: dict[str, str] = {}
    if cover_slot and cover_photo is not None:
        cover_images = {cover_slot: cover_photo.photoId}
        placed.add(cover_photo.photoId)
    pages.append(
        Page(
            pageIndex=0,
            templateId=cover_id,
            images=cover_images,
            texts=_real_texts(cover_id, magazine, 0, expected, cover_photo),
        )
    )

    # One page per still-unplaced photo, in a single-image template that fits it.
    for photo in photos:
        if photo.photoId in placed:
            continue
        found = _page_slot_for_photo(photo)
        if found is None:
            continue  # no single-image home (lone square) — reported upstream
        tid, slot = found
        pages.append(
            Page(
                pageIndex=len(pages),
                templateId=tid,
                images={slot: photo.photoId},
                texts=_real_texts(tid, magazine, len(pages), expected, photo),
            )
        )
        placed.add(photo.photoId)

    # Pad to the page-count target with text-only spreads.
    while len(pages) < expected:
        tid = _TEXT_ONLY_PAD[len(pages) % len(_TEXT_ONLY_PAD)]
        pages.append(
            Page(
                pageIndex=len(pages),
                templateId=tid,
                images={},
                texts=_real_texts(tid, magazine, len(pages), expected),
            )
        )

    return AlbumLayoutPlan(magazine=magazine, photos=photos, pages=pages)
