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


def test_sanitize_style_rejects_illegal_values():
    out = design._sanitize_style(
        {"fonts": {"title": "comic-sans", "body": "lora"}, "colors": {"title": "red", "body": "#A1B2C3"}},
        "zh",
    )
    assert out["fonts"]["title"] == "noto-serif-sc"  # 非法 id 落默认
    assert out["fonts"]["body"] == "lora"  # 合法保留
    assert out["colors"]["title"] == "#1c1b18"  # 非 hex 落默认
    assert out["colors"]["body"] == "#2d2a32"  # 合法 hex → 归一到正文精选板最近色


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
    assert result["fonts"]["title"] == "zcool-xiaowei"
    assert result["colors"]["title"] == "#3e5c76"  # #2b4a6f 归一到同色相石板蓝
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
            return _completion(
                {
                    "fonts": {"title": "zcool-xiaowei", "body": "lxgw-wenkai", "decoration": "smiley-sans"},
                    "colors": {"title": "#2b4a6f", "body": "#1c1b18", "explain": "#6b675f"},
                }
            )
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
    assert "fontMenu" in style_payload

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

    # 双失败:字体颜色落英文默认;封面标题槽兜相册标题;封尾空串(Web 侧留空)。
    # decoration 默认走艺术字体(与正文拉开质感;三组策略:衬线/黑体/艺术字)。
    assert result["fonts"] == {"title": "playfair-display", "body": "inter", "decoration": "great-vibes"}
    assert result["colors"] == {"title": "#1c1b18", "body": "#1c1b18", "explain": "#6b675f"}
    assert result["coverTexts"] == {"title": "Summer by the Sea"}
    assert result["endingTexts"] == {"closing": ""}
    assert result["models"] == {"style": None, "copy": None}


def test_slot_texts_only_accepts_declared_slots():
    out = design._slot_texts(
        {"coverTexts": {"title": "A", "hacker": "B"}}, "coverTexts", _COVER_SLOTS
    )
    assert out == {"title": "A"}


# ── 字体气质组合 + 颜色归一(2026-07-15,框架版待精调) ────────────────────────

def test_font_presets_are_subsets_of_role_menus():
    """组合里的每款字体必须在对应 role 的全量菜单里 —— 精调组合时手滑写错 id,
    这里当场红,而不是线上 sanitize 静默落默认字体。"""
    from src.workflows.core.design.handler import _FONT_MENU, _FONT_PRESETS

    for name, preset in _FONT_PRESETS.items():
        assert preset["vibe"], f"{name} 缺 vibe 描述"
        for role in ("title", "body", "decoration"):
            stray = [f for f in preset[role] if f not in _FONT_MENU[role]]
            assert not stray, f"组合 {name}.{role} 有菜单外字体: {stray}"


def test_snap_color_hue_faithful_and_idempotent():
    from src.workflows.core.design.handler import _CURATED_COLORS, _snap_color

    # 幂等:板上的色原样通过。
    for role, palette in _CURATED_COLORS.items():
        for color in palette:
            assert _snap_color(role, color) == color
    # 色相忠实:钢蓝归石板蓝(曾因亮度加权归到墨绿 —— 色相跑偏是归一的头号禁忌)。
    assert _snap_color("title", "#2b4a6f") == "#3e5c76"
    # 荧光色被拽回稳色。
    assert _snap_color("title", "#00ff00") == "#4a6653"
    # 未知 role 不误伤。
    assert _snap_color("unknown", "#123456") == "#123456"


def test_body_palette_stays_dark_for_readability():
    """正文板全深色是「正文比照片主色更深更稳」的代码兜底 —— 精调色板时
    往正文板里塞浅色,这里会红。"""
    from src.workflows.core.design.handler import _CURATED_COLORS

    for color in _CURATED_COLORS["body"]:
        v = color.lstrip("#")
        r, g, b = int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)
        luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
        assert luminance < 90, f"正文板出现浅色 {color}(亮度 {luminance:.0f}),白底长文不可读"


def test_style_payload_carries_font_presets(monkeypatch):
    """设计载荷带 fontPresets(组合选字的输入);fontMenu 仍在(兜底+校验口径)。"""
    _set_keys(monkeypatch)
    captured: list[str] = []

    async def fake_chat_completion(**kwargs):
        captured.append(kwargs["messages"][1]["content"])
        return {"choices": [{"message": {"content": json.dumps({
            "fonts": {"title": "playfair-display", "body": "lora", "decoration": "great-vibes"},
            "colors": {"title": "#7a4b2a", "body": "#1c1b18", "explain": "#6b675f"},
        })}}]}

    monkeypatch.setattr(ai_client, "chat_completion", fake_chat_completion)
    result = asyncio.run(
        design.run_design(
            language="zh",
            album_title="测试册",
            chapter_contexts=["复古胶片旅行"],
            cover_slots=[],
            ending_slots=[],
        )
    )
    payload = json.loads(captured[0])
    assert "fontPresets" in payload and "vintage" in payload["fontPresets"]
    assert "fontMenu" in payload
    assert result["fonts"]["title"] == "playfair-display"
