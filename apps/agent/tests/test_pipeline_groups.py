import asyncio

from src.schemas import (
    AlbumLayoutPlan,
    LayoutRequest,
    Magazine,
    Page,
    PhotoAnalysis,
    PhotoGroup,
    PhotoIn,
    VisionResult,
)
from src.services import pipeline


def _req() -> LayoutRequest:
    return LayoutRequest(
        requestId="r1",
        prompt="trip",
        language="en",
        callbackUrl="http://example.com/cb",
        photos=[
            PhotoIn(photoId="p1", base64="data:image/jpeg;base64,A", width=800, height=600),
            PhotoIn(photoId="p2", base64="data:image/jpeg;base64,B", width=600, height=800),
        ],
    )


def _photo(pid: str) -> PhotoAnalysis:
    return PhotoAnalysis(
        photoId=pid,
        description="d",
        tags=["t"],
        quality="detail",
        orientation="landscape",
        peopleCount="1",
        scene="outdoor",
        mood="warm",
    )


def test_pipeline_real_passes_groups_to_composing_but_not_writing(monkeypatch):
    photos = [_photo("p1"), _photo("p2")]
    groups = [PhotoGroup(groupId="g1", label="Closing", photoIds=["p2"], role="closing")]
    magazine = Magazine(title="Trip", style="warm-film", language="en")
    seen = {"writing": False, "composing": False}

    async def fake_emit_progress(*args, **kwargs):
        return None

    async def fake_vision(req):
        return VisionResult(photos=photos, groups=groups), 5

    async def fake_write_magazine(*, prompt, photos: list[PhotoAnalysis], language):
        seen["writing"] = True
        assert photos == [_photo("p1"), _photo("p2")]
        return magazine, 2, 3, 0

    async def fake_compose_pages(*, magazine, photos: list[PhotoAnalysis], groups=None):
        seen["composing"] = True
        assert photos == [_photo("p1"), _photo("p2")]
        assert groups == [PhotoGroup(groupId="g1", label="Closing", photoIds=["p2"], role="closing")]
        layout = AlbumLayoutPlan(
            magazine=magazine,
            photos=photos,
            pages=[Page(pageIndex=0, templateId="mag-13", images={"image": "p1"}, texts={})],
        )
        return layout, 7, 11, 0

    monkeypatch.setattr(pipeline, "_emit_progress", fake_emit_progress)
    monkeypatch.setattr(pipeline, "vision_analyze", fake_vision)
    monkeypatch.setattr(pipeline, "write_magazine", fake_write_magazine)
    monkeypatch.setattr(pipeline, "compose_pages", fake_compose_pages)

    layout, usage = asyncio.run(pipeline._run_real(_req()))

    assert seen == {"writing": True, "composing": True}
    assert usage == {"vision_tokens": 5, "planning_tokens": 23}
    assert "groups" not in layout.model_dump()
