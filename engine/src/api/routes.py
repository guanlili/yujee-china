"""Agent HTTP route surface — minimal 识图 + 初步排版 scaffold.

只保留两步工作流的接入面:

- `GET  /health`            健康检查
- `POST /v3/analyze`        ① 识图分章(async 202 + callback,唯一带原图 base64 的端点)
- `POST /v3/select-layout`  ② 排版:确定性选版,直接回 pages
- `POST /v3/compose`        ④ 成稿:一次 Gemini 按章并发写满全书文案 + 封面/封尾 + 字体

编辑 / 主题 / finalize 等后续环节已从这个最小版剥离,后面再接。

Thin layer: 只做路由 + accepted/completed 信封 + 日志。async 编排在 `src/workflows/*`。
Stateless(§数据归属):Agent 不持 draft/stage;base64 只在 analyze/compose 请求内存里,永不落盘/日志。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from .auth import require_bearer
from ..logging_config import get_logger
from ..contracts.schemas import (
    ComposeRequest,
    SelectLayoutRequest,
    V3AcceptedData,
    V3AcceptedResponse,
    V3AnalyzeRequest,
)
from ..workflows import analyze, compose, select_layout
from ..settings import get_settings

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


# ---------- ① 识图分章 (async 202 + callback) ---------------------------------


@router.post("/v3/analyze", status_code=202, dependencies=[Depends(require_bearer)])
async def submit_analyze(
    req: V3AnalyzeRequest, background_tasks: BackgroundTasks
) -> dict[str, Any]:
    if not get_settings().agent_enable_analyze:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "ok": False,
                "error": {
                    "code": "AGENT_INTERNAL_ERROR",
                    "message": "analyze is disabled on this Agent instance",
                },
            },
        )

    # base64 is read into the background task only; never logged (§隐私).
    log.info("v3_analyze.accepted", photo_count=len(req.photos), language=req.language)
    background_tasks.add_task(analyze.run_with_timeout, req)
    return V3AcceptedResponse(
        ok=True,
        data=V3AcceptedData(requestId=req.requestId, accepted=True),
    ).model_dump(mode="json")


# ---------- ② 排版:确定性选版,直接回 pages ---------------------------------


@router.post("/v3/select-layout", status_code=202, dependencies=[Depends(require_bearer)])
async def submit_select_layout(
    req: SelectLayoutRequest, background_tasks: BackgroundTasks
) -> dict[str, Any]:
    log.info(
        "v3_select_layout.accepted",
        chapters=len(req.chapters),
        photos=sum(len(chapter.photos) for chapter in req.chapters),
        language=req.language,
    )
    background_tasks.add_task(select_layout.run_with_timeout, req)
    return V3AcceptedResponse(
        ok=True,
        data=V3AcceptedData(requestId=req.requestId, accepted=True),
    ).model_dump(mode="json")


# ---------- ④ 一次性成稿 (async 202 + callback) --------------------------------


@router.post("/v3/compose", status_code=202, dependencies=[Depends(require_bearer)])
async def submit_compose(
    req: ComposeRequest, background_tasks: BackgroundTasks
) -> dict[str, Any]:
    """④ 用户选完设计后的一次性成稿:按章并发让 Gemini 看图 + 读用户故事写满全书
    文案,并出封面/封尾文案与字体。async 202 + callback。

    照片 base64 只在请求内存里(§隐私):进模型上下文那一次 HTTP body,永不落盘/日志。"""
    # photos_total 是「照片有没有真的进模型」的第一道线索:Web 侧拿不到缩略图时
    # refs={} 也会照常提交,这一路只在日志里看得见(每章零图另有 warning)。
    log.info(
        "v3_compose.accepted",
        chapters=len(req.chapters),
        photos_total=sum(len(chapter.photos) for chapter in req.chapters),
        language=req.language,
    )
    background_tasks.add_task(compose.run_with_timeout, req)
    return V3AcceptedResponse(
        ok=True, data=V3AcceptedData(requestId=req.requestId, accepted=True)
    ).model_dump(mode="json")
