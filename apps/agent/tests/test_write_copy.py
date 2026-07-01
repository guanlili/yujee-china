"""一次性写文案(write_chapter_copy)测试 —— 排版后当场写满整章 + 失败降级。

覆盖:
  ① 正常:注入的模型返回 pagesTexts → 每页每 slot 落地、钳到 maxChars、只留合法 slot。
  ② chapterContext 进 prompt:采访结果喂给了写作 AI(根因:排版时也要能用采访背景)。
  ③ 降级:模型抛错 => 每页空 texts,不抛、不拖垮排版。
"""

from __future__ import annotations

import json

import pytest

from src.agents.story import write_copy
from src.engine import templates
from src.schemas import Page, V3Chapter, V3ChapterPhoto

_INTERIOR = "mag-04"  # 2 图 + explain1/explain2 文字位


def _img_assignment(template_id: str, photo_ids: list[str]) -> dict[str, str]:
    slot_ids = templates.image_slot_ids(templates.get(template_id))
    return {slot_ids[i]: photo_ids[i] for i in range(min(len(slot_ids), len(photo_ids)))}


def _chapter(context: str = "") -> V3Chapter:
    return V3Chapter(
        chapterId="c1",
        chapterContext=context,
        accentColor=None,
        artFont=None,
        photos=[
            V3ChapterPhoto(photoId="p1", sceneDescription="two on a beach", width=800, height=600, orientation="landscape"),
            V3ChapterPhoto(photoId="p2", sceneDescription="a lighthouse", width=800, height=600, orientation="landscape"),
        ],
    )


def _pages() -> list[Page]:
    return [Page(pageIndex=0, templateId=_INTERIOR, images=_img_assignment(_INTERIOR, ["p1", "p2"]), texts={})]


def _writer(captured: dict, texts: dict):
    async def complete(*, messages, max_tokens, temperature):  # noqa: ANN001
        captured["user"] = messages[-1]["content"]
        return {
            "choices": [{"message": {"content": json.dumps({"pagesTexts": [{"pageIndex": 0, "texts": texts}]})}}],
            "usage": {"prompt_tokens": 7, "completion_tokens": 9},
        }

    return complete


@pytest.mark.asyncio
async def test_writes_all_pages_and_cleans_slots():
    captured: dict = {}
    patches, in_tok, out_tok = await write_copy.write_chapter_copy(
        _chapter(), _pages(), "en",
        complete=_writer(captured, {"explain1": "Two on the beach", "explain2": "A lighthouse", "bogus": "x"}),
    )
    assert len(patches) == 1
    assert patches[0].pageIndex == 0
    # 合法 slot 落地,未知 slot(bogus)被清掉。
    assert patches[0].texts.get("explain1") == "Two on the beach"
    assert "bogus" not in patches[0].texts
    assert (in_tok, out_tok) == (7, 9)


@pytest.mark.asyncio
async def test_chapter_context_is_fed_to_writer():
    captured: dict = {}
    await write_copy.write_chapter_copy(
        _chapter("时间：2026/05/01  地点：杭州\n（用户原话）奶奶生日。"),
        _pages(), "zh",
        complete=_writer(captured, {"explain1": "a", "explain2": "b"}),
    )
    payload = json.loads(captured["user"])
    assert "杭州" in payload["chapterContext"]
    assert "奶奶生日" in payload["chapterContext"]
    # 场景背景也进了(写作 grounding)。
    assert "sceneBackground" in payload


@pytest.mark.asyncio
async def test_degrades_to_empty_texts_on_writer_failure():
    async def boom(*, messages, max_tokens, temperature):  # noqa: ANN001
        raise RuntimeError("model down")

    patches, in_tok, out_tok = await write_copy.write_chapter_copy(
        _chapter(), _pages(), "en", complete=boom
    )
    # 降级:每页空 texts,不抛,token 计 0(不拖垮排版)。
    assert len(patches) == 1
    assert patches[0].texts == {}
    assert (in_tok, out_tok) == (0, 0)


@pytest.mark.asyncio
async def test_no_pages_returns_empty():
    patches, in_tok, out_tok = await write_copy.write_chapter_copy(_chapter(), [], "en")
    assert patches == []
    assert (in_tok, out_tok) == (0, 0)
