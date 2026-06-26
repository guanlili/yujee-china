"""Stage4 `/v3/recommend`: three book theme options.

The agent is text-only here: it receives chapter overviews, optional extracted colors,
and an optional font hint, then coerces model output into exactly three complete
theme options.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, get_args

import pytest
from fastapi.testclient import TestClient

from src.agents.theme_recommend import RecommendV3Error
from src.agents.theme_recommend import handler as recommend_v3
from src.schemas import (
    ArtFontPack,
    V3BookThemeOption,
    V3ChapterOverview,
    V3ChapterThemeColor,
    V3Models,
    V3RecommendRequest,
    V3RecommendResponse,
    V3Usage,
)

_ART_FONTS = set(get_args(ArtFontPack))


def _req(
    *,
    chapters: list[V3ChapterOverview] | None = None,
    summary: str | None = "A spring coast trip, warm and nostalgic.",
    user_message: str | None = None,
    font_hint: str | None = "elegant handwritten title font",
) -> V3RecommendRequest:
    if chapters is None:
        chapters = [
            V3ChapterOverview(
                chapterId="ch_1",
                description="A spring trip to the coast.",
                photoDescs=["two people on a sunlit beach", "waves at sunset"],
                extractedColor="#C8894A",
            ),
            V3ChapterOverview(
                chapterId="ch_2",
                description="A quiet evening in the old town.",
                photoDescs=["lantern-lit alley"],
                extractedColor=None,
            ),
        ]
    extra: dict[str, Any] = {}
    if summary is not None:
        extra["analysisSummary"] = summary
    if user_message is not None:
        extra["userMessage"] = user_message
    if font_hint is not None:
        extra["fontHint"] = font_hint
    return V3RecommendRequest(albumId="alb_v3", language="en", chapters=chapters, **extra)


def _fake_complete(payload: dict[str, Any]):
    async def complete(*, messages, **_kwargs):  # noqa: ANN001
        return {
            "choices": [{"message": {"content": json.dumps(payload)}}],
            "usage": {"prompt_tokens": 21, "completion_tokens": 13},
        }

    return complete


def _run(req: V3RecommendRequest, payload: dict[str, Any]) -> V3RecommendResponse:
    return asyncio.run(recommend_v3.run(req, complete=_fake_complete(payload)))


def _option(option_id: str, art_font: str = "script-elegant") -> dict[str, Any]:
    return {
        "optionId": option_id,
        "label": f" {option_id} label ",
        "style": f" {option_id} style ",
        "artFont": art_font,
        "chapters": [
            {
                "chapterId": "ch_1",
                "subject": "Spring by the sea.",
                "accentColor": "#C2410C",
            },
            {
                "chapterId": "ch_2",
                "subject": "A quiet evening",
                "accentColor": "#1E3A5F",
            },
        ],
    }


def _good_payload() -> dict[str, Any]:
    return {
        "bookThemeOptions": [
            _option("warm", "script-elegant"),
            _option("calm", "serif-classic"),
            _option("bold", "display-bold"),
        ],
        "assistantReply": "Here are three book-wide theme directions.",
    }


def test_happy_path_returns_three_book_theme_options_with_chapter_coverage():
    resp = _run(_req(), _good_payload())

    assert [o.optionId for o in resp.bookThemeOptions] == ["warm", "calm", "bold"]
    assert [o.artFont for o in resp.bookThemeOptions] == [
        "script-elegant",
        "serif-classic",
        "display-bold",
    ]
    assert all([c.chapterId for c in o.chapters] == ["ch_1", "ch_2"] for o in resp.bookThemeOptions)
    assert resp.bookThemeOptions[0].label == "warm label"
    assert resp.bookThemeOptions[0].style == "warm style"
    assert resp.bookThemeOptions[0].chapters[0].subject == "Spring by the sea"
    assert resp.bookThemeOptions[0].chapters[0].accentColor == "#C2410C"
    assert resp.usage.visionCallCount == 0
    assert resp.usage.planningInputTokens == 21
    assert resp.usage.planningOutputTokens == 13

    re_parsed = V3RecommendResponse(**resp.model_dump(exclude_none=True))
    assert len(re_parsed.bookThemeOptions) == 3


def test_coerces_to_exactly_three_options_and_stable_fallback_option_ids():
    payload = _good_payload()
    payload["bookThemeOptions"] = [
        {**_option("dup"), "chapters": [{"chapterId": "ch_1", "accentColor": "#abc"}]},
        {**_option("dup"), "artFont": "comic-sans"},
        _option("third"),
        _option("extra"),
    ]
    resp = _run(_req(), payload)

    assert [o.optionId for o in resp.bookThemeOptions] == ["dup", "opt-2", "third"]
    assert resp.bookThemeOptions[1].artFont == "serif-classic"
    assert resp.bookThemeOptions[0].chapters[0].accentColor == "#AABBCC"
    assert [c.chapterId for c in resp.bookThemeOptions[0].chapters] == ["ch_1", "ch_2"]
    assert resp.bookThemeOptions[0].chapters[1].accentColor.startswith("#")
    V3RecommendResponse(**resp.model_dump(exclude_none=True))


def test_missing_options_and_invalid_colors_get_deterministic_fallbacks():
    payload = {
        "bookThemeOptions": [
            {
                "chapters": [
                    {"chapterId": "unknown", "accentColor": "#000000"},
                    {"chapterId": "ch_1", "accentColor": "cornflowerblue"},
                ]
            }
        ],
        "assistantReply": "x",
    }
    resp = _run(_req(), payload)

    assert [o.optionId for o in resp.bookThemeOptions] == ["opt-1", "opt-2", "opt-3"]
    for option in resp.bookThemeOptions:
        assert option.artFont in _ART_FONTS
        assert [c.chapterId for c in option.chapters] == ["ch_1", "ch_2"]
        assert all(c.accentColor.startswith("#") and len(c.accentColor) == 7 for c in option.chapters)
    assert resp.bookThemeOptions[0].chapters[0].accentColor == "#4A5568"


def test_build_messages_include_font_hint_and_extracted_color_without_base64():
    messages = recommend_v3.build_messages(_req(user_message="make it warmer"))
    user_payload = json.loads(messages[1]["content"])

    assert user_payload["fontHint"] == "elegant handwritten title font"
    assert user_payload["userMessage"] == "make it warmer"
    assert user_payload["chapters"][0]["extractedColor"] == "#C8894A"
    assert user_payload["chapters"][1]["extractedColor"] is None
    assert "base64" not in messages[1]["content"].lower()


def test_unparseable_model_response_raises_contract_error():
    async def bad_complete(*, messages, **_kwargs):  # noqa: ANN001
        return {"choices": [{"message": {"content": "not json at all {{{"}}]}

    with pytest.raises(RecommendV3Error):
        asyncio.run(recommend_v3.run(_req(), complete=bad_complete))


def test_provider_not_injected_uses_no_real_model_by_default():
    with pytest.raises(RecommendV3Error):
        asyncio.run(recommend_v3.run(_req()))


def test_production_deepseek_slot_uses_planning_model_and_timeout(monkeypatch):
    from src import settings as s

    captured: dict[str, Any] = {}

    async def fake_chat_completion(**kwargs):  # noqa: ANN003
        captured.update(kwargs)
        return {
            "choices": [{"message": {"content": json.dumps(_good_payload())}}],
            "usage": {"prompt_tokens": 21, "completion_tokens": 13},
        }

    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-key")
    monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://deepseek.example")
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-chat")
    monkeypatch.setenv("DEEPSEEK_TIMEOUT_SECONDS", "17")
    monkeypatch.setenv("DEEPSEEK_USE_JSON_OBJECT", "true")
    monkeypatch.setenv("DEEPSEEK_DISABLE_THINKING", "true")
    monkeypatch.setattr(recommend_v3.ai_client, "chat_completion", fake_chat_completion)
    s.reset_settings_cache()
    try:
        resp = asyncio.run(recommend_v3.run(_req()))
    finally:
        s.reset_settings_cache()

    assert captured["base_url"] == "https://deepseek.example"
    assert captured["model"] == "deepseek-chat"
    assert captured["timeout_seconds"] == 17
    assert captured["response_format"] == {"type": "json_object"}
    assert captured["extra_body"] == {"thinking": {"type": "disabled"}}
    assert resp.usage.models.planning == "deepseek-chat"


def _client() -> TestClient:
    from src.main import app

    return TestClient(app)


def _route_body() -> dict[str, Any]:
    return {
        "albumId": "alb_v3",
        "language": "en",
        "fontHint": "serif",
        "chapters": [
            {
                "chapterId": "ch_1",
                "description": "A spring trip to the coast.",
                "photoDescs": ["sunlit beach"],
                "extractedColor": "#C8894A",
            }
        ],
        "analysisSummary": "warm and nostalgic",
    }


def test_route_requires_auth():
    res = _client().post("/v3/recommend", json=_route_body())
    assert res.status_code == 401


def test_route_happy_path_returns_contract_envelope(monkeypatch):
    async def fake_run(req, *, complete=None):  # noqa: ANN001
        return V3RecommendResponse(
            bookThemeOptions=[
                V3BookThemeOption(
                    optionId="opt-1",
                    artFont="script-elegant",
                    chapters=[
                        V3ChapterThemeColor(
                            chapterId="ch_1",
                            subject="Spring by the sea",
                            accentColor="#C2410C",
                        )
                    ],
                ),
                V3BookThemeOption(
                    optionId="opt-2",
                    artFont="serif-classic",
                    chapters=[V3ChapterThemeColor(chapterId="ch_1", accentColor="#1E3A5F")],
                ),
                V3BookThemeOption(
                    optionId="opt-3",
                    artFont="display-bold",
                    chapters=[V3ChapterThemeColor(chapterId="ch_1", accentColor="#2F855A")],
                ),
            ],
            assistantReply="Here you go.",
            usage=V3Usage(durationMs=1, models=V3Models(planning="deepseek-chat")),
        )

    monkeypatch.setattr(recommend_v3, "run", fake_run)
    res = _client().post(
        "/v3/recommend",
        json=_route_body(),
        headers={"Authorization": "Bearer test_secret"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    parsed = V3RecommendResponse(**body["data"])
    assert parsed.bookThemeOptions[0].chapters[0].subject == "Spring by the sea"
    assert parsed.bookThemeOptions[0].chapters[0].accentColor == "#C2410C"


def test_route_planning_failure_is_502_contract_error(monkeypatch):
    async def boom(req, *, complete=None):  # noqa: ANN001
        raise RecommendV3Error("model exploded")

    monkeypatch.setattr(recommend_v3, "run", boom)
    res = _client().post(
        "/v3/recommend",
        json=_route_body(),
        headers={"Authorization": "Bearer test_secret"},
    )
    assert res.status_code == 502
    body = res.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "AGENT_PLANNING_FAILED"
