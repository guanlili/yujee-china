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
import math
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
    V2ClusterOverview,
    V2CoverDraft,
    V2DraftEditRequest,
    V2DraftEditResponse,
    V2EditRequest,
    V2EditResponse,
    V2FailedCallback,
    V2InspectRequest,
    V2InspectResponse,
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
    V2Theme,
    V2ThemePartial,
    V2ThemeRequest,
    V2ThemeResponse,
)
from ..services import (
    callback,
    chapter_chat,
    chat_edit_v2,
    draft_edit,
    finalize as finalize_service,
    grouping,
    inspect_render,
    skeleton,
    theme,
    vision_mock,
    writing,
)
from ..services.chapter_chat import ChapterChatError
from ..services.chat_edit_v2 import V2EditError
from ..services.draft_edit import DraftEditError
from ..services.finalize import FinalizeError
from ..services.grouping import GroupingPhoto
from ..services.inspect_render import InspectError
from ..services.theme import ThemeError
from ..services.vision import VisionError
from ..services.vision import analyze as vision_analyze
from ..services.writing import WritingError
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


# ---------- init writing stage (#161) -----------------------------------------
#
# After the deterministic skeleton, write the WHOLE first draft inside init: an
# auto-picked theme + cover copy, then every chapter's body copy. Cover + N
# chapters run concurrently under an asyncio.Semaphore (INIT_WRITE_CONCURRENCY,
# default 3); any unit failing fails the whole stage → init FAILED → hold
# released (init/failed refund path, tech-plan §1.1). No conversation, no theme
# confirmation step — chapters land at state='generated' (issue #161).


def _clusters_overview(draft: AlbumDraft) -> list[V2ClusterOverview]:
    """Summarize the draft chapters for the theme/cover writer (no base64; only
    cluster labels + a few representative photo descriptions)."""
    desc_by_id = {photo.photoId: photo.analysis.description for photo in draft.photoPool}
    overview: list[V2ClusterOverview] = []
    for chapter in draft.chapters:
        descs = [
            desc_by_id[pid]
            for pid in chapter.photoIds
            if pid in desc_by_id and desc_by_id[pid]
        ][:8]
        overview.append(
            V2ClusterOverview(
                chapterId=chapter.chapterId,
                label=chapter.cluster.label,
                place=chapter.cluster.place,
                timeRange=chapter.cluster.timeRange,
                photoDescs=descs,
            )
        )
    return overview


def _mock_writing_complete() -> Any:
    """Deterministic injected `complete` for first-pass writing in mock mode:
    returns NO pagesTexts, so the writing service falls back to its grounded
    skeleton copy for every slot (mirrors the chapter-chat mock)."""

    async def complete(**_kwargs: Any) -> dict[str, Any]:
        return {
            "choices": [{"message": {"content": json.dumps({"pagesTexts": []})}}],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0},
        }

    return complete


def _merge_cover(cover_page: Page, cover: V2CoverDraft | None) -> Page:
    """Fold the written cover copy into the skeleton cover page (texts + the
    auto-picked cover templateId/hero if the writer chose one)."""
    if cover is None:
        return cover_page
    update: dict[str, Any] = {"texts": dict(cover.texts)}
    if cover.templateId:
        update["templateId"] = cover.templateId
    if cover.heroPhotoId:
        # Keep the existing image slot key; only swap the hero photoId in.
        slot = next(iter(cover_page.images), "image")
        update["images"] = {**cover_page.images, slot: cover.heroPhotoId}
    return cover_page.model_copy(update=update)


def _merge_chapter_texts(chapter: V2Chapter, pages_texts) -> V2Chapter:
    """Merge a chapter's written pagesTexts into its pages and flip it to
    state='generated' (the editor opens on a complete draft, issue #161)."""
    texts_by_index = {pt.pageIndex: pt.texts for pt in pages_texts}
    new_pages = [
        page.model_copy(update={"texts": texts_by_index[page.pageIndex]})
        if page.pageIndex in texts_by_index
        else page
        for page in chapter.pages
    ]
    return chapter.model_copy(update={"pages": new_pages, "state": "generated"})


async def _write_first_draft(draft: AlbumDraft, mock: bool) -> tuple[AlbumDraft, Usage]:
    """Concurrently write the cover + every chapter, merge results back into the
    draft, and return the written draft + aggregated planning usage. Raises
    WritingError (or any unit's exception) so the caller fails the stage."""
    settings = get_settings()
    semaphore = asyncio.Semaphore(settings.init_write_concurrency)
    language = draft.meta.language
    cover_complete = _mock_writing_complete() if mock else None
    chapter_complete = _mock_writing_complete() if mock else None
    # The theme/cover writer reuses the theme service mock shape, not writing's.
    theme_overview = _clusters_overview(draft)
    # Album-wide allowed nouns so the cover scrub (#161 MUST-FIX) matches the
    # chapter scrub: a name on the cover is legitimate if it appears anywhere in
    # the album's known material (every cluster + every photo), not just one chapter.
    cover_allowed_nouns = writing.album_allowed_proper_nouns(draft.chapters, draft.photoPool)

    async def run_cover() -> tuple[V2Theme, V2CoverDraft | None, Usage]:
        async with semaphore:
            theme_mock = (
                _mock_theme_complete(
                    V2ThemeRequest(
                        albumId="init",
                        language=language,
                        clustersOverview=theme_overview,
                        currentTheme=None,
                        userMessage=draft.meta.promptHint,
                    )
                )
                if mock
                else None
            )
            return await writing.generate_cover_texts(
                clusters_overview=theme_overview,
                language=language,
                prompt_hint=draft.meta.promptHint,
                complete=theme_mock,
                allowed_nouns=cover_allowed_nouns,
            )

    async def run_chapter(chapter: V2Chapter):
        async with semaphore:
            return await writing.generate_chapter_texts(
                chapter,
                draft.photoPool,
                # theme not known until run_cover resolves; pass the promptHint-
                # seeded partial so chapters still get global tone. The cover's
                # final theme is merged into meta below regardless.
                _theme_hint(draft),
                language,
                complete=chapter_complete,
            )

    cover_task = asyncio.create_task(run_cover())
    chapter_tasks = [asyncio.create_task(run_chapter(ch)) for ch in draft.chapters]
    all_tasks = [cover_task, *chapter_tasks]
    try:
        # return_exceptions=False: the first unit's exception propagates here
        # (whole stage fails on any cover/chapter failure, issue #161 req 4).
        await asyncio.gather(*all_tasks)
    except BaseException:
        for task in all_tasks:
            task.cancel()
        # Drain the cancellations so no task is left pending/garbage-collected.
        await asyncio.gather(*all_tasks, return_exceptions=True)
        raise
    theme_obj, cover, cover_usage = cover_task.result()
    chapter_results = [task.result() for task in chapter_tasks]

    cover_page = _merge_cover(draft.basePages.cover, cover)
    new_chapters = [
        _merge_chapter_texts(chapter, pages_texts)
        for chapter, (pages_texts, _usage) in zip(draft.chapters, chapter_results)
    ]

    total_in = cover_usage.planningInputTokens + sum(
        u.planningInputTokens for _pt, u in chapter_results
    )
    total_out = cover_usage.planningOutputTokens + sum(
        u.planningOutputTokens for _pt, u in chapter_results
    )
    writing_usage = Usage(
        durationMs=0,
        planningInputTokens=total_in,
        planningOutputTokens=total_out,
        models=V2Models(planning=cover_usage.models.planning),
    )

    written = draft.model_copy(
        update={
            "meta": draft.meta.model_copy(
                update={
                    "theme": V2ThemePartial(**theme_obj.model_dump()),
                    "style": theme_obj.style,
                }
            ),
            "basePages": draft.basePages.model_copy(update={"cover": cover_page}),
            "chapters": new_chapters,
        }
    )
    return written, writing_usage


def _theme_hint(draft: AlbumDraft) -> V2Theme | None:
    """A best-effort global theme to bias chapter copy before the cover writer
    resolves: only the promptHint is known at this point, so return None and let
    each chapter ground itself in its own photos (the cover sets the real theme
    in meta). Kept as a seam for a future two-phase (theme-then-chapters) order."""
    return None


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

    # Stage 4 — first-pass writing (#161): auto-theme + cover + all chapter copy,
    # written concurrently. Any cover/chapter failure fails the whole init.
    await _emit_progress(req, "writing", 0)
    planning_model: str | None = None
    try:
        draft, writing_usage = await _write_first_draft(
            draft, mock=settings.agent_pipeline_mode == "mock"
        )
        planning_model = writing_usage.models.planning
    except WritingError as exc:
        log.warning("v2_init.writing_failed", error=str(exc))
        await _emit_failure(
            req, code="AGENT_PLANNING_FAILED", message=str(exc), stage="writing"
        )
        return
    except Exception as exc:  # noqa: BLE001
        log.exception("v2_init.writing_unhandled", error=str(exc))
        await _emit_failure(
            req, code="AGENT_PLANNING_FAILED", message=str(exc), stage="writing"
        )
        return
    await _emit_progress(req, "writing", 100)

    duration_ms = int((time.monotonic() - started) * 1000)
    envelope = V2InitCompletedCallback(
        event="completed",
        jobKind="init",
        requestId=req.requestId,
        draftTree=draft,
        usage=Usage(
            durationMs=duration_ms,
            visionCallCount=vision_call_count,
            planningInputTokens=writing_usage.planningInputTokens,
            planningOutputTokens=writing_usage.planningOutputTokens,
            models=V2Models(vision=vision_model, planning=planning_model),
        ),
    )
    await callback.post(str(req.callbackUrl), envelope)
    log.info(
        "v2_init.completed",
        duration_ms=duration_ms,
        chapters=len(draft.chapters),
        photos=len(draft.photoPool),
    )


def _init_timeout_seconds(req: V2InitRequest, settings: Any) -> int:
    """Scale the init background-task budget with the work it has to do (#161
    SHOULD-FIX). The fixed 600s floor can be tripped by a large album: writing
    fires 1 cover + N chapter DeepSeek calls, ≤ INIT_WRITE_CONCURRENCY in flight,
    each ≤ 2× its per-call timeout on the retry ceiling (the author's worst-case
    ~720s for a ~10-chapter album). Budget:

        vision_ceiling + ⌈(N_chapters + 1) / INIT_WRITE_CONCURRENCY⌉ × per_call_ceiling

    where vision_ceiling = 2× ark_timeout (one retry) and per_call_ceiling = 2×
    deepseek_timeout. N_chapters isn't known until grouping runs inside _run_init,
    so we upper-bound it by the photo count (every chapter holds ≥1 photo → chapters
    ≤ photos), which only over-budgets — never under. The current fixed value stays
    as a FLOOR so small albums and other knobs never regress below today's behavior.
    Scoped to init only; add/finalize keep the flat background_task_timeout_seconds."""
    n_chapters_upper = max(1, len(req.photos))
    vision_ceiling = 2 * settings.ark_timeout_seconds
    per_call_ceiling = 2 * settings.deepseek_timeout_seconds
    waves = math.ceil((n_chapters_upper + 1) / settings.init_write_concurrency)
    scaled = vision_ceiling + waves * per_call_ceiling
    return max(settings.background_task_timeout_seconds, scaled)


async def _run_init_with_timeout(req: V2InitRequest) -> None:
    settings = get_settings()
    token = request_id_var.set(req.requestId)
    try:
        try:
            await asyncio.wait_for(
                _run_init(req), timeout=_init_timeout_seconds(req, settings)
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


# ============================================================================
# draft-edit (#162) — synchronous endpoint wiring services/draft_edit.py. The
# draft-period "展示第一版 + 定点单页调整" turn: talk/act separated by a tool
# layer (services/tools.py). NEW endpoint; the finalize-era /v2/album/edit is
# untouched (it needs a flat layout_json; draft period has layout_json==null).
# Stateless: only a single skeleton page slice + that page's photos cross the
# wire (no base64, no whole tree — invariant 12). Model/parse failure →
# AGENT_CHAT_FAILED/502 (mirrors submit_edit).
# ============================================================================


def _mock_draft_edit_complete(req: V2DraftEditRequest) -> Any:
    """Deterministic injected `complete` for the draft-edit round-trip without a
    dialog-model key. A bare "改/change/rewrite/写" in the message → emit a
    write_page_copy tool_call (re-write the page's first authored slot back to
    itself, so the act path is exercised and the clamp is a no-op); otherwise →
    plain text (talk). The service still runs all tool dispatch / G3 demotion /
    clamp on top, mirroring the other W6 mocks."""

    msg = (req.userMessage or "").lower()
    wants_act = any(k in msg for k in ("change", "rewrite", "改", "写", "标题", "edit"))

    async def complete(**_kwargs: Any) -> dict[str, Any]:
        if wants_act and req.page.texts:
            slot, value = next(iter(req.page.texts.items()))
            tool_call = {
                "id": "call_mock",
                "type": "function",
                "function": {
                    "name": "write_page_copy",
                    "arguments": json.dumps(
                        {"pageIndex": req.page.pageIndex, "slots": {slot: value}},
                        ensure_ascii=False,
                    ),
                },
            }
            return {
                "choices": [
                    {"message": {"content": None, "tool_calls": [tool_call]}}
                ],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0},
            }
        return {
            "choices": [
                {
                    "message": {
                        "content": (
                            f'(mock) Noted — "{req.userMessage[:120]}". '
                            "Real editing runs once the model is connected."
                        )
                    }
                }
            ],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0},
        }

    return complete


@router.post("/v2/album/draft-edit", dependencies=[Depends(require_bearer)])
async def submit_draft_edit(req: V2DraftEditRequest) -> dict:
    settings = get_settings()
    log.info(
        "v2_draft_edit.accepted",
        album_id=req.albumId,
        page_index=req.page.pageIndex,
        focused=req.focusedPageIndex,
        history_len=len(req.history),
        language=req.language,
    )
    complete = (
        _mock_draft_edit_complete(req) if settings.agent_pipeline_mode == "mock" else None
    )
    try:
        response: V2DraftEditResponse = await draft_edit.run(req, complete=complete)
    except DraftEditError as exc:
        log.warning("v2_draft_edit.failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "ok": False,
                "error": {"code": "AGENT_CHAT_FAILED", "message": str(exc)[:300]},
            },
        ) from exc
    except Exception as exc:  # noqa: BLE001 — must answer in contract shape
        log.exception("v2_draft_edit.unhandled", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "ok": False,
                "error": {"code": "AGENT_INTERNAL_ERROR", "message": str(exc)[:300]},
            },
        ) from exc
    return {"ok": True, "data": response.model_dump(exclude_none=True, mode="json")}


# ============================================================================
# inspect-page (#165 Phase 2) — synchronous endpoint wiring services/
# inspect_render.py. After draft-edit returns kind="inspect", the browser
# renders + screenshots the page and posts it here; the agent runs ONE vision
# call (火山 doubao-1.6-vision, same model/key as init) to diagnose a reported
# crop and suggest a move/zoom. Stateless: only a single page slice + that page's
# photo analyses + the rendered screenshot cross the wire — the screenshot is the
# ONLY new base64 channel and is dropped after the upstream call, never persisted
# (invariant 1, same privacy posture as init vision). Vision/parse failure
# DEGRADES gracefully inside the service (problem="unable to inspect"); only a
# hard InspectError maps to AGENT_VISION_FAILED/502 (mirrors submit_edit).
# ============================================================================


def _mock_inspect_complete(req: V2InspectRequest) -> Any:
    """Deterministic injected `complete` for the inspect round-trip without a
    vision key: name the page's first image slot and suggest a small move-down
    (the common 'face cut at top' fix). The service still clamps + validates the
    slot against the page's real slots on top (mirrors the other W6 mocks)."""
    slot = next(iter(req.page.images), None)

    async def complete(**_kwargs: Any) -> dict[str, Any]:
        payload = {
            "imageId": slot,
            "problem": "a subject looks cut off near the top",
            "suggestedDx": 0,
            "suggestedDy": -12,
            "suggestedScale": 1.0,
            "confidence": 0.6,
        }
        return {
            "choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0},
        }

    return complete


@router.post("/v2/album/inspect-page", dependencies=[Depends(require_bearer)])
async def submit_inspect_page(req: V2InspectRequest) -> dict:
    settings = get_settings()
    log.info(
        "v2_inspect.accepted",
        album_id=req.albumId,
        page_index=req.page.pageIndex,
        slots=len(req.page.images),
        language=req.language,
    )
    complete = (
        _mock_inspect_complete(req) if settings.agent_pipeline_mode == "mock" else None
    )
    try:
        response: V2InspectResponse = await inspect_render.diagnose(req, complete=complete)
    except InspectError as exc:
        log.warning("v2_inspect.failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "ok": False,
                "error": {"code": "AGENT_VISION_FAILED", "message": str(exc)[:300]},
            },
        ) from exc
    except Exception as exc:  # noqa: BLE001 — must answer in contract shape
        log.exception("v2_inspect.unhandled", error=str(exc))
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
