"""Subject focal positioning (#169).

Covers the three load-bearing pieces of the focal feature:
  * vision parses each photo's `focal` ({x,y}∈[0,1]) and clamps / drops bad ones;
  * the deterministic skeleton derives a default imagePos from focal
    (focal.x*100 / focal.y*100 / scale 1), and OMITS slots whose photo has none;
  * finalize KEEPS focal (it is a BASE field, not a stripped extension), and the
    re-derived cover/ending pick up their focal-driven default imagePos.

No live network: vision parsing is exercised through the pure `_coerce_focal` /
`_coerce_one` helpers, never `analyze`.
"""

from __future__ import annotations

from src.schemas import Focal, PhotoAnalysis
from src.services import finalize, skeleton, vision

from tests.test_finalize_flatten import _chapter, _draft, _photo


# ---------- vision focal parsing ---------------------------------------------


def test_vision_coerce_focal_parses_object():
    f = vision._coerce_focal({"x": 0.3, "y": 0.7})
    assert isinstance(f, Focal)
    assert f.x == 0.3 and f.y == 0.7


def test_vision_coerce_focal_clamps_out_of_range():
    f = vision._coerce_focal({"x": 1.5, "y": -0.2})
    assert f is not None
    assert f.x == 1.0 and f.y == 0.0


def test_vision_coerce_focal_none_for_missing_or_malformed():
    assert vision._coerce_focal(None) is None
    assert vision._coerce_focal("nope") is None
    assert vision._coerce_focal({"x": "a", "y": 0.5}) is None
    assert vision._coerce_focal({}) is None


def test_vision_coerce_one_carries_focal_into_analysis():
    item = {
        "description": "a face",
        "tags": ["portrait"],
        "quality": "hero",
        "orientation": "portrait",
        "peopleCount": "1",
        "scene": "outdoor",
        "mood": "warm",
        "timeOfDay": "day",
        "location": None,
        "focal": {"x": 0.4, "y": 0.25},
    }
    analysis = vision._coerce_one(item, photo_id="p1", fallback_orient="portrait")
    assert isinstance(analysis, PhotoAnalysis)
    assert analysis.focal is not None
    assert analysis.focal.x == 0.4 and analysis.focal.y == 0.25


def test_vision_coerce_one_focal_absent_is_none():
    item = {
        "description": "a wall",
        "tags": ["texture"],
        "quality": "fill",
        "orientation": "square",
        "peopleCount": "0",
        "scene": "interior",
        "mood": "quiet",
    }
    analysis = vision._coerce_one(item, photo_id="p2", fallback_orient="square")
    assert analysis.focal is None


# ---------- skeleton default imagePos derivation -----------------------------


def test_build_image_pos_maps_focal_to_object_position():
    images = {"image": "p1"}
    photos = [{"photoId": "p1", "analysis": {"photoId": "p1", "focal": {"x": 0.2, "y": 0.8}}}]
    pos = skeleton.build_image_pos(images, photos)
    assert pos == {"image": {"x": 20.0, "y": 80.0, "scale": 1.0}}


def test_build_image_pos_omits_slots_without_focal():
    images = {"image": "p1", "imageTop": "p2"}
    photos = [
        {"photoId": "p1", "analysis": {"photoId": "p1", "focal": {"x": 0.5, "y": 0.1}}},
        {"photoId": "p2", "analysis": {"photoId": "p2"}},  # no focal
    ]
    pos = skeleton.build_image_pos(images, photos)
    assert "image" in pos
    assert "imageTop" not in pos  # focal-less photo => slot omitted (centered default)


def test_chapter_pages_get_default_image_pos_from_focal():
    # Two photos with focal → the built chapter page carries focal-derived imagePos.
    photos = [
        {
            "photoId": "p1",
            "analysis": {"photoId": "p1", "quality": "hero", "orientation": "portrait",
                         "focal": {"x": 0.5, "y": 0.2}},
            "exif": {"order": 0},
            "used": True,
        },
        {
            "photoId": "p2",
            "analysis": {"photoId": "p2", "quality": "detail", "orientation": "portrait",
                         "focal": {"x": 0.6, "y": 0.4}},
            "exif": {"order": 1},
            "used": True,
        },
    ]
    pages = skeleton.build_chapter_pages("alb", "c1", photos)
    # At least one page must carry the focal-derived default imagePos.
    with_pos = [p for p in pages if p.get("imagePos")]
    assert with_pos, "expected focal-derived imagePos on a chapter page"
    for page in with_pos:
        for slot, photo_id in page["images"].items():
            if slot in page["imagePos"]:
                entry = page["imagePos"][slot]
                assert entry["scale"] == 1.0
                assert 0.0 <= entry["x"] <= 100.0
                assert 0.0 <= entry["y"] <= 100.0


def test_chapter_pages_no_focal_leaves_image_pos_absent():
    photos = [
        {
            "photoId": "p1",
            "analysis": {"photoId": "p1", "quality": "hero", "orientation": "portrait"},
            "exif": {"order": 0},
            "used": True,
        },
        {
            "photoId": "p2",
            "analysis": {"photoId": "p2", "quality": "detail", "orientation": "portrait"},
            "exif": {"order": 1},
            "used": True,
        },
    ]
    pages = skeleton.build_chapter_pages("alb", "c1", photos)
    # No focal anywhere => no page fabricates an imagePos key (byte-stable default).
    assert all("imagePos" not in p for p in pages)


# ---------- finalize keeps focal (BASE field, NOT stripped) ------------------


def test_finalize_keeps_focal_on_photos():
    # Photos carry focal; finalize must keep it on the flat layout's photos[].
    photos = [
        _photo(1, "hero", focal={"x": 0.5, "y": 0.2}),
        _photo(2, "detail", focal={"x": 0.6, "y": 0.4}),
        _photo(3, "detail", focal={"x": 0.3, "y": 0.7}),
    ]
    chapter = _chapter("c1", photos)
    layout = finalize.finalize(_draft(photos, [chapter], prompt_hint="Trip"))

    by_id = {p.photoId: p for p in layout.photos}
    assert by_id["p001"].focal is not None
    assert by_id["p001"].focal.x == 0.5 and by_id["p001"].focal.y == 0.2
    assert by_id["p002"].focal is not None
    assert by_id["p003"].focal is not None
    # Extension fields are stripped; focal is the only analysis hint finalize keeps.
    assert {"peopleCount", "scene"}.isdisjoint(by_id["p001"].model_dump())


def test_finalize_focal_none_stays_none():
    photos = [_photo(1, "hero"), _photo(2, "detail")]
    layout = finalize.finalize(_draft(photos, [_chapter("c1", photos)], prompt_hint="Trip"))
    assert all(p.focal is None for p in layout.photos)


def test_finalize_strip_to_base5_preserves_focal():
    photo = _photo(1, "hero", focal={"x": 0.25, "y": 0.75})
    stripped = finalize._strip_to_base5(photo)
    assert stripped.focal is not None
    assert stripped.focal.x == 0.25 and stripped.focal.y == 0.75
    assert {"peopleCount", "scene", "mood", "timeOfDay", "location"}.isdisjoint(
        stripped.model_dump()
    )
