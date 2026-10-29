"""V3 `/v3/analyze` Stage1 tree-only orchestration.

Stage1 now builds only a V3LayoutTree:
group_photos -> group_unplaced -> accent_of_group.
Template selection, render pages, cover/ending wrapping, and generic copy belong to
later stages and are not produced by this job.
"""

from __future__ import annotations

import asyncio
import time

from ..api import callback
from .core.chaptering import grouping as chapter_grouping
from .core.chaptering import tree_builder
from .core.chaptering import unplaced as chapter_unplaced
from .core.profile import publish as profile_publish
from .core.profile import remote as profile_remote
from ..logging_config import get_logger, request_id_var
from ..contracts.schemas import (
    V3AnalyzeCompleted,
    V3AnalyzeRequest,
    V3CallbackError,
    V3FailedEvent,
    V3JobStage,
    V3Models,
    V3ProgressEvent,
    V3Usage,
)
from ..settings import get_settings

log = get_logger("v3_album")

# 本地 CLIP/PyTorch 分组会吃 CPU/内存;单进程内一次只跑一个 embedding pass。
_GROUPING_SEMAPHORE = asyncio.Semaphore(1)


class _Job:
    """Per-analyze-job holder for active-stage failure reporting."""

    def __init__(self, req: V3AnalyzeRequest) -> None:
        self.req = req
        self.active_stage: V3JobStage | None = None


# ---------- callback helpers --------------------------------------------------


async def _emit_progress(job: _Job, stage: V3JobStage, progress: int) -> None:
    job.active_stage = stage
    envelope = V3ProgressEvent(
        event="progress",
        jobKind="analyze",
        requestId=job.req.requestId,
        stage=stage,
        progress=progress,
    )
    await callback.post(str(job.req.callbackUrl), envelope)


async def _emit_failure(
    job: _Job,
    *,
    code: str,
    message: str,
    stage: V3JobStage | None = None,
) -> None:
    if stage is not None:
        try:
            await _emit_progress(job, stage, 0)
        except Exception as exc:  # noqa: BLE001
            log.warning("v3_analyze.pre_fail_progress_error", error=str(exc))

    envelope = V3FailedEvent(
        event="failed",
        jobKind="analyze",
        requestId=job.req.requestId,
        error=V3CallbackError(code=code, message=message[:500]),
        **({"stage": stage} if stage is not None else {}),
    )
    await callback.post(str(job.req.callbackUrl), envelope)


# ---------- analyze job -------------------------------------------------------


async def _run_analyze(job: _Job) -> None:
    req = job.req
    started = time.monotonic()
    photos_by_id = {photo.photoId: photo for photo in req.photos}

    await _emit_progress(job, "group", 0)
    try:
        async with _GROUPING_SEMAPHORE:
            grouping = await asyncio.to_thread(chapter_grouping.group_photos, req.photos)
    except Exception as exc:  # noqa: BLE001
        log.exception("v3_analyze.group_failed", error=str(exc))
        await _emit_failure(
            job, code="AGENT_OUTPUT_VALIDATION", message=str(exc), stage="group"
        )
        return

    # 照片视觉档案。**必须在建树之前**拿到 —— 它回填的 composition 是排版
    # (select_layout 的 slot_matcher)的输入,晚一步就白填。
    #
    # 三条硬要求:默认关(开了就是每本书 N 次视觉调用,而 analyze 至今零 AI 调用);
    # 委托给 2GB 的 CLIP worker(这台 1GB 机器没有分割权重);失败**绝不打挂
    # analyze** —— 建档是锦上添花,挂了就退回今天的行为。
    profiles: dict[str, dict] = {}
    # 视觉调用发生在对面那台 CLIP worker 上,本机看不见 —— 计数只能靠它带回来。
    profile_stats: dict[str, int] = {}
    if get_settings().agent_enable_photo_profile:
        try:
            profiles = await asyncio.to_thread(
                lambda: profile_remote.fetch_photo_profiles(
                    req.photos, get_settings(), stats=profile_stats
                )
            )
        except Exception as exc:  # noqa: BLE001 —— 档案挂了不该连坐整次 analyze
            log.warning("v3_analyze.photo_profile_failed", error=str(exc))
            profiles = {}

        # 档案回传 web 落 `album_photos.profile`。**这一步是整批功能的出口** ——
        # 下面那次回填只写章节树的 composition/sceneDescription,档案本体
        # (subjectBox/色彩组/语义组)不落库就没人读得到:profile 列恒 NULL ->
        # design-agent 看不到档案 -> 整本调色 / 构图裁切 / 抠图三个工具全在猜。
        # 失败只记日志,不打挂 analyze(档案是增强不是必需)。
        if profiles:
            try:
                await profile_publish.publish_photo_profiles(
                    album_id=req.albumId,
                    profiles=profiles,
                    callback_url=str(req.callbackUrl),
                    settings=get_settings(),
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("v3_analyze.photo_profile_publish_failed", error=str(exc))

    # 散落照片走确定性就近归章(按时间/位置),树里的章标识由时间/地点派生:
    # 分析期不再有任何 AI 调用。
    try:
        # 重活下线程池(2026-10-29):散章归属与树构建(含主色解码)是纯 CPU 同步
        # 代码,此前直接跑在事件循环上,大书期间 /health 都会被卡住。
        assignments = await asyncio.to_thread(
            chapter_unplaced.group_unplaced, grouping, photos_by_id
        )
        tree = await asyncio.to_thread(
            tree_builder.assemble_stage1_tree,
            grouping, assignments, photos_by_id, profiles=profiles,
            language=req.language,
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("v3_analyze.regroup_or_assemble_failed", error=str(exc))
        await _emit_failure(
            job, code="AGENT_OUTPUT_VALIDATION", message=str(exc), stage="group"
        )
        return
    await _emit_progress(job, "group", 100)

    duration_ms = int((time.monotonic() - started) * 1000)
    # 建档开关关着时分析期确实零 AI 调用(计数为 0);开着就是每张照片一次视觉调用,
    # 计数必须是真的 —— 「翻这一页要先有人算过成本」正是那个开关存在的理由,
    # 而这里原来硬编码 0,等于开关打开之后成本表永远显示不花钱。
    # 计的是**真的发出去并回来了**的调用数,不是档案份数:视觉槽整体挂掉时每张照片
    # 仍然有档案(语义组降级),但一次调用都没成功。
    vision_call_count = int(profile_stats.get("visionCalls", 0))
    envelope = V3AnalyzeCompleted(
        event="completed",
        jobKind="analyze",
        requestId=req.requestId,
        tree=tree,
        usage=V3Usage(
            durationMs=duration_ms, visionCallCount=vision_call_count, models=V3Models()
        ),
    )
    await callback.post(str(req.callbackUrl), envelope)
    log.info(
        "v3_analyze.completed",
        duration_ms=duration_ms,
        chapters=len(tree.chapters),
        profiles=len(profiles),
        vision_calls=vision_call_count,
    )


async def run_with_timeout(req: V3AnalyzeRequest) -> None:
    """Background-task entry point with stage-aware timeout/error callbacks."""
    settings = get_settings()
    job = _Job(req)
    token = request_id_var.set(req.requestId)
    try:
        try:
            await asyncio.wait_for(
                _run_analyze(job), timeout=settings.background_task_timeout_seconds
            )
        except asyncio.TimeoutError:
            log.error("v3_analyze.timeout")
            await _emit_failure(
                job,
                code="AGENT_TIMEOUT",
                message="background task exceeded timeout",
                stage=job.active_stage,
            )
        except Exception as exc:  # noqa: BLE001
            log.exception("v3_analyze.unhandled", error=str(exc))
            await _emit_failure(
                job,
                code="AGENT_INTERNAL_ERROR",
                message=str(exc),
                stage=job.active_stage,
            )
    finally:
        request_id_var.reset(token)
