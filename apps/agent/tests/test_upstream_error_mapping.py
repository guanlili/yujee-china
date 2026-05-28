"""Upstream network failures (AIRequestError) must map to the correct
per-stage error code, not bubble up as AGENT_INTERNAL_ERROR.

Regression for the PR #17 review finding."""

import asyncio

import pytest

from src.schemas import (
    AlbumLayoutPlan,
    ChatEditRequest,
    LayoutRequest,
    Magazine,
    Page,
    PhotoAnalysis,
    PhotoIn,
)
from src.services import ai_client, chat_edit, planning, vision
from src.services.chat_edit import ChatEditError
from src.services.planning import ComposingError, WritingError
from src.services.vision import VisionError


@pytest.fixture(autouse=True)
def _real_keys(monkeypatch):
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    monkeypatch.setenv("ARK_API_KEY", "fake_ark")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "fake_deepseek")
    from src import settings as s
    s.reset_settings_cache()
    yield
    s.reset_settings_cache()


async def _boom(*args, **kwargs):
    raise ai_client.AIRequestError("simulated network exhaustion")


def _photo(pid: str, *, quality: str = "hero", orientation: str = "landscape") -> PhotoAnalysis:
    return PhotoAnalysis(
        photoId=pid, description="d", tags=["t"],
        quality=quality, orientation=orientation,  # type: ignore[arg-type]
        peopleCount="1", scene="outdoor", mood="warm",
    )


def _layout_request() -> LayoutRequest:
    return LayoutRequest(
        requestId="r1", prompt="trip", language="en",
        callbackUrl="http://example.com/cb",
        photos=[
            PhotoIn(photoId="p1", base64="data:image/jpeg;base64,A", width=800, height=600),
            PhotoIn(photoId="p2", base64="data:image/jpeg;base64,B", width=600, height=800),
            PhotoIn(photoId="p3", base64="data:image/jpeg;base64,C", width=800, height=800),
        ],
    )


def _chat_request() -> ChatEditRequest:
    layout = AlbumLayoutPlan(
        magazine=Magazine(title="T", style="warm-film", language="en"),
        photos=[_photo("p1")],
        pages=[Page(pageIndex=0, templateId="mag-13", images={"image": "p1"}, texts={})],
    )
    return ChatEditRequest(
        albumId="alb1", currentLayout=layout, history=[],
        userMessage="make it warmer", language="en",
    )


def test_vision_network_failure_maps_to_vision_error(monkeypatch):
    monkeypatch.setattr(ai_client, "chat_completion", _boom)
    with pytest.raises(VisionError):
        asyncio.run(vision.analyze(_layout_request()))


def test_writing_network_failure_maps_to_writing_error(monkeypatch):
    monkeypatch.setattr(ai_client, "chat_completion", _boom)
    with pytest.raises(WritingError):
        asyncio.run(
            planning.write_magazine(prompt="trip", photos=[_photo("p1")], language="en")
        )


def test_composing_network_failure_maps_to_composing_error(monkeypatch):
    monkeypatch.setattr(ai_client, "chat_completion", _boom)
    mag = Magazine(title="T", style="warm-film", language="en")
    with pytest.raises(ComposingError):
        asyncio.run(planning.compose_pages(magazine=mag, photos=[_photo("p1")]))


def test_chat_edit_network_failure_maps_to_chat_error(monkeypatch):
    monkeypatch.setattr(ai_client, "chat_completion", _boom)
    with pytest.raises(ChatEditError):
        asyncio.run(chat_edit.run(_chat_request()))


def test_pipeline_real_vision_failure_emits_vision_failed_code(monkeypatch):
    """End-to-end: AIRequestError in the first stage → failed callback with
    code AGENT_VISION_FAILED (not AGENT_INTERNAL_ERROR)."""
    monkeypatch.setattr(ai_client, "chat_completion", _boom)

    received = []

    async def fake_post(url, envelope):
        received.append(envelope.model_dump(exclude_none=True, mode="json"))
        return True

    from src.services import callback as cb_mod
    from src.services import pipeline

    monkeypatch.setattr(cb_mod, "post", fake_post)
    asyncio.run(pipeline.run(_layout_request()))

    failed = [c for c in received if c["event"] == "failed"]
    assert len(failed) == 1
    assert failed[0]["error"]["code"] == "AGENT_VISION_FAILED"
    # A progress callback for vision must precede the failure (design.md §6).
    assert received[0]["event"] == "progress"
    assert received[0]["stage"] == "vision"
