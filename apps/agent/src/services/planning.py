"""DeepSeek-driven Stage 2 (writing) and Stage 3 (composing).

writing  → Magazine{title, subtitle, style}
composing → Page[] satisfying TemplateRegistry + §4.3 business rules.

Each stage retries once on JSON parse failure (handled by ai_client) and
runs at most one schema/rules-aware repair before surfacing the appropriate
AGENT_* error code."""

import json
from math import ceil
from typing import Any

from pydantic import ValidationError

from ..logging_config import get_logger
from ..schemas import AlbumLayoutPlan, Magazine, Page, PhotoAnalysis
from ..settings import get_settings
from .. import templates as registry
from . import ai_client, layout_rules

log = get_logger("planning")


_ALLOWED_STYLES = (
    "warm-film",
    "editorial-mono",
    "soft-pastel",
    "bold-contrast",
    "vintage-print",
)


class WritingError(Exception):
    """Maps to AGENT_PLANNING_FAILED."""


class ComposingError(Exception):
    """Maps to AGENT_OUTPUT_VALIDATION."""


# ---------- Stage 2: writing --------------------------------------------------


def _writing_system_prompt(language: str) -> str:
    lang_word = "Chinese" if language == "zh" else "English"
    return (
        "You are the art director writing the editorial concept for a memoir photo album. "
        "Decide ONLY: title, optional subtitle, visual style.\n\n"
        f"Output STRICT JSON only (no code fences), matching:\n"
        "{\n"
        '  "title": string (1..60 chars),\n'
        '  "subtitle": string (<=100 chars) or null,\n'
        f'  "style": one of {list(_ALLOWED_STYLES)}\n'
        "}\n\n"
        f"title and subtitle MUST be written in {lang_word}.\n"
        "Style selection rule of thumb:\n"
        "  - dominant warm mood → warm-film\n"
        "  - quiet / sentimental → editorial-mono\n"
        "  - soft, pastel, intimate → soft-pastel\n"
        "  - bold, energetic, urban → bold-contrast\n"
        "  - nostalgic / old-feeling → vintage-print\n"
    )


def _writing_user_payload(prompt: str, photos: list[PhotoAnalysis], language: str) -> str:
    digest = [
        {
            "mood": p.mood,
            "scene": p.scene,
            "tags": p.tags[:4],
            "description": p.description,
        }
        for p in photos
    ]
    return json.dumps(
        {
            "userPrompt": prompt,
            "language": language,
            "photos": digest,
        },
        ensure_ascii=False,
    )


def _coerce_magazine(parsed: Any, language: str) -> Magazine:
    if not isinstance(parsed, dict):
        raise WritingError(f"writing response not an object (got {type(parsed).__name__})")
    title = str(parsed.get("title") or "").strip()
    subtitle_raw = parsed.get("subtitle")
    subtitle = None if subtitle_raw in (None, "", "null") else str(subtitle_raw).strip()
    style = str(parsed.get("style") or "").strip().lower()
    if style not in _ALLOWED_STYLES:
        style = "warm-film"
    if subtitle is not None and len(subtitle) > 100:
        subtitle = subtitle[:100]
    if not title:
        raise WritingError("writing response missing title")
    if len(title) > 60:
        title = title[:60]
    try:
        return Magazine(
            title=title,
            subtitle=subtitle,
            style=style,
            language=language,  # type: ignore[arg-type]
        )
    except ValidationError as exc:
        raise WritingError(f"magazine schema failed: {exc.errors()[:1]}") from exc


async def write_magazine(
    *,
    prompt: str,
    photos: list[PhotoAnalysis],
    language: str,
) -> tuple[Magazine, int, int, int]:
    """Returns (magazine, prompt_tokens, completion_tokens, repair_attempts)."""
    settings = get_settings()
    if not settings.deepseek_api_key:
        raise WritingError("DEEPSEEK_API_KEY missing; cannot run real writing stage")

    log.info("writing.call.start", photo_count=len(photos), language=language)

    messages = [
        {"role": "system", "content": _writing_system_prompt(language)},
        {"role": "user", "content": _writing_user_payload(prompt, photos, language)},
    ]

    repair_attempts = 0
    last_error: str | None = None
    for attempt in range(2):  # initial + 1 repair
        if attempt == 1 and last_error:
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Your previous JSON failed validation: "
                        f"{last_error}. Reissue the full corrected JSON object "
                        "with the same shape. No prose, no code fences."
                    ),
                }
            )
            repair_attempts += 1

        try:
            response = await ai_client.chat_completion(
                base_url=settings.deepseek_base_url,
                api_key=settings.deepseek_api_key,
                model=settings.deepseek_model,
                messages=messages,
                timeout_seconds=settings.deepseek_timeout_seconds,
                response_format=(
                    {"type": "json_object"} if settings.deepseek_use_json_object else None
                ),
                temperature=0.4,
                max_tokens=2048,
                extra_body=(
                    {"thinking": {"type": "disabled"}}
                    if settings.deepseek_disable_thinking
                    else None
                ),
            )
        except ai_client.AIRequestError as exc:
            # Network exhausted both internal attempts — terminal for this stage.
            raise WritingError(f"writing upstream call failed: {exc}") from exc

        try:
            raw_text = ai_client.extract_text(response)
            parsed = ai_client.parse_json_loose(raw_text)
            magazine = _coerce_magazine(parsed, language)
        except (ValueError, WritingError) as exc:
            last_error = str(exc)[:200]
            log.warning("writing.parse_failed", attempt=attempt, error=last_error)
            continue

        prompt_tokens, completion_tokens = ai_client.extract_usage(response)
        log.info(
            "writing.call.ok",
            attempt=attempt,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            repair_attempts=repair_attempts,
        )
        return magazine, prompt_tokens, completion_tokens, repair_attempts

    raise WritingError(f"writing failed after repair: {last_error}")


# ---------- Stage 3: composing -----------------------------------------------


def _photo_digest_for_composing(photos: list[PhotoAnalysis]) -> list[dict[str, Any]]:
    return [
        {
            "photoId": p.photoId,
            "orientation": p.orientation,
            "quality": p.quality,
            "scene": p.scene,
            "mood": p.mood,
            "peopleCount": p.peopleCount,
            "timeOfDay": p.timeOfDay,
            "tags": p.tags[:4],
            "description": p.description,
        }
        for p in photos
    ]


def _composing_system_prompt(photo_count: int) -> str:
    expected_pages = min(16, max(3, ceil(photo_count / 2.5)))
    return (
        "You compose a memoir photo album from analyzed photos. Output STRICT JSON only "
        "(no code fences, no prose), matching:\n"
        '{ "pages": [ { "pageIndex": int>=0, "templateId": string, '
        '"images": { slotKey: photoId }, "texts": { slotKey: string } } ] }\n\n'
        f"HARD RULES (follow EACH one — your output is validated programmatically):\n"
        f"  1. pages.length must equal max(3, ceil({photo_count}/2.5))={expected_pages}, capped at 16.\n"
        "  2. pages[0].templateId MUST be a cover-category template (one of: "
        f"{registry.COVER_TEMPLATE_IDS}).\n"
        "  3. Every photoId in the photos[] input must appear in at least one page's images.\n"
        "  4. A single photoId may appear at most twice across all pages, and never twice on the same page.\n"
        "  5. For each image slot you fill, the assigned photo MUST satisfy the slot's "
        "orientation AND quality constraints from the TemplateRegistry below.\n"
        "  6. pageIndex must be 0, 1, 2, ... strictly sequential.\n"
        "  7. templateId MUST be one of the registry IDs below; slot keys MUST be from that template.\n"
        "  8. Text content stays within the maxChars hint for each text slot.\n"
        "  9. Prefer using each template at most once; vary visual rhythm.\n\n"
        "TemplateRegistry (id [category] images / texts):\n"
        f"{registry.summarize_for_prompt()}\n"
    )


def _composing_user_payload(magazine: Magazine, photos: list[PhotoAnalysis]) -> str:
    return json.dumps(
        {
            "magazine": magazine.model_dump(),
            "photos": _photo_digest_for_composing(photos),
        },
        ensure_ascii=False,
    )


def _coerce_pages(parsed: Any) -> list[Page]:
    if not isinstance(parsed, dict):
        raise ComposingError(f"composing response not an object (got {type(parsed).__name__})")
    pages_raw = parsed.get("pages")
    if not isinstance(pages_raw, list) or not pages_raw:
        raise ComposingError("composing response missing pages[]")
    pages: list[Page] = []
    for idx, item in enumerate(pages_raw):
        if not isinstance(item, dict):
            raise ComposingError(f"page {idx} not an object")
        # Normalize sequential pageIndex; tolerate model dropping it.
        item = dict(item)
        if "pageIndex" not in item:
            item["pageIndex"] = idx
        try:
            page = Page(
                pageIndex=int(item["pageIndex"]),
                templateId=str(item.get("templateId") or "").strip(),
                images={str(k): str(v) for k, v in (item.get("images") or {}).items()},
                texts={str(k): str(v) for k, v in (item.get("texts") or {}).items()},
            )
        except (ValidationError, ValueError, TypeError) as exc:
            raise ComposingError(f"page {idx} failed schema: {exc}") from exc
        pages.append(page)
    return pages


async def compose_pages(
    *,
    magazine: Magazine,
    photos: list[PhotoAnalysis],
) -> tuple[AlbumLayoutPlan, int, int, int]:
    """Returns (layout, prompt_tokens, completion_tokens, repair_attempts)."""
    settings = get_settings()
    if not settings.deepseek_api_key:
        raise ComposingError("DEEPSEEK_API_KEY missing; cannot run real composing stage")

    log.info("composing.call.start", photo_count=len(photos))

    base_messages = [
        {"role": "system", "content": _composing_system_prompt(len(photos))},
        {"role": "user", "content": _composing_user_payload(magazine, photos)},
    ]

    repair_attempts = 0
    last_error: str | None = None
    total_prompt = 0
    total_completion = 0

    for attempt in range(2):  # initial + 1 repair
        messages = list(base_messages)
        if attempt == 1 and last_error:
            messages.append(
                {
                    "role": "user",
                    "content": (
                        "Your previous composing JSON failed validation:\n"
                        f"{last_error}\n"
                        "Re-issue the FULL pages JSON (not a patch), correcting the issue. "
                        "Re-verify every HARD RULE before responding."
                    ),
                }
            )
            repair_attempts += 1

        try:
            response = await ai_client.chat_completion(
                base_url=settings.deepseek_base_url,
                api_key=settings.deepseek_api_key,
                model=settings.deepseek_model,
                messages=messages,
                timeout_seconds=settings.deepseek_timeout_seconds,
                response_format=(
                    {"type": "json_object"} if settings.deepseek_use_json_object else None
                ),
                temperature=0.3,
                max_tokens=8192,
                # Composing-specific thinking switch (not the shared planning
                # one): thinking ON here blew past the 60s timeout on prod.
                extra_body=(
                    {"thinking": {"type": "disabled"}}
                    if settings.composing_disable_thinking
                    else None
                ),
            )
        except ai_client.AIRequestError as exc:
            # Network exhausted both internal attempts — terminal for this stage.
            raise ComposingError(f"composing upstream call failed: {exc}") from exc

        pt, ct = ai_client.extract_usage(response)
        total_prompt += pt
        total_completion += ct

        try:
            raw_text = ai_client.extract_text(response)
            parsed = ai_client.parse_json_loose(raw_text)
            pages = _coerce_pages(parsed)
            pages = layout_rules.clamp_page_texts(pages)
            layout = AlbumLayoutPlan(magazine=magazine, photos=photos, pages=pages)
        except (ValueError, ComposingError, ValidationError) as exc:
            last_error = str(exc)[:300]
            log.warning("composing.parse_failed", attempt=attempt, error=last_error)
            continue

        rule_violation = layout_rules.violation(layout)
        if rule_violation:
            last_error = f"business rule violation: {rule_violation}"
            log.warning("composing.rules_failed", attempt=attempt, error=last_error)
            continue

        log.info(
            "composing.call.ok",
            attempt=attempt,
            page_count=len(pages),
            prompt_tokens=total_prompt,
            completion_tokens=total_completion,
            repair_attempts=repair_attempts,
        )
        return layout, total_prompt, total_completion, repair_attempts

    raise ComposingError(f"composing failed after repair: {last_error}")
