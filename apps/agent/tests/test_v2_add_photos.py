"""Mock e2e for POST /v2/album/add-photos (W11: mid-edit append).

Exercises the add-photos job — vision (mock) → grouping → skeleton chapter pages
ONLY — and asserts it returns new pages + base-5 photo analyses without any
cover/toc/ending. Same async 202 + callback shape as init."""

import asyncio
from typing import Any

import pytest
from fastapi.testclient import TestClient

from src.routes import v2_album
from src.schemas import PhotoAnalysis
from src.schemas_v2 import V2AddPhotosRequest, V2InitPhoto
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
    photos: list[V2InitPhoto] = []
    for i in range(count):
        cluster, within = divmod(i, 3)
        day = 1 + cluster
        photos.append(
            V2InitPhoto(
                photoId=f"new{i + 1}",
                base64="data:image/jpeg;base64,AAA",
                width=800 if i % 2 == 0 else 600,
                height=600 if i % 2 == 0 else 800,
                exif={"takenAt": f"2024-02-{day:02d}T10:0{within}:00Z"},
            )
        )
    return photos


def _req(count: int, request_id: str = "req_v2_add") -> V2AddPhotosRequest:
    return V2AddPhotosRequest(
        requestId=request_id,
        albumId="alb_existing",
        callbackUrl="http://example.com/cb",
        language="en",
        meta={"promptHint": "More from the trip"},
        newPhotos=_photos(count),
    )


@pytest.mark.parametrize("count", [1, 3, 12])
def test_add_emits_stages_and_new_pages(captured_callbacks, count):
    asyncio.run(v2_album._run_add_photos(_req(count)))

    events = [c["event"] for c in captured_callbacks]
    assert events.count("completed") == 1, events
    assert events.count("failed") == 0, events

    stages = {c["stage"] for c in captured_callbacks if c["event"] == "progress"}
    assert stages <= {"vision", "grouping", "skeleton"}, stages
    for c in captured_callbacks:
        if c["event"] == "progress":
            assert c["jobKind"] == "add"

    completed = next(c for c in captured_callbacks if c["event"] == "completed")
    assert completed["jobKind"] == "add"
    assert completed["requestId"] == "req_v2_add"

    # New pages exist and are content pages only (no TOC mag-02).
    # are locally reindexed 0..k.
    new_pages = completed["newPages"]
    assert new_pages, "expected at least one new page"
    assert [p["pageIndex"] for p in new_pages] == list(range(len(new_pages)))
    assert all(p["templateId"] != "mag-02" for p in new_pages)

    # New photo analyses re-validate as the outward-facing 5-field shape.
    assert len(completed["newPhotos"]) == count
    for raw in completed["newPhotos"]:
        analysis = PhotoAnalysis(**raw)
        assert analysis.photoId.startswith("new")
        # Internal expansion fields must be absent (stripped to base-5).
        assert set(raw.keys()) == {"photoId", "description", "tags", "quality", "orientation"}


def test_add_vision_failure_emits_failed(monkeypatch, captured_callbacks):
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    from src import settings as s

    s.reset_settings_cache()

    async def boom(_req):
        raise v2_album.VisionError("upstream exploded")

    monkeypatch.setattr(v2_album, "vision_analyze", boom)
    try:
        asyncio.run(v2_album._run_add_photos(_req(3)))
    finally:
        s.reset_settings_cache()

    failed = [c for c in captured_callbacks if c["event"] == "failed"]
    assert len(failed) == 1, captured_callbacks
    assert failed[0]["jobKind"] == "add"
    assert failed[0]["error"]["code"] == "AGENT_VISION_FAILED"
    assert failed[0]["stage"] == "vision"


def test_add_route_returns_202(captured_callbacks):
    from src.main import app

    client = TestClient(app)
    resp = client.post(
        "/v2/album/add-photos",
        headers={"Authorization": "Bearer test_secret", "X-Request-Id": "req_add_route"},
        json={
            "requestId": "req_add_route",
            "albumId": "alb_route",
            "callbackUrl": "http://example.com/cb",
            "language": "en",
            "newPhotos": [
                {"photoId": "n1", "base64": "data:image/jpeg;base64,AAA", "width": 800, "height": 600}
            ],
        },
    )
    assert resp.status_code == 202
    assert resp.json() == {"ok": True, "data": {"requestId": "req_add_route", "accepted": True}}
    assert any(c["event"] == "completed" for c in captured_callbacks)


def test_add_route_requires_auth():
    from src.main import app

    client = TestClient(app)
    resp = client.post(
        "/v2/album/add-photos",
        json={
            "requestId": "req_noauth",
            "albumId": "alb",
            "callbackUrl": "http://example.com/cb",
            "language": "en",
            "newPhotos": [
                {"photoId": "n1", "base64": "data:image/jpeg;base64,AAA", "width": 1, "height": 1}
            ],
        },
    )
    assert resp.status_code == 401
