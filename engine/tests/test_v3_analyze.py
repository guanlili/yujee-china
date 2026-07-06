"""Stage1 tree-only analyze pipeline tests for PR249/#263.

The analyze job now orchestrates fixed Stage1 primitives:
group_photos -> describe_chapters -> refine_unplaced -> accent_of_group.
It stores only a V3LayoutTree in the completed callback; layout pages belong to
Stage2.
"""

from __future__ import annotations

import asyncio
import base64
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from src.api import callback as cb_mod
from src.workflows.core.chaptering.chapter_describer import handler as chapter_describer
from src.workflows.core.chaptering.chapter_describer.schema import DescribeResult
from src.workflows.core.chaptering.vision_error import VisionError
from src.workflows.core.chaptering import grouping as chapter_grouping
from src.workflows.core.chaptering import refinement as chapter_refinement
from src.workflows.core.chaptering.schema import GroupingChapter, GroupingResult, UnplacedAssignments
from src.workflows.core.layout import accent_color
from src.workflows import analyze
from src.contracts.schemas import (
    V3AnalyzeCompleted,
    V3AnalyzeRequest,
    V3Chapter,
    V3ChapterPhoto,
    V3LayoutTree,
)


def _orient(w: int, h: int) -> str:
    if w > h:
        return "landscape"
    if h > w:
        return "portrait"
    return "square"


def _req(count: int, request_id: str = "req_v3_analyze") -> V3AnalyzeRequest:
    photos = []
    for i in range(count):
        photos.append(
            {
                "photoId": f"p{i + 1}",
                "base64": "data:image/jpeg;base64,AA==",
                "width": 800 if i % 2 == 0 else 600,
                "height": 600 if i % 2 == 0 else 800,
                "clusterId": f"c{(i // 2) + 1}",
                "exif": {"takenAt": f"2024-01-{(i % 28) + 1:02d}T10:00:00Z"},
            }
        )
    return V3AnalyzeRequest(
        requestId=request_id,
        albumId="alb_v3",
        callbackUrl="http://example.com/cb",
        language="en",
        meta={"promptHint": "A spring trip"},
        photos=photos,
    )


@pytest.fixture
def captured_callbacks(monkeypatch):
    received: list[dict[str, Any]] = []

    async def fake_post(callback_url: str, envelope: Any) -> bool:
        received.append(cb_mod._serialize(envelope))
        return True

    monkeypatch.setattr(cb_mod, "post", fake_post)
    return received


@pytest.fixture
def stage1_order(monkeypatch):
    calls: list[str] = []

    def fake_group_photos(photos):
        calls.append("group_photos")
        ids = [p.photoId for p in photos]
        chapters = [GroupingChapter(chapterId="ch_1", photoIds=ids[:2])]
        if ids[2:]:
            chapters.append(GroupingChapter(chapterId="ch_2", photoIds=ids[2:]))
        return GroupingResult(chapters=chapters, unplacedPhotoIds=[])

    async def fake_describe_chapters(grouping, photos_by_id, *, language, prompt_hint=None):
        calls.append("describe_chapters")
        assert language == "en"
        assert prompt_hint in {"A spring trip", None}
        image_descriptions = {
            photo_id: f"scene {photo_id}"
            for chapter in grouping.chapters
            for photo_id in chapter.photoIds
        }
        return DescribeResult(
            chapterDescriptions={
                chapter.chapterId: f"Description for {chapter.chapterId}."
                for chapter in grouping.chapters
            },
            imageDescriptions=image_descriptions,
            tokens_billed=18,
            model="gpt-5.5-mini",
            provider="openai",
            call_count=1,
        )

    async def fake_refine_unplaced(grouping, descriptions, photos_by_id, *, language):
        calls.append("refine_unplaced")
        return UnplacedAssignments(assignments={})

    def fake_accent_of_group(photo_ids, photos_by_id):
        calls.append("accent_of_group")
        assert list(photo_ids)
        return "#112233"

    monkeypatch.setattr(chapter_grouping, "group_photos", fake_group_photos)
    monkeypatch.setattr(chapter_describer, "describe_chapters", fake_describe_chapters)
    monkeypatch.setattr(chapter_refinement, "refine_unplaced", fake_refine_unplaced)
    monkeypatch.setattr(accent_color, "accent_of_group", fake_accent_of_group)
    return calls


def test_completed_callback_omits_absent_pages_but_keeps_tree_null_placeholders():
    envelope = V3AnalyzeCompleted(
        requestId="r1",
        jobKind="analyze",
        event="completed",
        tree=V3LayoutTree(
            chapters=[
                V3Chapter(
                    chapterId="ch_1",
                    description="Chapter one.",
                    extractedColor="#112233",
                    accentColor=None,
                    artFont=None,
                    photos=[],
                )
            ]
        ),
        usage={"durationMs": 1, "models": {}},
    )

    body = cb_mod._serialize(envelope)

    assert "pages" not in body
    chapter = body["tree"]["chapters"][0]
    assert chapter["extractedColor"] == "#112233"
    assert "accentColor" in chapter and chapter["accentColor"] is None
    assert "artFont" in chapter and chapter["artFont"] is None


def test_stage1_analyze_emits_tree_only_in_required_order(
    captured_callbacks, stage1_order
):
    asyncio.run(analyze._run_analyze(analyze._Job(_req(4))))

    assert stage1_order == [
        "group_photos",
        "describe_chapters",
        "refine_unplaced",
        "accent_of_group",
        "accent_of_group",
    ]

    progress = [
        (c["stage"], c["progress"])
        for c in captured_callbacks
        if c["event"] == "progress"
    ]
    assert progress == [
        ("group", 0),
        ("group", 100),
        ("describe", 0),
        ("describe", 100),
        ("group", 0),
        ("group", 100),
    ]

    completed = next(c for c in captured_callbacks if c["event"] == "completed")
    assert completed["jobKind"] == "analyze"
    assert completed["requestId"] == "req_v3_analyze"
    assert "pages" not in completed
    assert completed["usage"]["visionCallCount"] == 1
    assert completed["usage"]["models"]["vision"] == "gpt-5.5-mini"

    envelope = V3AnalyzeCompleted(**completed)
    tree = envelope.tree
    assert [[p.photoId for p in c.photos] for c in tree.chapters] == [
        ["p1", "p2"],
        ["p3", "p4"],
    ]
    for chapter in tree.chapters:
        assert chapter.extractedColor == "#112233"
        assert chapter.accentColor is None
        assert chapter.artFont is None
    assert [p.sceneDescription for c in tree.chapters for p in c.photos] == [
        "scene p1",
        "scene p2",
        "scene p3",
        "scene p4",
    ]


def test_stage1_analyze_runs_grouping_inside_concurrency_gate(
    monkeypatch, captured_callbacks, stage1_order
):
    class RecordingGate:
        def __init__(self) -> None:
            self.entered = 0
            self.exited = 0

        async def __aenter__(self):
            self.entered += 1
            return self

        async def __aexit__(self, exc_type, exc, tb):
            self.exited += 1
            return False

    gate = RecordingGate()
    monkeypatch.setattr(analyze, "_GROUPING_SEMAPHORE", gate, raising=False)

    asyncio.run(analyze._run_analyze(analyze._Job(_req(4))))

    assert gate.entered == 1
    assert gate.exited == 1
    assert stage1_order[0] == "group_photos"
    assert any(c["event"] == "completed" for c in captured_callbacks)


def test_stage1_describe_failure_resets_describe_stage(monkeypatch, captured_callbacks):
    def fake_group_photos(photos):
        return GroupingResult(
            chapters=[GroupingChapter(chapterId="ch_1", photoIds=[p.photoId for p in photos])],
            unplacedPhotoIds=[],
        )

    async def boom(*args, **kwargs):
        raise VisionError("describe failed")

    monkeypatch.setattr(chapter_grouping, "group_photos", fake_group_photos)
    monkeypatch.setattr(chapter_describer, "describe_chapters", boom)

    asyncio.run(analyze._run_analyze(analyze._Job(_req(2))))

    failed = [c for c in captured_callbacks if c["event"] == "failed"]
    assert len(failed) == 1, captured_callbacks
    assert failed[0]["error"]["code"] == "AGENT_VISION_FAILED"
    assert failed[0]["stage"] == "describe"
    describe_ticks = [
        c["progress"]
        for c in captured_callbacks
        if c["event"] == "progress" and c["stage"] == "describe"
    ]
    assert describe_ticks == [0, 0], describe_ticks


def test_analyze_timeout_resets_the_active_stage(monkeypatch, captured_callbacks):
    async def slow(_job):
        await analyze._emit_progress(_job, "group", 50)
        await asyncio.sleep(0.5)

    class _Budget:
        background_task_timeout_seconds = 0.01

    monkeypatch.setattr(analyze, "_run_analyze", slow)
    monkeypatch.setattr(analyze, "get_settings", lambda: _Budget())

    asyncio.run(analyze.run_with_timeout(_req(2)))

    failed = [c for c in captured_callbacks if c["event"] == "failed"]
    assert len(failed) == 1, captured_callbacks
    assert failed[0]["error"]["code"] == "AGENT_TIMEOUT"
    assert failed[0]["stage"] == "group"
    group_ticks = [
        c["progress"]
        for c in captured_callbacks
        if c["event"] == "progress" and c["stage"] == "group"
    ]
    assert group_ticks == [50, 0], group_ticks


def test_analyze_unhandled_error_resets_the_active_stage(monkeypatch, captured_callbacks):
    async def boom(_job):
        await analyze._emit_progress(_job, "describe", 25)
        raise RuntimeError("callback-adjacent boom")

    class _Budget:
        background_task_timeout_seconds = 10

    monkeypatch.setattr(analyze, "_run_analyze", boom)
    monkeypatch.setattr(analyze, "get_settings", lambda: _Budget())

    asyncio.run(analyze.run_with_timeout(_req(2)))

    failed = [c for c in captured_callbacks if c["event"] == "failed"]
    assert len(failed) == 1, captured_callbacks
    assert failed[0]["error"]["code"] == "AGENT_INTERNAL_ERROR"
    assert failed[0]["stage"] == "describe"
    describe_ticks = [
        c["progress"]
        for c in captured_callbacks
        if c["event"] == "progress" and c["stage"] == "describe"
    ]
    assert describe_ticks == [25, 0], describe_ticks


def test_analyze_request_rejects_non_http_callback_url():
    data = _req(1).model_dump(mode="json")
    data["callbackUrl"] = "mailto:ops@example.com"

    with pytest.raises(ValidationError):
        V3AnalyzeRequest(**data)


def test_analyze_photo_requires_image_data_url():
    data = _req(1).model_dump(mode="json")
    data["photos"][0]["base64"] = "AA=="

    with pytest.raises(ValidationError):
        V3AnalyzeRequest(**data)


def test_analyze_photo_rejects_malformed_base64_payload():
    data = _req(1).model_dump(mode="json")
    data["photos"][0]["base64"] = "data:image/jpeg;base64,AA=A"

    with pytest.raises(ValidationError):
        V3AnalyzeRequest(**data)


def test_analyze_photo_rejects_payloads_over_800kb():
    data = _req(1).model_dump(mode="json")
    oversized = base64.b64encode(b"x" * (800 * 1024 + 1)).decode("ascii")
    data["photos"][0]["base64"] = f"data:image/png;base64,{oversized}"

    with pytest.raises(ValidationError):
        V3AnalyzeRequest(**data)


def test_analyze_route_returns_202(captured_callbacks, stage1_order):
    from src.main import app

    client = TestClient(app)
    resp = client.post(
        "/v3/analyze",
        headers={"Authorization": "Bearer test_secret", "X-Request-Id": "req_route"},
        json={
            "requestId": "req_route",
            "albumId": "alb_route",
            "callbackUrl": "http://example.com/cb",
            "language": "en",
            "meta": {"promptHint": "A spring trip"},
            "photos": [
                {
                    "photoId": "p1",
                    "base64": "data:image/jpeg;base64,AA==",
                    "width": 800,
                    "height": 600,
                }
            ],
        },
    )
    assert resp.status_code == 202
    assert resp.json() == {
        "ok": True,
        "data": {"requestId": "req_route", "accepted": True},
    }
    assert any(c["event"] == "completed" for c in captured_callbacks)


def test_analyze_route_can_be_disabled(monkeypatch):
    from src import settings as settings_mod
    from src.main import app

    monkeypatch.setenv("AGENT_ENABLE_ANALYZE", "false")
    settings_mod.reset_settings_cache()

    client = TestClient(app)
    resp = client.post(
        "/v3/analyze",
        headers={"Authorization": "Bearer test_secret", "X-Request-Id": "req_disabled"},
        json={
            "requestId": "req_disabled",
            "albumId": "alb_disabled",
            "callbackUrl": "http://example.com/cb",
            "language": "en",
            "photos": [
                {
                    "photoId": "p1",
                    "base64": "data:image/jpeg;base64,AA==",
                    "width": 800,
                    "height": 600,
                }
            ],
        },
    )

    assert resp.status_code == 503
    body = resp.json()
    error = body.get("detail", body).get("error")
    assert error["message"] == "analyze is disabled on this Agent instance"


def test_analyze_route_rejects_lat_lng_in_exif():
    from src.main import app

    client = TestClient(app)
    resp = client.post(
        "/v3/analyze",
        headers={"Authorization": "Bearer test_secret", "X-Request-Id": "req_gps"},
        json={
            "requestId": "req_gps",
            "albumId": "alb_gps",
            "callbackUrl": "http://example.com/cb",
            "language": "en",
            "photos": [
                {
                    "photoId": "p1",
                    "base64": "data:image/jpeg;base64,AA==",
                    "width": 800,
                    "height": 600,
                    "exif": {"takenAt": "2024-01-01T10:00:00Z", "lat": 35.0, "lng": 139.0},
                }
            ],
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "AGENT_INVALID_INPUT"


def test_analyze_route_requires_auth():
    from src.main import app

    client = TestClient(app)
    resp = client.post(
        "/v3/analyze",
        json={
            "requestId": "req_noauth",
            "albumId": "alb",
            "callbackUrl": "http://example.com/cb",
            "language": "en",
            "photos": [
                {"photoId": "p1", "base64": "data:image/jpeg;base64,AA==", "width": 1, "height": 1}
            ],
        },
    )
    assert resp.status_code == 401
