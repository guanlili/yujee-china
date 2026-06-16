"""Grounding-safe text helpers shared by chapter-chat and init first-pass writing.

The deterministic, never-invent-proper-nouns text generation that used to live
inside `chapter_chat.py` (`_skipped_texts` / `_normalize_page_texts` /
`_fallback_texts` / `_page_photo_summary`) is extracted here so the init
`writing` stage (#161) can reuse the *exact same* grounding rules: only the
chapter slice's own cluster `place`/`timeRange` (EXIF/grouping metadata, not
model text) may surface as concrete names/dates; the model's generated copy is
clamped to template slots and falls back to scene-only language when the model
omits a slot.

Both callers describe their chapter via a small `GroundingContext`, so neither
the chapter-chat request shape nor the init draft shape leaks into the rules.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .. import templates as registry
from ..schemas import Page
from . import layout_rules


# ---------- proper-noun grounding heuristic (shared by chapter + cover) --------
#
# The single source of truth for "does this copy smuggle in a proper noun that is
# NOT in the album's known material?". The chapter path (writing.generate_chapter_
# texts) and the cover path (writing.generate_cover_texts, #161 MUST-FIX) MUST use
# the EXACT same heuristic so behavior is identical — no stricter, no looser.
#
# We never *add* names; we only ALLOW words already present in the supplied known
# material. Latin: a capitalized word (not at sentence start) is a candidate proper
# noun. CJK: any run of 2+ Han characters is a candidate (names, places).
LATIN_CAP_RE = re.compile(r"\b([A-Z][a-z]+)\b")
CJK_RUN_RE = re.compile(r"[一-鿿]{2,}")


def allowed_nouns_from_sources(sources: list[str]) -> set[str]:
    """The set of proper nouns copy may keep: every candidate token (Latin
    capitalized word, lowercased; CJK 2+ run) found in the supplied known-material
    strings. Anything outside this set is treated as invented and scrubbed."""
    allowed: set[str] = set()
    for text in sources:
        if not text:
            continue
        allowed.update(m.lower() for m in LATIN_CAP_RE.findall(text))
        allowed.update(CJK_RUN_RE.findall(text))
    return allowed


def is_grounded(value: str, allowed: set[str]) -> bool:
    """True if `value` introduces no proper noun outside the allowed set."""
    for m in LATIN_CAP_RE.findall(value):
        if m.lower() not in allowed:
            return False
    for m in CJK_RUN_RE.findall(value):
        if m not in allowed and not _cjk_substring_allowed(m, allowed):
            return False
    return True


def _cjk_substring_allowed(token: str, allowed: set[str]) -> bool:
    """A CJK run is fine if it (or each of its name-length pieces) appears inside
    some allowed source token — lets grounded place names through even when the
    model glued them to other characters, without whitelisting new names."""
    return any(token in a or a in token for a in allowed if CJK_RUN_RE.fullmatch(a))


@dataclass(frozen=True)
class GroundingContext:
    """Everything the grounding text helpers need about one chapter.

    `language` is the reader's language; `place`/`time_range` come from the
    chapter cluster (EXIF/grouping metadata — the only concrete names/dates
    allowed in non-conversational copy); `photos_by_id` maps photoId → an object
    exposing `.mood` / `.scene` (V2PhotoAnalysis-shaped) for scene summaries.
    """

    language: str
    place: str | None
    time_range: str | None
    photos_by_id: dict[str, Any]


def normalize_context(
    *,
    language: str,
    cluster: Any,
    photos: list[Any],
) -> GroundingContext:
    """Build a context from a V2Cluster-shaped object + that chapter's photos."""
    return GroundingContext(
        language=language,
        place=_phrase(getattr(cluster, "place", None)),
        time_range=_phrase(getattr(cluster, "timeRange", None)),
        photos_by_id={p.photoId: p for p in photos},
    )


def page_texts(
    page: Page,
    raw_texts: dict[str, str],
    ctx: GroundingContext,
) -> dict[str, str]:
    """Clamp model-provided `raw_texts` to the page's authored slots, filling any
    missing slot from the grounded fallback. Mirrors the old
    `_normalize_page_texts` in chapter_chat — used for the conversational /
    brief-driven generate paths."""
    tpl = registry.get(page.templateId)
    text_slots = tpl["texts"] if tpl else []
    allowed_slots = {meta["id"] for meta in text_slots if meta["role"] != "decoration"}
    texts = {
        slot: value
        for slot, value in raw_texts.items()
        if not allowed_slots or slot in allowed_slots
    }
    missing_slots = [slot for slot in allowed_slots if slot not in texts]
    if missing_slots:
        fallback = fallback_texts(page, ctx)
        for slot in missing_slots:
            if slot in fallback:
                texts[slot] = fallback[slot]
    if not texts:
        texts = fallback_texts(page, ctx)
    return layout_rules.clamp_texts_for_template(page.templateId, texts)


def fallback_texts(page: Page, ctx: GroundingContext) -> dict[str, str]:
    """Scene-only fallback copy when the model omits a slot. Never references the
    cluster place/time (kept neutral so it is safe everywhere)."""
    tpl = registry.get(page.templateId)
    text_slots = tpl["texts"] if tpl else []
    photo_text = _page_photo_summary(page, ctx)
    texts: dict[str, str] = {}
    for meta in text_slots:
        slot = meta["id"]
        role = meta["role"]
        if role == "decoration":
            continue
        if meta.get("repeat") is True:
            texts[slot] = (
                "soft light, small details, quiet atmosphere"
                if ctx.language == "en"
                else "柔和光线、细节、安静氛围"
            )
        elif role == "title":
            texts[slot] = "quiet moments" if ctx.language == "en" else "安静片刻"
        elif role == "explain":
            texts[slot] = "from the visible scene" if ctx.language == "en" else "来自照片里的画面"
        else:
            texts[slot] = photo_text
    if not texts:
        texts["body"] = photo_text
    return layout_rules.clamp_texts_for_template(page.templateId, texts)


def skipped_texts(page: Page, ctx: GroundingContext) -> dict[str, str]:
    """Grounded copy that never invents proper nouns. Only the cluster
    place/timeRange (EXIF/grouping metadata) may surface as concrete
    names/dates. Mirrors the old `_skipped_texts` in chapter_chat — this is the
    grounding constraint init first-pass writing must reuse verbatim."""
    tpl = registry.get(page.templateId)
    text_slots = tpl["texts"] if tpl else []
    place = ctx.place or ""
    time_range = ctx.time_range or ""
    photo_summary = _page_photo_summary(page, ctx)
    heading = (
        _join_nonempty(place, "atmosphere")
        if ctx.language == "en" and place
        else _join_nonempty(place, "的氛围")
        if ctx.language == "zh" and place
        else ("quiet moments" if ctx.language == "en" else "安静片刻")
    )
    detail = _join_nonempty(place, time_range, photo_summary)
    if not detail:
        detail = photo_summary

    texts: dict[str, str] = {}
    for meta in text_slots:
        slot = meta["id"]
        role = meta["role"]
        if role == "decoration":
            continue
        if meta.get("repeat") is True:
            texts[slot] = (
                _join_nonempty(place, time_range, "soft light, quiet details")
                if ctx.language == "en"
                else _join_nonempty(place, time_range, "柔和光线、安静细节")
            )
        elif role == "title":
            texts[slot] = heading
        elif role == "explain":
            texts[slot] = (
                _join_nonempty(place, time_range) or "visible details"
                if ctx.language == "en"
                else _join_nonempty(place, time_range) or "照片细节"
            )
        else:
            texts[slot] = detail
    if not texts:
        texts["body"] = detail
    return layout_rules.clamp_texts_for_template(page.templateId, texts)


def _page_photo_summary(page: Page, ctx: GroundingContext) -> str:
    photos = [ctx.photos_by_id[pid] for pid in page.images.values() if pid in ctx.photos_by_id]
    if not photos:
        return (
            "A quiet pause between the surrounding photographs."
            if ctx.language == "en"
            else "这一页留住相邻照片之间的安静停顿。"
        )
    moods = sorted({p.mood for p in photos if p.mood})
    scenes = sorted({p.scene for p in photos if p.scene})
    if ctx.language == "zh":
        return "照片里有柔和的光线、动作和细节。"
    parts = [moods[0] if moods else "quiet", scenes[0] if scenes else "scene"]
    return f"A {parts[0]} {parts[1]} page shaped by light, texture, and small gestures."


def _phrase(value: str | None) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _join_nonempty(*parts: str) -> str:
    return " ".join(part for part in parts if part)
