"""V3 `/v3/judge-layout` Stage2 phase 2:浏览器渲染缩略图 → 评委选赢家 → 写文案 → pages。

phase 1(`/v3/select-layout`)已把候选结构交回浏览器,浏览器用真实模板 + 真照片渲染成
缩略图后 POST 到这里。本流程对每个未定 unit 把 N 张缩略图 + chapterContext 发给评委
(gemini,保底豆包)选最佳;赢家候选走 `legalize.finalize_candidate_pages` 拼成页后,
豆包把文案写进非 decoration 文字槽(素材 = unit.photos + chapterContext),经与 phase 1
相同的 `completed` 回调返回。评委失败 / 缩略图缺失 → 该 unit 退化「取候选 0」;
写文案失败 → texts 保持原样;全册始终成稿。
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from ..api import callback
from ..providers import ai_client
from .core.layout import select_layout as select_layout_agent
from .core.layout.select_layout import GeminiLayoutUnavailable
from .core.layout import generic_copy, legalize
from .core.layout import write_copy as write_copy_agent
from ..logging_config import get_logger, request_id_var
from ..contracts.schemas import (
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


async def _resolve_unit(
    unit: Any, language: str
) -> tuple[list[dict[str, Any]], int, int, int, str | None]:
    """选出该 unit 的赢家候选并最终化成页。返回 (pages, calls, in_tok, out_tok, model)。

    评委看的是浏览器渲染的真实缩略图(照片已排进版式);选定后豆包当场把文案写进
    本单元每页的非 decoration 文字槽(素材 = unit.photos 的 sceneDescription +
    chapterContext,由 Web 从 draft tree 补齐)。写文案失败不阻断,texts 保持原样。"""
    candidates = list(unit.candidates)
    chapter = {"chapterId": unit.chapterId}

    # 单候选 / Web 已定:直接采用,不调评委。
    if unit.chosenIndex is not None or len(candidates) == 1:
        idx = unit.chosenIndex if unit.chosenIndex is not None else 0
        idx = idx if 0 <= idx < len(candidates) else 0
        winner = candidates[idx]
        meta = (0, 0, 0, None)
    else:
        # 多候选:真实渲染缩略图 + chapterContext 喂评委(gemini,保底豆包)。失败退化取 0。
        thumbnails = [c.thumbnail for c in candidates]
        try:
            verdict = await select_layout_agent.judge_layout_thumbnails(
                thumbnails, chapter_context=unit.chapterContext or ""
            )
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
    # 版式已定 → 写文案(#AI copy writer)。与内联评委路径共用同一 helper;
    # generic_copy 之后只叠 decoration 槽(页码/日期),role 分流互不冲突。
    pages = await write_copy_agent.apply_write_copy(unit, pages, language=language)
    calls, in_tok, out_tok, model = meta
    return pages, calls, in_tok, out_tok, model


async def judge_pages(req: JudgeLayoutRequest) -> tuple[list[dict[str, Any]], V3Usage]:
    """对所有 unit 评委选赢家,拼成整册 interior 页 + 填页码日期。"""
    started = time.monotonic()
    settings = get_settings()
    semaphore = asyncio.Semaphore(max(1, int(settings.select_layout_max_concurrency)))

    async def run(unit: Any) -> tuple[list[dict[str, Any]], int, int, int, str | None]:
        async with semaphore:
            return await _resolve_unit(unit, req.language)

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
