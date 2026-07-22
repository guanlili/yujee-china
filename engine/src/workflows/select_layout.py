"""V3 `/v3/select-layout` Stage2 async orchestration。

排版是纯确定性的一步:逐 unit 用 `candidate_gen_v3` 生成**唯一**候选(count=1,seed
按 unit 播种可复现)→ `legalize.finalize_candidate_pages` 最终化 → 填模板 sample 文案
→ 一次 `completed` 回调直接返回 pages。零 AI 调用,没有候选/缩略图/评委阶段。
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Sequence
from typing import Any

from ..api import callback
from ..providers import ai_client
from .core.layout import candidate_gen_v3, legalize, sample_texts
from ..logging_config import get_logger, request_id_var
from ..contracts.schemas import (
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



def build_pages(req: SelectLayoutRequest) -> tuple[list[dict[str, Any]], V3Usage]:
    """确定性选版:逐 unit 取唯一候选 → 最终化成页 → 填模板 sample 文案。

    候选生成器按容量拆页、每页照片数 == 模板槽数,所以整册页天然「填满、不重不漏」。
    全程不调 AI,`geminiCallCount` 恒为 0。
    """
    started = time.monotonic()
    settings = get_settings()
    units = _layout_units(req.chapters, settings.select_layout_max_images_per_batch)

    interior_pages: list[dict[str, Any]] = []
    for unit in units:
        chapter_id = str(getattr(unit, "chapterId", None) or _value(unit, "chapterId"))
        photos = _chapter_photos(unit)
        if not photos:
            continue
        first_pid = _value(photos[0], "photoId") if photos else ""
        unit_seed = f"{req.requestId}#{chapter_id}#{first_pid}"
        # count=1:确定性选版,不再生成多候选交评委挑。
        cands = candidate_gen_v3.generate_candidates(photos, seed=unit_seed, count=1)
        if not cands:
            continue
        interior_pages.extend(
            legalize.finalize_candidate_pages({"chapterId": chapter_id}, cands[0])
        )

    # 整册连续重排 pageIndex(finalize 只在 unit 内编号)。
    pages = [{**page, "pageIndex": idx} for idx, page in enumerate(interior_pages)]
    # 模板自带示例文案先填上,用户看到的是有字的版面;compose 环节再逐槽覆盖。
    pages = sample_texts.fill_sample_texts(pages)

    usage = V3Usage(
        durationMs=int((time.monotonic() - started) * 1000),
        geminiCallCount=0,
        models=V3Models(),
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

    # 纯确定性选版,一把出页(旧的候选回调 → 浏览器缩略图 → 视觉评委三段已整条移除)。
    pages, usage = build_pages(job.req)
    await callback.post(
        str(job.req.callbackUrl),
        SelectLayoutCompleted(
            event="completed",
            jobKind="select-layout",
            requestId=job.req.requestId,
            pages=pages,
            usage=usage,
        ),
    )
    ai_client.trace_marker(
        "select-layout completed",
        input=f"requestId={job.req.requestId}; pages={len(pages)}",
        output=_trace_json({"templates": [p["templateId"] for p in pages]}),
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
