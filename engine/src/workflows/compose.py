"""V3 `/v3/compose` ④ 一次性成稿的 async 编排。

用户选完设计之后的一把成稿:**按章并发**让 Gemini 看真实照片 + 读用户讲的故事写满
全书文案,同时并发跑一次全局批次(封面/封尾文案 + 字体),最后合并成**一次**
`completed` 回调。

失败绝不阻断交付:某章写不出来 → 该章页面不出现在 `pagesTexts` 里(Web 保留模板
sample 文案),不发 `failed`。只有整个任务超时/编排层崩了才回 `failed`。

§隐私:照片 base64 只在请求内存里 —— 进模型上下文的那一次 HTTP body,以及经
`ai_client` 统一脱敏的 trace;日志与 trace 摘要只记「有没有缩略图」。生产永不落盘;
dev 观测台的 `ai-trace.jsonl` 是例外(`ai_client._write_jsonl` 会写完整 data URL 给
本地观测台渲染,生产由 `_is_production()` 关掉)。
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from ..api import callback
from ..providers import ai_client
from .core import compose as compose_agent
from ..logging_config import get_logger, request_id_var
from ..contracts.schemas import (
    ComposeCompleted,
    ComposeRequest,
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
    def __init__(self, req: ComposeRequest) -> None:
        self.req = req
        self.active_stage: V3JobStage | None = None


async def _emit_progress(job: _Job, stage: V3JobStage, progress: int) -> None:
    job.active_stage = stage
    envelope = V3ProgressEvent(
        event="progress",
        jobKind="compose",
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
        jobKind="compose",
        requestId=job.req.requestId,
        error=V3CallbackError(code=code, message=message[:500]),
        **({"stage": stage} if stage is not None else {}),
    )
    await callback.post(str(job.req.callbackUrl), envelope)


def _trace_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)


def _trace_request_summary(req: ComposeRequest) -> dict[str, Any]:
    """trace 摘要:**绝不带 base64**(只记有没有缩略图),照片时间/地点也只看有没有。"""
    return {
        "requestId": req.requestId,
        "language": req.language,
        "chapterCount": len(req.chapters),
        "pageCount": sum(len(chapter.pages) for chapter in req.chapters),
        "hasUserFontChoice": req.userFontChoice is not None,
        "chapters": [
            {
                "chapterId": chapter.chapterId,
                "title": chapter.title,
                "hasChapterContext": bool(chapter.chapterContext),
                "pageCount": len(chapter.pages),
                "photos": [
                    {"photoId": photo.photoId, "hasRef200px": bool(photo.ref200px)}
                    for photo in chapter.photos
                ],
            }
            for chapter in req.chapters
        ],
    }


def _drop_failed_chapter(chapter: Any, result: Any):
    """章节任务抛了异常 → 降级成空结果(该章保留模板 sample),并留下痕迹。

    取消(CancelledError)不算「这一章写不出来」,原样抛回去交给超时分支处理。"""
    if isinstance(result, asyncio.CancelledError):
        raise result
    if isinstance(result, BaseException):
        log.warning(
            "v3_compose.chapter_dropped",
            chapter_id=str(getattr(chapter, "chapterId", "") or ""),
            error=str(result),
        )
        return compose_agent.ComposeChapterResult()
    return result


async def _run_compose(job: _Job) -> None:
    started = time.monotonic()
    req = job.req
    settings = get_settings()
    ai_client.trace_marker(
        "compose input",
        input=_trace_json(_trace_request_summary(req)),
        output="进入 ④ 成稿:按章并发写文案 + 全局封面/字体。",
    )
    await _emit_progress(job, "compose", 0)

    # 章节批次与全局批次全部并发,信号量控住同时在飞的 Gemini 调用数。
    semaphore = asyncio.Semaphore(settings.compose_max_concurrency)

    async def chapter_task(chapter: Any):
        async with semaphore:
            return await compose_agent.compose_chapter(chapter, language=req.language)

    async def global_task():
        try:
            return await _global_task_inner()
        except Exception as exc:  # noqa: BLE001 — 全局批次也不许阻断交付
            log.warning("v3_compose.global_dropped", error=str(exc))
            return compose_agent.ComposeGlobalResult()

    async def _global_task_inner():
        async with semaphore:
            return await compose_agent.compose_global(
                language=req.language,
                album_title=req.albumTitle,
                chapter_titles=[chapter.title for chapter in req.chapters],
                chapter_contexts=[chapter.chapterContext for chapter in req.chapters],
                cover_slots=[slot.model_dump(mode="json") for slot in req.coverSlots],
                ending_slots=[slot.model_dump(mode="json") for slot in req.endingSlots],
                user_font_choice=(
                    req.userFontChoice.model_dump(mode="json")
                    if req.userFontChoice is not None
                    else None
                ),
            )

    # return_exceptions=True 是硬约束的最后一道门:章节任务哪怕抛出去(handler 的
    # try 覆盖不到的边角、或未来新加的代码),也只让这一章掉队,不能把整本书打成
    # failed。异常在这里降级成空结果,并带 chapterId 记一条 warning(绝不无声吞)。
    chapter_results, global_result = await asyncio.gather(
        asyncio.gather(
            *(chapter_task(chapter) for chapter in req.chapters), return_exceptions=True
        ),
        global_task(),
    )
    chapter_results = [
        _drop_failed_chapter(chapter, result)
        for chapter, result in zip(req.chapters, chapter_results, strict=True)
    ]

    # 页序在整册连续(select-layout 出的),各章之间不会撞 pageIndex。
    pages_texts: dict[int, dict[str, str]] = {}
    for result in chapter_results:
        pages_texts.update(result.pages_texts)

    call_count = sum(r.call_count for r in chapter_results) + global_result.call_count
    input_tokens = sum(r.input_tokens for r in chapter_results) + global_result.input_tokens
    output_tokens = sum(r.output_tokens for r in chapter_results) + global_result.output_tokens
    model = next(
        (r.model for r in (*chapter_results, global_result) if r.model),
        None,
    )

    await callback.post(
        str(req.callbackUrl),
        ComposeCompleted(
            event="completed",
            jobKind="compose",
            requestId=req.requestId,
            pagesTexts=pages_texts,
            coverTexts=global_result.cover_texts,
            endingTexts=global_result.ending_texts,
            fonts=global_result.fonts,
            usage=V3Usage(
                durationMs=int((time.monotonic() - started) * 1000),
                geminiCallCount=call_count,
                planningInputTokens=input_tokens,
                planningOutputTokens=output_tokens,
                # V3Models.planning 标注是 str(默认 None,显式传 None 会被 pydantic 拒);
                # 全部调用都失败时没有模型名可报,这里就不带这个 key。
                models=V3Models(**({"planning": model} if model else {})),
            ),
        ),
    )
    written = sum(1 for r in chapter_results if r.pages_texts)
    ai_client.trace_marker(
        "compose completed",
        input=f"requestId={req.requestId}; chapters={len(req.chapters)}; 写出文案的章={written}",
        output=_trace_json({"pageIndexes": sorted(pages_texts), "fonts": global_result.fonts}),
    )
    log.info(
        "v3_compose.completed",
        duration_ms=int((time.monotonic() - started) * 1000),
        chapters=len(req.chapters),
        chapters_written=written,
        pages_written=len(pages_texts),
        gemini_calls=call_count,
    )


async def run_with_timeout(req: ComposeRequest) -> None:
    settings = get_settings()
    job = _Job(req)
    token = request_id_var.set(req.requestId)
    try:
        try:
            await asyncio.wait_for(
                _run_compose(job), timeout=settings.background_task_timeout_seconds
            )
        except asyncio.TimeoutError:
            log.error("v3_compose.timeout")
            await _emit_failure(
                job,
                code="AGENT_TIMEOUT",
                message="background task exceeded timeout",
                stage=job.active_stage,
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("v3_compose.unhandled", error=str(exc))
            await _emit_failure(
                job,
                code="AGENT_OUTPUT_VALIDATION",
                message=str(exc),
                stage=job.active_stage,
            )
    finally:
        request_id_var.reset(token)
