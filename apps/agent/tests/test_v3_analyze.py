"""WP1.1 接入骨架 + WP1.3 describe-content e2e for POST /v3/analyze (#180 / #182).

Exercises the async 202 + V3 callback transport: route-level 202
(V3AcceptedResponse), the describe→group→template→preview progress flow, the
completed callback carrying a contract-valid 章节树 + preview pages, the §3
privacy guard (lat/lng rejected at parse), auth, and the failure path that resets
the failing stage (失败可重试不污染 stage).

The describe stage now runs the REAL describe-content recognition call (WP1.3);
these e2e tests mock the recognition model (`vision.describe_content`) with a
deterministic one-chapter-per-photo partition so the transport + contract shapes
stay the assertion focus. describe-content's own unit behavior (partition fusion,
failover) lives in test_vision_groups.py."""

import asyncio
import base64
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from src.flows import analyze
from src.schemas import (
    V3AnalyzeCompleted,
    V3AnalyzeRequest,
    V3Chapter,
    V3ChapterPhoto,
    V3LayoutTree,
)
from src import callback as cb_mod
from src.agents.template_select import handler as select_template
from src.agents.image_understanding import handler as vision


def _orient(w: int, h: int) -> str:
    if w > h:
        return "landscape"
    if h > w:
        return "portrait"
    return "square"


@pytest.fixture(autouse=True)
def _mock_describe_content(monkeypatch):
    """Stand in for the real recognition-model call: one chapter per photo with a
    canned description / sceneDescription, code-filled deterministic attrs. Mirrors
    what vision.describe_content returns so the route's tree/usage assertions hold
    without hitting an LLM."""

    async def fake_describe(photos, *, language, prompt_hint=None):
        chapters = [
            V3Chapter(
                chapterId=f"ch_{i + 1}",
                description=f"Chapter {i + 1}.",
                accentColor=None,
                artFont=None,
                photos=[
                    V3ChapterPhoto(
                        photoId=p.photoId,
                        sceneDescription=f"scene {p.photoId}",
                        width=p.width,
                        height=p.height,
                        orientation=_orient(p.width, p.height),
                        takenAt=p.exif.takenAt if p.exif else None,
                    )
                ],
            )
            for i, p in enumerate(photos)
        ]
        return vision.V3DescribeResult(
            tree=V3LayoutTree(chapters=chapters),
            tokens_billed=18,
            model="gpt-5.5-mini",
            provider="openai",
        )

    monkeypatch.setattr(vision, "describe_content", fake_describe)


@pytest.fixture
def captured_callbacks(monkeypatch):
    received: list[dict[str, Any]] = []

    async def fake_post(callback_url: str, envelope: Any) -> bool:
        # Capture the EXACT wire body the real poster sends (cb_mod._serialize),
        # so the completed-envelope re-validation below tests the true two-end
        # shape — including the required-nullable accentColor/artFont placeholders.
        received.append(cb_mod._serialize(envelope))
        return True

    monkeypatch.setattr(cb_mod, "post", fake_post)
    return received


def _req(count: int, request_id: str = "req_v3_analyze") -> V3AnalyzeRequest:
    photos = []
    for i in range(count):
        photos.append(
                {
                    "photoId": f"p{i + 1}",
                    "base64": "data:image/jpeg;base64,AA==",
                    "width": 800 if i % 2 == 0 else 600,
                    "height": 600 if i % 2 == 0 else 800,
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


@pytest.mark.parametrize("count", [1, 2, 10, 30])
def test_analyze_mock_emits_stages_and_tree(captured_callbacks, count):
    asyncio.run(analyze._run_analyze(analyze._Job(_req(count))))

    events = [c["event"] for c in captured_callbacks]
    assert events.count("completed") == 1, events
    assert events.count("failed") == 0, events

    # Every progress callback is an analyze job within the allowed stage set.
    stages = {c["stage"] for c in captured_callbacks if c["event"] == "progress"}
    assert stages, "expected at least one progress callback"
    assert stages <= {"describe", "group", "template", "preview"}, stages
    for c in captured_callbacks:
        if c["event"] == "progress":
            assert c["jobKind"] == "analyze"

    # Each stage resets to 0 then reaches 100.
    by_stage: dict[str, list[int]] = {}
    for c in captured_callbacks:
        if c["event"] == "progress":
            by_stage.setdefault(c["stage"], []).append(c["progress"])
    for stage, ticks in by_stage.items():
        assert ticks[0] == 0, (stage, ticks)
        assert ticks[-1] == 100, (stage, ticks)

    # Stages emitted in pipeline order.
    first_seen = [c["stage"] for c in captured_callbacks if c["event"] == "progress"]
    ordered_uniques = list(dict.fromkeys(first_seen))
    assert ordered_uniques == ["describe", "group", "template", "preview"], ordered_uniques

    completed = next(c for c in captured_callbacks if c["event"] == "completed")
    assert completed["jobKind"] == "analyze"
    assert completed["requestId"] == "req_v3_analyze"
    # describe-content ran one recognition call (WP1.3); model reported in Usage.
    assert completed["usage"]["visionCallCount"] == 1
    assert completed["usage"]["models"]["vision"] == "gpt-5.5-mini"

    # The completed envelope must re-validate against the V3 contract (two-end
    # shape parity: schemas.py mirrors packages/contracts/src/v3.ts).
    envelope = V3AnalyzeCompleted(**completed)
    tree: V3LayoutTree = envelope.tree
    # 一图一章不跨章 (§4.1): one chapter per photo, each holding exactly that photo.
    assert len(tree.chapters) == count
    photo_ids = [p.photoId for ch in tree.chapters for p in ch.photos]
    assert photo_ids == [f"p{i + 1}" for i in range(count)]
    for chapter in tree.chapters:
        assert len(chapter.photos) == 1
        # accentColor/artFont are null placeholders until the theme stage (§4.1).
        assert chapter.accentColor is None
        assert chapter.artFont is None
    # Preview pages cover every photo and re-validate as flat Page objects.
    assert envelope.pages, "expected at least one preview page"
    placed = [pid for page in envelope.pages for pid in page.images.values()]
    assert sorted(placed) == sorted(f"p{i + 1}" for i in range(count))

    # WP1.5 (#184) preview-state: generic copy is layered onto the pages — every page
    # carries its `folio` page-number decoration (every interior template declares one),
    # zero-padded to the page's 1-based number. The fixture photos all carry a takenAt,
    # so date-bearing templates also expose a `MM/YY` dateNum. User-content slots stay
    # EMPTY (正式文案 comes in the章节故事环节). 全链路:分析→树→套模板→通用文案/色→预览.
    for page in envelope.pages:
        assert page.texts.get("folio") == str(page.pageIndex + 1).zfill(2), page.texts
        if "dateNum" in page.texts:
            assert page.texts["dateNum"] == "01/24", page.texts


def test_analyze_template_failure_resets_stage(monkeypatch, captured_callbacks):
    """A failure during the template stage emits failed with stage='template'
    after resetting that stage's bar to 0 — a retry never inherits a half-filled
    stage (失败可重试不污染 stage)."""

    async def boom(_chapters):
        raise RuntimeError("engine exploded")

    monkeypatch.setattr(select_template, "select_template_pages", boom)

    asyncio.run(analyze._run_analyze(analyze._Job(_req(3))))

    failed = [c for c in captured_callbacks if c["event"] == "failed"]
    assert len(failed) == 1, captured_callbacks
    assert failed[0]["jobKind"] == "analyze"
    assert failed[0]["error"]["code"] == "AGENT_OUTPUT_VALIDATION"
    assert failed[0]["stage"] == "template"
    assert not [c for c in captured_callbacks if c["event"] == "completed"]
    # The failing stage was reset to 0 before the failed callback (last template tick).
    template_ticks = [
        c["progress"]
        for c in captured_callbacks
        if c["event"] == "progress" and c["stage"] == "template"
    ]
    assert template_ticks[-1] == 0, template_ticks


def test_analyze_timeout_resets_the_active_stage(monkeypatch, captured_callbacks):
    """If the background budget expires after a stage has started, the failed
    callback carries that stage and resets it so retry state is clean."""

    async def slow(_job):
        await analyze._emit_progress(_job, "template", 50)
        await asyncio.sleep(0.5)

    class _Budget:
        background_task_timeout_seconds = 0.01

    monkeypatch.setattr(analyze, "_run_analyze", slow)
    monkeypatch.setattr(analyze, "get_settings", lambda: _Budget())

    asyncio.run(analyze.run_with_timeout(_req(2)))

    failed = [c for c in captured_callbacks if c["event"] == "failed"]
    assert len(failed) == 1, captured_callbacks
    assert failed[0]["error"]["code"] == "AGENT_TIMEOUT"
    assert failed[0]["stage"] == "template"
    template_ticks = [
        c["progress"]
        for c in captured_callbacks
        if c["event"] == "progress" and c["stage"] == "template"
    ]
    assert template_ticks == [50, 0], template_ticks


def test_analyze_unhandled_error_resets_the_active_stage(monkeypatch, captured_callbacks):
    """Unexpected errors after progress has started preserve the active stage in
    the terminal failed callback, matching handled stage failures."""

    async def boom(_job):
        await analyze._emit_progress(_job, "preview", 25)
        raise RuntimeError("callback-adjacent boom")

    class _Budget:
        background_task_timeout_seconds = 10

    monkeypatch.setattr(analyze, "_run_analyze", boom)
    monkeypatch.setattr(analyze, "get_settings", lambda: _Budget())

    asyncio.run(analyze.run_with_timeout(_req(2)))

    failed = [c for c in captured_callbacks if c["event"] == "failed"]
    assert len(failed) == 1, captured_callbacks
    assert failed[0]["error"]["code"] == "AGENT_INTERNAL_ERROR"
    assert failed[0]["stage"] == "preview"
    preview_ticks = [
        c["progress"]
        for c in captured_callbacks
        if c["event"] == "progress" and c["stage"] == "preview"
    ]
    assert preview_ticks == [25, 0], preview_ticks


def test_analyze_route_returns_202(captured_callbacks):
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
    # Background task ran the full job and emitted a terminal completed callback.
    assert any(c["event"] == "completed" for c in captured_callbacks)


def test_analyze_route_rejects_lat_lng_in_exif():
    """§3 privacy: lat/lng in exif is rejected at parse time (only takenAt allowed)."""
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
