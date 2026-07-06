"""把 Stage1 未归章照片分配到已有章节。

这个模块目前实现 Stage1 契约要求的确定性无模型兜底逻辑。
它保持未归章 cluster 的原子性,并按 EXIF 时间把每个 cluster 分配到最近的已有章节;
距离相同时按稳定的章节顺序打破平局。
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime

from .chapter_describer.schema import DescribeResult
from ....schemas import V3AnalyzePhoto
from .schema import GroupingResult, UnplacedAssignments


def group_unplaced(
    grouping: GroupingResult,
    descriptions: DescribeResult,
    photos_by_id: Mapping[str, V3AnalyzePhoto],
    *,
    language: str,
) -> UnplacedAssignments:
    if not grouping.chapters:
        raise ValueError("regroup_unplaced requires at least one chapter")
    if not grouping.unplacedPhotoIds:
        return UnplacedAssignments(assignments={})

    _ = descriptions, language
    by_cluster: dict[str, list[str]] = {}
    for index, photo_id in enumerate(grouping.unplacedPhotoIds):
        photo = photos_by_id.get(photo_id)
        cluster_key = (
            photo.clusterId
            if photo and photo.clusterId is not None
            else f"__single:{index}"
        )
        by_cluster.setdefault(cluster_key, []).append(photo_id)

    assignments: dict[str, str] = {}
    for photo_ids in by_cluster.values():
        target = _nearest_chapter(photo_ids, grouping, photos_by_id)
        for photo_id in photo_ids:
            assignments[photo_id] = target
    return UnplacedAssignments(assignments=assignments)


def _nearest_chapter(
    photo_ids: list[str],
    grouping: GroupingResult,
    photos_by_id: Mapping[str, V3AnalyzePhoto],
) -> str:
    cluster_time = _earliest_timestamp(
        _taken_at(photos_by_id.get(photo_id)) for photo_id in photo_ids
    )
    cluster_pos = _mean_position(photo_ids, photos_by_id)

    best_id = grouping.chapters[0].chapterId
    best_key: tuple[float, int] | None = None
    for index, chapter in enumerate(grouping.chapters):
        chapter_time = _mean_timestamp(
            _taken_at(photos_by_id.get(photo_id)) for photo_id in chapter.photoIds
        )
        if cluster_time is not None and chapter_time is not None:
            distance = abs(cluster_time - chapter_time)
        else:
            chapter_pos = _mean_position(chapter.photoIds, photos_by_id)
            distance = abs(cluster_pos - chapter_pos)
        key = (distance, index)
        if best_key is None or key < best_key:
            best_key = key
            best_id = chapter.chapterId
    return best_id


def _taken_at(photo: V3AnalyzePhoto | None) -> float | None:
    value = photo.exif.takenAt if photo and photo.exif else None
    if not value:
        return None
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        return datetime.fromisoformat(normalized).timestamp()
    except ValueError:
        return None


def _mean_timestamp(values) -> float | None:
    present = [value for value in values if value is not None]
    if not present:
        return None
    return sum(present) / len(present)


def _earliest_timestamp(values) -> float | None:
    present = [value for value in values if value is not None]
    if not present:
        return None
    return min(present)


def _mean_position(
    photo_ids: list[str], photos_by_id: Mapping[str, V3AnalyzePhoto]
) -> float:
    order = {photo_id: index for index, photo_id in enumerate(photos_by_id)}
    positions = [order.get(photo_id, len(order)) for photo_id in photo_ids]
    if not positions:
        return float(len(order))
    return sum(positions) / len(positions)
