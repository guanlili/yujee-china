import asyncio
import json
from types import SimpleNamespace

import pytest

from src import settings as settings_module
from src.workflows.core.layout import select_layout as select_layout_agent
from src.workflows.core.layout.select_layout import handler as select_layout_handler
from src.workflows.core.layout import legalize, skeleton_v3, template_previews, templates
from src.contracts.schemas import V3Chapter, V3ChapterPhoto


def _chapter(photo_ids: list[str]) -> V3Chapter:
    return V3Chapter(
        chapterId="ch_1",
        description="A quiet coast morning",
        accentColor=None,
        artFont=None,
        photos=[
            V3ChapterPhoto(
                photoId=pid,
                sceneDescription=f"scene {pid}",
                width=800,
                height=600,
                orientation="landscape",
                takenAt="2024-03-15T08:30:00" if idx == 0 else None,
            )
            for idx, pid in enumerate(photo_ids)
        ],
    )


def _interior_template_with_capacity(capacity: int) -> str:
    ids = skeleton_v3.candidate_ids("interior", capacity)
    if not ids:
        pytest.skip(f"template registry has no interior capacity {capacity}")
    return ids[0]


def test_template_previews_are_complete_for_interior_templates():
    previews = template_previews.load_template_previews()
    interior_ids = {
        template_id
        for template_id, template in templates.TEMPLATES.items()
        if template["category"] == "interior"
    }

    assert interior_ids.issubset(previews.by_template.keys())
    for capacity in skeleton_v3.POOLS.get("interior", {}):
        assert ("interior", capacity) in previews.bucket_images


def test_build_candidates_uses_capacity_buckets_not_caller_candidates():
    candidates = legalize.build_candidate_catalog("interior", max_photo_count=2)
    assert candidates
    assert {candidate["imageSlotCount"] for candidate in candidates}.issubset({1, 2})
    assert all("previewImage" in candidate for candidate in candidates)


def test_gemini_layout_preserves_legal_slot_mapping():
    chapter = _chapter(["p1", "p2"])
    template_id = _interior_template_with_capacity(2)
    slot_a, slot_b = skeleton_v3.image_slot_keys(templates.TEMPLATES[template_id])[:2]

    pages = legalize.legalize_layout(
        [chapter],
        [
            {
                "chapterId": "ch_1",
                "templateId": template_id,
                "slots": {slot_a: "p2", slot_b: "p1"},
            }
        ],
    )

    assert len(pages) == 1
    assert pages[0]["templateId"] == template_id
    assert pages[0]["images"] == {slot_a: "p2", slot_b: "p1"}


def test_gemini_layout_falls_back_only_for_illegal_or_missing_slots():
    chapter = _chapter(["p1", "p2"])
    template_id = _interior_template_with_capacity(2)
    slot_a = skeleton_v3.image_slot_keys(templates.TEMPLATES[template_id])[0]

    pages = legalize.legalize_layout(
        [chapter],
        [
            {
                "chapterId": "ch_1",
                "templateId": template_id,
                "slots": {slot_a: "p1"},
            }
        ],
    )

    # 非法 slot => fallback 重排(填满式随机拆分,页数不定但照片不重不漏)。
    all_ids = sorted(pid for p in pages for pid in p["images"].values())
    assert all_ids == ["p1", "p2"]


def test_gemini_layout_accepts_case4_swap_mode_without_rejecting(monkeypatch):
    monkeypatch.setattr(
        settings_module.get_settings(), "select_layout_api_key", None, raising=False
    )

    with pytest.raises(select_layout_agent.GeminiLayoutUnavailable):
        asyncio.run(
            select_layout_agent.gemini_layout(
                [_chapter(["p1"])], mode="case4-swap", allowAddPages=True
            )
        )


@pytest.mark.asyncio
async def test_gemini_layout_uses_native_generate_content(monkeypatch):
    settings = settings_module.get_settings()
    monkeypatch.setattr(settings, "select_layout_api_key", "gemini-key", raising=False)
    monkeypatch.setattr(settings, "select_layout_model", "gemini-2.5-flash", raising=False)
    monkeypatch.setattr(settings, "select_layout_timeout_seconds", 12, raising=False)
    monkeypatch.setattr(settings, "select_layout_max_output_tokens", 1024, raising=False)
    monkeypatch.setattr(settings, "select_layout_disable_thinking", True, raising=False)

    template_id = _interior_template_with_capacity(1)
    slot = skeleton_v3.image_slot_keys(templates.TEMPLATES[template_id])[0]
    captured = {}

    async def old_openai_path(**kwargs):  # noqa: ANN003
        raise AssertionError("select-layout Gemini must use native generateContent")

    class FakeResponse:
        status_code = 200
        text = "{}"

        def json(self):
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": json.dumps(
                                        {
                                            "pages": [
                                                {
                                                    "chapterId": "ch_1",
                                                    "templateId": template_id,
                                                    "slots": {slot: "1"},
                                                }
                                            ]
                                        }
                                    )
                                }
                            ]
                        }
                    }
                ],
                "usageMetadata": {
                    "promptTokenCount": 11,
                    "candidatesTokenCount": 3,
                },
            }

    class FakeAsyncClient:
        def __init__(self, *, timeout):
            captured["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):  # noqa: ANN001
            return False

        async def post(self, url, *, params, json, headers):  # noqa: ANN001
            captured["url"] = url
            captured["params"] = params
            captured["body"] = json
            captured["headers"] = headers
            return FakeResponse()

    monkeypatch.setattr(select_layout_handler.ai_client, "chat_completion", old_openai_path)
    monkeypatch.setattr(
        select_layout_handler,
        "httpx",
        SimpleNamespace(AsyncClient=FakeAsyncClient),
        raising=False,
    )

    result = await select_layout_agent.gemini_layout(
        [
            {
                "chapterId": "ch_1",
                "structureHint": "coast morning",
                "photos": [
                    {
                        "photoId": "p1",
                        "ref200px": "data:image/jpeg;base64,AA==",
                        "orientation": "landscape",
                        "takenAt": None,
                    }
                ],
            }
        ]
    )

    assert captured["url"] == (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        "gemini-2.5-flash:generateContent"
    )
    assert captured["params"] == {"key": "gemini-key"}
    assert captured["headers"] == {"Content-Type": "application/json"}
    assert captured["timeout"] == 12
    assert captured["body"]["generationConfig"] == {
        "temperature": 0.1,
        "response_mime_type": "application/json",
        "maxOutputTokens": 1024,
        "thinkingConfig": {"thinkingBudget": 0},
    }
    parts = captured["body"]["contents"][0]["parts"]
    assert parts[1] == {"inline_data": {"mime_type": "image/jpeg", "data": "AA=="}}
    assert result.pages == [{"chapterId": "ch_1", "templateId": template_id, "slots": {slot: "p1"}}]
    assert result.input_tokens == 11
    assert result.output_tokens == 3
