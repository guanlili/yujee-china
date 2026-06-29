"""章节故事 patch 分类与硬规则。"""

from __future__ import annotations

import re

from ..schemas import (
    V3EditChatRequest,
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


def usage(duration_ms: int, *, models: dict[str, str | None] | None = None) -> V3Usage:
    return V3Usage(durationMs=duration_ms, models=models or {})


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
    if progress and progress.chapterDone:
        return "advance"
    return "edit_text"


__all__ = ["kind_from_bundle", "operation_kind", "usage", "wants_layout_swap"]
