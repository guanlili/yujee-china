"""V3 `/v3/select-layout` Stage2 async orchestration."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from .. import callback
from ..engine import gemini_layout, generic_copy, skeleton_v3
from ..logging_config import get_logger, request_id_var
from ..schemas import (
    SelectLayoutCompleted,
    SelectLayoutRequest,
    V3CallbackError,
    V3FailedEvent,
    V3JobStage,
    V3Models,
    V3ProgressEvent,
    V3Usage,
)
from ..settings import get_settings

log = get_logger("v3_album")


class _Job:
    def __init__(self, req: SelectLayoutRequest) -> None:
        self.req = req
        self.active_stage: V3JobStage | None = None


async def _emit_progress(job: _Job, stage: V3JobStage, progress: int) -> None:
    job.active_stage = stage
    envelope = V3ProgressEvent(
        event="progress",
        jobKind="select-layout",
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
    envelope = V3FailedEvent(
        event="failed",
        jobKind="select-layout",
        requestId=job.req.requestId,
        error=V3CallbackError(code=code, message=message[:500]),
        **({"stage": stage} if stage is not None else {}),
    )
    await callback.post(str(job.req.callbackUrl), envelope)


def _chapter_payload(chapter: Any) -> dict[str, Any]:
    return chapter.model_dump(mode="json") if hasattr(chapter, "model_dump") else dict(chapter)


def _fallback_interiors(req: SelectLayoutRequest) -> list[dict[str, Any]]:
    return skeleton_v3.build_skeleton_v3([_chapter_payload(chapter) for chapter in req.chapters])


async def select_pages(req: SelectLayoutRequest) -> tuple[list[dict[str, Any]], V3Usage]:
    started = time.monotonic()
    gemini_calls = 0
    input_tokens = 0
    output_tokens = 0
    model: str | None = None

    try:
        result = await gemini_layout.gemini_layout(req.chapters, mode="select", allowAddPages=True)
        gemini_calls = result.call_count
        input_tokens = result.input_tokens
        output_tokens = result.output_tokens
        model = result.model
        interior_pages = gemini_layout.legalize_layout(req.chapters, result.pages)
    except Exception as exc:  # noqa: BLE001
        log.warning("v3_select_layout.gemini_fallback", error=str(exc))
        interior_pages = _fallback_interiors(req)

    wrapped = skeleton_v3.wrap_with_cover_ending(interior_pages, req.chapters)
    pages = generic_copy.fill_generic_copy(wrapped, req.chapters)  # type: ignore[arg-type]
    duration_ms = int((time.monotonic() - started) * 1000)
    usage = V3Usage(
        durationMs=duration_ms,
        geminiCallCount=gemini_calls,
        planningInputTokens=input_tokens,
        planningOutputTokens=output_tokens,
        models=V3Models(**({"planning": model} if model else {})),
    )
    return pages, usage


async def _run_select_layout(job: _Job) -> None:
    started = time.monotonic()
    await _emit_progress(job, "layout", 0)
    pages, usage = await select_pages(job.req)
    await _emit_progress(job, "legalize", 100)
    await _emit_progress(job, "wrap", 100)
    envelope = SelectLayoutCompleted(
        event="completed",
        jobKind="select-layout",
        requestId=job.req.requestId,
        pages=pages,
        usage=usage,
    )
    await callback.post(str(job.req.callbackUrl), envelope)
    log.info(
        "v3_select_layout.completed",
        duration_ms=int((time.monotonic() - started) * 1000),
        chapters=len(job.req.chapters),
        pages=len(pages),
    )


async def run_with_timeout(req: SelectLayoutRequest) -> None:
    settings = get_settings()
    job = _Job(req)
    token = request_id_var.set(req.requestId)
    try:
        try:
            await asyncio.wait_for(
                _run_select_layout(job), timeout=settings.background_task_timeout_seconds
            )
        except asyncio.TimeoutError:
            log.error("v3_select_layout.timeout")
            await _emit_failure(
                job,
                code="AGENT_TIMEOUT",
                message="background task exceeded timeout",
                stage=job.active_stage,
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("v3_select_layout.unhandled", error=str(exc))
            await _emit_failure(
                job,
                code="AGENT_OUTPUT_VALIDATION",
                message=str(exc),
                stage=job.active_stage,
            )
    finally:
        request_id_var.reset(token)
