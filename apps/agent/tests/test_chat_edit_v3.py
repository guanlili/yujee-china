"""WP2.3 (#187) — 改页图文分流: 纯文字→DeepSeek / 涉及图片→识图出意图+确定性执行.

Exercises the图文分流 seam (Option B: NEW V3 module `chat_edit_v3`, v2 untouched):

  ① A pure-text edit turn (editTarget absent/"text") rewrites the focused page's
     texts via DeepSeek and NEVER invokes the recognition (vision) model — proven
     by spying on `chat_edit_v3.run_image_edit` (zero calls) and on the vision
     provider slot resolvers (never reached).
  ② An image-leaning edit turn (editTarget=="image", e.g. 换图/挪图) upgrades the
     recognition model in: it emits a structured photoId INTENT, and the
     deterministic V3 engine (`pick_template_v3`/`assign_images_v3`) executes it
     into a full-page layoutPatch (templateId + images), not the model.
  ③ The model NEVER directly authors a templateId or pageIndex — a phantom photoId
     is dropped, the engine still picks a legal template, and an empty/unusable
     intent degrades to a talk turn (never fabricates a layout).

The recognition-model intent call is injected (`call_intent=`) so no real provider
is hit and the engine output is deterministic; response parity is re-checked
against the V3 contract where relevant.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from src.engine import templates
from src.schemas import (
    Page,
    V3Chapter,
    V3ChapterChatRequest,
    V3ChapterChatResponse,
    V3ChapterPhoto,
    V3EditChatRequest,
)
from src.agents.editing import handler as edit_handler
from src.agents.writing import handler as chapter_chat_v3
from src.agents.image_edit_intent import handler as chat_edit_v3
from src.engine import gemini_layout, skeleton_v3

# mag-04 is a 3-image interior template (matches test_chapter_chat_v3 baseline).
_INTERIOR_3 = "mag-04"


def _photo(pid: str, scene: str) -> V3ChapterPhoto:
    return V3ChapterPhoto(
        photoId=pid,
        sceneDescription=scene,
        width=800,
        height=600,
        orientation="landscape",
        takenAt="2024-04-01T10:00:00Z",
    )


def _chapter() -> V3Chapter:
    return V3Chapter(
        chapterId="ch_1",
        description="A spring trip to the coast.",
        accentColor=None,
        artFont=None,
        photos=[
            _photo("p1", "two people on a beach"),
            _photo("p2", "a lighthouse at dusk"),
            _photo("p3", "a seafood dinner"),
            _photo("p4", "footprints in the sand"),
        ],
    )


def _pages() -> list[Page]:
    # Focused page (index 1) currently holds p1 + p2 on a 3-slot interior template.
    return [
        Page(pageIndex=0, templateId="mag-13", images={"image": "p1"}, texts={}),
        Page(
            pageIndex=1,
            templateId=_INTERIOR_3,
            images=_two_image_assignment(),
            texts={},
        ),
    ]


def _two_image_assignment() -> dict[str, str]:
    slot_ids = templates.image_slot_ids(templates.get(_INTERIOR_3))
    return {slot_ids[0]: "p1", slot_ids[1]: "p2"}


def _req(*, user_message: str, focused: int | None = None) -> V3ChapterChatRequest:
    extra = {"focusedPageIndex": focused} if focused is not None else {}
    return V3ChapterChatRequest(
        albumId="alb_v3",
        language="en",
        chapter=_chapter(),
        pages=_pages(),
        history=[],
        userMessage=user_message,
        **extra,
    )


def _fake_complete(payload: dict[str, Any]):
    async def complete(*, messages, max_tokens, temperature):  # noqa: ANN001
        return {
            "choices": [{"message": {"content": json.dumps(payload)}}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 7},
        }

    return complete


def _edit_req(user_message: str, *, chapter_id: str | None = "c1", page_index: int | None = 1) -> V3EditChatRequest:
    focus = {}
    if chapter_id is not None:
        focus["chapterId"] = chapter_id
    if page_index is not None:
        focus["pageIndex"] = page_index
    return V3EditChatRequest(
        albumId="alb_v3",
        language="en",
        userMessage=user_message,
        focus=focus,
        progress={"currentChapterId": chapter_id, "doneChapterIds": []},
    )


class FakeRepo:
    def __init__(self, *, op_id: str = "op_fake", committed: list[dict[str, str]] | None = None) -> None:
        self.op_id = op_id
        self.committed = committed or []
        self.created: list[dict[str, Any]] = []
        self.history_args: dict[str, Any] | None = None

    async def list_committed_messages(self, album_id: str, *, chapter_id: str | None, limit: int = 20) -> list[dict[str, str]]:
        self.history_args = {"album_id": album_id, "chapter_id": chapter_id, "limit": limit}
        return self.committed

    async def create_pending_turn(self, **kwargs: Any) -> str:
        self.created.append({**kwargs, "status": "pending"})
        return self.op_id


class FakeTools:
    def __init__(self, *, page_photos: list[dict[str, Any]] | None = None) -> None:
        self.page_photos = page_photos or []
        self.page_photo_requests: list[dict[str, str]] = []

    async def get_page_photos(self, *, albumId: str, chapterId: str) -> list[dict[str, Any]]:
        self.page_photo_requests.append({"albumId": albumId, "chapterId": chapterId})
        return self.page_photos


def test_edit_chat_response_requires_op_id_for_write_turn():
    repo = FakeRepo(op_id="op_123")

    resp = asyncio.run(edit_handler.run(_edit_req("write this"), repo=repo, tools=FakeTools()))

    assert resp.opId == "op_123"
    assert repo.created[0]["status"] == "pending"


def test_edit_chat_history_reads_only_committed_messages():
    repo = FakeRepo(committed=[{"role": "assistant", "content": "committed only"}])

    asyncio.run(edit_handler.run(_edit_req("continue"), repo=repo, tools=FakeTools()))

    assert repo.history_args == {"album_id": "alb_v3", "chapter_id": "c1", "limit": 20}


def test_edit_chat_case4_fetches_page_photos_via_agent_data_and_calls_gemini(monkeypatch):
    tools = FakeTools(
        page_photos=[
            {
                "photoId": "p1",
                "ref200px": "data:image/jpeg;base64,AA==",
                "orientation": "landscape",
                "takenAt": None,
            }
        ]
    )
    calls: list[tuple[Any, str, bool]] = []

    async def fake_gemini(chapters, *, mode, allowAddPages):  # noqa: ANN001
        calls.append((chapters, mode, allowAddPages))
        return gemini_layout.GeminiLayoutResult(
            pages=[{"chapterId": "c1", "templateId": "mag-03", "slots": {"image": "p1"}}]
        )

    monkeypatch.setattr(edit_handler.gemini_layout, "gemini_layout", fake_gemini)

    resp = asyncio.run(edit_handler.run(_edit_req("change the layout"), repo=FakeRepo(), tools=tools))

    assert tools.page_photo_requests == [{"albumId": "alb_v3", "chapterId": "c1"}]
    assert calls[0][1:] == ("case4-swap", True)
    assert resp.patches[0].templateId == "mag-03"


# =============================================================================
# ① pure-text edit → DeepSeek only, recognition model NEVER invoked
# =============================================================================


def test_text_edit_never_invokes_recognition_model(monkeypatch):
    # Spy: if the image path (recognition model) is ever entered, record it.
    calls: list[Any] = []

    async def spy_run_image_edit(*args, **kwargs):  # noqa: ANN001, ANN002
        calls.append((args, kwargs))
        return None

    monkeypatch.setattr(chat_edit_v3, "run_image_edit", spy_run_image_edit)
    # Hard guard: even the provider slot resolvers must never be reached.
    monkeypatch.setattr(
        chat_edit_v3,
        "_intent_slot",
        lambda *_a, **_k: (_ for _ in ()).throw(
            AssertionError("recognition model slot resolved on a text edit")
        ),
    )

    resp = asyncio.run(
        chapter_chat_v3.run(
            _req(user_message="make this page warmer", focused=1),
            complete=_fake_complete(
                {
                    "kind": "edit",
                    # editTarget absent → pure-text edit by default.
                    "assistantReply": "Warmer now.",
                    "pageTexts": {"pageIndex": 1, "texts": {}},
                }
            ),
        )
    )
    # Pure-text edit stayed on DeepSeek; the recognition path was never entered.
    assert calls == []
    # Empty texts → nothing to apply → talk (never fabricate a patch).
    assert resp.kind == "talk"
    assert resp.layoutPatch is None


def test_explicit_text_target_stays_on_deepseek(monkeypatch):
    calls: list[Any] = []

    async def spy_run_image_edit(*args, **kwargs):  # noqa: ANN001, ANN002
        calls.append(1)
        return None

    monkeypatch.setattr(chat_edit_v3, "run_image_edit", spy_run_image_edit)

    resp = asyncio.run(
        chapter_chat_v3.run(
            _req(user_message="reword the caption", focused=1),
            complete=_fake_complete(
                {
                    "kind": "edit",
                    "editTarget": "text",
                    "assistantReply": "Reworded.",
                    "pageTexts": {"pageIndex": 1, "texts": {"explain1": "Salt and sun."}},
                }
            ),
        )
    )
    assert calls == []  # recognition model not invoked for a text edit
    assert resp.kind == "edit"
    assert resp.layoutPatch is not None and len(resp.layoutPatch) == 1
    patch = resp.layoutPatch[0]
    assert patch.pageIndex == 1
    assert patch.texts == {"explain1": "Salt and sun."}
    # Pure-text edit never changes templateId/images.
    assert patch.templateId is None
    assert patch.images is None


# =============================================================================
# ② image edit → recognition model out intent → deterministic engine executes
# =============================================================================


def test_image_edit_triggers_intent_and_runs_deterministic_engine():
    seen: dict[str, str] = {}

    async def fake_intent(manifest: str) -> list[str]:
        seen["manifest"] = manifest
        # User asked to add p3 + p4; model returns the new ordered placement.
        return ["p1", "p3", "p4"]

    resp = asyncio.run(
        chapter_chat_v3.run(
            _req(user_message="swap the second photo for the dinner and the footprints", focused=1),
            complete=_fake_complete(
                {
                    "kind": "edit",
                    "editTarget": "image",
                    "assistantReply": "Updated the photos.",
                }
            ),
            call_intent=fake_intent,
        )
    )
    assert resp.kind == "edit"
    assert resp.layoutPatch is not None and len(resp.layoutPatch) == 1
    patch = resp.layoutPatch[0]
    assert patch.pageIndex == 1

    # The engine (not the model) chose the templateId — it must be a legal V3
    # interior template that can hold the 3 photos.
    legal_ids = {c["templateId"] for c in skeleton_v3.legal_candidates("interior", 3)}
    assert patch.templateId in legal_ids
    # Images slotted in the model's intent order by the deterministic engine.
    assert list(patch.images.values()) == ["p1", "p3", "p4"]
    # The intent manifest carried only text (scene sentences), never base64/GPS.
    assert "base64" not in seen["manifest"]
    assert "p3" in seen["manifest"] and "lighthouse" in seen["manifest"]

    # Two-end parity: the response re-validates against the V3 contract (mirrors
    # the route serializing with None-fields omitted, as the wire envelope does).
    V3ChapterChatResponse(**resp.model_dump(exclude_none=True))


def test_image_edit_reorders_existing_photos():
    async def fake_intent(_manifest: str) -> list[str]:
        return ["p2", "p1"]  # 挪图: reorder the two existing photos

    resp = asyncio.run(
        chapter_chat_v3.run(
            _req(user_message="put the lighthouse first", focused=1),
            complete=_fake_complete(
                {"kind": "edit", "editTarget": "image", "assistantReply": "Reordered."}
            ),
            call_intent=fake_intent,
        )
    )
    patch = resp.layoutPatch[0]
    assert list(patch.images.values()) == ["p2", "p1"]
    legal_ids = {c["templateId"] for c in skeleton_v3.legal_candidates("interior", 2)}
    assert patch.templateId in legal_ids


# =============================================================================
# ③ model never authors templateId/pageIndex; hallucination is grounded out
# =============================================================================


def test_phantom_photoid_is_dropped_engine_still_picks_legal_template():
    async def fake_intent(_manifest: str) -> list[str]:
        # "p9" is not in the chapter (hallucination) + a duplicate p1.
        return ["p1", "p9", "p1", "p2"]

    resp = asyncio.run(
        chapter_chat_v3.run(
            _req(user_message="change the photos", focused=1),
            complete=_fake_complete(
                {"kind": "edit", "editTarget": "image", "assistantReply": "Done."}
            ),
            call_intent=fake_intent,
        )
    )
    patch = resp.layoutPatch[0]
    # Phantom p9 dropped, duplicate collapsed → only real chapter photos remain.
    assert list(patch.images.values()) == ["p1", "p2"]
    legal_ids = {c["templateId"] for c in skeleton_v3.legal_candidates("interior", 2)}
    assert patch.templateId in legal_ids


def test_image_intent_clamped_to_interior_capacity():
    cap = skeleton_v3.max_capacity("interior")

    async def fake_intent(_manifest: str) -> list[str]:
        # Ask for more photos than any interior template can hold.
        return ["p1", "p2", "p3", "p4", "p4", "p3", "p2", "p1"][: cap + 3]

    resp = asyncio.run(
        chapter_chat_v3.run(
            _req(user_message="put everything on this page", focused=1),
            complete=_fake_complete(
                {"kind": "edit", "editTarget": "image", "assistantReply": "Done."}
            ),
            call_intent=fake_intent,
        )
    )
    patch = resp.layoutPatch[0]
    # Clamped to capacity; engine picked a template that holds exactly that many.
    assert len(patch.images) <= cap
    assert skeleton_v3.image_capacity(templates.get(patch.templateId)) >= len(patch.images)


def test_empty_intent_degrades_to_talk_never_fabricates():
    async def fake_intent(_manifest: str) -> list[str]:
        return []  # model returned nothing usable

    resp = asyncio.run(
        chapter_chat_v3.run(
            _req(user_message="change the photo", focused=1),
            complete=_fake_complete(
                {"kind": "edit", "editTarget": "image", "assistantReply": "Hmm?"}
            ),
            call_intent=fake_intent,
        )
    )
    assert resp.kind == "talk"
    assert resp.layoutPatch is None


def test_image_edit_without_focus_degrades_to_talk():
    called = {"intent": False}

    async def fake_intent(_manifest: str) -> list[str]:
        called["intent"] = True
        return ["p1"]

    resp = asyncio.run(
        chapter_chat_v3.run(
            _req(user_message="change the photo"),  # no focusedPageIndex
            complete=_fake_complete(
                {"kind": "edit", "editTarget": "image", "assistantReply": "Which page?"}
            ),
            call_intent=fake_intent,
        )
    )
    # No focus → _resolve_kind already degrades to talk; intent never runs.
    assert resp.kind == "talk"
    assert called["intent"] is False


# =============================================================================
# unit: chat_edit_v3 module internals (engine wiring, no model)
# =============================================================================


def test_run_image_edit_carries_only_surviving_texts():
    # Focused page carries a text in a slot; after re-template, only texts whose
    # slot id still exists on the new template are carried over.
    page = Page(
        pageIndex=1,
        templateId=_INTERIOR_3,
        images=_two_image_assignment(),
        texts={"explain1": "kept if slot survives", "ghost": "dropped"},
    )

    async def fake_intent(_manifest: str) -> list[str]:
        return ["p1", "p2", "p3"]  # → mag-04 (3-slot), which has an explain1 slot

    patch = asyncio.run(
        chat_edit_v3.run_image_edit(
            _chapter(), page, "reorder", call_intent=fake_intent
        )
    )
    assert patch is not None
    new_text_slots = set(templates.text_slot_ids(templates.get(patch.templateId)))
    # Every carried text key is a real slot on the new template; "ghost" never is.
    assert set(patch.texts).issubset(new_text_slots)
    assert "ghost" not in patch.texts
    # A surviving slot's text is carried verbatim (an image change keeps the words).
    if "explain1" in new_text_slots:
        assert patch.texts["explain1"] == "kept if slot survives"


def test_run_image_edit_no_provider_returns_none(monkeypatch):
    # No call_intent injected and no provider configured → degrade (None), no raise.
    def no_slot(*_a, **_k):
        raise chat_edit_v3.ChatEditV3Error("no slot configured")

    monkeypatch.setattr(chat_edit_v3, "_intent_slot", no_slot)
    page = _pages()[1]
    patch = asyncio.run(
        chat_edit_v3.run_image_edit(_chapter(), page, "change the photo")
    )
    assert patch is None


def test_intent_slot_uses_v3_describe_openai_model(monkeypatch):
    from src import settings as s

    monkeypatch.setenv("OPENAI_API_KEY", "openai-key")
    monkeypatch.setenv("ARK_API_KEY", "ark-key")
    monkeypatch.setenv("OPENAI_VISION_MODEL", "gpt-4o-mini")
    monkeypatch.setenv("DESCRIBE_OPENAI_MODEL", "gpt-5.5-mini")
    monkeypatch.setenv("OPENAI_TIMEOUT_SECONDS", "120")
    monkeypatch.setenv("DESCRIBE_OPENAI_TIMEOUT_SECONDS", "17")
    s.reset_settings_cache()
    try:
        slot = chat_edit_v3._intent_slot(s.get_settings())
    finally:
        s.reset_settings_cache()

    assert slot.provider == "openai"
    assert slot.model == "gpt-5.5-mini"
    assert slot.timeout_seconds == 17


def test_parse_intent_rejects_non_object():
    with pytest.raises(chat_edit_v3.ChatEditV3Error):
        chat_edit_v3._parse_intent(["p1", "p2"])


def test_parse_intent_dedupes_and_drops_non_strings():
    assert chat_edit_v3._parse_intent(
        {"photoIds": ["p1", "", "p1", 7, "  p2  ", None]}
    ) == ["p1", "p2"]
