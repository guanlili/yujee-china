"""V3 page-edit:两段式(意图路由 → 专门执行),复用完成度判定 + V3LayoutPatchEntry。

段一/段二模型调用经注入的 `complete=` / `complete_edit=` 顶替,产出确定性、不打真实模型。
覆盖:完成度纯函数(空/满/混合/grid 展开/排除代码槽)、段一四类意图分类、filled 主动问推进、
换图→talk、段二 edit_text 按槽校验(越界/非法槽拒)、change_layout 确定性合法重排、advance
置标志无执行调用、脏输出/超时→安全兜底。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from src import ai_client
from src.agents.page_edit import handler as pe
from src.schemas import Page, V3Chapter, V3ChapterPhoto, V3PageEditRequest


# ---------- fixtures ----------------------------------------------------------


def _photo(pid: str, orientation: str = "landscape") -> V3ChapterPhoto:
    return V3ChapterPhoto(
        photoId=pid,
        sceneDescription=f"scene {pid}",
        width=800,
        height=600,
        orientation=orientation,
    )


def _chapter(pids: list[str]) -> V3Chapter:
    return V3Chapter(
        chapterId="ch_1",
        description="a quiet afternoon",
        accentColor=None,
        artFont=None,
        photos=[_photo(p) for p in pids],
    )


def _req(
    pages: list[Page],
    *,
    focused: int = 0,
    user_message: str = "改一下这页",
    photos: list[str] | None = None,
) -> V3PageEditRequest:
    ids = photos if photos is not None else [v for pg in pages for v in pg.images.values()]
    return V3PageEditRequest(
        language="zh",
        chapter=_chapter(ids or ["p0"]),
        pages=pages,
        focusedPageIndex=focused,
        userMessage=user_message,
        history=[],
    )


def _complete_returning(payload: dict[str, Any]):
    async def _c(*args, **kwargs):  # noqa: ANN002, ANN003 - mirrors ai_client shape
        return {"choices": [{"message": {"content": json.dumps(payload)}}]}

    return _c


def _boom(*args, **kwargs):  # a complete that raises (model failure)
    async def _c(*a, **k):  # noqa: ANN002, ANN003
        raise ai_client.AIRequestError("upstream 500", status_code=500, kind="5xx")

    return _c


# ---------- 完成度纯函数 ------------------------------------------------------


def test_page_filled_empty_slots_template_is_always_filled():
    # mag-03 (1 image) has NO authored text slots → nothing required → filled.
    p = Page(pageIndex=0, templateId="mag-03", images={"image": "p0"}, texts={})
    assert pe.page_filled(p) is True


def test_page_filled_full_vs_partial_vs_empty():
    # mag-05 (1 image) requires authored slots title + explain.
    full = Page(
        pageIndex=0,
        templateId="mag-05",
        images={"image": "p0"},
        texts={"title": "T", "explain": "E"},
    )
    partial = Page(pageIndex=0, templateId="mag-05", images={"image": "p0"}, texts={"title": "T"})
    empty = Page(pageIndex=0, templateId="mag-05", images={"image": "p0"}, texts={})
    assert pe.page_filled(full) is True
    assert pe.page_filled(partial) is False
    assert pe.page_filled(empty) is False


def test_page_filled_grid_expands_per_image_key():
    # mag-10 grid: items.texts authored `explain` expands to explain[0], explain[1]
    # for image keys image[0], image[1].
    full = Page(
        pageIndex=0,
        templateId="mag-10",
        images={"image[0]": "p0", "image[1]": "p1"},
        texts={"explain[0]": "a", "explain[1]": "b"},
    )
    missing_one = Page(
        pageIndex=0,
        templateId="mag-10",
        images={"image[0]": "p0", "image[1]": "p1"},
        texts={"explain[0]": "a"},
    )
    assert pe.page_filled(full) is True
    assert pe.page_filled(missing_one) is False


def test_page_filled_ignores_code_filled_decoration_slots():
    # mag-37 authored slots are body + decor(role title). decoration-role slots are
    # already excluded by page_slot_specs (code fills them); supplying only the
    # authored slots is enough.
    p = Page(
        pageIndex=0,
        templateId="mag-37",
        images={"image": "p0"},
        texts={"body": "b", "decor": "d"},
    )
    assert pe.page_filled(p) is True


def test_chapter_completion_aggregates_pages():
    pages = [
        Page(pageIndex=0, templateId="mag-05", images={"image": "p0"}, texts={"title": "T", "explain": "E"}),
        Page(pageIndex=1, templateId="mag-05", images={"image": "p1"}, texts={"title": "T"}),
    ]
    comp = pe.chapter_completion("ch_1", pages)
    assert comp["chapterId"] == "ch_1"
    assert comp["filled"] is False
    assert comp["pages"] == [
        {"pageIndex": 0, "filled": True},
        {"pageIndex": 1, "filled": False},
    ]


def test_chapter_completion_all_filled():
    pages = [
        Page(pageIndex=0, templateId="mag-03", images={"image": "p0"}, texts={}),
    ]
    comp = pe.chapter_completion("ch_1", pages)
    assert comp["filled"] is True


# ---------- 段一意图分类 ------------------------------------------------------


def _filled_page() -> Page:
    return Page(pageIndex=0, templateId="mag-03", images={"image": "p0"}, texts={})


def test_stage1_talk_intent_uses_reply_no_patch():
    req = _req([_filled_page()], user_message="你好")
    payload = {"intent": "talk", "reply": "再讲讲这段回忆吧?"}
    res = asyncio.run(pe.run(req, complete=_complete_returning(payload)))
    assert res.intent == "talk"
    assert res.assistantReply == "再讲讲这段回忆吧?"
    assert res.layoutPatch is None
    assert res.advanceIntent is None


def test_stage1_advance_sets_flag_no_execution_call():
    req = _req([_filled_page()], user_message="进下一章吧")
    payload = {"intent": "advance", "reply": "好的,我们去下一章。"}

    def _must_not_run_edit(*a, **k):  # noqa: ANN002, ANN003
        raise AssertionError("advance must not call the stage-2 edit model")

    res = asyncio.run(
        pe.run(req, complete=_complete_returning(payload), complete_edit=_must_not_run_edit)
    )
    assert res.intent == "advance"
    assert res.advanceIntent is True
    assert res.layoutPatch is None


def test_stage1_filled_chapter_prompts_advance_via_talk():
    # A page-edit on a fully-filled chapter where the model proactively asks to advance
    # is still a talk turn (no patch, no advanceIntent yet — user hasn't confirmed).
    req = _req([_filled_page()], user_message="看起来不错")
    payload = {"intent": "talk", "reply": "这章齐了,要进下一章吗?"}
    res = asyncio.run(pe.run(req, complete=_complete_returning(payload)))
    assert res.intent == "talk"
    assert "下一章" in res.assistantReply
    assert res.layoutPatch is None


def test_stage1_image_swap_request_routes_to_talk():
    # 换图意图不进本环节(归 talk + 引导)。
    req = _req([_filled_page()], user_message="把这张照片换成另一张")
    payload = {"intent": "talk", "reply": "换图请在图片编辑里操作哦。"}
    res = asyncio.run(pe.run(req, complete=_complete_returning(payload)))
    assert res.intent == "talk"
    assert res.layoutPatch is None


# ---------- 段二 edit_text ----------------------------------------------------


def test_stage2_edit_text_writes_validated_patch():
    page = Page(pageIndex=0, templateId="mag-05", images={"image": "p0"}, texts={"title": "Old", "explain": "Old"})
    req = _req([page], user_message="把标题改得更温柔")
    stage1 = _complete_returning({"intent": "edit_text"})
    # stage2 returns texts for the focused page; clamp/validate by slot.
    stage2 = _complete_returning({"texts": {"title": "新标题", "explain": "新说明"}})
    res = asyncio.run(pe.run(req, complete=stage1, complete_edit=stage2))
    assert res.intent == "edit_text"
    assert res.layoutPatch is not None
    assert len(res.layoutPatch) == 1
    entry = res.layoutPatch[0]
    assert entry.pageIndex == 0
    assert entry.texts == {"title": "新标题", "explain": "新说明"}
    assert entry.templateId is None
    assert entry.images is None


def test_stage2_edit_text_rejects_illegal_slots_and_clamps_maxchars():
    page = Page(pageIndex=0, templateId="mag-05", images={"image": "p0"}, texts={})
    req = _req([page])
    stage1 = _complete_returning({"intent": "edit_text"})
    # bogus slot dropped; title clamped to its maxChars.
    stage2 = _complete_returning({"texts": {"title": "x" * 999, "bogus_slot": "nope"}})
    res = asyncio.run(pe.run(req, complete=stage1, complete_edit=stage2))
    assert res.intent == "edit_text"
    entry = res.layoutPatch[0]
    assert "bogus_slot" not in entry.texts
    assert "title" in entry.texts
    from src.agents.writing import handler as wh

    max_chars = {s["id"]: s.get("maxChars") for s in wh._page_slot_specs(page)}
    assert len(entry.texts["title"]) == max_chars["title"]


def test_stage2_edit_text_no_usable_text_falls_back_to_talk():
    page = Page(pageIndex=0, templateId="mag-05", images={"image": "p0"}, texts={})
    req = _req([page])
    stage1 = _complete_returning({"intent": "edit_text"})
    stage2 = _complete_returning({"texts": {"bogus": "x"}})  # nothing valid survives
    res = asyncio.run(pe.run(req, complete=stage1, complete_edit=stage2))
    assert res.intent == "talk"
    assert res.layoutPatch is None


# ---------- 段二 change_layout(纯确定性)-------------------------------------


def test_stage2_change_layout_deterministic_legal_reflow():
    # focused page currently mag-04 (2 images). change_layout picks a legal candidate
    # for 2 photos and reassigns images in order; NO model call in stage 2.
    page = Page(
        pageIndex=0,
        templateId="mag-04",
        images={"image1": "p0", "image2": "p1"},
        texts={"explain1": "a", "explain2": "b"},
        imagePos={"image1": {"x": 10, "y": 20, "scale": 1.5}},
    )
    req = _req([page], user_message="换个排版")
    stage1 = _complete_returning({"intent": "change_layout"})

    def _must_not_run_edit(*a, **k):  # noqa: ANN002, ANN003
        raise AssertionError("change_layout must be deterministic — no stage-2 model call")

    res = asyncio.run(pe.run(req, complete=stage1, complete_edit=_must_not_run_edit))
    assert res.intent == "change_layout"
    assert res.layoutPatch is not None
    entry = res.layoutPatch[0]
    assert entry.pageIndex == 0
    assert entry.templateId is not None
    # chosen template must be a legal candidate for 2 photos
    from src.engine import skeleton_v3 as s

    legal = {c["templateId"] for c in s.legal_candidates("interior", 2)}
    assert entry.templateId in legal
    # B-1: "换排版" must actually switch — never echo the current template as a no-op patch.
    assert entry.templateId != "mag-04"
    # images reassigned in order; exactly the 2 focused-page photos preserved in order
    assert list(entry.images.values()) == ["p0", "p1"]
    # imagePos dropped on relayout (explicit expected behavior) — patch carries no imagePos field


def test_stage2_change_layout_no_alternative_returns_talk(monkeypatch):
    # B-1: when the only legal candidate for this photo count IS the current template,
    # there's nothing to switch to → talk (change_layout_none), NOT a no-op patch.
    from src.engine import skeleton_v3 as s

    monkeypatch.setattr(
        s, "legal_candidates", lambda cat, n: [{"templateId": "mag-04", "imageSlotCount": 2}]
    )
    page = Page(
        pageIndex=0,
        templateId="mag-04",
        images={"image1": "p0", "image2": "p1"},
        texts={"explain1": "a", "explain2": "b"},
    )
    req = _req([page], user_message="换个排版")
    stage1 = _complete_returning({"intent": "change_layout"})

    def _must_not_run_edit(*a, **k):  # noqa: ANN002, ANN003
        raise AssertionError("no stage-2 model call on change_layout")

    res = asyncio.run(pe.run(req, complete=stage1, complete_edit=_must_not_run_edit))
    assert res.intent == "talk"
    assert res.layoutPatch is None


def test_stage2_change_layout_picks_different_template_when_requested():
    # A 1-image page; change_layout still produces a legal 1-image template.
    page = Page(pageIndex=0, templateId="mag-03", images={"image": "p0"}, texts={})
    req = _req([page], user_message="换排版")
    stage1 = _complete_returning({"intent": "change_layout"})
    res = asyncio.run(pe.run(req, complete=stage1))
    entry = res.layoutPatch[0]
    from src.engine import skeleton_v3 as s

    legal = {c["templateId"] for c in s.legal_candidates("interior", 1)}
    assert entry.templateId in legal
    assert list(entry.images.values()) == ["p0"]


# ---------- 安全兜底(永不崩)-------------------------------------------------


def test_stage1_model_error_falls_back_safe():
    req = _req([_filled_page()])
    res = asyncio.run(pe.run(req, complete=_boom()))
    assert res.intent == "talk"
    assert res.assistantReply  # conservative non-empty reply
    assert res.layoutPatch is None
    assert res.advanceIntent is None


def test_stage1_unparseable_falls_back_safe():
    async def _bad(*a, **k):  # noqa: ANN002, ANN003
        return {"choices": [{"message": {"content": "not json {{{"}}]}

    req = _req([_filled_page()])
    res = asyncio.run(pe.run(req, complete=_bad))
    assert res.intent == "talk"
    assert res.layoutPatch is None


def test_stage1_unknown_intent_falls_back_to_talk():
    req = _req([_filled_page()])
    payload = {"intent": "delete_everything", "reply": "hmm"}
    res = asyncio.run(pe.run(req, complete=_complete_returning(payload)))
    assert res.intent == "talk"
    assert res.layoutPatch is None


def test_stage2_edit_text_model_error_falls_back_to_talk():
    page = Page(pageIndex=0, templateId="mag-05", images={"image": "p0"}, texts={})
    req = _req([page])
    stage1 = _complete_returning({"intent": "edit_text"})
    res = asyncio.run(pe.run(req, complete=stage1, complete_edit=_boom()))
    assert res.intent == "talk"
    assert res.layoutPatch is None


def test_edit_text_with_focused_page_missing_falls_back_to_talk():
    # focusedPageIndex points outside the slice → nothing to edit → talk.
    page = Page(pageIndex=0, templateId="mag-05", images={"image": "p0"}, texts={})
    req = _req([page], focused=5)
    stage1 = _complete_returning({"intent": "edit_text"})
    stage2 = _complete_returning({"texts": {"title": "x"}})
    res = asyncio.run(pe.run(req, complete=stage1, complete_edit=stage2))
    assert res.intent == "talk"
    assert res.layoutPatch is None


# ---------- 路由 surface(req/res + 鉴权 + 错误形状 + 两端契约 re-validate)----


def _route_body() -> dict[str, Any]:
    page = Page(pageIndex=0, templateId="mag-05", images={"image": "p0"}, texts={})
    return {
        "language": "zh",
        "chapter": _chapter(["p0"]).model_dump(),
        "pages": [page.model_dump()],
        "focusedPageIndex": 0,
        "userMessage": "改这页",
        "history": [],
    }


def _client():
    from fastapi.testclient import TestClient
    from src.main import app

    return TestClient(app)


def test_route_registered_in_surface():
    from src.main import app

    paths = {route.path for route in app.routes}
    assert "/v3/page-edit" in paths


def test_route_requires_auth():
    res = _client().post("/v3/page-edit", json=_route_body())
    assert res.status_code == 401


def test_route_happy_path_returns_contract_envelope(monkeypatch):
    from src.routes import page_edit_v3
    from src.schemas import V3Models, V3PageEditResponse, V3Usage

    async def fake_run(req, *, complete=None, complete_edit=None):  # noqa: ANN001
        return V3PageEditResponse(
            assistantReply="再讲讲吧?",
            intent="talk",
            usage=V3Usage(durationMs=1, models=V3Models(planning="deepseek-chat")),
        )

    monkeypatch.setattr(page_edit_v3, "run", fake_run)
    res = _client().post(
        "/v3/page-edit",
        json=_route_body(),
        headers={"Authorization": "Bearer test_secret"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    # Re-validate against the V3 contract (two-end parity: schemas.py ↔ v3.ts).
    parsed = V3PageEditResponse(**body["data"])
    assert parsed.intent == "talk"
    assert parsed.assistantReply == "再讲讲吧?"


def test_route_planning_failure_is_502_contract_error(monkeypatch):
    from src.routes import page_edit_v3
    from src.agents.page_edit import PageEditError

    async def boom(req, *, complete=None, complete_edit=None):  # noqa: ANN001
        raise PageEditError("model exploded")

    monkeypatch.setattr(page_edit_v3, "run", boom)
    res = _client().post(
        "/v3/page-edit",
        json=_route_body(),
        headers={"Authorization": "Bearer test_secret"},
    )
    assert res.status_code == 502
    body = res.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "AGENT_PLANNING_FAILED"
