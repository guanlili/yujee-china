"""V3 `/v3/select-layout` Stage2 async orchestration."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from .. import callback
from .. import ai_client
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


def _chapter_photo_count(chapter: Any) -> int:
    return len(_chapter_photos(chapter))


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


def _trace_pages_summary(pages: Sequence[dict[str, Any]]) -> dict[str, Any]:
    return {
        "pageCount": len(pages),
        "pages": [
            {
                "pageIndex": page.get("pageIndex"),
                "chapterId": page.get("chapterId"),
                "category": page.get("category"),
                "templateId": page.get("templateId"),
                "images": page.get("images") or {},
                "textKeys": sorted((page.get("texts") or {}).keys()),
            }
            for page in pages
        ],
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


def _chapter_batches(chapters: Sequence[Any], max_images_per_batch: int) -> list[list[Any]]:
    max_images = max(1, int(max_images_per_batch))
    batches: list[list[Any]] = []
    current: list[Any] = []
    current_images = 0

    for chapter in chapters:
        chapter_images = _chapter_photo_count(chapter)
        if current and current_images + chapter_images > max_images:
            batches.append(current)
            current = []
            current_images = 0
        current.append(chapter)
        current_images += chapter_images

    if current:
        batches.append(current)
    return batches


def _fallback_interiors(chapters: Sequence[Any]) -> list[dict[str, Any]]:
    return skeleton_v3.build_skeleton_v3([_chapter_payload(chapter) for chapter in chapters])


@dataclass(frozen=True)
class _BatchResult:
    pages: list[dict[str, Any]]
    gemini_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    model: str | None = None


async def _select_batch(chapters: Sequence[Any]) -> _BatchResult:
    try:
        result = await gemini_layout.gemini_layout(chapters, mode="select", allowAddPages=True)
        return _BatchResult(
            pages=gemini_layout.legalize_layout(chapters, result.pages),
            gemini_calls=result.call_count,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            model=result.model,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "v3_select_layout.gemini_batch_fallback",
            chapter_ids=[getattr(chapter, "chapterId", None) for chapter in chapters],
            error=str(exc),
        )
        pages = _fallback_interiors(chapters)
        chapter_ids = [str(getattr(chapter, "chapterId", None)) for chapter in chapters]
        ai_client.trace_marker(
            "select-layout fallback",
            input=f"chapterIds={chapter_ids}; reason={str(exc)[:300]}",
            output=f"deterministic pages={len(pages)}",
        )
        return _BatchResult(pages=pages)


async def select_pages(req: SelectLayoutRequest) -> tuple[list[dict[str, Any]], V3Usage]:
    started = time.monotonic()
    settings = get_settings()
    units = _layout_units(req.chapters, settings.select_layout_max_images_per_batch)
    batches = _chapter_batches(units, settings.select_layout_max_images_per_batch)
    semaphore = asyncio.Semaphore(max(1, int(settings.select_layout_max_concurrency)))

    async def run_batch(batch: Sequence[Any]) -> _BatchResult:
        async with semaphore:
            return await _select_batch(batch)

    results = await asyncio.gather(*(run_batch(batch) for batch in batches))

    interior_pages: list[dict[str, Any]] = []
    gemini_calls = sum(result.gemini_calls for result in results)
    input_tokens = sum(result.input_tokens for result in results)
    output_tokens = sum(result.output_tokens for result in results)
    model: str | None = None
    for result in results:
        interior_pages.extend(result.pages)
        if model is None and result.model:
            model = result.model

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
    ai_client.trace_marker(
        "select-layout input",
        input=_trace_json(_trace_request_summary(job.req)),
        output="进入 Stage2 排版选择。",
    )
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
    ai_client.trace_marker(
        "select-layout output",
        input=f"requestId={job.req.requestId}; geminiCallCount={usage.geminiCallCount}",
        output=_trace_json(_trace_pages_summary(pages)),
    )
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
