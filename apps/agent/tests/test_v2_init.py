"""Mock e2e for POST /v2/album/init (W6a + #161).

Exercises the full init job — vision (mock) → deterministic grouping → skeleton
→ first-pass writing (#161) → V2 callback — without hitting any upstream AI,
plus the route-level 202 and the vision-failure path. Acceptance: draftTree
comes out; progress stages are a subset of {vision, grouping, skeleton, writing};
chapters land at state='generated' with page texts; 1 / 2 / 10 / 30 photos all
work (tech-plan §1.1, issues #119/#161)."""

import asyncio
from typing import Any

import pytest
from fastapi.testclient import TestClient

from src.routes import v2_album
from src.schemas_v2 import AlbumDraft, V2InitPhoto, V2InitRequest
from src.services import callback as cb_mod


@pytest.fixture
def captured_callbacks(monkeypatch):
    received: list[dict[str, Any]] = []

    async def fake_post(callback_url: str, envelope: Any) -> bool:
        received.append(envelope.model_dump(exclude_none=True, mode="json"))
        return True

    monkeypatch.setattr(cb_mod, "post", fake_post)
    return received


def _photos(count: int) -> list[V2InitPhoto]:
    # Cluster photos in groups of 3, one cluster per day, so the >6h time-gap
    # split fires between clusters and grouping yields several chapters (and a
    # TOC once chapters>=4 and pages>=8).
    photos: list[V2InitPhoto] = []
    for i in range(count):
        cluster, within = divmod(i, 3)
        day = 1 + cluster
        taken_at = f"2024-01-{day:02d}T10:0{within}:00Z"
        photos.append(
            V2InitPhoto(
                photoId=f"p{i + 1}",
                base64="data:image/jpeg;base64,AAA",
                width=800 if i % 2 == 0 else 600,
                height=600 if i % 2 == 0 else 800,
                exif={"takenAt": taken_at},
            )
        )
    return photos


def _req(count: int, request_id: str = "req_v2_init") -> V2InitRequest:
    return V2InitRequest(
        requestId=request_id,
        albumId="alb_1",
        callbackUrl="http://example.com/cb",
        language="en",
        meta={"promptHint": "A spring trip"},
        photos=_photos(count),
    )


@pytest.mark.parametrize("count", [1, 2, 10, 30])
def test_init_mock_emits_stages_and_draft_tree(captured_callbacks, count):
    asyncio.run(v2_album._run_init(_req(count)))

    events = [c["event"] for c in captured_callbacks]
    assert events.count("completed") == 1, events
    assert events.count("failed") == 0, events

    # Every progress callback is an init job and within the allowed stage set.
    stages = {c["stage"] for c in captured_callbacks if c["event"] == "progress"}
    assert stages, "expected at least one progress callback"
    assert stages <= {"vision", "grouping", "skeleton", "writing"}, stages
    for c in captured_callbacks:
        if c["event"] == "progress":
            assert c["jobKind"] == "init"

    # Each stage resets to 0 before reaching 100.
    by_stage: dict[str, list[int]] = {}
    for c in captured_callbacks:
        if c["event"] == "progress":
            by_stage.setdefault(c["stage"], []).append(c["progress"])
    for stage, ticks in by_stage.items():
        assert ticks[0] == 0, (stage, ticks)
        assert ticks[-1] == 100, (stage, ticks)

    # Stages are emitted in pipeline order: vision → grouping → skeleton → writing.
    first_seen = [c["stage"] for c in captured_callbacks if c["event"] == "progress"]
    ordered_uniques = list(dict.fromkeys(first_seen))
    assert ordered_uniques == ["vision", "grouping", "skeleton", "writing"], ordered_uniques

    completed = next(c for c in captured_callbacks if c["event"] == "completed")
    assert completed["jobKind"] == "init"
    assert completed["requestId"] == "req_v2_init"
    assert completed["usage"]["visionCallCount"] == 0  # mock runs no vision call

    # The draft tree must re-validate against the AlbumDraft contract.
    draft = AlbumDraft(**completed["draftTree"])
    assert draft.version == "v2"
    assert draft.meta.language == "en"
    assert len(draft.photoPool) == count
    assert draft.basePages.cover.templateId
    assert draft.basePages.ending.templateId
    # #161: init now auto-picks a theme and writes the cover copy.
    assert draft.meta.theme is not None
    assert draft.basePages.cover.texts, "cover copy must be written in init"
    assert draft.chapters, "expected at least one chapter"
    for chapter in draft.chapters:
        assert chapter.photoIds, chapter.chapterId
        assert chapter.pages, chapter.chapterId
        # #161: every chapter is written in init and lands at state='generated'.
        assert chapter.state == "generated", chapter.chapterId
        assert any(page.texts for page in chapter.pages), chapter.chapterId


def test_init_groups_many_photos_into_multiple_chapters(captured_callbacks):
    asyncio.run(v2_album._run_init(_req(30)))
    completed = next(c for c in captured_callbacks if c["event"] == "completed")
    draft = AlbumDraft(**completed["draftTree"])
    # 30 photos in clusters of 3 → 10 chapters → TOC present.
    assert len(draft.chapters) >= 4
    assert draft.basePages.toc is not None
    assert draft.basePages.toc.templateId == "mag-02"


def test_init_vision_failure_emits_failed(monkeypatch, captured_callbacks):
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    from src import settings as s

    s.reset_settings_cache()

    async def boom(_req):
        raise v2_album.VisionError("upstream exploded")

    monkeypatch.setattr(v2_album, "vision_analyze", boom)

    try:
        asyncio.run(v2_album._run_init(_req(3)))
    finally:
        s.reset_settings_cache()

    failed = [c for c in captured_callbacks if c["event"] == "failed"]
    assert len(failed) == 1, captured_callbacks
    assert failed[0]["jobKind"] == "init"
    assert failed[0]["error"]["code"] == "AGENT_VISION_FAILED"
    assert failed[0]["stage"] == "vision"
    assert not [c for c in captured_callbacks if c["event"] == "completed"]


def test_init_route_returns_202(captured_callbacks):
    from src.main import app

    client = TestClient(app)
    resp = client.post(
        "/v2/album/init",
        headers={"Authorization": "Bearer test_secret", "X-Request-Id": "req_route"},
        json={
            "requestId": "req_route",
            "albumId": "alb_route",
            "callbackUrl": "http://example.com/cb",
            "language": "en",
            "photos": [
                {
                    "photoId": "p1",
                    "base64": "data:image/jpeg;base64,AAA",
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


def test_init_route_rejects_lat_lng_in_exif(captured_callbacks):
    """D-GPS privacy enforcement: lat/lng in exif is rejected at parse time."""
    from src.main import app

    client = TestClient(app)
    resp = client.post(
        "/v2/album/init",
        headers={"Authorization": "Bearer test_secret", "X-Request-Id": "req_gps"},
        json={
            "requestId": "req_gps",
            "albumId": "alb_gps",
            "callbackUrl": "http://example.com/cb",
            "language": "en",
            "photos": [
                {
                    "photoId": "p1",
                    "base64": "data:image/jpeg;base64,AAA",
                    "width": 800,
                    "height": 600,
                    "exif": {"takenAt": "2024-01-01T10:00:00Z", "lat": 35.0, "lng": 139.0},
                }
            ],
        },
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "AGENT_INVALID_INPUT"


def test_init_route_requires_auth():
    from src.main import app

    client = TestClient(app)
    resp = client.post(
        "/v2/album/init",
        json={
            "requestId": "req_noauth",
            "albumId": "alb",
            "callbackUrl": "http://example.com/cb",
            "language": "en",
            "photos": [
                {"photoId": "p1", "base64": "data:image/jpeg;base64,AAA", "width": 1, "height": 1}
            ],
        },
    )
    assert resp.status_code == 401
