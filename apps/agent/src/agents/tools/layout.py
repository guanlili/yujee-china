"""版式工具:根据当前章节/页上下文请求版式模型,再做确定性合法化。"""

from __future__ import annotations

from typing import Any, Protocol

from ...engine import gemini_layout
from ...schemas import V3EditChatRequest, V3LayoutPatchEntry


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
        return []

    chapters = [{"chapterId": chapter_id, "structureHint": req.userMessage, "photos": photos}]
    result = await gemini_layout.gemini_layout(chapters, mode="case4-swap", allowAddPages=True)
    legal_pages = gemini_layout.legalize_layout(chapters, result.pages)
    return patches_from_pages(legal_pages, page_indexes=page_indexes)


__all__ = ["LayoutDataTools", "gemini_layout", "patches_from_pages", "swap_layout"]
