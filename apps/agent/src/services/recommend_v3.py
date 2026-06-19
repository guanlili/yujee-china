"""V3 theme/chapter-color recommender (§4.3 / §6 / §8, issue #189 / WP3.1).

The endpoint is `POST /v3/recommend` (§8.1: 同步 / 识图模型); it carries the two
recommend Skills:

  * recommend-theme          → 1–3 whole-album theme candidates (subject/label/tone).
                               The user picks one; nothing here writes the tree.
  * recommend-chapter-colors → one {accentColor, artFont} per chapter. `artFont`
                               MUST be one of the 4 ArtFontPack members; `accentColor`
                               MUST be a `#hex`. Both are clamped/validated below so a
                               drifted model can never inject an illegal font or a
                               non-hex color.

The model authors ONLY suggestions — it never invents a templateId / pageIndex
(those are the deterministic engine's, §8.3). recommend produces *candidates*; the
tree is written later by WP3.2 `apply-theme` after the user confirms (§4.1: theme
环节 fills the null placeholders). recommend does NOT advance stage (§8.3 stage
推进权在 Web).

Recognition-model slot reuse (§6.8 第 2 条): the same OpenAI-primary /火山-failover
strategy as describe-content (`vision.describe_content`). recommend's input is
TEXT ONLY (chapter descriptions + per-photo sceneDescriptions + analysis summary);
no base64 reaches this endpoint (the V3RecommendRequest contract carries none), so
there is nothing to sample with `color_sampling.sample_dominant_color` here and
nothing image-shaped to log (§3 privacy holds by construction).

Stateless (§3): the Agent holds no draft/stage; Web owns the tree + stage and
merges. This module keeps no module-level state.
"""

from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable
from typing import Any, get_args

from ..logging_config import get_logger
from ..schemas import (
    ArtFontPack,
    V3ChapterColorRecommendation,
    V3ChapterOverview,
    V3Models,
    V3RecommendRequest,
    V3RecommendResponse,
    V3ThemeOption,
    V3Usage,
)
from ..settings import get_settings
from ..skills import load_skill
from . import ai_client
from .vision_provider import (
    VisionSlot,
    VisionSlotError,
    ark_vision_slot,
    openai_vision_slot,
)

log = get_logger("recommend_v3")

CompleteFn = Callable[..., Awaitable[dict[str, Any]]]

# Closed legal sets (mirror the contract). A drifted model output is coerced back
# into these so the response always validates against V3RecommendResponse.
_ART_FONTS: tuple[str, ...] = tuple(get_args(ArtFontPack))
_DEFAULT_FONT = "serif-classic"
# Neutral accent used when a chapter's model color is missing/illegal — a calm
# slate that reads fine on any spread; apply-theme/the user can still override.
_FALLBACK_ACCENT = "#4A5568"
_MAX_THEME_OPTIONS = 3
# 6-hex form the response/AccentColor regex accepts; also what we normalize to.
_HEX6_LEN = 6


class RecommendV3Error(Exception):
    """Raised when the recommend model call or its JSON response is unusable.

    The route maps this to an HTTP error code (§8.3 同步端点走 HTTP 错误码); the
    front end may retry without polluting stage."""


# ---------- prompt assembly ---------------------------------------------------


def _lang_name(language: str) -> str:
    """Human language name for a skill `{LANGUAGE}` placeholder (mirrors vision.py)."""
    return "Chinese" if language == "zh" else "English"


def _chapter_payload(chapter: V3ChapterOverview) -> dict[str, Any]:
    """One chapter's recommend input (§8 表): description + per-photo scenes.

    Privacy-clean by construction — `V3ChapterOverview` (`_V3Strict`) forbids any
    GPS/place field at parse time, and photoDescs are free-text scene sentences."""
    return {
        "chapterId": chapter.chapterId,
        "description": chapter.description,
        "photoDescs": list(chapter.photoDescs),
    }


def build_messages(req: V3RecommendRequest) -> list[dict[str, str]]:
    """Build the recommend prompt from the chapter overview + analysis summary.

    The system prompt fixes the STRICT JSON contract + the two-skill task and the
    closed font/color legal sets; the user payload carries the chapter overviews,
    the global analysis summary, and any user steer (`userMessage`). Both skills
    are loaded as prompt assets (集中维护), localized via `{LANGUAGE}`."""
    lang_name = _lang_name(req.language)
    system = (
        load_skill("recommend_theme", LANGUAGE=lang_name)
        + "\n\n=== CHAPTER COLORS & ART FONT (recommend-chapter-colors Skill) ===\n"
        + load_skill(
            "recommend_chapter_colors",
            LANGUAGE=lang_name,
            ART_FONTS=", ".join(_ART_FONTS),
        )
    )
    payload: dict[str, Any] = {
        "language": req.language,
        "analysisSummary": req.analysisSummary or "",
        "userMessage": req.userMessage or "",
        "chapters": [_chapter_payload(c) for c in req.chapters],
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


# ---------- model call --------------------------------------------------------


async def run(
    req: V3RecommendRequest,
    *,
    complete: CompleteFn | None = None,
) -> V3RecommendResponse:
    """③ recommend (§8 同步). One recognition-model call → theme candidates + per
    chapter {accentColor, artFont}. `complete` is injected in tests; production uses
    the OpenAI-primary /火山-failover slot strategy (`_complete`)."""
    started = time.monotonic()
    messages = build_messages(req)
    response, model = await _complete(messages, complete=complete)
    parsed = _parse_model_json(response)
    duration_ms = int((time.monotonic() - started) * 1000)
    usage = _usage_from_response(response, duration_ms, model)
    return _coerce_response(req, parsed, usage)


async def _complete(
    messages: list[dict[str, str]],
    *,
    complete: CompleteFn | None,
) -> tuple[dict[str, Any], str | None]:
    """Run the recommend call. Returns (response, resolved_model).

    Test path: the injected `complete` stands in for the upstream call (model name
    unknown → None). Production path: recognition-model slot reuse — try OpenAI
    (GPT-5.5 Mini) first, 降级火山 doubao on transport failure / missing key, exactly
    like describe-content (§6.8 第 2 条). A VisionError-class unusable RESPONSE is the
    caller's concern (RecommendV3Error), not a reason to burn the second provider."""
    if complete is not None:
        return await complete(messages=messages), None

    settings = get_settings()

    # --- PRIMARY: OpenAI (GPT-5.5 Mini) --------------------------------------
    primary_slot: VisionSlot | None = None
    try:
        primary_slot = openai_vision_slot(
            settings,
            timeout_seconds=settings.describe_openai_timeout_seconds,
            model=settings.describe_openai_model,
        )
    except VisionSlotError as exc:
        log.warning("v3_recommend.primary_unconfigured", error=str(exc))

    if primary_slot is not None:
        try:
            response = await _call_slot(primary_slot, messages)
            log.info("v3_recommend.call.ok", provider=primary_slot.provider, model=primary_slot.model)
            return response, primary_slot.model
        except ai_client.AIRequestError as exc:
            log.warning(
                "v3_recommend.primary_failover",
                provider=primary_slot.provider,
                reason=type(exc).__name__,
            )

    # --- FAILOVER: 火山 doubao (ARK) -----------------------------------------
    try:
        fallback_slot = ark_vision_slot(settings)
    except VisionSlotError as exc:
        raise RecommendV3Error(
            f"recommend failover unavailable (火山 slot): {exc}"
        ) from exc
    try:
        response = await _call_slot(fallback_slot, messages)
    except ai_client.AIRequestError as exc:
        raise RecommendV3Error(f"recommend火山 failover failed: {exc}") from exc
    log.info("v3_recommend.failover.ok", provider=fallback_slot.provider, model=fallback_slot.model)
    return response, fallback_slot.model


async def _call_slot(slot: VisionSlot, messages: list[dict[str, str]]) -> dict[str, Any]:
    """One recommend call on `slot`. Text-only (no images) — recommend never sends
    base64 — but it reuses the vision slot's provider quirks (json_object / thinking
    knob) since the recognition model owns this stage (§8.1)."""
    return await ai_client.chat_completion(
        base_url=slot.base_url,
        api_key=slot.api_key,
        model=slot.model,
        messages=messages,
        timeout_seconds=slot.timeout_seconds,
        temperature=0.4,
        max_tokens=1800,
        response_format=slot.response_format,
        extra_body=slot.extra_body,
    )


def _parse_model_json(response: dict[str, Any]) -> dict[str, Any]:
    try:
        parsed = ai_client.parse_json_loose(ai_client.extract_text(response))
    except ValueError as exc:
        raise RecommendV3Error(
            f"recommend model response was not valid JSON: {exc}"
        ) from exc
    if not isinstance(parsed, dict):
        raise RecommendV3Error(
            f"recommend model response must be an object, got {type(parsed).__name__}"
        )
    return parsed


def _usage_from_response(
    response: dict[str, Any], duration_ms: int, model: str | None
) -> V3Usage:
    prompt_tokens, completion_tokens = ai_client.extract_usage(response)
    return V3Usage(
        durationMs=duration_ms,
        visionCallCount=1,
        planningInputTokens=prompt_tokens,
        planningOutputTokens=completion_tokens,
        # recommend runs on the recognition (vision) slot; report it as models.vision
        # when known. The strict schema rejects an explicit None for the optional
        # model-name field, so include it only when resolved.
        models=V3Models(**({"vision": model} if model else {})),
    )


# ---------- response coercion -------------------------------------------------


def _coerce_response(
    req: V3RecommendRequest,
    parsed: dict[str, Any],
    usage: V3Usage,
) -> V3RecommendResponse:
    theme_options = _coerce_theme_options(parsed.get("themeOptions"))
    chapter_colors = _coerce_chapter_colors(req, parsed.get("chapterColors"))
    reply = _text(parsed.get("assistantReply")) or _default_reply(req.language)
    return V3RecommendResponse(
        themeOptions=theme_options,
        chapterColors=chapter_colors,
        assistantReply=reply[:500],
        usage=usage,
    )


def _coerce_theme_options(raw: Any) -> list[V3ThemeOption]:
    """Up to 3 theme candidates (§ contract min 1 / max 3). Each needs a non-empty
    `subject` + `label`; `tone` is optional. A drifted/empty list degrades to one
    neutral candidate so the response always validates (never 0 options)."""
    options: list[V3ThemeOption] = []
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            subject = _text(item.get("subject"))
            label = _text(item.get("label"))
            if not subject or not label:
                continue
            tone = _text(item.get("tone"))
            extra = {"tone": tone[:120]} if tone else {}
            options.append(V3ThemeOption(subject=subject[:120], label=label[:120], **extra))
            if len(options) == _MAX_THEME_OPTIONS:
                break
    if not options:
        log.info("v3_recommend.theme_fallback")
        options.append(V3ThemeOption(subject="Your Story", label="A Memoir"))
    return options


def _coerce_chapter_colors(
    req: V3RecommendRequest, raw: Any
) -> list[V3ChapterColorRecommendation]:
    """Exactly one {accentColor, artFont} per input chapter, in input order.

    Grounding guardrails (§8.3 模型出意图、代码保合法):
      * artFont is clamped to the 4-member ArtFontPack — an illegal/missing font →
        the default font, never an injected value.
      * accentColor is normalized to `#RRGGBB`; an illegal/missing color → the
        neutral fallback. The model can never emit a non-hex color into the tree.
      * Every input chapter gets exactly one entry (a chapter the model omitted is
        filled with the fallback color+font) — recommend never drops a chapter, and
        apply-theme can rely on full coverage.
    """
    by_id: dict[str, dict[str, Any]] = {}
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            cid = _text(item.get("chapterId"))
            if cid and cid not in by_id:
                by_id[cid] = item

    out: list[V3ChapterColorRecommendation] = []
    for chapter in req.chapters:
        item = by_id.get(chapter.chapterId, {})
        accent = _coerce_accent(item.get("accentColor"))
        font = _coerce_font(item.get("artFont"))
        out.append(
            V3ChapterColorRecommendation(
                chapterId=chapter.chapterId,
                accentColor=accent,
                artFont=font,  # type: ignore[arg-type]
            )
        )
    return out


def _coerce_font(raw: Any) -> str:
    candidate = raw.strip() if isinstance(raw, str) else ""
    return candidate if candidate in _ART_FONTS else _DEFAULT_FONT


def _coerce_accent(raw: Any) -> str:
    """Normalize the model's color into `#RRGGBB`, or the neutral fallback.

    Accepts `#RGB` / `#RRGGBB` (case-insensitive, optional leading `#`); expands the
    3-digit shorthand to 6 so the stored value is the canonical uppercase 6-hex form
    the AccentColor regex / renderer expect. Anything else → fallback (the model can
    never poison the tree with an arbitrary string)."""
    if not isinstance(raw, str):
        return _FALLBACK_ACCENT
    value = raw.strip().lstrip("#")
    if not all(c in "0123456789abcdefABCDEF" for c in value):
        return _FALLBACK_ACCENT
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    if len(value) != _HEX6_LEN:
        return _FALLBACK_ACCENT
    return f"#{value.upper()}"


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _default_reply(language: str) -> str:
    if language == "zh":
        return "我根据你的故事挑了几套主题和每章的配色字体,看看哪个最合适?"
    return "Here are a few themes and per-chapter color/font picks for your story — which fits best?"
