"""编辑环节翻页推进(从 story/context 迁入)。

`advance_book` 工具据 book tree 决定翻到下一未访问页 / 推进章节。纯确定性,不调模型。
"""

from __future__ import annotations

from typing import Any

from ...schemas import V3EditChatRequest, V3EditNavigation, V3EditProgressDecision
from . import progress as story_progress


def _book_tree_chapter(book_tree: dict[str, Any], chapter_id: str | None) -> dict[str, Any] | None:
    for chapter in list(book_tree.get("chapters", []) or []):
        if isinstance(chapter, dict) and chapter.get("chapterId") == chapter_id:
            return chapter
    return None


def _book_tree_focused_page(book_tree: dict[str, Any], req: V3EditChatRequest) -> int | None:
    value = book_tree.get("focusedPageIndex")
    if isinstance(value, int) and value >= 0:
        return value
    return req.focus.pageIndex


def advance_from_book_tree(
    req: V3EditChatRequest, book_tree: dict[str, Any]
) -> tuple[V3EditNavigation | None, V3EditProgressDecision | None, str]:
    progress = book_tree.get("progress") if isinstance(book_tree.get("progress"), dict) else {}
    chapter_id = req.focus.chapterId or progress.get("currentChapterId")
    chapter = _book_tree_chapter(book_tree, chapter_id if isinstance(chapter_id, str) else None)
    page_indexes = [
        value for value in list((chapter or {}).get("pageIndexes", []) or []) if isinstance(value, int)
    ]
    page_indexes = sorted(set(page_indexes))
    focused = _book_tree_focused_page(book_tree, req)

    if page_indexes:
        if focused is None:
            page_index = page_indexes[0]
            return (
                V3EditNavigation(pageIndex=page_index),
                None,
                "已翻到这一章的第一页。" if req.language == "zh" else "Opening the first page in this chapter.",
            )
        for page_index in page_indexes:
            if page_index > focused:
                return (
                    V3EditNavigation(pageIndex=page_index),
                    None,
                    "已翻到下一页。" if req.language == "zh" else "Opening the next page.",
                )

    if chapter_id:
        return (
            None,
            story_progress.chapter_done_decision(),
            "这一章已确认，继续下一章。" if req.language == "zh" else "This chapter is confirmed. Moving on.",
        )
    return (
        None,
        None,
        "整本书的章节已经确认完成。" if req.language == "zh" else "All chapters are already confirmed.",
    )


__all__ = ["advance_from_book_tree"]
