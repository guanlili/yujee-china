"""Init first-pass writing (#161).

These tests exercise the new `writing` stage inside `POST /v2/album/init`:
init writes the WHOLE first draft (auto-theme + cover copy + every chapter's
body copy) right after the deterministic skeleton, concurrently, with NO
conversation. They run in REAL pipeline mode with the DeepSeek call mocked at
`ai_client.chat_completion`, so the prompt/coercion/grounding wiring is real but
no upstream API is hit.

Coverage:
  * full pipeline: cover + every chapter written, chapters at state='generated',
    texts land in pages, planning usage aggregated.
  * grounding: a model that invents proper nouns (people/places not in the
    chapter material) has them scrubbed from the written copy.
  * failure granularity: one chapter/cover failing fails the whole init →
    AGENT_PLANNING_FAILED at stage='writing' (init/failed refund path) and no
    completed callback.
  * concurrency: the cover + N chapters never run more than
    INIT_WRITE_CONCURRENCY in flight at once (semaphore honored).
"""

import asyncio
import json
from typing import Any

import pytest

from src.routes import v2_album
from src.schemas_v2 import AlbumDraft, V2InitPhoto, V2InitRequest
from src.services import ai_client
from src.services import callback as cb_mod


@pytest.fixture
def captured_callbacks(monkeypatch):
    received: list[dict[str, Any]] = []

    async def fake_post(callback_url: str, envelope: Any) -> bool:
        received.append(envelope.model_dump(exclude_none=True, mode="json"))
        return True

    monkeypatch.setattr(cb_mod, "post", fake_post)
    return received


@pytest.fixture
def real_mode(monkeypatch):
    """Switch to real pipeline mode with a DeepSeek key present, so init takes
    the real writing path (we mock the HTTP call separately). Vision still
    short-circuits because tests never call it on a real model here — init's
    vision uses vision_mock only in mock mode, so we patch vision_analyze too."""
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test_key")
    from src import settings as s

    s.reset_settings_cache()

    # Real mode would call the upstream vision model; stub it with the mock
    # analyzer so the test exercises only the writing stage on the real branch.
    from src.services import vision_mock

    async def fake_vision(layout_req):
        return vision_mock.analyze(layout_req), None, "doubao-seed-1-6-vision-250815"

    monkeypatch.setattr(v2_album, "vision_analyze", fake_vision)
    yield
    s.reset_settings_cache()


def _photos(count: int) -> list[V2InitPhoto]:
    photos: list[V2InitPhoto] = []
    for i in range(count):
        cluster, within = divmod(i, 3)
        day = 1 + cluster
        photos.append(
            V2InitPhoto(
                photoId=f"p{i + 1}",
                base64="data:image/jpeg;base64,AAA",
                width=800 if i % 2 == 0 else 600,
                height=600 if i % 2 == 0 else 800,
                exif={"takenAt": f"2024-01-{day:02d}T10:0{within}:00Z"},
            )
        )
    return photos


def _req(count: int, request_id: str = "req_w") -> V2InitRequest:
    return V2InitRequest(
        requestId=request_id,
        albumId="alb_w",
        callbackUrl="http://example.com/cb",
        language="en",
        meta={"promptHint": "A spring trip"},
        photos=_photos(count),
    )


def _completion(payload: dict, prompt_tokens: int = 11, completion_tokens: int = 7):
    return {
        "choices": [{"message": {"content": json.dumps(payload, ensure_ascii=False)}}],
        "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens},
    }


def _is_theme_prompt(messages: list[dict]) -> bool:
    # The theme service's system prompt mentions V2ThemeResponse / cover; the
    # writing service's mentions pagesTexts and "first draft".
    return "V2ThemeResponse" in messages[0]["content"]


# ---------------------------------------------------------------------------


def test_init_writing_fills_cover_and_all_chapters(real_mode, captured_callbacks, monkeypatch):
    async def fake_chat(**kwargs):
        messages = kwargs["messages"]
        if _is_theme_prompt(messages):
            # Subject is grounded: "Opening" is a known cluster label in the mock
            # material, "days" is lowercase (not a proper-noun candidate), so it
            # survives the cover scrub verbatim (the scrub only drops UNKNOWN
            # proper nouns — see test_init_writing_scrubs_invented_proper_nouns_from_cover).
            return _completion(
                {
                    "theme": {"subject": "Opening days", "tone": "warm", "style": "warm-film"},
                    "cover": {"texts": {"title": "Opening days"}},
                    "assistantReply": "Set a warm spring theme.",
                }
            )
        # writing prompt → one body line per page
        payload = json.loads(messages[1]["content"])
        pages = payload["pageSlots"].keys()
        return _completion(
            {
                "pagesTexts": [
                    {"pageIndex": int(idx), "texts": {"body": "We wandered in soft light."}}
                    for idx in pages
                ]
            }
        )

    monkeypatch.setattr(ai_client, "chat_completion", fake_chat)
    asyncio.run(v2_album._run_init(_req(10)))

    completed = [c for c in captured_callbacks if c["event"] == "completed"]
    assert len(completed) == 1, captured_callbacks
    assert not [c for c in captured_callbacks if c["event"] == "failed"]

    draft = AlbumDraft(**completed[0]["draftTree"])
    # auto theme + cover copy written.
    assert draft.meta.theme is not None
    assert draft.meta.theme.subject == "Opening days"
    # The cover template's heading slot carries the auto-picked subject (slot id
    # depends on the chosen cover template; assert the copy made it in).
    assert "Opening days" in draft.basePages.cover.texts.values()
    # every chapter generated + carries written page texts.
    assert draft.chapters
    for chapter in draft.chapters:
        assert chapter.state == "generated"
        assert any(page.texts for page in chapter.pages)
    # planning usage aggregated across cover + chapters.
    assert completed[0]["usage"]["planningInputTokens"] > 0


def test_init_writing_is_grounded_and_scrubs_invented_proper_nouns(
    real_mode, captured_callbacks, monkeypatch
):
    """The model invents people/places not present in the chapter material; the
    written copy must not carry them (mirrors chapter_chat skipped grounding)."""

    async def fake_chat(**kwargs):
        messages = kwargs["messages"]
        if _is_theme_prompt(messages):
            return _completion(
                {
                    "theme": {"subject": "memories", "tone": "warm", "style": "warm-film"},
                    "assistantReply": "ok",
                }
            )
        payload = json.loads(messages[1]["content"])
        pages = list(payload["pageSlots"].keys())
        # Stuff invented names into every page's body/title.
        return _completion(
            {
                "pagesTexts": [
                    {
                        "pageIndex": int(idx),
                        "texts": {
                            "title": "Alice and Ken in Kyoto",
                            "body": "We met Bjorn at the Golden Gate Bridge in Shibuya.",
                        },
                    }
                    for idx in pages
                ]
            }
        )

    monkeypatch.setattr(ai_client, "chat_completion", fake_chat)
    asyncio.run(v2_album._run_init(_req(6)))

    completed = next(c for c in captured_callbacks if c["event"] == "completed")
    draft = AlbumDraft(**completed["draftTree"])
    all_text = " ".join(
        text
        for chapter in draft.chapters
        for page in chapter.pages
        for text in page.texts.values()
    )
    for invented in ("Alice", "Ken", "Bjorn", "Kyoto", "Shibuya", "Golden Gate Bridge"):
        assert invented not in all_text, invented


def test_init_writing_scrubs_invented_proper_nouns_from_cover(
    real_mode, captured_callbacks, monkeypatch
):
    """MUST-FIX (#161): the cover is the book's most prominent text, but the theme
    service only length-clamps it. An invented name on the theme subject / cover
    slots must be scrubbed by the SAME grounding heuristic the chapters use, against
    the album-wide allowed-noun set. Mock-mode vision yields no real place names, so
    'Sarah'/'Tuscany' are unknown proper nouns and must NOT survive on the cover."""

    async def fake_chat(**kwargs):
        messages = kwargs["messages"]
        if _is_theme_prompt(messages):
            # Model invents a person + place straight onto the theme subject and
            # cover title/heading/body — the highest-visibility slots.
            return _completion(
                {
                    "theme": {
                        "subject": "Sarah in Tuscany",
                        "tone": "warm",
                        "style": "warm-film",
                    },
                    "cover": {
                        "texts": {
                            "title": "Sarah in Tuscany",
                            "heading": "Sarah in Tuscany",
                            "body": "A summer with Sarah across Tuscany.",
                        }
                    },
                    "assistantReply": "Set a warm theme.",
                }
            )
        # chapters: grounded fallback only (no pagesTexts).
        return _completion({"pagesTexts": []})

    monkeypatch.setattr(ai_client, "chat_completion", fake_chat)
    asyncio.run(v2_album._run_init(_req(6)))

    completed = next(c for c in captured_callbacks if c["event"] == "completed")
    assert not [c for c in captured_callbacks if c["event"] == "failed"], captured_callbacks
    draft = AlbumDraft(**completed["draftTree"])

    # The invented person/place must be absent from BOTH the theme subject and the
    # cover texts (title/heading/body), not just the chapter pages.
    assert draft.meta.theme is not None
    subject = draft.meta.theme.subject or ""
    cover_texts = draft.basePages.cover.texts
    cover_blob = " ".join([subject, *cover_texts.values()])
    for invented in ("Sarah", "Tuscany"):
        assert invented not in cover_blob, (invented, subject, cover_texts)
    # Scrubbing must leave the cover non-empty (deterministic grounded fallback).
    assert subject.strip()
    assert any(v.strip() for v in cover_texts.values())


def test_init_writing_chapter_failure_fails_whole_init_and_releases_hold(
    real_mode, captured_callbacks, monkeypatch
):
    """One chapter's model call raising → whole init FAILED at stage='writing'
    with AGENT_PLANNING_FAILED and no completed callback. Web maps init/failed →
    album FAILED + credit release (charge-at-init refund path); we assert the
    Agent emits exactly that terminal failure."""
    calls = {"n": 0}

    async def fake_chat(**kwargs):
        messages = kwargs["messages"]
        if _is_theme_prompt(messages):
            return _completion(
                {"theme": {"subject": "x", "tone": "warm", "style": "warm-film"}, "assistantReply": "ok"}
            )
        calls["n"] += 1
        if calls["n"] == 2:  # fail the 2nd chapter write
            raise ai_client.AIRequestError("deepseek exploded")
        return _completion({"pagesTexts": []})

    monkeypatch.setattr(ai_client, "chat_completion", fake_chat)
    asyncio.run(v2_album._run_init(_req(10)))

    failed = [c for c in captured_callbacks if c["event"] == "failed"]
    assert len(failed) == 1, captured_callbacks
    assert failed[0]["jobKind"] == "init"
    assert failed[0]["error"]["code"] == "AGENT_PLANNING_FAILED"
    assert failed[0]["stage"] == "writing"
    assert not [c for c in captured_callbacks if c["event"] == "completed"]
    # failure path resets the writing bar to 0 before failing (no jump-to-fail).
    writing_progress = [
        c["progress"] for c in captured_callbacks
        if c["event"] == "progress" and c["stage"] == "writing"
    ]
    assert writing_progress[-1] == 0


def _is_vision_prompt(messages: list[dict]) -> bool:
    # vision.analyze's system prompt is the only one mentioning "photos and groups".
    return "photos and groups" in messages[0]["content"]


def test_init_reports_openai_vision_model_when_provider_openai(captured_callbacks, monkeypatch):
    """P1 (#166): init/add main chain must report the model the slot ACTUALLY hit.
    With vision_provider=openai the real vision path runs through select_vision_slot
    (we mock only the HTTP call, not vision_analyze), and the completed callback's
    Usage.models.vision must be openai_vision_model — not the hardwired ark default.
    Regression guard for the old `vision_model = settings.ark_vision_model` bug."""
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test_key")
    monkeypatch.setenv("VISION_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "test_oai_key")
    from src import settings as s

    s.reset_settings_cache()

    def _vision_payload(count: int) -> dict:
        return {
            "photos": [
                {
                    "description": f"Photo {i + 1}",
                    "tags": ["memoir", "trip"],
                    "quality": "detail",
                    "orientation": "landscape",
                    "peopleCount": "1",
                    "scene": "outdoor",
                    "mood": "warm",
                    "timeOfDay": "day",
                    "location": None,
                }
                for i in range(count)
            ],
            "groups": [],
        }

    async def fake_chat(**kwargs):
        messages = kwargs["messages"]
        if _is_vision_prompt(messages):
            # Real vision path resolved the openai slot: it must NOT carry doubao's
            # `thinking` knob and must request a json_object response_format.
            assert kwargs.get("extra_body") is None
            assert kwargs.get("response_format") == {"type": "json_object"}
            assert kwargs["model"] == "gpt-5.5-mini"
            return _completion(_vision_payload(6))
        if _is_theme_prompt(messages):
            return _completion(
                {"theme": {"subject": "x", "tone": "warm", "style": "warm-film"}, "assistantReply": "ok"}
            )
        return _completion({"pagesTexts": []})

    monkeypatch.setattr(ai_client, "chat_completion", fake_chat)
    try:
        asyncio.run(v2_album._run_init(_req(6)))
    finally:
        s.reset_settings_cache()

    completed = [c for c in captured_callbacks if c["event"] == "completed"]
    assert len(completed) == 1, captured_callbacks
    assert not [c for c in captured_callbacks if c["event"] == "failed"]
    assert completed[0]["usage"]["models"]["vision"] == "gpt-5.5-mini"
    assert completed[0]["usage"]["visionCallCount"] == 1


def test_init_writing_respects_concurrency_limit(real_mode, captured_callbacks, monkeypatch):
    """The semaphore must cap how many cover/chapter writes run at once."""
    monkeypatch.setenv("INIT_WRITE_CONCURRENCY", "2")
    from src import settings as s

    s.reset_settings_cache()

    state = {"current": 0, "max": 0}
    lock = asyncio.Lock()

    async def fake_chat(**kwargs):
        async with lock:
            state["current"] += 1
            state["max"] = max(state["max"], state["current"])
        # yield so other tasks can pile up if the semaphore allowed them to.
        await asyncio.sleep(0.01)
        async with lock:
            state["current"] -= 1
        messages = kwargs["messages"]
        if _is_theme_prompt(messages):
            return _completion(
                {"theme": {"subject": "x", "tone": "warm", "style": "warm-film"}, "assistantReply": "ok"}
            )
        return _completion({"pagesTexts": []})

    monkeypatch.setattr(ai_client, "chat_completion", fake_chat)
    # 30 photos → 10 chapters + 1 cover = 11 units, plenty to saturate a cap of 2.
    asyncio.run(v2_album._run_init(_req(30)))

    assert not [c for c in captured_callbacks if c["event"] == "failed"], captured_callbacks
    assert state["max"] <= 2, state["max"]
    assert state["max"] >= 2, "expected the cap to actually be reached"
