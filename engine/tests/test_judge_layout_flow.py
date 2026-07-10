"""P2 judge-layout 工作流:真图缩略图评委输入 + 选定后写文案接线。

评委与写文案的 AI 调用都 monkeypatch 掉,不打真实网络;真实联调由用户在编辑器里跑。
"""

from __future__ import annotations

import asyncio
import json

from src.contracts.schemas import (
    CandidatePage,
    JudgeCandidate,
    JudgeCopyPhoto,
    JudgeLayoutRequest,
    JudgeLayoutUnit,
)
from src.workflows import judge_layout as jl
from src.workflows.core.layout import skeleton_v3, templates
from src.workflows.core.layout.select_layout import handler as h
from src.workflows.core.layout.select_layout.schema import LayoutJudgeResult

_THUMB = "data:image/jpeg;base64,AA=="


def _single_slot_template() -> tuple[str, str]:
    """一个真实的单图槽 interior 模板 (templateId, slotId)。"""
    template_id = skeleton_v3.candidate_ids("interior", 1)[0]
    slot_id = templates.image_slot_ids(templates.get(template_id))[0]
    return template_id, slot_id


def _unit(*, candidate_count: int, chosen_index: int | None = None) -> JudgeLayoutUnit:
    template_id, slot_id = _single_slot_template()
    return JudgeLayoutUnit(
        unitKey="ch_1#p1",
        chapterId="ch_1",
        chosenIndex=chosen_index,
        candidates=[
            JudgeCandidate(
                candidateIndex=i,
                thumbnail=_THUMB,
                pages=[CandidatePage(templateId=template_id, images={slot_id: "p1"})],
            )
            for i in range(candidate_count)
        ],
        photos=[JudgeCopyPhoto(photoId="p1", sceneDescription="海边看日落")],
        chapterContext="厦门海边度假",
    )


def _request(units: list[JudgeLayoutUnit]) -> JudgeLayoutRequest:
    return JudgeLayoutRequest(
        requestId="req_1",
        callbackUrl="http://localhost:3000/api/v3/internal/job-progress",
        language="zh",
        units=units,
    )


# ---------- 评委输入(_judge_thumbnail_messages) ---------------------------------


def test_judge_thumbnail_messages_carry_context_markers_and_dedicated_prompt():
    messages = h._judge_thumbnail_messages(
        [_THUMB, "data:image/jpeg;base64,BB=="], chapter_context="厦门海边度假"
    )

    system = messages[0]["content"]
    # 专用 prompt(judge_thumbnails.md):描述的是真实渲染缩略图,不再是线框+slots。
    assert "渲染" in system and "缩略图" in system
    assert "线框" not in system

    content = messages[1]["content"]
    payload = json.loads(content[0]["text"])
    assert payload["chapterContext"] == "厦门海边度假"
    assert payload["candidateCount"] == 2

    # 每张图前置「候选 i」标记,防多图串位:text, [候选 0, img0], [候选 1, img1]。
    kinds = [(part["type"], part.get("text", "")) for part in content]
    assert kinds[1] == ("text", "候选 0")
    assert content[2]["type"] == "image_url"
    assert kinds[3] == ("text", "候选 1")
    assert content[4]["type"] == "image_url"


# ---------- 选定后写文案(_resolve_unit / judge_pages) ---------------------------


def _capture_write_copy(captured: dict):
    async def fake_apply(unit, pages, *, language="zh"):
        captured["unit"] = unit
        captured["language"] = language
        return [
            {**page, "texts": {**(page.get("texts") or {}), "title": "写好的标题"}}
            for page in pages
        ]

    return fake_apply


def test_judge_pages_feeds_context_to_judge_then_writes_copy(monkeypatch):
    captured: dict = {}

    async def fake_judge(thumbnails, *, chapter_context=""):
        captured["thumbnails"] = list(thumbnails)
        captured["chapter_context"] = chapter_context
        return LayoutJudgeResult(winner_index=1, call_count=1, model="judge-x")

    monkeypatch.setattr(jl.select_layout_agent, "judge_layout_thumbnails", fake_judge)
    monkeypatch.setattr(jl.write_copy_agent, "apply_write_copy", _capture_write_copy(captured))

    pages, usage = asyncio.run(jl.judge_pages(_request([_unit(candidate_count=3)])))

    assert captured["chapter_context"] == "厦门海边度假"
    assert len(captured["thumbnails"]) == 3
    # 写文案吃的是 unit 本体(photos.sceneDescription + chapterContext 都在上面)。
    assert captured["unit"].chapterContext == "厦门海边度假"
    assert captured["unit"].photos[0].sceneDescription == "海边看日落"
    assert captured["language"] == "zh"
    assert len(pages) == 1
    assert pages[0]["texts"]["title"] == "写好的标题"
    assert usage.geminiCallCount == 1


def test_judge_pages_single_candidate_skips_judge_but_still_writes_copy(monkeypatch):
    captured: dict = {}

    async def judge_must_not_run(thumbnails, *, chapter_context=""):
        raise AssertionError("single-candidate unit must not call the judge")

    monkeypatch.setattr(jl.select_layout_agent, "judge_layout_thumbnails", judge_must_not_run)
    monkeypatch.setattr(jl.write_copy_agent, "apply_write_copy", _capture_write_copy(captured))

    pages, usage = asyncio.run(jl.judge_pages(_request([_unit(candidate_count=1)])))

    assert captured["unit"].chapterId == "ch_1"
    assert pages[0]["texts"]["title"] == "写好的标题"
    assert usage.geminiCallCount == 0


def test_judge_pages_judge_failure_falls_back_to_candidate0_and_still_writes_copy(monkeypatch):
    captured: dict = {}

    async def fail_judge(thumbnails, *, chapter_context=""):
        raise RuntimeError("both gemini and ark judge unavailable")

    monkeypatch.setattr(jl.select_layout_agent, "judge_layout_thumbnails", fail_judge)
    monkeypatch.setattr(jl.write_copy_agent, "apply_write_copy", _capture_write_copy(captured))

    pages, usage = asyncio.run(jl.judge_pages(_request([_unit(candidate_count=2)])))

    # 评委失败退化取候选 0,但写文案照跑,全册仍成稿。
    assert len(pages) == 1
    assert pages[0]["texts"]["title"] == "写好的标题"
    assert usage.geminiCallCount == 0
