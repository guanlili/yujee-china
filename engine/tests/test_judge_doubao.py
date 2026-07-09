"""豆包(火山 Ark)排版评委:select-layout 的『选择』步骤在 gemini 地区墙 400 时
需要一个不依赖 gemini 的评委。豆包是 OpenAI 兼容协议,直接吃 `_judge_messages`
产出的 OpenAI 风格 messages,无需 gemini 那层 native 转换。"""

from __future__ import annotations

import json

import pytest

from src.workflows.core.layout.select_layout import handler as select_layout_handler
from src.providers import ai_client


def _chapter() -> dict:
    return {
        "chapterId": "ch_1",
        "chapterContext": "a lazy afternoon at the beach",
        "photos": [
            {
                "photoId": "p1",
                "ref200px": "data:image/jpeg;base64,AA==",
                "orientation": "landscape",
                "composition": None,
            },
            {
                "photoId": "p2",
                "ref200px": "data:image/jpeg;base64,BB==",
                "orientation": "portrait",
                "composition": None,
            },
        ],
    }


def _candidates() -> list[list[dict]]:
    return [
        [{"templateId": "mag-01", "images": {"slotA": "p1", "slotB": "p2"}}],
        [{"templateId": "mag-02", "images": {"slotA": "p2", "slotB": "p1"}}],
        [{"templateId": "mag-03", "images": {"slotA": "p1", "slotB": "p2"}}],
    ]


def _completion(content: dict) -> dict:
    return {
        "choices": [{"message": {"content": json.dumps(content)}}],
        "usage": {"prompt_tokens": 11, "completion_tokens": 3},
    }


@pytest.fixture(autouse=True)
def _ark_env(monkeypatch):
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    monkeypatch.setenv("ARK_API_KEY", "fake_ark")
    monkeypatch.setenv("ARK_BASE_URL", "https://ark.example.test/api/v3")
    monkeypatch.setenv("ARK_VISION_MODEL", "doubao-test-vision")
    from src import settings as s

    s.reset_settings_cache()
    yield
    s.reset_settings_cache()


@pytest.mark.asyncio
async def test_judge_layout_doubao_returns_winner_index(monkeypatch):
    calls: list[dict] = []

    async def fake_completion(**kwargs):
        calls.append(kwargs)
        return _completion({"winnerIndex": 1})

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result = await select_layout_handler.judge_layout_doubao(_chapter(), _candidates())

    assert result.winner_index == 1
    assert result.call_count == 1
    assert result.model == "doubao-test-vision"
    assert result.input_tokens == 11
    assert result.output_tokens == 3
    assert len(calls) == 1
    assert calls[0]["base_url"] == "https://ark.example.test/api/v3"
    assert calls[0]["api_key"] == "fake_ark"
    assert calls[0]["model"] == "doubao-test-vision"
    # 消息应为 OpenAI 风格(system + user content parts),豆包直接吃,不做 gemini 转换。
    messages = calls[0]["messages"]
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    assert isinstance(messages[1]["content"], list)


@pytest.mark.asyncio
async def test_judge_layout_doubao_clamps_out_of_range_winner_index(monkeypatch):
    async def fake_completion(**kwargs):
        return _completion({"winnerIndex": 99})

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    candidates = _candidates()
    result = await select_layout_handler.judge_layout_doubao(_chapter(), candidates)

    assert result.winner_index == len(candidates) - 1


@pytest.mark.asyncio
async def test_judge_layout_doubao_raises_on_missing_winner_index(monkeypatch):
    async def fake_completion(**kwargs):
        return _completion({"somethingElse": True})

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(Exception):
        await select_layout_handler.judge_layout_doubao(_chapter(), _candidates())


@pytest.mark.asyncio
async def test_judge_layout_doubao_raises_on_non_int_winner_index(monkeypatch):
    async def fake_completion(**kwargs):
        return _completion({"winnerIndex": "1"})

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    with pytest.raises(Exception):
        await select_layout_handler.judge_layout_doubao(_chapter(), _candidates())


@pytest.mark.asyncio
async def test_judge_layout_doubao_requires_at_least_one_candidate():
    with pytest.raises(ValueError):
        await select_layout_handler.judge_layout_doubao(_chapter(), [])
