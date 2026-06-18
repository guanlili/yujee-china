"""V3 album endpoints — 五环节状态机的 `/v3/*` 路由(architecture §6.8).

WP1.1 owns ONLY the `/v3/analyze` async接入骨架: accept the base64 photos, return
202 immediately, run the analysis pipeline in a background task, and stream
`progress` → `completed`/`failed` callbacks back to the Web side
(`V3Callback`, schemas.py / packages/contracts/src/v3.ts — single truth source).

The analysis pipeline BODY is WP1.3 (describe-content vision → 章节树) / WP1.4
(select-template) / WP1.5 (通用文案/色 + 预览 + settle). This WP wires the async
job + callback transport faithfully and stands a **clearly-marked seam** in place
of the real vision/templating work:

  * It does NOT fake real image understanding (§ task hard constraint). Instead it
    builds a minimal, honest draft from the request metadata alone via the WP0.4
    pure-code engine (`skeleton_v3.build_skeleton_v3`): one photo → one chapter →
    one interior page, photos slotted in declaration order, empty texts/colors.
  * `describe`/`group`/`template`/`preview` progress callbacks round-trip so the
    202 + callback + stage flow is fully testable end-to-end today.

Stateless (§3 数据归属): Agent holds no draft/stage; Web owns the tree + stage and
merges the callback. base64 never leaves the request memory — it is read to build
the photo list and never logged or returned (§3 隐私).
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends

from ..auth import require_bearer
from ..logging_config import get_logger, request_id_var
from ..schemas import (
    Page,
    V3AcceptedData,
    V3AcceptedResponse,
    V3AnalyzeRequest,
    V3AnalyzeCompleted,
    V3CallbackError,
    V3Chapter,
    V3ChapterPhoto,
    V3FailedEvent,
    V3JobStage,
    V3LayoutTree,
    V3Models,
    V3ProgressEvent,
    V3Usage,
)
from ..services import callback
from ..services import skeleton_v3
from ..settings import get_settings

router = APIRouter()
log = get_logger("v3_album")
_active_stage_by_request: dict[str, V3JobStage] = {}


# ---------- callback helpers --------------------------------------------------


async def _emit_progress(req: V3AnalyzeRequest, stage: V3JobStage, progress: int) -> None:
    _active_stage_by_request[req.requestId] = stage
    envelope = V3ProgressEvent(
        event="progress",
        jobKind="analyze",
        requestId=req.requestId,
        stage=stage,
        progress=progress,
    )
    await callback.post(str(req.callbackUrl), envelope)


async def _emit_failure(
    req: V3AnalyzeRequest,
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
            await _emit_progress(req, stage, 0)
        except Exception as exc:  # noqa: BLE001
            log.warning("v3_analyze.pre_fail_progress_error", error=str(exc))

    # Omit `stage` when absent: the V3 schemas are strict, so passing None to the
    # `V3JobStage` literal field is a validation error (the key is optional, not
    # nullable). Same reason V3Models below is built without explicit None kwargs.
    envelope = V3FailedEvent(
        event="failed",
        jobKind="analyze",
        requestId=req.requestId,
        error=V3CallbackError(code=code, message=message[:500]),
        **({"stage": stage} if stage is not None else {}),
    )
    await callback.post(str(req.callbackUrl), envelope)


# ---------- draft assembly (WP1.1 seam) ---------------------------------------


def _orientation(width: int, height: int) -> str:
    """Placeholder orientation from the request dimensions.

    `V3ChapterPhoto.orientation` is a required field, so the seam fills it
    deterministically from width/height. TODO(WP1.2 deterministic-attrs): the
    确定性属性补全 WP owns computing width/height/orientation/takenAt as the real
    code-filled (not LLM) attributes — this is the minimal stand-in until then."""
    if width > height:
        return "landscape"
    if height > width:
        return "portrait"
    return "square"


def _seed_chapters(req: V3AnalyzeRequest) -> list[V3Chapter]:
    """Build a minimal honest 章节树 from request metadata ALONE — NO image
    understanding (§ task: do not fake real vision analysis).

    TODO(WP1.3 describe-content): the real vision call partitions photos into
    chapters and writes every chapter `description` + each photo `sceneDescription`
    (the only 3 LLM-authored fields, §4.1). Until then: one chapter per photo (一图
    一章不跨章, §4.1), empty descriptions, accentColor/artFont null placeholders
    (theme 环节填, §4.1)."""
    chapters: list[V3Chapter] = []
    for idx, photo in enumerate(req.photos):
        chapters.append(
            V3Chapter(
                chapterId=f"ch_{idx + 1}",
                description="",  # TODO(WP1.3 describe-content): vision writes this
                accentColor=None,  # null placeholder until theme stage (§4.1)
                artFont=None,
                photos=[
                    V3ChapterPhoto(
                        photoId=photo.photoId,
                        # TODO(WP1.3 describe-content): vision writes sceneDescription
                        sceneDescription="",
                        width=photo.width,
                        height=photo.height,
                        orientation=_orientation(photo.width, photo.height),
                        takenAt=photo.exif.takenAt if photo.exif else None,
                    )
                ],
            )
        )
    return chapters


def _build_preview(chapters: list[V3Chapter]) -> tuple[V3LayoutTree, list[Page]]:
    """Run the WP0.4 pure-code engine to produce the preview-state tree + pages.

    TODO(WP1.4 select-template): the vision model picks templateId from the legal
    candidates; this seam takes the deterministic fallback only (skeleton_v3 picks
    a template that can hold each chapter's photos and slots them in order).
    TODO(WP1.5 describe-content/generic-copy): generic 文案/色 are layered onto the
    pages here before preview — the seam leaves texts empty."""
    tree = V3LayoutTree(chapters=chapters)
    page_dicts = skeleton_v3.build_skeleton_v3(
        [chapter.model_dump(mode="json") for chapter in chapters]
    )
    pages = [Page(**page) for page in page_dicts]
    return tree, pages


# ---------- analyze job -------------------------------------------------------


async def _run_analyze(req: V3AnalyzeRequest) -> None:
    started = time.monotonic()

    # describe — TODO(WP1.3): real vision分章 + sceneDescription. Seed only here.
    await _emit_progress(req, "describe", 0)
    try:
        chapters = _seed_chapters(req)
    except Exception as exc:  # noqa: BLE001
        log.exception("v3_analyze.describe_failed", error=str(exc))
        await _emit_failure(req, code="AGENT_VISION_FAILED", message=str(exc), stage="describe")
        return
    await _emit_progress(req, "describe", 100)

    # group — TODO(WP1.2/1.3): time-signal grouping. Seam: one chapter per photo.
    await _emit_progress(req, "group", 0)
    await _emit_progress(req, "group", 100)

    # template — TODO(WP1.4): select-template + 兜底. Seam: deterministic fallback.
    await _emit_progress(req, "template", 0)
    try:
        tree, pages = _build_preview(chapters)
    except Exception as exc:  # noqa: BLE001
        log.exception("v3_analyze.template_failed", error=str(exc))
        await _emit_failure(
            req, code="AGENT_OUTPUT_VALIDATION", message=str(exc), stage="template"
        )
        return
    await _emit_progress(req, "template", 100)

    # preview — TODO(WP1.5): generic 文案/色 baked into pages before preview.
    await _emit_progress(req, "preview", 0)
    await _emit_progress(req, "preview", 100)

    duration_ms = int((time.monotonic() - started) * 1000)
    envelope = V3AnalyzeCompleted(
        event="completed",
        jobKind="analyze",
        requestId=req.requestId,
        tree=tree,
        pages=pages,
        usage=V3Usage(
            durationMs=duration_ms,
            # Seam runs no vision/planning call — TODO(WP1.3) bumps visionCallCount
            # and sets models.vision. V3Models built bare: strict schema rejects an
            # explicit None for the optional `str` model-name fields.
            visionCallCount=0,
            models=V3Models(),
        ),
    )
    await callback.post(str(req.callbackUrl), envelope)
    log.info(
        "v3_analyze.completed",
        duration_ms=duration_ms,
        chapters=len(tree.chapters),
        pages=len(pages),
    )


async def _run_analyze_with_timeout(req: V3AnalyzeRequest) -> None:
    settings = get_settings()
    token = request_id_var.set(req.requestId)
    _active_stage_by_request.pop(req.requestId, None)
    try:
        try:
            await asyncio.wait_for(
                _run_analyze(req), timeout=settings.background_task_timeout_seconds
            )
        except asyncio.TimeoutError:
            log.error("v3_analyze.timeout")
            await _emit_failure(
                req,
                code="AGENT_TIMEOUT",
                message="background task exceeded timeout",
                stage=_active_stage_by_request.get(req.requestId),
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("v3_analyze.unhandled", error=str(exc))
            await _emit_failure(
                req,
                code="AGENT_INTERNAL_ERROR",
                message=str(exc),
                stage=_active_stage_by_request.get(req.requestId),
            )
    finally:
        _active_stage_by_request.pop(req.requestId, None)
        request_id_var.reset(token)


@router.post("/v3/analyze", status_code=202, dependencies=[Depends(require_bearer)])
async def submit_analyze(
    req: V3AnalyzeRequest, background_tasks: BackgroundTasks
) -> dict[str, Any]:
    # base64 is read into the background task only; never logged (§3 隐私).
    log.info("v3_analyze.accepted", photo_count=len(req.photos), language=req.language)
    background_tasks.add_task(_run_analyze_with_timeout, req)
    return V3AcceptedResponse(
        ok=True,
        data=V3AcceptedData(requestId=req.requestId, accepted=True),
    ).model_dump(mode="json")
