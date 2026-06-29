"""Gemini-assisted Stage2 layout selection.

The module owns candidate construction from templates + preview assets and the
deterministic legalizer that preserves legal Gemini slot mappings. Callers use
`gemini_layout()` for model intent and `legalize_layout()` before returning pages.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .. import ai_client
from ..logging_config import get_logger
from ..settings import get_settings
from . import simple_id, skeleton_v3, template_previews, templates

log = get_logger("gemini_layout")


class GeminiLayoutUnavailable(Exception):
    """Raised when the Gemini layout provider is not configured or failed."""


@dataclass(frozen=True)
class GeminiLayoutResult:
    pages: list[dict[str, Any]]
    call_count: int = 0
    model: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0


def _get(obj: Mapping[str, Any] | Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _chapter_id(chapter: Mapping[str, Any] | Any) -> str:
    value = _get(chapter, "chapterId")
    if not isinstance(value, str) or not value:
        raise ValueError("chapter must carry chapterId")
    return value


def _photos(chapter: Mapping[str, Any] | Any) -> list[Any]:
    return list(_get(chapter, "photos", []) or [])


def _photo_id(photo: Mapping[str, Any] | Any) -> str:
    value = _get(photo, "photoId")
    if not isinstance(value, str) or not value:
        raise ValueError("photo must carry photoId")
    return value


def _photo_ref(photo: Mapping[str, Any] | Any) -> str | None:
    value = _get(photo, "ref200px")
    return value if isinstance(value, str) and value else None


def build_candidate_catalog(category: str, max_photo_count: int) -> list[dict[str, Any]]:
    """Build exact-capacity candidate buckets up to a chapter's photo count.

    This enforces the Stage2 rule that candidates are internal and their capacity
    does not exceed the chapter's photo count.
    """
    previews = template_previews.load_template_previews()
    max_capacity = min(max_photo_count, skeleton_v3.max_capacity(category))
    out: list[dict[str, Any]] = []
    for capacity in range(1, max_capacity + 1):
        for template_id in skeleton_v3.candidate_ids(category, capacity):
            preview = previews.by_template.get(template_id)
            if preview is None:
                continue
            out.append(
                {
                    "templateId": template_id,
                    "category": category,
                    "imageSlotCount": capacity,
                    "structureDescription": preview.structureDescription,
                    "previewImage": preview.previewImage,
                }
            )
    return out


def _template_legal_for_page(template_id: Any, page_size: int, chapter_size: int) -> bool:
    if not isinstance(template_id, str):
        return False
    template = templates.TEMPLATES.get(template_id)
    if template is None or template["category"] != "interior":
        return False
    capacity = skeleton_v3.image_capacity(template)
    return page_size <= capacity <= chapter_size


def _slots_legal(template_id: str, page_photo_ids: Sequence[str], slots: Any) -> bool:
    if not isinstance(slots, Mapping):
        return False
    template = templates.TEMPLATES.get(template_id)
    if template is None:
        return False
    valid_slot_ids = set(skeleton_v3.image_slot_keys(template))
    pairs = [(str(slot_id), photo_id) for slot_id, photo_id in slots.items()]
    if any(slot_id not in valid_slot_ids for slot_id, _ in pairs):
        return False
    values = [photo_id for _, photo_id in pairs if isinstance(photo_id, str)]
    if len(values) != len(pairs) or len(values) != len(page_photo_ids):
        return False
    if len(set(values)) != len(values):
        return False
    return set(values) == set(page_photo_ids)


def _fallback_chapter_pages(chapter: Any) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    for chunk in skeleton_v3.partition_photos_v3(_photos(chapter), category="interior"):
        pages.append(skeleton_v3.build_page_v3("interior", chunk, page_index=0))
    return pages


def _raw_pages_for_chapter(raw_pages: Sequence[Mapping[str, Any]], chapter_id: str) -> list[Mapping[str, Any]]:
    return [
        page
        for page in raw_pages
        if isinstance(page, Mapping) and page.get("chapterId") == chapter_id
    ]


def legalize_layout(
    chapters: Sequence[Mapping[str, Any] | Any],
    raw_pages: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Clamp Gemini layout intent to legal interior pages.

    A legal slot mapping is preserved exactly. Illegal/missing slots, illegal
    templates, or invalid chapter grouping fall back only at the affected page or
    chapter.
    """
    out: list[dict[str, Any]] = []
    for chapter in chapters:
        chapter_id = _chapter_id(chapter)
        chapter_photos = _photos(chapter)
        chapter_photo_ids = [_photo_id(photo) for photo in chapter_photos]
        if not chapter_photo_ids:
            continue

        raw_for_chapter = _raw_pages_for_chapter(raw_pages, chapter_id)
        grouping: list[list[str]] = []
        for raw in raw_for_chapter:
            slot_values = {
                value
                for value in (raw.get("slots") or {}).values()
                if isinstance(value, str)
            }
            grouping.append([pid for pid in chapter_photo_ids if pid in slot_values])

        if not raw_for_chapter or not skeleton_v3.validate_grouping(
            grouping, chapter_photo_ids, category="interior"
        ):
            out.extend(_fallback_chapter_pages(chapter))
            continue

        for raw, page_photo_ids in zip(raw_for_chapter, grouping, strict=True):
            template_id = raw.get("templateId")
            if _template_legal_for_page(template_id, len(page_photo_ids), len(chapter_photo_ids)):
                template_id = str(template_id)
                if _slots_legal(template_id, page_photo_ids, raw.get("slots")):
                    page = {
                        "pageIndex": 0,
                        "templateId": template_id,
                        "images": dict(raw["slots"]),
                        "texts": {},
                    }
                else:
                    page = skeleton_v3.build_page_v3(
                        "interior", page_photo_ids, template_id=template_id, page_index=0
                    )
            else:
                page = skeleton_v3.build_page_v3("interior", page_photo_ids, page_index=0)
            out.append(page)

    for idx, page in enumerate(out):
        page["pageIndex"] = idx
    return out


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
        {
            "type": "text",
            "text": (
                "Select legal interior templates and map photos to image slots. "
                "Return STRICT JSON only matching the requested output shape. "
                "Use only candidate templateId values and simple photo IDs.\n"
                f"{json.dumps(text_payload, ensure_ascii=False)}"
            ),
        }
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
        {
            "role": "system",
            "content": "You are a magazine layout selector. Output JSON only.",
        },
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
    _, id_map = simple_id.to_simple(photo_ids)
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
    real_pages = simple_id.from_simple_at_paths(
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
