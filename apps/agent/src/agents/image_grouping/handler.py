"""Deterministic Stage1 photo grouping.

The algorithm body is intentionally conservative for PR249 Stage1: it returns a
single ordered chapter and no unplaced photos. The surrounding contract and
validator lock the invariants that the later richer grouping algorithm must keep.
"""

from __future__ import annotations

from collections.abc import Sequence

from ...schemas import V3AnalyzePhoto
from .schema import GroupingChapter, GroupingResult


def group_photos(photos: Sequence[V3AnalyzePhoto]) -> GroupingResult:
    """Return deterministic chapter membership for Stage1.

    Placeholder behavior groups all input photos into one chapter. This satisfies
    the Stage1 contract while keeping cluster atomicity and full coverage until
    the richer grouping heuristic lands behind the same interface.
    """
    photo_ids = [photo.photoId for photo in photos]
    result = GroupingResult(
        chapters=[GroupingChapter(chapterId="ch_1", photoIds=photo_ids)],
        unplacedPhotoIds=[],
    )
    validate_grouping_result(result, photos)
    return result


def validate_grouping_result(
    result: GroupingResult, photos: Sequence[V3AnalyzePhoto]
) -> None:
    if len(result.chapters) < 1:
        raise ValueError("grouping must contain at least one chapter")

    expected = [photo.photoId for photo in photos]
    if len(expected) != len(set(expected)):
        raise ValueError("analyze photos contain duplicate photoId values")
    expected_set = set(expected)

    placed: list[str] = []
    owner: dict[str, str] = {}
    chapter_ids: set[str] = set()
    for chapter in result.chapters:
        if not chapter.chapterId:
            raise ValueError("grouping chapterId must be non-empty")
        if chapter.chapterId in chapter_ids:
            raise ValueError(f"duplicated chapterId: {chapter.chapterId}")
        chapter_ids.add(chapter.chapterId)
        for photo_id in chapter.photoIds:
            placed.append(photo_id)
            owner[photo_id] = chapter.chapterId

    for photo_id in result.unplacedPhotoIds:
        placed.append(photo_id)
        owner[photo_id] = "__unplaced__"

    if set(placed) != expected_set:
        missing = sorted(expected_set - set(placed))
        unknown = sorted(set(placed) - expected_set)
        raise ValueError(
            "grouping must cover exactly the input photos"
            f" (missing={missing}, unknown={unknown})"
        )
    if len(placed) != len(set(placed)):
        raise ValueError("grouping must not duplicate photoIds")

    cluster_owner: dict[str, str] = {}
    for photo in photos:
        if photo.clusterId is None:
            continue
        target = owner.get(photo.photoId)
        previous = cluster_owner.setdefault(photo.clusterId, target)
        if previous != target:
            raise ValueError(f"cluster {photo.clusterId} crosses grouping boundaries")
