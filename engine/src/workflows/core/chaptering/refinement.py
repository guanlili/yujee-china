"""AI 辅助分章修正。

这个模块只负责分章业务规则:散落照片可以进已有章节,也可以形成 AI 新增章节。
真实模型调用由 `unplaced_refiner`(本包内) 提供;模型失败或输出不合法时回退
`unplaced.py` 的确定性归章策略。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from typing import TypeAlias

from ....providers import ai_client
from .chapter_describer.schema import DescribeResult
from ....logging_config import get_logger
from ....contracts.schemas import V3AnalyzePhoto
from .schema import GroupingResult, NewChapter, UnplacedAssignments
from .unplaced import group_unplaced

AssignUnplaced: TypeAlias = Callable[
    [GroupingResult, DescribeResult, Mapping[str, V3AnalyzePhoto]],
    Awaitable[UnplacedAssignments],
]

log = get_logger("chaptering.refinement")


async def refine_unplaced(
    grouping: GroupingResult,
    descriptions: DescribeResult,
    photos_by_id: Mapping[str, V3AnalyzePhoto],
    *,
    language: str,
    assigner: AssignUnplaced | None = None,
) -> UnplacedAssignments:
    """返回散落照片的最终归章,允许 AI 新增章节。"""
    if not grouping.unplacedPhotoIds:
        ai_client.trace_marker(
            "refine-unplaced skipped",
            input="unplacedPhotoIds=[]",
            output="没有散落照片,无需调用补充分章 AI。",
        )
        return UnplacedAssignments(assignments={})

    if assigner is None:
        from .unplaced_refiner import handler as unplaced_refiner

        assigner = unplaced_refiner.assign_unplaced_to_chapters

    try:
        result = await assigner(
            grouping,
            descriptions,
            photos_by_id,
            language=language,  # type: ignore[call-arg]
        )
        _validate_refinement(result, grouping)
        return result
    except Exception as exc:  # noqa: BLE001
        log.warning("chaptering_refinement.ai_fallback", error=str(exc)[:200])
        ai_client.trace_marker(
            "refine-unplaced fallback",
            input=f"unplacedPhotoIds={grouping.unplacedPhotoIds}; reason={str(exc)[:300]}",
            output="使用确定性归章策略 group_unplaced。",
        )
        return group_unplaced(grouping, descriptions, photos_by_id, language=language)


def _validate_refinement(
    result: UnplacedAssignments,
    grouping: GroupingResult,
) -> None:
    unplaced = set(grouping.unplacedPhotoIds)
    assigned = set(result.assignments)
    if assigned != unplaced:
        missing = sorted(unplaced - assigned)
        unknown = sorted(assigned - unplaced)
        raise ValueError(
            "AI refinement must assign every unplaced photo exactly once "
            f"(missing={missing}, unknown={unknown})"
        )

    existing_ids = {chapter.chapterId for chapter in grouping.chapters}
    new_ids: set[str] = set()
    for chapter in result.newChapters:
        _validate_new_chapter(chapter)
        if chapter.chapterId in existing_ids:
            raise ValueError(f"AI new chapter conflicts with existing id: {chapter.chapterId}")
        if chapter.chapterId in new_ids:
            raise ValueError(f"AI duplicated new chapter id: {chapter.chapterId}")
        new_ids.add(chapter.chapterId)

    target_ids = existing_ids | new_ids
    for photo_id, chapter_id in result.assignments.items():
        if chapter_id not in target_ids:
            raise ValueError(f"AI assignment target does not exist: {chapter_id}")

    for chapter in result.newChapters:
        if not chapter.photoIds:
            raise ValueError(f"AI new chapter has no photos: {chapter.chapterId}")
        for photo_id in chapter.photoIds:
            if photo_id not in unplaced:
                raise ValueError(f"AI new chapter references non-unplaced photo: {photo_id}")
            if result.assignments.get(photo_id) != chapter.chapterId:
                raise ValueError(
                    f"AI new chapter photo assignment mismatch: {photo_id}"
                )


def _validate_new_chapter(chapter: NewChapter) -> None:
    if not chapter.chapterId:
        raise ValueError("AI new chapter id is required")
    if not chapter.chapterVisualSummary.strip():
        raise ValueError(f"AI new chapter visual summary is required: {chapter.chapterId}")
    if not chapter.chapterKeywords:
        raise ValueError(f"AI new chapter keywords are required: {chapter.chapterId}")
