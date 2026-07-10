"""排版选定之后,写文案 agent(§ AI copy writer):对已选定版式的页面,把每个
非 decoration 文字槽写成贴合章节背景 + 照片内容的真实文案。

只在这一步调用 LLM(火山 doubao,`ai_client.chat_completion` + `ark_vision_slot`);
`decoration` 槽(folio/date 等)绝不在这里写 —— 那些由 `generic_copy` 之类的 code
路径确定性填充。写文案是叠加性的一步:任何环节失败(缺 ARK key / HTTP 出错 /
模型 JSON 解析不出)都吞掉异常、返回空结果,绝不让排版流程因为文案写不出来而崩。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .....logging_config import get_logger
from .....providers import ai_client
from .....providers.vision_provider import VisionSlotError, ark_vision_slot
from .....settings import get_settings
from .....skills import load_prompt
from .. import templates
from ..legalize import _photo_id, _photo_ref, _photos
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
    """本页非 decoration 的文字槽规格(id/role/sample?)。
    模板未知或该页没有非 decoration 槽 → 空列表(调用方据此跳过整页)。"""
    template_id = page.get("templateId")
    template = templates.get(template_id) if isinstance(template_id, str) else None
    if template is None:
        return []
    examples = templates.copy_example(template_id)
    specs: list[dict[str, Any]] = []
    for slot in templates.text_slots(template):
        if slot.get("role") == "decoration":
            continue
        spec: dict[str, Any] = {"id": slot["id"], "role": slot["role"]}
        sample = examples.get(slot["id"])
        if sample:
            spec["sample"] = sample
        specs.append(spec)
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
    photos_by_id = {_photo_id(p): p for p in _photos(unit)}
    chapter_context = _get(unit, "chapterContext", "") or ""

    payload_pages: list[dict[str, Any]] = []
    image_urls: list[str] = []
    seen_photo_ids: set[str] = set()
    for spec in page_specs:
        photos_payload: list[dict[str, Any]] = []
        for pid in spec["photoIds"]:
            photo = photos_by_id.get(pid)
            scene = _get(photo, "sceneDescription", "") if photo is not None else ""
            photos_payload.append({"photoId": pid, "sceneDescription": scene or ""})
            if photo is not None and pid not in seen_photo_ids:
                ref = _photo_ref(photo)
                if ref:
                    image_urls.append(ref)
                seen_photo_ids.add(pid)
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

    content: list[dict[str, Any]] = [
        {"type": "text", "text": json.dumps(payload, ensure_ascii=False)}
    ]
    for url in image_urls:
        content.append({"type": "image_url", "image_url": {"url": url}})

    return [
        {"role": "system", "content": load_prompt(_PROMPT_DIR / "write_copy.md")},
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
    try:
        slot = ark_vision_slot(settings)
    except VisionSlotError as exc:
        log.warning("write_copy.slot_unavailable", error=str(exc))
        return _EMPTY_RESULT

    try:
        messages = _build_payload_and_messages(unit, page_specs, language=language)
        response = await ai_client.chat_completion(
            base_url=slot.base_url,
            api_key=slot.api_key,
            model=slot.model,
            messages=messages,
            timeout_seconds=slot.timeout_seconds,
            temperature=0.6,
            max_tokens=_MAX_OUTPUT_TOKENS,
            response_format=slot.response_format,
            extra_body=slot.extra_body,
        )
        input_tokens, output_tokens = ai_client.extract_usage(response)
        raw_text = ai_client.extract_text(response)
        pages_texts = _parse_result(raw_text, page_specs)
    except Exception as exc:  # noqa: BLE001 — 写文案绝不能抛出去搞崩排版
        log.warning("write_copy.failed", provider=slot.provider, error=str(exc))
        return _EMPTY_RESULT

    return WriteCopyResult(
        pages_texts=pages_texts,
        call_count=1,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        model=slot.model,
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
