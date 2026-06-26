"""Deterministic Stage1 photo grouping.

The algorithm is intentionally small and deterministic for Stage1: it uses only
request metadata to form chapter membership. Image bytes are reserved for the
separate describe step.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timezone

from ...schemas import V3AnalyzePhoto
from .schema import GroupingChapter, GroupingResult


_MAX_CHAPTER_PHOTOS = 20
_MAX_CHAPTER_SPAN_SECONDS = 36 * 60 * 60


@dataclass
class _Unit:
    photo_ids: list[str]
    first_index: int
    earliest_ts: float | None

    @property
    def size(self) -> int:
        return len(self.photo_ids)


def group_photos(photos: Sequence[V3AnalyzePhoto]) -> GroupingResult:
    """Return deterministic chapter membership for Stage1."""
    units = _cluster_units(photos)
    chapters = _split_units_into_chapters(units)
    if not chapters:
        chapters = [[]]

    result = GroupingResult(
        chapters=[
            GroupingChapter(chapterId=f"ch_{index + 1}", photoIds=photo_ids)
            for index, photo_ids in enumerate(chapters)
        ],
        unplacedPhotoIds=[],
    )
    validate_grouping_result(result, photos)
    return result


def _cluster_units(photos: Sequence[V3AnalyzePhoto]) -> list[_Unit]:
    order: list[tuple[str, str | int]] = []
    members: dict[tuple[str, str | int], list[str]] = {}
    first_index: dict[tuple[str, str | int], int] = {}
    earliest_ts: dict[tuple[str, str | int], float | None] = {}

    for index, photo in enumerate(photos):
        key: tuple[str, str | int]
        if photo.clusterId is None:
            key = ("photo", index)
        else:
            key = ("cluster", photo.clusterId)
        if key not in members:
            members[key] = []
            first_index[key] = index
            earliest_ts[key] = None
            order.append(key)
        members[key].append(photo.photoId)
        taken_at_ts = _taken_at_timestamp(photo)
        if taken_at_ts is not None:
            current = earliest_ts[key]
            earliest_ts[key] = taken_at_ts if current is None else min(current, taken_at_ts)

    units = [
        _Unit(
            photo_ids=members[key],
            first_index=first_index[key],
            earliest_ts=earliest_ts[key],
        )
        for key in order
    ]
    return sorted(
        units,
        key=lambda unit: (
            0 if unit.earliest_ts is not None else 1,
            unit.earliest_ts or 0,
            unit.first_index,
        ),
    )


def _split_units_into_chapters(units: Sequence[_Unit]) -> list[list[str]]:
    chapters: list[list[str]] = []
    current: list[str] = []
    current_count = 0
    current_start_ts: float | None = None

    for unit in units:
        if current and _starts_new_chapter(current_count, current_start_ts, unit):
            chapters.append(current)
            current = []
            current_count = 0
            current_start_ts = None

        current.extend(unit.photo_ids)
        current_count += unit.size
        if current_start_ts is None and unit.earliest_ts is not None:
            current_start_ts = unit.earliest_ts

    if current:
        chapters.append(current)
    return chapters


def _starts_new_chapter(
    current_count: int, current_start_ts: float | None, next_unit: _Unit
) -> bool:
    if current_count + next_unit.size > _MAX_CHAPTER_PHOTOS:
        return True
    if current_start_ts is None or next_unit.earliest_ts is None:
        return False
    return next_unit.earliest_ts - current_start_ts > _MAX_CHAPTER_SPAN_SECONDS


def _taken_at_timestamp(photo: V3AnalyzePhoto) -> float | None:
    value = photo.exif.takenAt if photo.exif else None
    if not value:
        return None
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


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
