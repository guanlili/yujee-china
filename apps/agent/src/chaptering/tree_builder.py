"""根据分章中间结果组装 Stage1 V3 layout tree。"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from ..agents.chapter_describer.schema import DescribeResult
from ..engine import accent_color
from ..schemas import (
    V3AnalyzePhoto,
    V3Chapter,
    V3ChapterPhoto,
    V3LayoutTree,
)
from .schema import GroupingChapter, GroupingResult, UnplacedAssignments


def assemble_stage1_tree(
    grouping: GroupingResult,
    descriptions: DescribeResult,
    assignments: UnplacedAssignments,
    photos_by_id: Mapping[str, V3AnalyzePhoto],
) -> V3LayoutTree:
    if not grouping.chapters:
        raise ValueError("Stage1 grouping produced no chapters")

    input_index = {photo_id: idx for idx, photo_id in enumerate(photos_by_id)}
    new_by_id = {chapter.chapterId: chapter for chapter in assignments.newChapters}
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
        description = _chapter_description(
            source.chapterId,
            descriptions,
            new_by_id,
        )
        photos: list[V3ChapterPhoto] = []
        for photo_id in members:
            src = photos_by_id[photo_id]
            scene = _photo_scene_description(
                photo_id,
                source.chapterId,
                descriptions,
                new_by_id,
            )
            photos.append(
                V3ChapterPhoto(
                    photoId=photo_id,
                    sceneDescription=scene,
                    width=src.width,
                    height=src.height,
                    orientation=_orientation(src.width, src.height),  # type: ignore[arg-type]
                    composition=descriptions.imageCompositions.get(photo_id),  # type: ignore[arg-type]
                    takenAt=src.exif.takenAt if src.exif else None,
                )
            )
        chapters.append(
            V3Chapter(
                chapterId=source.chapterId,
                description=description,
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


def _required_text(value: Any, *, field: str, max_len: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    text = value.strip()
    if not text:
        raise ValueError(f"{field} is required")
    if len(text) > max_len:
        raise ValueError(f"{field} exceeds {max_len} chars")
    return text


def _chapter_description(
    chapter_id: str,
    descriptions: DescribeResult,
    new_by_id: Mapping[str, Any],
) -> str:
    # 章节 description 是目录(TOC)占位:分析期统一留空,后期写目录环节才填。
    return ""


def _photo_scene_description(
    photo_id: str,
    chapter_id: str,
    descriptions: DescribeResult,
    new_by_id: Mapping[str, Any],
) -> str:
    if photo_id in descriptions.imageDescriptions:
        return _required_text(
            descriptions.imageDescriptions.get(photo_id),
            field=f"{photo_id}.sceneDescription",
            max_len=300,
        )

    new_chapter = new_by_id.get(chapter_id)
    if new_chapter is not None:
        return _required_text(
            new_chapter.chapterVisualSummary,
            field=f"{photo_id}.sceneDescription",
            max_len=300,
        )

    fallback = descriptions.chapterVisualSummaries.get(chapter_id)
    return _required_text(
        fallback,
        field=f"{photo_id}.sceneDescription",
        max_len=300,
    )


def _photo_order(
    photo_id: str,
    photos_by_id: Mapping[str, V3AnalyzePhoto],
    input_index: Mapping[str, int],
) -> tuple[int, str, int]:
    photo = photos_by_id[photo_id]
    taken_at = photo.exif.takenAt if photo.exif and photo.exif.takenAt else ""
    return (0 if taken_at else 1, taken_at, input_index.get(photo_id, len(input_index)))
