"""Stage1 确定性照片分组。

先按时间(有拍摄时间的默认 48h 一簇)和可选地点形成大段;簇内先走快速通道:
相邻拍摄间隔 ≤directGapHours 且浏览器测算的共址 clusterId 相同(非空)的照片
直接成组,不进视觉算法。剩余照片再用 CLIP embedding + 像素颜色特征做视觉
子分组;各簇的 CLIP 并发异步跑(visualConcurrency<=0 不封顶)。
子分组切出的单张离群照片进 unplaced,交给后续 AI 分章补完。
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import numpy as np

from ....contracts.schemas import V3AnalyzePhoto
from . import features
from .schema import GroupingChapter, GroupingParams, GroupingResult


@dataclass
class _Record:
    photo: V3AnalyzePhoto
    index: int
    reliable: bool
    timestamp: float | None
    gps: tuple[float, float] | None
    cluster: str | None
    b64: str


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

    # 簇内快速通道:相邻拍摄间隔 ≤directGapHours 且 clusterId 相同(非空)的连续
    # 照片直接成组,不进 CLIP+颜色;剩余照片作为残余小簇继续走视觉子分组。
    direct_runs: list[list[list[int]]] = []
    residual_cells: list[list[int]] = []
    for cell in chapter_cells:
        runs, residual = _direct_runs(cell, records, options.directGapHours * 3600)
        direct_runs.append(runs)
        residual_cells.append(residual)

    jobs = [
        (
            cell_index,
            cell,
            options.alphaIn if records[cell[0]].reliable else options.alphaOut,
            options.tauIn if records[cell[0]].reliable else options.tauOut,
        )
        for cell_index, cell in enumerate(residual_cells)
        if cell
    ]
    if len(jobs) > 1:
        # visualConcurrency <= 0 表示不封顶:有几个时间/地点簇就同时并发跑几个 CLIP。
        max_workers = (
            len(jobs)
            if options.visualConcurrency <= 0
            else min(options.visualConcurrency, len(jobs))
        )
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            grouped_cells = list(
                executor.map(
                    lambda job: (
                        job[0],
                        _subgroups(job[1], records, options, job[2], job[3]),
                    ),
                    jobs,
                )
            )
    else:
        grouped_cells = [
            (cell_index, _subgroups(cell, records, options, alpha, tau))
            for cell_index, cell, alpha, tau in jobs
        ]
    grouped_by_cell = dict(grouped_cells)

    groups: list[list[str]] = []
    unplaced: list[str] = []
    for cell_index, runs in enumerate(direct_runs):
        for run in runs:
            groups.append([records[index].photo.photoId for index in run])
        subgroups, outliers = grouped_by_cell.get(cell_index, ([], []))
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
        cluster=photo.clusterId,
        b64=photo.base64,
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


def _direct_runs(
    cell: list[int], records: list[_Record], gap_seconds: float
) -> tuple[list[list[int]], list[int]]:
    """簇内快速通道:按时间序扫一遍,相邻拍摄间隔 ≤gap 且共址 clusterId 相同
    (非空)的连续照片攒成一段;≥2 张的段直接成组,其余照片(含无拍摄时间/无
    clusterId 的)按原顺序归入残余,交给视觉子分组。clusterId 是浏览器端用
    EXIF 时间+GPS 在测算好的方位阈值内聚出的共址标签,Agent 拿不到坐标,
    它就是地点误差判断的唯一依据。"""
    runs: list[list[int]] = []
    residual: list[int] = []
    current: list[int] = []

    def flush() -> None:
        nonlocal current
        if len(current) >= 2:
            runs.append(current)
        else:
            residual.extend(current)
        current = []

    for index in cell:
        record = records[index]
        eligible = (
            record.reliable
            and record.timestamp is not None
            and record.cluster is not None
        )
        if not eligible:
            flush()
            residual.append(index)
            continue
        if current:
            prev = records[current[-1]]
            if (
                record.cluster == prev.cluster
                and record.timestamp - prev.timestamp <= gap_seconds
            ):
                current.append(index)
                continue
            flush()
        current.append(index)
    flush()
    return runs, residual


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

    # 惰性解码(2026-10-29):此前 _record 阶段全书每张都解码成 PIL Image 常驻
    # 记录,100 张书峰值多出整书位图;现在只在进入亚组分裂的 cell 内按需解码,
    # 不满足分裂条件的 cell 完全不解码,峰值被 cell 尺寸封顶。
    images = [features.image_from_data_url(records[index].b64) for index in cell]
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
    """预计算全对 fused 距离的 numpy 矩阵,返回与旧版同签名的闭包(行为等价)。

    2026-10-29 向量化:此前逐对纯 Python 点积/欧氏(n² 次 O(d) 循环)且 _agglo
    每轮全量重算簇间均值,同场景百张照片时是纯 Python O(n³)+;现在全对距离
    一次矩阵算出,聚合走 Lance-Williams 增量更新。"""
    E = np.asarray(emb, dtype=np.float64)
    P = np.asarray(pix, dtype=np.float64)
    clip = np.maximum(1.0 - E @ E.T, 0.0)
    diff = P[:, None, :] - P[None, :, :]
    pixd = np.sqrt(np.einsum("ijk,ijk->ij", diff, diff))
    iu = np.triu_indices(len(E), k=1)
    med_clip = float(np.median(clip[iu])) or 1.0
    med_pix = float(np.median(pixd[iu])) or 1.0
    C = clip / med_clip
    Q = pixd / med_pix

    def fused(i: int, j: int, alpha: float) -> float:
        return float(alpha * C[i, j] + (1.0 - alpha) * Q[i, j])

    return fused


def _agglo(idxs: list[int], fused, alpha: float, tau: float) -> list[list[int]]:
    """平均链接聚合。簇间距离 = 跨簇成员对距离的均值;合并用 Lance-Williams
    增量式 D_merge_l = (D_a_l·|a| + D_b_l·|b|)/(|a|+|b|),与逐对均值数学等价。
    平局取 (i,j) 字典序最小者,与旧版首见即留的扫描顺序一致。"""
    n = len(idxs)
    if n < 2:
        return [[index] for index in idxs]
    D = np.zeros((n, n), dtype=np.float64)
    for a in range(n):
        for b in range(a + 1, n):
            D[a, b] = D[b, a] = fused(a, b, alpha)
    members: list[list[int]] = [[index] for index in range(n)]
    while len(members) > 1:
        np.fill_diagonal(D, np.inf)
        flat = int(np.argmin(D))
        a, b = divmod(flat, D.shape[1])  # 对称矩阵行主序首个命中 ⇒ a < b
        if D[a, b] > tau:
            break
        # 就地合并到 a 槽位(旧版 clusters[best_i] += clusters[best_j] 的语义:
        # 平局扫描序下成员顺序与簇位置都保持不变,行为逐位等价)。
        na, nb = len(members[a]), len(members[b])
        row = (D[a] * na + D[b] * nb) / (na + nb)
        members[a] = members[a] + members[b]
        D[a] = row
        D[:, a] = row
        D = np.delete(np.delete(D, b, axis=0), b, axis=1)
        del members[b]
    return [[idxs[local] for local in group] for group in members]


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
