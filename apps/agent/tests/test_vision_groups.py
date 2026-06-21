import asyncio
import json
from typing import Any

import pytest

from src.schemas import LayoutRequest, PhotoIn, V3AnalyzePhoto, V3LayoutTree, VisionResult
from src import ai_client
from src.agents.image_understanding import handler as vision


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

    result, tokens, model = asyncio.run(vision.analyze(_req()))

    assert isinstance(result, VisionResult)
    assert tokens == 18
    assert model == "doubao-seed-1-6-vision-250815"
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

    result, _, _ = asyncio.run(vision.analyze(_req(count=3)))

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

    result, _, _ = asyncio.run(vision.analyze(_req(count=1)))

    assert [g.model_dump() for g in result.groups] == [
        {"groupId": "g1", "label": "Closing", "photoIds": ["p1"], "role": "closing"}
    ]


# =============================================================================
# WP1.3 describe-content (#182): 章节树 partition + 3 LLM fields + failover.
# =============================================================================


@pytest.fixture
def _describe_env(monkeypatch):
    """describe-content env with BOTH slots keyed (OpenAI primary + 火山 failover)."""
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    monkeypatch.setenv("OPENAI_VISION_MODEL", "gpt-4o-mini")
    monkeypatch.setenv("OPENAI_API_KEY", "fake_oai")
    monkeypatch.setenv("ARK_API_KEY", "fake_ark")
    from src import settings as s

    s.reset_settings_cache()
    yield
    s.reset_settings_cache()


def _v3_photos(count: int = 3) -> list[V3AnalyzePhoto]:
    return [
        V3AnalyzePhoto(
            photoId=f"p{i + 1}",
            base64="data:image/jpeg;base64,AA==",
            width=800 if i % 2 == 0 else 600,
            height=600 if i % 2 == 0 else 800,
            exif={"takenAt": f"2024-03-{(i % 28) + 1:02d}T08:30:00"},
        )
        for i in range(count)
    ]


def _chapters_payload() -> dict[str, Any]:
    return {
        "chapters": [
            {
                "description": "Spring morning walk.",
                "photoIds": ["p1", "p2"],
                "scenes": {
                    "p1": "a woman in a red coat",
                    "p2": "snow on the old street",
                },
            },
            {
                "description": "Quiet afternoon.",
                "photoIds": ["p3"],
                "scenes": {"p3": "a quiet teahouse"},
            },
        ]
    }


def _completion(content: Any) -> dict[str, Any]:
    return {
        "choices": [{"message": {"content": json.dumps(content)}}],
        "usage": {"prompt_tokens": 11, "completion_tokens": 7},
    }


def test_describe_content_builds_chapter_tree_with_llm_3_fields(_describe_env, monkeypatch):
    async def fake_completion(**kwargs):
        # Primary slot = OpenAI (GPT-5.5 Mini); never carries doubao's `thinking`.
        assert kwargs["model"] == "gpt-5.5-mini"
        assert kwargs.get("extra_body") is None
        return _completion(_chapters_payload())

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    photos = _v3_photos(3)
    result = asyncio.run(vision.describe_content(photos, language="en"))

    assert isinstance(result.tree, V3LayoutTree)
    assert result.provider == "openai"
    assert result.model == "gpt-5.5-mini"
    assert result.tokens_billed == 18

    chapters = result.tree.chapters
    assert [c.chapterId for c in chapters] == ["ch_1", "ch_2"]
    # ① 分章 (LLM): partition honored.
    assert [[p.photoId for p in c.photos] for c in chapters] == [["p1", "p2"], ["p3"]]
    # ② description (LLM).
    assert chapters[0].description == "Spring morning walk."
    # ③ sceneDescription (LLM).
    assert chapters[0].photos[0].sceneDescription == "a woman in a red coat"

    # Code-filled deterministic attrs come from the REQUEST, not the LLM (§4.1(c)).
    p1 = chapters[0].photos[0]
    assert (p1.width, p1.height, p1.orientation) == (800, 600, "landscape")
    assert p1.takenAt == "2024-03-01T08:30:00"
    p3 = chapters[1].photos[0]
    assert (p3.width, p3.height, p3.orientation) == (800, 600, "landscape")

    # accentColor/artFont stay null placeholders (theme stage fills, §4.1).
    for c in chapters:
        assert c.accentColor is None and c.artFont is None


def test_describe_content_rejects_duplicate_photo_ids(_describe_env, monkeypatch):
    # The code must reject duplicate LLM-authored grouping, not silently keep the
    # first occurrence or patch in its own partition.
    payload = {
        "chapters": [
            {
                "description": "A.",
                "photoIds": ["p1", "p2"],
                "scenes": {"p1": "one", "p2": "two"},
            },
            {
                "description": "B.",
                "photoIds": ["p1", "p3"],
                "scenes": {"p1": "one again", "p3": "three"},
            },
        ]
    }

    async def fake_completion(**kwargs):
        return _completion(payload)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(vision.VisionError, match="duplicated photoId"):
        asyncio.run(vision.describe_content(_v3_photos(3), language="en"))


def test_describe_content_rejects_omitted_photo_ids(_describe_env, monkeypatch):
    # Every input photo must appear once; omitted ids are invalid LLM output.
    payload = {
        "chapters": [
            {
                "description": "A.",
                "photoIds": ["p1", "p2"],
                "scenes": {"p1": "one", "p2": "two"},
            }
        ]
    }

    async def fake_completion(**kwargs):
        return _completion(payload)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(vision.VisionError, match="omitted photoIds"):
        asyncio.run(vision.describe_content(_v3_photos(3), language="en"))


def test_describe_content_rejects_unknown_photo_ids(_describe_env, monkeypatch):
    # The model may only reference exact photoIds from the request manifest.
    payload = {
        "chapters": [
            {
                "description": "A.",
                "photoIds": ["p1", "p2", "p3", "p999"],
                "scenes": {"p1": "one", "p2": "two", "p3": "three", "p999": "unknown"},
            }
        ]
    }

    async def fake_completion(**kwargs):
        return _completion(payload)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(vision.VisionError, match="unknown photoId"):
        asyncio.run(vision.describe_content(_v3_photos(3), language="en"))


def test_describe_content_rejects_missing_llm_authored_text(_describe_env, monkeypatch):
    """`description` and per-photo `sceneDescription` are LLM-authored fields.
    Missing values are invalid model output, not code-fill opportunities."""
    payload = {
        "chapters": [
            {
                "description": "Spring morning walk.",
                "photoIds": ["p1", "p2"],
                "scenes": {"p1": "a woman in a red coat"},
            },
            {
                "description": "",
                "photoIds": ["p3"],
                "scenes": {"p3": "a quiet teahouse"},
            },
        ]
    }

    async def fake_completion(**kwargs):
        return _completion(payload)

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(vision.VisionError):
        asyncio.run(vision.describe_content(_v3_photos(3), language="en"))


def test_describe_content_fails_over_to_ark_on_openai_5xx(_describe_env, monkeypatch):
    calls: list[str] = []

    async def fake_completion(**kwargs):
        model = kwargs["model"]
        calls.append(model)
        if model == "gpt-5.5-mini":
            raise ai_client.AIRequestError(
                "upstream_5xx status=503", status_code=503, kind="5xx"
            )
        # Failover slot = 火山 doubao; thinking-disabled, no json_object.
        assert model == "doubao-seed-1-6-vision-250815"
        assert kwargs.get("response_format") is None
        return _completion(_chapters_payload())

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result = asyncio.run(vision.describe_content(_v3_photos(3), language="en"))

    # 先 GPT、自动降级火山: primary tried first, then failover.
    assert calls == ["gpt-5.5-mini", "doubao-seed-1-6-vision-250815"]
    assert result.provider == "ark"
    assert result.model == "doubao-seed-1-6-vision-250815"
    assert result.call_count == 2
    assert len(result.tree.chapters) == 2


def test_describe_content_does_not_failover_on_openai_4xx(_describe_env, monkeypatch):
    """Auth/model/request errors are configuration or request bugs, not
    5xx/timeout/deadline failover cases."""
    calls: list[str] = []

    async def fake_completion(**kwargs):
        calls.append(kwargs["model"])
        raise ai_client.AIRequestError(
            "upstream_4xx status=401", status_code=401, kind="4xx"
        )

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(vision.VisionError):
        asyncio.run(vision.describe_content(_v3_photos(2), language="en"))
    assert calls == ["gpt-5.5-mini"]


def test_describe_content_fails_over_when_primary_overruns_deadline(_describe_env, monkeypatch):
    """A slow-but-not-erroring primary that overruns describe_batch_deadline_seconds
    flips to 火山 (先 GPT、自动降级火山, deadline 数值可微调)."""
    monkeypatch.setenv("DESCRIBE_BATCH_DEADLINE_SECONDS", "1")  # tight deadline
    from src import settings as s

    s.reset_settings_cache()
    calls: list[str] = []

    async def fake_completion(**kwargs):
        model = kwargs["model"]
        calls.append(model)
        if model == "gpt-5.5-mini":
            await asyncio.sleep(5)  # overruns the 1s batch deadline → failover
            return _completion(_chapters_payload())
        return _completion(_chapters_payload())

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result = asyncio.run(vision.describe_content(_v3_photos(3), language="en"))
    assert calls == ["gpt-5.5-mini", "doubao-seed-1-6-vision-250815"]
    assert result.provider == "ark"


def test_describe_content_raises_when_openai_unconfigured(monkeypatch):
    # Only the 火山 key is present. V3 describe-content must not silently switch
    # providers for a missing primary key; failover is for 5xx/timeouts/deadline.
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("ARK_API_KEY", "fake_ark")
    from src import settings as s

    s.reset_settings_cache()
    try:
        calls: list[str] = []

        async def fake_completion(**kwargs):
            calls.append(kwargs["model"])
            return _completion(_chapters_payload())

        monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

        with pytest.raises(vision.VisionError):
            asyncio.run(vision.describe_content(_v3_photos(2), language="en"))
        assert calls == []
    finally:
        s.reset_settings_cache()


def test_describe_content_raises_when_both_providers_fail(_describe_env, monkeypatch):
    async def fake_completion(**kwargs):
        raise ai_client.AIRequestError("upstream_5xx status=503", status_code=503, kind="5xx")

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(vision.VisionError):
        asyncio.run(vision.describe_content(_v3_photos(2), language="en"))


def test_describe_content_does_not_failover_on_unparseable_response(_describe_env, monkeypatch):
    """A malformed (non-JSON) response is NOT a transport failure: it propagates
    rather than burning the failover on the same bad-output class of bug."""
    calls: list[str] = []

    async def fake_completion(**kwargs):
        calls.append(kwargs["model"])
        return {"choices": [{"message": {"content": "not json at all"}}], "usage": {}}

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(vision.VisionError):
        asyncio.run(vision.describe_content(_v3_photos(2), language="en"))
    # Only the primary was hit; no failover attempt.
    assert calls == ["gpt-5.5-mini"]


def test_describe_content_manifest_carries_takenat_but_never_gps(_describe_env):
    """§3 privacy: the user turn lists photoId + takenAt as the分章 signal and
    contains NO GPS/coordinate/place token."""
    photos = _v3_photos(2)
    parts = vision._build_v3_user_content(photos, "a trip")
    manifest = parts[0]["text"]

    assert "p1" in manifest and "p2" in manifest
    assert "2024-03-01T08:30:00" in manifest  # takenAt signal present
    lowered = manifest.lower()
    for banned in ("lat", "lng", "latitude", "longitude", "gps", "coordinate", "place="):
        assert banned not in lowered, banned
