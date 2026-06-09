"""v2 album authoring endpoints.

W6a owns the `init` wiring (`POST /v2/album/init`): a single async 202 + v2
callback job that runs Stage 1 (vision → deterministic grouping/dedup) and
Stage 3 (deterministic skeleton layout), then emits a `V2Callback` with
`jobKind='init'` carrying the draft tree (tech-plan §1.1, §3, §4).

W6b / W6c extend this same file with the remaining endpoints (theme,
chapter-chat, finalize, edit) — they own different sections, so keep init
self-contained here.
"""

from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, BackgroundTasks, Depends

from ..auth import require_bearer
from ..logging_config import get_logger, request_id_var
from ..schemas import JobError, LayoutRequest, Page, PhotoAnalysis, PhotoIn
from ..schemas_v2 import (
    AlbumDraft,
    Usage,
    V2BasePages,
    V2Chapter,
    V2FailedCallback,
    V2InitCompletedCallback,
    V2InitRequest,
    V2JobStage,
    V2Meta,
    V2Models,
    V2Photo,
    V2PhotoAnalysis,
    V2ProgressCallback,
)
from ..services import callback, grouping, skeleton, vision_mock
from ..services.grouping import GroupingPhoto
from ..services.vision import VisionError
from ..services.vision import analyze as vision_analyze
from ..settings import get_settings

router = APIRouter()
log = get_logger("v2_album")

# init has no user prompt field; promptHint is an optional soft theme hint, so
# vision still needs *some* prompt. Fall back to a neutral one when absent.
_DEFAULT_PROMPT = "A memoir photo album."


# ---------- callback helpers --------------------------------------------------


async def _emit_progress(req: V2InitRequest, stage: V2JobStage, progress: int) -> None:
    envelope = V2ProgressCallback(
        event="progress",
        jobKind="init",
        requestId=req.requestId,
        stage=stage,
        progress=progress,
    )
    await callback.post(str(req.callbackUrl), envelope)


async def _emit_failure(
    req: V2InitRequest,
    *,
    code: str,
    message: str,
    stage: V2JobStage | None = None,
) -> None:
    if stage is not None:
        # Reset the bar on the failing stage before failing (mirrors the v1
        # pipeline P0-7 behaviour); best-effort so we never crash the fail path.
        try:
            await _emit_progress(req, stage, 0)
        except Exception as exc:  # noqa: BLE001
            log.warning("v2_init.pre_fail_progress_error", error=str(exc))

    envelope = V2FailedCallback(
        event="failed",
        jobKind="init",
        requestId=req.requestId,
        error=JobError(code=code, message=message[:500]),
        stage=stage,
    )
    await callback.post(str(req.callbackUrl), envelope)


# ---------- adapters ----------------------------------------------------------


def _layout_request_from_init(req: V2InitRequest) -> LayoutRequest:
    """Adapt the v2 init payload to the LayoutRequest the vision stage consumes
    (base64 photos + a prompt). EXIF takenAt is carried separately into grouping."""
    prompt = req.meta.promptHint if (req.meta and req.meta.promptHint) else _DEFAULT_PROMPT
    return LayoutRequest(
        requestId=req.requestId,
        prompt=prompt,
        language=req.language,
        callbackUrl=req.callbackUrl,
        photos=[
            PhotoIn(photoId=p.photoId, base64=p.base64, width=p.width, height=p.height)
            for p in req.photos
        ],
    )


def _to_v2_analysis(analysis: PhotoAnalysis) -> V2PhotoAnalysis:
    """Drop the outward-facing `location` field and pin the composing-hint enums
    (vision may leave them None on the v1 PhotoAnalysis; V2PhotoAnalysis requires
    them). `location` never enters the v2 tree — v1 has no place dimension (D-GPS)."""
    return V2PhotoAnalysis(
        photoId=analysis.photoId,
        description=analysis.description,
        tags=list(analysis.tags),
        quality=analysis.quality,
        orientation=analysis.orientation,
        peopleCount=analysis.peopleCount or "0",
        scene=analysis.scene or "outdoor",
        mood=analysis.mood or "warm",
        timeOfDay=analysis.timeOfDay,
    )


def _grouping_photos(req: V2InitRequest, photos, groups) -> list[GroupingPhoto]:
    """Fuse vision output with the request EXIF into the grouping engine's input.
    Single batched vision call → batch_id is constant; group label becomes the
    in-segment groupHint. No place dimension and no cross-batch dedup (D-GPS,
    single batch)."""
    order_by_id = {p.photoId: idx for idx, p in enumerate(req.photos)}
    taken_at_by_id = {p.photoId: (p.exif.takenAt if p.exif else None) for p in req.photos}
    hint_by_id: dict[str, str] = {}
    for group in groups:
        for photo_id in group.photoIds:
            hint_by_id.setdefault(photo_id, group.label)

    return [
        GroupingPhoto(
            photo_id=analysis.photoId,
            analysis=_to_v2_analysis(analysis),
            order=order_by_id.get(analysis.photoId, 0),
            batch_id=0,
            taken_at=taken_at_by_id.get(analysis.photoId),
            group_hint=hint_by_id.get(analysis.photoId),
            duplicate_of=None,
        )
        for analysis in photos
    ]


def _assemble_draft(
    req: V2InitRequest,
    photo_pool: list[V2Photo],
    chapters: list[V2Chapter],
) -> AlbumDraft:
    """Run the deterministic skeleton engine and fold its pages back into the
    grouping chapters + base pages to produce the AlbumDraft (tech-plan §2/§4)."""
    skeleton_result = skeleton.build_skeleton(
        {
            "albumId": req.albumId,
            "photos": [photo.model_dump(mode="json") for photo in photo_pool],
            "chapters": [chapter.model_dump(mode="json") for chapter in chapters],
        }
    )

    pages_by_chapter = {
        chapter["chapterId"]: chapter["pages"] for chapter in skeleton_result["chapters"]
    }
    chapters_with_pages = [
        chapter.model_copy(
            update={
                "pages": [Page(**page) for page in pages_by_chapter.get(chapter.chapterId, [])]
            }
        )
        for chapter in chapters
    ]

    base = skeleton_result["basePages"]
    return AlbumDraft(
        version="v2",
        meta=V2Meta(
            theme=None,  # set in the /theme stage (W6b)
            style="warm-film",
            language=req.language,
            promptHint=(req.meta.promptHint if req.meta else None),
        ),
        photoPool=photo_pool,
        basePages=V2BasePages(
            cover=Page(**base["cover"]),
            toc=Page(**base["toc"]) if base.get("toc") else None,
            ending=Page(**base["ending"]),
        ),
        chapters=chapters_with_pages,
    )


# ---------- init job ----------------------------------------------------------


async def _run_init(req: V2InitRequest) -> None:
    settings = get_settings()
    started = time.monotonic()

    # Stage 1a — vision (mock vs real is the only branch; later stages are
    # deterministic and identical across modes, tech-plan §9.3).
    await _emit_progress(req, "vision", 0)
    layout_req = _layout_request_from_init(req)
    vision_call_count = 0
    vision_model: str | None = None
    if settings.agent_pipeline_mode == "mock":
        vision_result = vision_mock.analyze(layout_req)
    else:
        try:
            vision_result, _tokens = await vision_analyze(layout_req)
        except VisionError as exc:
            log.warning("v2_init.vision_failed", error=str(exc))
            await _emit_failure(req, code="AGENT_VISION_FAILED", message=str(exc), stage="vision")
            return
        vision_call_count = 1
        vision_model = settings.ark_vision_model
    await _emit_progress(req, "vision", 100)

    # Stage 1b — deterministic grouping + duplicate folding.
    await _emit_progress(req, "grouping", 0)
    try:
        photo_pool, chapters = grouping.build_photo_pool_and_chapters(
            _grouping_photos(req, vision_result.photos, vision_result.groups)
        )
    except Exception as exc:  # noqa: BLE001  (deterministic; should not happen)
        log.exception("v2_init.grouping_failed", error=str(exc))
        await _emit_failure(
            req, code="AGENT_OUTPUT_VALIDATION", message=str(exc), stage="grouping"
        )
        return
    await _emit_progress(req, "grouping", 100)

    # Stage 3 — deterministic skeleton layout → draft tree.
    await _emit_progress(req, "skeleton", 0)
    try:
        draft = _assemble_draft(req, photo_pool, chapters)
    except Exception as exc:  # noqa: BLE001  (deterministic; should not happen)
        log.exception("v2_init.skeleton_failed", error=str(exc))
        await _emit_failure(
            req, code="AGENT_OUTPUT_VALIDATION", message=str(exc), stage="skeleton"
        )
        return
    await _emit_progress(req, "skeleton", 100)

    duration_ms = int((time.monotonic() - started) * 1000)
    envelope = V2InitCompletedCallback(
        event="completed",
        jobKind="init",
        requestId=req.requestId,
        draftTree=draft,
        usage=Usage(
            durationMs=duration_ms,
            visionCallCount=vision_call_count,
            models=V2Models(vision=vision_model, planning=None),
        ),
    )
    await callback.post(str(req.callbackUrl), envelope)
    log.info(
        "v2_init.completed",
        duration_ms=duration_ms,
        chapters=len(draft.chapters),
        photos=len(draft.photoPool),
    )


async def _run_init_with_timeout(req: V2InitRequest) -> None:
    settings = get_settings()
    token = request_id_var.set(req.requestId)
    try:
        try:
            await asyncio.wait_for(
                _run_init(req), timeout=settings.background_task_timeout_seconds
            )
        except asyncio.TimeoutError:
            log.error("v2_init.timeout")
            await _emit_failure(
                req, code="AGENT_TIMEOUT", message="background task exceeded timeout"
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("v2_init.unhandled", error=str(exc))
            await _emit_failure(req, code="AGENT_INTERNAL_ERROR", message=str(exc))
    finally:
        request_id_var.reset(token)


@router.post("/v2/album/init", status_code=202, dependencies=[Depends(require_bearer)])
async def submit_init(req: V2InitRequest, background_tasks: BackgroundTasks) -> dict:
    log.info("v2_init.accepted", photo_count=len(req.photos), language=req.language)
    background_tasks.add_task(_run_init_with_timeout, req)
    return {"ok": True, "data": {"requestId": req.requestId, "accepted": True}}
