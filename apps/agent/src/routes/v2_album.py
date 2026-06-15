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
import json
import time
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from ..auth import require_bearer
from ..logging_config import get_logger, request_id_var
from ..schemas import JobError, LayoutRequest, Page, PhotoAnalysis, PhotoIn
from ..schemas_v2 import (
    AlbumDraft,
    Usage,
    V2AddCompletedCallback,
    V2AddPhotosRequest,
    V2BasePages,
    V2Chapter,
    V2ChapterChatRequest,
    V2ChapterChatResponse,
    V2EditRequest,
    V2EditResponse,
    V2FailedCallback,
    V2FinalizeCompletedCallback,
    V2FinalizeRequest,
    V2InitCompletedCallback,
    V2InitRequest,
    V2JobStage,
    V2Meta,
    V2Models,
    V2Photo,
    V2PhotoAnalysis,
    V2ProgressCallback,
    V2ThemeRequest,
    V2ThemeResponse,
)
from ..services import (
    callback,
    chapter_chat,
    chat_edit_v2,
    finalize as finalize_service,
    grouping,
    skeleton,
    theme,
    vision_mock,
)
from ..services.chapter_chat import ChapterChatError
from ..services.chat_edit_v2 import V2EditError
from ..services.finalize import FinalizeError
from ..services.grouping import GroupingPhoto
from ..services.theme import ThemeError
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


# ---------- add-photos job (W11: mid-edit append) -----------------------------
#
# Same async 202 + callback shape as init, but it processes the NEW photos ALONE:
# vision → grouping → skeleton chapter pages only. No cover/toc/ending — those stay
# fixed on the existing album; the Web side inserts the returned pages just before
# the (untouched) ending page. Templates are seeded by new chapterIds, so this is
# fully independent of the existing layout (no need to pass it in).


async def _emit_add_progress(req: V2AddPhotosRequest, stage: V2JobStage, progress: int) -> None:
    envelope = V2ProgressCallback(
        event="progress", jobKind="add", requestId=req.requestId, stage=stage, progress=progress
    )
    await callback.post(str(req.callbackUrl), envelope)


async def _emit_add_failure(
    req: V2AddPhotosRequest, *, code: str, message: str, stage: V2JobStage | None = None
) -> None:
    if stage is not None:
        try:
            await _emit_add_progress(req, stage, 0)
        except Exception as exc:  # noqa: BLE001
            log.warning("v2_add.pre_fail_progress_error", error=str(exc))
    envelope = V2FailedCallback(
        event="failed",
        jobKind="add",
        requestId=req.requestId,
        error=JobError(code=code, message=message[:500]),
        stage=stage,
    )
    await callback.post(str(req.callbackUrl), envelope)


def _layout_request_from_add(req: V2AddPhotosRequest) -> LayoutRequest:
    prompt = req.meta.promptHint if (req.meta and req.meta.promptHint) else _DEFAULT_PROMPT
    return LayoutRequest(
        requestId=req.requestId,
        prompt=prompt,
        language=req.language,
        callbackUrl=req.callbackUrl,
        photos=[
            PhotoIn(photoId=p.photoId, base64=p.base64, width=p.width, height=p.height)
            for p in req.newPhotos
        ],
    )


def _grouping_photos_add(req: V2AddPhotosRequest, photos, groups) -> list[GroupingPhoto]:
    order_by_id = {p.photoId: idx for idx, p in enumerate(req.newPhotos)}
    taken_at_by_id = {p.photoId: (p.exif.takenAt if p.exif else None) for p in req.newPhotos}
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


async def _run_add_photos(req: V2AddPhotosRequest) -> None:
    settings = get_settings()
    started = time.monotonic()

    # Stage 1a — vision on the new photos only.
    await _emit_add_progress(req, "vision", 0)
    layout_req = _layout_request_from_add(req)
    vision_call_count = 0
    vision_model: str | None = None
    if settings.agent_pipeline_mode == "mock":
        vision_result = vision_mock.analyze(layout_req)
    else:
        try:
            vision_result, _tokens = await vision_analyze(layout_req)
        except VisionError as exc:
            log.warning("v2_add.vision_failed", error=str(exc))
            await _emit_add_failure(req, code="AGENT_VISION_FAILED", message=str(exc), stage="vision")
            return
        vision_call_count = 1
        vision_model = settings.ark_vision_model
    await _emit_add_progress(req, "vision", 100)

    # Stage 1b — grouping the new photos standalone → new chapters.
    await _emit_add_progress(req, "grouping", 0)
    try:
        photo_pool, chapters = grouping.build_photo_pool_and_chapters(
            _grouping_photos_add(req, vision_result.photos, vision_result.groups)
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("v2_add.grouping_failed", error=str(exc))
        await _emit_add_failure(req, code="AGENT_OUTPUT_VALIDATION", message=str(exc), stage="grouping")
        return
    await _emit_add_progress(req, "grouping", 100)

    # Stage 3 — skeleton chapter pages only (mirrors build_skeleton's body_pages
    # loop; cover/toc/ending are skipped — the existing album keeps its own).
    await _emit_add_progress(req, "skeleton", 0)
    try:
        photos_by_id = {photo.photoId: photo.model_dump(mode="json") for photo in photo_pool}
        new_pages: list[Page] = []
        for chapter in chapters:
            chapter_photos = [
                photos_by_id[pid]
                for pid in chapter.photoIds
                if pid in photos_by_id and photos_by_id[pid].get("used")
            ]
            new_pages.extend(skeleton.build_chapter_pages(req.albumId, chapter.chapterId, chapter_photos))
        if not new_pages:
            raise ValueError("no pages produced for the new photos")
        # Local reindex 0..k; the Web side re-slots them before the ending page.
        for page_index, page in enumerate(new_pages):
            page["pageIndex"] = page_index
    except Exception as exc:  # noqa: BLE001
        log.exception("v2_add.skeleton_failed", error=str(exc))
        await _emit_add_failure(req, code="AGENT_OUTPUT_VALIDATION", message=str(exc), stage="skeleton")
        return
    await _emit_add_progress(req, "skeleton", 100)

    # Strip the new photos to the 5 outward-facing fields (invariant 12).
    new_photos = [
        PhotoAnalysis(
            photoId=photo.analysis.photoId,
            description=photo.analysis.description,
            tags=list(photo.analysis.tags),
            quality=photo.analysis.quality,
            orientation=photo.analysis.orientation,
        )
        for photo in photo_pool
        if photo.used
    ]

    duration_ms = int((time.monotonic() - started) * 1000)
    envelope = V2AddCompletedCallback(
        event="completed",
        jobKind="add",
        requestId=req.requestId,
        newPhotos=new_photos,
        newPages=[Page(**page) for page in new_pages],
        usage=Usage(
            durationMs=duration_ms,
            visionCallCount=vision_call_count,
            models=V2Models(vision=vision_model, planning=None),
        ),
    )
    await callback.post(str(req.callbackUrl), envelope)
    log.info("v2_add.completed", duration_ms=duration_ms, new_pages=len(new_pages), new_photos=len(new_photos))


async def _run_add_with_timeout(req: V2AddPhotosRequest) -> None:
    settings = get_settings()
    token = request_id_var.set(req.requestId)
    try:
        try:
            await asyncio.wait_for(
                _run_add_photos(req), timeout=settings.background_task_timeout_seconds
            )
        except asyncio.TimeoutError:
            log.error("v2_add.timeout")
            await _emit_add_failure(req, code="AGENT_TIMEOUT", message="background task exceeded timeout")
        except Exception as exc:  # noqa: BLE001
            log.exception("v2_add.unhandled", error=str(exc))
            await _emit_add_failure(req, code="AGENT_INTERNAL_ERROR", message=str(exc))
    finally:
        request_id_var.reset(token)


@router.post("/v2/album/add-photos", status_code=202, dependencies=[Depends(require_bearer)])
async def submit_add_photos(req: V2AddPhotosRequest, background_tasks: BackgroundTasks) -> dict:
    log.info("v2_add.accepted", photo_count=len(req.newPhotos), language=req.language)
    background_tasks.add_task(_run_add_with_timeout, req)
    return {"ok": True, "data": {"requestId": req.requestId, "accepted": True}}


# ============================================================================
# theme + chapter-chat (W6b) — synchronous endpoints wiring the W3 pure
# services (services/theme.py, services/chapter_chat.py). Stateless: Agent
# never persists the draft; Web owns the tree and merges the response back
# (tech-plan §1.2/§1.3). DeepSeek failure → AGENT_PLANNING_FAILED/502 (§1.6).
# ============================================================================


def _mock_complete(payload: dict[str, Any]) -> Any:
    """Build a deterministic injected `complete` fn returning a single chat
    completion whose JSON content the W3 service then coerces — mirroring
    vision_mock so the Web→Agent round-trip is testable without a DeepSeek key.
    The service still applies all coercion, state-machine, and layout-rule
    clamping on top of this raw payload."""

    async def complete(**_kwargs: Any) -> dict[str, Any]:
        return {
            "choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0},
        }

    return complete


def _mock_theme_complete(req: V2ThemeRequest) -> Any:
    """A neutral theme proposal derived only from the supplied overview — the
    service coerces it into V2Theme + cover and never invents people/places."""
    subject = req.currentTheme.subject if req.currentTheme else req.clustersOverview[0].label
    payload: dict[str, Any] = {
        "theme": {"subject": subject, "tone": "warm", "style": "warm-film"},
        "assistantReply": (
            f'(mock) I set a warm direction around "{subject}". '
            "Real proposals arrive once the model is connected."
        ),
    }
    # Still proposing (no fixed theme) → offer pickable candidates derived only
    # from the supplied overview labels (mirrors editor.html themeOpt1-3).
    if req.currentTheme is None:
        labels = [c.label.strip() for c in req.clustersOverview if c.label.strip()]
        # Pad to at least two so the optional 2-3 bound holds.
        while len(labels) < 2:
            labels.append(f"{subject} {len(labels) + 1}")
        payload["themeOptions"] = [
            {"subject": label, "label": label, "tone": "warm", "style": "warm-film"}
            for label in labels[:3]
        ]
    return _mock_complete(payload)


def _mock_chapter_chat_complete(req: V2ChapterChatRequest) -> Any:
    """A deterministic chat turn. The service decides the actual mode/state from
    `chapter.state` + ask_count; in generate modes it falls back to its own
    rules-safe page texts when the model omits pagesTexts (we omit them here)."""
    # Chapter-title candidates (editor.html chipName1-4) grounded in the cluster
    # label only — no invented names/dates. The service trims/de-dupes these.
    label = req.chapter.cluster.label.strip() or req.chapter.chapterId
    name_options = [label, f"{label} —", f"{label} ·"][:3]
    return _mock_complete(
        {
            "assistantReply": (
                f'(mock) Noted — "{req.userMessage[:120]}". '
                "Real authoring runs once the model is connected."
            ),
            "nameOptions": name_options,
        }
    )


@router.post("/v2/album/theme", dependencies=[Depends(require_bearer)])
async def submit_theme(req: V2ThemeRequest) -> dict:
    settings = get_settings()
    log.info(
        "v2_theme.accepted",
        album_id=req.albumId,
        clusters=len(req.clustersOverview),
        language=req.language,
        has_current_theme=req.currentTheme is not None,
    )
    complete = _mock_theme_complete(req) if settings.agent_pipeline_mode == "mock" else None
    try:
        response: V2ThemeResponse = await theme.run(req, complete=complete)
    except ThemeError as exc:
        log.warning("v2_theme.failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "ok": False,
                "error": {"code": "AGENT_PLANNING_FAILED", "message": str(exc)[:300]},
            },
        ) from exc
    except Exception as exc:  # noqa: BLE001 — must answer in contract shape
        log.exception("v2_theme.unhandled", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "ok": False,
                "error": {"code": "AGENT_INTERNAL_ERROR", "message": str(exc)[:300]},
            },
        ) from exc
    return {"ok": True, "data": response.model_dump(exclude_none=True, mode="json")}


# ============================================================================
# finalize (W6c) — async 202 + v2 callback job. Mirrors init's BackgroundTask +
# callback shape (W6a), but runs Stage 5 (services/finalize.py): the
# deterministic AlbumDraft → flat LayoutV2 flatten. The draftTree carries no
# base64 — Agent stays stateless and never sees the originals (invariant 1).
# completed carries `jobKind='finalize'` + the flat `layout`; failures carry
# `jobKind='finalize'`. progress uses stage='finalize' throughout (tech-plan
# §1.4 / §5.2). Flatten validation failure → AGENT_OUTPUT_VALIDATION (§1.6).
# ============================================================================


async def _emit_finalize_progress(req: V2FinalizeRequest, progress: int) -> None:
    envelope = V2ProgressCallback(
        event="progress",
        jobKind="finalize",
        requestId=req.requestId,
        stage="finalize",
        progress=progress,
    )
    await callback.post(str(req.callbackUrl), envelope)


async def _emit_finalize_failure(
    req: V2FinalizeRequest,
    *,
    code: str,
    message: str,
    stage: V2JobStage | None = None,
) -> None:
    if stage is not None:
        # Reset the bar on the failing stage before failing (mirrors init / the
        # v1 P0-7 behaviour); best-effort so we never crash the fail path.
        try:
            await _emit_finalize_progress(req, 0)
        except Exception as exc:  # noqa: BLE001
            log.warning("v2_finalize.pre_fail_progress_error", error=str(exc))

    envelope = V2FailedCallback(
        event="failed",
        jobKind="finalize",
        requestId=req.requestId,
        error=JobError(code=code, message=message[:500]),
        stage=stage,
    )
    await callback.post(str(req.callbackUrl), envelope)


async def _run_finalize(req: V2FinalizeRequest) -> None:
    started = time.monotonic()

    # Single deterministic stage (no LLM, no network): flatten the tree into the
    # external flat LayoutV2 and hard-validate it (finalize.validate_v2).
    await _emit_finalize_progress(req, 0)
    try:
        layout = finalize_service.finalize(req.draftTree)
    except FinalizeError as exc:
        # The flattened layout failed validate_v2 — surface as AGENT_OUTPUT_
        # VALIDATION (§1.6; theory: deterministic, should not happen).
        log.warning("v2_finalize.validation_failed", error=str(exc))
        await _emit_finalize_failure(
            req, code="AGENT_OUTPUT_VALIDATION", message=str(exc), stage="finalize"
        )
        return
    except Exception as exc:  # noqa: BLE001  (deterministic; should not happen)
        log.exception("v2_finalize.flatten_failed", error=str(exc))
        await _emit_finalize_failure(
            req, code="AGENT_OUTPUT_VALIDATION", message=str(exc), stage="finalize"
        )
        return
    await _emit_finalize_progress(req, 100)

    duration_ms = int((time.monotonic() - started) * 1000)
    envelope = V2FinalizeCompletedCallback(
        event="completed",
        jobKind="finalize",
        requestId=req.requestId,
        layout=layout,
        usage=Usage(
            durationMs=duration_ms,
            # Stage 5 core is deterministic — no vision/planning calls here
            # (the §5.2 LLM niceties are deferred, see services/finalize.py).
            models=V2Models(vision=None, planning=None),
        ),
    )
    await callback.post(str(req.callbackUrl), envelope)
    log.info(
        "v2_finalize.completed",
        duration_ms=duration_ms,
        pages=len(layout.pages),
        photos=len(layout.photos),
    )


async def _run_finalize_with_timeout(req: V2FinalizeRequest) -> None:
    settings = get_settings()
    token = request_id_var.set(req.requestId)
    try:
        try:
            await asyncio.wait_for(
                _run_finalize(req), timeout=settings.background_task_timeout_seconds
            )
        except asyncio.TimeoutError:
            log.error("v2_finalize.timeout")
            await _emit_finalize_failure(
                req, code="AGENT_TIMEOUT", message="background task exceeded timeout"
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("v2_finalize.unhandled", error=str(exc))
            await _emit_finalize_failure(req, code="AGENT_INTERNAL_ERROR", message=str(exc))
    finally:
        request_id_var.reset(token)


@router.post("/v2/album/finalize", status_code=202, dependencies=[Depends(require_bearer)])
async def submit_finalize(req: V2FinalizeRequest, background_tasks: BackgroundTasks) -> dict:
    log.info(
        "v2_finalize.accepted",
        album_id=req.albumId,
        chapters=len(req.draftTree.chapters),
        photos=len(req.draftTree.photoPool),
    )
    background_tasks.add_task(_run_finalize_with_timeout, req)
    return {"ok": True, "data": {"requestId": req.requestId, "accepted": True}}


# ============================================================================
# edit (W6c) — synchronous endpoint wiring the W5 service (services/
# chat_edit_v2.py). Operates on the finalized flat `currentLayout`, returns a
# `layoutPatch` the Web side applies. Stateless: Agent never persists the
# layout (tech-plan §1.5). DeepSeek/patch failure → AGENT_CHAT_FAILED/502
# (§1.6). Mirrors the W6b theme/chapter-chat synchronous shape.
# ============================================================================


def _mock_edit_complete(req: V2EditRequest) -> Any:
    """Deterministic injected `complete` returning a single no-op text edit so
    the Web→Agent round-trip is testable without a DeepSeek key. Re-write one of
    the cover's existing text slots back to itself: the service still runs all
    coercion / re-template / clamp / validate_v2 on top, and the resulting patch
    always re-validates because nothing actually changed (mirrors the W6b mocks).
    """
    cover = req.currentLayout.pages[0]
    if cover.texts:
        slot, value = next(iter(cover.texts.items()))
        texts = {slot: value}
    else:
        texts = {}
    return _mock_complete(
        {
            "assistantReply": (
                f'(mock) Noted — "{req.userMessage[:120]}". '
                "Real editing runs once the model is connected."
            ),
            "layoutPatch": [{"pageIndex": cover.pageIndex, "texts": texts}],
        }
    )


@router.post("/v2/album/edit", dependencies=[Depends(require_bearer)])
async def submit_edit(req: V2EditRequest) -> dict:
    settings = get_settings()
    log.info(
        "v2_edit.accepted",
        album_id=req.albumId,
        pages=len(req.currentLayout.pages),
        history_len=len(req.history),
        language=req.language,
    )
    complete = _mock_edit_complete(req) if settings.agent_pipeline_mode == "mock" else None
    try:
        response: V2EditResponse = await chat_edit_v2.run(req, complete=complete)
    except V2EditError as exc:
        log.warning("v2_edit.failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "ok": False,
                "error": {"code": "AGENT_CHAT_FAILED", "message": str(exc)[:300]},
            },
        ) from exc
    except Exception as exc:  # noqa: BLE001 — must answer in contract shape
        log.exception("v2_edit.unhandled", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "ok": False,
                "error": {"code": "AGENT_INTERNAL_ERROR", "message": str(exc)[:300]},
            },
        ) from exc
    return {"ok": True, "data": response.model_dump(exclude_none=True, mode="json")}


def _ask_count_from_history(req: V2ChapterChatRequest) -> int:
    """Derive askCount (rounds already asked) from the chapter slice. The request
    contract carries no askCount field (Web keeps it in the tree but doesn't send
    it), so reconstruct it from prior assistant turns in this chapter's history —
    each chat round writes one assistant reply (tech-plan §1.3 / §5)."""
    return sum(1 for turn in req.history if turn.role == "assistant")


@router.post("/v2/album/chapter-chat", dependencies=[Depends(require_bearer)])
async def submit_chapter_chat(req: V2ChapterChatRequest) -> dict:
    settings = get_settings()
    ask_count = _ask_count_from_history(req)
    log.info(
        "v2_chapter_chat.accepted",
        album_id=req.albumId,
        chapter_id=req.chapter.chapterId,
        state=req.chapter.state,
        ask_count=ask_count,
        history_len=len(req.history),
        language=req.language,
    )
    complete = (
        _mock_chapter_chat_complete(req) if settings.agent_pipeline_mode == "mock" else None
    )
    try:
        response: V2ChapterChatResponse = await chapter_chat.run(
            req, ask_count=ask_count, complete=complete
        )
    except ChapterChatError as exc:
        log.warning("v2_chapter_chat.failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "ok": False,
                "error": {"code": "AGENT_PLANNING_FAILED", "message": str(exc)[:300]},
            },
        ) from exc
    except Exception as exc:  # noqa: BLE001 — must answer in contract shape
        log.exception("v2_chapter_chat.unhandled", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "ok": False,
                "error": {"code": "AGENT_INTERNAL_ERROR", "message": str(exc)[:300]},
            },
        ) from exc
    return {"ok": True, "data": response.model_dump(exclude_none=True, mode="json")}
