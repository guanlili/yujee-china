"""V3 group-pages:AI 按效果重分章内页,确定性引擎守合法 + 兜底(§8.3)。

模型调用经注入的 `complete=` 顶替,产出确定性、不打真实模型。覆盖:合法分组被采用、
非法分组(丢/重/超容量)逐章回退基线、模型报错/不可解析/无 provider 全回退、空章。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from src import ai_client
from src.agents.group_pages import handler as gp
from src.schemas import V3Chapter, V3ChapterPhoto


def _photo(pid: str) -> V3ChapterPhoto:
    return V3ChapterPhoto(
        photoId=pid, sceneDescription="s", width=800, height=600, orientation="landscape"
    )


def _chapter(cid: str, pids: list[str]) -> V3Chapter:
    return V3Chapter(
        chapterId=cid,
        description="d",
        accentColor=None,
        artFont=None,
        photos=[_photo(p) for p in pids],
    )


def _complete_returning(payload: dict[str, Any]):
    async def _c(messages):  # noqa: ANN001 - mirrors ai_client.chat_completion call shape
        return {"choices": [{"message": {"content": json.dumps(payload)}}]}

    return _c


def test_valid_ai_grouping_is_used():
    ch = _chapter("ch_1", ["p0", "p1", "p2", "p3"])
    payload = {"chapters": [{"chapterId": "ch_1", "pages": [["p0", "p1"], ["p2", "p3"]]}]}
    result = asyncio.run(gp.group_chapter_pages([ch], complete=_complete_returning(payload)))
    assert result == {"ch_1": [["p0", "p1"], ["p2", "p3"]]}


def test_invalid_grouping_falls_back_to_baseline():
    # 漏了 p3 → 非法 → 回退确定性基线(4 张 ≤ 上限 9,基线是单页)。
    ch = _chapter("ch_1", ["p0", "p1", "p2", "p3"])
    payload = {"chapters": [{"chapterId": "ch_1", "pages": [["p0", "p1"], ["p2"]]}]}
    result = asyncio.run(gp.group_chapter_pages([ch], complete=_complete_returning(payload)))
    assert result == {"ch_1": [["p0", "p1", "p2", "p3"]]}


def test_model_error_falls_back_all():
    ch = _chapter("ch_1", ["p0", "p1"])

    async def _boom(messages):
        raise ai_client.AIRequestError("upstream 500", status_code=500, kind="5xx")

    result = asyncio.run(gp.group_chapter_pages([ch], complete=_boom))
    assert result == {"ch_1": [["p0", "p1"]]}


def test_unparseable_response_falls_back_all():
    ch = _chapter("ch_1", ["p0", "p1"])

    async def _bad(messages):
        return {"choices": [{"message": {"content": "not json at all {{{"}}]}

    result = asyncio.run(gp.group_chapter_pages([ch], complete=_bad))
    assert result == {"ch_1": [["p0", "p1"]]}


def test_no_provider_falls_back_all(monkeypatch):
    ch = _chapter("ch_1", ["p0", "p1"])

    def _raise(settings):
        raise gp.GroupPagesError("no slot configured")

    monkeypatch.setattr(gp, "_select_slot", _raise)
    result = asyncio.run(gp.group_chapter_pages([ch]))  # complete=None → 走 _select_slot
    assert result == {"ch_1": [["p0", "p1"]]}


def test_empty_chapters_yield_empty():
    result = asyncio.run(gp.group_chapter_pages([_chapter("ch_1", [])]))
    assert result == {}


def test_partial_invalid_chapter_falls_back_only_that_chapter():
    ch1 = _chapter("ch_1", ["a", "b", "c", "d"])
    ch2 = _chapter("ch_2", ["e", "f"])
    payload = {
        "chapters": [
            {"chapterId": "ch_1", "pages": [["a", "b"], ["c", "d"]]},  # 合法
            {"chapterId": "ch_2", "pages": [["e"]]},  # 非法:漏了 f
        ]
    }
    result = asyncio.run(gp.group_chapter_pages([ch1, ch2], complete=_complete_returning(payload)))
    assert result == {"ch_1": [["a", "b"], ["c", "d"]], "ch_2": [["e", "f"]]}
