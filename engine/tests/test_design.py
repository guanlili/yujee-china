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


_COVER_SLOTS = [{"id": "title", "role": "title", "sample": "My Story"}]
_ENDING_SLOTS = [{"id": "closing", "role": "body", "sample": "…"}]


def test_sanitize_style_scene_fonts_and_black():
    # 字体:AI 只给 scene,代码按 场景×语言 查表填(AI 不碰字体 id)。
    # 颜色:设计环节不做彩色 —— 标题/正文/图注三色全黑,与 AI 输出/照片主色无关。
    out = design._sanitize_style({"scene": "清新"}, "zh")
    assert out["fonts"] == {"title": "lxgw-wenkai", "body": "lxgw-wenkai", "decoration": "dancing-script"}
    assert out["colors"] == {"title": "#1c1b18", "body": "#1c1b18", "explain": "#1c1b18"}


def test_sanitize_style_unknown_scene_falls_back():
    out = design._sanitize_style({"scene": "不存在的场景"}, "en")
    # 兜底场景(常规)的英文搭配;颜色恒黑。
    assert out["fonts"] == {"title": "playfair-display", "body": "eb-garamond", "decoration": "great-vibes"}
    assert out["colors"] == {"title": "#1c1b18", "body": "#1c1b18", "explain": "#1c1b18"}


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
            return _completion({"scene": "清新"})
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
    assert result["fonts"] == {"title": "lxgw-wenkai", "body": "lxgw-wenkai", "decoration": "dancing-script"}  # 清新·中文
    # 设计环节不做彩色:三色全黑。
    assert result["colors"] == {"title": "#1c1b18", "body": "#1c1b18", "explain": "#1c1b18"}
    assert result["coverTexts"] == {"title": "海边的夏天"}
    assert result["endingTexts"] == {"closing": "潮声不止,记忆常新。"}


def test_run_design_sends_chapter_profiles_to_style_model(monkeypatch):
    # 每章画像(采访背景+识图关键词+分组取色)进 design_style 载荷;老 caller 只送
    # contexts 时降级为空 keywords/null 色。
    _set_keys(monkeypatch)
    style_user_payloads: list[str] = []

    async def fake_completion(**kwargs):
        system = kwargs["messages"][0]["content"]
        if "风格设计师" in system:
            style_user_payloads.append(kwargs["messages"][1]["content"])
            return _completion({"scene": "清新"})
        return _completion({"coverTexts": {}, "endingTexts": {}})

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)

    profiles = [
        {"chapterContext": "海边度假", "keywords": ["沙滩", "日落"], "extractedColor": "#c96f3b"},
        {"chapterContext": "", "keywords": ["雪山"], "extractedColor": None},
    ]
    asyncio.run(
        design.run_design(
            language="zh",
            album_title="",
            chapter_contexts=["海边度假", ""],
            cover_slots=_COVER_SLOTS,
            ending_slots=_ENDING_SLOTS,
            chapter_profiles=profiles,
        )
    )

    style_payload = json.loads(style_user_payloads[0])
    assert style_payload["chapters"] == profiles
    assert "chapterContexts" not in style_payload
    assert "scenes" in style_payload and any(sc["name"] == "清新" for sc in style_payload["scenes"])

    # 老 caller:不送 profiles → 由 contexts 降级组画像。
    style_user_payloads.clear()
    asyncio.run(
        design.run_design(
            language="zh",
            album_title="",
            chapter_contexts=["公园散步"],
            cover_slots=_COVER_SLOTS,
            ending_slots=_ENDING_SLOTS,
        )
    )
    fallback_payload = json.loads(style_user_payloads[0])
    assert fallback_payload["chapters"] == [
        {"title": "", "chapterContext": "公园散步", "keywords": [], "extractedColor": None}
    ]


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

    # 双失败:字体落英文默认(对齐「常规」场景);封面标题槽兜相册标题;封尾空串(Web 侧留空)。
    assert result["fonts"] == {"title": "playfair-display", "body": "eb-garamond", "decoration": "great-vibes"}
    assert result["colors"] == {"title": "#1c1b18", "body": "#1c1b18", "explain": "#1c1b18"}  # 恒黑
    assert result["coverTexts"] == {"title": "Summer by the Sea"}
    assert result["endingTexts"] == {"closing": ""}
    assert result["models"] == {"style": None, "copy": None}


def test_slot_texts_only_accepts_declared_slots():
    out = design._slot_texts(
        {"coverTexts": {"title": "A", "hacker": "B"}}, "coverTexts", _COVER_SLOTS
    )
    assert out == {"title": "A"}


# ── 场景字体守卫(4 分类,颜色恒黑,2026-07-16) ──────────────────────────────────

def test_scene_presets_wellformed_and_legal():
    """场景表守卫:精调场景/字体时手滑写错 id、漏 role、装饰用错字体,当场红。"""
    from src.workflows.core.design.handler import (
        _DECORATION_SCRIPTS,
        _DEFAULT_SCENE,
        _LEGAL_FONTS,
        _SCENE_PRESETS,
    )

    assert _DEFAULT_SCENE in _SCENE_PRESETS, "兜底场景必须在表里"
    for name, preset in _SCENE_PRESETS.items():
        assert preset["keywords"], f"{name} 缺触发关键词"
        for lang in ("zh", "en"):
            trio = preset[lang]
            assert set(trio) == {"title", "body", "decoration"}, f"{name}.{lang} 三 role 不齐"
            for role, font in trio.items():
                assert font in _LEGAL_FONTS, f"{name}.{lang}.{role} 非法字体 id: {font}"
            assert trio["decoration"] in _DECORATION_SCRIPTS, (
                f"{name}.{lang} 装饰字体 {trio['decoration']} 不在 4 款拉丁花体里"
            )


def test_resolve_scene_by_language_and_fallback():
    from src.workflows.core.design.handler import _resolve_scene

    assert _resolve_scene("清新", "zh")["title"] == "lxgw-wenkai"
    assert _resolve_scene("清新", "en")["title"] == "montserrat"
    # 未知场景 → 兜底场景(常规)。
    assert _resolve_scene("瞎编的", "en")["title"] == "playfair-display"
    assert _resolve_scene(None, "zh")["title"] == "noto-serif-sc"


def test_style_payload_carries_scenes_and_resolves_fonts(monkeypatch):
    """设计载荷带场景菜单(name+keywords,不含字体);AI 只输出 scene,代码按 场景×语言 填字体。"""
    _set_keys(monkeypatch)
    captured: list[str] = []

    async def fake_chat_completion(**kwargs):
        captured.append(kwargs["messages"][1]["content"])
        return {"choices": [{"message": {"content": json.dumps({"scene": "常规"})}}]}

    monkeypatch.setattr(ai_client, "chat_completion", fake_chat_completion)
    result = asyncio.run(
        design.run_design(
            language="zh",
            album_title="测试册",
            chapter_contexts=["日常居家生活"],
            cover_slots=[],
            ending_slots=[],
        )
    )
    payload = json.loads(captured[0])
    assert "scenes" in payload and any(sc["name"] == "常规" for sc in payload["scenes"])
    # 载荷不含字体 id(AI 不接触字体)。
    assert "fontMenu" not in payload and "fontPresets" not in payload
    # 常规·中文搭配由代码填。
    assert result["fonts"] == {"title": "noto-serif-sc", "body": "noto-serif-sc", "decoration": "great-vibes"}
