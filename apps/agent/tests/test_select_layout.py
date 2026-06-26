import pytest

from src.flows import select_layout
from src.schemas import SelectLayoutRequest


def _request() -> SelectLayoutRequest:
    return SelectLayoutRequest.model_validate(
        {
            "requestId": "layout-r1",
            "callbackUrl": "https://example.com/api/v3/internal/job-progress",
            "language": "en",
            "chapters": [
                {
                    "chapterId": "ch_1",
                    "structureHint": "coast morning",
                    "photos": [
                        {
                            "photoId": "p1",
                            "ref200px": "data:image/jpeg;base64,AA==",
                            "orientation": "landscape",
                            "takenAt": "2024-03-15T08:30:00",
                        },
                        {
                            "photoId": "p2",
                            "ref200px": "data:image/jpeg;base64,BB==",
                            "orientation": "portrait",
                            "takenAt": None,
                        },
                    ],
                }
            ],
        }
    )


@pytest.mark.asyncio
async def test_select_layout_falls_back_wraps_and_fills_generic_copy(monkeypatch):
    async def fail_gemini(*args, **kwargs):  # noqa: ANN002, ANN003
        raise RuntimeError("Gemini unavailable")

    monkeypatch.setattr(select_layout.gemini_layout, "gemini_layout", fail_gemini)

    pages, usage = await select_layout.select_pages(_request())

    assert [page["pageIndex"] for page in pages] == list(range(len(pages)))
    assert len(pages) >= 3
    assert set(pages[1]["images"].values()) == {"p1", "p2"}
    assert any(value for page in pages for key, value in page["texts"].items() if key == "folio")
    assert usage.geminiCallCount == 0


@pytest.mark.asyncio
async def test_select_layout_completed_callback_contains_pages(monkeypatch):
    events = []

    async def capture_post(url, envelope):  # noqa: ANN001
        events.append(envelope.model_dump(exclude_none=True, mode="json"))

    async def fake_select_pages(req):  # noqa: ANN001
        return (
            [{"pageIndex": 0, "templateId": "mag-08", "images": {"image": "p1"}, "texts": {}}],
            select_layout.V3Usage(durationMs=1, geminiCallCount=0, models=select_layout.V3Models()),
        )

    monkeypatch.setattr(select_layout.callback, "post", capture_post)
    monkeypatch.setattr(select_layout, "select_pages", fake_select_pages)

    await select_layout.run_with_timeout(_request())

    assert [event["event"] for event in events] == ["progress", "progress", "progress", "completed"]
    assert events[0]["jobKind"] == "select-layout"
    assert [event["stage"] for event in events[:-1]] == ["layout", "legalize", "wrap"]
    assert events[-1]["jobKind"] == "select-layout"
    assert events[-1]["pages"] == [
        {"pageIndex": 0, "templateId": "mag-08", "images": {"image": "p1"}, "texts": {}}
    ]
