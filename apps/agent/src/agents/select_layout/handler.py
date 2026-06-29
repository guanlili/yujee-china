"""Gemini-assisted Stage2 layout selection (LLM 调用层)。

把【已分组章节的照片信息 + 合法模板候选目录 + 照片/模板预览图】发给 Gemini,
让模型每页选一个模板并把照片映射到图槽,返回原始 pages。确定性的候选目录构造与
合法化夹紧在 `engine/legalize.py`;prompt 在 `select_layout.md`。
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from ... import ai_client
from ...engine import skeleton_v3, template_previews
from ...engine.legalize import (
    _chapter_id,
    _photo_id,
    _photo_ref,
    _photos,
    build_candidate_catalog,
)
from ...engine.simple_id import from_simple_at_paths, to_simple
from ...logging_config import get_logger
from ...settings import get_settings
from ...skills import load_prompt
from .schema import GeminiLayoutResult, GeminiLayoutUnavailable

log = get_logger("select_layout")

_PROMPT_DIR = Path(__file__).resolve().parent


def _get(obj: Mapping[str, Any] | Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _unit_payload(chapter: Any, id_map: dict[str, str]) -> dict[str, Any]:
    photos: list[dict[str, Any]] = []
    for photo in _photos(chapter):
        pid = _photo_id(photo)
        simple = next(k for k, v in id_map.items() if v == pid)
        photos.append(
            {
                "photoId": simple,
                "orientation": _get(photo, "orientation"),
                "takenAt": _get(photo, "takenAt"),
            }
        )
    return {
        "chapterId": _chapter_id(chapter),
        "structureHint": _get(chapter, "structureHint", None),
        "photos": photos,
        "candidates": [
            {key: value for key, value in candidate.items() if key != "previewImage"}
            for candidate in build_candidate_catalog("interior", len(photos))
        ],
    }


def _messages(chapters: Sequence[Any], id_map: dict[str, str]) -> list[dict[str, Any]]:
    text_payload = {
        "mode": "select",
        "allowAddPages": True,
        "units": [_unit_payload(chapter, id_map) for chapter in chapters],
        "output": {
            "pages": [
                {
                    "chapterId": "chapter id",
                    "templateId": "one candidate templateId",
                    "slots": {"slotId": "simple photoId"},
                }
            ]
        },
    }
    content: list[dict[str, Any]] = [
        {"type": "text", "text": json.dumps(text_payload, ensure_ascii=False)}
    ]
    previews = template_previews.load_template_previews()
    for chapter in chapters:
        for photo in _photos(chapter):
            ref = _photo_ref(photo)
            if ref:
                content.append({"type": "image_url", "image_url": {"url": ref}})
        cap = min(len(_photos(chapter)), skeleton_v3.max_capacity("interior"))
        for capacity in range(1, cap + 1):
            image = previews.bucket_images.get(("interior", capacity))
            if image:
                content.append({"type": "image_url", "image_url": {"url": image}})

    return [
        {"role": "system", "content": load_prompt(_PROMPT_DIR / "select_layout.md")},
        {"role": "user", "content": content},
    ]


async def gemini_layout(
    chapters: Sequence[Mapping[str, Any] | Any],
    *,
    mode: str = "select",
    allowAddPages: bool = True,
) -> GeminiLayoutResult:
    if mode not in {"select", "case4-swap"} or not allowAddPages:
        raise ValueError("gemini_layout expects mode='select' or 'case4-swap' and allowAddPages=True")

    settings = get_settings()
    api_key = getattr(settings, "select_layout_api_key", None)
    if not api_key:
        raise GeminiLayoutUnavailable("SELECT_LAYOUT_API_KEY missing")

    photo_ids = [_photo_id(photo) for chapter in chapters for photo in _photos(chapter)]
    _, id_map = to_simple(photo_ids)
    response = await ai_client.chat_completion(
        base_url=getattr(settings, "select_layout_base_url"),
        api_key=api_key,
        model=getattr(settings, "select_layout_model"),
        messages=_messages(chapters, id_map),
        timeout_seconds=getattr(settings, "select_layout_timeout_seconds"),
        response_format=(
            {"type": "json_object"} if getattr(settings, "select_layout_use_json_object") else None
        ),
        max_tokens=getattr(settings, "select_layout_max_output_tokens"),
        temperature=0.1,
        extra_body=(
            {"reasoning_effort": "none"}
            if getattr(settings, "select_layout_disable_thinking")
            else None
        ),
    )
    parsed = ai_client.parse_json_loose(ai_client.extract_text(response))
    pages = parsed.get("pages") if isinstance(parsed, Mapping) else None
    if not isinstance(pages, list):
        raise ValueError("Gemini layout response missing pages[]")
    real_pages = from_simple_at_paths(
        pages,
        id_map,
        value_paths=(("*", "slots", "*"),),
    )
    input_tokens, output_tokens = ai_client.extract_usage(response)
    return GeminiLayoutResult(
        pages=[page for page in real_pages if isinstance(page, dict)],
        call_count=1,
        model=getattr(settings, "select_layout_model"),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )
