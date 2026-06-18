from src.schemas_v2 import V2PhotoAnalysis
from src.services.grouping import GroupingPhoto, build_photo_pool_and_chapters


def _analysis(photo_id: str, *, tags: list[str] | None = None, quality: str = "detail") -> V2PhotoAnalysis:
    return V2PhotoAnalysis(
        photoId=photo_id,
        description=f"{photo_id} description",
        tags=tags or [photo_id, "memoir", "family"],
        quality=quality,  # type: ignore[arg-type]
        orientation="landscape",
        peopleCount="1",
        scene="outdoor",
        mood="warm",
        timeOfDay="day",
    )


def _photo(
    photo_id: str,
    *,
    order: int,
    batch_id: int | str = 0,
    taken_at: str | None = None,
    group_hint: str | None = None,
    tags: list[str] | None = None,
    quality: str = "detail",
) -> GroupingPhoto:
    return GroupingPhoto(
        photo_id=photo_id,
        analysis=_analysis(photo_id, tags=tags, quality=quality),
        order=order,
        batch_id=batch_id,
        taken_at=taken_at,
        group_hint=group_hint,
    )


def test_time_gap_over_six_hours_splits_into_separate_chapters():
    """takenAt is the primary chaptering signal: a >6h gap starts a new chapter
    even when the group hint is identical, and photos under the threshold stay in
    one chapter."""
    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo("p1", order=0, taken_at="2026-06-01T09:00:00Z", group_hint="trip"),
            _photo("p2", order=1, taken_at="2026-06-01T11:00:00Z", group_hint="trip"),
            # +9h from p2 → new time segment despite the same hint.
            _photo("p3", order=2, taken_at="2026-06-01T20:00:00Z", group_hint="trip"),
        ]
    )

    assert [p.photoId for p in photo_pool] == ["p1", "p2", "p3"]
    assert [chapter.photoIds for chapter in chapters] == [["p1", "p2"], ["p3"]]
    assert chapters[0].cluster.timeRange == "2026-06-01T09:00:00Z..2026-06-01T11:00:00Z"
    assert chapters[1].cluster.timeRange == "2026-06-01T20:00:00Z"
    assert [chapter.cluster.role for chapter in chapters] == ["opening", "closing"]


def test_timed_and_untimed_use_separate_queues_and_group_hint_only_splits_inside_segments():
    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo("p1", order=0, taken_at="2026-06-01T09:00:00Z", group_hint="ceremony"),
            _photo("p2", order=1, taken_at="2026-06-01T09:10:00Z", group_hint="reception"),
            _photo("p3", order=2, taken_at="2026-06-01T17:30:00Z", group_hint="ceremony"),
            _photo("p4", order=3, group_hint="ceremony"),
            _photo("p5", order=4, group_hint="details"),
        ]
    )

    assert [p.photoId for p in photo_pool] == ["p1", "p2", "p3", "p4", "p5"]
    assert [chapter.photoIds for chapter in chapters] == [["p1"], ["p2"], ["p3"], ["p4"], ["p5"]]
    assert [chapter.cluster.label for chapter in chapters] == [
        "ceremony",
        "reception",
        "ceremony",
        "ceremony",
        "details",
    ]
    assert [chapter.cluster.role for chapter in chapters] == [
        "opening",
        "body",
        "body",
        "body",
        "closing",
    ]
    assert all(p.exif.place is None for p in photo_pool)
    assert all(chapter.cluster.place is None for chapter in chapters)


def test_every_photo_is_used_and_no_duplicateof_after_union_find_removal():
    """WP1.2 (#181): union-find de-dup is gone. Every photo is used, duplicateOf is
    always None — matching what the single-batch production path always produced."""
    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo("p1", order=0, taken_at="2026-06-01T09:00:00Z", group_hint="morning"),
            _photo("p2", order=1, taken_at="2026-06-01T09:00:01Z", group_hint="morning"),
            _photo("p3", order=2, taken_at="2026-06-01T09:00:02Z", group_hint="morning"),
        ]
    )

    by_id = {photo.photoId: photo for photo in photo_pool}
    assert all(photo.used is True for photo in photo_pool)
    assert all(photo.duplicateOf is None for photo in photo_pool)
    # Same hint, same time segment → single chapter holds all three.
    assert [chapter.photoIds for chapter in chapters] == [["p1", "p2", "p3"]]
    assert by_id["p1"].exif.takenAt == "2026-06-01T09:00:00Z"


def test_within_segment_group_hint_splits_chapters_preserving_first_seen_order():
    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo("p1", order=0, taken_at="2026-06-01T09:00:00Z", group_hint="garden"),
            _photo("p2", order=1, taken_at="2026-06-01T09:05:00Z", group_hint="kitchen"),
            _photo("p3", order=2, taken_at="2026-06-01T09:10:00Z", group_hint="garden"),
        ]
    )

    assert [p.photoId for p in photo_pool] == ["p1", "p2", "p3"]
    # All within 6h → one time segment; hint splits it, first-seen order kept.
    assert [chapter.cluster.label for chapter in chapters] == ["garden", "kitchen"]
    assert [chapter.photoIds for chapter in chapters] == [["p1", "p3"], ["p2"]]


def test_local_exif_taken_at_without_timezone_is_timed_and_preserved():
    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo("p1", order=0, taken_at="2026-06-01T09:00:00", group_hint="local"),
            _photo("p2", order=1, taken_at="2026-06-01T10:30:00", group_hint="local"),
            _photo("p3", order=2, taken_at="2026-06-01T18:31:00", group_hint="local"),
        ]
    )

    by_id = {photo.photoId: photo for photo in photo_pool}
    assert by_id["p1"].exif.takenAt == "2026-06-01T09:00:00"
    assert [chapter.photoIds for chapter in chapters] == [["p1", "p2"], ["p3"]]
    assert chapters[0].cluster.timeRange == "2026-06-01T09:00:00..2026-06-01T10:30:00"
    assert chapters[1].cluster.timeRange == "2026-06-01T18:31:00"


def test_invalid_taken_at_is_treated_as_untimed_and_not_written_back_to_photo_pool():
    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo("p1", order=0, taken_at="not-a-date", group_hint="manual"),
            _photo(
                "p2",
                order=1,
                taken_at="2026/06/01 09:00:00",
                group_hint="invalid-format",
            ),
            _photo("p3", order=2, taken_at="2026-06-01T10:00:00Z", group_hint="timed"),
        ]
    )

    by_id = {photo.photoId: photo for photo in photo_pool}
    assert by_id["p1"].exif.takenAt is None
    assert by_id["p2"].exif.takenAt is None
    assert by_id["p3"].exif.takenAt == "2026-06-01T10:00:00Z"
    # Timed photos chapter first; untimed fall back to upload order.
    assert [chapter.photoIds for chapter in chapters] == [["p3"], ["p1"], ["p2"]]
    assert chapters[1].cluster.timeRange is None
    assert chapters[2].cluster.timeRange is None


def test_empty_segment_handling_keeps_roles_after_cleanup():
    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo("p1", order=0, taken_at="2026-06-01T09:00:00Z", group_hint="opening-day"),
            _photo("p2", order=1, taken_at="2026-06-01T18:00:00Z", group_hint="evening"),
            _photo("p3", order=2, taken_at="2026-06-02T10:00:00Z", group_hint="ending"),
        ]
    )

    assert [chapter.photoIds for chapter in chapters] == [["p1"], ["p2"], ["p3"]]
    assert [chapter.cluster.label for chapter in chapters] == ["opening-day", "evening", "ending"]
    assert [chapter.cluster.role for chapter in chapters] == ["opening", "body", "closing"]
    assert all(p.used is True for p in photo_pool)
