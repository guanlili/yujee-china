"""Init first-pass writing service (#161).

`init` used to hand the editor an empty draft (skeleton only, texts={},
meta.theme=None) and squeeze copy out one chapter at a time through the
conversational `/v2/album/chapter-chat` loop. This service writes the WHOLE
first draft inside `init`: an auto-picked theme + cover copy, then every
chapter's body copy, all in one non-conversational pass so the user lands in
the editor with a complete book (chapters at state='generated').

Two reusable pieces:

  * `generate_chapter_texts(...)` — a no-dialog ("first_pass_generate") writer
    that calls DeepSeek once for one chapter and returns its `pagesTexts`. It
    skips the ask/brief state machine entirely and reuses the grounding helpers
    from `grounding.py`: the model writes the copy, but any slot whose text
    introduces a proper noun NOT present in the chapter's own known material
    (cluster place/timeRange + photo descriptions/tags) is replaced by the same
    grounded, never-invent-names text `_skipped_texts` produces. This is the
    grounding constraint the issue requires init writing to reuse verbatim.

  * `generate_cover_texts(...)` — auto-theme + cover copy via the existing
    theme service (no theme-confirmation dialog step).

Concurrency (cover + N chapters) is orchestrated by the caller (v2_album) with
an asyncio.Semaphore; this module is per-unit and stateless.
"""

from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable
from typing import Any

from ..schemas import Page
from ..schemas_v2 import (
    Usage,
    V2Chapter,
    V2CoverDraft,
    V2Models,
    V2PageTexts,
    V2Photo,
    V2Theme,
)
from ..settings import get_settings
from . import ai_client, theme as theme_service, writing_guides
from .grounding import (
    GroundingContext,
    allowed_nouns_from_sources,
    is_grounded,
    page_texts,
    skipped_texts,
)


CompleteFn = Callable[..., Awaitable[dict[str, Any]]]


class WritingError(Exception):
    """Raised when a first-pass writing model call or response is unusable."""


# Proper-noun grounding (detectors, allowed-set builder, is_grounded check) lives
# in grounding.py so the chapter path and the cover path (#161 MUST-FIX) share the
# EXACT same heuristic. We only build the *scope* of allowed nouns here: chapter-
# scoped for chapters, album-wide for the cover.


# ---------- cover (auto-theme, no confirmation dialog) ------------------------


async def generate_cover_texts(
    *,
    clusters_overview: list[Any],
    language: str,
    prompt_hint: str | None,
    complete: CompleteFn | None,
    allowed_nouns: set[str] | None = None,
) -> tuple[V2Theme, V2CoverDraft | None, Usage]:
    """Auto-pick a theme and write cover copy in one call, with NO
    theme-confirmation step. Reuses the theme service (same grounded prompt that
    never invents people/places); the user's promptHint, if any, seeds the
    direction via `userMessage`.

    The cover is the book's most prominent text, yet `theme_service` only
    length-clamps it — the model could still land an invented name ("Sarah",
    "Tuscany") on `theme.subject`/cover slots. So we run the cover's texts AND the
    theme subject through the SAME deterministic grounding scrub the chapter path
    uses (`grounding.is_grounded`), against the album-wide allowed-noun set
    (`allowed_nouns`: union of every cluster's place/timeRange/label + all photos'
    description/tags). Any slot/subject carrying an unknown proper noun is replaced
    with a deterministic grounded fallback (#161 MUST-FIX). When `allowed_nouns` is
    None (no album material supplied), no scrub is applied.

    Returns (theme, cover, usage). Raises WritingError on model failure so the
    caller can fail the whole init writing stage."""
    from ..schemas_v2 import V2ThemeRequest

    req = V2ThemeRequest(
        albumId="init",  # never persisted; theme service ignores it
        language=language,
        clustersOverview=clusters_overview,
        currentTheme=None,
        userMessage=(prompt_hint or None),
    )
    try:
        response = await theme_service.run(req, complete=complete)
    except theme_service.ThemeError as exc:
        raise WritingError(f"cover/theme generation failed: {exc}") from exc
    theme_obj, cover = response.theme, response.cover
    if allowed_nouns is not None:
        theme_obj, cover = _scrub_cover(
            theme_obj, cover, allowed_nouns, clusters_overview, language
        )
    return theme_obj, cover, response.usage


def _neutral_cover_subject(
    allowed_nouns: set[str],
    clusters_overview: list[Any],
    language: str,
) -> str:
    """A deterministic grounded subject to fall back to when the model's subject
    carries an unknown proper noun: the first cluster label that is ITSELF grounded
    (so we never reintroduce an invented name), else a neutral phrase matching the
    chapter fallback style (grounding.fallback_texts title)."""
    for cluster in clusters_overview:
        label = getattr(cluster, "label", "")
        if isinstance(label, str) and label.strip() and is_grounded(label, allowed_nouns):
            return label.strip()
    return "Life in photographs" if language == "en" else "照片里的时光"


def _scrub_cover(
    theme: V2Theme,
    cover: V2CoverDraft | None,
    allowed_nouns: set[str],
    clusters_overview: list[Any],
    language: str,
) -> tuple[V2Theme, V2CoverDraft | None]:
    """Replace any cover slot / theme subject that smuggles in an unknown proper
    noun with a deterministic grounded fallback, using the SAME `is_grounded`
    heuristic as chapters. Keeps the cover non-empty after scrubbing."""
    neutral = _neutral_cover_subject(allowed_nouns, clusters_overview, language)

    # theme.subject flows onto the cover title/heading; scrub it first so a
    # grounded subject is available to backfill scrubbed cover slots.
    safe_subject = theme.subject if is_grounded(theme.subject, allowed_nouns) else neutral
    theme = theme.model_copy(update={"subject": safe_subject})

    if cover is None:
        return theme, None

    safe_texts: dict[str, str] = {}
    for slot, value in cover.texts.items():
        if is_grounded(value, allowed_nouns):
            safe_texts[slot] = value
            continue
        # Title/heading slots carry the subject; fall back to the grounded subject.
        # Any other ungrounded slot falls back to the same neutral phrase so the
        # cover never goes blank or keeps an invented name.
        safe_texts[slot] = safe_subject if slot in ("title", "heading") else neutral
    if not safe_texts:
        safe_texts = {"title": safe_subject}
    cover = cover.model_copy(update={"texts": safe_texts})
    return theme, cover


# ---------- chapter body copy (no-dialog first pass) --------------------------


def build_messages(
    chapter: V2Chapter,
    photos: list[V2Photo],
    theme: V2Theme | None,
    language: str,
) -> list[dict[str, str]]:
    """Build the first-pass authoring prompt for ONE chapter. Unlike chapter-chat
    this has no conversation, no ask/brief state — it instructs the model to
    write all page copy directly, grounded only in the supplied photo analysis +
    cluster metadata, inventing no people/places/events/dates."""
    system = writing_guides.persona_block() + "\n\n" + (
        "You are writing the first draft of ONE chapter of a memoir photo album, "
        "in a single pass with no conversation. "
        "Return STRICT JSON only: "
        '{"pagesTexts":[{"pageIndex":number,"texts":object}]}. '
        "Write copy for every page in the supplied chapter slice. "
        "Use ONLY the supplied photo analysis and cluster metadata. Do NOT invent "
        "people, places, events, relationships, or dates — if a concrete name or "
        "date is not in the supplied material, do not write one. "
        "Only output this chapter's pages; never another chapter or the whole album. "
        "Do not mention base64 or hidden image data."
    )
    system += "\n\n" + writing_guides.guides_block()

    photo_by_id = {p.photoId: p for p in photos}
    chapter_photos = [
        photo_by_id[pid].analysis.model_dump(exclude_none=True)
        for pid in chapter.photoIds
        if pid in photo_by_id
    ]
    payload = {
        "language": language,
        "theme": theme.model_dump(exclude_none=True) if theme else None,
        "chapter": {
            "chapterId": chapter.chapterId,
            "cluster": chapter.cluster.model_dump(exclude_none=True),
        },
        "photos": chapter_photos,
        "pageSlots": {
            str(page.pageIndex): writing_guides.page_slot_specs(page.templateId)
            for page in chapter.pages
        },
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


async def generate_chapter_texts(
    chapter: V2Chapter,
    photos: list[V2Photo],
    theme: V2Theme | None,
    language: str,
    *,
    complete: CompleteFn | None = None,
) -> tuple[list[V2PageTexts], Usage]:
    """No-dialog ("first_pass_generate") writer for ONE chapter.

    Calls DeepSeek once, then coerces the result through the shared grounding
    helpers so the returned `pagesTexts` are template-clamped and never carry an
    invented proper noun (see `_ground_slot`). Returns (pagesTexts, usage)."""
    started = time.monotonic()
    messages = build_messages(chapter, photos, theme, language)
    response = await _complete(messages, complete=complete, max_tokens=1800, temperature=0.35)
    parsed = _parse_model_json(response)
    duration_ms = int((time.monotonic() - started) * 1000)
    usage = _usage_from_response(response, duration_ms)

    ctx = _chapter_context(chapter, photos, language)
    allowed = _allowed_proper_nouns(chapter, photos)
    raw_by_index = _raw_pages_by_index(parsed.get("pagesTexts"), chapter)

    out: list[V2PageTexts] = []
    for page in chapter.pages:
        # First normalize model copy onto the page's slots (grounded fallback for
        # any missing slot), then scrub any slot that smuggled in an unknown
        # proper noun — replacing it with the deterministic grounded text.
        normalized = page_texts(page, raw_by_index.get(page.pageIndex, {}), ctx)
        grounded = skipped_texts(page, ctx)
        safe = {
            slot: (value if is_grounded(value, allowed) else grounded.get(slot, value))
            for slot, value in normalized.items()
        }
        out.append(V2PageTexts(pageIndex=page.pageIndex, texts=safe))
    return out, usage


# ---------- grounding helpers -------------------------------------------------


def _chapter_context(
    chapter: V2Chapter, photos: list[V2Photo], language: str
) -> GroundingContext:
    photo_by_id = {p.photoId: p for p in photos}
    chapter_analyses = [
        photo_by_id[pid].analysis for pid in chapter.photoIds if pid in photo_by_id
    ]
    return GroundingContext(
        language=language,
        place=chapter.cluster.place.strip()
        if isinstance(chapter.cluster.place, str) and chapter.cluster.place.strip()
        else "",
        time_range=chapter.cluster.timeRange.strip()
        if isinstance(chapter.cluster.timeRange, str) and chapter.cluster.timeRange.strip()
        else "",
        photos_by_id={a.photoId: a for a in chapter_analyses},
    )


def _allowed_proper_nouns(chapter: V2Chapter, photos: list[V2Photo]) -> set[str]:
    """The only proper nouns model copy may keep: tokens already present in this
    chapter's known material — cluster place/timeRange/label + each photo's
    description and tags. Anything else is treated as invented and scrubbed.
    Uses the shared `grounding.allowed_nouns_from_sources` so the chapter and cover
    scrubs derive their allowed sets identically (#161 MUST-FIX)."""
    photo_by_id = {p.photoId: p for p in photos}
    sources: list[str] = []
    cluster = chapter.cluster
    for value in (cluster.place, cluster.timeRange, cluster.label):
        if isinstance(value, str):
            sources.append(value)
    for pid in chapter.photoIds:
        photo = photo_by_id.get(pid)
        if not photo:
            continue
        sources.append(photo.analysis.description or "")
        sources.extend(photo.analysis.tags or [])
    return allowed_nouns_from_sources(sources)


def album_allowed_proper_nouns(chapters: list[V2Chapter], photos: list[V2Photo]) -> set[str]:
    """Album-wide allowed-noun set for the COVER scrub: the union over EVERY
    chapter's cluster place/timeRange/label + EVERY photo's description and tags
    (not one chapter's slice). The cover speaks for the whole book, so a name is
    legitimate if it appears anywhere in the album's known material (#161 MUST-FIX).
    Built with the same `allowed_nouns_from_sources` the chapter scope uses."""
    sources: list[str] = []
    for chapter in chapters:
        cluster = chapter.cluster
        for value in (cluster.place, cluster.timeRange, cluster.label):
            if isinstance(value, str):
                sources.append(value)
    for photo in photos:
        sources.append(photo.analysis.description or "")
        sources.extend(photo.analysis.tags or [])
    return allowed_nouns_from_sources(sources)


def _raw_pages_by_index(raw: Any, chapter: V2Chapter) -> dict[int, dict[str, str]]:
    by_index = {p.pageIndex for p in chapter.pages}
    out: dict[int, dict[str, str]] = {}
    if not isinstance(raw, list):
        return out
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            page_index = int(item["pageIndex"])
        except (KeyError, TypeError, ValueError):
            continue
        texts = item.get("texts")
        if isinstance(texts, dict) and page_index in by_index:
            out[page_index] = {
                str(k): str(v).strip()
                for k, v in texts.items()
                if isinstance(k, str) and str(v).strip()
            }
    return out


# ---------- model plumbing (mirrors chapter_chat) -----------------------------


async def _complete(
    messages: list[dict[str, str]],
    *,
    complete: CompleteFn | None,
    max_tokens: int,
    temperature: float,
) -> dict[str, Any]:
    if complete is not None:
        return await complete(messages=messages, max_tokens=max_tokens, temperature=temperature)

    settings = get_settings()
    if not settings.deepseek_api_key:
        raise WritingError("DEEPSEEK_API_KEY missing; cannot run first-pass writing")
    return await ai_client.chat_completion(
        base_url=settings.deepseek_base_url,
        api_key=settings.deepseek_api_key,
        model=settings.deepseek_model,
        messages=messages,
        timeout_seconds=settings.deepseek_timeout_seconds,
        response_format={"type": "json_object"} if settings.deepseek_use_json_object else None,
        max_tokens=max_tokens,
        temperature=temperature,
        extra_body=(
            {"thinking": {"type": "disabled"}} if settings.deepseek_disable_thinking else None
        ),
    )


def _parse_model_json(response: dict[str, Any]) -> dict[str, Any]:
    try:
        parsed = ai_client.parse_json_loose(ai_client.extract_text(response))
    except ValueError as exc:
        raise WritingError(f"first-pass writing response was not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise WritingError(
            f"first-pass writing response must be an object, got {type(parsed).__name__}"
        )
    return parsed


def _usage_from_response(response: dict[str, Any], duration_ms: int) -> Usage:
    settings = get_settings()
    prompt_tokens, completion_tokens = ai_client.extract_usage(response)
    return Usage(
        durationMs=duration_ms,
        planningInputTokens=prompt_tokens,
        planningOutputTokens=completion_tokens,
        models=V2Models(planning=settings.deepseek_model),
    )
