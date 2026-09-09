"""建档接进 analyze。

必须在 select_layout 之前算完,否则 composition 白填(排版才是消费方)。

三条硬要求:
1. **默认不开**。开了就是每本书 N 次视觉模型调用 —— analyze 至今是「零 AI 调用
   的纯确定性分组」,这是架构里写明的性质,翻这一页要有人拍板成本。
2. **失败绝不打挂 analyze**。建档是锦上添花,挂了就退回今天的行为。
3. 档案要真的落到树上的 composition / sceneDescription。
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from src.api import callback as cb_mod
from src.contracts.schemas import V3AnalyzeRequest
from src.workflows import analyze
from src.workflows.core.chaptering import grouping as chapter_grouping
from src.workflows.core.chaptering.schema import (
    GroupingChapter,
    GroupingResult,
    UnplacedAssignments,
)
from src.settings import reset_settings_cache


@pytest.fixture(autouse=True)
def _reset():
    reset_settings_cache()
    yield
    reset_settings_cache()


@pytest.fixture(autouse=True)
def _stub_grouping(monkeypatch):
    """真的 group_photos 会去解码照片(还会跑 CLIP)。本文件测的是档案接线,
    分组打桩掉 —— 沿用 test_v3_analyze.py 里 stage1_order 的做法。"""

    def _fake_group_photos(photos):
        return GroupingResult(
            chapters=[GroupingChapter(chapterId="ch_1", photoIds=[p.photoId for p in photos])],
            unplacedPhotoIds=[],
        )

    monkeypatch.setattr(chapter_grouping, "group_photos", _fake_group_photos)
    monkeypatch.setattr(analyze.chapter_grouping, "group_photos", _fake_group_photos)
    monkeypatch.setattr(
        analyze.chapter_unplaced, "group_unplaced",
        lambda grouping, photos_by_id: UnplacedAssignments(assignments={}),
    )


@pytest.fixture
def captured(monkeypatch):
    received: list[dict[str, Any]] = []

    async def fake_post(callback_url: str, envelope: Any) -> bool:
        received.append(cb_mod._serialize(envelope))
        return True

    monkeypatch.setattr(cb_mod, "post", fake_post)
    return received


def _req() -> V3AnalyzeRequest:
    return V3AnalyzeRequest(
        requestId="req_profile",
        albumId="alb",
        callbackUrl="http://example.com/cb",
        language="zh",
        photos=[
            {
                "photoId": f"p{i}",
                "base64": "data:image/jpeg;base64,AA==",
                "width": 800,
                "height": 600,
                "clusterId": "c1",
                "exif": {"takenAt": f"2024-01-0{i}T10:00:00Z"},
            }
            for i in (1, 2, 3)
        ],
    )


def _completed(received):
    return [e for e in received if e.get("event") == "completed"][0]


def _photos(completed):
    return {p["photoId"]: p for c in completed["tree"]["chapters"] for p in c["photos"]}


def test_disabled_by_default_does_not_build_profiles(monkeypatch, captured):
    """默认关闭 —— analyze 保持「零 AI 调用」,不多花一分钱。"""
    called: list[int] = []
    monkeypatch.setattr(
        analyze.profile_remote, "fetch_photo_profiles",
        lambda photos, settings, **_: called.append(1) or {},
    )

    asyncio.run(analyze._run_analyze(analyze._Job(_req())))

    assert called == []
    photos = _photos(_completed(captured))
    assert photos["p1"]["composition"] is None
    assert photos["p1"]["sceneDescription"] == ""


def test_enabled_backfills_composition_and_description(monkeypatch, captured):
    monkeypatch.setenv("AGENT_ENABLE_PHOTO_PROFILE", "true")
    reset_settings_cache()
    monkeypatch.setattr(
        analyze.profile_remote, "fetch_photo_profiles",
        lambda photos, settings, **_: {
            p.photoId: {"composition": "wide", "description": f"{p.photoId} 的画面"}
            for p in photos
        },
    )

    asyncio.run(analyze._run_analyze(analyze._Job(_req())))

    photos = _photos(_completed(captured))
    assert photos["p1"]["composition"] == "wide"
    assert photos["p1"]["sceneDescription"] == "p1 的画面"


def test_profile_failure_does_not_break_analyze(monkeypatch, captured):
    """CLIP worker 挂了/超时 —— analyze 必须照常 completed,退回今天的行为。"""
    monkeypatch.setenv("AGENT_ENABLE_PHOTO_PROFILE", "true")
    reset_settings_cache()

    def _boom(photos, settings, **_):
        raise RuntimeError("clip worker down")

    monkeypatch.setattr(analyze.profile_remote, "fetch_photo_profiles", _boom)

    asyncio.run(analyze._run_analyze(analyze._Job(_req())))

    completed = _completed(captured)
    assert completed["event"] == "completed"
    assert _photos(completed)["p1"]["composition"] is None


def test_profiles_are_built_before_the_tree_is_assembled(monkeypatch, captured):
    """顺序保证:档案必须在建树之前拿到,否则回填的是空气。"""
    monkeypatch.setenv("AGENT_ENABLE_PHOTO_PROFILE", "true")
    reset_settings_cache()
    order: list[str] = []

    real_assemble = analyze.tree_builder.assemble_stage1_tree

    def _spy_assemble(grouping, assignments, photos_by_id, profiles=None):
        order.append("assemble")
        assert profiles, "建树时必须已经拿到档案"
        return real_assemble(grouping, assignments, photos_by_id, profiles=profiles)

    monkeypatch.setattr(
        analyze.profile_remote, "fetch_photo_profiles",
        lambda photos, settings, **_: (order.append("profiles") or {p.photoId: {"composition": "focal"} for p in photos}),
    )
    monkeypatch.setattr(analyze.tree_builder, "assemble_stage1_tree", _spy_assemble)

    asyncio.run(analyze._run_analyze(analyze._Job(_req())))

    assert order == ["profiles", "assemble"]


# ── 档案必须回传 web,否则整批功能空转 ──────────────────────────────────────────
#
# 树里那次回填只写 composition/sceneDescription;档案本体要落到
# `album_photos.profile` 才有人读得到。不回传的后果不是报错,是三个照片能力集体空转。


def _capture_publish(monkeypatch):
    seen: list[dict] = []

    async def _fake_publish(*, album_id, profiles, callback_url, settings):
        seen.append(
            {
                "album_id": album_id,
                "profiles": profiles,
                "callback_url": callback_url,
            }
        )
        return True

    monkeypatch.setattr(analyze.profile_publish, "publish_photo_profiles", _fake_publish)
    return seen


def _enable_profiles(monkeypatch):
    monkeypatch.setenv("AGENT_ENABLE_PHOTO_PROFILE", "true")
    reset_settings_cache()
    monkeypatch.setattr(
        analyze.profile_remote,
        "fetch_photo_profiles",
        lambda photos, settings, **_: {p.photoId: {"v": 1, "composition": "wide"} for p in photos},
    )


def test_profiles_are_published_back_to_web(monkeypatch, captured):
    _enable_profiles(monkeypatch)
    seen = _capture_publish(monkeypatch)

    req = _req()
    asyncio.run(analyze._run_analyze(analyze._Job(req)))

    assert len(seen) == 1, "档案没有回传 —— album_photos.profile 会恒 NULL,三个照片能力全空转"
    assert seen[0]["album_id"] == req.albumId
    assert set(seen[0]["profiles"]) == {"p1", "p2", "p3"}
    assert seen[0]["callback_url"] == str(req.callbackUrl)


def test_publish_failure_does_not_break_analyze(monkeypatch, captured):
    """回传是增强不是必需 —— 它挂了 analyze 照常 completed。"""
    _enable_profiles(monkeypatch)

    async def _boom(**kwargs):
        raise RuntimeError("web down")

    monkeypatch.setattr(analyze.profile_publish, "publish_photo_profiles", _boom)

    asyncio.run(analyze._run_analyze(analyze._Job(_req())))

    completed = _completed(captured)
    assert completed["event"] == "completed"
    # 回传挂了不影响树里那次回填 —— 那是两条独立的收益。
    assert _photos(completed)["p1"]["composition"] == "wide"


def test_no_publish_when_the_feature_is_off(monkeypatch, captured):
    seen = _capture_publish(monkeypatch)
    asyncio.run(analyze._run_analyze(analyze._Job(_req())))
    assert seen == []


def test_usage_reports_the_real_vision_call_count(monkeypatch, captured):
    """开关打开后每本书 N 次视觉调用,usage.visionCallCount 不能再恒 0 ——
    「翻这一页要先有人算过成本」正是这个开关存在的理由。"""
    monkeypatch.setenv("AGENT_ENABLE_PHOTO_PROFILE", "true")
    reset_settings_cache()
    _capture_publish(monkeypatch)

    def _fetch(photos, settings, *, stats=None):
        if stats is not None:
            stats["visionCalls"] = len(photos)
        return {p.photoId: {"v": 1, "composition": "wide"} for p in photos}

    monkeypatch.setattr(analyze.profile_remote, "fetch_photo_profiles", _fetch)

    asyncio.run(analyze._run_analyze(analyze._Job(_req())))

    assert _completed(captured)["usage"]["visionCallCount"] == 3


def test_vision_call_count_stays_zero_when_profiles_are_off(monkeypatch, captured):
    """默认关闭 -> analyze 仍然是「零 AI 调用的纯确定性分组」。"""
    asyncio.run(analyze._run_analyze(analyze._Job(_req())))
    assert _completed(captured)["usage"]["visionCallCount"] == 0
