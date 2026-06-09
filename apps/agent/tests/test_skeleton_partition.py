from __future__ import annotations

from src.services.skeleton import fill_capacity, partition_chapter_photos


def _photo(idx: int, quality: str = "fill") -> dict:
    photo_id = f"p{idx:03d}"
    return {
        "photoId": photo_id,
        "analysis": {
            "photoId": photo_id,
            "description": f"photo {idx}",
            "tags": ["test"],
            "quality": quality,
            "orientation": "portrait",
        },
        "exif": {"order": idx},
        "used": True,
    }


def _ids(pages: list[list[dict]]) -> list[str]:
    return [photo["photoId"] for page in pages for photo in page]


def _fill_count(page: list[dict]) -> int:
    return sum(1 for photo in page if photo["analysis"]["quality"] == "fill")


def test_partition_covers_n_1_to_30_once_without_impossible_fill_pages():
    for n in range(1, 31):
        qualities = ["hero", "detail", "fill"]
        photos = [_photo(i, qualities[(i - 1) % len(qualities)]) for i in range(1, n + 1)]

        pages = partition_chapter_photos(photos)

        assert all(1 <= len(page) <= 3 for page in pages)
        assert _ids(pages) == [photo["photoId"] for photo in photos]
        assert len(_ids(pages)) == len(set(_ids(pages)))
        assert sum(
            1
            for page in pages
            if len(page) == 1 and page[0]["analysis"]["quality"] == "hero"
        ) <= 1
        assert all(_fill_count(page) <= fill_capacity("chapter", len(page)) for page in pages)


def test_partition_splits_three_all_fill_photos_into_2_plus_1():
    pages = partition_chapter_photos([_photo(1), _photo(2), _photo(3)])

    assert [len(page) for page in pages] == [2, 1]
    assert _ids(pages) == ["p001", "p002", "p003"]


def test_partition_splits_each_all_fill_3_up_chunk_for_six_and_thirty_photos():
    six_pages = partition_chapter_photos([_photo(i) for i in range(1, 7)])
    thirty_pages = partition_chapter_photos([_photo(i) for i in range(1, 31)])

    assert [len(page) for page in six_pages] == [2, 1, 2, 1]
    assert [len(page) for page in thirty_pages] == [2, 1] * 10
    assert _ids(thirty_pages) == [f"p{i:03d}" for i in range(1, 31)]


def test_partition_does_not_force_a_solo_page_when_chapter_has_no_hero():
    pages = partition_chapter_photos([_photo(1, "detail"), _photo(2, "detail"), _photo(3, "fill")])

    assert [len(page) for page in pages] == [3]
