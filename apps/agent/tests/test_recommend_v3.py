"""WP3.1 (#189, #236) — V3 recommend: per-chapter subject + color/font.

Exercises the new V3 service (`recommend_v3`, Option B — v2 `theme.py` untouched)
plus the `POST /v3/recommend` sync route:
  * each chapter gets one {subject, accentColor, artFont} (no album-level themeOptions, #236);
  * subject (chapter title) round-trips, a trailing period is stripped, and a
    missing/empty subject degrades to the "Untitled Chapter" fallback;
  * artFont is clamped to the 4-member ArtFontPack and accentColor is a legal #hex
    (illegal model output is coerced back, never injected into the response);
  * the recognition-model call is injected (`complete=`) so outputs are deterministic
    and no real model is hit;
  * missing/empty chapters degrade without crashing (full chapter coverage);
  * the auth gate + contract-shaped error path on the route.

Two-end contract parity is checked by re-validating the response against
V3RecommendResponse (schemas.py ↔ packages/contracts/src/v3.ts single truth source).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, get_args

import pytest
from fastapi.testclient import TestClient

from src.schemas import (
    ArtFontPack,
    V3ChapterOverview,
    V3RecommendRequest,
    V3RecommendResponse,
)
from src.agents.theme_recommend import handler as recommend_v3
from src.agents.theme_recommend import RecommendV3Error

_ART_FONTS = set(get_args(ArtFontPack))


# ---------- fixtures ----------------------------------------------------------


def _req(
    *,
    chapters: list[V3ChapterOverview] | None = None,
    summary: str | None = "A spring coast trip, warm and nostalgic.",
    user_message: str | None = None,
) -> V3RecommendRequest:
    if chapters is None:
        chapters = [
            V3ChapterOverview(
                chapterId="ch_1",
                description="A spring trip to the coast.",
                photoDescs=["two people on a sunlit beach", "waves at sunset"],
            ),
            V3ChapterOverview(
                chapterId="ch_2",
                description="A quiet evening in the old town.",
                photoDescs=["lantern-lit alley"],
            ),
        ]
    extra: dict[str, Any] = {}
    if summary is not None:
        extra["analysisSummary"] = summary
    if user_message is not None:
        extra["userMessage"] = user_message
    return V3RecommendRequest(albumId="alb_v3", language="en", chapters=chapters, **extra)


def _fake_complete(payload: dict[str, Any]):
    """Injectable `complete` answering with a fixed recognition-model JSON."""

    async def complete(*, messages):  # noqa: ANN001
        return {
            "choices": [{"message": {"content": json.dumps(payload)}}],
            "usage": {"prompt_tokens": 21, "completion_tokens": 13},
        }

    return complete


def _run(req: V3RecommendRequest, payload: dict[str, Any]) -> V3RecommendResponse:
    return asyncio.run(recommend_v3.run(req, complete=_fake_complete(payload)))


def _good_payload() -> dict[str, Any]:
    return {
        "chapterColors": [
            {
                "chapterId": "ch_1",
                "subject": "Spring by the sea",
                "accentColor": "#C2410C",
                "artFont": "script-elegant",
            },
            {
                "chapterId": "ch_2",
                "subject": "A quiet evening",
                "accentColor": "#1E3A5F",
                "artFont": "serif-classic",
            },
        ],
        "assistantReply": "Here are per-chapter subjects and colors.",
    }


# ---------- happy path: per-chapter subject + color/font ----------------------


def test_happy_path_chapter_subject_and_colors():
    resp = _run(_req(), _good_payload())
    # one {subject, accentColor, artFont} per chapter, in input order.
    assert [c.chapterId for c in resp.chapterColors] == ["ch_1", "ch_2"]
    # subject (chapter title) round-trips.
    assert resp.chapterColors[0].subject == "Spring by the sea"
    assert resp.chapterColors[1].subject == "A quiet evening"
    assert resp.chapterColors[0].accentColor == "#C2410C"
    assert resp.chapterColors[0].artFont == "script-elegant"
    # usage reports the recognition (vision) call.
    assert resp.usage.visionCallCount == 1
    # Two-end parity: re-validate against the contract schema.
    re_parsed = V3RecommendResponse(**resp.model_dump(exclude_none=True))
    assert len(re_parsed.chapterColors) == 2


# ---------- guardrails: font ∈ pack, color is legal #hex ----------------------


def test_font_clamped_to_pack_and_color_legal_hex():
    payload = _good_payload()
    # Illegal font → default; #RGB shorthand → expanded #RRGGBB; no-# tolerated.
    payload["chapterColors"] = [
        {"chapterId": "ch_1", "subject": "Spring by the sea", "accentColor": "#abc", "artFont": "comic-sans"},
        {"chapterId": "ch_2", "subject": "A quiet evening", "accentColor": "AABBCC", "artFont": "sans-modern"},
    ]
    resp = _run(_req(), payload)
    for rec in resp.chapterColors:
        assert rec.artFont in _ART_FONTS
        # AccentColor regex (schemas.py) accepts the result — strict re-parse proves it.
    assert resp.chapterColors[0].artFont == "serif-classic"  # illegal → default
    assert resp.chapterColors[0].accentColor == "#AABBCC"  # #abc expanded + uppercased
    assert resp.chapterColors[1].accentColor == "#AABBCC"  # bare hex normalized
    assert resp.chapterColors[1].artFont == "sans-modern"
    V3RecommendResponse(**resp.model_dump(exclude_none=True))  # must still validate


def test_illegal_color_falls_back_not_raises():
    payload = _good_payload()
    payload["chapterColors"] = [
        {"chapterId": "ch_1", "subject": "Spring by the sea", "accentColor": "cornflowerblue", "artFont": "display-bold"},
        {"chapterId": "ch_2", "subject": "A quiet evening", "accentColor": "#12", "artFont": "serif-classic"},
    ]
    resp = _run(_req(), payload)
    # Non-hex / wrong-length → neutral fallback (a legal #hex), never an exception.
    for rec in resp.chapterColors:
        assert rec.accentColor.startswith("#")
        assert len(rec.accentColor) == 7
    V3RecommendResponse(**resp.model_dump(exclude_none=True))


# ---------- degradation: missing chapters, empty theme, missing photos --------


def test_missing_chapter_filled_with_fallback_full_coverage():
    payload = _good_payload()
    # Model only returned ch_1 — ch_2 must still come back (never dropped).
    payload["chapterColors"] = [
        {"chapterId": "ch_1", "subject": "Spring by the sea", "accentColor": "#C2410C", "artFont": "script-elegant"},
    ]
    resp = _run(_req(), payload)
    assert [c.chapterId for c in resp.chapterColors] == ["ch_1", "ch_2"]
    # ch_2 got the neutral fallback + default font + fallback subject.
    assert resp.chapterColors[1].accentColor.startswith("#")
    assert resp.chapterColors[1].artFont in _ART_FONTS
    assert resp.chapterColors[1].subject == "Untitled Chapter"


def test_missing_subject_degrades_to_fallback_and_trailing_period_stripped():
    payload = _good_payload()
    # ch_1: subject omitted entirely → must degrade to the neutral placeholder.
    # ch_2: a drifted trailing period → stripped to a clean one-line title.
    payload["chapterColors"] = [
        {"chapterId": "ch_1", "accentColor": "#C2410C", "artFont": "script-elegant"},
        {"chapterId": "ch_2", "subject": "A quiet evening.", "accentColor": "#1E3A5F", "artFont": "serif-classic"},
    ]
    resp = _run(_req(), payload)
    # Missing subject → fallback (the service's _coerce_subject placeholder).
    assert resp.chapterColors[0].subject == "Untitled Chapter"
    # Trailing period stripped.
    assert resp.chapterColors[1].subject == "A quiet evening"
    # Contract requires subject min_length=1 — fallback keeps the response valid.
    V3RecommendResponse(**resp.model_dump(exclude_none=True))


def test_chapter_with_no_photos_does_not_crash():
    chapters = [
        V3ChapterOverview(chapterId="ch_1", description="An empty chapter.", photoDescs=[]),
    ]
    payload = {
        "chapterColors": [
            {"chapterId": "ch_1", "subject": "An empty chapter", "accentColor": "#445566", "artFont": "serif-classic"}
        ],
        "assistantReply": "ok",
    }
    resp = _run(_req(chapters=chapters, summary=None), payload)
    assert len(resp.chapterColors) == 1
    assert resp.chapterColors[0].chapterId == "ch_1"


def test_unparseable_model_response_raises_contract_error():
    async def bad_complete(*, messages):  # noqa: ANN001
        return {"choices": [{"message": {"content": "not json at all {{{"}}]}

    with pytest.raises(RecommendV3Error):
        asyncio.run(recommend_v3.run(_req(), complete=bad_complete))


def test_provider_not_injected_uses_no_real_model_by_default():
    # Sanity: with no complete= injected and no keys, the call must fail closed
    # (RecommendV3Error from the missing火山 failover slot) — never hit a real model.
    # conftest does not set OPENAI/ARK keys, so both slots are unconfigured.
    with pytest.raises(RecommendV3Error):
        asyncio.run(recommend_v3.run(_req()))


def test_production_openai_slot_uses_v3_describe_model_and_timeout(monkeypatch):
    from src import settings as s

    captured: dict[str, Any] = {}

    async def fake_chat_completion(**kwargs):  # noqa: ANN003
        captured.update(kwargs)
        return {
            "choices": [{"message": {"content": json.dumps(_good_payload())}}],
            "usage": {"prompt_tokens": 21, "completion_tokens": 13},
        }

    monkeypatch.setenv("OPENAI_API_KEY", "openai-key")
    monkeypatch.setenv("OPENAI_VISION_MODEL", "gpt-4o-mini")
    monkeypatch.setenv("DESCRIBE_OPENAI_MODEL", "gpt-5.5-mini")
    monkeypatch.setenv("OPENAI_TIMEOUT_SECONDS", "120")
    monkeypatch.setenv("DESCRIBE_OPENAI_TIMEOUT_SECONDS", "17")
    monkeypatch.setattr(recommend_v3.ai_client, "chat_completion", fake_chat_completion)
    s.reset_settings_cache()
    try:
        resp = asyncio.run(recommend_v3.run(_req()))
    finally:
        s.reset_settings_cache()

    assert captured["model"] == "gpt-5.5-mini"
    assert captured["timeout_seconds"] == 17
    assert resp.usage.models.vision == "gpt-5.5-mini"


# ---------- route: auth + contract shape -------------------------------------


def _client() -> TestClient:
    from src.main import app

    return TestClient(app)


def _route_body() -> dict[str, Any]:
    return {
        "albumId": "alb_v3",
        "language": "en",
        "chapters": [
            {
                "chapterId": "ch_1",
                "description": "A spring trip to the coast.",
                "photoDescs": ["sunlit beach"],
            }
        ],
        "analysisSummary": "warm and nostalgic",
    }


def test_route_requires_auth():
    res = _client().post("/v3/recommend", json=_route_body())
    assert res.status_code == 401


def test_route_happy_path_returns_contract_envelope(monkeypatch):
    from src.schemas import V3ChapterColorRecommendation, V3Models, V3Usage

    async def fake_run(req, *, complete=None):  # noqa: ANN001
        return V3RecommendResponse(
            chapterColors=[
                V3ChapterColorRecommendation(
                    chapterId="ch_1",
                    subject="Spring by the sea",
                    accentColor="#C2410C",
                    artFont="script-elegant",
                )
            ],
            assistantReply="Here you go.",
            usage=V3Usage(durationMs=1, visionCallCount=1, models=V3Models(vision="gpt-5.5-mini")),
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
    parsed = V3RecommendResponse(**body["data"])  # two-end parity
    assert parsed.chapterColors[0].subject == "Spring by the sea"
    assert parsed.chapterColors[0].accentColor == "#C2410C"


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
