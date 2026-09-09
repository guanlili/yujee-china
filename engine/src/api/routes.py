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

import asyncio
import base64
import io
import weakref
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
    """data URL -> **完整解码**的 PIL Image。只认 base64 内联,不外联取图(SSRF)。

    ⚠️ `load()` 不能省。`Image.open` 是惰性的:截断的 JPEG 能 open 成功,真解码要等
    到后面 convert 的时候才炸(实测 `Image.open OK` -> `OSError: image file is
    truncated`)。不在这里炸掉,一张坏图就要白烧一次分割推理 + 一次视觉模型调用
    才被发现,而且是在没人包 try 的地方炸。
    """
    if not isinstance(url, str) or "," not in url:
        raise _bad_request("not a data url")
    header, encoded = url.split(",", 1)
    if not header.startswith("data:image/"):
        raise _bad_request("not an image data url")
    try:
        image = Image.open(io.BytesIO(base64.b64decode(encoded, validate=True)))
        image.load()
        return image
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
    # 真抠图:再跑一次高精度推理(isnet/1024²)出精细边缘,mask 以 base64 PNG 从
    # data.masks 回去。**写 R2、回填 maskKey 是 web 侧的事**,engine 只出 mask。
    # 建档路径不跑它 —— 一本 100 张的书白烧 100 次 1024² 推理,而且预存 mask 是
    # 5-20MB 净浪费(绝大多数照片不会被抠)。
    persistMask: bool = False


# 视觉调用的并发上限。**不能不限**:视觉模型有速率限制,一次 gather 一百个会被
# 打回来。跟 profile/remote.py 的 PROFILE_BATCH_SIZE 对齐 —— 调用方按 8 分批,
# 这里就按 8 放行,多出来的排队。
PROFILE_MAX_CONCURRENCY = 8

# ⚠️ 信号量必须**跨请求共用**,不能每请求新建。唯一调用方每批正好发
# PROFILE_BATCH_SIZE(=8)张,而上限也是 8 —— 每请求一把的话它从不 block,等于没有
# 限流:实测 4 个并发请求跑出 32 路视觉调用,上游速率限制会整批打回来。
#
# 又不能直接写成一个模块级 `asyncio.Semaphore(...)`:asyncio 的锁在第一次真的等待时
# 绑定当时的事件循环,换一个循环再用就 `RuntimeError: bound to a different event loop`
# (实测)。线上一个 uvicorn 进程只有一个循环无所谓,但测试里每个 TestClient portal
# 都是新循环,整套路由测试会从第二个用例起连环炸。所以按循环各存一把:同一个循环
# 里所有请求共用(这才是限流要的),不同循环互不干扰。WeakKeyDictionary 让循环关掉
# 之后自己回收,不攒垃圾。
_PROFILE_SEMAPHORES: "weakref.WeakKeyDictionary[Any, asyncio.Semaphore]" = (
    weakref.WeakKeyDictionary()
)


def _profile_semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    semaphore = _PROFILE_SEMAPHORES.get(loop)
    if semaphore is None:
        semaphore = asyncio.Semaphore(PROFILE_MAX_CONCURRENCY)
        _PROFILE_SEMAPHORES[loop] = semaphore
    return semaphore


@router.post("/internal/photo-profile", dependencies=[Depends(require_clip_bearer)])
async def photo_profile(payload: _PhotoProfileRequest) -> dict:
    _require_clip_worker("photo profile")
    if not payload.images:
        return {"ok": True, "data": {"profiles": {}}}

    from ..workflows.core.profile import build, geometry

    # 坏图在跑任何推理之前就筛掉,别白烧算力 —— 但**逐张筛**,不是整批 400。
    # 三个模块的抬头都写着「一张照片的失败不该打挂整本」,而这里原来是列表推导:
    # 第一张坏图抛 HTTPException,同批另外 7 张全部陪葬。
    decoded: list[tuple[str, Image.Image]] = []
    undecodable: list[str] = []
    for item in payload.images:
        try:
            decoded.append((item.photoId, _decode_data_url(item.dataUrl)))
        except HTTPException:
            undecodable.append(item.photoId)
    if undecodable:
        log.warning("photo_profile.undecodable", photo_ids=undecodable, count=len(undecodable))
    if not decoded:
        # 一张都解不出来 = 调用方发错了东西。回空 map 假装成功会让整本书悄悄没档案,
        # 那正是这批要治的病;这种情况必须让调用方看见。
        raise _bad_request("no decodable image in batch")

    # ⚠️ 批内必须**并发**,不能逐个 await。每张 ≈ 0.6s 本地推理 + 2~3s 视觉网络往返;
    # 串行的话 100 张的书要跑 5-6 分钟,而 grouping_clip_timeout_seconds 默认才 180s
    # —— 开关一开 analyze 就废。并发后一批 8 张从 ~28s 降到 ~5s。
    #
    # 这里**不套** _locked,也不该套:锁住网络等待就等于没并发。内存不会因此失守
    # —— geometry.subject_mask 自己带 @locked(RLock),本地推理那段仍然全机串行,
    # 并发的只是网络 I/O。tests/test_internal_clip_route.py 两头都钉了:
    # 视觉调用必须有重叠、本地推理必须无重叠。
    semaphore = _profile_semaphore()

    # 成本计数:调用方那台 1GB Agent 自己看不见视觉调用,只能由这里带回去。
    # 每张一个独立的 dict —— 它们在不同线程里被写(run_in_threadpool),共用一个会掉数。
    stats: list[dict] = [{} for _ in decoded]

    async def _build(index: int, photo_id: str, image: Image.Image) -> dict:
        async with semaphore:
            return await run_in_threadpool(
                build.build_profile, image, photo_id=photo_id, stats=stats[index]
            )

    # return_exceptions=True:少一张档案 vs 整批 500,前者是这个 endpoint 的设计意图。
    results = await asyncio.gather(
        *(_build(i, pid, img) for i, (pid, img) in enumerate(decoded)),
        return_exceptions=True,
    )
    profiles: dict[str, dict] = {}
    for (photo_id, _image), result in zip(decoded, results):
        if isinstance(result, BaseException):
            log.warning(
                "photo_profile.build_failed",
                photo_id=photo_id,
                error=f"{type(result).__name__}: {result}",
            )
            continue
        profiles[photo_id] = result

    # persistMask:按需的第二次推理(isnet/1024²)。一张 mask 失败只丢这一张,
    # 档案照常返回 —— 跟上面同一个道理。
    masks: dict[str, str] = {}
    if payload.persistMask:

        async def _mask(image: Image.Image) -> str:
            png = await run_in_threadpool(geometry.cutout_mask_png, image)
            return base64.b64encode(png).decode("ascii")

        mask_results = await asyncio.gather(
            *(_mask(img) for _pid, img in decoded), return_exceptions=True
        )
        for (photo_id, _image), mask_result in zip(decoded, mask_results):
            if isinstance(mask_result, BaseException):
                log.warning(
                    "photo_profile.mask_failed",
                    photo_id=photo_id,
                    error=f"{type(mask_result).__name__}: {mask_result}",
                )
                continue
            masks[photo_id] = mask_result

    vision_calls = sum(int(s.get("visionCalls", 0)) for s in stats)
    log.info(
        "photo_profile",
        count=len(payload.images),
        built=len(profiles),
        undecodable=len(undecodable),
        failed=len(decoded) - len(profiles),
        vision_calls=vision_calls,
        persist_mask=payload.persistMask,
        masks=len(masks),
    )
    # masks 恒有这个键(persistMask=false 时是空 dict):省掉调用方一次 undefined 判断。
    return {
        "ok": True,
        "data": {
            "profiles": profiles,
            "masks": masks,
            "visionCallCount": vision_calls,
        },
    }
