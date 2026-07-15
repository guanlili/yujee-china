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
from ...prompts import load_prompt

log = get_logger("design")

_PROMPT_DIR = Path(__file__).resolve().parent
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_LEGAL_FONTS: frozenset[str] = frozenset(get_args(ArtFontPack))

# 按角色分组的字体菜单(与 packages/contracts enums / design-agent font-registry 三处对齐)。

# role → 默认字体的三组策略(与 contracts DEFAULT_ALBUM_FONT 对齐):
#   title 衬线 / body(含 explain) 黑体 / decoration 艺术字体。
_DEFAULT_FONTS = {
    "zh": {"title": "noto-serif-sc", "body": "noto-sans-sc", "decoration": "zhi-mang-xing"},
    "en": {"title": "playfair-display", "body": "inter", "decoration": "great-vibes"},
}
# 正文/图注/无点缀时统一用这个墨黑(以黑色为主,用户拍板 2026-07-16)。
_INK_BLACK = "#1c1b18"
_DEFAULT_COLORS = {"title": _INK_BLACK, "body": _INK_BLACK, "explain": _INK_BLACK}

# ── 场景字体预设(用户拍板 2026-07-15) ──────────────────────────────────────────
# AI 只做一件事:读懂这本书(各章 title/keywords/context)→ 判断最贴的【场景】→
# 输出场景名。字体由代码按【场景 × 语言】查本表填,AI 永远不接触字体 id,
# 也就不会选错字体。中英文书各一套(拉丁字体不含中文字形,反之亦然)。
# 装饰位统一从 4 款拉丁花体选(装饰基本是英文日期/编号/标签,见 _DECORATION_SCRIPTS)。
# 内容(场景名/关键词/字体搭配)是可精调的框架,守卫测试保证不越界。
_SCENE_PRESETS: dict[str, dict[str, Any]] = {
    "法式清新": {
        "palette": "morandi",
        "keywords": ["草地", "蓝天", "白云", "白裙", "花", "野餐", "阳光"],
        "zh": {"title": "zcool-xiaowei", "body": "lxgw-wenkai", "decoration": "parisienne"},
        "en": {"title": "cormorant-garamond", "body": "lora", "decoration": "parisienne"},
    },
    "法式复古": {
        "palette": "morandi",
        "keywords": ["老照片", "胶片", "暖调", "旧物", "街角", "旧时光", "怀旧"],
        "zh": {"title": "noto-serif-sc", "body": "noto-serif-sc", "decoration": "great-vibes"},
        "en": {"title": "playfair-display", "body": "eb-garamond", "decoration": "great-vibes"},
    },
    "日式清新": {
        "palette": "morandi",
        "keywords": ["和风", "极简", "留白", "原木", "抹茶", "安静", "侘寂"],
        "zh": {"title": "smiley-sans", "body": "noto-sans-sc", "decoration": "sacramento"},
        "en": {"title": "montserrat", "body": "work-sans", "decoration": "sacramento"},
    },
    "中式古典": {
        "palette": "morandi",
        "keywords": ["水墨", "书法", "庭院", "茶", "古风", "山水", "写意"],
        "zh": {"title": "zhi-mang-xing", "body": "lxgw-wenkai", "decoration": "sacramento"},
        "en": {"title": "cormorant-garamond", "body": "eb-garamond", "decoration": "sacramento"},
    },
    "现代时尚": {
        "palette": "vivid",
        "keywords": ["都市", "杂志", "简约", "设计感", "黑白", "街拍", "时尚"],
        "zh": {"title": "smiley-sans", "body": "noto-sans-sc", "decoration": "dancing-script"},
        "en": {"title": "bebas-neue", "body": "inter", "decoration": "dancing-script"},
    },
    "温馨童趣": {
        "palette": "vivid",
        "keywords": ["孩子", "宝宝", "宠物", "生日", "明快", "圆润", "笑"],
        "zh": {"title": "zcool-qingke-huangyou", "body": "noto-sans-sc", "decoration": "dancing-script"},
        "en": {"title": "poppins", "body": "dm-sans", "decoration": "dancing-script"},
    },
    "旅行随记": {
        "palette": "vivid",
        "keywords": ["旅途", "风景", "地图", "路上", "远方", "海", "山"],
        "zh": {"title": "long-cang", "body": "lxgw-wenkai", "decoration": "dancing-script"},
        "en": {"title": "montserrat", "body": "work-sans", "decoration": "dancing-script"},
    },
}
# 匹配不到 / AI 乱填时的兜底场景(经典百搭)。
_DEFAULT_SCENE = "法式复古"
# 装饰位允许的字体(4 款拉丁花体);守卫测试用它卡住每个场景的 decoration。
_DECORATION_SCRIPTS = frozenset({"great-vibes", "dancing-script", "sacramento", "parisienne"})


def _scene_menu() -> list[dict[str, Any]]:
    """喂给 AI 的场景菜单:只给名字 + 触发关键词,不给字体(AI 按关键词匹配场景)。"""
    return [{"name": name, "keywords": p["keywords"]} for name, p in _SCENE_PRESETS.items()]


def _resolve_scene(scene: str | None, language: str) -> dict[str, str]:
    """场景名 + 语言 → 三款字体 id。未知场景落兜底场景。"""
    preset = _SCENE_PRESETS.get(scene or "") or _SCENE_PRESETS[_DEFAULT_SCENE]
    lang = "zh" if language == "zh" else "en"
    return dict(preset[lang])


def _scene_palette(scene: str | None) -> str:
    """场景 → 点缀色板性格(莫兰迪/鲜亮)。未知场景落兜底场景的色板。"""
    preset = _SCENE_PRESETS.get(scene or "") or _SCENE_PRESETS[_DEFAULT_SCENE]
    return preset.get("palette", _DEFAULT_PALETTE)

# ── 点缀色管线(用户拍板 2026-07-16) ─────────────────────────────────────────────
# 颜色不让 AI 填 hex。分三步:
#   ① 代码从各章 extractedColor 算【主色系】(出现最多的色相家族)。
#   ② AI 只选一个 ID:同类(analogous)/互补(complementary) —— 点缀色取主色相
#      本身还是其互补方向。
#   ③ 代码把目标色相 snap 到【场景色板】(莫兰迪 或 鲜亮,每个场景自带)上最近的成品色。
# AI 全程不碰 hex;算不出主色系(照片都是中性灰)时点缀色落黑,以黑为主。
import colorsys

# 每个色相家族一款成品色,snap 时按【色相】就近取(饱和/明度由色板性格锁定)。
_MORANDI_ACCENTS = [
    "#a86a6a", "#b3785a", "#a89268", "#8a9a76", "#6e8570",
    "#6d8c88", "#6b8299", "#6a6d92", "#8a7791", "#a87d8a",
]
_VIVID_ACCENTS = [
    "#c23b3b", "#d1691c", "#c79320", "#2f9550", "#159084",
    "#2668a0", "#3a3f9c", "#7a35a0", "#bf3f86", "#b3541e",
]
_ACCENT_PALETTES = {"morandi": _MORANDI_ACCENTS, "vivid": _VIVID_ACCENTS}
_DEFAULT_PALETTE = "morandi"


def _hue(hex_color: str) -> tuple[float, float]:
    """hex → (色相 0-360, 饱和 0-1)。"""
    v = hex_color.lstrip("#")
    r, g, b = int(v[0:2], 16) / 255, int(v[2:4], 16) / 255, int(v[4:6], 16) / 255
    h, _l, sat = colorsys.rgb_to_hls(r, g, b)
    return h * 360, sat


def _dominant_hue(chapters: list[dict[str, Any]]) -> float | None:
    """各章 extractedColor 里出现最多的色相家族(12 桶各 30°)。

    近中性色(饱和 < 0.18)不算数 —— 灰墙/白裙不代表色系。全中性/无色 → None。"""
    buckets: dict[int, int] = {}
    for ch in chapters:
        color = ch.get("extractedColor")
        if not isinstance(color, str) or not _HEX_RE.fullmatch(color.strip()):
            continue
        hue, sat = _hue(color.strip())
        if sat < 0.18:
            continue
        b = int(hue // 30) % 12
        buckets[b] = buckets.get(b, 0) + 1
    if not buckets:
        return None
    top = max(buckets, key=lambda k: buckets[k])
    return top * 30 + 15  # 桶中心


def _snap_hue_to_palette(target_hue: float, palette: list[str]) -> str:
    """把目标色相 snap 到色板里色相最近的成品色(环形色相距离)。"""

    def hue_dist(hexc: str) -> float:
        d = abs(_hue(hexc)[0] - target_hue) % 360
        return min(d, 360 - d)

    return min(palette, key=hue_dist)


def _accent_color(chapters: list[dict[str, Any]], mode: str, palette_name: str) -> str:
    """主色系 + 同类/互补 + 场景色板 → 点缀色。算不出主色系落黑。"""
    dominant = _dominant_hue(chapters)
    if dominant is None:
        return _INK_BLACK
    target = (dominant + 180) % 360 if mode == "complementary" else dominant
    palette = _ACCENT_PALETTES.get(palette_name, _MORANDI_ACCENTS)
    return _snap_hue_to_palette(target, palette)

_STYLE_MAX_TOKENS = 300
_COPY_MAX_TOKENS = 800


def _default_style(language: str) -> dict[str, dict[str, str]]:
    return {
        "fonts": dict(_DEFAULT_FONTS.get(language, _DEFAULT_FONTS["en"])),
        "colors": dict(_DEFAULT_COLORS),
    }


def _sanitize_style(
    parsed: Any, language: str, chapters: list[dict[str, Any]] | None = None
) -> dict[str, dict[str, str]]:
    """把模型输出组装成最终风格。AI 只输出两个 ID:`scene` 和 `colorMode`,其余全代码算。

    字体:场景 × 语言 查表填三款(AI 不接触字体 id,未知场景落兜底)。
    颜色:代码从各章 extractedColor 算主色系 → AI 选的 colorMode(同类/互补)定方向 →
    snap 到场景色板(莫兰迪/鲜亮)→ 点缀色染 title(decoration 跟着);body/explain 恒黑。
    """
    out = _default_style(language)
    scene = parsed.get("scene") if isinstance(parsed, dict) else None
    scene = scene if isinstance(scene, str) else None
    out["fonts"] = _resolve_scene(scene, language)

    mode = parsed.get("colorMode") if isinstance(parsed, dict) else None
    mode = mode if mode in ("analogous", "complementary") else "analogous"
    accent = _accent_color(chapters or [], mode, _scene_palette(scene))
    out["colors"]["title"] = accent
    out["colors"]["body"] = _INK_BLACK
    out["colors"]["explain"] = _INK_BLACK
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
    language: str, album_title: str, chapter_profiles: list[dict[str, Any]]
) -> tuple[dict[str, dict[str, str]], str | None]:
    settings = get_settings()
    slot = ark_vision_slot(settings)  # 文本任务用同一 ark slot(生产=豆包)
    payload = {
        "language": language,
        "albumTitle": album_title,
        # 每章画像:采访背景 + 识图关键词 + 分组取色(照片真实色调的硬信号)。
        "chapters": chapter_profiles,
        # 场景菜单:AI 按各章关键词匹配一个场景,输出场景名(见 design_style.md)。
        # 字体由代码按 场景×语言 查表填,不发字体给 AI。
        "scenes": _scene_menu(),
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
    return _sanitize_style(parsed, language, chapter_profiles), slot.model


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
    chapter_profiles: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """设计决策:并发跑风格与文案,任一失败落回默认值(不阻断)。

    chapter_profiles(每章 chapterContext+keywords+extractedColor)优先;老 caller
    只送 chapter_contexts 时降级为纯背景画像。"""
    profiles = (
        chapter_profiles
        if chapter_profiles is not None
        else [
            {"title": "", "chapterContext": ctx, "keywords": [], "extractedColor": None}
            for ctx in chapter_contexts
        ]
    )

    async def style_safe() -> tuple[dict[str, dict[str, str]], str | None]:
        try:
            return await _select_style(language, album_title, profiles)
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
