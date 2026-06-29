"""Stage2 排版的确定性部分:候选目录构造 + Gemini 选版结果的合法化夹紧。

这层只做确定性逻辑(包在 `skeleton_v3` 外的一层薄壳),零 LLM/agent import。
LLM 调用在 `agents/select_layout/`。两端共用的章节/照片字段读取辅助也放这里。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from . import skeleton_v3, template_previews, templates


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
    """整章兜底:复用 candidate_gen 的『填满式』确定性切分,保证每页恰好填满模板槽位,
    绝不选更大容量的模板留空槽(『填不满不硬塞』)。"""
    from . import candidate_gen_v3

    photos = _photos(chapter)
    if not photos:
        return []
    chapter_id = str(_chapter_id(chapter))
    candidates = candidate_gen_v3.generate_candidates(photos, seed=chapter_id, count=1)
    pages = candidates[0] if candidates else []
    return [
        {"pageIndex": i, "templateId": p["templateId"], "images": p["images"], "texts": {}}
        for i, p in enumerate(pages)
    ]


def _page_slots(page: Mapping[str, Any]) -> Mapping[str, Any]:
    """页的 slot→photoId 映射。兼容两种来源:Gemini 输出用 `slots`,
    代码候选生成器(candidate_gen_v3)产出的最终页用 `images`。"""
    slots = page.get("slots")
    if isinstance(slots, Mapping) and slots:
        return slots
    images = page.get("images")
    return images if isinstance(images, Mapping) else {}


def _raw_pages_for_chapter(
    raw_pages: Sequence[Mapping[str, Any]], chapter_id: str
) -> list[Mapping[str, Any]]:
    # Gemini 输出按 chapterId 归页;代码候选页不带 chapterId(单章上下文),
    # 缺失时一律归属当前章。
    return [
        page
        for page in raw_pages
        if isinstance(page, Mapping)
        and page.get("chapterId", chapter_id) == chapter_id
    ]


def finalize_candidate_pages(
    chapter: Mapping[str, Any] | Any,
    pages: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """最终化一个『代码随机候选』:候选由 candidate_gen 按容量拆分+按容量选模板生成,
    天然填满、不重不漏,所以这里只重排 pageIndex,不做夹紧/重排/校验。
    `chapter` 参数保留以对齐调用签名(当前未使用)。"""
    del chapter  # 候选自洽,无需按章校验。
    return [
        {
            "pageIndex": idx,
            "templateId": page["templateId"],
            "images": dict(_page_slots(page)),
            "texts": page.get("texts") if isinstance(page.get("texts"), dict) else {},
        }
        for idx, page in enumerate(pages)
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
                for value in _page_slots(raw).values()
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
                page_slots = _page_slots(raw)
                if _slots_legal(template_id, page_photo_ids, page_slots):
                    page = {
                        "pageIndex": 0,
                        "templateId": template_id,
                        "images": dict(page_slots),
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
