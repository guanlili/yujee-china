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


def _multi_request(chapters: list[dict]) -> SelectLayoutRequest:
    return SelectLayoutRequest.model_validate(
        {
            "requestId": "layout-r1",
            "callbackUrl": "https://example.com/api/v3/internal/job-progress",
            "language": "en",
            "chapters": chapters,
        }
    )


def _chapter(chapter_id: str, photo_ids: list[str]) -> dict:
    return {
        "chapterId": chapter_id,
        "structureHint": f"story {chapter_id}",
        "photos": [
            {
                "photoId": photo_id,
                "ref200px": f"data:image/jpeg;base64,{idx + 1}A==",
                "orientation": "landscape",
                "takenAt": None,
            }
            for idx, photo_id in enumerate(photo_ids)
        ],
    }


def _interior_template_with_capacity(capacity: int) -> str:
    ids = select_layout.skeleton_v3.candidate_ids("interior", capacity)
    if not ids:
        pytest.skip(f"template registry has no interior capacity {capacity}")
    return ids[0]


def _raw_page_for_chapter(chapter) -> dict:  # noqa: ANN001
    photos = list(chapter.photos)
    template_id = _interior_template_with_capacity(len(photos))
    slots = select_layout.skeleton_v3.image_slot_keys(
        select_layout.gemini_layout.templates.TEMPLATES[template_id]
    )
    return {
        "chapterId": chapter.chapterId,
        "templateId": template_id,
        "slots": {slot: photo.photoId for slot, photo in zip(slots, reversed(photos), strict=True)},
    }


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


@pytest.mark.asyncio
async def test_select_layout_batches_chapters_by_max_images_per_batch(monkeypatch):
    settings = select_layout.get_settings()
    monkeypatch.setattr(settings, "select_layout_max_images_per_batch", 2)
    monkeypatch.setattr(settings, "select_layout_max_concurrency", 1)
    calls: list[list[str]] = []

    async def fake_gemini(chapters, **kwargs):  # noqa: ANN001, ANN003
        calls.append([chapter.chapterId for chapter in chapters])
        return select_layout.gemini_layout.GeminiLayoutResult(
            pages=[_raw_page_for_chapter(chapter) for chapter in chapters],
            call_count=1,
            model="gemini-test",
            input_tokens=10,
            output_tokens=2,
        )

    monkeypatch.setattr(select_layout.gemini_layout, "gemini_layout", fake_gemini)

    await select_layout.select_pages(
        _multi_request(
            [
                _chapter("ch_1", ["p1"]),
                _chapter("ch_2", ["p2"]),
                _chapter("ch_3", ["p3"]),
            ]
        )
    )

    assert calls == [["ch_1", "ch_2"], ["ch_3"]]


@pytest.mark.asyncio
async def test_select_layout_fallbacks_only_the_failed_batch(monkeypatch):
    settings = select_layout.get_settings()
    monkeypatch.setattr(settings, "select_layout_max_images_per_batch", 1)
    monkeypatch.setattr(settings, "select_layout_max_concurrency", 2)

    async def fake_gemini(chapters, **kwargs):  # noqa: ANN001, ANN003
        if [chapter.chapterId for chapter in chapters] == ["ch_2"]:
            raise RuntimeError("batch failed")
        return select_layout.gemini_layout.GeminiLayoutResult(
            pages=[_raw_page_for_chapter(chapter) for chapter in chapters],
            call_count=1,
            model="gemini-ok",
            input_tokens=10,
            output_tokens=2,
        )

    monkeypatch.setattr(select_layout.gemini_layout, "gemini_layout", fake_gemini)

    pages, usage = await select_layout.select_pages(
        _multi_request(
            [
                _chapter("ch_1", ["p1"]),
                _chapter("ch_2", ["p2"]),
                _chapter("ch_3", ["p3"]),
            ]
        )
    )

    assert any(set(page["images"].values()) == {"p1"} for page in pages)
    assert any(set(page["images"].values()) == {"p2"} for page in pages)
    assert any(set(page["images"].values()) == {"p3"} for page in pages)
    assert usage.geminiCallCount == 2
    assert usage.planningInputTokens == 20
    assert usage.planningOutputTokens == 4
    assert usage.models.planning == "gemini-ok"


@pytest.mark.asyncio
async def test_select_layout_splits_a_single_oversized_chapter_by_max_images_per_batch(
    monkeypatch,
):
    settings = select_layout.get_settings()
    monkeypatch.setattr(settings, "select_layout_max_images_per_batch", 2)
    monkeypatch.setattr(settings, "select_layout_max_concurrency", 1)
    calls: list[list[str]] = []

    async def fake_gemini(chapters, **kwargs):  # noqa: ANN001, ANN003
        assert len(chapters) == 1
        calls.append([photo.photoId for photo in chapters[0].photos])
        return select_layout.gemini_layout.GeminiLayoutResult(
            pages=[_raw_page_for_chapter(chapters[0])],
            call_count=1,
            model="gemini-test",
            input_tokens=1,
            output_tokens=1,
        )

    monkeypatch.setattr(select_layout.gemini_layout, "gemini_layout", fake_gemini)

    await select_layout.select_pages(
        _multi_request([_chapter("ch_big", ["p1", "p2", "p3", "p4", "p5"])])
    )

    assert calls == [["p1", "p2"], ["p3", "p4"], ["p5"]]
