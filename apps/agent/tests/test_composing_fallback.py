"""compose_pages few-photo fallback (architecture §6.5 decision 6).

When the model can't compose a valid album for 1-2 photos even after the repair
budget, compose_pages must not fail the job — it builds the deterministic
text-first layout instead. A network failure stays terminal (separate path);
this covers the "model returned parseable but invalid output" case."""

import asyncio
import json

import pytest

from src.schemas import Magazine, PhotoAnalysis
from src.services import ai_client, planning
from src.services.layout_rules import violation


@pytest.fixture(autouse=True)
def _real_keys(monkeypatch):
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    monkeypatch.setenv("ARK_API_KEY", "fake_ark")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "fake_deepseek")
    from src import settings as s

    s.reset_settings_cache()
    yield
    s.reset_settings_cache()


def _photo(pid: str, *, quality: str = "hero", orientation: str = "landscape") -> PhotoAnalysis:
    return PhotoAnalysis(
        photoId=pid, description="d", tags=["t"],
        quality=quality, orientation=orientation,  # type: ignore[arg-type]
        peopleCount="1", scene="outdoor", mood="warm",
    )


def _fake_completion(content: str):
    async def fake(*args, **kwargs):
        return {"choices": [{"message": {"content": content}}], "usage": {}}

    return fake


def test_single_photo_invalid_model_output_falls_back(monkeypatch):
    # Structurally invalid (only 1 page, < the 3-page target). The model repeats
    # it on repair, so the model path is exhausted and the few-photo fallback runs.
    bad = json.dumps(
        {"pages": [{"pageIndex": 0, "templateId": "mag-02", "images": {}, "texts": {"items": "x"}}]}
    )
    monkeypatch.setattr(ai_client, "chat_completion", _fake_completion(bad))

    mag = Magazine(title="A quiet afternoon", style="warm-film", language="en")
    layout, _, _, _ = asyncio.run(planning.compose_pages(magazine=mag, photos=[_photo("p1")]))

    assert violation(layout) is None
    assert len(layout.pages) == 3
    used = {pid for page in layout.pages for pid in page.images.values()}
    assert "p1" in used


def test_two_photos_invalid_model_output_falls_back(monkeypatch):
    bad = json.dumps({"pages": [{"pageIndex": 0, "templateId": "not-a-template", "images": {}, "texts": {}}]})
    monkeypatch.setattr(ai_client, "chat_completion", _fake_completion(bad))

    mag = Magazine(title="Two moments", style="warm-film", language="en")
    photos = [
        _photo("p1", quality="fill", orientation="landscape"),  # relaxed to detail
        _photo("p2", quality="detail", orientation="portrait"),
    ]
    layout, _, _, _ = asyncio.run(planning.compose_pages(magazine=mag, photos=photos))

    assert violation(layout) is None
    used = {pid for page in layout.pages for pid in page.images.values()}
    assert used == {"p1", "p2"}


def test_three_photos_invalid_output_still_raises(monkeypatch):
    # Above the few-photo threshold: a structurally invalid layout that coerce
    # can't fix must still fail (no text-first fallback for normal albums).
    bad = json.dumps(
        {"pages": [{"pageIndex": 0, "templateId": "mag-02", "images": {}, "texts": {"items": "x"}}]}
    )
    monkeypatch.setattr(ai_client, "chat_completion", _fake_completion(bad))

    mag = Magazine(title="Trip", style="warm-film", language="en")
    photos = [_photo("p1"), _photo("p2", orientation="portrait"), _photo("p3", orientation="square")]
    with pytest.raises(planning.ComposingError):
        asyncio.run(planning.compose_pages(magazine=mag, photos=photos))
