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

import base64
import io
import threading
from datetime import datetime, timezone
from typing import Any, Callable, TypeVar

from PIL import Image

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from .auth import require_bearer, require_clip_bearer
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


# ---------- internal:CLIP embedding worker ------------------------------------
#
# 只有专用的 2GB CLIP worker(fly.clip.toml,AGENT_ENABLE_CLIP_EMBEDDINGS=true)
# 开这个口;普通 1GB Agent 没装 torch,开关关着 => 404。
#
# ⚠️ 这个路由曾在 0cfc019d「瘦身到最小版」被误删,而调用方 features.py 一直在调。
# 生产 yujee-agent-clip 上它是通的(线上镜像比源码新且复现不出来),所以补回来是
# **拆哑雷**:防的是「下次谁拿当前源码重新 deploy CLIP worker,analyze 当场 404」。
# 响应形状由调用方 features.py:_remote_clip_embeddings 决定,不能改。
#
# 欠账(本批不还):/internal/agent-ack 也存在同样的「生产有、源码没有」漂移,
# 但它没有活的调用方,单独记账。

_T = TypeVar("_T")

# 推理单飞锁。CLIP worker 是 shared-cpu-1x / 2048MB,实测 torch+open_clip 加载
# 峰值就吃掉 ~1.36GB,只剩 ~690MB 余量;而 run_in_threadpool 默认 40 个线程,
# 两三个并发推理就能把工作集乘爆。CLIP 与档案推理共用同一把锁 —— 它们抢的是
# 同一台机器的内存,不能各锁各的。
_INFERENCE_LOCK = threading.Lock()


def _locked(fn: Callable[..., _T]) -> Callable[..., _T]:
    """把一个同步推理函数包成「全机串行」——交给 run_in_threadpool 之前套上。"""

    def _run(*args: Any, **kwargs: Any) -> _T:
        with _INFERENCE_LOCK:
            return fn(*args, **kwargs)

    return _run


def _bad_request(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"ok": False, "error": {"code": "AGENT_BAD_REQUEST", "message": message}},
    )


def _decode_data_url(url: str) -> Image.Image:
    """data URL -> PIL Image。只认 base64 内联,不外联取图(SSRF)。"""
    if not isinstance(url, str) or "," not in url:
        raise _bad_request("not a data url")
    header, encoded = url.split(",", 1)
    if not header.startswith("data:image/"):
        raise _bad_request("not an image data url")
    try:
        return Image.open(io.BytesIO(base64.b64decode(encoded, validate=True)))
    except Exception as exc:  # noqa: BLE001 —— 坏 base64 / 坏图都只是 400,不是 500
        raise _bad_request("undecodable image data url") from exc


def _require_clip_worker(what: str) -> None:
    if not get_settings().agent_enable_clip_embeddings:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"ok": False, "error": {"code": "AGENT_NOT_FOUND", "message": f"{what} disabled"}},
        )


class _EmbeddingsRequest(BaseModel):
    images: list[str]  # data:image/jpeg;base64,... —— 只在内存里,不落盘不进日志


@router.post("/internal/open-clip/embeddings", dependencies=[Depends(require_clip_bearer)])
async def open_clip_embeddings(payload: _EmbeddingsRequest) -> dict:
    _require_clip_worker("clip embeddings")
    if not payload.images:
        return {"ok": True, "data": {"embeddings": []}}

    from ..workflows.core.chaptering import features

    images = [_decode_data_url(url) for url in payload.images]
    # CPU 推理是阻塞的,别占住事件循环;并发要串行,别把 2GB 撑爆。
    embeddings = await run_in_threadpool(_locked(features.clip_embeddings), images)
    log.info("open_clip_embeddings", count=len(images))
    return {"ok": True, "data": {"embeddings": embeddings}}
