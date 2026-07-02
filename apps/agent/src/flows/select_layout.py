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
from ..agents import select_layout as select_layout_agent
from ..engine import candidate_gen_v3, generic_copy, legalize, skeleton_v3
from ..logging_config import get_logger, request_id_var
from ..schemas import (
    CandidatePage,
    LayoutCandidate,
    Page,
    SelectLayoutCandidates,
    SelectLayoutCandidateUnit,
    SelectLayoutCompleted,
    SelectLayoutRequest,
    V3CallbackError,
    V3Chapter,
    V3ChapterPhoto,
    V3FailedEvent,
    V3JobStage,
    V3Models,
    V3ProgressEvent,
    V3Usage,
)
from ..agents.story import write_copy
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


async def _judge_unit(unit: Any, *, seed: str) -> _BatchResult:
    """一个排版单元(一章或超大章的一段):代码随机生成 N 个候选 → LLM 评委选最佳。

    任何环节失败都回退确定性 skeleton,保证不空手。legalize 仍做最终合法化夹紧。
    `seed` 已含 requestId + chapterId + 段索引,保证同章拆多段时各段候选不同。
    """
    chapter_id = str(getattr(unit, "chapterId", None) or _value(unit, "chapterId"))
    photos = _chapter_photos(unit)
    # seed 唯一性:requestId + chapterId + 段首照片 id(同章拆多段时各段照片不同 => 候选不同)。
    first_pid = _value(photos[0], "photoId") if photos else ""
    unit_seed = f"{seed}#{chapter_id}#{first_pid}"
    candidates = candidate_gen_v3.generate_candidates(
        photos,
        seed=unit_seed,
        count=int(get_settings().select_layout_candidate_count),
    )
    if not candidates:
        return _BatchResult(pages=[])

    # 单候选无需评委;否则让 Gemini 选。
    if len(candidates) == 1:
        winner, calls, in_tok, out_tok, model = candidates[0], 0, 0, 0, None
    else:
        try:
            verdict = await select_layout_agent.judge_layout(unit, candidates)
            winner = candidates[verdict.winner_index]
            calls, in_tok, out_tok, model = (
                verdict.call_count,
                verdict.input_tokens,
                verdict.output_tokens,
                verdict.model,
            )
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "v3_select_layout.judge_fallback",
                chapter_id=chapter_id,
                error=str(exc),
            )
            ai_client.trace_marker(
                "select-layout judge fallback",
                input=f"chapterId={chapter_id}; reason={str(exc)[:300]}",
                output="评委失败,取第 0 个随机候选。",
            )
            winner, calls, in_tok, out_tok, model = candidates[0], 0, 0, 0, None

    # 候选已由 candidate_gen 保证合法(填满、不重不漏),只做轻量校验 + reindex,不重排。
    pages = legalize.finalize_candidate_pages(unit, winner)
    return _BatchResult(
        pages=pages,
        gemini_calls=calls,
        input_tokens=in_tok,
        output_tokens=out_tok,
        model=model,
    )


async def _select_batch(chapters: Sequence[Any], *, seed: str) -> _BatchResult:
    """一个并发批次:逐 unit 走『随机候选 + 评委』,拼接结果。"""
    try:
        unit_results = [await _judge_unit(unit, seed=seed) for unit in chapters]
        pages: list[dict[str, Any]] = []
        for r in unit_results:
            pages.extend(r.pages)
        model = next((r.model for r in unit_results if r.model), None)
        return _BatchResult(
            pages=pages,
            gemini_calls=sum(r.gemini_calls for r in unit_results),
            input_tokens=sum(r.input_tokens for r in unit_results),
            output_tokens=sum(r.output_tokens for r in unit_results),
            model=model,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "v3_select_layout.batch_fallback",
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


async def _write_all_chapters_copy(
    chapters: Sequence[Any], pages: list[dict[str, Any]], language: str
) -> tuple[list[dict[str, Any]], int, int]:
    """排版定版式后,为每一章一次性写满文案(单段路径)。把 texts 贴回对应页。

    pages(fill_generic_copy 产物)不带 chapterId —— 按「页的图槽照片 ∈ 该章照片集」归属到章。
    每章据 chapterContext(采访)+ sceneDescription 写(write_chapter_copy);失败降级空,不拖垮排版。
    返回 (pages, in_tok, out_tok)。"""
    in_tok = out_tok = 0
    # chapterId → 该章照片集(判页归属)。
    for chapter in chapters:
        photo_ids = {_value(p, "photoId") for p in _chapter_photos(chapter)}
        # 本章的页:页的任一图槽照片属于本章。
        chapter_pages_idx = [
            i
            for i, pg in enumerate(pages)
            if photo_ids & set((pg.get("images") or {}).values())
        ]
        if not chapter_pages_idx:
            continue
        # 组 V3Chapter(写文案只需 chapterContext + photos 的 sceneDescription)。
        chapter_obj = V3Chapter(
            chapterId=str(_value(chapter, "chapterId")),
            chapterContext=str(_value(chapter, "chapterContext", "") or ""),
            accentColor=None,
            artFont=None,
            photos=[
                V3ChapterPhoto(
                    photoId=_value(p, "photoId"),
                    sceneDescription=str(_value(p, "sceneDescription", "") or ""),
                    width=1,
                    height=1,
                    orientation="landscape",
                )
                for p in _chapter_photos(chapter)
            ],
        )
        page_objs = [
            Page(
                pageIndex=int(pages[i]["pageIndex"]),
                templateId=str(pages[i]["templateId"]),
                images=dict(pages[i].get("images", {})),
                texts=dict(pages[i].get("texts", {})),
            )
            for i in chapter_pages_idx
        ]
        patches, ci, co = await write_copy.write_chapter_copy(chapter_obj, page_objs, language)
        in_tok += ci
        out_tok += co
        texts_by_index = {patch.pageIndex: dict(patch.texts) for patch in patches}
        for i in chapter_pages_idx:
            idx = int(pages[i]["pageIndex"])
            if idx in texts_by_index:
                pages[i]["texts"] = {**pages[i].get("texts", {}), **texts_by_index[idx]}
    return pages, in_tok, out_tok


async def select_pages(req: SelectLayoutRequest) -> tuple[list[dict[str, Any]], V3Usage]:
    started = time.monotonic()
    settings = get_settings()
    units = _layout_units(req.chapters, settings.select_layout_max_images_per_batch)
    batches = _chapter_batches(units, settings.select_layout_max_images_per_batch)
    semaphore = asyncio.Semaphore(max(1, int(settings.select_layout_max_concurrency)))

    async def run_batch(batch: Sequence[Any]) -> _BatchResult:
        async with semaphore:
            return await _select_batch(batch, seed=req.requestId)

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

    # 封面/封底不在排版这步生成,改放后续环节;Stage2 只产 interior 页。
    pages = generic_copy.fill_generic_copy(interior_pages, req.chapters)  # type: ignore[arg-type]
    # 排版定版式后一并写满文案(§流程重构):inline-judge 单段路径也要写(否则本地/降级时文案空)。
    # 每章据 chapterContext(采访结果)写;无则照 sceneDescription 写;单章失败降级空,不拖垮排版。
    pages, w_in, w_out = await _write_all_chapters_copy(req.chapters, pages, req.language)
    output_tokens += w_out
    input_tokens += w_in
    duration_ms = int((time.monotonic() - started) * 1000)
    usage = V3Usage(
        durationMs=duration_ms,
        geminiCallCount=gemini_calls,
        planningInputTokens=input_tokens,
        planningOutputTokens=output_tokens,
        models=V3Models(**({"planning": model} if model else {})),
    )
    return pages, usage


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

    # 向后兼容:开关为 True 时走旧单段内联评委(裸照片+线框图),直接 completed。
    if getattr(get_settings(), "select_layout_inline_judge", False):
        pages, usage = await select_pages(job.req)
        await _emit_progress(job, "legalize", 100)
        await _emit_progress(job, "wrap", 100)
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
        return

    # P2 phase 1:生成候选结构,经 candidates 回调交回浏览器去渲染缩略图。
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
