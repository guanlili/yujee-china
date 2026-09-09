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
from datetime import datetime, timezone
from typing import Any

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
from ..workflows.core.profile.inference import locked as _locked
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

# 推理单飞锁在 workflows/core/profile/inference.py —— CLIP 与档案共用一把,
# 因为它们抢的是同一台 2GB 机器的同一块内存,各锁各的等于没锁。理由和实测数字
# 都写在那个模块的抬头。
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


# ---------- internal:照片视觉档案 ----------------------------------------------
#
# 与 CLIP embedding 同一台 worker、同一个开关、同一把推理锁 —— 它们抢的是同一块
# 内存(shared-cpu-1x / 2048MB)。
# 产出形状必须能被 contracts/photo_profile.py 直接 parse:这是 A/B 两线的接缝。
# base64 只在内存里,不落盘不进日志(见本文件抬头的 Stateless 约定)。


class _PhotoProfileItem(BaseModel):
    photoId: str
    dataUrl: str


class _PhotoProfileRequest(BaseModel):
    images: list[_PhotoProfileItem]
    # ⚠️ 本批**收下但不实现**:真抠图要跑第二次高精度推理(isnet/1024²)、写 R2、
    # 回填 maskKey,而 R2 写入口在 B 线。收下是为了让调用方现在就能带上这个参数
    # 而不至于 422 —— 接上之后只在这里加分支,调用方不用改。见 Task Z1。
    persistMask: bool = False


@router.post("/internal/photo-profile", dependencies=[Depends(require_clip_bearer)])
async def photo_profile(payload: _PhotoProfileRequest) -> dict:
    _require_clip_worker("photo profile")
    if not payload.images:
        return {"ok": True, "data": {"profiles": {}}}

    from ..workflows.core.profile import build

    profiles: dict[str, dict] = {}
    for item in payload.images:
        image = _decode_data_url(item.dataUrl)
        # ⚠️ 这里**不套** _locked:build_profile 里除了本地分割推理,还有一次视觉
        # 模型的网络调用(好几秒)。把网络等待也锁进去,一本 100 张的书就是几百秒
        # 串行,analyze 直接超时。本地推理那段由 geometry.subject_mask 自己的
        # @locked 兜着(RLock),内存该守的已经守住了。
        profiles[item.photoId] = await run_in_threadpool(build.build_profile, image)
    log.info("photo_profile", count=len(payload.images), persist_mask=payload.persistMask)
    return {"ok": True, "data": {"profiles": profiles}}
