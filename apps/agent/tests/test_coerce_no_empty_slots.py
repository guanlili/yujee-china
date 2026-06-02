"""#42: the deterministic composing backstop must leave NO empty image slots.

PR #46 added `coerce_image_slots` so a >2-photo layout always passes §4.3, but
it could leave image slots EMPTY (rendering blank/placeholder in the PDF). These
tests pin the stronger guarantee: after coerce, every image slot that survives
in the layout is filled, across photo counts × orientations × qualities, even
when the model output is adversarially wrong.
"""

import itertools
from collections import Counter
from math import ceil

import pytest

from src import templates as registry
from src.schemas import AlbumLayoutPlan, Magazine, Page, PhotoAnalysis
from src.services.layout_rules import (
    build_text_first_layout,
    coerce_image_slots,
    repair_instruction,
    violation,
)

ORIENTATIONS = ("portrait", "landscape", "square")
QUALITIES = ("hero", "detail", "fill")


def _photo(pid: str, *, quality: str, orientation: str) -> PhotoAnalysis:
    return PhotoAnalysis(
        photoId=pid,
        description="a memory worth keeping from this trip together",
        tags=["t"],
        quality=quality,  # type: ignore[arg-type]
        orientation=orientation,  # type: ignore[arg-type]
        peopleCount="1",
        scene="outdoor",
        mood="warm",
    )


def _expected_pages(n: int) -> int:
    return min(16, max(3, ceil(n / 2.5)))


def _no_empty_image_slots(layout: AlbumLayoutPlan) -> list[str]:
    """Return a list of 'pageIndex/slot' for every EMPTY image slot. The
    guarantee is that this is always empty after coerce."""
    empties = []
    for page in layout.pages:
        tpl = registry.get(page.templateId)
        assert tpl is not None, f"unknown template {page.templateId}"
        for slot in tpl["imageSlots"]:
            if slot not in page.images:
                empties.append(f"{page.pageIndex}/{slot}")
    return empties


# Image-bearing templates with >1 slot are where the model mis-assigns and where
# coerce historically left holes. We seed every page with one of these and stuff
# photos in deliberately, often violating the slot constraints.
_MULTI_IMAGE_TEMPLATES = [
    tid for tid in registry.TEMPLATE_IDS
    if len(registry.TEMPLATES[tid]["imageSlots"]) >= 2
]


def _adversarial_layout(photos: list[PhotoAnalysis]) -> AlbumLayoutPlan:
    """Build a structurally-valid-but-slot-wrong layout: correct page count and a
    cover first page, but every interior page is a multi-image template with
    photos jammed into slots round-robin (ignoring orientation/quality), which is
    exactly what doubao-seed-lite does on 7-8 photos."""
    n = len(photos)
    expected = _expected_pages(n)
    pages: list[Page] = []
    # Page 0: a real cover holding the first photo only if it fits, else empty
    # cover — coerce must still fill or downsize it.
    pages.append(Page(pageIndex=0, templateId="mag-13", images={}, texts={}))
    pid_cycle = itertools.cycle([p.photoId for p in photos])
    for idx in range(1, expected):
        tid = _MULTI_IMAGE_TEMPLATES[(idx - 1) % len(_MULTI_IMAGE_TEMPLATES)]
        slots = list(registry.TEMPLATES[tid]["imageSlots"].keys())
        # Jam a (likely wrong) photo into each slot.
        imgs = {slot: next(pid_cycle) for slot in slots}
        pages.append(Page(pageIndex=idx, templateId=tid, images=imgs, texts={}))
    return AlbumLayoutPlan(
        magazine=Magazine(title="Trip", style="warm-film", language="en"),
        photos=photos,
        pages=pages,
    )


@pytest.mark.parametrize("count", [3, 8, 30])
def test_no_empty_slots_uniform_orientation_quality(count):
    """Every combination of a single orientation+quality across the whole set."""
    for orientation, quality in itertools.product(ORIENTATIONS, QUALITIES):
        photos = [
            _photo(f"p{i}", quality=quality, orientation=orientation)
            for i in range(count)
        ]
        layout = _adversarial_layout(photos)
        coerced = coerce_image_slots(layout)
        empties = _no_empty_image_slots(coerced)
        assert empties == [], (
            f"count={count} orient={orientation} quality={quality} "
            f"left empty slots: {empties}"
        )


@pytest.mark.parametrize("count", [3, 8, 30])
def test_no_empty_slots_mixed_orientation_quality(count):
    """Realistic mixed set: orientations and qualities rotate across photos."""
    photos = [
        _photo(
            f"p{i}",
            quality=QUALITIES[i % len(QUALITIES)],
            orientation=ORIENTATIONS[i % len(ORIENTATIONS)],
        )
        for i in range(count)
    ]
    layout = _adversarial_layout(photos)
    coerced = coerce_image_slots(layout)
    assert _no_empty_image_slots(coerced) == []


def _valid_pages(photos: list[PhotoAnalysis], expected: int) -> list[Page]:
    """Build a §4.3-valid base layout for groups of (landscape, portrait, square)
    detail photos: each group fills one mag-04 page (its slots are exactly
    landscape/portrait/square + detail), padded to `expected` pages with
    text-only spreads. The realistic 'right structure' base we then corrupt."""
    pages = [Page(pageIndex=0, templateId="mag-20", images={}, texts={})]
    slots = ("image1", "image2", "image3")  # mag-04: landscape, portrait, square
    for g in range(0, len(photos), 3):
        group = photos[g : g + 3]
        imgs = {slots[k]: group[k].photoId for k in range(len(group))}
        pages.append(Page(pageIndex=len(pages), templateId="mag-04", images=imgs, texts={}))
    while len(pages) < expected:
        pages.append(Page(pageIndex=len(pages), templateId="mag-02",
                          images={}, texts={"items": "kept entries"}))
    return pages


def _slot_correct_layout(photos: list[PhotoAnalysis]) -> AlbumLayoutPlan:
    """A layout the model got STRUCTURALLY right (correct page count, cover first,
    enough image capacity) but with a couple of slot mis-assignments — the
    realistic doubao failure mode (#42). Coerce should fully repair it."""
    expected = _expected_pages(len(photos))
    pages = _valid_pages(photos, expected)
    # Corrupt: on the first image page, swap two slots' photos so each lands in a
    # wrong-orientation slot (e.g. the square photo in the portrait slot) — the
    # exact #42 symptom. coerce must re-wire them without leaving a slot empty.
    image_pages = [i for i in range(1, len(pages)) if pages[i].images]
    if image_pages:
        p = pages[image_pages[0]]
        keys = list(p.images.keys())
        if len(keys) >= 2:
            swapped_imgs = dict(p.images)
            swapped_imgs[keys[0]], swapped_imgs[keys[1]] = p.images[keys[1]], p.images[keys[0]]
            pages[image_pages[0]] = p.model_copy(update={"images": swapped_imgs})
    return AlbumLayoutPlan(
        magazine=Magazine(title="Trip", style="warm-film", language="en"),
        photos=photos, pages=pages,
    )


@pytest.mark.parametrize("count", [3, 6])
def test_no_empty_slots_realistic_model_failure(count):
    """The realistic #42 failure (right structure, some wrong slot wiring): coerce
    must leave no empty slots AND produce a fully §4.3-valid album.

    Photos use a balanced landscape/portrait/square + detail mix that matches the
    registry's slot supply (mag-04 holds exactly one of each), so the base layout
    is genuinely valid at the target page count and the only defect is the
    deliberate mis-wiring coerce must repair. (Unbalanced mixes that can't pack
    densely are a registry/structural limit — see test_adversarial_* and the PR
    notes.)"""
    triple = ("landscape", "portrait", "square")
    photos = [_photo(f"p{i}", quality="detail", orientation=triple[i % 3])
              for i in range(count)]
    # Sanity: the uncorrupted base really is a valid §4.3 layout (so any failure
    # below is the corruption/coerce path, not a bad fixture).
    clean = AlbumLayoutPlan(
        magazine=Magazine(title="Trip", style="warm-film", language="en"),
        photos=photos, pages=_valid_pages(photos, _expected_pages(count)),
    )
    assert violation(clean) is None, f"base fixture invalid: {violation(clean)}"
    coerced = coerce_image_slots(_slot_correct_layout(photos))
    assert _no_empty_image_slots(coerced) == []
    assert violation(coerced) is None, f"count={count}: {violation(coerced)}"


@pytest.mark.parametrize("count", [3, 8, 30])
def test_adversarial_never_leaves_empty_slots(count):
    """Even under a fully scrambled layout (worst-case capacity), the hard #42
    guarantee holds: NO empty image slots ever ship. (Full §4.3 validity is not
    guaranteed here — a scramble can leave too few image homes, so some photos
    drop and the page-count target no longer matches; that residual surfaces as a
    ComposingError in compose_pages rather than shipping a broken album. See the
    PR notes on the structural ceiling.)"""
    photos = [
        _photo(
            f"p{i}",
            quality=QUALITIES[i % len(QUALITIES)],
            orientation=ORIENTATIONS[i % len(ORIENTATIONS)],
        )
        for i in range(count)
    ]
    coerced = coerce_image_slots(_adversarial_layout(photos))
    assert _no_empty_image_slots(coerced) == []


def test_unfillable_square_slot_swaps_to_text_only_not_empty():
    """The canonical #42 hole: a multi-image template (mag-04) has a square slot
    but the set has no square photo. coerce must NOT leave image3 empty — it
    re-templates the page (down to a fitting image template or text-only)."""
    photos = [
        _photo("p1", quality="hero", orientation="landscape"),
        _photo("p2", quality="detail", orientation="portrait"),
        _photo("p3", quality="detail", orientation="landscape"),
    ]
    pages = [
        Page(pageIndex=0, templateId="mag-13", images={"image": "p1"},
             texts={"title": "x" * 12, "intro": "y" * 45,
                    "issue": "YUJEE · 01", "credit": "AI ARRANGED · YUJEE"}),
        # mag-04 = landscape + portrait + SQUARE; no square photo exists.
        Page(pageIndex=1, templateId="mag-04",
             images={"image1": "p1", "image2": "p3"}, texts={}),
        Page(pageIndex=2, templateId="mag-02", images={}, texts={"items": "kept entries"}),
    ]
    layout = AlbumLayoutPlan(
        magazine=Magazine(title="Trip", style="warm-film", language="en"),
        photos=photos, pages=pages,
    )
    coerced = coerce_image_slots(layout)
    assert _no_empty_image_slots(coerced) == []
    assert violation(coerced) is None


@pytest.mark.parametrize("count", [1, 2])
def test_few_photo_fallback_has_no_empty_slots(count):
    """Completes the 1,2,3,8,30 matrix: the ≤2-photo path (build_text_first_layout,
    not coerce) must NEVER leave an empty image slot, for every orientation/quality
    — this was a #42 hole (a fill/square photo used to land in a multi-image
    template, blanking its siblings). Text-only padding pages legitimately carry
    no image slots; the assertion is that no DECLARED image slot is unfilled."""
    mag = Magazine(title="A quiet afternoon", style="warm-film", language="en")
    for orientation, quality in itertools.product(ORIENTATIONS, QUALITIES):
        photos = [
            _photo(f"p{i}", quality=quality, orientation=orientation)
            for i in range(count)
        ]
        layout = build_text_first_layout(mag, photos)
        assert _no_empty_image_slots(layout) == [], (
            f"count={count} {orientation}/{quality} empty: "
            f"{_no_empty_image_slots(layout)}"
        )
        if orientation != "square":
            # portrait/landscape (any quality, via relaxation) → fully valid album.
            assert violation(layout) is None, (
                f"count={count} {orientation}/{quality}: {violation(layout)}"
            )


@pytest.mark.parametrize("count", [1, 2])
def test_few_photo_square_only_is_registry_gap_not_empty_slot(count):
    """REMAINING GAP (narrowed by the #82 review fix): a SQUARE-ONLY ≤2-photo
    album has no non-square companion to share a two-image square spread (mag-09/
    mag-12), and no single-image or 1-2-up all-square template exists, so it can't
    be both empty-slot-free AND §4.3-valid from the 21 templates. The fallback
    chooses no empty slots over a blank PDF: the square photo is left unplaced (a
    Rule-3 'unused' residual that compose_pages raises), NOT placed into a
    multi-image template with blank siblings. (A square WITH a landscape/portrait
    companion IS now placed — see test_few_photo_square_with_companion_*.) Closing
    this needs a single-image square template (architect decision)."""
    mag = Magazine(title="A quiet afternoon", style="warm-film", language="en")
    photos = [_photo(f"p{i}", quality="detail", orientation="square")
              for i in range(count)]
    layout = build_text_first_layout(mag, photos)
    # The non-negotiable guarantee still holds: zero empty image slots.
    assert _no_empty_image_slots(layout) == []
    # And the trade-off: the square photo is omitted, surfaced as 'unused'.
    assert (violation(layout) or "").startswith("unused photos")


@pytest.mark.parametrize(
    "non_square_orientation, expected_template",
    [("landscape", "mag-09"), ("portrait", "mag-12")],
)
@pytest.mark.parametrize("square_first", [False, True])
def test_few_photo_square_with_companion_keeps_both_photos(
    non_square_orientation, expected_template, square_first
):
    """#82 review fix 1: a 2-photo set containing a SQUARE photo must keep BOTH
    photos in a blank-free, §4.3-valid layout — the square goes into a two-image
    square spread (landscape+square → mag-09, portrait+square → mag-12), reusing
    the non-square photo once for the sibling slot. Previously the square was
    dropped (only single-image templates were tried), which then tripped Rule 3.

    Parametrized on photo order so the square being photos[0] (a text-only cover,
    since no cover accepts square) is covered too."""
    mag = Magazine(title="A quiet afternoon", style="warm-film", language="en")
    sq = _photo("sq", quality="detail", orientation="square")
    other = _photo("o1", quality="detail", orientation=non_square_orientation)
    photos = [sq, other] if square_first else [other, sq]

    layout = build_text_first_layout(mag, photos)

    # Both photos are used (no drop), no empty slot, fully §4.3-valid.
    assert _no_empty_image_slots(layout) == []
    assert violation(layout) is None, violation(layout)
    used_ids = {pid for page in layout.pages for pid in page.images.values()}
    assert used_ids == {"sq", "o1"}, f"a photo was dropped: {used_ids}"

    # The square landed on the expected square-capable two-image spread,
    # alongside the non-square companion, with no same-page duplicate.
    square_pages = [
        p for p in layout.pages if "sq" in p.images.values()
    ]
    assert len(square_pages) == 1
    sp = square_pages[0]
    assert sp.templateId == expected_template
    assert "o1" in sp.images.values()  # companion fills the sibling slot
    assert len(set(sp.images.values())) == len(sp.images)  # no same-page dup

    # Reuse stays within the ≤2 cap.
    counts = Counter(pid for page in layout.pages for pid in page.images.values())
    assert all(c <= 2 for c in counts.values()), counts


def test_reuse_within_limit_fills_slot_before_dropping():
    """When more slots than photos exist, coerce fills the surplus slot by
    REUSING a compatible photo (≤2 total, not same page) instead of leaving it
    empty — exercising the progressive fallback before any text-only swap."""
    # Two landscape photos, an interior spread (mag-18 = two portrait slots)
    # plus a single landscape page. Build a layout where a slot would go empty
    # unless reuse kicks in.
    photos = [
        _photo("p1", quality="hero", orientation="landscape"),
        _photo("p2", quality="detail", orientation="landscape"),
        _photo("p3", quality="detail", orientation="landscape"),
    ]
    pages = [
        Page(pageIndex=0, templateId="mag-13", images={"image": "p1"},
             texts={"title": "x" * 12, "intro": "y" * 45,
                    "issue": "YUJEE · 01", "credit": "AI ARRANGED · YUJEE"}),
        # mag-19 single landscape, leave it for p2.
        Page(pageIndex=1, templateId="mag-19", images={"image": "p2"}, texts={}),
        # mag-05 single landscape, leave it for p3.
        Page(pageIndex=2, templateId="mag-05", images={"image": "p3"}, texts={}),
    ]
    layout = AlbumLayoutPlan(
        magazine=Magazine(title="Trip", style="warm-film", language="en"),
        photos=photos, pages=pages,
    )
    coerced = coerce_image_slots(layout)
    assert _no_empty_image_slots(coerced) == []
    assert violation(coerced) is None


def test_retemplate_prefers_keeping_unused_photo_over_reused():
    """#82 review fix 2: when a page's image slot can't be filled and the page is
    re-templated, the tie-break among equal-size candidate templates must keep the
    MOST still-UNUSED photos — never drop an unused photo to keep an already-reused
    one. Reproduces the reported bug: a mag-04 page holds a REUSED landscape (also
    on the cover) and an UNUSED portrait; its square slot can't be filled, so the
    page downsizes to a single-image template. The old tie-break picked by registry
    order (mag-01, keeping the reused landscape) and dropped the unused portrait —
    and violation() returned None because the survivor set merely shrank to a still-
    legal page count. The fix keeps the portrait (its only appearance)."""
    landscape = _photo("L", quality="hero", orientation="landscape")  # reused
    portrait = _photo("P", quality="detail", orientation="portrait")  # only here
    photos = [landscape, portrait]
    pages = [
        # Cover holds the landscape (so L is used twice once the interior page
        # below also references it — making P, not L, the photo we must preserve).
        Page(pageIndex=0, templateId="mag-13", images={"image": "L"},
             texts={"title": "x" * 10, "intro": "y" * 30,
                    "issue": "YUJEE · 01", "credit": "AI ARRANGED · YUJEE"}),
        # mag-04 = landscape + portrait + SQUARE; no square photo, so image3 can't
        # be filled and the page must be re-templated. L here is the 2nd use.
        Page(pageIndex=1, templateId="mag-04",
             images={"image1": "L", "image2": "P"}, texts={}),
        Page(pageIndex=2, templateId="mag-02", images={}, texts={"items": "kept"}),
    ]
    layout = AlbumLayoutPlan(
        magazine=Magazine(title="Trip", style="warm-film", language="en"),
        photos=photos, pages=pages,
    )

    coerced = coerce_image_slots(layout)

    assert _no_empty_image_slots(coerced) == []
    assert violation(coerced) is None, violation(coerced)
    # The unused portrait survives — it is NOT dropped to keep the reused landscape.
    survivors = {p.photoId for p in coerced.photos}
    assert "P" in survivors, f"unused portrait was dropped: {survivors}"
    placed = {pid for page in coerced.pages for pid in page.images.values()}
    assert "P" in placed, f"portrait left unplaced: {placed}"


class TestRepairInstruction:
    """The repair turn must feed back the SPECIFIC violated rule + page/slot (#42),
    not a generic 'try again'."""

    def test_orientation_violation_names_rule_5_and_keeps_detail(self):
        v = "page 1 slot 'image2': photo p3 orientation=landscape not in ['portrait']"
        out = repair_instruction(v)
        assert "RULE 5" in out
        assert "image2" in out and "p3" in out  # original page/slot preserved
        assert "empty" in out.lower()  # tells the model not to blank the slot

    def test_unused_photos_names_rule_3(self):
        out = repair_instruction("unused photos: ['p1']")
        assert "RULE 3" in out and "p1" in out

    def test_page_count_names_rule_1(self):
        out = repair_instruction("pages count 4 != required 3 for 3 photos")
        assert "RULE 1" in out

    def test_quality_violation_names_rule_5(self):
        v = ("page 2 slot 'image': photo p2 quality=fill not acceptable "
             "(slot accepts ['hero', 'detail'])")
        out = repair_instruction(v)
        assert "RULE 5" in out and "p2" in out

    def test_unknown_violation_falls_back_but_keeps_detail(self):
        out = repair_instruction("some brand new check failed at page 9")
        assert "page 9" in out  # raw violation always appended

    # #82 review fix 3: the repair-hint rule numbers must match the numbering the
    # model was shown in the composing prompt (planning._composing_system_prompt),
    # where 4=reuse cap, 6=pageIndex, 8=text length — NOT the §4.3 table order.
    def test_reuse_cap_names_rule_4(self):
        out = repair_instruction("photos reused more than 2 times: ['p1']")
        assert "RULE 4" in out and "RULE 6" not in out

    def test_pageindex_names_rule_6(self):
        out = repair_instruction("pageIndex 5 at position 2 (must be sequential)")
        assert "RULE 6" in out and "RULE 8" not in out

    def test_text_length_names_rule_8(self):
        out = repair_instruction("page 1 text 'title' length 70 > maxChars 60")
        assert "RULE 8" in out and "RULE 9" not in out

    def test_same_page_duplicate_names_rule_4(self):
        out = repair_instruction("page 1: photoId p1 used twice on same page")
        assert "RULE 4" in out

    def test_template_unknown_names_rule_7(self):
        out = repair_instruction("page 1: templateId mag-99 not in TemplateRegistry")
        assert "RULE 7" in out


def test_repair_rule_numbers_match_composing_prompt():
    """Cross-check (#82 review fix 3): every rule number repair_instruction emits
    must be the rule number the composing prompt assigned to that same concept, so
    the repair turn points the model at the rule it just read. Parses the live
    prompt's numbered HARD RULES and asserts each hint's number agrees."""
    import re

    from src.services.planning import _composing_system_prompt

    prompt = _composing_system_prompt(8)
    # Sanity: the prompt really lists 9 numbered rules.
    rule_lines = re.findall(r"^\s*(\d+)\.\s+(.*)$", prompt, flags=re.MULTILINE)
    text_by_num = {int(n): t for n, t in rule_lines}
    assert set(text_by_num) >= set(range(1, 10)), text_by_num

    def prompt_num(substr: str) -> int:
        hits = [n for n, t in text_by_num.items() if substr in t.lower()]
        assert len(hits) == 1, f"{substr!r} -> {hits}"
        return hits[0]

    # (violation string, concept keyword as worded in the prompt)
    cases = [
        ("pages count 4 != required 3 for 3 photos", "pages.length"),
        ("page 0 templateId mag-04 category=spread (must be cover)", "cover-category"),
        ("unused photos: ['p1']", "must appear in at least one"),
        ("photos reused more than 2 times: ['p1']", "at most twice"),
        ("page 1: photoId p1 used twice on same page", "at most twice"),
        ("page 1 slot 'i': photo p1 orientation=square not in ['portrait']",
         "orientation"),
        ("pageIndex 5 at position 2 (must be sequential)", "strictly sequential"),
        ("page 1: templateId mag-99 not in TemplateRegistry", "registry ids"),
        ("page 1 text 'title' length 70 > maxChars 60", "maxchars"),
    ]
    for violation_text, prompt_kw in cases:
        hint = repair_instruction(violation_text)
        m = re.search(r"RULE (\d+)", hint)
        assert m, f"no RULE number in hint for {violation_text!r}"
        assert int(m.group(1)) == prompt_num(prompt_kw), (
            f"{violation_text!r}: repair says RULE {m.group(1)} but prompt numbers "
            f"that concept as RULE {prompt_num(prompt_kw)}"
        )
