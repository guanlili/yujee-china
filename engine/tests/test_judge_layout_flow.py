"""P2 judge-layout 工作流:批量真图评委(多单元合并会话)+ 选定后写文案接线。

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
from src.workflows.core.layout.select_layout.schema import LayoutBatchJudgeResult

_THUMB = "data:image/jpeg;base64,AA=="


def _single_slot_template() -> tuple[str, str]:
    """一个真实的单图槽 interior 模板 (templateId, slotId)。"""
    template_id = skeleton_v3.candidate_ids("interior", 1)[0]
    slot_id = templates.image_slot_ids(templates.get(template_id))[0]
    return template_id, slot_id


def _unit(
    key: str = "ch_1",
    *,
    candidate_count: int,
    chosen_index: int | None = None,
    context: str = "厦门海边度假",
) -> JudgeLayoutUnit:
    template_id, slot_id = _single_slot_template()
    return JudgeLayoutUnit(
        unitKey=f"{key}#p1",
        chapterId=key,
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
        chapterContext=context,
    )


def _request(units: list[JudgeLayoutUnit]) -> JudgeLayoutRequest:
    return JudgeLayoutRequest(
        requestId="req_1",
        callbackUrl="http://localhost:3000/api/v3/internal/job-progress",
        language="zh",
        units=units,
    )


def _passthrough_write_copy(captured: list):
    async def fake_apply(unit, pages, *, language="zh"):
        captured.append((unit.chapterId, language))
        return [
            {**page, "texts": {**(page.get("texts") or {}), "title": "写好的标题"}}
            for page in pages
        ]

    return fake_apply


# ---------- 批量评委输入(_judge_thumbnails_batch_messages) ----------------------


def test_batch_messages_carry_units_markers_and_dedicated_prompt():
    messages = h._judge_thumbnails_batch_messages(
        [
            {"thumbnails": [_THUMB, _THUMB]},
            {"thumbnails": [_THUMB]},
        ]
    )

    system = messages[0]["content"]
    # 专用 prompt(judge_thumbnails.md):多单元、真实渲染缩略图,不再是线框+slots。
    assert "渲染" in system and "缩略图" in system and "单元" in system
    assert "线框" not in system

    content = messages[1]["content"]
    payload = json.loads(content[0]["text"])
    assert [u["unitIndex"] for u in payload["units"]] == [0, 1]
    assert [u["candidateCount"] for u in payload["units"]] == [2, 1]
    # layout 评委纯视觉:payload 不携带任何章节信息(chapter 只属于分簇/写文案)。
    assert "chapterContext" not in payload["units"][0]

    # 每张图前置「单元 u 候选 i」标记,防多图串位。
    texts = [part["text"] for part in content if part["type"] == "text"][1:]
    assert texts == ["单元 0 候选 0", "单元 0 候选 1", "单元 1 候选 0"]
    assert sum(1 for part in content if part["type"] == "image_url") == 3


def test_parse_batch_winners_is_lenient_per_unit():
    # 缺项/越界/类型错 → 该单元落 0;整体缺 winners[] → 抛(触发上层 fallback)。
    ok = h._parse_batch_winners(
        '{"winners":[{"unitIndex":0,"winnerIndex":2},{"unitIndex":1,"winnerIndex":7},{"unitIndex":9,"winnerIndex":1}]}',
        [3, 3],
    )
    assert ok == [2, 0]
    try:
        h._parse_batch_winners('{"nope":true}', [3])
        raise AssertionError("should raise")
    except ValueError:
        pass


# ---------- 批量编排(judge_pages) ------------------------------------------------


def test_judge_pages_merges_units_into_one_judge_session(monkeypatch):
    batches: list[list[dict]] = []

    async def fake_batch(units):
        batches.append([dict(u) for u in units])
        return LayoutBatchJudgeResult(
            winners=[1, 0], call_count=1, model="judge-x", input_tokens=10, output_tokens=2
        )

    written: list = []
    monkeypatch.setattr(jl.select_layout_agent, "judge_thumbnails_batch", fake_batch)
    monkeypatch.setattr(jl.write_copy_agent, "apply_write_copy", _passthrough_write_copy(written))

    pages, usage = asyncio.run(
        jl.judge_pages(
            _request(
                [
                    _unit("ch_1", candidate_count=3, context="海边"),
                    _unit("ch_2", candidate_count=3, context="山里"),
                ]
            )
        )
    )

    # 两个单元合并进同一次评委会话(一批一次调用);评委输入不携带章节信息。
    assert len(batches) == 1 and len(batches[0]) == 2
    assert all("chapterContext" not in u for u in batches[0])
    assert usage.geminiCallCount == 1
    # 写文案仍逐 unit 执行,页面拿到文案。
    assert [w[0] for w in written] == ["ch_1", "ch_2"]
    assert all(page["texts"]["title"] == "写好的标题" for page in pages)


def test_judge_pages_splits_batches_by_image_budget(monkeypatch):
    settings = jl.get_settings()
    monkeypatch.setattr(settings, "select_layout_judge_batch_max_images", 4)
    calls: list[int] = []

    async def fake_batch(units):
        calls.append(len(units))
        return LayoutBatchJudgeResult(winners=[0] * len(units), call_count=1)

    monkeypatch.setattr(jl.select_layout_agent, "judge_thumbnails_batch", fake_batch)
    monkeypatch.setattr(jl.write_copy_agent, "apply_write_copy", _passthrough_write_copy([]))

    asyncio.run(
        jl.judge_pages(
            _request(
                [
                    _unit("ch_1", candidate_count=3),
                    _unit("ch_2", candidate_count=3),
                    _unit("ch_3", candidate_count=2),
                ]
            )
        )
    )

    # 预算 4 张/批:[ch_1(3)]、[ch_2(3)]…… 3+3>4 拆开;ch_2(3)+ch_3(2)>4 再拆。
    assert calls == [1, 1, 1]


def test_judge_pages_fixed_units_skip_judge_but_still_write_copy(monkeypatch):
    async def judge_must_not_run(units):
        raise AssertionError("fixed units must not call the judge")

    written: list = []
    monkeypatch.setattr(jl.select_layout_agent, "judge_thumbnails_batch", judge_must_not_run)
    monkeypatch.setattr(jl.write_copy_agent, "apply_write_copy", _passthrough_write_copy(written))

    pages, usage = asyncio.run(
        jl.judge_pages(
            _request(
                [
                    _unit("ch_1", candidate_count=1),
                    _unit("ch_2", candidate_count=3, chosen_index=2),
                ]
            )
        )
    )

    assert usage.geminiCallCount == 0
    assert [w[0] for w in written] == ["ch_1", "ch_2"]
    assert len(pages) == 2


def test_judge_pages_batch_failure_falls_back_to_candidate0_and_still_writes_copy(monkeypatch):
    async def fail_batch(units):
        raise RuntimeError("both gemini and ark judge unavailable")

    written: list = []
    monkeypatch.setattr(jl.select_layout_agent, "judge_thumbnails_batch", fail_batch)
    monkeypatch.setattr(jl.write_copy_agent, "apply_write_copy", _passthrough_write_copy(written))

    pages, usage = asyncio.run(
        jl.judge_pages(_request([_unit("ch_1", candidate_count=2), _unit("ch_2", candidate_count=2)]))
    )

    # 评委失败该批各 unit 退化取候选 0,写文案照跑,全册仍成稿。
    assert usage.geminiCallCount == 0
    assert len(pages) == 2
    assert all(page["texts"]["title"] == "写好的标题" for page in pages)
