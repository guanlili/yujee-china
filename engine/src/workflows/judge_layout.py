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


def _fixed_winner_index(unit: Any) -> int | None:
    """单候选 / Web 已定(chosenIndex)的 unit 不进评委,直接给定赢家 index。"""
    candidates = list(unit.candidates)
    if unit.chosenIndex is not None or len(candidates) == 1:
        idx = unit.chosenIndex if unit.chosenIndex is not None else 0
        return idx if 0 <= idx < len(candidates) else 0
    return None


def _judge_batches(units: list[tuple[int, Any]], max_images: int) -> list[list[tuple[int, Any]]]:
    """把待评 unit 按候选缩略图总数组批:一批一次评委会话(有些章一共就两三页,
    逐章开会话纯浪费)。一个 unit 的候选不跨批;单 unit 超预算时独占一批。"""
    batches: list[list[tuple[int, Any]]] = []
    current: list[tuple[int, Any]] = []
    current_images = 0
    for item in units:
        n = len(item[1].candidates)
        if current and current_images + n > max_images:
            batches.append(current)
            current = []
            current_images = 0
        current.append(item)
        current_images += n
    if current:
        batches.append(current)
    return batches


async def _finalize_unit(unit: Any, winner_index: int, language: str) -> list[dict[str, Any]]:
    """按赢家候选最终化成页并当场写文案(失败不阻断,texts 保持原样)。"""
    candidates = list(unit.candidates)
    winner = candidates[winner_index if 0 <= winner_index < len(candidates) else 0]
    pages = legalize.finalize_candidate_pages(
        {"chapterId": unit.chapterId}, _candidate_pages(winner)
    )
    # 版式已定 → 写文案(#AI copy writer);generic_copy 之后只叠 decoration 槽,互不冲突。
    return await write_copy_agent.apply_write_copy(unit, pages, language=language)


async def judge_pages(req: JudgeLayoutRequest) -> tuple[list[dict[str, Any]], V3Usage]:
    """逐 unit 选赢家(多单元合并进同一次评委会话),拼成整册 interior 页 + 填页码。

    评委看的是浏览器渲染的真实缩略图(照片已排进版式);批量判图按
    select_layout_judge_batch_max_images 组批,批与批之间并发(受
    select_layout_max_concurrency 限制)。某批评委整体失败 → 该批各 unit
    退化取候选 0,全册仍成稿。"""
    started = time.monotonic()
    settings = get_settings()
    semaphore = asyncio.Semaphore(max(1, int(settings.select_layout_max_concurrency)))

    winners: dict[int, int] = {}
    pending: list[tuple[int, Any]] = []
    for idx, unit in enumerate(req.units):
        fixed = _fixed_winner_index(unit)
        if fixed is not None:
            winners[idx] = fixed
        else:
            pending.append((idx, unit))

    batches = _judge_batches(
        pending, max(1, int(settings.select_layout_judge_batch_max_images))
    )
    calls = in_tok = out_tok = 0
    model: str | None = None

    async def run_batch(batch: list[tuple[int, Any]]) -> tuple[list[int], Any | None]:
        async with semaphore:
            payload = [
                {
                    "thumbnails": [c.thumbnail for c in unit.candidates],
                    "chapterContext": unit.chapterContext or "",
                }
                for _, unit in batch
            ]
            try:
                verdict = await select_layout_agent.judge_thumbnails_batch(payload)
                return verdict.winners, verdict
            except (GeminiLayoutUnavailable, Exception) as exc:  # noqa: BLE001
                chapter_ids = [unit.chapterId for _, unit in batch]
                log.warning(
                    "v3_judge_layout.judge_fallback", chapter_ids=chapter_ids, error=str(exc)
                )
                ai_client.trace_marker(
                    "judge-layout fallback",
                    input=f"chapterIds={chapter_ids}; reason={str(exc)[:300]}",
                    output="评委失败,该批各 unit 取第 0 个候选。",
                )
                return [0] * len(batch), None

    batch_results = await asyncio.gather(*(run_batch(batch) for batch in batches))
    for batch, (batch_winners, verdict) in zip(batches, batch_results, strict=True):
        for (idx, _), winner in zip(batch, batch_winners, strict=True):
            winners[idx] = winner
        if verdict is not None:
            calls += verdict.call_count
            in_tok += verdict.input_tokens
            out_tok += verdict.output_tokens
            if model is None and verdict.model:
                model = verdict.model

    # 赢家已定 → 逐 unit 最终化 + 写文案(并发,受同一 semaphore 限制)。
    async def run_finalize(idx: int, unit: Any) -> list[dict[str, Any]]:
        async with semaphore:
            return await _finalize_unit(unit, winners[idx], req.language)

    unit_pages = await asyncio.gather(
        *(run_finalize(idx, unit) for idx, unit in enumerate(req.units))
    )
    interior_pages: list[dict[str, Any]] = []
    for pages in unit_pages:
        interior_pages.extend(pages)

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
