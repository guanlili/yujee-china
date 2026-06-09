import json

import pytest

from src.schemas_v2 import V2ThemeRequest
from src.services import theme


def _usage_response(payload: dict, prompt_tokens: int = 11, completion_tokens: int = 7):
    return {
        "choices": [{"message": {"content": json.dumps(payload)}}],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
        },
    }


def _theme_req(user_message: str | None = None) -> V2ThemeRequest:
    return V2ThemeRequest(
        albumId="alb_1",
        language="en",
        clustersOverview=[
            {
                "chapterId": "ch_1",
                "label": "spring walks",
                "place": "Osaka",
                "timeRange": "2025-04",
                "photoDescs": [
                    "street food at night",
                    "soft rain on a station platform",
                ],
            }
        ],
        userMessage=user_message,
    )


def test_theme_prompt_uses_cluster_overview_and_json_contract():
    messages = theme.build_messages(_theme_req("make it nostalgic"))

    assert messages[0]["role"] == "system"
    assert "V2ThemeResponse" in messages[0]["content"]
    assert "warm-film" in messages[0]["content"]
    assert "spring walks" in messages[1]["content"]
    assert "soft rain on a station platform" in messages[1]["content"]
    assert "make it nostalgic" in messages[1]["content"]
    assert "base64" not in messages[1]["content"].lower()


@pytest.mark.asyncio
async def test_theme_run_returns_valid_theme_and_cover_draft():
    async def fake_complete(**_kwargs):
        return _usage_response(
            {
                "theme": {
                    "subject": "Rainy spring walks",
                    "occasion": "a quiet trip",
                    "timeframe": "2025-04",
                    "tone": "nostalgic and warm",
                    "style": "warm-film",
                },
                "cover": {
                    "templateId": "mag-20",
                    "texts": {"title": "Rainy spring walks", "subtitle": "small moments"},
                    "heroPhotoId": None,
                },
                "assistantReply": "I set a warm, nostalgic direction.",
            }
        )

    res = await theme.run(_theme_req(), complete=fake_complete)

    assert res.theme.subject == "Rainy spring walks"
    assert res.theme.style == "warm-film"
    assert res.cover is not None
    assert res.cover.templateId == "mag-20"
    assert res.cover.texts["title"] == "Rainy spring walks"
    assert res.cover.heroPhotoId is None
    assert res.usage.planningInputTokens == 11
    assert res.usage.planningOutputTokens == 7
    assert res.usage.models.planning == "deepseek-chat"


@pytest.mark.asyncio
async def test_theme_run_repairs_invalid_style_and_missing_cover_texts():
    async def fake_complete(**_kwargs):
        return _usage_response(
            {
                "theme": {
                    "subject": "Station evenings",
                    "tone": "quiet",
                    "style": "not-a-style",
                },
                "cover": {
                    "templateId": "unknown-cover",
                    "texts": {},
                    "heroPhotoId": "p-from-model",
                },
                "assistantReply": "",
            }
        )

    res = await theme.run(_theme_req(), complete=fake_complete)

    assert res.theme.subject == "Station evenings"
    assert res.theme.style == "warm-film"
    assert res.cover is not None
    assert res.cover.templateId == "mag-20"
    assert res.cover.texts["title"] == "Station evenings"
    assert res.assistantReply


@pytest.mark.asyncio
async def test_theme_cover_uses_text_only_when_hero_photo_id_cannot_be_verified():
    async def fake_complete(**_kwargs):
        return _usage_response(
            {
                "theme": {
                    "subject": "Unverified hero",
                    "tone": "warm",
                    "style": "warm-film",
                },
                "cover": {
                    "templateId": "mag-13",
                    "texts": {"title": "Unverified hero"},
                    "heroPhotoId": "p-from-model",
                },
                "assistantReply": "I drafted a cover.",
            }
        )

    res = await theme.run(_theme_req(), complete=fake_complete)

    assert res.cover is not None
    assert res.cover.templateId == "mag-20"
    assert res.cover.heroPhotoId is None
