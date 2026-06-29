"""V3 `/v3/judge-layout` Stage2 phase 2:浏览器渲染缩略图 → Gemini 评委选赢家 → pages。

phase 1(`/v3/select-layout`)已把候选结构交回浏览器,浏览器渲染成小缩略图后 POST 到这里。
本流程对每个未定 unit 把 N 张缩略图发给 Gemini 评委选最佳;赢家候选走
`legalize.finalize_candidate_pages` 拼成整册 pages,经与 phase 1 相同的 `completed` 回调返回。
评委失败 / 缩略图缺失 → 该 unit 退化「取候选 0」,全册仍成稿。
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from .. import ai_client, callback
from ..agents import select_layout as select_layout_agent
from ..agents.select_layout import GeminiLayoutUnavailable
from ..engine import generic_copy, legalize
from ..logging_config import get_logger, request_id_var
from ..schemas import (
    JudgeLayoutRequest,
    SelectLayoutCompleted,
    V3CallbackError,
    V3FailedEvent,
    V3Models,
    V3Usage,
)
from ..settings import get_settings

log = get_logger("judge_layout")


def _candidate_pages(candidate: Any) -> list[dict[str, Any]]:
    """把 JudgeCandidate.pages 还原成 finalize 吃的页结构(images 键)。"""
    return [
        {"templateId": p.templateId, "images": dict(p.images), "texts": {}}
        for p in candidate.pages
    ]


async def _resolve_unit(unit: Any) -> tuple[list[dict[str, Any]], int, int, int, str | None]:
    """选出该 unit 的赢家候选并最终化成页。返回 (pages, calls, in_tok, out_tok, model)。"""
    candidates = list(unit.candidates)
    chapter = {"chapterId": unit.chapterId}

    # 单候选 / Web 已定:直接采用,不调评委。
    if unit.chosenIndex is not None or len(candidates) == 1:
        idx = unit.chosenIndex if unit.chosenIndex is not None else 0
        idx = idx if 0 <= idx < len(candidates) else 0
        winner = candidates[idx]
        pages = legalize.finalize_candidate_pages(chapter, _candidate_pages(winner))
        return pages, 0, 0, 0, None

    # 多候选:缩略图喂 Gemini 评委。失败退化取 0。
    thumbnails = [c.thumbnail for c in candidates]
    try:
        verdict = await select_layout_agent.judge_layout_thumbnails(thumbnails)
        winner = candidates[verdict.winner_index]
        meta = (verdict.call_count, verdict.input_tokens, verdict.output_tokens, verdict.model)
    except (GeminiLayoutUnavailable, Exception) as exc:  # noqa: BLE001
        log.warning("v3_judge_layout.judge_fallback", chapter_id=unit.chapterId, error=str(exc))
        ai_client.trace_marker(
            "judge-layout fallback",
            input=f"chapterId={unit.chapterId}; reason={str(exc)[:300]}",
            output="评委失败,取第 0 个候选。",
        )
        winner = candidates[0]
        meta = (0, 0, 0, None)

    pages = legalize.finalize_candidate_pages(chapter, _candidate_pages(winner))
    return (pages, *meta)


async def judge_pages(req: JudgeLayoutRequest) -> tuple[list[dict[str, Any]], V3Usage]:
    """对所有 unit 评委选赢家,拼成整册 interior 页 + 填页码日期。"""
    started = time.monotonic()
    settings = get_settings()
    semaphore = asyncio.Semaphore(max(1, int(settings.select_layout_max_concurrency)))

    async def run(unit: Any) -> tuple[list[dict[str, Any]], int, int, int, str | None]:
        async with semaphore:
            return await _resolve_unit(unit)

    results = await asyncio.gather(*(run(unit) for unit in req.units))

    interior_pages: list[dict[str, Any]] = []
    calls = in_tok = out_tok = 0
    model: str | None = None
    for pages, c, i, o, m in results:
        interior_pages.extend(pages)
        calls += c
        in_tok += i
        out_tok += o
        if model is None and m:
            model = m

    # generic_copy 需要 chapters 取 takenAt 填日期;这里没有完整章节信息,传空(只填页码)。
    pages = generic_copy.fill_generic_copy(interior_pages, [])  # type: ignore[arg-type]
    usage = V3Usage(
        durationMs=int((time.monotonic() - started) * 1000),
        geminiCallCount=calls,
        planningInputTokens=in_tok,
        planningOutputTokens=out_tok,
        models=V3Models(**({"planning": model} if model else {})),
    )
    return pages, usage


async def _run_judge_layout(req: JudgeLayoutRequest) -> None:
    started = time.monotonic()
    pages, usage = await judge_pages(req)
    await callback.post(
        str(req.callbackUrl),
        SelectLayoutCompleted(
            event="completed",
            jobKind="select-layout",
            requestId=req.requestId,
            pages=pages,
            usage=usage,
        ),
    )
    log.info(
        "v3_judge_layout.completed",
        duration_ms=int((time.monotonic() - started) * 1000),
        units=len(req.units),
        pages=len(pages),
    )


async def run_with_timeout(req: JudgeLayoutRequest) -> None:
    settings = get_settings()
    token = request_id_var.set(req.requestId)
    try:
        try:
            await asyncio.wait_for(
                _run_judge_layout(req), timeout=settings.background_task_timeout_seconds
            )
        except asyncio.TimeoutError:
            log.error("v3_judge_layout.timeout")
            await callback.post(
                str(req.callbackUrl),
                V3FailedEvent(
                    requestId=req.requestId,
                    jobKind="select-layout",
                    event="failed",
                    error=V3CallbackError(
                        code="AGENT_TIMEOUT", message="judge-layout exceeded timeout"
                    ),
                ),
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("v3_judge_layout.unhandled", error=str(exc))
            await callback.post(
                str(req.callbackUrl),
                V3FailedEvent(
                    requestId=req.requestId,
                    jobKind="select-layout",
                    event="failed",
                    error=V3CallbackError(code="AGENT_OUTPUT_VALIDATION", message=str(exc)),
                ),
            )
    finally:
        request_id_var.reset(token)
