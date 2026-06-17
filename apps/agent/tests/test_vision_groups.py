import asyncio
import json
from typing import Any

import pytest

from src.schemas import LayoutRequest, PhotoIn, VisionResult
from src.services import ai_client, vision


@pytest.fixture(autouse=True)
def _real_vision_env(monkeypatch):
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    monkeypatch.setenv("ARK_API_KEY", "fake_ark")
    from src import settings as s

    s.reset_settings_cache()
    yield
    s.reset_settings_cache()


def _req(count: int = 4) -> LayoutRequest:
    return LayoutRequest(
        requestId="r1",
        prompt="a family trip",
        language="en",
        callbackUrl="http://example.com/cb",
        photos=[
            PhotoIn(
                photoId=f"p{i + 1}",
                base64=f"data:image/jpeg;base64,{i}",
                width=800 if i % 2 == 0 else 600,
                height=600 if i % 2 == 0 else 800,
            )
            for i in range(count)
        ],
    )


def _photo_payload(idx: int) -> dict[str, Any]:
    return {
        "description": f"Photo {idx}",
        "tags": ["memoir", "trip", f"p{idx}"],
        "quality": "detail",
        "orientation": "landscape",
        "peopleCount": "1",
        "scene": "outdoor",
        "mood": "warm",
        "timeOfDay": "day",
        "location": None,
    }


async def _completion_with(content: Any, *args, **kwargs):
    return {
        "choices": [{"message": {"content": json.dumps(content)}}],
        "usage": {"prompt_tokens": 11, "completion_tokens": 7},
    }


def test_vision_parses_object_output_and_sanitizes_groups(monkeypatch):
    payload = {
        "photos": [_photo_payload(i) for i in range(1, 5)],
        "groups": [
            {
                "groupId": " Travel 01 ",
                "label": "",
                "photoIds": ["p1", "missing", "p1", "p2"],
                "role": ["not-a-role"],
            },
            {
                "groupId": "Travel 01",
                "label": "Closing beat",
                "photoIds": ["p3", "p4"],
                "role": "closing",
            },
            {
                "groupId": "",
                "label": "Empty after filtering",
                "photoIds": ["missing"],
                "role": "opening",
            },
        ],
    }

    async def fake_completion(*args, **kwargs):
        return await _completion_with(payload, *args, **kwargs)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result, tokens = asyncio.run(vision.analyze(_req()))

    assert isinstance(result, VisionResult)
    assert tokens == 18
    assert [p.photoId for p in result.photos] == ["p1", "p2", "p3", "p4"]
    assert [g.model_dump() for g in result.groups] == [
        {
            "groupId": "travel-01",
            "label": "Group 1",
            "photoIds": ["p1", "p2"],
            "role": None,
        },
        {
            "groupId": "travel-01-2",
            "label": "Closing beat",
            "photoIds": ["p3", "p4"],
            "role": "closing",
        },
    ]


def test_vision_user_prompt_lists_real_photo_ids_for_grouping():
    req = _req(count=2).model_copy(
        update={
            "photos": [
                PhotoIn(
                    photoId="7fd49bf5-4c1d-46fa-94c0-a9eb560f6d98",
                    base64="data:image/jpeg;base64,A",
                    width=800,
                    height=600,
                ),
                PhotoIn(
                    photoId="d5a780b2-4c16-4897-acfd-f9ed09ec1611",
                    base64="data:image/jpeg;base64,B",
                    width=600,
                    height=800,
                ),
            ]
        }
    )

    prompt_text = vision._build_user_content(req)[0]["text"]

    assert "7fd49bf5-4c1d-46fa-94c0-a9eb560f6d98" in prompt_text
    assert "d5a780b2-4c16-4897-acfd-f9ed09ec1611" in prompt_text


def test_vision_accepts_legacy_array_output_and_builds_fallback_groups(monkeypatch):
    payload = [_photo_payload(i) for i in range(1, 4)]

    async def fake_completion(*args, **kwargs):
        return await _completion_with(payload, *args, **kwargs)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result, _ = asyncio.run(vision.analyze(_req(count=3)))

    assert [p.photoId for p in result.photos] == ["p1", "p2", "p3"]
    assert result.groups
    assert [pid for group in result.groups for pid in group.photoIds] == ["p1", "p2", "p3"]
    assert result.groups[-1].role == "closing"


def test_vision_object_output_with_no_valid_groups_gets_fallback(monkeypatch):
    payload = {
        "photos": [_photo_payload(1)],
        "groups": [{"groupId": "bad", "label": "Bad", "photoIds": ["missing"], "role": "closing"}],
    }

    async def fake_completion(*args, **kwargs):
        return await _completion_with(payload, *args, **kwargs)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result, _ = asyncio.run(vision.analyze(_req(count=1)))

    assert [g.model_dump() for g in result.groups] == [
        {"groupId": "g1", "label": "Closing", "photoIds": ["p1"], "role": "closing"}
    ]
