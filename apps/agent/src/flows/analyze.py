"""V3 `/v3/analyze` async orchestration — the describe→group→template→preview job.

Extracted from the HTTP route (`src/routes.py` owns only the thin 202 接入): accept
the base64 photos, run the analysis pipeline in a background task, and stream
`progress` → `completed`/`failed` callbacks back to the Web side (`V3Callback`,
schemas.py / packages/contracts/src/v3.ts — single truth source).

  * The `describe` stage runs the REAL describe-content recognition-model call
    (WP1.3, issue #182): one batched call → 章节树 (分章 + 每章 description + 每图
    sceneDescription). The LLM authors只这 3 处; width/height/orientation/takenAt
    are code-filled. OpenAI (GPT-5.5 Mini) primary, 火山 doubao failover.
  * The `template` stage runs WP1.4 select-template (#183): the recognition model
    picks each page's templateId from the legal candidates, pure-code §9 fallback on
    LLM failure. `_build_preview` also runs WP1.5 generic 文案/色 fill.
  * `describe`/`group`/`template`/`preview` progress callbacks round-trip so the
    202 + callback + stage flow is fully testable end-to-end.

Stateless (§3 数据归属): Agent holds no draft/stage; Web owns the tree + stage and
merges the callback. base64 never leaves the request memory — it is read to build
the photo list and never logged or returned (§3 隐私).

Per-job active-stage tracking: each analyze job carries its own `_Job` holder, so
the stage read on timeout/unhandled-error to report which stage was running is NOT
shared module state (no cross-request leak).
"""

from __future__ import annotations

import asyncio
import time

from ..logging_config import get_logger, request_id_var
from ..schemas import (
    Page,
    V3AnalyzeRequest,
    V3AnalyzeCompleted,
    V3CallbackError,
    V3Chapter,
    V3FailedEvent,
    V3JobStage,
    V3LayoutTree,
    V3Models,
    V3ProgressEvent,
    V3Usage,
)
from .. import callback
from ..agents.image_understanding import handler as vision
from ..agents.image_understanding import VisionError
from ..agents.template_select import handler as select_template
from ..agents.group_pages import handler as group_pages
from ..engine import generic_copy
from ..engine import skeleton_v3
from ..settings import get_settings

log = get_logger("v3_album")


class _Job:
    """Per-analyze-job holder. Tracks the stage currently running so timeout /
    unhandled-error paths can report which stage was active without a module-global
    (no cross-request leak)."""

    def __init__(self, req: V3AnalyzeRequest) -> None:
        self.req = req
        self.active_stage: V3JobStage | None = None


# ---------- callback helpers --------------------------------------------------


async def _emit_progress(job: _Job, stage: V3JobStage, progress: int) -> None:
    job.active_stage = stage
    envelope = V3ProgressEvent(
        event="progress",
        jobKind="analyze",
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
    if stage is not None:
        # Reset the bar on the failing stage before failing (mirrors v2 init): a
        # retry must not leave a half-filled stage behind. Best-effort so the fail
        # path never crashes on a callback hiccup.
        try:
            await _emit_progress(job, stage, 0)
        except Exception as exc:  # noqa: BLE001
            log.warning("v3_analyze.pre_fail_progress_error", error=str(exc))

    # Omit `stage` when absent: the V3 schemas are strict, so passing None to the
    # `V3JobStage` literal field is a validation error (the key is optional, not
    # nullable). Same reason V3Models below is built without explicit None kwargs.
    envelope = V3FailedEvent(
        event="failed",
        jobKind="analyze",
        requestId=job.req.requestId,
        error=V3CallbackError(code=code, message=message[:500]),
        **({"stage": stage} if stage is not None else {}),
    )
    await callback.post(str(job.req.callbackUrl), envelope)


# ---------- draft assembly ----------------------------------------------------


async def _build_preview(chapters: list[V3Chapter]) -> tuple[V3LayoutTree, list[Page]]:
    """Produce the preview-state tree + pages (WP1.4 select-template + WP1.5 generic).

    select-template (the recognition model) picks each page's templateId from the
    LEGAL candidates the WP0.4 engine exposes (`legal_candidates`); the model can
    never inject an illegal/hallucinated id. On any LLM failure the whole stage
    degrades to the pure-code §9 fallback (a template that holds each page's photos,
    slotted in order — `skeleton_v3.build_skeleton_v3`-equivalent). NO quality/hero/
    orientation matching; aspect mismatch is the renderer's center-cover concern.

    WP1.5 (#184) then layers the GENERIC 文案/色 onto those pages so the preview reads
    as a finished spread (§4.1(e) / §7.1): `generic_copy.fill_generic_copy` code-fills
    deterministic decoration (`folio` page numbers, `date`/`dateNum` from the photos'
    code-filled takenAt) into `texts`, leaving user-content slots empty for the章节故事
    环节 to author正式文案. The chapter tree's `accentColor`/`artFont` stay null
    placeholders (通用色 = the null placeholder; theme环节 fills real值). Pure code."""
    tree = V3LayoutTree(chapters=chapters)
    # AI 按画面效果重分章内页(group_pages);失败/不合法则该章回退确定性分页 —— 永不崩。
    # select-template 随后只为这些已分好的页挑 templateId(不再自己分页)。
    grouping = await group_pages.group_chapter_pages(chapters)
    page_dicts = await select_template.select_template_pages(chapters, grouping)
    # 书籍设计环节(§4.4)要能选/换封面/封底,前提是 draft skeleton 里真有一张
    # category=cover 页和一张 category=ending 页 —— 否则封面卡片找不到封面页,只能
    # auto-skip(本次缺口的根因)。这里在正文页前后确定性补齐默认封面/封底页(hero
    # 复用首/尾照片),并重排 pageIndex;封面 patch 仍是页级,Web 确认后才落库,Agent
    # 不写库 / 不推 stage(§3 不变式)。
    page_dicts = skeleton_v3.wrap_with_cover_ending(page_dicts, chapters)
    page_dicts = generic_copy.fill_generic_copy(page_dicts, chapters)
    pages = [Page(**page) for page in page_dicts]
    return tree, pages


# ---------- analyze job -------------------------------------------------------


async def _run_analyze(job: _Job) -> None:
    req = job.req
    started = time.monotonic()
    vision_call_count = 0
    vision_model: str | None = None

    # describe — WP1.3 (#182): real describe-content call → 章节树. The recognition
    # model authors只分章 + 每章 description + 每图 sceneDescription; the
    # deterministic photo attrs (width/height/orientation/takenAt) are code-filled
    # inside describe_content. OpenAI primary, 火山 failover (§6.8 第 2 条).
    await _emit_progress(job, "describe", 0)
    prompt_hint = req.meta.promptHint if req.meta else None
    try:
        described = await vision.describe_content(
            req.photos, language=req.language, prompt_hint=prompt_hint
        )
    except VisionError as exc:
        log.warning("v3_analyze.describe_failed", error=str(exc))
        await _emit_failure(job, code="AGENT_VISION_FAILED", message=str(exc), stage="describe")
        return
    except Exception as exc:  # noqa: BLE001
        log.exception("v3_analyze.describe_unhandled", error=str(exc))
        await _emit_failure(job, code="AGENT_VISION_FAILED", message=str(exc), stage="describe")
        return
    chapters = described.tree.chapters
    vision_call_count = described.call_count
    vision_model = described.model
    await _emit_progress(job, "describe", 100)

    # group — 分章 happens INSIDE describe-content (§4.1: grouping并进识图模型这一次
    # 调用). This stage stays as a progress beat for UI parity; no separate call.
    await _emit_progress(job, "group", 0)
    await _emit_progress(job, "group", 100)

    # template — WP1.4 (#183): select-template. The recognition model picks each
    # page's templateId from the legal candidates skeleton_v3 exposes; on any LLM
    # failure the stage degrades to the pure-code §9 fallback inside _build_preview.
    # _build_preview also runs WP1.5 generic-copy fill; both stay inside this guard so
    # any failure resets the bar and fails cleanly (失败可重试不污染 stage).
    await _emit_progress(job, "template", 0)
    try:
        tree, pages = await _build_preview(chapters)
    except Exception as exc:  # noqa: BLE001
        log.exception("v3_analyze.template_failed", error=str(exc))
        await _emit_failure(
            job, code="AGENT_OUTPUT_VALIDATION", message=str(exc), stage="template"
        )
        return
    await _emit_progress(job, "template", 100)

    # preview — WP1.5 (#184): generic 文案/色 are now baked into the pages inside
    # _build_preview (generic_copy.fill_generic_copy). This beat marks the
    # preview-state tree ready; the completed callback below ships it to Web.
    await _emit_progress(job, "preview", 0)
    await _emit_progress(job, "preview", 100)

    duration_ms = int((time.monotonic() - started) * 1000)
    envelope = V3AnalyzeCompleted(
        event="completed",
        jobKind="analyze",
        requestId=req.requestId,
        tree=tree,
        pages=pages,
        usage=V3Usage(
            durationMs=duration_ms,
            # describe-content ran one recognition-model call (WP1.3). models.vision
            # is the slot actually hit (GPT-5.5 Mini or 火山 on failover). V3Models
            # is built with vision only when known: the strict schema rejects an
            # explicit None for the optional `str` model-name field.
            visionCallCount=vision_call_count,
            models=V3Models(**({"vision": vision_model} if vision_model else {})),
        ),
    )
    await callback.post(str(req.callbackUrl), envelope)
    log.info(
        "v3_analyze.completed",
        duration_ms=duration_ms,
        chapters=len(tree.chapters),
        pages=len(pages),
    )


async def run_with_timeout(req: V3AnalyzeRequest) -> None:
    """Background-task entry point: bound `_run_analyze` by the configured budget and
    translate timeout/unhandled errors into the terminal failed callback, carrying the
    stage that was running (read from the per-job holder)."""
    settings = get_settings()
    job = _Job(req)
    token = request_id_var.set(req.requestId)
    try:
        try:
            await asyncio.wait_for(
                _run_analyze(job), timeout=settings.background_task_timeout_seconds
            )
        except asyncio.TimeoutError:
            log.error("v3_analyze.timeout")
            await _emit_failure(
                job,
                code="AGENT_TIMEOUT",
                message="background task exceeded timeout",
                stage=job.active_stage,
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("v3_analyze.unhandled", error=str(exc))
            await _emit_failure(
                job,
                code="AGENT_INTERNAL_ERROR",
                message=str(exc),
                stage=job.active_stage,
            )
    finally:
        request_id_var.reset(token)
