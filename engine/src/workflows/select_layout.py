"""V3 `/v3/select-layout` Stage2 async orchestration."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Sequence
from typing import Any

from ..api import callback
from ..providers import ai_client
from .core.layout import candidate_gen_v3
from ..logging_config import get_logger, request_id_var
from ..contracts.schemas import (
    CandidatePage,
    LayoutCandidate,
    SelectLayoutCandidates,
    SelectLayoutCandidateUnit,
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



def _chapter_photos(chapter: Any) -> list[Any]:
    photos = getattr(chapter, "photos", None)
    if photos is None and isinstance(chapter, dict):
        photos = chapter.get("photos")
    return list(photos or [])


def _value(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _trace_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)


def _trace_request_summary(req: SelectLayoutRequest) -> dict[str, Any]:
    chapters: list[dict[str, Any]] = []
    for chapter in req.chapters:
        photos = _chapter_photos(chapter)
        chapters.append(
            {
                "chapterId": _value(chapter, "chapterId"),
                "structureHint": _value(chapter, "structureHint"),
                "photoCount": len(photos),
                "photos": [
                    {
                        "photoId": _value(photo, "photoId"),
                        "orientation": _value(photo, "orientation"),
                        "takenAt": _value(photo, "takenAt"),
                        "hasRef200px": bool(_value(photo, "ref200px")),
                    }
                    for photo in photos
                ],
            }
        )
    return {
        "requestId": req.requestId,
        "language": req.language,
        "chapterCount": len(req.chapters),
        "photoCount": sum(chapter["photoCount"] for chapter in chapters),
        "chapters": chapters,
    }



def _chapter_with_photos(chapter: Any, photos: Sequence[Any]) -> Any:
    next_photos = list(photos)
    if hasattr(chapter, "model_copy"):
        return chapter.model_copy(update={"photos": next_photos})
    if isinstance(chapter, dict):
        return {**chapter, "photos": next_photos}
    clone = _chapter_payload(chapter)
    clone["photos"] = next_photos
    return clone


def _layout_units(chapters: Sequence[Any], max_images_per_batch: int) -> list[Any]:
    max_images = max(1, int(max_images_per_batch))
    units: list[Any] = []
    for chapter in chapters:
        photos = _chapter_photos(chapter)
        if len(photos) <= max_images:
            units.append(chapter)
            continue
        for start in range(0, len(photos), max_images):
            units.append(_chapter_with_photos(chapter, photos[start : start + max_images]))
    return units



def _unit_key(unit: Any) -> str:
    """排版单元的唯一键:chapterId,超大章拆段时加段首 photoId 区分。"""
    chapter_id = str(getattr(unit, "chapterId", None) or _value(unit, "chapterId"))
    photos = _chapter_photos(unit)
    first_pid = _value(photos[0], "photoId") if photos else ""
    return f"{chapter_id}#{first_pid}" if first_pid else chapter_id



def select_candidates(req: SelectLayoutRequest) -> tuple[list[SelectLayoutCandidateUnit], V3Usage]:
    """P2 phase 1:逐 unit 代码随机生成候选结构(不调 Gemini),交回浏览器渲染。"""
    started = time.monotonic()
    settings = get_settings()
    units = _layout_units(req.chapters, settings.select_layout_max_images_per_batch)
    count = int(settings.select_layout_candidate_count)

    out_units: list[SelectLayoutCandidateUnit] = []
    for unit in units:
        chapter_id = str(getattr(unit, "chapterId", None) or _value(unit, "chapterId"))
        photos = _chapter_photos(unit)
        if not photos:
            continue
        first_pid = _value(photos[0], "photoId") if photos else ""
        unit_seed = f"{req.requestId}#{chapter_id}#{first_pid}"
        cands = candidate_gen_v3.generate_candidates(photos, seed=unit_seed, count=count)
        if not cands:
            continue
        out_units.append(
            SelectLayoutCandidateUnit(
                unitKey=_unit_key(unit),
                chapterId=chapter_id,
                candidates=[
                    LayoutCandidate(
                        candidateIndex=idx,
                        pages=[
                            CandidatePage(templateId=p["templateId"], images=dict(p["images"]))
                            for p in cand
                        ],
                    )
                    for idx, cand in enumerate(cands)
                ],
            )
        )

    usage = V3Usage(
        durationMs=int((time.monotonic() - started) * 1000),
        geminiCallCount=0,
        models=V3Models(),
    )
    return out_units, usage


async def _run_select_layout(job: _Job) -> None:
    started = time.monotonic()
    ai_client.trace_marker(
        "select-layout input",
        input=_trace_json(_trace_request_summary(job.req)),
        output="进入 Stage2 排版选择。",
    )
    await _emit_progress(job, "layout", 0)

    # P2 phase 1:生成候选结构,经 candidates 回调交回浏览器去渲染缩略图。
    # (旧单段内联评委——线框结构判图——已整条移除,排版统一真图缩略图逻辑。)
    units, usage = select_candidates(job.req)
    await callback.post(
        str(job.req.callbackUrl),
        SelectLayoutCandidates(
            event="candidates",
            jobKind="select-layout",
            requestId=job.req.requestId,
            units=units,
            usage=usage,
        ),
    )
    ai_client.trace_marker(
        "select-layout candidates",
        input=f"requestId={job.req.requestId}; units={len(units)}",
        output=_trace_json({"units": [u.unitKey for u in units]}),
    )
    log.info(
        "v3_select_layout.candidates",
        duration_ms=int((time.monotonic() - started) * 1000),
        chapters=len(job.req.chapters),
        units=len(units),
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
