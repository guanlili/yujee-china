"""版式工具:根据当前章节/页上下文请求版式模型,再做确定性合法化。"""

from __future__ import annotations

from typing import Any, Protocol

from .. import select_layout as select_layout_agent
from ...engine import candidate_gen_v3, legalize
from ...logging_config import get_logger
from ...schemas import V3EditChatRequest, V3LayoutPatchEntry
from ...settings import get_settings

log = get_logger("tools.layout")


class LayoutDataTools(Protocol):
    async def get_page_info(
        self,
        *,
        albumId: str,
        chapterId: str,
        scope: str,
        pageIndex: int | None = None,
    ) -> dict[str, Any]: ...

    async def get_page_photos(self, *, albumId: str, chapterId: str) -> list[dict[str, Any]]: ...


def _page_index(page: dict[str, Any] | Any) -> int | None:
    value = page.get("pageIndex") if isinstance(page, dict) else getattr(page, "pageIndex", None)
    return value if isinstance(value, int) and value >= 0 else None


def _value(obj: dict[str, Any] | Any, key: str, default: Any = None) -> Any:
    return obj.get(key, default) if isinstance(obj, dict) else getattr(obj, key, default)


def _page_image_ids(page: dict[str, Any] | Any) -> list[str]:
    images = _value(page, "images", None)
    if not isinstance(images, dict):
        return []
    return [pid for pid in images.values() if isinstance(pid, str) and pid]


def _chapter_photo_map(chapter: dict[str, Any] | Any) -> dict[str, Any]:
    photos = _value(chapter, "photos", None)
    out: dict[str, Any] = {}
    for photo in list(photos or []):
        photo_id = _value(photo, "photoId", None)
        if isinstance(photo_id, str) and photo_id:
            out[photo_id] = photo
    return out


def _fallback_photos_from_page_info(
    page_info: dict[str, Any], *, focused_page_index: int | None
) -> list[Any]:
    """浏览器缩略图缺失时,回退到 page-info 里的 photoId/orientation。"""
    chapter = page_info.get("chapter") or {}
    by_id = _chapter_photo_map(chapter)
    pages = list(page_info.get("pages", []) or [])

    wanted_ids: list[str] = []
    if focused_page_index is not None:
        for page in pages:
            if _page_index(page) == focused_page_index:
                wanted_ids = _page_image_ids(page)
                break
    else:
        for page in pages:
            wanted_ids.extend(_page_image_ids(page))
        if not wanted_ids:
            wanted_ids = list(by_id)

    seen: set[str] = set()
    photos: list[Any] = []
    for photo_id in wanted_ids:
        if photo_id in seen:
            continue
        seen.add(photo_id)
        photos.append(by_id.get(photo_id) or {"photoId": photo_id})
    return photos


def patches_from_pages(
    pages: list[dict[str, Any]], *, page_indexes: list[int]
) -> list[V3LayoutPatchEntry]:
    patches: list[V3LayoutPatchEntry] = []
    for offset, page in enumerate(pages):
        if offset >= len(page_indexes):
            break
        template_id = page.get("templateId")
        if not isinstance(template_id, str) or not template_id:
            continue
        images = page.get("images")
        patches.append(
            V3LayoutPatchEntry(
                pageIndex=page_indexes[offset],
                templateId=template_id,
                images=images if isinstance(images, dict) else None,
                texts=page.get("texts") if isinstance(page.get("texts"), dict) else {},
            )
        )
    return patches


async def swap_layout(
    req: V3EditChatRequest, tools: LayoutDataTools
) -> list[V3LayoutPatchEntry]:
    chapter_id = req.focus.chapterId
    if not chapter_id:
        return []

    page_info = await tools.get_page_info(
        albumId=req.albumId,
        chapterId=chapter_id,
        scope="page" if req.focus.pageIndex is not None else "chapter",
        pageIndex=req.focus.pageIndex,
    )
    page_indexes = [
        idx
        for idx in (_page_index(page) for page in list(page_info.get("pages", []) or []))
        if idx is not None
    ]
    if req.focus.pageIndex is not None:
        page_indexes = [req.focus.pageIndex]
    if not page_indexes:
        return []

    photos = await tools.get_page_photos(albumId=req.albumId, chapterId=chapter_id)
    if not photos:
        photos = _fallback_photos_from_page_info(
            page_info, focused_page_index=req.focus.pageIndex
        )
    if not photos:
        return []

    # 换图重排迁到新流程:代码随机生成 N 个候选 → LLM 评委选最佳。种子带 userMessage,
    # 让"换一个版式"每次重排出不同结果(新流程靠随机+软偏好天然换模板,不再靠 prompt 提示)。
    chapter = {"chapterId": chapter_id, "structureHint": req.userMessage, "photos": photos}
    candidates = candidate_gen_v3.generate_candidates(
        photos,
        seed=f"{req.albumId}#{chapter_id}#{req.userMessage}",
        count=int(get_settings().select_layout_candidate_count),
    )
    if not candidates:
        return []
    if len(candidates) == 1:
        winner = candidates[0]
    else:
        try:
            verdict = await select_layout_agent.judge_layout(chapter, candidates)
            winner = candidates[verdict.winner_index]
        except Exception as exc:  # noqa: BLE001
            log.warning("tools_layout.judge_fallback", chapter_id=chapter_id, error=str(exc))
            winner = candidates[0]

    # 候选已合法(填满、不重不漏),轻量最终化即可,不走旧 Gemini 夹紧/重排。
    legal_pages = legalize.finalize_candidate_pages(chapter, winner)
    return patches_from_pages(legal_pages, page_indexes=page_indexes)


__all__ = [
    "LayoutDataTools",
    "legalize",
    "patches_from_pages",
    "select_layout_agent",
    "swap_layout",
]
