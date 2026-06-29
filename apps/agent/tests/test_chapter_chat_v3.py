"""WP2.1 (#185) — V3 chapter-chat turn state machine + sync endpoint.

Exercises the per-turn dispatch (引导/写/改 free interleaving, §4.2(2)) of the new
V3 service (`chapter_chat_v3`, Option B — v2 `chapter_chat.py` untouched) plus the
`POST /v3/chapter-chat` sync route: kind classification, the write turn filling
every page, the edit turn rewriting only the focused page, the talk turn returning
no patch, the slot/ maxChars guardrails, the auth gate, and the contract-shaped
error path. The DeepSeek call is injected (`complete=`) so the turn outputs are
deterministic; two-end contract parity is checked by re-validating the response
against V3ChapterChatResponse.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from src.schemas import (
    Page,
    V3Chapter,
    V3ChapterChatRequest,
    V3ChapterChatResponse,
    V3ChapterPhoto,
)
from src.agents.writing import handler as chapter_chat_v3
from src.agents.writing import ChapterChatV3Error

# Real template ids (packages/contracts/templates): mag-13 authored slots =
# title(maxChars 24) + explain; mag-04 = 3-image interior (explain1/explain2).
_COVER = "mag-13"
_INTERIOR = "mag-04"


def _chapter() -> V3Chapter:
    return V3Chapter(
        chapterId="ch_1",
        description="A spring trip to the coast.",
        accentColor=None,
        artFont=None,
        photos=[
            V3ChapterPhoto(
                photoId="p1",
                sceneDescription="two people on a beach",
                width=800,
                height=600,
                orientation="landscape",
                takenAt="2024-04-01T10:00:00Z",
            )
        ],
    )


def _pages() -> list[Page]:
    return [
        Page(pageIndex=0, templateId=_COVER, images={"image": "p1"}, texts={}),
        Page(pageIndex=1, templateId=_INTERIOR, images={}, texts={}),
    ]


def _req(
    *,
    user_message: str = "tell me about it",
    history: list[dict[str, str]] | None = None,
    focused: int | None = None,
    pages: list[Page] | None = None,
) -> V3ChapterChatRequest:
    # focusedPageIndex is an optional int (default sentinel = absent, not nullable
    # under strict mode) — omit the key when there is no focus rather than pass None.
    extra = {"focusedPageIndex": focused} if focused is not None else {}
    return V3ChapterChatRequest(
        albumId="alb_v3",
        language="en",
        chapter=_chapter(),
        pages=pages or _pages(),
        history=history or [],
        userMessage=user_message,
        **extra,
    )


def _fake_complete(payload: dict[str, Any]):
    """Return an injectable `complete` that answers with a fixed model JSON."""

    async def complete(*, messages, max_tokens, temperature):  # noqa: ANN001
        return {
            "choices": [{"message": {"content": json.dumps(payload)}}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 7},
        }

    return complete


def _run(req: V3ChapterChatRequest, payload: dict[str, Any]) -> V3ChapterChatResponse:
    return asyncio.run(chapter_chat_v3.run(req, complete=_fake_complete(payload)))


# ---------- talk turn (引导) --------------------------------------------------


def test_talk_turn_returns_reply_only():
    resp = _run(
        _req(user_message="hi"),
        {"kind": "talk", "assistantReply": "What made this trip special?"},
    )
    assert resp.kind == "talk"
    assert resp.assistantReply == "What made this trip special?"
    # 引导 never carries a patch (Frame 4 红线).
    assert resp.pagesTexts is None
    assert resp.layoutPatch is None


def test_unknown_kind_defaults_to_talk_never_autowrites():
    resp = _run(_req(), {"kind": "garbage", "assistantReply": "Go on?"})
    assert resp.kind == "talk"
    assert resp.pagesTexts is None


# ---------- write turn (写) ---------------------------------------------------


def test_write_turn_fills_every_page_and_clamps():
    long_title = "x" * 100  # mag-13 title maxChars = 24
    resp = _run(
        _req(user_message="write it now"),
        {
            "kind": "write",
            "assistantReply": "Done.",
            "pagesTexts": [
                {"pageIndex": 0, "texts": {"title": long_title, "explain": "A coast story."}},
                {"pageIndex": 1, "texts": {"explain1": "Main square.", "explain2": "A second memory."}},
            ],
            "nameOptions": ["Coast Days", "Coast Days", "Salt Air", ""],
        },
    )
    assert resp.kind == "write"
    assert resp.pagesTexts is not None
    by_index = {p.pageIndex: p.texts for p in resp.pagesTexts}
    # Every page comes back with all authored slots filled.
    assert set(by_index) == {0, 1}
    assert by_index[1] == {"explain1": "Main square.", "explain2": "A second memory."}
    # title clamped to maxChars 24; authored explain kept.
    assert len(by_index[0]["title"]) == 24
    assert by_index[0]["explain"] == "A coast story."
    # nameOptions de-duped + empties dropped, ≤4.
    assert resp.nameOptions == ["Coast Days", "Salt Air"]


def test_write_omitted_authored_page_degrades_to_talk():
    resp = _run(
        _req(user_message="write it now"),
        {
            "kind": "write",
            "assistantReply": "Done.",
            "pagesTexts": [
                {"pageIndex": 0, "texts": {"title": "Coast", "explain": "A coast story."}},
                # page 1 has authored slots and is omitted by the model.
            ],
        },
    )
    assert resp.kind == "talk"
    assert resp.pagesTexts is None


def test_write_missing_required_slot_degrades_to_talk():
    resp = _run(
        _req(user_message="write it now"),
        {
            "kind": "write",
            "assistantReply": "Done.",
            "pagesTexts": [
                {"pageIndex": 0, "texts": {"title": "Coast", "explain": "A coast story."}},
                # mag-04 also requires explain2.
                {"pageIndex": 1, "texts": {"explain1": "Main square."}},
            ],
        },
    )
    assert resp.kind == "talk"
    assert resp.pagesTexts is None


def test_write_drops_illegal_slot_ids():
    resp = _run(
        _req(user_message="generate"),
        {
            "kind": "write",
            "assistantReply": "Done.",
            "pagesTexts": [
                {
                    "pageIndex": 0,
                    "texts": {
                        "title": "Coast",
                        "explain": "A coast story.",
                        "folio": "9",
                        "bogus": "x",
                    },
                },
                {"pageIndex": 1, "texts": {"explain1": "Main square.", "explain2": "A second memory."}},
            ],
        },
    )
    texts = {p.pageIndex: p.texts for p in resp.pagesTexts}[0]
    # folio is decoration (code-filled, not authored) and bogus is unknown → dropped.
    assert texts == {"title": "Coast", "explain": "A coast story."}


def test_write_expands_repeat_text_slots_from_page_images():
    page = Page(
        pageIndex=2,
        templateId="mag-10",
        images={"image[0]": "p1", "image[1]": "p1"},
        texts={},
    )
    resp = _run(
        _req(user_message="write this grid", pages=[page]),
        {
            "kind": "write",
            "assistantReply": "Done.",
            "pagesTexts": [
                {
                    "pageIndex": 2,
                    "texts": {
                        "explain[0]": "a" * 100,
                        "explain[1]": "Second cell.",
                        "folio": "9",
                    },
                }
            ],
        },
    )
    assert resp.kind == "write"
    texts = resp.pagesTexts[0].texts
    assert set(texts) == {"explain[0]", "explain[1]"}
    assert len(texts["explain[0]"]) == 90
    assert texts["explain[1]"] == "Second cell."


def test_repeat_item_hint_passes_through_to_expanded_slots():
    page = Page(
        pageIndex=2,
        templateId="mag-10",
        images={"image[0]": "p1", "image[1]": "p1"},
        texts={},
    )
    _, user = _system_user(_req(user_message="write this grid", pages=[page]))
    payload = json.loads(user)
    page_slots = {s["id"]: s for s in payload["pageSlots"]["2"]}

    assert page_slots["explain[0]"]["hint"] == "每格图说:一句话点出这张照片"
    assert page_slots["explain[1]"]["hint"] == "每格图说:一句话点出这张照片"


# ---------- edit turn (改) ----------------------------------------------------


def test_edit_turn_rewrites_only_focused_page():
    resp = _run(
        _req(user_message="make page 0 warmer", focused=0),
        {
            "kind": "edit",
            "assistantReply": "Warmer now.",
            "pageTexts": {"pageIndex": 0, "texts": {"title": "Golden Coast"}},
        },
    )
    assert resp.kind == "edit"
    assert resp.layoutPatch is not None and len(resp.layoutPatch) == 1
    patch = resp.layoutPatch[0]
    assert patch.pageIndex == 0
    assert patch.texts == {"title": "Golden Coast"}
    # Pure-text edit never changes templateId/images (photo升级 is WP2.3).
    assert patch.templateId is None
    assert patch.images is None


def test_edit_without_focus_degrades_to_talk():
    resp = _run(
        _req(user_message="change this page"),  # no focusedPageIndex
        {
            "kind": "edit",
            "assistantReply": "Which page?",
            "pageTexts": {"pageIndex": 0, "texts": {"title": "x"}},
        },
    )
    # No focus → nothing to edit → talk (never fabricate a patch).
    assert resp.kind == "talk"
    assert resp.layoutPatch is None


def test_edit_with_no_usable_texts_degrades_to_talk():
    resp = _run(
        _req(user_message="swap the photo", focused=0),
        {
            "kind": "edit",
            "assistantReply": "Want a different photo here?",
            "pageTexts": {"pageIndex": 0, "texts": {}},
        },
    )
    # Image-leaning edit with no text patch → talk seam (WP2.3 owns photo change).
    assert resp.kind == "talk"
    assert resp.layoutPatch is None


# ---------- model failure -----------------------------------------------------


def test_non_json_response_raises():
    async def bad_complete(*, messages, max_tokens, temperature):  # noqa: ANN001
        return {"choices": [{"message": {"content": "not json at all"}}]}

    with pytest.raises(ChapterChatV3Error):
        asyncio.run(chapter_chat_v3.run(_req(), complete=bad_complete))


# ---------- route: auth + contract shape -------------------------------------


def _client() -> TestClient:
    # Import lazily so the autouse secret fixture (conftest) sets env before
    # src.main runs get_settings() at import time (mirrors test_v2_theme_chat).
    from src.main import app

    return TestClient(app)


def _route_body() -> dict[str, Any]:
    return {
        "albumId": "alb_v3",
        "language": "en",
        "chapter": _chapter().model_dump(),
        "pages": [p.model_dump() for p in _pages()],
        "history": [],
        "userMessage": "tell me about it",
    }


def test_route_requires_auth():
    res = _client().post("/v3/chapter-chat", json=_route_body())
    assert res.status_code == 401


def test_route_happy_path_returns_contract_envelope(monkeypatch):
    async def fake_run(req, *, complete=None):  # noqa: ANN001
        return V3ChapterChatResponse(
            kind="talk",
            assistantReply="Tell me more.",
            usage=req_usage(),
        )

    monkeypatch.setattr(chapter_chat_v3, "run", fake_run)
    res = _client().post(
        "/v3/chapter-chat",
        json=_route_body(),
        headers={"Authorization": "Bearer test_secret"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    # Re-validate against the V3 contract (two-end parity: schemas.py ↔ v3.ts).
    parsed = V3ChapterChatResponse(**body["data"])
    assert parsed.kind == "talk"
    assert parsed.assistantReply == "Tell me more."


def test_route_planning_failure_is_502_contract_error(monkeypatch):
    async def boom(req, *, complete=None):  # noqa: ANN001
        raise ChapterChatV3Error("model exploded")

    monkeypatch.setattr(chapter_chat_v3, "run", boom)
    res = _client().post(
        "/v3/chapter-chat",
        json=_route_body(),
        headers={"Authorization": "Bearer test_secret"},
    )
    assert res.status_code == 502
    body = res.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "AGENT_PLANNING_FAILED"


def req_usage():
    from src.schemas import V3Models, V3Usage

    return V3Usage(durationMs=1, models=V3Models(planning="deepseek-chat"))


# ---------- WP2.2 (#186): writing-LM input assembly ---------------------------
# §4.2(4): the write turn's prompt must carry 用户信息 + 写作 Skill + 逐槽 hint +
# 画面背景 + 页面结构, and the V3 path must NOT fall back on v2's ROLE_GUIDES
# 创作话术. These exercise build_messages directly (the assembly is deterministic;
# no model call needed).


def _system_user(req: V3ChapterChatRequest) -> tuple[str, str]:
    messages = chapter_chat_v3.build_messages(req)
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    return messages[0]["content"], messages[1]["content"]


def test_assembly_carries_all_section_4_2_4_items():
    system, user = _system_user(_req(user_message="write it"))

    # 写作 Skill + 引导 Skill loaded into the system prompt (not inlined code).
    assert "写作风格" in system and "引导风格" in system
    # A line unique to the example-driven writing-style asset (proves it loaded).
    assert "输出示例" in system

    payload = json.loads(user)
    # 用户信息: this turn's message + history channel present.
    assert payload["userMessage"] == "write it"
    assert "history" in payload
    # 画面背景: chapter description + per-photo sceneDescription (§4.1 tree).
    bg = payload["sceneBackground"]
    assert bg["chapterDescription"] == "A spring trip to the coast."
    assert bg["photos"] == [{"photoId": "p1", "sceneDescription": "two people on a beach"}]
    # 页面结构: per-page slot specs + which photos sit on each page.
    assert set(payload["pageSlots"]) == {"0", "1"}
    assert payload["pageImages"]["0"] == {"image": "p1"}
    assert payload["pageImages"]["1"] == {}


def test_per_slot_hint_passes_through_to_writing_lm():
    # mag-13 (page 0) authored slots carry template hints; they must reach the LM.
    _, user = _system_user(_req(user_message="write it"))
    payload = json.loads(user)
    page0_slots = {s["id"]: s for s in payload["pageSlots"]["0"]}
    assert page0_slots["title"]["hint"]  # template-authored hint, passed verbatim
    assert page0_slots["explain"]["hint"]
    # Sanity: the hint is the template's, not invented by the Agent.
    from src.agents.writing import guides as writing_guides

    expected = {s["id"]: s.get("hint") for s in writing_guides.page_slot_specs(_COVER)}
    assert page0_slots["title"]["hint"] == expected["title"]


def test_model_facing_slot_specs_drop_maxchars_and_role():
    # Example-driven: the per-slot spec the model sees keeps id/lang(/hint), but never
    # maxChars (no char-length in the prompt) or role (the output example conveys it).
    _, user = _system_user(_req(user_message="write it"))
    payload = json.loads(user)
    for specs in payload["pageSlots"].values():
        for spec in specs:
            assert "maxChars" not in spec
            assert "role" not in spec
            assert "lang" in spec  # language still needed


def test_page_output_examples_present_for_template_with_copy_example():
    # mag-13 (page 0) has a copy-example file → the page carries an outputExample keyed
    # by its authored slot ids; the strings are the template's static example copy.
    _, user = _system_user(_req(user_message="write it"))
    payload = json.loads(user)
    examples = payload["pageOutputExamples"]
    page0 = examples["0"]
    page0_slots = {s["id"] for s in payload["pageSlots"]["0"]}
    # example is restricted to this page's authored slots…
    assert set(page0.keys()) <= page0_slots
    assert page0  # …and non-empty for a template that ships example copy
    # the example value is the template's static copy (verbatim from copy-examples).
    from src.engine import templates as registry

    src_example = registry.copy_example(_COVER)
    for slot_id, text in page0.items():
        assert src_example[slot_id] == text


def test_page_output_examples_omitted_when_template_has_no_example():
    # mag-20 ships no copy-example file → graceful degrade: that page is simply absent
    # from pageOutputExamples (still gets hint+lang via pageSlots), never crashes.
    page = Page(pageIndex=0, templateId="mag-20", images={"image": "p1"}, texts={})
    _, user = _system_user(_req(user_message="write it", pages=[page]))
    payload = json.loads(user)
    assert "0" not in payload["pageOutputExamples"]
    assert "0" in payload["pageSlots"]  # slots (hint+lang) still sent


def test_repeat_group_output_example_keys_align_with_expanded_slots():
    # mag-10 grid: copy-example keys repeats as explain[0..3]; the page with image[0]/
    # image[1] expands slots explain[0]/explain[1], so the example is restricted to
    # exactly those — bracket keys line up with the expanded slot ids.
    page = Page(
        pageIndex=2,
        templateId="mag-10",
        images={"image[0]": "p1", "image[1]": "p1"},
        texts={},
    )
    _, user = _system_user(_req(user_message="write this grid", pages=[page]))
    payload = json.loads(user)
    example = payload["pageOutputExamples"]["2"]
    assert set(example.keys()) == {"explain[0]", "explain[1]"}
    assert example["explain[0]"] and example["explain[1]"]


def test_page_slot_specs_surfaces_hint_when_template_has_one():
    from src.agents.writing import guides as writing_guides

    specs = {s["id"]: s for s in writing_guides.page_slot_specs(_COVER)}
    # mag-13 title/explain have hints in the template JSON; decoration folio is dropped.
    assert "hint" in specs["title"] and specs["title"]["hint"]
    assert "folio" not in specs  # decoration is code-filled, never authored

    # mag-10's repeat content lives in items.texts (`explain`), not a top-level
    # repeat slot, so the template-level specs expose only the (dropped) folio →
    # empty. The per-page expansion (with image indices) is what surfaces the item
    # hint as explain[i]; see test_repeat_item_hint_passes_through_to_expanded_slots.
    assert writing_guides.page_slot_specs("mag-10") == []


def test_v3_write_path_has_no_role_guides_creative_residue():
    # §4.2(4) acceptance: the V3 authoring prompt must not carry the v2 ROLE_GUIDES
    # 创作话术 (those live only in writing_guides.guides_block, kept for v2 / #197).
    from src.agents.writing import guides as writing_guides

    system, _ = _system_user(_req(user_message="write it"))
    assert writing_guides.guides_block() not in system
    # The signature v2 line must be absent from the V3 prompt.
    assert "Write each text slot to its role" not in system


def test_assembly_loads_style_assets_without_language_pinning():
    # 写作/引导风格已外置到 src/skills/(人为可调 skill),作为 prompt 资产按路径加载。
    # 语言不再被 {LANGUAGE} 强制 —— 槽位的 lang 标记决定语言(lang=user 跟随用户语言),
    # 所以两份风格资产都【原样】(无任何语言填充)出现在 system 里。
    extra = {"language": "zh"}
    req = V3ChapterChatRequest(
        albumId="alb_v3",
        chapter=_chapter(),
        pages=_pages(),
        history=[],
        userMessage="写吧",
        **extra,
    )
    system, _ = _system_user(req)
    from src.skills import SKILLS_DIR, load_prompt

    assert load_prompt(SKILLS_DIR / "writing_style.md", skills=("grounding",)) in system
    assert load_prompt(SKILLS_DIR / "guidance_style.md") in system
