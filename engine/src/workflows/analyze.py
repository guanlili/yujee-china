"""V3 `/v3/analyze` Stage1 tree-only orchestration.

Stage1 now builds only a V3LayoutTree:
group_photos -> describe_chapters -> refine_unplaced -> accent_of_group.
Template selection, render pages, cover/ending wrapping, and generic copy belong to
later stages and are not produced by this job.
"""

from __future__ import annotations

import asyncio
import time

from ..api import callback
from .core.chaptering.chapter_describer import handler as chapter_describer
from .core.chaptering.vision_error import VisionError
from .core.chaptering import grouping as chapter_grouping
from .core.chaptering import refinement as chapter_refinement
from .core.chaptering import tree_builder
from ..logging_config import get_logger, request_id_var
from ..contracts.schemas import (
    V3AnalyzeCompleted,
    V3AnalyzeRequest,
    V3CallbackError,
    V3FailedEvent,
    V3JobStage,
    V3Models,
    V3ProgressEvent,
    V3Usage,
)
from ..settings import get_settings

log = get_logger("v3_album")

# 本地 CLIP/PyTorch 分组会吃 CPU/内存;单进程内一次只跑一个 embedding pass。
_GROUPING_SEMAPHORE = asyncio.Semaphore(1)


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


# ---------- analyze job -------------------------------------------------------


async def _run_analyze(job: _Job) -> None:
    req = job.req
    started = time.monotonic()
    prompt_hint = req.meta.promptHint if req.meta else None
    photos_by_id = {photo.photoId: photo for photo in req.photos}

    await _emit_progress(job, "group", 0)
    try:
        async with _GROUPING_SEMAPHORE:
            grouping = await asyncio.to_thread(chapter_grouping.group_photos, req.photos)
    except Exception as exc:  # noqa: BLE001
        log.exception("v3_analyze.group_failed", error=str(exc))
        await _emit_failure(
            job, code="AGENT_OUTPUT_VALIDATION", message=str(exc), stage="group"
        )
        return
    await _emit_progress(job, "group", 100)

    await _emit_progress(job, "describe", 0)
    try:
        described = await chapter_describer.describe_chapters(
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
        assignments = await chapter_refinement.refine_unplaced(
            grouping, described, photos_by_id, language=req.language
        )
        tree = tree_builder.assemble_stage1_tree(
            grouping, described, assignments, photos_by_id
        )
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
