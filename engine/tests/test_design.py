"""设计环节(run_design):字体/颜色净化、封面封尾文案、失败兜底。AI 调用全 mock。"""

from __future__ import annotations

import asyncio
import json

import pytest

from src.providers import ai_client
from src.workflows.core.design import handler as design


def _completion(content: dict) -> dict:
    return {
        "choices": [{"message": {"content": json.dumps(content, ensure_ascii=False)}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20},
    }


def _set_keys(monkeypatch) -> None:
    monkeypatch.setenv("ARK_API_KEY", "fake_ark")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "fake_deep")
    from src import settings as s

    s.reset_settings_cache()


_COVER_SLOTS = [{"id": "title", "role": "title", "maxChars": 12, "sample": "My Story"}]
_ENDING_SLOTS = [{"id": "closing", "role": "body", "sample": "…"}]


def test_sanitize_style_rejects_illegal_values():
    out = design._sanitize_style(
        {"fonts": {"title": "comic-sans", "body": "lora"}, "colors": {"title": "red", "body": "#A1B2C3"}},
        "zh",
    )
    assert out["fonts"]["title"] == "noto-serif-sc"  # 非法 id 落默认
    assert out["fonts"]["body"] == "lora"  # 合法保留
    assert out["colors"]["title"] == "#1c1b18"  # 非 hex 落默认
    assert out["colors"]["body"] == "#a1b2c3"  # 合法归一小写


def test_run_design_happy_path(monkeypatch):
    _set_keys(monkeypatch)
    calls: list[str] = []
    copy_user_payloads: list[str] = []

    async def fake_completion(**kwargs):
        system = kwargs["messages"][0]["content"]
        if "风格设计师" not in system:
            copy_user_payloads.append(kwargs["messages"][1]["content"])
        if "风格设计师" in system:
            calls.append("style")
            return _completion(
                {
                    "fonts": {"title": "zcool-xiaowei", "body": "lxgw-wenkai", "decoration": "smiley-sans"},
                    "colors": {"title": "#2b4a6f", "body": "#1c1b18", "explain": "#6b675f"},
                }
            )
        calls.append("copy")
        return _completion(
            {"coverTexts": {"title": "海边的夏天"}, "endingTexts": {"closing": "潮声不止,记忆常新。"}}
        )

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    result = asyncio.run(
        design.run_design(
            language="zh",
            album_title="",
            chapter_contexts=["海边度假", ""],
            cover_slots=_COVER_SLOTS,
            ending_slots=_ENDING_SLOTS,
        )
    )

    assert sorted(calls) == ["copy", "style"]  # 两次调用(并发)
    # 字数预算随槽规格进了文案调用的 payload(提示词约束;输出不硬截断)。
    copy_payload = json.loads(copy_user_payloads[0])
    assert copy_payload["coverSlots"][0]["maxChars"] == 12
    assert result["fonts"]["title"] == "zcool-xiaowei"
    assert result["colors"]["title"] == "#2b4a6f"
    assert result["coverTexts"] == {"title": "海边的夏天"}
    assert result["endingTexts"] == {"closing": "潮声不止,记忆常新。"}


def test_run_design_falls_back_and_uses_album_title(monkeypatch):
    _set_keys(monkeypatch)

    async def boom(**kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr(ai_client, "chat_completion", boom)

    result = asyncio.run(
        design.run_design(
            language="en",
            album_title="Summer by the Sea",
            chapter_contexts=[],
            cover_slots=_COVER_SLOTS,
            ending_slots=_ENDING_SLOTS,
        )
    )

    # 双失败:字体颜色落英文默认;封面标题槽兜相册标题;封尾空串(Web 侧留空)。
    assert result["fonts"] == {"title": "playfair-display", "body": "inter", "decoration": "inter"}
    assert result["colors"] == {"title": "#1c1b18", "body": "#1c1b18", "explain": "#6b675f"}
    assert result["coverTexts"] == {"title": "Summer by the Sea"}
    assert result["endingTexts"] == {"closing": ""}
    assert result["models"] == {"style": None, "copy": None}


def test_slot_texts_only_accepts_declared_slots():
    out = design._slot_texts(
        {"coverTexts": {"title": "A", "hacker": "B"}}, "coverTexts", _COVER_SLOTS
    )
    assert out == {"title": "A"}
