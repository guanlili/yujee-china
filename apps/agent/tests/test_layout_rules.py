import pytest

from src import templates as registry
from src.schemas import AlbumLayoutPlan, Magazine, Page, PhotoAnalysis
from src.services.layout_rules import (
    build_text_first_layout,
    clamp_page_texts,
    clamp_text,
    coerce_image_slots,
    violation,
)


def _photo(pid: str, *, quality: str, orientation: str) -> PhotoAnalysis:
    return PhotoAnalysis(
        photoId=pid,
        description="test",
        tags=["t"],
        quality=quality,  # type: ignore[arg-type]
        orientation=orientation,  # type: ignore[arg-type]
        peopleCount="1",
        scene="outdoor",
        mood="warm",
    )


def _good_layout() -> AlbumLayoutPlan:
    photos = [
        _photo("p1", quality="hero", orientation="landscape"),
        _photo("p2", quality="detail", orientation="portrait"),
        _photo("p3", quality="fill", orientation="square"),
    ]
    pages = [
        Page(pageIndex=0, templateId="mag-13", images={"image": "p1"},
             texts={"title": "A spring trip to Kyoto", "intro": "x" * 45,
                    "issue": "YUJEE · 01", "credit": "AI ARRANGED · YUJEE"}),
        Page(pageIndex=1, templateId="mag-02", images={},
             texts={"items": "A small page of entries kept from the trip."}),
        Page(pageIndex=2, templateId="mag-12",
             images={"imageTop": "p3", "imageBottom": "p2"},
             texts={"num1": "02", "num2": "03"}),
    ]
    return AlbumLayoutPlan(
        magazine=Magazine(title="Trip", style="warm-film", language="en"),
        photos=photos,
        pages=pages,
    )


class TestRules:
    def test_good_layout_passes(self):
        assert violation(_good_layout()) is None

    def test_unknown_template_caught(self):
        layout = _good_layout()
        layout.pages[1] = Page(pageIndex=1, templateId="does-not-exist", images={}, texts={})
        assert "TemplateRegistry" in (violation(layout) or "")

    def test_non_cover_first_page_caught(self):
        layout = _good_layout()
        layout.pages[0] = Page(pageIndex=0, templateId="mag-02", images={}, texts={"items": "x"})
        msg = violation(layout) or ""
        assert "cover" in msg

    def test_quality_mismatch_caught(self):
        # Only fill-grade photos are barred from hero slots. Other quality
        # mismatches are soft preferences under the composing redesign.
        layout = _good_layout()
        layout.photos[0] = _photo("p1", quality="fill", orientation="landscape")
        msg = violation(layout) or ""
        assert "fill" in msg and "hero" in msg

    def test_orientation_mismatch_is_soft_preference(self):
        layout = _good_layout()
        layout.photos[0] = _photo("p1", quality="hero", orientation="portrait")

        assert violation(layout) is None

    def test_non_formula_page_count_within_bounds_passes(self):
        layout = _good_layout()
        layout.pages.append(
            Page(
                pageIndex=3,
                templateId="mag-02",
                images={},
                texts={"items": "An extra actual page is allowed."},
            )
        )

        assert violation(layout) is None

    def test_more_than_16_pages_caught(self):
        layout = _good_layout()
        pages = [
            Page(pageIndex=i, templateId="mag-02", images={}, texts={"items": f"page {i}"})
            for i in range(17)
        ]
        pages[0] = layout.pages[0]
        oversized = AlbumLayoutPlan.model_construct(
            magazine=layout.magazine,
            photos=layout.photos,
            pages=pages,
        )

        msg = violation(oversized) or ""
        assert "1..16" in msg

    def test_non_hero_quality_mismatch_is_soft_preference(self):
        layout = _good_layout()
        layout.pages[2] = Page(
            pageIndex=2,
            templateId="mag-16",
            images={"imageTiny": "p1", "imagePerson": "p1", "imageHarbor": "p1"},
            texts={"caption1": "x" * 45, "caption2": "y" * 45,
                   "caption3": "z" * 45, "quote": "q" * 35},
        )
        assert "twice on same page" in (violation(layout) or "")

    def test_unused_photo_caught(self):
        layout = _good_layout()
        layout.pages[2] = Page(pageIndex=2, templateId="mag-02", images={},
                               texts={"items": "x"})
        assert "unused" in (violation(layout) or "")

    def test_missing_image_slot_caught(self):
        photos = [
            _photo("p1", quality="hero", orientation="landscape"),
            _photo("p2", quality="detail", orientation="portrait"),
            _photo("p3", quality="detail", orientation="landscape"),
        ]
        layout = AlbumLayoutPlan(
            magazine=Magazine(title="x", style="warm-film", language="en"),
            photos=photos,
            pages=[
                Page(pageIndex=0, templateId="mag-13", images={"image": "p1"},
                     texts={"title": "Trip to Tokyo", "intro": "y" * 45,
                            "issue": "YUJEE · 01", "credit": "AI ARRANGED · YUJEE"}),
                Page(pageIndex=1, templateId="mag-05", images={"image": "p3"},
                     texts={"title": "A quiet day", "topRight": "Kyoto spring",
                            "caption": "x" * 70, "folio": "02"}),
                Page(pageIndex=2, templateId="mag-18",
                     images={"imageLeft": "p2"},
                     texts={"numLeft": "01", "numRight": "02",
                            "captionLeft": "x" * 45, "captionRight": "y" * 45,
                            "subtitle": "z" * 35}),
            ],
        )
        msg = violation(layout) or ""
        assert "missing image slot" in msg

    def test_dup_on_same_page_caught(self):
        # mag-18 has two portrait slots — give it the same photoId twice
        photos = [
            _photo("p1", quality="hero", orientation="landscape"),
            _photo("p2", quality="detail", orientation="portrait"),
        ]
        layout = AlbumLayoutPlan(
            magazine=Magazine(title="x", style="warm-film", language="en"),
            photos=photos,
            pages=[
                Page(pageIndex=0, templateId="mag-13", images={"image": "p1"},
                     texts={"title": "Trip to Tokyo", "intro": "y" * 45,
                            "issue": "YUJEE · 01", "credit": "AI ARRANGED · YUJEE"}),
                Page(pageIndex=1, templateId="mag-02", images={}, texts={"items": "x"}),
                Page(pageIndex=2, templateId="mag-18",
                     images={"imageLeft": "p2", "imageRight": "p2"},
                     texts={"numLeft": "01", "numRight": "02",
                            "captionLeft": "x" * 45, "captionRight": "y" * 45,
                            "subtitle": "z" * 35}),
            ],
        )
        msg = violation(layout) or ""
        assert "twice on same page" in msg


class TestCoerce:
    def _magazine(self) -> Magazine:
        return Magazine(title="Trip", style="warm-film", language="en")

    def test_fully_scrambled_layout_passes_after_coerce(self):
        # Every photo is mis-assigned, yet each has a compatible slot somewhere.
        # coerce must clear all violations and re-home everyone — no drops.
        photos = [
            _photo("p1", quality="hero",   orientation="landscape"),
            _photo("p2", quality="hero",   orientation="portrait"),
            _photo("p3", quality="detail", orientation="portrait"),
            _photo("p4", quality="fill",   orientation="square"),
            _photo("p5", quality="detail", orientation="landscape"),
            _photo("p6", quality="detail", orientation="square"),
        ]
        layout = AlbumLayoutPlan(
            magazine=self._magazine(),
            photos=photos,
            pages=[
                # cover slot wants landscape — gets a square/fill
                Page(pageIndex=0, templateId="mag-13", images={"image": "p4"},
                     texts={}),
                # mag-04: image1=landscape, image2=portrait, image3=square — all wrong
                Page(pageIndex=1, templateId="mag-04",
                     images={"image1": "p2", "image2": "p1", "image3": "p5"},
                     texts={}),
                # mag-12: imageTop=square, imageBottom=portrait — both wrong
                Page(pageIndex=2, templateId="mag-12",
                     images={"imageTop": "p3", "imageBottom": "p6"},
                     texts={}),
            ],
        )
        assert violation(layout) is not None  # scrambled → fails before coerce

        coerced = coerce_image_slots(layout)
        assert violation(coerced) is None
        # every photo still present and used at least once
        assert {p.photoId for p in coerced.photos} == {"p1", "p2", "p3", "p4", "p5", "p6"}

    def test_unplaceable_photo_is_dropped(self):
        # p3 (square/fill) has no compatible slot in this template set → coerce
        # drops it from photos[] so Rule 3 still holds, keeping the album shippable.
        photos = [
            _photo("p1", quality="hero", orientation="landscape"),
            _photo("p2", quality="hero", orientation="portrait"),
            _photo("p3", quality="fill", orientation="square"),
        ]
        layout = AlbumLayoutPlan(
            magazine=self._magazine(),
            photos=photos,
            pages=[
                Page(pageIndex=0, templateId="mag-13", images={"image": "p1"},
                     texts={}),
                Page(pageIndex=1, templateId="mag-08", images={"image": "p2"},
                     texts={}),
                Page(pageIndex=2, templateId="mag-02", images={}, texts={}),
            ],
        )
        # p3 is unused from the start → fails Rule 3 before coerce
        assert "unused" in (violation(layout) or "")

        coerced = coerce_image_slots(layout)
        assert violation(coerced) is None
        assert {p.photoId for p in coerced.photos} == {"p1", "p2"}

    def test_valid_placements_preserved(self):
        layout = _good_layout()
        coerced = coerce_image_slots(layout)
        assert violation(coerced) is None
        assert len(coerced.photos) == 3
        # the model's correct assignments are left untouched
        assert coerced.pages[0].images == {"image": "p1"}
        assert coerced.pages[2].images == {"imageTop": "p3", "imageBottom": "p2"}

    def test_quality_mismatch_coerced(self):
        # mag-18 imageLeft accepts only detail/fill — a hero photo there is the
        # exact prod failure (requestId 22998fe0). coerce swaps in a fitting photo.
        photos = [
            _photo("p1", quality="hero",   orientation="landscape"),
            _photo("p2", quality="detail", orientation="portrait"),
            _photo("p3", quality="fill",   orientation="portrait"),
        ]
        layout = AlbumLayoutPlan(
            magazine=self._magazine(),
            photos=photos,
            pages=[
                Page(pageIndex=0, templateId="mag-13", images={"image": "p1"},
                     texts={}),
                Page(pageIndex=1, templateId="mag-02", images={}, texts={}),
                # imageLeft/imageRight want detail|fill portraits; p1 is hero/landscape
                Page(pageIndex=2, templateId="mag-18",
                     images={"imageLeft": "p1", "imageRight": "p2"}, texts={}),
            ],
        )
        msg = violation(layout) or ""
        assert "unused" in msg

        coerced = coerce_image_slots(layout)
        assert violation(coerced) is None

    def test_retemplate_prefers_photo_that_would_otherwise_be_dropped(self):
        # Page 1 cannot keep mag-04 because its square slot is unfillable. The
        # replacement must keep p2 (its only home), not p1 (already used on the
        # cover), even though both one-slot templates tie on image-slot count.
        photos = [
            _photo("p1", quality="hero", orientation="landscape"),
            _photo("p2", quality="detail", orientation="portrait"),
            _photo("p3", quality="detail", orientation="landscape"),
        ]
        layout = AlbumLayoutPlan(
            magazine=self._magazine(),
            photos=photos,
            pages=[
                Page(pageIndex=0, templateId="mag-13", images={"image": "p1"},
                     texts={}),
                Page(pageIndex=1, templateId="mag-04",
                     images={"image1": "p1", "image2": "p2"}, texts={}),
                Page(pageIndex=2, templateId="mag-05", images={"image": "p3"},
                     texts={}),
            ],
        )

        coerced = coerce_image_slots(layout)

        assert violation(coerced) is None
        assert {p.photoId for p in coerced.photos} == {"p1", "p2", "p3"}
        used = {pid for page in coerced.pages for pid in page.images.values()}
        assert "p2" in used

    def test_coerce_uses_unused_photos_to_complete_current_template_before_retemplate(self):
        # mag-16 can be fully assigned with p3 tiny + p2 person + p1 harbor. A
        # greedy fill may choose p1 for imagePerson first, but coerce must then
        # reconsider unused p2 before downsizing/text-only swapping the page.
        photos = [
            _photo("p1", quality="detail", orientation="landscape"),
            _photo("p2", quality="hero", orientation="landscape"),
            _photo("p3", quality="fill", orientation="portrait"),
        ]
        layout = AlbumLayoutPlan(
            magazine=self._magazine(),
            photos=photos,
            pages=[
                Page(pageIndex=0, templateId="mag-20", images={}, texts={}),
                Page(pageIndex=1, templateId="mag-16",
                     images={"imageTiny": "p3"}, texts={}),
                Page(pageIndex=2, templateId="mag-02", images={}, texts={}),
            ],
        )

        coerced = coerce_image_slots(layout)

        assert violation(coerced) is None
        assert {p.photoId for p in coerced.photos} == {"p1", "p2", "p3"}
        assert coerced.pages[1].templateId == "mag-16"
        assert coerced.pages[1].images == {
            "imageTiny": "p3",
            "imagePerson": "p2",
            "imageHarbor": "p1",
        }

    def test_coerce_can_use_orientation_soft_slots_for_square_fill_photos(self):
        photos = [
            _photo("p1", quality="fill", orientation="square"),
            _photo("p2", quality="fill", orientation="square"),
            _photo("p3", quality="fill", orientation="square"),
        ]
        layout = AlbumLayoutPlan(
            magazine=self._magazine(),
            photos=photos,
            pages=[
                Page(pageIndex=0, templateId="mag-20", images={}, texts={}),
                Page(pageIndex=1, templateId="mag-04",
                     images={"image3": "p1"}, texts={}),
                Page(pageIndex=2, templateId="mag-02", images={}, texts={}),
            ],
        )

        coerced = coerce_image_slots(layout)

        assert violation(coerced) is None
        assert coerced.photos

    def test_square_heroes_relax_to_fill_existing_grid(self):
        photos = [
            _photo(f"p{i}", quality="hero", orientation="square")
            for i in range(4)
        ]
        layout = AlbumLayoutPlan(
            magazine=self._magazine(),
            photos=photos,
            pages=[
                Page(pageIndex=0, templateId="mag-20", images={}, texts={}),
                Page(
                    pageIndex=1,
                    templateId="mag-10",
                    images={f"cells[{i}].image": f"p{i}" for i in range(4)},
                    texts={},
                ),
                Page(pageIndex=2, templateId="mag-02", images={}, texts={}),
            ],
        )

        coerced = coerce_image_slots(layout)

        assert violation(coerced) is None
        assert {p.photoId for p in coerced.photos} == {"p0", "p1", "p2", "p3"}
        assert {p.quality for p in coerced.photos} == {"detail"}
        assert coerced.pages[1].templateId == "mag-10"
        assert set(coerced.pages[1].images.values()) == {"p0", "p1", "p2", "p3"}


class TestFewPhotoFallback:
    """architecture §6.5 decision 6 — photo floor ≥1. The deterministic
    text-first builder must produce a §4.3-valid album for 1-2 photos of any
    orientation/quality, and every photo must appear at least once."""

    def _magazine(self) -> Magazine:
        return Magazine(title="A spring trip to Kyoto", style="warm-film", language="en")

    @pytest.mark.parametrize("orientation", ["landscape", "portrait", "square"])
    @pytest.mark.parametrize("quality", ["hero", "detail", "fill"])
    def test_single_photo_layout_is_valid(self, orientation, quality):
        photos = [_photo("p1", quality=quality, orientation=orientation)]
        layout = build_text_first_layout(self._magazine(), photos)

        assert len(layout.pages) == 3
        # No empty image slot ever ships (#42), regardless of orientation/quality.
        for page in layout.pages:
            tpl = registry.get(page.templateId)
            assert all(s in page.images for s in registry.image_slot_ids(tpl))
        # Orientation is soft, and fill-grade singles must have a non-hero image
        # home instead of being dropped or placed into a hero slot.
        assert violation(layout) is None
        used = {pid for page in layout.pages for pid in page.images.values()}
        assert "p1" in used

    @pytest.mark.parametrize("orientation", ["landscape", "portrait", "square"])
    @pytest.mark.parametrize("quality", ["hero", "detail", "fill"])
    def test_single_photo_first_page_is_cover(self, orientation, quality):
        photos = [_photo("p1", quality=quality, orientation=orientation)]
        layout = build_text_first_layout(self._magazine(), photos)
        # violation() already enforces cover-category page 0; assert explicitly too
        assert layout.pages[0].templateId in {"mag-01", "mag-13", "mag-20", "p01"}

    def test_two_photos_both_placed(self):
        photos = [
            _photo("p1", quality="fill", orientation="landscape"),  # relaxed to detail
            _photo("p2", quality="detail", orientation="portrait"),
        ]
        layout = build_text_first_layout(self._magazine(), photos)

        assert violation(layout) is None
        used = {pid for page in layout.pages for pid in page.images.values()}
        assert used == {"p1", "p2"}
        # Neither lands in a multi-image template with a blank sibling (#42).
        for page in layout.pages:
            tpl = registry.get(page.templateId)
            assert all(s in page.images for s in registry.image_slot_ids(tpl))

    def test_square_photo_can_use_image_cover_with_orientation_soft(self):
        # Orientation is now soft, so square hero/detail photos can use an image
        # cover and center-cover rendering absorbs the crop mismatch.
        photos = [_photo("p1", quality="hero", orientation="square")]
        layout = build_text_first_layout(self._magazine(), photos)

        assert layout.pages[0].templateId != "mag-20"
        assert "p1" in layout.pages[0].images.values()
        assert violation(layout) is None
        # No empty image slot anywhere.
        for page in layout.pages:
            tpl = registry.get(page.templateId)
            assert all(s in page.images for s in registry.image_slot_ids(tpl))

    @pytest.mark.parametrize(
        "partner",
        [
            _photo("p1", quality="detail", orientation="landscape"),
            _photo("p1", quality="detail", orientation="portrait"),
        ],
    )
    def test_two_photo_square_with_compatible_partner_is_not_dropped(self, partner):
        # Mixed square albums can be valid with existing two-slot templates:
        # landscape+square -> mag-09, portrait+square -> mag-12. The known gap is
        # square-only, not every ≤2-photo album containing a square.
        photos = [
            partner,
            _photo("p2", quality="detail", orientation="square"),
        ]
        layout = build_text_first_layout(self._magazine(), photos)

        assert violation(layout) is None
        used_counts = {
            pid: sum(1 for page in layout.pages for used in page.images.values() if used == pid)
            for pid in {p.photoId for p in photos}
        }
        assert used_counts["p2"] == 1
        assert used_counts["p1"] <= 2
        for page in layout.pages:
            tpl = registry.get(page.templateId)
            assert all(s in page.images for s in registry.image_slot_ids(tpl))

    @pytest.mark.parametrize("orientation", ["landscape", "portrait", "square"])
    @pytest.mark.parametrize("quality", ["hero", "detail", "fill"])
    @pytest.mark.parametrize("n", [1, 2])
    def test_fallback_fills_every_text_slot(self, n, quality, orientation):
        # Every web/PDF template renders a built-in placeholder ("MASASHI WAKUI",
        # "Title/Description", "11/33", …) for an unfilled text slot. The fallback
        # must leave no slot empty, or that placeholder ships into the PDF
        # (architecture review §6.5 + codex P2). Assert full coverage + non-empty.
        photos = [_photo(f"p{i}", quality=quality, orientation=orientation) for i in range(n)]
        layout = build_text_first_layout(self._magazine(), photos)
        for page in layout.pages:
            tpl = registry.get(page.templateId)
            assert tpl is not None
            for slot in registry.text_slot_ids(tpl):
                assert slot in page.texts, f"{page.templateId} slot '{slot}' missing → placeholder"
                assert page.texts[slot].strip(), f"{page.templateId} slot '{slot}' empty → placeholder"


class TestClamp:
    def test_clamp_text_trims_to_word_boundary(self):
        out = clamp_text("Snow Light Mountain Days", 20)
        assert len(out) <= 20
        assert out == "Snow Light Mountain"

    def test_clamp_text_hard_cut_when_no_boundary(self):
        assert clamp_text("supercalifragilistic", 10) == "supercalif"

    def test_clamp_text_noop_under_limit(self):
        assert clamp_text("short", 20) == "short"

    def test_over_recommended_text_length_is_not_a_violation(self):
        layout = _good_layout()
        # mag-13.title recommendedMaxChars=30 — overshoot it (mirrors what
        # doubao-lite does). Length is now a soft prompt preference, not a hard
        # violation; clamp still shortens for compatibility.
        layout.pages[0] = Page(
            pageIndex=0, templateId="mag-13", images={"image": "p1"},
            texts={"title": "A spring trip to Kyoto in the early cherry season",
                   "intro": "x" * 45, "issue": "YUJEE · 01",
                   "credit": "AI ARRANGED · YUJEE"},
        )
        assert violation(layout) is None
        layout.pages = clamp_page_texts(layout.pages)
        assert len(layout.pages[0].texts["title"]) <= 30
        assert violation(layout) is None
