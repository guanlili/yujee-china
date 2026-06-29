"""章节故事 patch 分类与硬规则。"""

from __future__ import annotations

import re

from ..schemas import (
    V3EditChatRequest,
    V3EditNavigation,
    V3EditProgressDecision,
    V3LayoutPatchEntry,
    V3PageTextsPatch,
    V3Usage,
)

_LAYOUT_SWAP_PATTERNS = (
    re.compile(r"\b(change|swap|switch|try|use|pick|choose|regenerate|redesign)\b.{0,24}\blayout\b"),
    re.compile(r"\blayout\b.{0,18}\b(change|swap|switch|option|variant)\b"),
)
_LAYOUT_TEXT_TARGET = re.compile(
    r"\blayout'?s?\s+(wording|copy|text|caption|title)\b"
    r"|\b(wording|copy|text|caption|title)\b.{0,20}\blayout\b"
)
_EN_PAGE_NUMBER_RE = re.compile(r"\b(?:page|p)\s*([1-9]\d{0,2})\b")
_ZH_PAGE_NUMBER_RE = re.compile(r"(?:第\s*)?([1-9]\d{0,2})\s*页")
_EN_ORDINAL_PAGES = {
    "first page": 0,
    "second page": 1,
    "third page": 2,
    "fourth page": 3,
    "fifth page": 4,
    "sixth page": 5,
    "seventh page": 6,
    "eighth page": 7,
    "ninth page": 8,
    "tenth page": 9,
}
_ZH_PAGE_ORDINALS = {
    "第一页": 0,
    "第二页": 1,
    "第三页": 2,
    "第四页": 3,
    "第五页": 4,
    "第六页": 5,
    "第七页": 6,
    "第八页": 7,
    "第九页": 8,
    "第十页": 9,
}
_DEICTIC_PAGE_TERMS = (
    "这页",
    "这一页",
    "当前页",
    "这个页面",
    "这张页面",
    "这个",
    "this page",
    "current page",
)
_FOLLOWUP_PAGE_TERMS = (
    "没变",
    "没有变",
    "还是不行",
    "还不行",
    "不行",
    "这版不行",
    "当前这版",
    "重新来",
    "再改",
    "still not",
    "no change",
    "didn't change",
    "doesn't work",
    "not working",
)


def usage(duration_ms: int, *, models: dict[str, str | None] | None = None) -> V3Usage:
    return V3Usage(durationMs=duration_ms, models=models or {})


def infer_page_index(text: str) -> int | None:
    """从用户文本里提取明确页码,返回 0-based pageIndex。"""
    normalized = text.strip().lower()
    if not normalized:
        return None
    compact = re.sub(r"\s+", "", normalized)
    for phrase, page_index in _ZH_PAGE_ORDINALS.items():
        if phrase in compact:
            return page_index
    for phrase, page_index in _EN_ORDINAL_PAGES.items():
        if phrase in normalized:
            return page_index
    for pattern in (_ZH_PAGE_NUMBER_RE, _EN_PAGE_NUMBER_RE):
        match = pattern.search(normalized)
        if match:
            return int(match.group(1)) - 1
    return None


def is_contextual_page_reference(text: str) -> bool:
    """用户没有说具体页码,但语义上仍是在指某一页。"""
    normalized = text.strip().lower()
    if not normalized:
        return False
    return any(term in normalized for term in (*_DEICTIC_PAGE_TERMS, *_FOLLOWUP_PAGE_TERMS))


def _session_last_page_index(session_json: dict[str, object] | None) -> int | None:
    if not isinstance(session_json, dict):
        return None
    value = session_json.get("lastPageIndex")
    if isinstance(value, int) and value >= 0:
        return value
    return None


def with_contextual_page_focus(
    req: V3EditChatRequest, *, session_json: dict[str, object] | None = None
) -> V3EditChatRequest:
    """前端未传 focused page 时,按用户语义和会话上下文补齐目标页。"""
    if req.focus.pageIndex is not None:
        return req
    page_index = infer_page_index(req.userMessage)
    if page_index is None and is_contextual_page_reference(req.userMessage):
        page_index = _session_last_page_index(session_json)
        if page_index is None:
            page_index = 0
    if page_index is None:
        return req
    return req.model_copy(update={"focus": req.focus.model_copy(update={"pageIndex": page_index})})


def with_inferred_page_focus(req: V3EditChatRequest) -> V3EditChatRequest:
    """兼容旧调用方:无会话上下文时仍可按文本语义推断目标页。"""
    return with_contextual_page_focus(req)


def kind_from_bundle(
    pages_texts: list[V3PageTextsPatch] | None, patches: list[V3LayoutPatchEntry]
) -> str:
    if pages_texts:
        return "write"
    if patches:
        return "edit"
    return "talk"


def wants_layout_swap(req: V3EditChatRequest) -> bool:
    text = req.userMessage.strip().lower()
    if not text:
        return False
    if _LAYOUT_TEXT_TARGET.search(text):
        return False
    if any(pattern.search(text) for pattern in _LAYOUT_SWAP_PATTERNS):
        return True
    chinese_layout_phrases = (
        "换版式",
        "换个版式",
        "换一种版式",
        "更换版式",
        "重新排版",
        "调整版式",
        "换布局",
        "更换布局",
    )
    if any(phrase in text for phrase in chinese_layout_phrases):
        return True
    return (
        ("版式" in text or "布局" in text)
        and any(verb in text for verb in ("换", "更换", "重新", "调整", "试试", "改成"))
        and not any(target in text for target in ("文案", "文字", "标题", "说明", "caption", "wording"))
    )


def operation_kind(
    req: V3EditChatRequest,
    pages_texts: list[V3PageTextsPatch] | None,
    patches: list[V3LayoutPatchEntry],
    progress: V3EditProgressDecision | None,
    navigation: V3EditNavigation | None = None,
) -> str:
    text = req.userMessage.lower()
    if wants_layout_swap(req):
        return "swap_layout"
    if "photo" in text or "image" in text or "换图" in text:
        return "swap_image"
    if pages_texts:
        return "write_chapter"
    if patches:
        return "edit_text"
    if navigation or (progress and progress.chapterDone):
        return "advance"
    return "edit_text"


__all__ = [
    "infer_page_index",
    "is_contextual_page_reference",
    "kind_from_bundle",
    "operation_kind",
    "usage",
    "wants_layout_swap",
    "with_contextual_page_focus",
    "with_inferred_page_focus",
]
