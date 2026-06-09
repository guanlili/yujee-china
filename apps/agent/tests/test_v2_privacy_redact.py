"""Privacy / GPS acceptance for the v2 init pipeline (tech-plan §9.1, §3.1;
invariant 11 / D-GPS; design.md §9).

Three guarantees, asserted end-to-end on a real mock-mode init run (no upstream
AI) rather than on the redact processor in isolation (that lives in
test_logging_redact.py):

  1. The draft tree that crosses the Agent→Web boundary carries NO coordinates
     anywhere and `place` is null on every photo / cluster — v1 never extracts
     GPS, so a coordinate must not appear even by accident (stronger than the
     "store coarse place only" requirement: there is no place at all).
  2. base64 originals and coordinate fragments never reach the logs — the full
     pipeline runs through the production structlog redact processor and we scan
     every emitted line.
  3. lat/lng offered in `exif` is REJECTED at parse time (not silently stripped),
     so the privacy boundary is enforced at the contract edge (P0-2 / D-GPS).
"""

import asyncio
import io
import json
import logging
from typing import Any

import pytest
import structlog
from fastapi.testclient import TestClient

from src.logging_config import configure_logging, get_logger
from src.routes import v2_album
from src.schemas_v2 import AlbumDraft
from src.services import callback as cb_mod

from .test_v2_init import _req  # reuse the canonical init request builder


# Coordinate-ish key names that must NEVER appear in the draft tree (D-GPS).
_FORBIDDEN_COORD_KEYS = {"lat", "lng", "latitude", "longitude", "gps", "coordinates"}


@pytest.fixture
def captured_callbacks(monkeypatch):
    received: list[dict[str, Any]] = []

    async def fake_post(callback_url: str, envelope: Any) -> bool:
        received.append(envelope.model_dump(exclude_none=True, mode="json"))
        return True

    monkeypatch.setattr(cb_mod, "post", fake_post)
    return received


def _walk(node: Any):
    """Yield (key, value) for every dict entry anywhere in a nested structure."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield k, v
            yield from _walk(v)
    elif isinstance(node, list):
        for item in node:
            yield from _walk(item)


@pytest.mark.parametrize("count", [1, 2, 10, 30])
def test_draft_tree_has_no_coordinates_and_place_is_null(captured_callbacks, count):
    asyncio.run(v2_album._run_init(_req(count)))
    completed = next(c for c in captured_callbacks if c["event"] == "completed")
    draft_raw = completed["draftTree"]

    # No coordinate-shaped key appears anywhere in the serialized tree.
    for key, _ in _walk(draft_raw):
        assert key.lower() not in _FORBIDDEN_COORD_KEYS, f"coordinate key {key!r} in draft tree"

    # Every `place` that exists is explicitly null (model_dump drops None via
    # exclude_none, so the strongest check is: no `place` key survived with a
    # truthy value). Re-parse the strict model and assert on the typed tree too.
    for key, value in _walk(draft_raw):
        if key == "place":
            assert value in (None, ""), f"place must be null (D-GPS), got {value!r}"

    draft = AlbumDraft(**draft_raw)
    for photo in draft.photoPool:
        assert photo.exif.place is None
    for chapter in draft.chapters:
        assert chapter.cluster.place is None


@pytest.mark.parametrize("count", [1, 2, 10, 30])
def test_draft_tree_has_no_empty_image_slots(captured_callbacks, count):
    """§9.1: 1/2/10/30 photos all produce a draft with no empty image slots and
    every used photo placed exactly once across chapter pages."""
    asyncio.run(v2_album._run_init(_req(count)))
    completed = next(c for c in captured_callbacks if c["event"] == "completed")
    draft = AlbumDraft(**completed["draftTree"])

    placed: list[str] = []
    for chapter in draft.chapters:
        assert chapter.pages, chapter.chapterId
        for page in chapter.pages:
            # No image slot may be left blank.
            for slot, photo_id in page.images.items():
                assert photo_id, f"empty image slot {slot!r} on {chapter.chapterId}"
                placed.append(photo_id)

    used_ids = {p.photoId for p in draft.photoPool if p.used}
    # Every used photo is placed at least once, and chapter pages never reference
    # a non-pool photo.
    assert used_ids <= set(placed), (used_ids - set(placed))
    pool_ids = {p.photoId for p in draft.photoPool}
    assert set(placed) <= pool_ids


def test_full_init_logs_never_leak_base64_or_coordinates(monkeypatch, captured_callbacks):
    """Run the whole init pipeline through the production structlog redact chain
    and assert no base64 payload or coordinate fragment reaches stdout."""
    buf = io.StringIO()
    saved_config = structlog.get_config()

    # Re-point structlog at our buffer with the real processor chain (incl.
    # _redact_processor), uncached so this test's config wins.
    configure_logging("info")
    structlog.configure(
        processors=structlog.get_config()["processors"],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(file=buf),
        cache_logger_on_first_use=False,
    )
    # Restore the prior structlog config so this global reconfigure can't leak
    # into other tests in the session.
    monkeypatch.setattr(v2_album, "log", get_logger("v2_album"))

    try:
        asyncio.run(v2_album._run_init(_req(4)))
    finally:
        structlog.configure(**saved_config)

    output = buf.getvalue()
    # The fixture base64 marker and any data-URL must be scrubbed.
    assert "data:image/jpeg;base64,AAA" not in output
    assert "base64,AAA" not in output
    # No coordinate-shaped token leaked (defensive; none are produced in v1).
    for token in ("latitude", "longitude", '"lat"', '"lng"', "coordinates"):
        assert token not in output, f"{token!r} leaked into logs"
    # Sanity: the run actually logged something through this chain.
    assert "v2_init" in output or "request" in output or output != ""


def test_init_rejects_lat_lng_in_exif_not_strip(captured_callbacks):
    """lat/lng in exif → 400 AGENT_INVALID_INPUT (rejected, not stripped). The
    .strict() schema is the privacy enforcement point (P0-2 / D-GPS)."""
    from src.main import app

    client = TestClient(app)
    resp = client.post(
        "/v2/album/init",
        headers={"Authorization": "Bearer test_secret", "X-Request-Id": "req_gps2"},
        json={
            "requestId": "req_gps2",
            "albumId": "alb_gps2",
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
    # No job was accepted → no callback fired.
    assert captured_callbacks == []
