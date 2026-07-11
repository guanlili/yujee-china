"""Agent HTTP route surface — minimal 识图 + 初步排版 scaffold.

只保留两步工作流的接入面:

- `GET  /health`            健康检查
- `POST /v3/analyze`        ① 识图分章(async 202 + callback,唯一带原图 base64 的端点)
- `POST /v3/select-layout`  ② 排版 phase 1:生成候选结构,candidates 回调交回浏览器渲染
- `POST /v3/judge-layout`   ② 排版 phase 2:浏览器缩略图 → Gemini 评委选赢家 → pages(纯版面,texts 留空)

编辑 / 主题 / 封面 / finalize 等后续环节已从这个最小版剥离,后面再接。

Thin layer: 只做路由 + accepted/completed 信封 + 日志。async 编排在 `src/workflows/*`。
Stateless(§数据归属):Agent 不持 draft/stage;base64 只在 analyze 请求内存里,永不落盘/日志。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from .auth import require_bearer
from ..logging_config import get_logger
from ..contracts.schemas import (
    DesignColors,
    DesignData,
    DesignFonts,
    DesignRequest,
    DesignResponse,
    JudgeLayoutRequest,
    JudgePageTemplateData,
    JudgePageTemplateRequest,
    JudgePageTemplateResponse,
    SelectLayoutRequest,
    V3AcceptedData,
    V3AcceptedResponse,
    V3AnalyzeRequest,
)
from ..workflows import analyze, judge_layout, select_layout
from ..workflows.core import design as design_agent
from ..workflows.core.layout import select_layout as select_layout_agent
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


# ---------- 单页 relayout 视觉判图 (sync,编辑器换版式用) ----------------------


@router.post("/v3/judge-page-template", dependencies=[Depends(require_bearer)])
async def submit_judge_page_template(req: JudgePageTemplateRequest) -> dict[str, Any]:
    """编辑器换版式:浏览器把该页照片按每个候选模板渲染成真图缩略图 POST 过来,
    视觉评委(gemini 优先,保底豆包)看图选最贴合的模板 id。**同步**返回赢家,不走 callback。"""
    # req.chapterContext 契约字段保留但不再进评委上下文 —— layout 环节纯视觉判断,
    # chapter 概念只属于分簇/写文案(2026-07-11 用户拍板)。
    winner_id, result = await select_layout_agent.judge_page_template(
        [candidate.model_dump(mode="json") for candidate in req.candidates],
    )
    log.info(
        "v3_judge_page_template.done",
        candidates=len(req.candidates),
        winner=winner_id,
        model=result.model,
    )
    return JudgePageTemplateResponse(
        ok=True,
        data=JudgePageTemplateData(winnerTemplateId=winner_id),
    ).model_dump(mode="json")


# ---------- 设计环节 (sync,用户选定封面组后) -----------------------------------


@router.post("/v3/design", dependencies=[Depends(require_bearer)])
async def submit_design(req: DesignRequest) -> dict[str, Any]:
    """用户选定封面组后的设计决策:①全书字体+颜色(ark) ②封面/封尾文案(deepseek),
    并发跑、任一失败落默认值,**同步**返回;应用(sweep/组页/落库)在 Web 侧。"""
    result = await design_agent.run_design(
        language=req.language,
        album_title=req.albumTitle,
        chapter_contexts=list(req.chapterContexts),
        cover_slots=[slot.model_dump(mode="json", exclude_none=True) for slot in req.coverSlots],
        ending_slots=[slot.model_dump(mode="json", exclude_none=True) for slot in req.endingSlots],
    )
    log.info(
        "v3_design.done",
        fonts=result["fonts"],
        colors=result["colors"],
        models=result["models"],
    )
    return DesignResponse(
        ok=True,
        data=DesignData(
            fonts=DesignFonts(**result["fonts"]),
            colors=DesignColors(**result["colors"]),
            coverTexts=result["coverTexts"],
            endingTexts=result["endingTexts"],
        ),
    ).model_dump(mode="json")
