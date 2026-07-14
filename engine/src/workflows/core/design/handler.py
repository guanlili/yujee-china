"""设计环节(用户选定封面组后同步调用):①全书字体+颜色 ②封面/封尾文案。

两次模型调用并发跑:风格(字体+颜色)走 ark vision slot 的文本能力,封面封尾
文案走 deepseek slot。任何失败都回退确定性默认值 —— 设计环节绝不阻断交付;
应用(carrier sweep / 组页 / 落库)在 Web 侧,这里只出决策 JSON。
"""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Any, get_args

from ....contracts.schemas import ArtFontPack
from ....logging_config import get_logger
from ....providers import ai_client
from ....providers.vision_provider import ark_vision_slot
from ....settings import get_settings
from ....skills import load_prompt

log = get_logger("design")

_PROMPT_DIR = Path(__file__).resolve().parent
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_LEGAL_FONTS: frozenset[str] = frozenset(get_args(ArtFontPack))

# 按角色分组的字体菜单(与 packages/contracts enums / design-agent font-registry 三处对齐)。
_FONT_MENU = {
    "title": [
        "noto-serif-sc", "zcool-xiaowei", "smiley-sans", "zcool-qingke-huangyou",
        "long-cang", "playfair-display", "cormorant-garamond", "bebas-neue",
        "archivo-black", "abril-fatface", "montserrat",
    ],
    "body": [
        "noto-serif-sc", "noto-sans-sc", "lxgw-wenkai", "eb-garamond",
        "source-serif-4", "lora", "libre-baskerville", "inter", "work-sans",
        "dm-sans", "poppins", "raleway",
    ],
    "decoration": [
        "noto-sans-sc", "smiley-sans", "zhi-mang-xing", "liu-jian-mao-cao",
        "ibm-plex-mono", "jetbrains-mono", "great-vibes", "dancing-script",
        "sacramento", "parisienne",
    ],
}

# role → 默认字体的三组策略(与 contracts DEFAULT_ALBUM_FONT 对齐):
#   title 衬线 / body(含 explain) 黑体 / decoration 艺术字体。
_DEFAULT_FONTS = {
    "zh": {"title": "noto-serif-sc", "body": "noto-sans-sc", "decoration": "zhi-mang-xing"},
    "en": {"title": "playfair-display", "body": "inter", "decoration": "great-vibes"},
}
_DEFAULT_COLORS = {"title": "#1c1b18", "body": "#1c1b18", "explain": "#6b675f"}

_STYLE_MAX_TOKENS = 300
_COPY_MAX_TOKENS = 800


def _default_style(language: str) -> dict[str, dict[str, str]]:
    return {
        "fonts": dict(_DEFAULT_FONTS.get(language, _DEFAULT_FONTS["en"])),
        "colors": dict(_DEFAULT_COLORS),
    }


def _sanitize_style(parsed: Any, language: str) -> dict[str, dict[str, str]]:
    """逐键校验模型输出:非法字体 id / 非法 hex 落回默认,绝不透传脏值。"""
    out = _default_style(language)
    fonts = parsed.get("fonts") if isinstance(parsed, dict) else None
    if isinstance(fonts, dict):
        for key in ("title", "body", "decoration"):
            value = fonts.get(key)
            if isinstance(value, str) and value in _LEGAL_FONTS:
                out["fonts"][key] = value
    colors = parsed.get("colors") if isinstance(parsed, dict) else None
    if isinstance(colors, dict):
        for key in ("title", "body", "explain"):
            value = colors.get(key)
            if isinstance(value, str) and _HEX_RE.fullmatch(value.strip()):
                out["colors"][key] = value.strip().lower()
    return out


def _slot_texts(parsed: Any, key: str, slots: list[dict[str, Any]]) -> dict[str, str]:
    """只收模板声明过的槽位,字符串值;缺槽给空串(Web 侧再兜标题=相册标题)。"""
    legal = {slot["id"] for slot in slots}
    raw = parsed.get(key) if isinstance(parsed, dict) else None
    out = {slot_id: "" for slot_id in legal}
    if isinstance(raw, dict):
        for slot_id, text in raw.items():
            if slot_id in legal and isinstance(text, str):
                out[slot_id] = text.strip()
    return out


async def _select_style(
    language: str, album_title: str, chapter_contexts: list[str]
) -> tuple[dict[str, dict[str, str]], str | None]:
    settings = get_settings()
    slot = ark_vision_slot(settings)  # 文本任务用同一 ark slot(生产=豆包)
    payload = {
        "language": language,
        "albumTitle": album_title,
        "chapterContexts": chapter_contexts,
        "fontMenu": _FONT_MENU,
    }
    messages = [
        {"role": "system", "content": load_prompt(_PROMPT_DIR / "design_style.md")},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    response = await ai_client.chat_completion(
        base_url=slot.base_url,
        api_key=slot.api_key,
        model=slot.model,
        messages=messages,
        timeout_seconds=slot.timeout_seconds,
        temperature=0.4,
        max_tokens=_STYLE_MAX_TOKENS,
        response_format=slot.response_format,
        extra_body=slot.extra_body,
    )
    parsed = ai_client.parse_json_loose(ai_client.extract_text(response))
    return _sanitize_style(parsed, language), slot.model


async def _write_cover_copy(
    language: str,
    album_title: str,
    chapter_contexts: list[str],
    cover_slots: list[dict[str, Any]],
    ending_slots: list[dict[str, Any]],
) -> tuple[dict[str, str], dict[str, str], str | None]:
    settings = get_settings()
    payload = {
        "language": language,
        "albumTitle": album_title,
        "chapterContexts": chapter_contexts,
        "coverSlots": cover_slots,
        "endingSlots": ending_slots,
    }
    messages = [
        {"role": "system", "content": load_prompt(_PROMPT_DIR / "cover_copy.md")},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    response = await ai_client.chat_completion(
        base_url=settings.deepseek_base_url,
        api_key=settings.deepseek_api_key,
        model=settings.deepseek_model,
        messages=messages,
        timeout_seconds=settings.deepseek_timeout_seconds,
        temperature=0.7,
        max_tokens=_COPY_MAX_TOKENS,
    )
    parsed = ai_client.parse_json_loose(ai_client.extract_text(response))
    return (
        _slot_texts(parsed, "coverTexts", cover_slots),
        _slot_texts(parsed, "endingTexts", ending_slots),
        settings.deepseek_model,
    )


async def run_design(
    *,
    language: str,
    album_title: str,
    chapter_contexts: list[str],
    cover_slots: list[dict[str, Any]],
    ending_slots: list[dict[str, Any]],
) -> dict[str, Any]:
    """设计决策:并发跑风格与文案,任一失败落回默认值(不阻断)。"""

    async def style_safe() -> tuple[dict[str, dict[str, str]], str | None]:
        try:
            return await _select_style(language, album_title, chapter_contexts)
        except Exception as exc:  # noqa: BLE001 — 设计环节绝不阻断
            log.warning("design.style_fallback", error=str(exc))
            return _default_style(language), None

    async def copy_safe() -> tuple[dict[str, str], dict[str, str], str | None]:
        try:
            return await _write_cover_copy(
                language, album_title, chapter_contexts, cover_slots, ending_slots
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("design.copy_fallback", error=str(exc))
            empty_cover = {slot["id"]: "" for slot in cover_slots}
            empty_ending = {slot["id"]: "" for slot in ending_slots}
            return empty_cover, empty_ending, None

    (style, style_model), (cover_texts, ending_texts, copy_model) = await asyncio.gather(
        style_safe(), copy_safe()
    )
    # 封面标题兜底:模型没写/失败时,标题槽用相册标题(role=title 的槽)。
    if album_title:
        for slot in cover_slots:
            if slot.get("role") == "title" and not cover_texts.get(slot["id"]):
                cover_texts[slot["id"]] = album_title
    return {
        "fonts": style["fonts"],
        "colors": style["colors"],
        "coverTexts": cover_texts,
        "endingTexts": ending_texts,
        "models": {"style": style_model, "copy": copy_model},
    }
