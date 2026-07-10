"""单页 relayout 视觉判图:合成单页 chapter/candidates + gemini→豆包兜底 + 越界/双失败降级。
判图本身 monkeypatch 掉,不打真实 AI。"""

import asyncio

from src.workflows.core.layout import skeleton_v3
from src.workflows.core.layout.select_layout import handler as h
from src.workflows.core.layout.select_layout.schema import LayoutJudgeResult


def _photo(pid: str) -> dict:
    return {
        "photoId": pid,
        "ref200px": "data:image/jpeg;base64,AA==",
        "orientation": "landscape",
        "composition": None,
    }


def _single_slot_templates(count: int) -> list[str]:
    ids = skeleton_v3.candidate_ids("interior", 1)
    if len(ids) < count:
        import pytest

        pytest.skip(f"template registry has < {count} single-slot interior templates")
    return ids[:count]


def test_judge_page_template_returns_winner_and_builds_single_page_candidates(monkeypatch):
    captured: dict = {}

    async def fake_gemini(chapter, candidates):
        captured["chapter"] = chapter
        captured["candidates"] = candidates
        return LayoutJudgeResult(winner_index=1, model="gemini-x")

    monkeypatch.setattr(h, "judge_layout", fake_gemini)

    candidate_ids = _single_slot_templates(3)
    winner, result = asyncio.run(h.judge_page_template([_photo("pa")], candidate_ids))

    assert winner == candidate_ids[1]
    assert result.model == "gemini-x"
    # 合成:单页 chapter 带该照片；每候选一页、照片按槽位顺序落位。
    assert [p["photoId"] for p in captured["chapter"]["photos"]] == ["pa"]
    assert len(captured["candidates"]) == 3
    first = captured["candidates"][0][0]
    assert first["templateId"] == candidate_ids[0]
    assert list(first["images"].values()) == ["pa"]


def test_judge_page_template_falls_back_to_doubao_when_gemini_unavailable(monkeypatch):
    async def fail_gemini(chapter, candidates):
        raise RuntimeError("gemini blocked (地区墙)")

    async def fake_doubao(chapter, candidates):
        return LayoutJudgeResult(winner_index=0, model="doubao-x")

    monkeypatch.setattr(h, "judge_layout", fail_gemini)
    monkeypatch.setattr(h, "judge_layout_doubao", fake_doubao)

    candidate_ids = _single_slot_templates(2)
    winner, result = asyncio.run(h.judge_page_template([_photo("pa")], candidate_ids))
    assert winner == candidate_ids[0]
    assert result.model == "doubao-x"


def test_judge_page_template_defaults_to_first_when_both_unavailable(monkeypatch):
    async def fail_gemini(chapter, candidates):
        raise RuntimeError("no gemini")

    async def fail_doubao(chapter, candidates):
        raise RuntimeError("no ark key")

    monkeypatch.setattr(h, "judge_layout", fail_gemini)
    monkeypatch.setattr(h, "judge_layout_doubao", fail_doubao)

    candidate_ids = _single_slot_templates(2)
    winner, _ = asyncio.run(h.judge_page_template([_photo("pa")], candidate_ids))
    assert winner == candidate_ids[0]  # 双失败降级取第 0 个,不阻断


def test_judge_page_template_rejects_empty_candidates():
    import pytest

    with pytest.raises(ValueError, match="at least one candidate"):
        asyncio.run(h.judge_page_template([_photo("pa")], []))
