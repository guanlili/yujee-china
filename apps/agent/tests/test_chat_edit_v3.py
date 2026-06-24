"""image_edit_intent(chat_edit_v3)模块内部单元测试 —— 识图出 photoId 意图 + 确定性引擎执行。

chapter-chat 的改图分发已统一改走创作 agent loop(`author_loop`,见 test_author_loop),不再经
`editTarget=text/image` 二分调用本模块。本模块作为「vision 意图 + 引擎执行」的独立能力保留
(将来"换入新照片需 vision"时复用),这里只测它自身的引擎接线 —— 不打真实模型(call_intent 注入
或直接测内部函数)。
"""

from __future__ import annotations

import asyncio

import pytest

from src.engine import templates
from src.schemas import Page, V3Chapter, V3ChapterPhoto
from src.agents.image_edit_intent import handler as chat_edit_v3

_INTERIOR_3 = "mag-04"  # 3-image interior template


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


def _two_image_assignment() -> dict[str, str]:
    slot_ids = templates.image_slot_ids(templates.get(_INTERIOR_3))
    return {slot_ids[0]: "p1", slot_ids[1]: "p2"}


def _pages() -> list[Page]:
    return [
        Page(pageIndex=0, templateId="mag-13", images={"image": "p1"}, texts={}),
        Page(pageIndex=1, templateId=_INTERIOR_3, images=_two_image_assignment(), texts={}),
    ]


# =============================================================================
# chat_edit_v3 模块内部(引擎接线,无模型)
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
        chat_edit_v3.run_image_edit(_chapter(), page, "reorder", call_intent=fake_intent)
    )
    assert patch is not None
    new_text_slots = set(templates.text_slot_ids(templates.get(patch.templateId)))
    assert set(patch.texts).issubset(new_text_slots)
    assert "ghost" not in patch.texts
    if "explain1" in new_text_slots:
        assert patch.texts["explain1"] == "kept if slot survives"


def test_run_image_edit_no_provider_returns_none(monkeypatch):
    # No call_intent injected and no provider configured → degrade (None), no raise.
    def no_slot(*_a, **_k):
        raise chat_edit_v3.ChatEditV3Error("no slot configured")

    monkeypatch.setattr(chat_edit_v3, "_intent_slot", no_slot)
    page = _pages()[1]
    patch = asyncio.run(chat_edit_v3.run_image_edit(_chapter(), page, "change the photo"))
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
