"""Agent HTTP route surface — health + the V3 五环节状态机 `/v3/*` endpoints
(architecture §6.8).

Thin layer: this module owns ONLY routing + accepted/completed envelopes + log
beats. The async `/v3/analyze` orchestration lives in `src/flows/analyze.py`
(`analyze.run_with_timeout`); the sync endpoints delegate straight to their engine /
agent handlers via `sync_endpoint_errors`.

`/v3/analyze` is the only async接入: accept the base64 photos, return 202
immediately, run the analysis pipeline in a background task, and stream
`progress` → `completed`/`failed` callbacks back to the Web side
(`V3Callback`, schemas.py / packages/contracts/src/v3.ts — single truth source).

Stateless (§3 数据归属): Agent holds no draft/stage; Web owns the tree + stage and
merges the callback. base64 never leaves the request memory — it is read to build
the photo list and never logged or returned (§3 隐私).
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, status

from .auth import require_bearer
from .logging_config import get_logger
from .schemas import (
    V3AcceptedData,
    V3AcceptedResponse,
    V3AnalyzeRequest,
    V3ChapterChatRequest,
    V3ChapterChatResponse,
)
from .schemas import (
    V3ApplyThemeRequest,
    V3ApplyThemeResponse,
    V3CoverRequest,
    V3CoverResponse,
    V3FinalizeRequest,
    V3FinalizeResponse,
    V3Models,
    V3RecommendRequest,
    V3RecommendResponse,
    V3Usage,
)
from .engine import apply_theme_v3
from .errors import sync_endpoint_errors
from .agents.writing import handler as chapter_chat_v3
from .engine import cover_v3
from .engine import finalize_v3
from .agents.theme_recommend import handler as recommend_v3
from .engine.apply_theme_v3 import ApplyThemeV3Error
from .agents.writing import ChapterChatV3Error
from .engine.cover_v3 import CoverV3Error
from .engine.finalize_v3 import FinalizeV3Error
from .agents.theme_recommend import RecommendV3Error
from .flows import analyze

router = APIRouter()
log = get_logger("v3_album")


# ---------- health ------------------------------------------------------------


@router.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


# ---------- analyze (① 分析, async 202 + callback) ----------------------------


@router.post("/v3/analyze", status_code=202, dependencies=[Depends(require_bearer)])
async def submit_analyze(
    req: V3AnalyzeRequest, background_tasks: BackgroundTasks
) -> dict[str, Any]:
    # base64 is read into the background task only; never logged (§3 隐私).
    log.info("v3_analyze.accepted", photo_count=len(req.photos), language=req.language)
    background_tasks.add_task(analyze.run_with_timeout, req)
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


# ---------- cover (④ 书籍设计 — 封面/封尾, sync route + async orchestration) ---


@router.post("/v3/cover", dependencies=[Depends(require_bearer)])
async def submit_cover(req: V3CoverRequest) -> dict[str, Any]:
    """④ 书籍设计 — 封面/封尾 endpoint.

    The route is synchronous from Web's point of view, but the cover engine is async:
    Stage5 may run copy clarification, local thumbnail color extraction, safe color
    design, then deterministic landing patches. The Agent remains stateless; Web owns
    persistence and stage advancement. Base64 thumbnails are never logged or sent to
    prompt seams; they are only used by local color extraction."""
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
        response: V3CoverResponse = await cover_v3.build_cover(req)
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
