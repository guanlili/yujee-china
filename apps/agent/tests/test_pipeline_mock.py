"""Smoke tests for the mock pipeline branch — exercises the orchestrator
without hitting any upstream AI."""

import asyncio
import json
from typing import Any

import pytest

from src.schemas import LayoutRequest, Magazine, PhotoAnalysis, PhotoIn
from src.services import ai_client, planning
from src.services import callback as cb_mod
from src.services import pipeline


@pytest.fixture
def captured_callbacks(monkeypatch):
    received: list[dict[str, Any]] = []

    async def fake_post(callback_url: str, envelope: Any) -> bool:
        received.append(envelope.model_dump(exclude_none=True, mode="json"))
        return True

    monkeypatch.setattr(cb_mod, "post", fake_post)
    return received


def _req(prompt: str = "A spring day in Kyoto") -> LayoutRequest:
    return LayoutRequest(
        requestId="req_test",
        prompt=prompt,
        language="en",
        callbackUrl="http://example.com/cb",
        photos=[
            PhotoIn(photoId="p1", base64="data:image/jpeg;base64,AAA", width=800, height=600),
            PhotoIn(photoId="p2", base64="data:image/jpeg;base64,BBB", width=600, height=800),
            PhotoIn(photoId="p3", base64="data:image/jpeg;base64,CCC", width=800, height=800),
        ],
    )


def test_mock_pipeline_emits_progress_and_completed(captured_callbacks):
    asyncio.run(pipeline.run(_req()))

    events = [c["event"] for c in captured_callbacks]
    assert events.count("progress") >= 9, events
    assert events.count("completed") == 1
    assert events.count("failed") == 0

    # Progress order: each stage hits 0 before 100
    by_stage: dict[str, list[int]] = {}
    for env in captured_callbacks:
        if env["event"] != "progress":
            continue
        by_stage.setdefault(env["stage"], []).append(env["progress"])
    for stage, ticks in by_stage.items():
        assert ticks[0] == 0, (stage, ticks)
        assert ticks[-1] == 100, (stage, ticks)

    completed = next(c for c in captured_callbacks if c["event"] == "completed")
    assert completed["layout"]["magazine"]["language"] == "en"
    assert len(completed["layout"]["pages"]) == 3
    assert "usage" in completed and "durationMs" in completed["usage"]


def test_forced_failure_emits_progress_before_failed(captured_callbacks):
    asyncio.run(pipeline.run(_req(prompt="FAIL_TEST")))

    events = [c["event"] for c in captured_callbacks]
    # Must see a progress on vision before the failed envelope.
    assert events[0] == "progress"
    assert captured_callbacks[0]["stage"] == "vision"
    assert events.count("failed") == 1
    failed = next(c for c in captured_callbacks if c["event"] == "failed")
    assert failed["error"]["code"] == "AGENT_VISION_FAILED"


def test_completed_layout_serializable(captured_callbacks):
    asyncio.run(pipeline.run(_req()))
    completed = next(c for c in captured_callbacks if c["event"] == "completed")
    # Round-trip must produce valid JSON (no exotic types from Pydantic).
    json.dumps(completed)


def _req_single(prompt: str = "A quiet afternoon") -> LayoutRequest:
    """architecture §6.5 decision 6 — a single-photo request must run end to end."""
    return LayoutRequest(
        requestId="req_single",
        prompt=prompt,
        language="en",
        callbackUrl="http://example.com/cb",
        photos=[
            PhotoIn(photoId="p1", base64="data:image/jpeg;base64,AAA", width=800, height=600),
        ],
    )


def test_single_photo_pipeline_completes_with_valid_layout(captured_callbacks):
    from src.schemas import AlbumLayoutPlan
    from src.services import layout_rules

    asyncio.run(pipeline.run(_req_single()))

    events = [c["event"] for c in captured_callbacks]
    assert events.count("completed") == 1
    assert events.count("failed") == 0

    completed = next(c for c in captured_callbacks if c["event"] == "completed")
    layout = AlbumLayoutPlan.model_validate(completed["layout"])
    assert layout_rules.violation(layout) is None
    # the user's only photo must appear in the album
    used = {pid for page in layout.pages for pid in page.images.values()}
    assert "p1" in used


def _photo(pid: str, *, quality: str = "detail", orientation: str = "landscape") -> PhotoAnalysis:
    return PhotoAnalysis(
        photoId=pid,
        description="d",
        tags=["t"],
        quality=quality,  # type: ignore[arg-type]
        orientation=orientation,  # type: ignore[arg-type]
        peopleCount="1",
        scene="outdoor",
        mood="warm",
    )


def test_composing_normalizes_17_pages_before_album_schema(monkeypatch):
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "fake_deepseek")
    from src import settings as s

    s.reset_settings_cache()

    pages = [
        {"pageIndex": i, "templateId": "mag-02", "images": {}, "texts": {"items": f"page {i}"}}
        for i in range(17)
    ]
    pages[0] = {
        "pageIndex": 0,
        "templateId": "mag-13",
        "images": {"image": "p1"},
        "texts": {
            "title": "Trip",
            "intro": "d",
            "issue": "YUJEE 01",
            "credit": "AI ARRANGED",
        },
    }
    pages[1] = {"pageIndex": 1, "templateId": "mag-05", "images": {"image": "p2"}, "texts": {}}
    pages[2] = {"pageIndex": 2, "templateId": "mag-05", "images": {"image": "p3"}, "texts": {}}

    async def fake_completion(*args, **kwargs):
        return {"choices": [{"message": {"content": json.dumps({"pages": pages})}}], "usage": {}}

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    mag = Magazine(title="Trip", style="warm-film", language="en")
    photos = [
        _photo("p1", quality="hero", orientation="landscape"),
        _photo("p2", quality="detail", orientation="landscape"),
        _photo("p3", quality="detail", orientation="landscape"),
    ]
    layout, _, _, _ = asyncio.run(planning.compose_pages(magazine=mag, photos=photos))

    assert len(layout.pages) == 16
    assert [page.pageIndex for page in layout.pages] == list(range(16))

    s.reset_settings_cache()
