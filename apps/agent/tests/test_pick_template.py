from __future__ import annotations

import json
from pathlib import Path

from src.services.skeleton import (
    build_skeleton,
    can_place,
    partition_chapter_photos,
    pick_template,
)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _photo(idx: int, quality: str = "fill", orientation: str = "portrait") -> dict:
    photo_id = f"p{idx:03d}"
    return {
        "photoId": photo_id,
        "analysis": {
            "photoId": photo_id,
            "description": f"photo {idx}",
            "tags": ["test"],
            "quality": quality,
            "orientation": orientation,
        },
        "exif": {"order": idx},
        "used": True,
    }


def test_chapter_1_up_never_returns_cover_or_closing_templates():
    forbidden = {"mag-01", "mag-13", "mag-17", "p01"}

    for attempt in range(12):
        template_id = pick_template(
            "chapter",
            1,
            [_photo(1, "detail")],
            album_id="album",
            chapter_id="chapter",
            page_ordinal=0,
            attempt=attempt,
        )

        assert template_id not in forbidden


def test_fill_photos_filter_out_hero_only_slots():
    assert (
        pick_template(
            "chapter",
            1,
            [_photo(1, "fill")],
            album_id="album",
            chapter_id="chapter",
            page_ordinal=0,
        )
        == "mag-19"
    )
    assert (
        pick_template(
            "chapter",
            2,
            [_photo(1, "fill"), _photo(2, "fill")],
            album_id="album",
            chapter_id="chapter",
            page_ordinal=0,
        )
        == "mag-18"
    )


def test_seed_is_reproducible_and_attempt_rerolls_are_reversible():
    kwargs = {
        "use_case": "chapter",
        "image_count": 1,
        "photos": [_photo(1, "detail")],
        "album_id": "album-seed",
        "chapter_id": "chapter-seed",
        "page_ordinal": 2,
    }

    original = pick_template(**kwargs, attempt=0)
    rerolled = pick_template(**kwargs, attempt=1)

    assert original == pick_template(**kwargs, attempt=0)
    assert rerolled == pick_template(**kwargs, attempt=1)
    assert original != rerolled


def test_exclude_exhaustion_falls_back_to_legal_candidates():
    photos = [_photo(1, "hero", "landscape"), _photo(2, "fill"), _photo(3, "fill", "square")]

    template_id = pick_template(
        "chapter",
        3,
        photos,
        exclude={"mag-04", "mag-16"},
        album_id="album",
        chapter_id="chapter",
        page_ordinal=0,
    )

    assert template_id in {"mag-04", "mag-16"}
    assert can_place(template_id, photos)


def test_partition_output_is_always_pickable():
    photos = [_photo(i, "fill") for i in range(1, 31)]

    for ordinal, page in enumerate(partition_chapter_photos(photos)):
        template_id = pick_template(
            "chapter",
            len(page),
            page,
            album_id="album-all-fill",
            chapter_id="chapter",
            page_ordinal=ordinal,
        )
        assert can_place(template_id, page)


def test_shared_golden_fixtures_match_python_output():
    fixture_dir = _repo_root() / "packages" / "contracts" / "fixtures" / "skeleton"

    for path in sorted(fixture_dir.glob("*.json")):
        fixture = json.loads(path.read_text(encoding="utf-8"))
        result = build_skeleton(fixture["input"])

        assert json.dumps(result["pages"], ensure_ascii=False, separators=(",", ":")) == json.dumps(
            fixture["expected"]["pages"],
            ensure_ascii=False,
            separators=(",", ":"),
        ), path.name
