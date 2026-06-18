"""Deterministic chaptering for the Agent analysis pipeline.

Chapters are seeded from two deterministic signals:
  1. `takenAt` (EXIF capture time) — segments split on a >6h time gap; photos
     without a parseable time fall into a separate untimed queue, ordered by
     upload order.
  2. `group_hint` (the vision group label) — splits a time segment into chapters
     by label, preserving first-seen order.

PRIVACY (architecture §3 D-GPS): time is the only capture-metadata signal; there
is no place / GPS dimension (`place` is always None).

WP1.2 (#181): the V2 union-find de-duplication machinery (cross-batch jaccard +
explicit duplicateOf folding) has been removed. It was dead in production — both
init and add-photos call sites always pass a single batch (`batch_id=0`) and
`duplicate_of=None`, so no fold ever fired (V2 init never de-dups within a single
batch, see v2_album._grouping_photos). Every photo is therefore `used=True` with
`duplicateOf=None`, which is exactly what production already produced. The
`used` / `duplicateOf` columns stay on V2Photo (V2 schema is frozen, deleted
wholesale in WP6.1) but are now always filled deterministically without union-find.
"""

from dataclasses import dataclass
from datetime import datetime
import re

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


@dataclass
class _ChapterSeed:
    label: str
    photo_ids: list[str]


_TIME_GAP_SECONDS = 6 * 60 * 60
_UTC_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")


def build_photo_pool_and_chapters(photos: list[GroupingPhoto]) -> tuple[list[V2Photo], list[V2Chapter]]:
    ordered = sorted(photos, key=lambda photo: photo.order)
    states = {photo.photo_id: _photo_state(photo) for photo in ordered}

    chapter_seeds = _build_chapter_seeds(list(states.values()))

    photo_pool = [
        V2Photo(
            photoId=state.source.photo_id,
            analysis=state.source.analysis,
            exif=V2Exif(takenAt=state.taken_at, place=None, order=state.source.order),
            duplicateOf=None,
            used=True,
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


def _build_clean_chapters(
    seeds: list[_ChapterSeed],
    states: dict[str, _PhotoState],
) -> list[V2Chapter]:
    cleaned = [seed for seed in seeds if seed.photo_ids]

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
