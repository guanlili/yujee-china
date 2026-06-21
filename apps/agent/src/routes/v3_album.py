"""V3 album endpoints — 五环节状态机的 `/v3/*` 路由(architecture §6.8).

WP1.1 owns ONLY the `/v3/analyze` async接入骨架: accept the base64 photos, return
202 immediately, run the analysis pipeline in a background task, and stream
`progress` → `completed`/`failed` callbacks back to the Web side
(`V3Callback`, schemas.py / packages/contracts/src/v3.ts — single truth source).

The analysis pipeline BODY is WP1.3 (describe-content vision → 章节树) / WP1.4
(select-template) / WP1.5 (通用文案/色 + 预览 + settle). This WP wires the async
job + callback transport faithfully and stands a **clearly-marked seam** in place
of the real vision/templating work:

  * The `describe` stage now runs the REAL describe-content recognition-model call
    (WP1.3, issue #182): one batched call → 章节树 (分章 + 每章 description + 每图
    sceneDescription). The LLM authors只这 3 处; width/height/orientation/takenAt
    are code-filled. OpenAI (GPT-5.5 Mini) primary, 火山 doubao failover.
  * The `template` stage now runs WP1.4 select-template (#183): the recognition
    model picks each page's templateId from the legal candidates, pure-code §9
    fallback on LLM failure. The `preview` stage still takes the seam (WP1.5 generic
    文案色 owns the real work there).
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

from fastapi import APIRouter, BackgroundTasks, Depends, status

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
    V3ChapterChatRequest,
    V3ChapterChatResponse,
    V3FailedEvent,
    V3JobStage,
    V3LayoutTree,
    V3Models,
    V3ProgressEvent,
    V3Usage,
)
from ..schemas import (
    V3ApplyThemeRequest,
    V3ApplyThemeResponse,
    V3CoverRequest,
    V3CoverResponse,
    V3FinalizeRequest,
    V3FinalizeResponse,
    V3RecommendRequest,
    V3RecommendResponse,
)
from ..engine import apply_theme_v3
from .. import callback
from ..errors import sync_endpoint_errors
from ..services import chapter_chat_v3
from ..engine import cover_v3
from ..engine import finalize_v3
from ..engine import generic_copy
from ..services import recommend_v3
from ..services import select_template
from ..services import vision
from ..engine.apply_theme_v3 import ApplyThemeV3Error
from ..services.chapter_chat_v3 import ChapterChatV3Error
from ..engine.cover_v3 import CoverV3Error
from ..engine.finalize_v3 import FinalizeV3Error
from ..services.recommend_v3 import RecommendV3Error
from ..services.vision import VisionError
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
    page_dicts = await select_template.select_template_pages(chapters)
    page_dicts = generic_copy.fill_generic_copy(page_dicts, chapters)
    pages = [Page(**page) for page in page_dicts]
    return tree, pages


# ---------- analyze job -------------------------------------------------------


async def _run_analyze(req: V3AnalyzeRequest) -> None:
    started = time.monotonic()
    vision_call_count = 0
    vision_model: str | None = None

    # describe — WP1.3 (#182): real describe-content call → 章节树. The recognition
    # model authors只分章 + 每章 description + 每图 sceneDescription; the
    # deterministic photo attrs (width/height/orientation/takenAt) are code-filled
    # inside describe_content. OpenAI primary, 火山 failover (§6.8 第 2 条).
    await _emit_progress(req, "describe", 0)
    prompt_hint = req.meta.promptHint if req.meta else None
    try:
        described = await vision.describe_content(
            req.photos, language=req.language, prompt_hint=prompt_hint
        )
    except VisionError as exc:
        log.warning("v3_analyze.describe_failed", error=str(exc))
        await _emit_failure(req, code="AGENT_VISION_FAILED", message=str(exc), stage="describe")
        return
    except Exception as exc:  # noqa: BLE001
        log.exception("v3_analyze.describe_unhandled", error=str(exc))
        await _emit_failure(req, code="AGENT_VISION_FAILED", message=str(exc), stage="describe")
        return
    chapters = described.tree.chapters
    vision_call_count = described.call_count
    vision_model = described.model
    await _emit_progress(req, "describe", 100)

    # group — 分章 happens INSIDE describe-content (§4.1: grouping并进识图模型这一次
    # 调用). This stage stays as a progress beat for UI parity; no separate call.
    await _emit_progress(req, "group", 0)
    await _emit_progress(req, "group", 100)

    # template — WP1.4 (#183): select-template. The recognition model picks each
    # page's templateId from the legal candidates skeleton_v3 exposes; on any LLM
    # failure the stage degrades to the pure-code §9 fallback inside _build_preview.
    # _build_preview also runs WP1.5 generic-copy fill; both stay inside this guard so
    # any failure resets the bar and fails cleanly (失败可重试不污染 stage).
    await _emit_progress(req, "template", 0)
    try:
        tree, pages = await _build_preview(chapters)
    except Exception as exc:  # noqa: BLE001
        log.exception("v3_analyze.template_failed", error=str(exc))
        await _emit_failure(
            req, code="AGENT_OUTPUT_VALIDATION", message=str(exc), stage="template"
        )
        return
    await _emit_progress(req, "template", 100)

    # preview — WP1.5 (#184): generic 文案/色 are now baked into the pages inside
    # _build_preview (generic_copy.fill_generic_copy). This beat marks the
    # preview-state tree ready; the completed callback below ships it to Web.
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


# ---------- chapter-chat (② 章节故事, sync) -----------------------------------


@router.post("/v3/chapter-chat", dependencies=[Depends(require_bearer)])
async def submit_chapter_chat(req: V3ChapterChatRequest) -> dict[str, Any]:
    """② 章节故事 turn endpoint (§8 同步 / WP2.1 #185).

    Synchronous (front-end spinner; 60s budget). Stateless (§8.3): the Agent
    dispatches THIS turn (引导/写/改) by the user's intent and returns a reply +
    the turn's patch — it holds no chapter/stage. Web owns stage 推进 + 各章 done
    (§4.2(1), WP2.4) and merges the patch into draft_json. Failures answer in the
    contract error shape (§8.3 同步端点走 HTTP 错误码; front end may retry without
    polluting stage)."""
    log.info(
        "v3_chapter_chat.accepted",
        album_id=req.albumId,
        chapter_id=req.chapter.chapterId,
        pages=len(req.pages),
        history_len=len(req.history),
        focused=req.focusedPageIndex,
        language=req.language,
    )
    with sync_endpoint_errors(
        log,
        "v3_chapter_chat",
        ChapterChatV3Error,
        known_status=status.HTTP_502_BAD_GATEWAY,
        known_code="AGENT_PLANNING_FAILED",
    ):
        response: V3ChapterChatResponse = await chapter_chat_v3.run(req)
    log.info("v3_chapter_chat.completed", kind=response.kind, album_id=req.albumId)
    return {"ok": True, "data": response.model_dump(exclude_none=True, mode="json")}


# ---------- recommend (③ 主题/章节色-推荐, sync) ------------------------------


@router.post("/v3/recommend", dependencies=[Depends(require_bearer)])
async def submit_recommend(req: V3RecommendRequest) -> dict[str, Any]:
    """③ 主题/章节色-推荐 endpoint (§8 同步 / WP3.1 #189).

    Synchronous (front-end spinner; §8.1 其余秒级同步). The recognition model runs
    the recommend Skills (recommend-theme + recommend-chapter-colors) and returns one
    {subject, accentColor, artFont} per chapter (subject = the chapter title, #236).
    Stateless (§8.3): the
    Agent only suggests — it never writes the tree (apply-theme/WP3.2 does, after the
    user picks) and never advances stage (stage 推进权在 Web). Input is TEXT ONLY
    (chapter overviews + analysis summary); no base64 here. Failures answer in the
    contract error shape (§8.3 同步端点走 HTTP 错误码; front end may retry without
    polluting stage)."""
    log.info(
        "v3_recommend.accepted",
        album_id=req.albumId,
        chapters=len(req.chapters),
        language=req.language,
    )
    with sync_endpoint_errors(
        log,
        "v3_recommend",
        RecommendV3Error,
        known_status=status.HTTP_502_BAD_GATEWAY,
        known_code="AGENT_PLANNING_FAILED",
    ):
        response: V3RecommendResponse = await recommend_v3.run(req)
    log.info(
        "v3_recommend.completed",
        album_id=req.albumId,
        chapter_colors=len(response.chapterColors),
    )
    return {"ok": True, "data": response.model_dump(exclude_none=True, mode="json")}


# ---------- apply-theme (③ 主题/章节色-应用, sync, deterministic) -------------


@router.post("/v3/apply-theme", dependencies=[Depends(require_bearer)])
async def submit_apply_theme(req: V3ApplyThemeRequest) -> dict[str, Any]:
    """③ 主题/章节色-应用 endpoint (§8 同步 / 确定性 / WP3.2 #190).

    Synchronous, NO model call (§8.1: 无 / 脚本). After the user picks per-chapter
    `{accentColor, artFont}` (from /v3/recommend), this 一键批量刷 every
    `variableDecor:true` slot (文字点缀 + 装饰 + SVG 图层) with that chapter's theme,
    leaving 普通正文槽 untouched (§4.3 / §9). Stateless (§8.3): the Agent returns a
    page-level `layoutPatch` (§3 树边界: 仍是页级, no tree-shaped render field); Web
    writes the chapter color/font into the tree + merges the patch + advances stage
    (stage 推进权在 Web). Input carries no base64 (pure structural transform).
    Failures answer in the contract error shape (§8.3 同步端点走 HTTP 错误码; front
    end may retry without polluting stage)."""
    log.info(
        "v3_apply_theme.accepted",
        album_id=req.albumId,
        chapters=len(req.chapters),
        pages=len(req.pages),
        language=req.language,
    )
    with sync_endpoint_errors(
        log,
        "v3_apply_theme",
        ApplyThemeV3Error,
        known_status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        known_code="AGENT_OUTPUT_VALIDATION",
    ):
        response: V3ApplyThemeResponse = apply_theme_v3.apply_theme(req)
    log.info(
        "v3_apply_theme.completed",
        album_id=req.albumId,
        patched=len(response.layoutPatch),
    )
    return {"ok": True, "data": response.model_dump(exclude_none=True, mode="json")}


# ---------- cover (④ 书籍设计 — 封面/封尾, sync, deterministic, optional) ------


@router.post("/v3/cover", dependencies=[Depends(require_bearer)])
async def submit_cover(req: V3CoverRequest) -> dict[str, Any]:
    """④ 书籍设计 — 封面/封尾 endpoint (§8 同步 / 确定性 / 可选 / WP4.1 #192).

    Synchronous, NO model call (§8.1: 确定性). After the user (optionally) picks a 封面
    template (category=cover) and/or a 封尾 template (category=ending), this
    deterministically AUTO-FILLS the relevant pages into finished spreads (§4.4(b)):
    the页's photos slot into the template in declaration order (no quality/hero match),
    generic decoration is code-filled, user-prose stays empty (§4.1 不生成正式文案; §3
    隐私: no place). Cover is OPTIONAL — when BOTH ids are absent it returns an EMPTY
    patch and does NOT error (§4.4 「跳过=空」; page0 is no longer forced to be cover,
    a rule WP0.4 already removed from the V3 engine). Stateless (§8.3): the Agent
    returns a page-level `layoutPatch` (§3 树边界: 仍是页级); Web merges the patch +
    advances stage cover→ready (stage 推进权在 Web). Input carries no base64 (pure
    structural transform). An invalid template (unknown id / wrong category) answers in
    the contract error shape (§8.3 同步端点走 HTTP 错误码; retry without polluting stage)."""
    log.info(
        "v3_cover.accepted",
        album_id=req.albumId,
        pages=len(req.pages),
        cover=bool(req.coverTemplateId),
        ending=bool(req.endingTemplateId),
        language=req.language,
    )
    with sync_endpoint_errors(
        log,
        "v3_cover",
        CoverV3Error,
        known_status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        known_code="AGENT_OUTPUT_VALIDATION",
    ):
        response: V3CoverResponse = cover_v3.build_cover(req)
    log.info(
        "v3_cover.completed",
        album_id=req.albumId,
        patched=len(response.layoutPatch),
    )
    return {"ok": True, "data": response.model_dump(exclude_none=True, mode="json")}


# ---------- finalize (⑤ 待导出 — flatten + 单一 validate, sync, deterministic) -


@router.post("/v3/finalize", dependencies=[Depends(require_bearer)])
async def submit_finalize(req: V3FinalizeRequest) -> dict[str, Any]:
    """⑤ 待导出 — finalize endpoint (§8 同步 / 确定性 / WP5.1 #194).

    Synchronous, NO model call (§8.1 同步确定性; §8.3 全树只在 finalize 传一次). Takes the
    WHOLE layout tree + the preview pages and flattens them into the external render
    contract `AlbumLayoutPlan` (`magazine + photos + pages[]`) the Browser turns into a
    PDF. The flatten:

      * lands the §3 树边界: the per-chapter `accentColor`/`artFont` lived ONLY in the
        tree until now and is BAKED into `pages[].texts` here (incl. the WP3.2 svg seam)
        so the flat contract carries NO tree-shaped field;
      * runs the SINGLE `validate_v3` (§6.8 第 7 条 校验单一真相源) — one validate认
        svgs/items/variableDecor/章节色/字体, replacing the v2 双 validate_v2 (which is
        left untouched, Option B).

    Stateless (§3 数据归属): the Agent holds no draft/stage; Web owns the tree + stage
    (finalize does not advance stage). Input carries no base64 (the tree已是无图层节点).
    An unflattenable layout (validate violation) answers in the contract error shape
    (§8.3 同步端点走 HTTP 错误码; retry without polluting stage)."""
    started = time.monotonic()
    log.info(
        "v3_finalize.accepted",
        album_id=req.albumId,
        chapters=len(req.tree.chapters),
        pages=len(req.pages),
        language=req.language,
    )
    with sync_endpoint_errors(
        log,
        "v3_finalize",
        FinalizeV3Error,
        known_status=status.HTTP_422_UNPROCESSABLE_ENTITY,
        known_code="AGENT_OUTPUT_VALIDATION",
    ):
        layout = finalize_v3.finalize_v3(req)
    duration_ms = int((time.monotonic() - started) * 1000)
    response = V3FinalizeResponse(
        layout=layout,
        usage=V3Usage(durationMs=duration_ms, models=V3Models()),
    )
    log.info(
        "v3_finalize.completed",
        album_id=req.albumId,
        pages=len(layout.pages),
        photos=len(layout.photos),
    )
    return {"ok": True, "data": response.model_dump(exclude_none=True, mode="json")}
