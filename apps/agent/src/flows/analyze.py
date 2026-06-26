"""V3 `/v3/analyze` Stage1 tree-only orchestration.

Stage1 now builds only a V3LayoutTree:
group_photos -> describe_chapters -> group_unplaced -> accent_of_group.
Template selection, render pages, cover/ending wrapping, and generic copy belong to
later stages and are not produced by this job.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Mapping
from typing import Any

from .. import callback
from ..agents.image_grouping import handler as image_grouping
from ..agents.image_grouping.schema import GroupingResult
from ..agents.image_understanding import VisionError
from ..agents.image_understanding import handler as vision
from ..agents.image_understanding.schema import DescribeResult
from ..agents.regroup_unplaced import handler as regroup_unplaced
from ..agents.regroup_unplaced.schema import UnplacedAssignments
from ..engine import accent_color
from ..logging_config import get_logger, request_id_var
from ..schemas import (
    V3AnalyzePhoto,
    V3AnalyzeCompleted,
    V3AnalyzeRequest,
    V3CallbackError,
    V3Chapter,
    V3ChapterPhoto,
    V3FailedEvent,
    V3JobStage,
    V3LayoutTree,
    V3Models,
    V3ProgressEvent,
    V3Usage,
)
from ..settings import get_settings

log = get_logger("v3_album")


class _Job:
    """Per-analyze-job holder for active-stage failure reporting."""

    def __init__(self, req: V3AnalyzeRequest) -> None:
        self.req = req
        self.active_stage: V3JobStage | None = None


# ---------- callback helpers --------------------------------------------------


async def _emit_progress(job: _Job, stage: V3JobStage, progress: int) -> None:
    job.active_stage = stage
    envelope = V3ProgressEvent(
        event="progress",
        jobKind="analyze",
        requestId=job.req.requestId,
        stage=stage,
        progress=progress,
    )
    await callback.post(str(job.req.callbackUrl), envelope)


async def _emit_failure(
    job: _Job,
    *,
    code: str,
    message: str,
    stage: V3JobStage | None = None,
) -> None:
    if stage is not None:
        try:
            await _emit_progress(job, stage, 0)
        except Exception as exc:  # noqa: BLE001
            log.warning("v3_analyze.pre_fail_progress_error", error=str(exc))

    envelope = V3FailedEvent(
        event="failed",
        jobKind="analyze",
        requestId=job.req.requestId,
        error=V3CallbackError(code=code, message=message[:500]),
        **({"stage": stage} if stage is not None else {}),
    )
    await callback.post(str(job.req.callbackUrl), envelope)


# ---------- tree assembly -----------------------------------------------------


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


def _photo_order(
    photo_id: str,
    photos_by_id: Mapping[str, V3AnalyzePhoto],
    input_index: Mapping[str, int],
) -> tuple[int, str, int]:
    photo = photos_by_id[photo_id]
    taken_at = photo.exif.takenAt if photo.exif and photo.exif.takenAt else ""
    return (0 if taken_at else 1, taken_at, input_index.get(photo_id, len(input_index)))


def _assemble_stage1_tree(
    grouping: GroupingResult,
    descriptions: DescribeResult,
    assignments: UnplacedAssignments,
    photos_by_id: Mapping[str, V3AnalyzePhoto],
) -> V3LayoutTree:
    if not grouping.chapters:
        raise ValueError("Stage1 grouping produced no chapters")

    input_index = {photo_id: idx for idx, photo_id in enumerate(photos_by_id)}
    chapter_members = {
        chapter.chapterId: list(chapter.photoIds) for chapter in grouping.chapters
    }
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
    for source in grouping.chapters:
        members = chapter_members[source.chapterId]
        if not members:
            continue
        description = _required_text(
            descriptions.chapterDescriptions.get(source.chapterId),
            field=f"{source.chapterId}.description",
            max_len=600,
        )
        photos: list[V3ChapterPhoto] = []
        for photo_id in members:
            src = photos_by_id[photo_id]
            scene = _required_text(
                descriptions.imageDescriptions.get(photo_id),
                field=f"{photo_id}.sceneDescription",
                max_len=300,
            )
            photos.append(
                V3ChapterPhoto(
                    photoId=photo_id,
                    sceneDescription=scene,
                    width=src.width,
                    height=src.height,
                    orientation=_orientation(src.width, src.height),  # type: ignore[arg-type]
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


# ---------- analyze job -------------------------------------------------------


async def _run_analyze(job: _Job) -> None:
    req = job.req
    started = time.monotonic()
    prompt_hint = req.meta.promptHint if req.meta else None
    photos_by_id = {photo.photoId: photo for photo in req.photos}

    await _emit_progress(job, "group", 0)
    try:
        grouping = image_grouping.group_photos(req.photos)
    except Exception as exc:  # noqa: BLE001
        log.exception("v3_analyze.group_failed", error=str(exc))
        await _emit_failure(
            job, code="AGENT_OUTPUT_VALIDATION", message=str(exc), stage="group"
        )
        return
    await _emit_progress(job, "group", 100)

    await _emit_progress(job, "describe", 0)
    try:
        described = await vision.describe_chapters(
            grouping,
            photos_by_id,
            language=req.language,
            prompt_hint=prompt_hint,
        )
    except VisionError as exc:
        log.warning("v3_analyze.describe_failed", error=str(exc))
        await _emit_failure(job, code="AGENT_VISION_FAILED", message=str(exc), stage="describe")
        return
    except Exception as exc:  # noqa: BLE001
        log.exception("v3_analyze.describe_unhandled", error=str(exc))
        await _emit_failure(job, code="AGENT_VISION_FAILED", message=str(exc), stage="describe")
        return
    await _emit_progress(job, "describe", 100)

    await _emit_progress(job, "group", 0)
    try:
        assignments = regroup_unplaced.group_unplaced(
            grouping, described, photos_by_id, language=req.language
        )
        tree = _assemble_stage1_tree(grouping, described, assignments, photos_by_id)
    except Exception as exc:  # noqa: BLE001
        log.exception("v3_analyze.regroup_or_assemble_failed", error=str(exc))
        await _emit_failure(
            job, code="AGENT_OUTPUT_VALIDATION", message=str(exc), stage="group"
        )
        return
    await _emit_progress(job, "group", 100)

    duration_ms = int((time.monotonic() - started) * 1000)
    envelope = V3AnalyzeCompleted(
        event="completed",
        jobKind="analyze",
        requestId=req.requestId,
        tree=tree,
        usage=V3Usage(
            durationMs=duration_ms,
            visionCallCount=described.call_count,
            models=V3Models(**({"vision": described.model} if described.model else {})),
        ),
    )
    await callback.post(str(req.callbackUrl), envelope)
    log.info(
        "v3_analyze.completed",
        duration_ms=duration_ms,
        chapters=len(tree.chapters),
    )


async def run_with_timeout(req: V3AnalyzeRequest) -> None:
    """Background-task entry point with stage-aware timeout/error callbacks."""
    settings = get_settings()
    job = _Job(req)
    token = request_id_var.set(req.requestId)
    try:
        try:
            await asyncio.wait_for(
                _run_analyze(job), timeout=settings.background_task_timeout_seconds
            )
        except asyncio.TimeoutError:
            log.error("v3_analyze.timeout")
            await _emit_failure(
                job,
                code="AGENT_TIMEOUT",
                message="background task exceeded timeout",
                stage=job.active_stage,
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("v3_analyze.unhandled", error=str(exc))
            await _emit_failure(
                job,
                code="AGENT_INTERNAL_ERROR",
                message=str(exc),
                stage=job.active_stage,
            )
    finally:
        request_id_var.reset(token)
