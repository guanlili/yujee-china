"""compose 的 ark 分支(compose_provider=ark,国内线)。

三条 doubao 硬约束的守卫:thinking 必须 disabled(推理 token 与 max_tokens 共享
预算,整章 8192 token 会被思考挤截断)、不能 response_format=json_object(400)、
max_tokens 用 compose 自己的预算。gemini 默认路径不受影响。
"""

from __future__ import annotations

import asyncio
import json

from src.workflows.core.compose import handler as compose_handler

_CHAPTER = {
    "chapterId": "c1",
    "title": "2024 年 3 月 · 杭州",
    "chapterContext": "那年春天我回了老家。",
    "photos": [
        {
            "photoId": "p1",
            "ref200px": "data:image/jpeg;base64,AAAA",
            "takenAt": "2024-03-02T09:00:00Z",
            "place": "杭州",
        }
    ],
    "pages": [{"pageIndex": 0, "templateId": "mag-01", "images": {"image": "p1"}}],
}


def _ark_response(text="hello", prompt=7, completion=3):
    return {
        "choices": [{"message": {"content": text}}],
        "usage": {"prompt_tokens": prompt, "completion_tokens": completion},
    }


def _set_ark(monkeypatch, *, model=None):
    monkeypatch.setenv("COMPOSE_PROVIDER", "ark")
    monkeypatch.setenv("ARK_API_KEY", "fake_ark")
    monkeypatch.setenv("ARK_DISABLE_THINKING", "true")
    if model:
        monkeypatch.setenv("COMPOSE_ARK_MODEL", model)
    from src import settings as s

    s.reset_settings_cache()


def test_ark_routes_to_chat_completion_with_hard_constraints(monkeypatch):
    captured: dict = {}

    async def fake_chat(**kwargs):
        captured.update(kwargs)
        return _ark_response()

    _set_ark(monkeypatch, model="doubao-test-vision-000000")
    monkeypatch.setattr(compose_handler.ai_client, "chat_completion", fake_chat)

    text, in_tok, out_tok = asyncio.run(
        compose_handler._completion([{"role": "user", "content": "hi"}], temperature=0.6)
    )

    assert (text, in_tok, out_tok) == ("hello", 7, 3)
    # doubao 三条硬约束 + compose 自己的预算/模型。
    assert captured["extra_body"] == {"thinking": {"type": "disabled"}}
    assert captured["response_format"] is None
    assert captured["max_tokens"] == 8192
    assert captured["model"] == "doubao-test-vision-000000"
    assert captured["base_url"].rstrip("/").endswith("/api/v3")


def test_ark_timeout_is_half_chapter_budget(monkeypatch):
    """chat_completion 内部瞬时错误重试一次,2×timeout 不得超过章预算 ——
    与 gemini 路径「2×60s + 余量 = 180s」的纪律同构。"""
    captured: dict = {}

    async def fake_chat(**kwargs):
        captured.update(kwargs)
        return _ark_response()

    _set_ark(monkeypatch)
    monkeypatch.setattr(compose_handler.ai_client, "chat_completion", fake_chat)

    from src.settings import get_settings

    asyncio.run(
        compose_handler._completion([{"role": "user", "content": "hi"}], temperature=0.6)
    )
    expected = int(get_settings().compose_chapter_timeout_seconds // 2)
    assert captured["timeout_seconds"] == expected


def test_gemini_default_path_unchanged(monkeypatch):
    """不设 COMPOSE_PROVIDER 时仍走 gemini_client(海外线零影响)。"""
    called: dict = {}

    async def fake_generate(**kwargs):
        called.update(kwargs)
        return {
            "candidates": [{"content": {"parts": [{"text": "g"}]}}],
            "usageMetadata": {"promptTokenCount": 2, "candidatesTokenCount": 1},
        }

    monkeypatch.delenv("COMPOSE_PROVIDER", raising=False)
    monkeypatch.setenv("SELECT_LAYOUT_API_KEY", "fake_gemini")
    from src import settings as s

    s.reset_settings_cache()
    monkeypatch.setattr(compose_handler.gemini_client, "generate_content", fake_generate)

    text, in_tok, out_tok = asyncio.run(
        compose_handler._completion([{"role": "user", "content": "hi"}], temperature=0.6)
    )
    assert (text, in_tok, out_tok) == ("g", 2, 1)
    assert called, "gemini 路径必须被调用"


def test_chapter_via_ark_writes_pages_texts(monkeypatch):
    """compose_chapter 全链(ark):fake 返回合法 pages JSON,文案落到页上。"""

    async def fake_chat(**kwargs):
        return _ark_response(
            json.dumps({"pages": [{"pageIndex": 0, "texts": {"title": "糖色"}}]},
                       ensure_ascii=False),
            prompt=11,
            completion=6,
        )

    _set_ark(monkeypatch)
    monkeypatch.setattr(compose_handler.ai_client, "chat_completion", fake_chat)

    result = asyncio.run(compose_handler.compose_chapter(_CHAPTER, language="zh"))
    assert result.pages_texts == {0: {"title": "糖色"}}
    assert (result.call_count, result.input_tokens, result.output_tokens) == (1, 11, 6)


def test_chapter_via_ark_failure_returns_empty(monkeypatch):
    """ark 调用炸掉同样「掉队不作废」:空结果,该章保留模板 sample。"""

    async def boom(**kwargs):
        raise RuntimeError("ark down")

    _set_ark(monkeypatch)
    monkeypatch.setattr(compose_handler.ai_client, "chat_completion", boom)

    result = asyncio.run(compose_handler.compose_chapter(_CHAPTER, language="zh"))
    assert result.pages_texts == {}
