"""排版选定之后,写文案 agent(§ AI copy writer):对已选定版式的页面,把【每个】
文字槽写成贴合章节背景 + 照片内容的真实文案。

decoration 槽也写:「Series · No.01」「Chapter · 05」这类装饰文案装饰属性强,
但仍然是需要写的文案。真正不该 AI 写的是页码 —— 而页码已经不是模板槽位了
(展示层按当前页序统一生成,全书固定右下角一处)。

走 deepseek slot(纯文本;豆包 vision 指令遵从太差,2026-07-11 用户拍板换掉)。
照片内容通过 `sceneDescription` 文字进入上下文,不再附图。写文案是叠加性的一步:
任何环节失败(缺 DEEPSEEK key / HTTP 出错 / 模型 JSON 解析不出)都吞掉异常、返回
空结果,绝不让排版流程因为文案写不出来而崩。
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .....logging_config import get_logger
from .....providers import ai_client
from .....settings import get_settings
from ....prompts import load_prompt
from .. import templates
from ..legalize import _photo_id, _photos
from ..simple_id import to_simple
from .schema import WriteCopyResult

log = get_logger("write_copy")

_PROMPT_DIR = Path(__file__).resolve().parent

# 单次写文案调用的输出 token 预算:逐页多槽正文,给够余量避免被截断。
_MAX_OUTPUT_TOKENS = 3000

_EMPTY_RESULT = WriteCopyResult(pages_texts={})


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _writable_text_slots(page: dict[str, Any]) -> list[dict[str, Any]]:
    """本页【全部】文字槽的规格(id/role/sample?)。
    模板未知或该页没有文字槽 → 空列表(调用方据此跳过整页)。

    decoration 槽也要写:它们是「Series · No.01」「Chapter · 05」这类装饰文案 ——
    装饰属性强,但仍然是需要写的文案。真正不该 AI 写的是页码,而页码已经不再是
    模板槽位了(展示层按当前页序统一生成,全书固定在右下角一个位置)。

    不发字数上限:模板不再声明任何字数限制,篇幅由 sample 示范,渲染层的
    fit-text(固定高度文字框自动缩字号)负责装下。

    sample 直接取槽位自己的 `sample` 字段(模板 JSON 的单一真相):同一个串既是 Web
    画板的预览占位,也是写作 LM 的输出示例 —— 让模型照例子写、而非靠规则约束。
    曾经并存的 copy-examples/ 目录已删除(两套示例=信息误差)。"""
    template_id = page.get("templateId")
    template = templates.get(template_id) if isinstance(template_id, str) else None
    if template is None:
        return []

    def _spec(slot: Mapping[str, Any], slot_id: str) -> dict[str, Any]:
        # lang 是槽的硬约束(契约里必填):'user' = 用用户语言写,'en' = 保持英文
        # (日期/编号/标签这类装饰默认 en)。不发的话,标 en 的槽会被 AI 用中文写。
        spec: dict[str, Any] = {
            "id": slot_id,
            "role": slot["role"],
            "lang": slot.get("lang", "user"),
        }
        sample = slot.get("sample")
        if sample:
            spec["sample"] = sample
        return spec

    specs = [_spec(slot, slot["id"]) for slot in templates.text_slots(template)]

    # items 重复组的文字槽:按本页实际格数展开成 `base[i]`。
    # 格数从页面 images 的 `image[i]` 键推(items 的图片展开就是这么生成的);
    # 每格的 explain[i] 对应第 i 张照片。曾经完全没喂 —— mag-10(顶层零文字、
    # 全部文字在 items)整页一个字都不写,页面上四个 explain 全是空串。
    items = template.get("items") or {}
    item_texts = items.get("texts") or []
    if item_texts:
        image_bases = {s["id"] for s in (items.get("images") or [])}
        instance_count = 0
        for key in (page.get("images") or {}):
            base, _, rest = str(key).partition("[")
            if base in image_bases and rest.endswith("]"):
                instance_count = max(instance_count, int(rest[:-1]) + 1)
        for slot in item_texts:
            for i in range(instance_count):
                specs.append(_spec(slot, f"{slot['id']}[{i}]"))

    return specs


def _page_photo_ids(page: dict[str, Any]) -> list[str]:
    images = page.get("images") or {}
    return [pid for pid in images.values() if isinstance(pid, str) and pid]


def _build_payload_and_messages(
    unit: Any,
    page_specs: list[dict[str, Any]],
    *,
    language: str,
) -> list[dict[str, Any]]:
    """deepseek 是纯文本模型:照片内容只以 sceneDescription 文字进上下文,不附图。
    photoId 入模前转短 id(约定:模型上下文里绝不出现真实 UUID —— 又长又易抄错;
    本调用的输出不引用 photoId,无需反向映射)。"""
    photos_by_id = {_photo_id(p): p for p in _photos(unit)}
    chapter_context = _get(unit, "chapterContext", "") or ""

    ordered_ids: list[str] = []
    seen_ids: set[str] = set()
    for spec in page_specs:
        for pid in spec["photoIds"]:
            if pid not in seen_ids:
                seen_ids.add(pid)
                ordered_ids.append(pid)
    simple_ids, _real_by_simple = to_simple(ordered_ids)
    simple_by_real = dict(zip(ordered_ids, simple_ids, strict=True))

    payload_pages: list[dict[str, Any]] = []
    for spec in page_specs:
        photos_payload: list[dict[str, Any]] = []
        for pid in spec["photoIds"]:
            photo = photos_by_id.get(pid)
            scene = _get(photo, "sceneDescription", "") if photo is not None else ""
            photos_payload.append({"photoId": simple_by_real[pid], "sceneDescription": scene or ""})
        payload_pages.append(
            {
                "pageIndex": spec["pageIndex"],
                "textSlots": spec["textSlots"],
                "photos": photos_payload,
            }
        )

    payload = {
        "chapterContext": chapter_context,
        "language": language,
        "pages": payload_pages,
    }

    return [
        {"role": "system", "content": load_prompt(_PROMPT_DIR / "write_copy.md")},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
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


async def write_copy(
    unit: Any,
    pages: list[dict[str, Any]],
    *,
    language: str = "zh",
) -> WriteCopyResult:
    """给一个排版单元(章节/超大章的一段)已选定版式的 `pages` 写文案。

    只处理有非 decoration 文字槽的页;没有任何这样的页时不调用 LLM,直接
    返回空结果。任何失败(缺 ARK key / HTTP / JSON 解析)都返回空结果 ——
    调用方按「叠加合并」的方式使用,失败时页面 `texts` 保持不变。"""
    page_specs: list[dict[str, Any]] = []
    for page in pages:
        slots = _writable_text_slots(page)
        if not slots:
            continue
        page_index = page.get("pageIndex")
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
        return _EMPTY_RESULT

    settings = get_settings()
    if not settings.deepseek_api_key:
        log.warning("write_copy.slot_unavailable", error="deepseek_api_key missing")
        return _EMPTY_RESULT

    try:
        messages = _build_payload_and_messages(unit, page_specs, language=language)
        response = await ai_client.chat_completion(
            base_url=settings.deepseek_base_url,
            api_key=settings.deepseek_api_key,
            model=settings.deepseek_model,
            messages=messages,
            timeout_seconds=settings.deepseek_timeout_seconds,
            temperature=0.6,
            max_tokens=_MAX_OUTPUT_TOKENS,
        )
        input_tokens, output_tokens = ai_client.extract_usage(response)
        raw_text = ai_client.extract_text(response)
        pages_texts = _parse_result(raw_text, page_specs)
    except Exception as exc:  # noqa: BLE001 — 写文案绝不能抛出去搞崩排版
        log.warning("write_copy.failed", provider="deepseek", error=str(exc))
        return _EMPTY_RESULT

    return WriteCopyResult(
        pages_texts=pages_texts,
        call_count=1,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        model=settings.deepseek_model,
    )


async def apply_write_copy(
    unit: Any,
    pages: list[dict[str, Any]],
    *,
    language: str = "zh",
) -> list[dict[str, Any]]:
    """写文案并按「叠加合并」应用到 `pages`:只覆盖返回了文案的槽位,其余原样保留。

    `write_copy` 自身对任何失败都返回空结果;这里再兜一层 `except Exception`,
    确保写文案无论如何都不会打断排版主流程(内联评委与 P2 判图两条路共用)。"""
    try:
        result = await write_copy(unit, pages, language=language)
    except Exception as exc:  # noqa: BLE001 — 写文案绝不能打断排版
        log.warning("write_copy.apply_failed", error=str(exc))
        return pages
    if not result.pages_texts:
        return pages

    merged: list[dict[str, Any]] = []
    for page in pages:
        texts = result.pages_texts.get(page.get("pageIndex"))
        if texts:
            new_page = dict(page)
            new_page["texts"] = {**(page.get("texts") or {}), **texts}
            merged.append(new_page)
        else:
            merged.append(page)
    return merged
