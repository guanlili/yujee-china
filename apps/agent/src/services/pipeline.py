import asyncio
import time

from ..logging_config import get_logger
from ..schemas import CallbackEnvelope, JobError, JobUsage, LayoutRequest
from . import callback, planning_mock, vision_mock

log = get_logger("pipeline")

_STAGES = ("vision", "writing", "composing")
_STEP_SECONDS = 1.0


async def _emit_progress(req: LayoutRequest, stage: str, progress: int) -> None:
    envelope = CallbackEnvelope(
        requestId=req.requestId,
        event="progress",
        stage=stage,
        progress=progress,
    )
    await callback.post(str(req.callbackUrl), envelope)


async def emit_failure(req: LayoutRequest, code: str, message: str) -> None:
    envelope = CallbackEnvelope(
        requestId=req.requestId,
        event="failed",
        error=JobError(code=code, message=message),
    )
    await callback.post(str(req.callbackUrl), envelope)


async def run(req: LayoutRequest) -> None:
    if req.prompt == "FAIL_TEST":
        log.info("pipeline.forced_failure")
        await emit_failure(req, code="AGENT_VISION_FAILED", message="forced failure for test")
        return

    started = time.monotonic()
    log.info("pipeline.start", photos=len(req.photos))

    for stage in _STAGES:
        await _emit_progress(req, stage, 0)
        await asyncio.sleep(_STEP_SECONDS)
        await _emit_progress(req, stage, 50)
        await asyncio.sleep(_STEP_SECONDS)
        await _emit_progress(req, stage, 100)

    photos = vision_mock.analyze(req)
    layout = planning_mock.plan(req, photos)

    duration_ms = int((time.monotonic() - started) * 1000)
    envelope = CallbackEnvelope(
        requestId=req.requestId,
        event="completed",
        layout=layout,
        usage=JobUsage(visionTokens=0, planningTokens=0, durationMs=duration_ms),
    )
    await callback.post(str(req.callbackUrl), envelope)
    log.info("pipeline.completed", duration_ms=duration_ms)
