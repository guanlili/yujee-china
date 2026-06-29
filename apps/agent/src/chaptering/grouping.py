"""Stage1 确定性照片分组。

先按时间和可选地点形成大段,再用 CLIP embedding + 像素颜色特征对大段做视觉子分组。
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from PIL import Image

from ..schemas import V3AnalyzePhoto
from . import features
from .schema import GroupingChapter, GroupingParams, GroupingResult


@dataclass
class _Record:
    photo: V3AnalyzePhoto
    index: int
    reliable: bool
    timestamp: float | None
    gps: tuple[float, float] | None
    image: Image.Image


def group_photos(
    photos: Sequence[V3AnalyzePhoto], params: GroupingParams | Any | None = None
) -> GroupingResult:
    """返回 Stage1 的确定性章节归属。"""
    options = GroupingParams.from_input(params)
    if not photos:
        return GroupingResult(
            chapters=[GroupingChapter(chapterId="ch_1", photoIds=[])],
            unplacedPhotoIds=[],
        )

    records = [_record(photo, index) for index, photo in enumerate(photos)]
    records.sort(
        key=lambda item: (
            0 if item.timestamp is not None else 1,
            item.timestamp or 0,
            item.index,
        )
    )

    reliable = [idx for idx, record in enumerate(records) if record.reliable]
    unreliable = [idx for idx, record in enumerate(records) if not record.reliable]

    chapter_cells: list[list[int]] = []
    for cell in _chain(reliable, records, options.timeGapDays * 86400):
        chapter_cells.extend(_place_split(cell, records, options.placeKm))
    chapter_cells.extend(_chain(unreliable, records, options.exportGapHours * 3600))

    jobs = [
        (
            cell,
            options.alphaIn if records[cell[0]].reliable else options.alphaOut,
            options.tauIn if records[cell[0]].reliable else options.tauOut,
        )
        for cell in chapter_cells
    ]
    if len(jobs) > 1 and options.visualConcurrency > 1:
        max_workers = min(options.visualConcurrency, len(jobs))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            grouped_cells = list(
                executor.map(
                    lambda job: _subgroups(job[0], records, options, job[1], job[2]),
                    jobs,
                )
            )
    else:
        grouped_cells = [
            _subgroups(cell, records, options, alpha, tau)
            for cell, alpha, tau in jobs
        ]

    groups: list[list[str]] = []
    unplaced: list[str] = []
    for subgroups, outliers in grouped_cells:
        for subgroup in subgroups:
            groups.append([records[index].photo.photoId for index in subgroup])
        unplaced.extend(records[index].photo.photoId for index in outliers)

    if not groups:
        groups = [[record.photo.photoId for record in records]]
        unplaced = []

    result = GroupingResult(
        chapters=[
            GroupingChapter(chapterId=f"ch_{index + 1}", photoIds=photo_ids)
            for index, photo_ids in enumerate(groups)
        ],
        unplacedPhotoIds=unplaced,
    )
    validate_grouping_result(result, photos)
    return result


def _record(photo: V3AnalyzePhoto, index: int) -> _Record:
    exif = photo.exif
    taken_ts = _timestamp(exif.takenAt if exif else None)
    exported_ts = _timestamp(getattr(exif, "exportedAt", None) if exif else None)
    gps = _gps_tuple(getattr(exif, "gps", None) if exif else None)
    explicit_reliable = getattr(exif, "captureReliable", None) if exif else None
    reliable = (
        bool(explicit_reliable)
        if explicit_reliable is not None
        else bool(
            taken_ts is not None
            or gps
            or (exif and (getattr(exif, "cameraMake", None) or getattr(exif, "cameraModel", None)))
        )
    )
    timestamp = taken_ts if reliable else exported_ts
    if timestamp is None:
        timestamp = exported_ts if reliable else taken_ts
    return _Record(
        photo=photo,
        index=index,
        reliable=reliable,
        timestamp=timestamp,
        gps=gps,
        image=features.image_from_data_url(photo.base64),
    )


def _timestamp(value: str | None) -> float | None:
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


def _gps_tuple(value: Any) -> tuple[float, float] | None:
    if value is None:
        return None
    if isinstance(value, dict):
        return (float(value["lat"]), float(value["lng"]))
    return (float(value.lat), float(value.lng))


def _chain(idxs: list[int], records: list[_Record], gap_seconds: float) -> list[list[int]]:
    if not idxs:
        return []
    segments = [[idxs[0]]]
    for previous, current in zip(idxs, idxs[1:]):
        prev_ts = records[previous].timestamp
        cur_ts = records[current].timestamp
        opens = (
            prev_ts is not None
            and cur_ts is not None
            and cur_ts - prev_ts > gap_seconds
        )
        if opens:
            segments.append([current])
        else:
            segments[-1].append(current)
    return segments


def _place_split(cell: list[int], records: list[_Record], km: float) -> list[list[int]]:
    out: list[list[int]] = []
    for index in cell:
        placed = False
        for group in out:
            ref = next((candidate for candidate in group if records[candidate].gps), None)
            if (
                records[index].gps is None
                or ref is None
                or _haversine(records[index].gps, records[ref].gps) <= km
            ):
                group.append(index)
                placed = True
                break
        if not placed:
            out.append([index])
    return out


def _haversine(p: tuple[float, float] | None, q: tuple[float, float] | None) -> float:
    if p is None or q is None:
        return 0.0
    radius = 6371.0
    lat1, lon1 = p
    lat2, lon2 = q
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return 2 * radius * math.asin(math.sqrt(a))


def _subgroups(
    cell: list[int],
    records: list[_Record],
    params: GroupingParams,
    alpha: float,
    tau: float,
) -> tuple[list[list[int]], list[int]]:
    if (
        len(cell) < 2
        or len(cell) < params.subsplitMin
        or len(cell) < params.clipMinPhotos
    ):
        return [cell], []

    images = [records[index].image for index in cell]
    with ThreadPoolExecutor(max_workers=2) as executor:
        emb_future = executor.submit(features.clip_embeddings, images)
        pix_future = executor.submit(lambda: [features.pix_feat(image) for image in images])
        emb = emb_future.result()
        pix = pix_future.result()
    fused = _make_fused(emb, pix)
    clusters = _agglo(list(range(len(cell))), fused, alpha, tau)
    pos = {local: local for local in range(len(cell))}

    big = [cluster for cluster in clusters if len(cluster) >= 2]
    singles = [cluster[0] for cluster in clusters if len(cluster) == 1]
    big.sort(key=lambda group: min(pos[index] for index in group))

    out = [[cell[local] for local in group] for group in big]
    if not out:
        return [cell], []
    outliers = [cell[local] for local in sorted(singles, key=lambda item: pos[item])]
    return out, outliers


def _make_fused(emb: list[list[float]], pix: list[list[float]]):
    dclip: list[float] = []
    dpix: list[float] = []
    for i in range(len(emb)):
        for j in range(i + 1, len(emb)):
            dclip.append(max(1 - _dot(emb[i], emb[j]), 0.0))
            dpix.append(_euclidean(pix[i], pix[j]))
    med_clip = _median(dclip) or 1.0
    med_pix = _median(dpix) or 1.0

    def fused(i: int, j: int, alpha: float) -> float:
        clip_distance = max(1 - _dot(emb[i], emb[j]), 0.0) / med_clip
        pix_distance = _euclidean(pix[i], pix[j]) / med_pix
        return alpha * clip_distance + (1 - alpha) * pix_distance

    return fused


def _agglo(idxs: list[int], fused, alpha: float, tau: float) -> list[list[int]]:
    clusters = [[index] for index in idxs]
    while len(clusters) > 1:
        best: float | None = None
        best_i = best_j = -1
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                distances = [
                    fused(a, b, alpha)
                    for a in clusters[i]
                    for b in clusters[j]
                ]
                distance = sum(distances) / len(distances)
                if best is None or distance < best:
                    best = distance
                    best_i, best_j = i, j
        if best is None or best > tau:
            break
        clusters[best_i] += clusters[best_j]
        del clusters[best_j]
    return clusters


def _dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right))


def _euclidean(left: list[float], right: list[float]) -> float:
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(left, right)))


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


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
    chapter_ids: set[str] = set()
    for chapter in result.chapters:
        if not chapter.chapterId:
            raise ValueError("grouping chapterId must be non-empty")
        if chapter.chapterId in chapter_ids:
            raise ValueError(f"duplicated chapterId: {chapter.chapterId}")
        chapter_ids.add(chapter.chapterId)
        placed.extend(chapter.photoIds)

    for photo_id in result.unplacedPhotoIds:
        placed.append(photo_id)

    if set(placed) != expected_set:
        missing = sorted(expected_set - set(placed))
        unknown = sorted(set(placed) - expected_set)
        raise ValueError(
            "grouping must cover exactly the input photos"
            f" (missing={missing}, unknown={unknown})"
        )
    if len(placed) != len(set(placed)):
        raise ValueError("grouping must not duplicate photoIds")
