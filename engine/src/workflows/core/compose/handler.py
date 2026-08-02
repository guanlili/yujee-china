"""compose(§ 一次性成稿):用户选完设计之后,一次把全书文案写满。

两类调用,都走 Gemini(`providers/gemini_client`),编排在 `workflows/compose.py`:

- **章节批次**(`compose_chapter`):一章一次调用,把【本章真实照片】以多模态 image
  部件喂进上下文 + 把【用户在采访环节讲的原话】(`chapterContext`)当最高优先级素材,
  逐页写完该章每一页的【全部】文字槽。
- **全局批次**(`compose_global`):书名/副标题(封面槽)、封尾文案,以及全书三款字体。

蓝本是已下线的 `layout/write_copy` agent —— 逐页写全部文字槽(decoration 也写,
它是「Series · No.01」这类需要写的装饰文案;真正不该 AI 写的页码早已不是模板槽位)、
拿模板 JSON 的 `sample` 当篇幅示范、不设字数上限(渲染层 fit-text 兜底)、任何失败都
吞掉异常返回空结果。相对它改了三件事:①换 Gemini 并**真的喂图**(旧链路靠豆包产出的
`sceneDescription` 文字,豆包已砍,该字段恒空);②`chapterContext` 明确为最高优先级;
③按章并发。

字体沿用设计环节的**场景预设查表**做法(用户 2026-07-16 拍板):AI 只输出场景名,
字体由代码按 场景×语言 查表填,AI 永不接触字体 id,也就不会选错字体。用户在设计卡里
已经选过字体时(`user_font_choice`)直接采用用户的选择,连场景菜单都不发给模型。

§隐私:照片 base64 只在请求内存里 —— 只作为 image 部件进这一次 HTTP body,永不进日志
(trace 走 ai_client 的统一脱敏路径)。生产永不落盘;dev 观测台的 `ai-trace.jsonl` 是
例外(见 `providers/ai_client._write_jsonl`,生产由 `_is_production()` 关掉)。
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from itertools import zip_longest
from pathlib import Path
from typing import Any, get_args

from ....contracts.schemas import ArtFontPack
from ....logging_config import get_logger
from ....providers import ai_client, gemini_client
from ....settings import get_settings
from ...prompts import load_prompt
from ..layout import templates
from ..layout.legalize import _photo_id, _photos
from ..layout.simple_id import to_simple
from .schema import ComposeChapterResult, ComposeGlobalResult

log = get_logger("compose")

_PROMPT_DIR = Path(__file__).resolve().parent

_EMPTY_CHAPTER = ComposeChapterResult()

_LEGAL_FONTS: frozenset[str] = frozenset(get_args(ArtFontPack))
_FONT_ROLES = ("title", "body", "decoration")

# 总失败兜底字体(对齐「常规」场景;匹配不到场景/整个调用挂掉时用)。
_DEFAULT_FONTS = {
    "zh": {"title": "noto-serif-sc", "body": "noto-serif-sc", "decoration": "great-vibes"},
    "en": {"title": "playfair-display", "body": "eb-garamond", "decoration": "great-vibes"},
}

# ── 场景字体预设(4 分类,用户拍板 2026-07-16;整段自设计环节搬来) ──────────────
# AI 只做一件事:读懂这本书(各章 title/chapterContext)→ 判断最贴的【场景】→
# 输出场景名。字体由代码按【场景 × 语言】查本表填,AI 永远不接触字体 id,
# 也就不会选错字体。中英文书各一套(拉丁字体不含中文字形,反之亦然)。
# 装饰位统一从 4 款拉丁花体选(装饰基本是英文日期/编号/标签,见 _DECORATION_SCRIPTS)。
# 内容(场景名/关键词/字体搭配)是可精调的框架,守卫测试保证不越界。
_SCENE_PRESETS: dict[str, dict[str, Any]] = {
    "常规": {
        "keywords": ["日常", "家居", "室内", "都市", "街道", "生活", "居家"],
        "zh": {"title": "noto-serif-sc", "body": "noto-serif-sc", "decoration": "great-vibes"},
        "en": {"title": "playfair-display", "body": "eb-garamond", "decoration": "great-vibes"},
    },
    "清新": {
        "keywords": ["绿树", "大海", "蓝天", "草地", "自然", "户外", "清爽", "海边", "森林"],
        "zh": {"title": "lxgw-wenkai", "body": "lxgw-wenkai", "decoration": "dancing-script"},
        "en": {"title": "montserrat", "body": "work-sans", "decoration": "sacramento"},
    },
    "优雅": {
        "keywords": ["出游", "咖啡", "美食", "下午茶", "餐厅", "精致", "文艺", "小店"],
        "zh": {"title": "long-cang", "body": "noto-sans-sc", "decoration": "sacramento"},
        "en": {"title": "cormorant-garamond", "body": "eb-garamond", "decoration": "sacramento"},
    },
    "艺术": {
        "keywords": ["婚礼", "裙子", "女生", "浪漫", "唯美", "花", "礼服", "少女"],
        "zh": {"title": "liu-jian-mao-cao", "body": "lxgw-wenkai", "decoration": "parisienne"},
        "en": {"title": "parisienne", "body": "raleway", "decoration": "sacramento"},
    },
}
# 匹配不到 / AI 乱填时的兜底场景(经典百搭)。
_DEFAULT_SCENE = "常规"
# 装饰位允许的字体(4 款拉丁花体);守卫测试用它卡住每个场景的 decoration。
_DECORATION_SCRIPTS = frozenset({"great-vibes", "dancing-script", "sacramento", "parisienne"})


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


# ── 章节批次 ──────────────────────────────────────────────────────────────────


def _writable_text_slots(page: Any) -> list[dict[str, Any]]:
    """本页【全部】文字槽的规格(id/role/sample?)。
    模板未知或该页没有文字槽 → 空列表(调用方据此跳过整页)。

    decoration 槽也要写:它们是「Series · No.01」「Chapter · 05」这类装饰文案 ——
    装饰属性强,但仍然是需要写的文案。真正不该 AI 写的是页码,而页码已经不再是
    模板槽位了(展示层按当前页序统一生成,全书固定在右下角一个位置)。

    不发字数上限:模板不再声明任何字数限制,篇幅由 sample 示范,渲染层的
    fit-text(固定高度文字框自动缩字号)负责装下。

    sample 直接取槽位自己的 `sample` 字段(模板 JSON 的单一真相):同一个串既是 Web
    画板的预览占位,也是写作 LM 的输出示例 —— 让模型照例子写、而非靠规则约束。"""
    template_id = _get(page, "templateId")
    template = templates.get(template_id) if isinstance(template_id, str) else None
    if template is None:
        return []

    def _spec(slot: Mapping[str, Any], slot_id: str) -> dict[str, Any]:
        # lang 是槽的硬约束(契约里必填):'user' = 用用户语言写,'en' = 保持英文
        # (日期/编号/标签这类装饰默认 en)。不发的话,标 en 的槽会被 AI 用中文写。
        #
        # 标题一律英文(#307):产品决定所有标题/大标题走英文(杂志感),正文与图注
        # 跟随用户语言。模板 JSON 里 39 个 title 槽有 37 个声明的是 'user',但那些
        # JSON 是用户手维护的真值源 —— 所以在这里按 role 覆盖,不去批量改模板。
        role = slot["role"]
        lang = "en" if role == "title" else slot.get("lang", "user")
        spec: dict[str, Any] = {
            "id": slot_id,
            "role": role,
            "lang": lang,
        }
        sample = slot.get("sample")
        if sample:
            spec["sample"] = sample
        return spec

    specs = [_spec(slot, slot["id"]) for slot in templates.text_slots(template)]

    # items 重复组的文字槽:按本页实际格数展开成 `base[i]`。
    # 格数从页面 images 的 `image[i]` 键推(items 的图片展开就是这么生成的);
    # 每格的 explain[i] 对应第 i 张照片。不展开的话,mag-10(顶层零文字、全部文字在
    # items)整页一个字都不写,页面上四个 explain 全是空串。
    items = template.get("items") or {}
    item_texts = items.get("texts") or []
    if item_texts:
        image_bases = {s["id"] for s in (items.get("images") or [])}
        instance_count = 0
        for key in (_get(page, "images") or {}):
            base, _, rest = str(key).partition("[")
            if base in image_bases and rest.endswith("]"):
                instance_count = max(instance_count, int(rest[:-1]) + 1)
        for slot in item_texts:
            for i in range(instance_count):
                specs.append(_spec(slot, f"{slot['id']}[{i}]"))

    return specs


def _page_photo_ids(page: Any) -> list[str]:
    images = _get(page, "images") or {}
    return [pid for pid in images.values() if isinstance(pid, str) and pid]


def _photo_caption(simple_id: str, photo: Any) -> str:
    """跟在每张图前面的一行说明:短 id + 拍摄时间 + 拍摄地点(缺的就不写)。

    photoId 入模前转短 id(约定:模型上下文里绝不出现真实 UUID —— 又长又易抄错;
    本调用的输出不引用 photoId,无需反向映射)。"""
    parts = [f"照片 photoId={simple_id}"]
    taken_at = _get(photo, "takenAt")
    if taken_at:
        parts.append(f"takenAt={taken_at}")
    place = _get(photo, "place")
    if place:
        parts.append(f"place={place}")
    return " · ".join(parts)


def _build_chapter_messages(
    chapter: Any,
    page_specs: list[dict[str, Any]],
    *,
    language: str,
) -> list[dict[str, Any]]:
    """章节批次的消息体:一段 JSON(背景 + 逐页文字槽)+ 本章每张照片的真图。

    照片以 `{"type":"image_url","image_url":{"url": ref200px}}` 进 user content
    (gemini_client 会把它转成 native `inline_data` 部件),每张图前面跟一条文字说明。
    这是本环节的灵魂:照片内容由**真图**承载,不再有 sceneDescription 那种文字转述。"""
    photos_by_id = {_photo_id(p): p for p in _photos(chapter)}

    ordered_ids: list[str] = []
    seen_ids: set[str] = set()
    for spec in page_specs:
        for pid in spec["photoIds"]:
            if pid not in seen_ids:
                seen_ids.add(pid)
                ordered_ids.append(pid)
    simple_ids, _real_by_simple = to_simple(ordered_ids)
    simple_by_real = dict(zip(ordered_ids, simple_ids, strict=True))

    payload = {
        "chapterTitle": _get(chapter, "title", "") or "",
        "chapterContext": _get(chapter, "chapterContext", "") or "",
        "language": language,
        "pages": [
            {
                "pageIndex": spec["pageIndex"],
                "textSlots": spec["textSlots"],
                "photoIds": [simple_by_real[pid] for pid in spec["photoIds"]],
            }
            for spec in page_specs
        ],
    }

    content: list[dict[str, Any]] = [
        {"type": "text", "text": json.dumps(payload, ensure_ascii=False)}
    ]
    image_parts = 0
    for pid in ordered_ids:
        photo = photos_by_id.get(pid)
        ref = _get(photo, "ref200px", "") if photo is not None else ""
        if not isinstance(ref, str) or not ref:
            continue  # 没有缩略图的照片就不进上下文(宁可少一张,也不发文字冒充)
        content.append({"type": "text", "text": _photo_caption(simple_by_real[pid], photo)})
        content.append({"type": "image_url", "image_url": {"url": ref}})
        image_parts += 1

    if image_parts == 0 and ordered_ids:
        # 一张真图都没进上下文 = 这一章退化成「不看图写文案」,本环节的灵魂被架空。
        # Web 侧拿不到 IndexedDB 缩略图(换浏览器/清站点数据/跨设备继续做)时
        # refs={} 也会照常提交,生产上除了这条日志没有任何痕迹。
        log.warning(
            "compose.chapter_without_images",
            chapter_id=str(_get(chapter, "chapterId", "") or ""),
            photos=len(ordered_ids),
        )

    return [
        {"role": "system", "content": load_prompt(_PROMPT_DIR / "compose_chapter.md")},
        {"role": "user", "content": content},
    ]


def _parse_result(
    raw_text: str,
    page_specs: list[dict[str, Any]],
) -> dict[int, dict[str, str]]:
    parsed = ai_client.parse_json_loose(raw_text)
    raw_pages = parsed.get("pages") if isinstance(parsed, dict) else None
    if not isinstance(raw_pages, list):
        return {}

    writable_ids_by_page: dict[int, set[str]] = {}
    for spec in page_specs:
        idx = spec["pageIndex"]
        writable_ids_by_page[idx] = {s["id"] for s in spec["textSlots"]}

    out: dict[int, dict[str, str]] = {}
    for raw_page in raw_pages:
        if not isinstance(raw_page, dict):
            continue
        idx = raw_page.get("pageIndex")
        if not isinstance(idx, int) or isinstance(idx, bool) or idx not in writable_ids_by_page:
            continue
        texts = raw_page.get("texts")
        if not isinstance(texts, dict):
            continue
        writable_ids = writable_ids_by_page[idx]
        page_texts: dict[str, str] = {}
        for slot_id, text in texts.items():
            if slot_id not in writable_ids or not isinstance(text, str):
                continue
            page_texts[slot_id] = text
        if page_texts:
            out[idx] = page_texts
    return out


async def _gemini(messages: list[dict[str, Any]], *, temperature: float) -> tuple[str, int, int]:
    """一次 Gemini 调用 → (正文, 输入 token, 输出 token)。

    走 select_layout_* 那组设置(Gemini 槽的 endpoint/key/model/出口代理,名字是历史
    产物,它就是仓里唯一的 Gemini 槽);输出预算用 compose 自己的
    `compose_max_output_tokens` —— 成稿要一次吐出整章逐页多槽正文,比判图长得多。"""
    settings = get_settings()
    response = await gemini_client.generate_content(
        base_url=settings.select_layout_base_url,
        api_key=settings.select_layout_api_key or "",
        model=settings.select_layout_model,
        messages=messages,
        timeout_seconds=settings.select_layout_timeout_seconds,
        max_output_tokens=settings.compose_max_output_tokens,
        use_json_object=settings.select_layout_use_json_object,
        disable_thinking=settings.select_layout_disable_thinking,
        proxy=settings.select_layout_proxy,
        # 写文案不是判图:客户端默认的 0.1 会让每章都写成同一个腔调。
        temperature=temperature,
    )
    return gemini_client.text_and_usage(response)


async def compose_chapter(chapter: Any, *, language: str = "zh") -> ComposeChapterResult:
    """给一章已选定版式的页面写满文案(真图 + 用户故事 → 逐页全部文字槽)。

    没有任何可写文字槽时不调用模型。**任何**失败(缺 key / HTTP / JSON 解析不出 /
    页面数据畸形)都返回空结果 —— 调用方按「叠加合并」使用,该章页面保留模板 sample
    文案。所以 try 必须从 page_specs 那一步就罩住:`_writable_text_slots` 会对畸形的
    `image[x]` 下标抛 ValueError,漏在外面就会把整本书打成 failed。"""
    settings = get_settings()
    try:
        page_specs: list[dict[str, Any]] = []
        for page in _get(chapter, "pages", []) or []:
            slots = _writable_text_slots(page)
            if not slots:
                continue
            page_index = _get(page, "pageIndex")
            if not isinstance(page_index, int) or isinstance(page_index, bool):
                continue
            page_specs.append(
                {
                    "pageIndex": page_index,
                    "textSlots": slots,
                    "photoIds": _page_photo_ids(page),
                }
            )

        if not page_specs:
            return _EMPTY_CHAPTER

        if not settings.select_layout_api_key:
            log.warning("compose.chapter_slot_unavailable", error="select_layout_api_key missing")
            return _EMPTY_CHAPTER

        messages = _build_chapter_messages(chapter, page_specs, language=language)
        calls = 1
        try:
            raw_text, in_tok, out_tok = await _gemini(messages, temperature=0.6)
            pages_texts = _parse_result(raw_text, page_specs)
        except Exception as exc:  # noqa: BLE001
            # 一次瞬时失败(网络抖动/空正文/解析不出)不值一整章 sample:重试一次。
            # 实测 2026-07-31 多个本地单子:章节调用单次失败 → 整章文案静默回退 sample,
            # 用户看到「没写文案」。第二次仍失败才走外层兜底。
            log.warning(
                "compose.chapter_retry",
                chapter_id=str(_get(chapter, "chapterId", "") or ""),
                error=str(exc),
            )
            calls = 2
            raw_text, in_tok, out_tok = await _gemini(messages, temperature=0.6)
            pages_texts = _parse_result(raw_text, page_specs)
    except Exception as exc:  # noqa: BLE001 — 写文案绝不能抛出去搞崩成稿
        log.warning(
            "compose.chapter_failed",
            chapter_id=str(_get(chapter, "chapterId", "") or ""),
            error=str(exc),
        )
        return _EMPTY_CHAPTER

    return ComposeChapterResult(
        pages_texts=pages_texts,
        call_count=calls,
        input_tokens=in_tok,
        output_tokens=out_tok,
        model=settings.select_layout_model,
    )


# ── 全局批次(封面/封尾文案 + 字体) ──────────────────────────────────────────


def _scene_menu() -> list[dict[str, Any]]:
    """喂给 AI 的场景菜单:只给名字 + 触发关键词,不给字体(AI 按关键词匹配场景)。"""
    return [{"name": name, "keywords": p["keywords"]} for name, p in _SCENE_PRESETS.items()]


def _resolve_scene(scene: str | None, language: str) -> dict[str, str]:
    """场景名 + 语言 → 三款字体 id。未知场景落兜底场景。"""
    preset = _SCENE_PRESETS.get(scene or "") or _SCENE_PRESETS[_DEFAULT_SCENE]
    lang = "zh" if language == "zh" else "en"
    return dict(preset[lang])


def _legal_user_fonts(user_font_choice: Any) -> dict[str, str]:
    """用户在设计卡里选的字体里【合法的那些】。非法值(不在字体白名单)直接丢弃。"""
    if not isinstance(user_font_choice, Mapping):
        return {}
    out: dict[str, str] = {}
    for role in _FONT_ROLES:
        value = user_font_choice.get(role)
        if isinstance(value, str) and value in _LEGAL_FONTS:
            out[role] = value
    return out


def _slot_texts(parsed: Any, key: str, slots: list[dict[str, Any]]) -> dict[str, str]:
    """只收模板声明过的槽位,字符串值;缺槽给空串(Web 侧再兜标题=相册标题)。

    注意这跟章节路径的约定相反:章节写不出来就不出现在 `pagesTexts` 里,封面/封尾却
    把模型漏写的槽带着 `""` 回去。契约上已写明(见 `ComposeCompleted` docstring),
    Web 侧写回时必须忽略空串。"""
    legal = {slot["id"] for slot in slots}
    raw = parsed.get(key) if isinstance(parsed, dict) else None
    out = {slot_id: "" for slot_id in legal}
    if isinstance(raw, dict):
        for slot_id, text in raw.items():
            if slot_id in legal and isinstance(text, str):
                out[slot_id] = text.strip()
    return out


async def compose_global(
    *,
    language: str,
    album_title: str,
    chapter_titles: list[str],
    chapter_contexts: list[str],
    cover_slots: list[dict[str, Any]],
    ending_slots: list[dict[str, Any]],
    user_font_choice: Any = None,
) -> ComposeGlobalResult:
    """全书级成稿:封面/封尾文案 + 三款字体。失败落确定性默认值,绝不阻断交付。

    `user_font_choice` 三个角色都给全且合法时,直接采用用户的选择,连场景菜单都不发给
    模型(用户已经在设计卡里定了字体,没有让 AI 再选一遍的道理)。"""
    chosen_fonts = _legal_user_fonts(user_font_choice)
    fonts_fully_chosen = len(chosen_fonts) == len(_FONT_ROLES)

    def _fonts(scene: str | None) -> dict[str, str]:
        base = (
            dict(_DEFAULT_FONTS.get(language, _DEFAULT_FONTS["en"]))
            if fonts_fully_chosen
            else _resolve_scene(scene, language)
        )
        base.update(chosen_fonts)
        return base

    def _with_album_title(cover_texts: dict[str, str]) -> dict[str, str]:
        # 封面标题兜底:模型没写/失败时,标题槽用相册标题(role=title 的槽)。
        if album_title:
            for slot in cover_slots:
                if slot.get("role") == "title" and not cover_texts.get(slot["id"]):
                    cover_texts[slot["id"]] = album_title
        return cover_texts

    def _fallback() -> ComposeGlobalResult:
        return ComposeGlobalResult(
            cover_texts=_with_album_title({slot["id"]: "" for slot in cover_slots}),
            ending_texts={slot["id"]: "" for slot in ending_slots},
            fonts=_fonts(None),
        )

    settings = get_settings()
    # try 从载荷构建就罩住(load_prompt 读文件、payload 拼装都可能抛):
    # 全局批次抛出去 = 整本书发 failed,而封面/字体本来就有确定性兜底。
    try:
        payload: dict[str, Any] = {
            "language": language,
            "albumTitle": album_title,
            # 章标题与章背景按章序对位;两边长度不齐时缺的补空串(不因为对不齐就整段不发)。
            "chapters": [
                {"title": title or "", "chapterContext": context or ""}
                for title, context in zip_longest(chapter_titles, chapter_contexts, fillvalue="")
            ],
            "coverSlots": cover_slots,
            "endingSlots": ending_slots,
        }
        if not fonts_fully_chosen:
            # 场景菜单:AI 按各章题材匹配一个场景,输出场景名(见 compose_global.md)。
            # 字体由代码按 场景×语言 查表填,不发字体给 AI。
            payload["scenes"] = _scene_menu()

        if not settings.select_layout_api_key:
            log.warning("compose.global_slot_unavailable", error="select_layout_api_key missing")
            return _fallback()

        messages = [
            {"role": "system", "content": load_prompt(_PROMPT_DIR / "compose_global.md")},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ]
        calls = 1
        try:
            raw_text, in_tok, out_tok = await _gemini(messages, temperature=0.7)
            parsed = ai_client.parse_json_loose(raw_text)
        except Exception as exc:  # noqa: BLE001 — 与章节批次同款:瞬时失败重试一次
            log.warning("compose.global_retry", error=str(exc))
            calls = 2
            raw_text, in_tok, out_tok = await _gemini(messages, temperature=0.7)
            parsed = ai_client.parse_json_loose(raw_text)
    except Exception as exc:  # noqa: BLE001 — 设计/封面绝不阻断交付
        log.warning("compose.global_fallback", error=str(exc))
        return _fallback()

    scene = parsed.get("scene") if isinstance(parsed, dict) else None
    return ComposeGlobalResult(
        cover_texts=_with_album_title(_slot_texts(parsed, "coverTexts", cover_slots)),
        ending_texts=_slot_texts(parsed, "endingTexts", ending_slots),
        fonts=_fonts(scene if isinstance(scene, str) else None),
        call_count=calls,
        input_tokens=in_tok,
        output_tokens=out_tok,
        model=settings.select_layout_model,
    )
