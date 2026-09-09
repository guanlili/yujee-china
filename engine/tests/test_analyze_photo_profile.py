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
        lambda photos, settings: called.append(1) or {},
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
        lambda photos, settings: {
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

    def _boom(photos, settings):
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
        lambda photos, settings: (order.append("profiles") or {p.photoId: {"composition": "focal"} for p in photos}),
    )
    monkeypatch.setattr(analyze.tree_builder, "assemble_stage1_tree", _spy_assemble)

    asyncio.run(analyze._run_analyze(analyze._Job(_req())))

    assert order == ["profiles", "assemble"]
