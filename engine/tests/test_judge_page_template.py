"""单页换版式判图(真图缩略图版):与整书排版同一 judge_layout_thumbnails 逻辑。
判图本身 monkeypatch 掉,不打真实 AI。"""

import asyncio

from src.workflows.core.layout.select_layout import handler as h
from src.workflows.core.layout.select_layout.schema import LayoutJudgeResult

_THUMB = "data:image/jpeg;base64,AA=="


def _candidates(*template_ids: str) -> list[dict]:
    return [{"templateId": tid, "thumbnail": _THUMB} for tid in template_ids]


def test_judge_page_template_picks_winner_via_thumbnail_judge(monkeypatch):
    captured: dict = {}

    async def fake_judge(thumbnails):
        captured["thumbnails"] = list(thumbnails)
        return LayoutJudgeResult(winner_index=1, call_count=1, model="judge-x")

    monkeypatch.setattr(h, "judge_layout_thumbnails", fake_judge)

    winner, result = asyncio.run(
        h.judge_page_template(
            _candidates("mag-11", "mag-15", "mag-33")
        )
    )

    assert winner == "mag-15"
    assert result.model == "judge-x"
    assert len(captured["thumbnails"]) == 3


def test_judge_page_template_single_candidate_skips_judge(monkeypatch):
    async def judge_must_not_run(thumbnails, *, chapter_context=""):
        raise AssertionError("single-candidate must not call the judge")

    monkeypatch.setattr(h, "judge_layout_thumbnails", judge_must_not_run)

    winner, result = asyncio.run(h.judge_page_template(_candidates("mag-11")))
    assert winner == "mag-11"
    assert result.call_count == 0


def test_judge_page_template_defaults_to_first_when_judge_unavailable(monkeypatch):
    async def fail_judge(thumbnails, *, chapter_context=""):
        raise RuntimeError("both gemini and ark judge unavailable")

    monkeypatch.setattr(h, "judge_layout_thumbnails", fail_judge)

    winner, _ = asyncio.run(h.judge_page_template(_candidates("mag-11", "mag-15")))
    assert winner == "mag-11"  # 评委不可用降级取第 0 个,不阻断换版式
