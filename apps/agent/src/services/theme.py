"""Stage 2 theme service for Agent v2.

Pure service boundary: this module builds the scoped prompt, calls an injected
OpenAI-compatible completion function (or the shared DeepSeek helper by
default), and normalizes the model JSON into schemas_v2 objects. It does not
know about routes, database state, or draft persistence.
"""

from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable
from typing import Any

from .. import templates as registry
from ..schemas_v2 import (
    Usage,
    V2CoverDraft,
    V2Models,
    V2Style,
    V2Theme,
    V2ThemeOption,
    V2ThemeRequest,
    V2ThemeResponse,
)
from ..settings import get_settings
from . import ai_client, layout_rules, writing_guides


CompleteFn = Callable[..., Awaitable[dict[str, Any]]]

_STYLE_IDS: tuple[V2Style, ...] = (
    "warm-film",
    "editorial-mono",
    "soft-pastel",
    "bold-contrast",
    "vintage-print",
)


class ThemeError(Exception):
    """Raised when the theme model call or JSON response is unusable."""


def build_messages(req: V2ThemeRequest) -> list[dict[str, str]]:
    """Build the minimal DeepSeek prompt for /v2/album/theme."""

    # When no theme is fixed yet (no currentTheme), the user is still choosing —
    # offer 2-3 candidates (editor.html themeAsk + themeOpt1-3) so the front-end
    # can render pickable options. Once a theme is set, just refine it.
    proposing = req.currentTheme is None
    system = (
        "You are setting the global creative direction for a memoir photo album. "
        "Return STRICT JSON only, matching V2ThemeResponse: "
        '{"theme":{"subject":string,"occasion"?:string,"timeframe"?:string,'
        '"tone":string,"style":"warm-film|editorial-mono|soft-pastel|'
        'bold-contrast|vintage-print"},"cover"?:{"templateId":string,'
        '"texts":object,"heroPhotoId":string|null},'
        '"themeOptions"?:[{"subject":string,"label":string,"tone"?:string,'
        '"style"?:"warm-film|editorial-mono|soft-pastel|bold-contrast|'
        'vintage-print"}],"assistantReply":string}. '
        "Use only the supplied cluster overview and optional user direction. "
        "Do not invent people, locations, events, or dates. "
        f"Cover template ids: {', '.join(registry.COVER_TEMPLATE_IDS)}. "
        "Prefer mag-20 when no verified hero photo id is supplied."
    )
    if proposing:
        system += (
            " No theme is fixed yet — the user is still choosing. ALSO return "
            "`themeOptions`: 2-3 distinct theme candidates grounded only in the "
            "supplied overview. Each option needs a `subject` (its title) and a "
            'short `label` (one user-facing line, e.g. "Seaside Walk"); tone/style '
            "are optional hints. Set `theme` to your single best default; "
            "themeOptions are alternatives the user may pick instead."
        )
    else:
        system += (
            " A theme is already chosen; refine it in `theme` and do not return "
            "themeOptions."
        )

    # Write cover texts to each slot's role, whichever cover template is chosen.
    system += "\n\n" + writing_guides.guides_block()

    payload = {
        "language": req.language,
        "clustersOverview": [c.model_dump(exclude_none=True) for c in req.clustersOverview],
        "currentTheme": req.currentTheme.model_dump(exclude_none=True)
        if req.currentTheme
        else None,
        "userMessage": req.userMessage,
        # role/lang/maxChars of each writable slot, per cover template.
        "coverSlots": {
            tid: writing_guides.page_slot_specs(tid)
            for tid in registry.COVER_TEMPLATE_IDS
        },
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


async def run(
    req: V2ThemeRequest,
    *,
    complete: CompleteFn | None = None,
) -> V2ThemeResponse:
    started = time.monotonic()
    messages = build_messages(req)
    response = await _complete(messages, complete=complete, max_tokens=1200, temperature=0.35)
    parsed = _parse_model_json(response)
    duration_ms = int((time.monotonic() - started) * 1000)
    usage = _usage_from_response(response, duration_ms)
    return _coerce_response(req, parsed, usage)


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
        raise ThemeError("DEEPSEEK_API_KEY missing; cannot run theme")
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
        raise ThemeError(f"theme model response was not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ThemeError(f"theme model response must be an object, got {type(parsed).__name__}")
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


def _coerce_response(
    req: V2ThemeRequest,
    parsed: dict[str, Any],
    usage: Usage,
) -> V2ThemeResponse:
    raw_theme = parsed.get("theme") if isinstance(parsed.get("theme"), dict) else {}
    theme = _coerce_theme(req, raw_theme)
    cover = _coerce_cover(parsed.get("cover"), theme)
    # themeOptions only meaningful while still proposing (no currentTheme); when a
    # theme is already fixed we drop any options the model may have echoed back.
    theme_options = (
        _coerce_theme_options(parsed.get("themeOptions")) if req.currentTheme is None else None
    )
    assistant_reply = _text(parsed.get("assistantReply")) or _default_reply(req.language)
    return V2ThemeResponse(
        theme=theme,
        cover=cover,
        themeOptions=theme_options,
        assistantReply=assistant_reply[:500],
        usage=usage,
    )


def _coerce_theme_options(raw: Any) -> list[V2ThemeOption] | None:
    """Tolerant parse of model `themeOptions`: keep 2-3 well-formed candidates
    (subject + label both present), drop anything malformed. Returns None when
    fewer than 2 usable options survive (the field stays optional/absent)."""
    if not isinstance(raw, list):
        return None
    options: list[V2ThemeOption] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        subject = _text(item.get("subject"))
        label = _text(item.get("label")) or subject
        if not subject:
            continue
        tone = _text(item.get("tone")) or None
        style = item.get("style")
        style = style if isinstance(style, str) and style in _STYLE_IDS else None
        options.append(V2ThemeOption(subject=subject, label=label, tone=tone, style=style))
        if len(options) == 3:
            break
    return options if len(options) >= 2 else None


def _coerce_theme(req: V2ThemeRequest, raw: dict[str, Any]) -> V2Theme:
    current = req.currentTheme
    subject = (
        _text(raw.get("subject"))
        or (current.subject if current else "")
        or _first_cluster_label(req)
    )
    tone = _text(raw.get("tone")) or (current.tone if current else "") or "warm"
    style = _coerce_style(raw.get("style"), current.style if current else None)
    occasion = _text(raw.get("occasion")) or (current.occasion if current else None)
    timeframe = _text(raw.get("timeframe")) or (current.timeframe if current else None)
    return V2Theme(
        subject=subject,
        occasion=occasion,
        timeframe=timeframe,
        tone=tone,
        style=style,
    )


def _coerce_style(value: Any, fallback: V2Style | None) -> V2Style:
    if isinstance(value, str) and value in _STYLE_IDS:
        return value  # type: ignore[return-value]
    if fallback in _STYLE_IDS:
        return fallback
    return "warm-film"


def _first_cluster_label(req: V2ThemeRequest) -> str:
    for cluster in req.clustersOverview:
        label = cluster.label.strip()
        if label:
            return label
    return "Life in photographs" if req.language == "en" else "照片里的时光"


def _coerce_cover(raw: Any, theme: V2Theme) -> V2CoverDraft:
    data = raw if isinstance(raw, dict) else {}
    # V2ThemeRequest carries cluster summaries, not photoIds. Without a truth
    # source to validate a model-supplied heroPhotoId, keep the cover text-only.
    template_id = "mag-20"

    raw_texts = data.get("texts") if isinstance(data.get("texts"), dict) else {}
    texts = _normalize_texts(template_id, raw_texts, theme)
    return V2CoverDraft(templateId=template_id, texts=texts, heroPhotoId=None)


def _normalize_texts(template_id: str, raw_texts: dict[Any, Any], theme: V2Theme) -> dict[str, str]:
    tpl = registry.get(template_id)
    known_slots = set(registry.text_slot_ids(tpl)) if tpl else set()
    texts = {
        str(k): str(v).strip()
        for k, v in raw_texts.items()
        if isinstance(k, str) and str(v).strip() and (not known_slots or k in known_slots)
    }
    if "title" in known_slots and not texts.get("title"):
        texts["title"] = theme.subject
    if "boxText" in known_slots and not texts.get("boxText"):
        texts["boxText"] = theme.tone
    if "plate" in known_slots and not texts.get("plate"):
        texts["plate"] = theme.timeframe or theme.occasion or theme.style
    if not texts:
        texts["title"] = theme.subject
    return layout_rules.clamp_texts_for_template(template_id, texts)


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _default_reply(language: str) -> str:
    if language == "zh":
        return "我先定好了整本相册的主题和封面方向。"
    return "I set a theme and cover direction for the album."
