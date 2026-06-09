"""Deterministic Stage 1 grouping and duplicate folding for Agent v2."""

from dataclasses import dataclass
from datetime import datetime
from math import inf
import re
from typing import Callable

from ..schemas_v2 import V2Chapter, V2Cluster, V2Exif, V2Photo, V2PhotoAnalysis


@dataclass(frozen=True)
class GroupingPhoto:
    photo_id: str
    analysis: V2PhotoAnalysis
    order: int
    batch_id: int | str = 0
    taken_at: str | None = None
    group_hint: str | None = None
    duplicate_of: str | None = None


@dataclass
class _PhotoState:
    source: GroupingPhoto
    taken_at_dt: datetime | None
    taken_at: str | None
    used: bool = True
    duplicate_of: str | None = None


@dataclass
class _ChapterSeed:
    label: str
    photo_ids: list[str]


_TIME_GAP_SECONDS = 6 * 60 * 60
_DUP_SECONDS = 3
_TAG_OVERLAP = 0.8
_QUALITY_RANK = {"fill": 0, "detail": 1, "hero": 2}
_UTC_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")


def build_photo_pool_and_chapters(photos: list[GroupingPhoto]) -> tuple[list[V2Photo], list[V2Chapter]]:
    ordered = sorted(photos, key=lambda photo: photo.order)
    states = {photo.photo_id: _photo_state(photo) for photo in ordered}

    chapter_seeds = _build_chapter_seeds(list(states.values()))
    _fold_duplicates(states)

    photo_pool = [
        V2Photo(
            photoId=state.source.photo_id,
            analysis=state.source.analysis,
            exif=V2Exif(takenAt=state.taken_at, place=None, order=state.source.order),
            duplicateOf=state.duplicate_of,
            used=state.used,
        )
        for state in sorted(states.values(), key=lambda item: item.source.order)
    ]

    chapters = _build_clean_chapters(chapter_seeds, states)
    return photo_pool, chapters


def _parse_taken_at(value: str | None) -> datetime | None:
    if value is None or not _UTC_ISO_RE.match(value):
        return None
    try:
        return datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        return None


def _photo_state(photo: GroupingPhoto) -> _PhotoState:
    taken_at_dt = _parse_taken_at(photo.taken_at)
    return _PhotoState(
        source=photo,
        taken_at_dt=taken_at_dt,
        taken_at=photo.taken_at if taken_at_dt is not None else None,
        duplicate_of=photo.duplicate_of if photo.duplicate_of else None,
    )


def _build_chapter_seeds(states: list[_PhotoState]) -> list[_ChapterSeed]:
    timed = sorted(
        (state for state in states if state.taken_at_dt is not None),
        key=lambda state: (state.taken_at_dt, state.source.order),
    )
    untimed = sorted(
        (state for state in states if state.taken_at_dt is None),
        key=lambda state: state.source.order,
    )

    chapters: list[_ChapterSeed] = []
    current_segment: list[_PhotoState] = []
    last_taken_at: datetime | None = None
    for state in timed:
        assert state.taken_at_dt is not None
        if (
            not current_segment
            or last_taken_at is None
            or (state.taken_at_dt - last_taken_at).total_seconds() > _TIME_GAP_SECONDS
        ):
            if current_segment:
                chapters.extend(_split_by_group_hint(current_segment))
            current_segment = []
        current_segment.append(state)
        last_taken_at = state.taken_at_dt
    if current_segment:
        chapters.extend(_split_by_group_hint(current_segment))

    chapters.extend(_split_by_group_hint(untimed))
    return chapters


def _split_by_group_hint(states: list[_PhotoState]) -> list[_ChapterSeed]:
    seeds: list[_ChapterSeed] = []
    index_by_key: dict[tuple[int | str, str], int] = {}
    for state in states:
        key = (state.source.batch_id, _group_hint_key(state.source.group_hint))
        if key not in index_by_key:
            index_by_key[key] = len(seeds)
            seeds.append(_ChapterSeed(label=_group_hint_label(state.source.group_hint), photo_ids=[]))
        seeds[index_by_key[key]].photo_ids.append(state.source.photo_id)
    return seeds


def _group_hint_key(value: str | None) -> str:
    stripped = (value or "").strip()
    return stripped.casefold() if stripped else "__ungrouped__"


def _group_hint_label(value: str | None) -> str:
    return (value or "").strip() or "Photos"


def _fold_duplicates(states: dict[str, _PhotoState]) -> None:
    parent = {photo_id: photo_id for photo_id in states}

    def find(photo_id: str) -> str:
        root = photo_id
        while parent[root] != root:
            root = parent[root]
        while parent[photo_id] != photo_id:
            photo_id, parent[photo_id] = parent[photo_id], root
        return root

    def union(a: str, b: str) -> None:
        root_a = find(a)
        root_b = find(b)
        if root_a != root_b:
            parent[root_b] = root_a

    explicit_targets: set[str] = set()
    for photo_id, state in states.items():
        if (
            state.duplicate_of in states
            and state.duplicate_of != photo_id
            and states[state.duplicate_of].source.batch_id == state.source.batch_id
        ):
            explicit_targets.add(state.duplicate_of)
            union(photo_id, state.duplicate_of)

    timed = sorted(
        (state for state in states.values() if state.taken_at_dt is not None),
        key=lambda state: (state.taken_at_dt, state.source.order),
    )
    for idx, left in enumerate(timed):
        assert left.taken_at_dt is not None
        for right in timed[idx + 1 :]:
            assert right.taken_at_dt is not None
            if (right.taken_at_dt - left.taken_at_dt).total_seconds() >= _DUP_SECONDS:
                break
            if (
                left.source.batch_id != right.source.batch_id
                and _tag_jaccard(left.source.analysis.tags, right.source.analysis.tags) > _TAG_OVERLAP
                and not _cross_union_would_merge_same_batch(
                    left.source.photo_id,
                    right.source.photo_id,
                    states,
                    find,
                )
            ):
                union(left.source.photo_id, right.source.photo_id)

    clusters: dict[str, list[_PhotoState]] = {}
    for photo_id, state in states.items():
        clusters.setdefault(find(photo_id), []).append(state)

    for cluster in clusters.values():
        representative = min(
            _representative_candidates(cluster, explicit_targets),
            key=_representative_sort_key,
        )
        representative.used = True
        representative.duplicate_of = None
        for state in cluster:
            if state is representative:
                continue
            state.used = False
            state.duplicate_of = representative.source.photo_id


def _tag_jaccard(left: list[str], right: list[str]) -> float:
    left_set = {tag.strip().casefold() for tag in left if tag.strip()}
    right_set = {tag.strip().casefold() for tag in right if tag.strip()}
    if not left_set or not right_set:
        return 0.0
    return len(left_set & right_set) / len(left_set | right_set)


def _cross_union_would_merge_same_batch(
    left_id: str,
    right_id: str,
    states: dict[str, _PhotoState],
    find: Callable[[str], str],
) -> bool:
    left_root = find(left_id)
    right_root = find(right_id)
    if left_root == right_root:
        return False
    left_batches = {
        state.source.batch_id for photo_id, state in states.items() if find(photo_id) == left_root
    }
    right_batches = {
        state.source.batch_id for photo_id, state in states.items() if find(photo_id) == right_root
    }
    return bool(left_batches & right_batches)


def _representative_sort_key(state: _PhotoState) -> tuple[int, float, int]:
    rank = _QUALITY_RANK.get(state.source.analysis.quality, 1)
    timestamp = state.taken_at_dt.timestamp() if state.taken_at_dt is not None else inf
    return (-rank, timestamp, state.source.order)


def _representative_candidates(
    cluster: list[_PhotoState],
    explicit_targets: set[str],
) -> list[_PhotoState]:
    by_batch: dict[int | str, list[_PhotoState]] = {}
    for state in cluster:
        by_batch.setdefault(state.source.batch_id, []).append(state)

    candidates: list[_PhotoState] = []
    for batch_members in by_batch.values():
        explicit_batch_targets = [
            state for state in batch_members if state.source.photo_id in explicit_targets
        ]
        candidates.append(min(explicit_batch_targets or batch_members, key=_representative_sort_key))
    return candidates


def _build_clean_chapters(
    seeds: list[_ChapterSeed],
    states: dict[str, _PhotoState],
) -> list[V2Chapter]:
    cleaned = [
        _ChapterSeed(
            label=seed.label,
            photo_ids=[photo_id for photo_id in seed.photo_ids if states[photo_id].used],
        )
        for seed in seeds
    ]
    cleaned = [seed for seed in cleaned if seed.photo_ids]

    chapters: list[V2Chapter] = []
    for idx, seed in enumerate(cleaned):
        role = "body"
        if idx == 0:
            role = "opening"
        if idx == len(cleaned) - 1:
            role = "closing"
        chapters.append(
            V2Chapter(
                chapterId=f"ch{idx + 1}",
                state="empty",
                cluster=V2Cluster(
                    label=seed.label,
                    timeRange=_time_range([states[photo_id] for photo_id in seed.photo_ids]),
                    place=None,
                    role=role,  # type: ignore[arg-type]
                ),
                photoIds=seed.photo_ids,
                pages=[],
            )
        )
    return chapters


def _time_range(states: list[_PhotoState]) -> str | None:
    dates = sorted(state.taken_at_dt for state in states if state.taken_at_dt is not None)
    if not dates:
        return None
    if dates[0] == dates[-1]:
        return _isoformat_utc(dates[0])
    return f"{_isoformat_utc(dates[0])}..{_isoformat_utc(dates[-1])}"


def _isoformat_utc(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")
