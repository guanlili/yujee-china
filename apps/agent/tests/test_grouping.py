from src.schemas_v2 import V2PhotoAnalysis
from src.services.grouping import GroupingPhoto, _tag_jaccard, build_photo_pool_and_chapters


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
    duplicate_of: str | None = None,
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
        duplicate_of=duplicate_of,
    )


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


def test_batch_duplicateof_and_cross_batch_deterministic_dedupe_mark_non_representatives_unused():
    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo(
                "p1",
                order=0,
                batch_id=1,
                taken_at="2026-06-01T09:00:00Z",
                group_hint="morning",
                tags=["cake", "family", "table", "party", "smile"],
                quality="detail",
            ),
            _photo(
                "p2",
                order=1,
                batch_id=1,
                taken_at="2026-06-01T09:00:01Z",
                group_hint="morning",
                duplicate_of="p1",
                tags=["cake", "family", "table", "party", "smile"],
                quality="fill",
            ),
            _photo(
                "p3",
                order=2,
                batch_id=2,
                taken_at="2026-06-01T12:00:00Z",
                group_hint="lunch",
                tags=["garden", "family", "lunch", "sun", "portrait"],
                quality="detail",
            ),
            _photo(
                "p4",
                order=3,
                batch_id=3,
                taken_at="2026-06-01T12:00:02Z",
                group_hint="lunch",
                tags=["garden", "family", "lunch", "sun", "portrait"],
                quality="fill",
            ),
            _photo(
                "p5",
                order=4,
                batch_id=4,
                group_hint="untimed",
                tags=["garden", "family", "lunch", "sun", "portrait"],
                quality="hero",
            ),
        ]
    )

    by_id = {photo.photoId: photo for photo in photo_pool}
    assert by_id["p1"].used is True
    assert by_id["p2"].used is False
    assert by_id["p2"].duplicateOf == "p1"
    assert by_id["p3"].used is True
    assert by_id["p4"].used is False
    assert by_id["p4"].duplicateOf == "p3"
    assert by_id["p5"].used is True
    assert by_id["p5"].duplicateOf is None
    assert [chapter.photoIds for chapter in chapters] == [["p1"], ["p3"], ["p5"]]


def test_untimed_same_tags_across_batches_are_not_cross_batch_deduped():
    shared_tags = ["garden", "family", "lunch", "sun", "portrait"]

    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo(
                "p1",
                order=0,
                batch_id=1,
                group_hint="untimed",
                tags=shared_tags,
            ),
            _photo(
                "p2",
                order=1,
                batch_id=2,
                group_hint="untimed",
                tags=shared_tags,
            ),
        ]
    )

    by_id = {photo.photoId: photo for photo in photo_pool}
    assert by_id["p1"].used is True
    assert by_id["p1"].duplicateOf is None
    assert by_id["p2"].used is True
    assert by_id["p2"].duplicateOf is None
    assert [chapter.photoIds for chapter in chapters] == [["p1"], ["p2"]]


def test_cross_batch_dedupe_does_not_trigger_at_exact_three_second_boundary():
    shared_tags = ["cake", "family", "table", "party", "smile"]

    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo(
                "p1",
                order=0,
                batch_id=1,
                taken_at="2026-06-01T09:00:00Z",
                group_hint="scan",
                tags=shared_tags,
            ),
            _photo(
                "p2",
                order=1,
                batch_id=2,
                taken_at="2026-06-01T09:00:03Z",
                group_hint="scan",
                tags=shared_tags,
            ),
        ]
    )

    by_id = {photo.photoId: photo for photo in photo_pool}
    assert by_id["p1"].used is True
    assert by_id["p1"].duplicateOf is None
    assert by_id["p2"].used is True
    assert by_id["p2"].duplicateOf is None
    assert [chapter.photoIds for chapter in chapters] == [["p1"], ["p2"]]


def test_cross_batch_dedupe_does_not_trigger_at_exact_jaccard_overlap_boundary():
    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo(
                "p1",
                order=0,
                batch_id=1,
                taken_at="2026-06-01T09:00:00Z",
                group_hint="scan",
                tags=["album", "cake", "family", "table"],
            ),
            _photo(
                "p2",
                order=1,
                batch_id=2,
                taken_at="2026-06-01T09:00:02Z",
                group_hint="scan",
                tags=["album", "cake", "family", "table", "garden"],
            ),
        ]
    )

    by_id = {photo.photoId: photo for photo in photo_pool}
    assert by_id["p1"].used is True
    assert by_id["p1"].duplicateOf is None
    assert by_id["p2"].used is True
    assert by_id["p2"].duplicateOf is None
    assert [chapter.photoIds for chapter in chapters] == [["p1"], ["p2"]]


def test_tag_jaccard_empty_sets_returns_float_zero():
    assert type(_tag_jaccard([], [])) is float
    assert _tag_jaccard([], []) == 0.0
    assert type(_tag_jaccard([" "], ["album"])) is float
    assert _tag_jaccard([" "], ["album"]) == 0.0


def test_empty_chapters_are_removed_after_dedupe_and_roles_are_relabelled_after_cleanup():
    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo(
                "p1",
                order=0,
                taken_at="2026-06-01T09:00:00Z",
                group_hint="old-opening",
                duplicate_of="p2",
                quality="fill",
            ),
            _photo(
                "p2",
                order=1,
                taken_at="2026-06-01T18:00:00Z",
                group_hint="new-opening",
                quality="hero",
            ),
            _photo(
                "p3",
                order=2,
                taken_at="2026-06-02T10:00:00Z",
                group_hint="ending",
                quality="detail",
            ),
        ]
    )

    by_id = {photo.photoId: photo for photo in photo_pool}
    assert by_id["p1"].used is False
    assert by_id["p1"].duplicateOf == "p2"
    assert [chapter.photoIds for chapter in chapters] == [["p2"], ["p3"]]
    assert [chapter.cluster.label for chapter in chapters] == ["new-opening", "ending"]
    assert [chapter.cluster.role for chapter in chapters] == ["opening", "closing"]


def test_batch_duplicateof_keeps_vlm_selected_representative_even_when_duplicate_has_higher_quality():
    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo(
                "p1",
                order=0,
                batch_id=1,
                taken_at="2026-06-01T09:00:00Z",
                group_hint="morning",
                quality="fill",
            ),
            _photo(
                "p2",
                order=1,
                batch_id=1,
                taken_at="2026-06-01T09:00:01Z",
                group_hint="morning",
                duplicate_of="p1",
                quality="hero",
            ),
        ]
    )

    by_id = {photo.photoId: photo for photo in photo_pool}
    assert by_id["p1"].used is True
    assert by_id["p1"].duplicateOf is None
    assert by_id["p2"].used is False
    assert by_id["p2"].duplicateOf == "p1"
    assert [chapter.photoIds for chapter in chapters] == [["p1"]]


def test_group_hint_and_deterministic_dedupe_respect_batch_boundaries():
    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo(
                "p1",
                order=0,
                batch_id=10,
                taken_at="2026-06-01T09:00:00Z",
                group_hint="same-label",
                tags=["cake", "family", "table", "party", "smile"],
            ),
            _photo(
                "p2",
                order=1,
                batch_id=10,
                taken_at="2026-06-01T09:00:01Z",
                group_hint="same-label",
                tags=["cake", "family", "table", "party", "smile"],
            ),
            _photo(
                "p3",
                order=2,
                batch_id=11,
                taken_at="2026-06-01T09:00:02Z",
                group_hint="same-label",
                tags=["cake", "family", "table", "party", "smile"],
            ),
        ]
    )

    by_id = {photo.photoId: photo for photo in photo_pool}
    assert by_id["p1"].used is True
    assert by_id["p2"].used is True
    assert by_id["p3"].used is False
    assert by_id["p3"].duplicateOf == "p1"
    assert [chapter.photoIds for chapter in chapters] == [["p1", "p2"]]


def test_invalid_taken_at_is_treated_as_untimed_and_not_written_back_to_photo_pool():
    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo("p1", order=0, taken_at="not-a-date", group_hint="manual"),
            _photo(
                "p2",
                order=1,
                taken_at="2026-06-01T09:00:00",
                group_hint="local-without-zone",
            ),
            _photo("p3", order=2, taken_at="2026-06-01T10:00:00Z", group_hint="timed"),
        ]
    )

    by_id = {photo.photoId: photo for photo in photo_pool}
    assert by_id["p1"].exif.takenAt is None
    assert by_id["p2"].exif.takenAt is None
    assert by_id["p3"].exif.takenAt == "2026-06-01T10:00:00Z"
    assert [chapter.photoIds for chapter in chapters] == [["p3"], ["p1"], ["p2"]]
    assert chapters[1].cluster.timeRange is None
    assert chapters[2].cluster.timeRange is None


def test_cross_batch_representative_compares_batch_level_representatives():
    photo_pool, chapters = build_photo_pool_and_chapters(
        [
            _photo(
                "p1",
                order=0,
                batch_id=1,
                taken_at="2026-06-01T09:00:00Z",
                group_hint="batch-a",
                tags=["cake", "family", "table", "party", "smile"],
                quality="fill",
            ),
            _photo(
                "p2",
                order=1,
                batch_id=1,
                taken_at="2026-06-01T09:00:01Z",
                group_hint="batch-a",
                duplicate_of="p1",
                tags=["cake", "family", "table", "party", "smile"],
                quality="hero",
            ),
            _photo(
                "p3",
                order=2,
                batch_id=2,
                taken_at="2026-06-01T09:00:02Z",
                group_hint="batch-b",
                tags=["cake", "family", "table", "party", "smile"],
                quality="hero",
            ),
        ]
    )

    by_id = {photo.photoId: photo for photo in photo_pool}
    assert by_id["p3"].used is True
    assert by_id["p1"].used is False
    assert by_id["p1"].duplicateOf == "p3"
    assert by_id["p2"].used is False
    assert by_id["p2"].duplicateOf == "p3"
    assert [chapter.photoIds for chapter in chapters] == [["p3"]]
