"""Agent HTTP route surface — minimal 识图 + 初步排版 scaffold.

只保留两步工作流的接入面:

- `GET  /health`            健康检查
- `POST /v3/analyze`        ① 识图分章(async 202 + callback,唯一带原图 base64 的端点)
- `POST /v3/select-layout`  ② 排版 phase 1:生成候选结构,candidates 回调交回浏览器渲染
- `POST /v3/judge-layout`   ② 排版 phase 2:浏览器缩略图 → Gemini 评委选赢家 → pages(纯版面,texts 留空)

编辑 / 主题 / 封面 / finalize 等后续环节已从这个最小版剥离,后面再接。

Thin layer: 只做路由 + accepted/completed 信封 + 日志。async 编排在 `src/flows/*`。
Stateless(§数据归属):Agent 不持 draft/stage;base64 只在 analyze 请求内存里,永不落盘/日志。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from .auth import require_bearer
from .logging_config import get_logger
from .schemas import (
    JudgeLayoutRequest,
    SelectLayoutRequest,
    V3AcceptedData,
    V3AcceptedResponse,
    V3AnalyzeRequest,
)
from .flows import analyze, judge_layout, select_layout
from .settings import get_settings

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


# ---------- ② 排版 phase 1:候选生成 ------------------------------------------


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


# ---------- ② 排版 phase 2:评委选赢家 → pages -------------------------------


@router.post("/v3/judge-layout", status_code=202, dependencies=[Depends(require_bearer)])
async def submit_judge_layout(
    req: JudgeLayoutRequest, background_tasks: BackgroundTasks
) -> dict[str, Any]:
    """接收浏览器渲染的候选缩略图,Gemini 评委选赢家,回 completed(纯版面,texts 留空)。"""
    log.info(
        "v3_judge_layout.accepted",
        units=len(req.units),
        candidates=sum(len(u.candidates) for u in req.units),
        language=req.language,
    )
    background_tasks.add_task(judge_layout.run_with_timeout, req)
    return V3AcceptedResponse(
        ok=True,
        data=V3AcceptedData(requestId=req.requestId, accepted=True),
    ).model_dump(mode="json")
