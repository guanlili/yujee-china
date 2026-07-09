"""AI copy writer (write_copy) 单测:排版选定之后,豆包把文案写进每页文字槽。

只 mock `ai_client.chat_completion`(test_vision_groups.py 同款 harness),不发真实网络
请求 —— 真实联调由用户自己另外跑。
"""

from __future__ import annotations

import asyncio
import json

import pytest

from src.providers import ai_client
from src.workflows.core.layout.write_copy import handler as write_copy_handler
from src.workflows.core.layout.write_copy.schema import WriteCopyResult


def _unit(*, chapter_context: str = "厦门海边度假,轻松愉快") -> dict:
    return {
        "chapterId": "ch_1",
        "chapterContext": chapter_context,
        "photos": [
            {
                "photoId": "p1",
                "ref200px": "data:image/jpeg;base64,AAAA",
                "orientation": "landscape",
                "takenAt": "2024-05-01T10:00:00Z",
                "sceneDescription": "两个人在海边看日落",
            },
            {
                "photoId": "p2",
                "ref200px": "data:image/jpeg;base64,BBBB",
                "orientation": "portrait",
                "takenAt": "2024-05-01T11:00:00Z",
                "sceneDescription": "沙滩上的脚印",
            },
        ],
    }


def _completion(content: dict) -> dict:
    return {
        "choices": [{"message": {"content": json.dumps(content, ensure_ascii=False)}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20},
    }


def _set_ark_key(monkeypatch) -> None:
    monkeypatch.setenv("ARK_API_KEY", "fake_ark")
    from src import settings as s

    s.reset_settings_cache()


def test_write_copy_fills_title_and_body_slots(monkeypatch):
    _set_ark_key(monkeypatch)
    calls: list[dict] = []

    async def fake_completion(**kwargs):
        calls.append(kwargs)
        return _completion(
            {
                "pages": [
                    {
                        "pageIndex": 0,
                        "texts": {
                            "title": "海边黄昏",
                            "body": "夕阳把海水染成金色,我们并肩坐在沙滩上。",
                        },
                    }
                ]
            }
        )

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    unit = _unit()
    pages = [
        {
            "pageIndex": 0,
            "templateId": "mag-15",
            "images": {"main": "p1"},
            "texts": {},
        }
    ]

    result = asyncio.run(write_copy_handler.write_copy(unit, pages, language="zh"))

    assert result.pages_texts == {
        0: {
            "title": "海边黄昏",
            "body": "夕阳把海水染成金色,我们并肩坐在沙滩上。",
        }
    }
    assert result.call_count == 1
    assert result.model
    assert result.input_tokens == 10
    assert result.output_tokens == 20
    assert len(calls) == 1

    # sanity: payload sent to the model carries chapterContext + language + the
    # page's writable slot specs (decoration excluded — covered by another test).
    sent_messages = calls[0]["messages"]
    user_text = sent_messages[1]["content"][0]["text"]
    payload = json.loads(user_text)
    assert payload["chapterContext"] == "厦门海边度假,轻松愉快"
    assert payload["language"] == "zh"
    assert payload["pages"][0]["pageIndex"] == 0
    sent_slot_ids = {slot["id"] for slot in payload["pages"][0]["textSlots"]}
    assert sent_slot_ids == {"title", "body"}
    # ref200px images get attached alongside the text part.
    image_parts = [p for p in sent_messages[1]["content"] if p.get("type") == "image_url"]
    assert len(image_parts) == 1
    assert image_parts[0]["image_url"]["url"] == "data:image/jpeg;base64,AAAA"


def test_write_copy_clamps_text_exceeding_max_chars(monkeypatch):
    _set_ark_key(monkeypatch)

    long_title = "这是一段远超过标题最大字符数限制的超长标题文本用来测试裁剪逻辑是否生效"
    assert len(long_title) > 24

    async def fake_completion(**kwargs):
        return _completion(
            {
                "pages": [
                    {
                        "pageIndex": 0,
                        "texts": {
                            "title": long_title,
                            "body": "正常长度的正文。",
                        },
                    }
                ]
            }
        )

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    unit = _unit()
    pages = [
        {
            "pageIndex": 0,
            "templateId": "mag-15",
            "images": {"main": "p1"},
            "texts": {},
        }
    ]

    result = asyncio.run(write_copy_handler.write_copy(unit, pages, language="zh"))

    assert result.pages_texts[0]["title"] == long_title[:24]
    assert len(result.pages_texts[0]["title"]) == 24
    assert result.pages_texts[0]["body"] == "正常长度的正文。"


def test_write_copy_never_requests_or_returns_decoration_slots(monkeypatch):
    _set_ark_key(monkeypatch)
    calls: list[dict] = []

    async def fake_completion(**kwargs):
        calls.append(kwargs)
        # 即便模型「越界」尝试写 decoration 槽(date/folio),也必须被过滤掉。
        return _completion(
            {
                "pages": [
                    {
                        "pageIndex": 0,
                        "texts": {
                            "title": "海边黄昏",
                            "body": "夕阳把海水染成金色。",
                            "date": "05/24",
                            "folio": "01",
                        },
                    }
                ]
            }
        )

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    unit = _unit()
    pages = [
        {
            "pageIndex": 0,
            "templateId": "mag-15",  # title/body/date(decoration)/folio(decoration)
            "images": {"main": "p1"},
            "texts": {},
        }
    ]

    result = asyncio.run(write_copy_handler.write_copy(unit, pages, language="zh"))

    assert set(result.pages_texts[0].keys()) == {"title", "body"}
    assert "date" not in result.pages_texts[0]
    assert "folio" not in result.pages_texts[0]

    sent_messages = calls[0]["messages"]
    user_text = sent_messages[1]["content"][0]["text"]
    payload = json.loads(user_text)
    sent_slot_ids = {slot["id"] for slot in payload["pages"][0]["textSlots"]}
    assert "date" not in sent_slot_ids
    assert "folio" not in sent_slot_ids


def test_write_copy_provider_error_returns_empty_result(monkeypatch):
    _set_ark_key(monkeypatch)

    async def fake_completion(**kwargs):
        raise ai_client.AIRequestError("boom", status_code=500, kind="5xx")

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    unit = _unit()
    pages = [
        {
            "pageIndex": 0,
            "templateId": "mag-15",
            "images": {"main": "p1"},
            "texts": {},
        }
    ]

    result = asyncio.run(write_copy_handler.write_copy(unit, pages, language="zh"))

    assert result == WriteCopyResult(pages_texts={})
    assert result.call_count == 0


def test_write_copy_page_with_only_decoration_slots_is_skipped_no_call(monkeypatch):
    _set_ark_key(monkeypatch)
    calls: list[dict] = []

    async def fake_completion(**kwargs):
        calls.append(kwargs)
        return _completion({"pages": []})

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    unit = _unit()
    pages = [
        {
            "pageIndex": 0,
            "templateId": "mag-06",  # only a folio (decoration) text slot
            "images": {"main": "p1"},
            "texts": {},
        }
    ]

    result = asyncio.run(write_copy_handler.write_copy(unit, pages, language="zh"))

    assert result.pages_texts == {}
    assert result.call_count == 0
    assert len(calls) == 0


def test_write_copy_missing_ark_key_returns_empty_no_call(monkeypatch):
    # ARK_API_KEY intentionally left unset — ark_vision_slot must raise
    # VisionSlotError, and write_copy must swallow it (never raise).
    calls: list[dict] = []

    async def fake_completion(**kwargs):
        calls.append(kwargs)
        return _completion({"pages": []})

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    unit = _unit()
    pages = [
        {
            "pageIndex": 0,
            "templateId": "mag-15",
            "images": {"main": "p1"},
            "texts": {},
        }
    ]

    result = asyncio.run(write_copy_handler.write_copy(unit, pages, language="zh"))

    assert result.pages_texts == {}
    assert len(calls) == 0
