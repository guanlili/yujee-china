"""统一创作 agent loop(author_loop)—— harness 驱动的 JSON-action 自主改页。

验证 loop 骨架 + 五工具的护栏,全程注入 `complete`(脚本化模型动作),不打真实 provider:
  ① 纯文字改:write_texts → finish,版式不变、文字按槽位钳。
  ② 换照片导致版式不够 → 工具提示 → 模型 pick_layout(回归品味,从合法候选选)→ finish。
  ③ 照片 grounding:幻觉 photoId 被过滤,只留本章的。
  ④ 非法版式被驳回,模型据反馈重选合法版式。
  ⑤ 一步没动(直接 finish)→ patch=None(降级 talk,绝不发空 patch)。
  ⑥ describe_photo 回本章照片已有的 sceneDescription(无 base64,§3)。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from src.agents.writing import author_loop
from src.agents.writing import page_text_slots as slots
from src.engine import skeleton_v3
from src.schemas import Page, V3Chapter, V3ChapterPhoto

_INTERIOR_3 = "mag-04"  # 3-image interior template (matches chapter-chat baseline)


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


def _focused_page() -> Page:
    slot_ids = skeleton_v3.image_slot_keys(skeleton_v3.templates.get(_INTERIOR_3))
    return Page(
        pageIndex=1,
        templateId=_INTERIOR_3,
        images={slot_ids[0]: "p1", slot_ids[1]: "p2"},
        texts={},
    )


def _scripted_complete(actions: list[dict[str, Any]]):
    """按调用序返回脚本化的模型动作;脚本用尽后默认 finish。"""
    state = {"i": 0}

    async def complete(*, messages, max_tokens, temperature):  # noqa: ANN001
        i = state["i"]
        state["i"] += 1
        payload = actions[i] if i < len(actions) else {"action": "finish", "args": {"reply": "ok"}}
        return {
            "choices": [{"message": {"content": json.dumps(payload)}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 3},
        }

    return complete


def _run(actions: list[dict[str, Any]], *, user_message: str = "改一下这一页"):
    return asyncio.run(
        author_loop.run_author_edit(
            _chapter(), _focused_page(), user_message, [], complete=_scripted_complete(actions)
        )
    )


def test_text_only_edit_keeps_layout_and_clamps_text():
    page = _focused_page()
    specs = slots.slot_specs_for_page(page)
    assert specs, "baseline template must expose at least one authored slot"
    slot_id = str(specs[0]["id"])

    patch, reply, usage = _run(
        [
            {"action": "write_texts", "args": {"texts": {slot_id: "Coast days"}}},
            {"action": "finish", "args": {"reply": "改好了"}},
        ]
    )
    assert patch is not None
    assert patch.templateId == _INTERIOR_3  # 纯文字改不动版式
    assert patch.texts.get(slot_id) == "Coast days"
    assert reply == "改好了"
    assert usage.planningOutputTokens == 6  # 两次调用累加(评审 N3 usage 聚合)


def test_swap_photos_triggers_repick_to_a_fitting_layout():
    four = skeleton_v3.legal_candidates("interior", 4)
    if not four:
        pytest.skip("no 4-image interior template in the library")
    target = four[0]["templateId"]

    patch, _reply, _usage = _run(
        [
            # 4 张超过当前 3 图版式 → 工具提示 pick_layout
            {"action": "set_photos", "args": {"photoIds": ["p1", "p2", "p3", "p4"]}},
            {"action": "pick_layout", "args": {"templateId": target}},
            {"action": "finish", "args": {"reply": "排好了"}},
        ]
    )
    assert patch is not None
    assert patch.templateId == target
    assert sorted(patch.images.values()) == ["p1", "p2", "p3", "p4"]


def test_set_photos_filters_phantom_ids_to_chapter_only():
    patch, _reply, _usage = _run(
        [
            {"action": "set_photos", "args": {"photoIds": ["p1", "px", "p3"]}},
            {"action": "finish", "args": {"reply": "好了"}},
        ]
    )
    assert patch is not None
    assert sorted(patch.images.values()) == ["p1", "p3"]  # px 幻觉被过滤


def test_illegal_layout_rejected_then_model_repicks():
    legal = skeleton_v3.legal_candidates("interior", 2)
    assert legal
    good = legal[0]["templateId"]
    patch, _reply, _usage = _run(
        [
            {"action": "pick_layout", "args": {"templateId": "mag-does-not-exist"}},
            {"action": "pick_layout", "args": {"templateId": good}},
            {"action": "finish", "args": {"reply": "好"}},
        ]
    )
    assert patch is not None
    assert patch.templateId == good


def test_no_action_returns_none_patch():
    patch, reply, _usage = _run([{"action": "finish", "args": {"reply": "没改动"}}])
    assert patch is None  # 一步没动 → 不发空 patch,调用方降级 talk
    assert reply == "没改动"


def test_describe_photo_returns_existing_scene():
    state = author_loop.WorkingPage.from_page(_focused_page())
    result = author_loop._tool_describe_photo({"photoId": "p2"}, state, _chapter())
    assert "lighthouse" in result
