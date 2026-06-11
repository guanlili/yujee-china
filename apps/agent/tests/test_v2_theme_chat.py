"""Endpoint wiring tests for POST /v2/album/theme + /v2/album/chapter-chat (W6b).

These exercise the synchronous route seam: Bearer auth, pydantic input
validation (extra='forbid'), mock vs real branching, AGENT_PLANNING_FAILED
mapping, and that the responses re-validate against the schemas_v2 contract.
The W3 services themselves are covered separately (test_theme.py /
test_chapter_chat.py); here we only verify the route around them, plus the
endpoint-owned askCount-from-history derivation (tech-plan §1.2/§1.3)."""

import pytest
from fastapi.testclient import TestClient

from src.routes import v2_album
from src.schemas_v2 import V2ChapterChatResponse, V2ThemeResponse


@pytest.fixture
def client():
    from src.main import app

    return TestClient(app)


_AUTH = {"Authorization": "Bearer test_secret", "X-Request-Id": "req_w6b"}


def _theme_body(**overrides) -> dict:
    body = {
        "albumId": "alb_1",
        "language": "en",
        "clustersOverview": [
            {
                "chapterId": "ch_1",
                "label": "spring walks",
                "place": "Osaka",
                "timeRange": "2025-04",
                "photoDescs": ["street food at night", "soft rain on a platform"],
            }
        ],
        "userMessage": "make it nostalgic",
    }
    body.update(overrides)
    return body


def _chapter_body(state: str = "empty", **overrides) -> dict:
    body = {
        "albumId": "alb_1",
        "language": "en",
        "theme": {"subject": "quiet spring", "tone": "warm", "style": "warm-film"},
        "chapter": {
            "chapterId": "ch_1",
            "state": state,
            "cluster": {
                "label": "rainy streets",
                "place": "Kyoto",
                "timeRange": "2025-04",
                "role": "body",
            },
            "photos": [
                {
                    "photoId": "p1",
                    "description": "lanterns on wet pavement",
                    "tags": ["rain", "street"],
                    "quality": "hero",
                    "orientation": "landscape",
                    "peopleCount": "0",
                    "scene": "city",
                    "mood": "quiet",
                    "timeOfDay": "evening",
                }
            ],
            "pages": [
                {"pageIndex": 2, "templateId": "mag-13", "images": {"image": "p1"}, "texts": {}},
            ],
        },
        "history": [],
        "userMessage": "Start this chapter",
    }
    body.update(overrides)
    return body


# ---------- theme -------------------------------------------------------------


def test_theme_mock_returns_valid_response(client):
    resp = client.post("/v2/album/theme", headers=_AUTH, json=_theme_body())
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["ok"] is True
    # Re-validate against the contract.
    out = V2ThemeResponse(**data["data"])
    assert out.theme.subject
    assert out.theme.style in {
        "warm-film",
        "editorial-mono",
        "soft-pastel",
        "bold-contrast",
        "vintage-print",
    }
    assert out.assistantReply
    # No currentTheme → still proposing → mock supplies 2-3 pickable options.
    assert out.themeOptions is not None
    assert 2 <= len(out.themeOptions) <= 3
    assert all(o.subject and o.label for o in out.themeOptions)
    # mock injects zero-token usage; the planning model name still surfaces.
    assert out.usage.durationMs >= 0


def test_theme_requires_auth(client):
    resp = client.post("/v2/album/theme", json=_theme_body())
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "AGENT_UNAUTHORIZED"


def test_theme_rejects_unknown_field(client):
    # extra='forbid' on the schema → 400 AGENT_INVALID_INPUT at parse time.
    resp = client.post("/v2/album/theme", headers=_AUTH, json=_theme_body(surprise=True))
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "AGENT_INVALID_INPUT"


def test_theme_rejects_empty_clusters(client):
    resp = client.post("/v2/album/theme", headers=_AUTH, json=_theme_body(clustersOverview=[]))
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "AGENT_INVALID_INPUT"


def test_theme_deepseek_failure_maps_to_planning_failed(client, monkeypatch):
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    from src import settings as s

    s.reset_settings_cache()

    async def boom(_req, *, complete=None):
        raise v2_album.ThemeError("upstream exploded")

    monkeypatch.setattr(v2_album.theme, "run", boom)

    try:
        resp = client.post("/v2/album/theme", headers=_AUTH, json=_theme_body())
    finally:
        s.reset_settings_cache()

    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "AGENT_PLANNING_FAILED"


# ---------- chapter-chat ------------------------------------------------------


def test_chapter_chat_mock_returns_valid_response(client):
    resp = client.post("/v2/album/chapter-chat", headers=_AUTH, json=_chapter_body("empty"))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["ok"] is True
    out = V2ChapterChatResponse(**data["data"])
    assert out.assistantReply
    # empty + askCount 0 → still in the asking dialog, no page texts yet.
    assert out.state == "asking"
    assert out.pagesTexts is None
    # mock supplies chapter-title candidates (chipName1-4) grounded in the label.
    assert out.nameOptions is not None
    assert len(out.nameOptions) >= 1


def test_chapter_chat_brief_ready_generates_page_texts(client):
    resp = client.post(
        "/v2/album/chapter-chat",
        headers=_AUTH,
        json=_chapter_body("brief_ready", userMessage="Generate it"),
    )
    assert resp.status_code == 200, resp.text
    out = V2ChapterChatResponse(**resp.json()["data"])
    assert out.state == "generated"
    assert out.pagesTexts is not None
    # only this chapter's pages come back.
    assert [p.pageIndex for p in out.pagesTexts] == [2]


def test_chapter_chat_only_eats_this_chapter_slice(client):
    # Request carries exactly one chapter slice; response page texts stay scoped
    # to that chapter's page indices (no cross-chapter leakage).
    body = _chapter_body("brief_ready", userMessage="write it")
    body["chapter"]["pages"].append(
        {"pageIndex": 3, "templateId": "mag-02", "images": {}, "texts": {}}
    )
    resp = client.post("/v2/album/chapter-chat", headers=_AUTH, json=body)
    assert resp.status_code == 200, resp.text
    out = V2ChapterChatResponse(**resp.json()["data"])
    assert {p.pageIndex for p in out.pagesTexts} == {2, 3}


def test_chapter_chat_ask_count_derived_from_history_auto_advances(client, monkeypatch):
    captured = {}
    original_run = v2_album.chapter_chat.run

    async def spy_run(req, *, ask_count, complete=None):
        captured["ask_count"] = ask_count
        return await original_run(req, ask_count=ask_count, complete=complete)

    monkeypatch.setattr(v2_album.chapter_chat, "run", spy_run)

    # One prior assistant turn → askCount 1; combined with the next turn the
    # state machine auto-advances to brief_ready (auto-advance after 2).
    body = _chapter_body(
        "asking",
        userMessage="We walked after dinner.",
        history=[
            {"role": "user", "content": "Start this chapter"},
            {"role": "assistant", "content": "What detail should this chapter remember?"},
        ],
    )
    resp = client.post("/v2/album/chapter-chat", headers=_AUTH, json=body)
    assert resp.status_code == 200, resp.text
    assert captured["ask_count"] == 1
    out = V2ChapterChatResponse(**resp.json()["data"])
    assert out.state == "brief_ready"


def test_chapter_chat_requires_auth(client):
    resp = client.post("/v2/album/chapter-chat", json=_chapter_body())
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "AGENT_UNAUTHORIZED"


def test_chapter_chat_rejects_unknown_field(client):
    resp = client.post("/v2/album/chapter-chat", headers=_AUTH, json=_chapter_body(extra="no"))
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "AGENT_INVALID_INPUT"


def test_chapter_chat_deepseek_failure_maps_to_planning_failed(client, monkeypatch):
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    from src import settings as s

    s.reset_settings_cache()

    async def boom(_req, *, ask_count, complete=None):
        raise v2_album.ChapterChatError("upstream exploded")

    monkeypatch.setattr(v2_album.chapter_chat, "run", boom)

    try:
        resp = client.post("/v2/album/chapter-chat", headers=_AUTH, json=_chapter_body())
    finally:
        s.reset_settings_cache()

    assert resp.status_code == 502
    assert resp.json()["error"]["code"] == "AGENT_PLANNING_FAILED"
