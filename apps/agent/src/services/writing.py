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
import re
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
from .grounding import GroundingContext, page_texts, skipped_texts


CompleteFn = Callable[..., Awaitable[dict[str, Any]]]


class WritingError(Exception):
    """Raised when a first-pass writing model call or response is unusable."""


# Proper-noun detectors used to keep model copy grounded. We never *add* names;
# we only ALLOW words that already appear in this chapter's known material.
# Latin: a capitalized word not at sentence start is treated as a candidate
# proper noun. CJK: any run of 2+ Han characters is a candidate (names, places).
_LATIN_CAP_RE = re.compile(r"\b([A-Z][a-z]+)\b")
_CJK_RUN_RE = re.compile(r"[一-鿿]{2,}")


# ---------- cover (auto-theme, no confirmation dialog) ------------------------


async def generate_cover_texts(
    *,
    clusters_overview: list[Any],
    language: str,
    prompt_hint: str | None,
    complete: CompleteFn | None,
) -> tuple[V2Theme, V2CoverDraft | None, Usage]:
    """Auto-pick a theme and write cover copy in one call, with NO
    theme-confirmation step. Reuses the theme service (same grounded prompt that
    never invents people/places); the user's promptHint, if any, seeds the
    direction via `userMessage`.

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
    return response.theme, response.cover, response.usage


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
            slot: (value if _is_grounded(value, allowed) else grounded.get(slot, value))
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
    description and tags. Anything else is treated as invented and scrubbed."""
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
    allowed: set[str] = set()
    for text in sources:
        allowed.update(m.lower() for m in _LATIN_CAP_RE.findall(text))
        allowed.update(_CJK_RUN_RE.findall(text))
    return allowed


def _is_grounded(value: str, allowed: set[str]) -> bool:
    """True if `value` introduces no proper noun outside the allowed set."""
    for m in _LATIN_CAP_RE.findall(value):
        if m.lower() not in allowed:
            return False
    for m in _CJK_RUN_RE.findall(value):
        if m not in allowed and not _cjk_substring_allowed(m, allowed):
            return False
    return True


def _cjk_substring_allowed(token: str, allowed: set[str]) -> bool:
    """A CJK run is fine if it (or each of its name-length pieces) appears inside
    some allowed source token — lets grounded place names through even when the
    model glued them to other characters, without whitelisting new names."""
    return any(token in a or a in token for a in allowed if _CJK_RUN_RE.fullmatch(a))


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
