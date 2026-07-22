"""根据分章中间结果组装 Stage1 V3 layout tree。"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence

from ..layout import accent_color
from ....contracts.schemas import (
    V3AnalyzePhoto,
    V3Chapter,
    V3ChapterPhoto,
    V3LayoutTree,
)
from .schema import GroupingChapter, GroupingResult, UnplacedAssignments


def deterministic_chapter_label(
    *, taken_ats: Sequence[str], places: Sequence[str]
) -> str:
    """章标题的确定性派生:最常见地名 + 时间跨度。砍掉豆包识图后章不再有 AI 命名,
    这是 story 环节聊天卡片和 compose 环节上下文唯一的章标识。"""
    place = Counter(p for p in places if p).most_common(1)
    place_part = place[0][0] if place else ""
    stamps = sorted(t for t in taken_ats if t)
    if stamps:
        first = stamps[0][:7].replace("-", " 年 ") + " 月"
        time_part = first
    else:
        time_part = ""
    parts = [p for p in (time_part, place_part) if p]
    return " · ".join(parts) if parts else "这一段"


def assemble_stage1_tree(
    grouping: GroupingResult,
    assignments: UnplacedAssignments,
    photos_by_id: Mapping[str, V3AnalyzePhoto],
) -> V3LayoutTree:
    if not grouping.chapters:
        raise ValueError("Stage1 grouping produced no chapters")

    input_index = {photo_id: idx for idx, photo_id in enumerate(photos_by_id)}
    chapter_members = {
        chapter.chapterId: list(chapter.photoIds) for chapter in grouping.chapters
    }
    for chapter in assignments.newChapters:
        if chapter.chapterId in chapter_members:
            raise ValueError(f"new chapter id conflicts with existing chapter: {chapter.chapterId}")
        chapter_members[chapter.chapterId] = []
    target_ids = set(chapter_members)
    unplaced = set(grouping.unplacedPhotoIds)
    assigned_ids = set(assignments.assignments)

    missing = sorted(unplaced - assigned_ids)
    unknown = sorted(assigned_ids - unplaced)
    if missing or unknown:
        raise ValueError(
            f"unplaced assignments must cover exactly unplaced photos "
            f"(missing={missing}, unknown={unknown})"
        )
    for photo_id, chapter_id in assignments.assignments.items():
        if chapter_id not in target_ids:
            raise ValueError(f"unplaced assignment target does not exist: {chapter_id}")
        chapter_members[chapter_id].append(photo_id)

    seen: list[str] = []
    for chapter_id, members in chapter_members.items():
        members.sort(key=lambda pid: _photo_order(pid, photos_by_id, input_index))
        chapter_members[chapter_id] = members
        seen.extend(members)

    expected = set(photos_by_id)
    if set(seen) != expected or len(seen) != len(set(seen)):
        missing = sorted(expected - set(seen))
        duplicated = sorted(pid for pid in set(seen) if seen.count(pid) > 1)
        unknown = sorted(set(seen) - expected)
        raise ValueError(
            "Stage1 tree membership must cover each input photo exactly once "
            f"(missing={missing}, duplicated={duplicated}, unknown={unknown})"
        )

    chapters: list[V3Chapter] = []
    chapter_sources = list(grouping.chapters) + [
        GroupingChapter(chapterId=chapter.chapterId, photoIds=[])
        for chapter in assignments.newChapters
    ]
    for source in chapter_sources:
        members = chapter_members[source.chapterId]
        if not members:
            continue
        photos: list[V3ChapterPhoto] = []
        for photo_id in members:
            src = photos_by_id[photo_id]
            photos.append(
                V3ChapterPhoto(
                    photoId=photo_id,
                    # 砍掉豆包识图后不再有逐图场景描述,分析期恒为空串。
                    sceneDescription="",
                    width=src.width,
                    height=src.height,
                    orientation=_orientation(src.width, src.height),  # type: ignore[arg-type]
                    # 构图也是识图产物,没有识图就交给排版按朝向自行匹配。
                    composition=None,
                    takenAt=src.exif.takenAt if src.exif else None,
                )
            )
        chapters.append(
            V3Chapter(
                chapterId=source.chapterId,
                # 章标识:确定性派生(时间 + 地名)。契约暂无 title 字段,先落在
                # description 这个章级文本位上,后期写目录环节会覆盖它。
                description=deterministic_chapter_label(
                    taken_ats=[p.takenAt or "" for p in photos],
                    # 地名由 Web 采访环节写回 chapter.place,分析期无地名可用(§3 隐私:
                    # 坐标止步于浏览器,EXIF 只带 takenAt)。
                    places=[],
                ),
                # 关键词此前来自识图分章,砍掉后分析期为空,设计环节自行降级。
                keywords=[],
                extractedColor=accent_color.accent_of_group(members, photos_by_id),
                accentColor=None,
                artFont=None,
                photos=photos,
            )
        )

    if not chapters:
        raise ValueError("Stage1 tree produced no non-empty chapters")
    return V3LayoutTree(chapters=chapters)


def _orientation(width: int, height: int) -> str:
    if width > height * 1.05:
        return "landscape"
    if height > width * 1.05:
        return "portrait"
    return "square"


def _photo_order(
    photo_id: str,
    photos_by_id: Mapping[str, V3AnalyzePhoto],
    input_index: Mapping[str, int],
) -> tuple[int, str, int]:
    photo = photos_by_id[photo_id]
    taken_at = photo.exif.takenAt if photo.exif and photo.exif.takenAt else ""
    return (0 if taken_at else 1, taken_at, input_index.get(photo_id, len(input_index)))
