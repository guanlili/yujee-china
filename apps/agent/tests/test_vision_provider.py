"""Vision provider-slot switching (#166).

Covers `select_vision_slot` wiring for both slots and, end-to-end through
`vision.analyze` / `inspect_render.diagnose`, asserts that:
  * the ark (doubao) slot still sends `thinking` disabled (no regression);
  * the openai slot sends NO `thinking`/doubao extra_body and DOES request a
    json_object response_format;
  * a missing key for the chosen slot fails the right way per caller (vision
    raises VisionError; inspect degrades gracefully).
No live network — `ai_client.chat_completion` is monkeypatched and the call
kwargs are captured for assertion.
"""

import asyncio
import json
from typing import Any

import pytest

from src.schemas import LayoutRequest, PhotoIn, VisionResult
from src.schemas_v2 import V2InspectRequest
from src.services import ai_client, inspect_render, vision
from src.services.vision_provider import (
    VisionSlotError,
    estimate_cost_usd,
    resolved_vision_model,
    select_vision_slot,
)


@pytest.fixture
def _real_env(monkeypatch):
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    from src import settings as s

    def _apply(**env):
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        s.reset_settings_cache()
        return s.get_settings()

    yield _apply
    s.reset_settings_cache()


def _req(count: int = 2) -> LayoutRequest:
    return LayoutRequest(
        requestId="r1",
        prompt="a family trip",
        language="en",
        callbackUrl="http://example.com/cb",
        photos=[
            PhotoIn(
                photoId=f"p{i + 1}",
                base64=f"data:image/jpeg;base64,{i}",
                width=800,
                height=600,
            )
            for i in range(count)
        ],
    )


def _photo_payload(idx: int) -> dict[str, Any]:
    return {
        "description": f"Photo {idx}",
        "tags": ["memoir", "trip"],
        "quality": "detail",
        "orientation": "landscape",
        "peopleCount": "1",
        "scene": "outdoor",
        "mood": "warm",
        "timeOfDay": "day",
        "location": None,
    }


def _capture(captured: dict):
    async def fake_completion(**kwargs):
        captured.update(kwargs)
        payload = {"photos": [_photo_payload(i) for i in range(1, 3)], "groups": []}
        return {
            "choices": [{"message": {"content": json.dumps(payload)}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50},
        }

    return fake_completion


# ---- select_vision_slot -----------------------------------------------------


def test_select_slot_ark_default_carries_thinking(_real_env):
    settings = _real_env(ARK_API_KEY="fake_ark")
    slot = select_vision_slot(settings)
    assert slot.provider == "ark"
    assert slot.base_url == settings.ark_base_url
    assert slot.api_key == "fake_ark"
    assert slot.model == settings.ark_vision_model
    assert slot.extra_body == {"thinking": {"type": "disabled"}}
    assert slot.response_format is None  # doubao 400s on json_object


def test_select_slot_openai_has_no_thinking_and_json_object(_real_env):
    settings = _real_env(VISION_PROVIDER="openai", OPENAI_API_KEY="fake_oai")
    slot = select_vision_slot(settings)
    assert slot.provider == "openai"
    assert slot.base_url == "https://api.openai.com/v1"
    assert slot.api_key == "fake_oai"
    assert slot.model == "gpt-4o-mini"
    assert slot.extra_body is None  # CRITICAL: never send doubao `thinking` to OpenAI
    assert slot.response_format == {"type": "json_object"}


def test_select_slot_ark_no_thinking_when_disabled_off(_real_env):
    settings = _real_env(ARK_API_KEY="fake_ark", ARK_DISABLE_THINKING="false")
    assert select_vision_slot(settings).extra_body is None


def test_select_slot_openai_missing_key_raises(_real_env):
    settings = _real_env(VISION_PROVIDER="openai")
    with pytest.raises(VisionSlotError):
        select_vision_slot(settings)


def test_select_slot_ark_missing_key_raises(_real_env):
    settings = _real_env()  # no ARK_API_KEY
    with pytest.raises(VisionSlotError):
        select_vision_slot(settings)


def test_resolved_vision_model_tracks_provider_without_key(_real_env):
    # No keys set: resolved_vision_model must still return the provider's model
    # (startup logging uses it before keys are validated).
    assert resolved_vision_model(_real_env()) == "doubao-seed-1-6-vision-250815"
    assert resolved_vision_model(_real_env(VISION_PROVIDER="openai")) == "gpt-4o-mini"


# ---- vision.analyze through each slot ---------------------------------------


def test_vision_analyze_ark_sends_thinking(_real_env, monkeypatch):
    _real_env(ARK_API_KEY="fake_ark")
    captured: dict = {}
    monkeypatch.setattr(ai_client, "chat_completion", _capture(captured))

    result, tokens, model = asyncio.run(vision.analyze(_req()))

    assert isinstance(result, VisionResult)
    assert tokens == 150
    assert model == "doubao-seed-1-6-vision-250815"
    assert captured["extra_body"] == {"thinking": {"type": "disabled"}}
    assert captured["response_format"] is None
    assert captured["model"] == "doubao-seed-1-6-vision-250815"


def test_vision_analyze_openai_omits_thinking(_real_env, monkeypatch):
    _real_env(VISION_PROVIDER="openai", OPENAI_API_KEY="fake_oai")
    captured: dict = {}
    monkeypatch.setattr(ai_client, "chat_completion", _capture(captured))

    result, _, model = asyncio.run(vision.analyze(_req()))

    assert isinstance(result, VisionResult)
    assert model == "gpt-4o-mini"  # resolved model returned for Usage reporting
    # The whole point of #166: doubao's thinking knob must not reach OpenAI.
    assert captured["extra_body"] is None
    assert "thinking" not in (captured.get("extra_body") or {})
    assert captured["response_format"] == {"type": "json_object"}
    assert captured["model"] == "gpt-4o-mini"
    assert captured["base_url"] == "https://api.openai.com/v1"
    assert captured["api_key"] == "fake_oai"


def test_vision_analyze_openai_missing_key_raises_vision_error(_real_env, monkeypatch):
    _real_env(VISION_PROVIDER="openai")  # no OPENAI_API_KEY
    monkeypatch.setattr(ai_client, "chat_completion", _capture({}))
    with pytest.raises(vision.VisionError):
        asyncio.run(vision.analyze(_req()))


# ---- inspect_render.diagnose through each slot ------------------------------


def _inspect_req():
    return V2InspectRequest.model_validate(
        {
            "albumId": "a1",
            "language": "en",
            "page": {
                "pageIndex": 1,
                "templateId": "mag-05",
                "images": {"image": "p1"},
                "texts": {"title": "T"},
            },
            "photos": [
                {
                    "photoId": "p1",
                    "description": "a portrait",
                    "tags": ["portrait"],
                    "quality": "hero",
                    "orientation": "portrait",
                    "peopleCount": "1",
                    "scene": "outdoor",
                    "mood": "warm",
                }
            ],
            "screenshot": "data:image/png;base64,AAAA",
            "userMessage": "face cut off",
        }
    )


def _inspect_capture(captured: dict):
    async def fake_completion(**kwargs):
        captured.update(kwargs)
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "imageId": "image",
                                "problem": "head cropped",
                                "suggestedDx": 0,
                                "suggestedDy": -10,
                                "suggestedScale": 1.0,
                                "confidence": 0.8,
                            }
                        )
                    }
                }
            ],
            "usage": {"prompt_tokens": 80, "completion_tokens": 20},
        }

    return fake_completion


def test_inspect_ark_sends_thinking(_real_env, monkeypatch):
    _real_env(ARK_API_KEY="fake_ark")
    captured: dict = {}
    monkeypatch.setattr(ai_client, "chat_completion", _inspect_capture(captured))

    resp = asyncio.run(inspect_render.diagnose(_inspect_req()))

    assert resp.usage.models.vision == "doubao-seed-1-6-vision-250815"
    assert captured["extra_body"] == {"thinking": {"type": "disabled"}}


def test_inspect_openai_omits_thinking(_real_env, monkeypatch):
    _real_env(VISION_PROVIDER="openai", OPENAI_API_KEY="fake_oai")
    captured: dict = {}
    monkeypatch.setattr(ai_client, "chat_completion", _inspect_capture(captured))

    resp = asyncio.run(inspect_render.diagnose(_inspect_req()))

    assert resp.usage.models.vision == "gpt-4o-mini"
    assert captured["extra_body"] is None
    assert captured["response_format"] == {"type": "json_object"}
    assert captured["model"] == "gpt-4o-mini"


def test_inspect_openai_missing_key_degrades_gracefully(_real_env, monkeypatch):
    _real_env(VISION_PROVIDER="openai")  # no OPENAI_API_KEY
    # chat_completion must NOT be called; the slot is unavailable.
    called = {"hit": False}

    async def boom(**_kwargs):
        called["hit"] = True
        raise AssertionError("should not call upstream when slot key is missing")

    monkeypatch.setattr(ai_client, "chat_completion", boom)

    resp = asyncio.run(inspect_render.diagnose(_inspect_req()))

    # Graceful no-op diagnosis, model name still reports the configured provider.
    assert resp.diagnosis.imageId is None
    assert resp.usage.models.vision == "gpt-4o-mini"
    assert called["hit"] is False


# ---- cost estimate ----------------------------------------------------------


def test_estimate_cost_gpt4o_mini():
    # 1M input @ $0.15 + 1M output @ $0.60 = $0.75
    assert estimate_cost_usd("gpt-4o-mini", 1_000_000, 1_000_000) == pytest.approx(0.75)


def test_estimate_cost_unknown_model_is_none():
    assert estimate_cost_usd("doubao-seed-1-6-vision-250815", 1000, 1000) is None
