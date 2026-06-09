"""Stage 4 chapter-chat service for Agent v2.

The module is intentionally scoped to pure chapter authoring work: build a
single-chapter prompt, call an injected OpenAI-compatible completion function
(or the shared DeepSeek helper), normalize the state transition, and return
only this chapter's text patches. No endpoints, DB, or draft persistence live
here.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any

from .. import templates as registry
from ..schemas import Page
from ..schemas_v2 import (
    Usage,
    V2Brief,
    V2ChapterChatRequest,
    V2ChapterChatResponse,
    V2ChapterState,
    V2Models,
    V2PageTexts,
)
from ..settings import get_settings
from . import ai_client, layout_rules


CompleteFn = Callable[..., Awaitable[dict[str, Any]]]

_AUTO_ADVANCE_AFTER = 2
_SKIP_MARKERS = (
    "generate remaining",
    "directly generate",
    "finish the book",
    "finish this chapter",
    "直接生成",
    "生成剩余",
    "直接完成",
    "跳过",
)
_NEGATED_SKIP_RE = re.compile(
    r"\b(?:do\s+not|don't|dont|not|never)\s+(?:skip|generate|finish)\b"
    r"|\bshould\s+(?:we|i)\s+skip\b"
    r"|不要跳过|别跳过|不跳过"
)
_EXPLICIT_SKIP_RE = re.compile(
    r"\bskip(?:\s+(?:this|the|current))?(?:\s+chapter)?\b"
)
class ChapterChatError(Exception):
    """Raised when the chapter-chat model call or JSON response is unusable."""


def build_messages(
    req: V2ChapterChatRequest,
    *,
    ask_count: int,
    auto_advance_after: int = _AUTO_ADVANCE_AFTER,
) -> list[dict[str, str]]:
    """Build a scoped prompt containing only this chapter slice."""

    mode = _mode(req, ask_count=ask_count, auto_advance_after=auto_advance_after)
    system = (
        "You are helping write one chapter of a memoir photo album. "
        "Return STRICT JSON only, matching V2ChapterChatResponse: "
        '{"assistantReply":string,"chapterBrief"?:{"userWords"?:string,'
        '"factNote"?:string,"mood"?:string},"state":"empty|asking|brief_ready|'
        'generated|skipped|finalized","pagesTexts"?:[{"pageIndex":number,'
        '"texts":object}]}. '
        "Only use the supplied chapter slice; never output another chapter or "
        "the whole album. Do not mention base64 or hidden image data. "
        f"Current mode: {mode}. "
        f"askCount will be {ask_count + 1}; at {auto_advance_after} you must "
        "stop asking and move forward."
    )
    if mode == "skipped_generate":
        system += (
            " For skipped chapters, use only visible photo analysis and allowed "
            "EXIF/user facts. Do not invent concrete people, places, events, "
            "relationships, or dates."
        )

    payload = {
        "language": req.language,
        "theme": req.theme.model_dump(exclude_none=True) if req.theme else None,
        "chapter": req.chapter.model_dump(exclude_none=True),
        "history": [h.model_dump() for h in req.history],
        "userMessage": req.userMessage,
        "askCount": ask_count,
        "nextAskCount": ask_count + 1,
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


async def run(
    req: V2ChapterChatRequest,
    *,
    ask_count: int,
    complete: CompleteFn | None = None,
    auto_advance_after: int = _AUTO_ADVANCE_AFTER,
) -> V2ChapterChatResponse:
    started = time.monotonic()
    messages = build_messages(req, ask_count=ask_count, auto_advance_after=auto_advance_after)
    response = await _complete(messages, complete=complete, max_tokens=1800, temperature=0.35)
    parsed = _parse_model_json(response)
    duration_ms = int((time.monotonic() - started) * 1000)
    usage = _usage_from_response(response, duration_ms)
    return _coerce_response(
        req,
        parsed,
        usage,
        ask_count=ask_count,
        auto_advance_after=auto_advance_after,
    )


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
        raise ChapterChatError("DEEPSEEK_API_KEY missing; cannot run chapter-chat")
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
        raise ChapterChatError(f"chapter-chat model response was not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ChapterChatError(
            f"chapter-chat model response must be an object, got {type(parsed).__name__}"
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


def _coerce_response(
    req: V2ChapterChatRequest,
    parsed: dict[str, Any],
    usage: Usage,
    *,
    ask_count: int,
    auto_advance_after: int,
) -> V2ChapterChatResponse:
    mode = _mode(req, ask_count=ask_count, auto_advance_after=auto_advance_after)
    brief = _coerce_brief(req.chapter.brief, parsed.get("chapterBrief"))
    if mode == "generated_passthrough":
        state: V2ChapterState = req.chapter.state
        reply = _text(parsed.get("assistantReply")) or _default_reply(req.language, state)
        return V2ChapterChatResponse(
            assistantReply=reply[:500],
            chapterBrief=brief,
            state=state,
            usage=usage,
        )

    if mode == "ask":
        model_state = parsed.get("state")
        state = (
            "brief_ready"
            if model_state == "brief_ready"
            else _dialog_state_after_turn(req.chapter.state, ask_count, auto_advance_after)
        )
        reply = _text(parsed.get("assistantReply")) or _default_reply(req.language, state)
        if state == "brief_ready" and _looks_like_more_questions(reply):
            reply = _default_reply(req.language, state)
        return V2ChapterChatResponse(
            assistantReply=reply[:500],
            chapterBrief=brief,
            state=state,
            usage=usage,
        )

    skipped = mode == "skipped_generate"
    pages_texts = _coerce_pages_texts(req, parsed.get("pagesTexts"), skipped=skipped)
    reply = _text(parsed.get("assistantReply")) or _default_reply(req.language, "generated")
    return V2ChapterChatResponse(
        assistantReply=reply[:500],
        chapterBrief=brief,
        state="generated",
        pagesTexts=pages_texts,
        usage=usage,
    )


def _mode(
    req: V2ChapterChatRequest,
    *,
    ask_count: int,
    auto_advance_after: int,
) -> str:
    state = req.chapter.state
    if state in ("generated", "finalized"):
        return "generated_passthrough"
    if state == "brief_ready":
        return "brief_generate"
    if state == "skipped" or _skip_requested(req.userMessage):
        return "skipped_generate"
    if state in ("empty", "asking"):
        return "ask"
    return "ask" if ask_count + 1 < auto_advance_after else "brief_generate"


def _dialog_state_after_turn(
    current_state: V2ChapterState,
    ask_count: int,
    auto_advance_after: int,
) -> V2ChapterState:
    if current_state == "empty" and ask_count + 1 < auto_advance_after:
        return "asking"
    if ask_count + 1 >= auto_advance_after:
        return "brief_ready"
    return "asking"


def _skip_requested(message: str) -> bool:
    lowered = message.lower()
    if _NEGATED_SKIP_RE.search(lowered):
        return False
    if "skip" in lowered and "?" in lowered:
        return False
    return bool(_EXPLICIT_SKIP_RE.search(lowered)) or any(
        marker in lowered for marker in _SKIP_MARKERS
    )


def _coerce_brief(existing: V2Brief | None, raw: Any) -> V2Brief | None:
    if not isinstance(raw, dict):
        return existing
    data = existing.model_dump(exclude_none=True) if existing else {}
    for key in ("userWords", "factNote", "mood"):
        value = _text(raw.get(key))
        if value:
            data[key] = value
    return V2Brief(**data) if data else None


def _coerce_pages_texts(
    req: V2ChapterChatRequest,
    raw: Any,
    *,
    skipped: bool,
) -> list[V2PageTexts]:
    by_index = {p.pageIndex: p for p in req.chapter.pages}
    raw_by_index: dict[int, dict[str, str]] = {}
    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            try:
                page_index = int(item["pageIndex"])
            except (KeyError, TypeError, ValueError):
                continue
            texts = item.get("texts")
            if isinstance(texts, dict) and page_index in by_index:
                raw_by_index[page_index] = {
                    str(k): str(v).strip()
                    for k, v in texts.items()
                    if isinstance(k, str) and str(v).strip()
                }

    allowed_sources = _allowed_sources(req)
    out: list[V2PageTexts] = []
    for page in req.chapter.pages:
        if skipped:
            texts = _skipped_texts(page, req, allowed_sources)
        else:
            texts = _normalize_page_texts(page, raw_by_index.get(page.pageIndex, {}), req)
        out.append(V2PageTexts(pageIndex=page.pageIndex, texts=texts))
    return out


def _normalize_page_texts(
    page: Page,
    raw_texts: dict[str, str],
    req: V2ChapterChatRequest,
) -> dict[str, str]:
    tpl = registry.get(page.templateId)
    text_slots = (tpl or {}).get("textSlots", {})
    allowed_slots = {slot for slot, meta in text_slots.items() if meta.get("type") != "meta"}
    texts = {
        slot: value
        for slot, value in raw_texts.items()
        if not allowed_slots or slot in allowed_slots
    }
    missing_slots = [slot for slot in allowed_slots if slot not in texts]
    if missing_slots:
        fallback = _fallback_texts(page, req)
        for slot in missing_slots:
            if slot in fallback:
                texts[slot] = fallback[slot]
    if not texts:
        texts = _fallback_texts(page, req)
    return layout_rules.clamp_texts_for_template(page.templateId, texts)


def _fallback_texts(page: Page, req: V2ChapterChatRequest) -> dict[str, str]:
    tpl = registry.get(page.templateId)
    text_slots = (tpl or {}).get("textSlots", {})
    photo_text = _page_photo_summary(page, req)
    texts: dict[str, str] = {}
    for slot, meta in text_slots.items():
        if meta.get("type") == "meta":
            continue
        slot_type = meta.get("type")
        if slot_type == "heading":
            texts[slot] = "quiet moments" if req.language == "en" else "安静片刻"
        elif slot_type == "array":
            texts[slot] = (
                "soft light, small details, quiet atmosphere"
                if req.language == "en"
                else "柔和光线、细节、安静氛围"
            )
        elif slot_type in ("caption", "label", "quote"):
            texts[slot] = "from the visible scene" if req.language == "en" else "来自照片里的画面"
        else:
            texts[slot] = photo_text
    if not texts:
        texts["body"] = photo_text
    return layout_rules.clamp_texts_for_template(page.templateId, texts)


def _skipped_texts(
    page: Page,
    req: V2ChapterChatRequest,
    allowed_sources: str,
) -> dict[str, str]:
    tpl = registry.get(page.templateId)
    text_slots = (tpl or {}).get("textSlots", {})
    place = _allowed_phrase(req.chapter.cluster.place, allowed_sources)
    time_range = _allowed_phrase(req.chapter.cluster.timeRange, allowed_sources)
    photo_summary = _page_photo_summary(page, req)
    heading = (
        _join_nonempty(place, "atmosphere")
        if req.language == "en" and place
        else _join_nonempty(place, "的氛围")
        if req.language == "zh" and place
        else ("quiet moments" if req.language == "en" else "安静片刻")
    )
    detail = _join_nonempty(place, time_range, photo_summary)
    if not detail:
        detail = photo_summary

    texts: dict[str, str] = {}
    for slot, meta in text_slots.items():
        if meta.get("type") == "meta":
            continue
        slot_type = meta.get("type")
        if slot_type == "heading":
            texts[slot] = heading
        elif slot_type == "array":
            texts[slot] = (
                _join_nonempty(place, time_range, "soft light, quiet details")
                if req.language == "en"
                else _join_nonempty(place, time_range, "柔和光线、安静细节")
            )
        elif slot_type in ("caption", "label", "quote"):
            texts[slot] = (
                _join_nonempty(place, time_range) or "visible details"
                if req.language == "en"
                else _join_nonempty(place, time_range) or "照片细节"
            )
        else:
            texts[slot] = detail
    if not texts:
        texts["body"] = detail
    return layout_rules.clamp_texts_for_template(page.templateId, texts)


def _page_photo_summary(page: Page, req: V2ChapterChatRequest) -> str:
    photo_by_id = {p.photoId: p for p in req.chapter.photos}
    photos = [photo_by_id[pid] for pid in page.images.values() if pid in photo_by_id]
    if not photos:
        return (
            "A quiet pause between the surrounding photographs."
            if req.language == "en"
            else "这一页留住相邻照片之间的安静停顿。"
        )
    moods = sorted({p.mood for p in photos if p.mood})
    scenes = sorted({p.scene for p in photos if p.scene})
    if req.language == "zh":
        return "照片里有柔和的光线、动作和细节。"
    parts = [moods[0] if moods else "quiet", scenes[0] if scenes else "scene"]
    return f"A {parts[0]} {parts[1]} page shaped by light, texture, and small gestures."


def _allowed_sources(req: V2ChapterChatRequest) -> str:
    parts: list[str] = [req.userMessage]
    parts.extend(turn.content for turn in req.history if turn.role == "user")
    cluster = req.chapter.cluster
    parts.extend(v for v in (cluster.place, cluster.timeRange) if v)
    return "\n".join(parts).lower()


def _allowed_phrase(value: str | None, allowed_sources: str) -> str:
    text = value.strip() if isinstance(value, str) else ""
    return text if text and text.lower() in allowed_sources else ""


def _join_nonempty(*parts: str) -> str:
    return " ".join(part for part in parts if part)


def _looks_like_more_questions(reply: str) -> bool:
    lowered = reply.lower()
    return "?" in reply or "再" in reply and "问" in reply or "one more" in lowered


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _default_reply(language: str, state: str) -> str:
    if language == "zh":
        if state == "asking":
            return "这一章还有一个细节想确认。"
        if state == "brief_ready":
            return "信息已经足够，我会继续生成这一章的文案。"
        return "这一章的文案已经生成。"
    if state == "asking":
        return "I have one detail to confirm for this chapter."
    if state == "brief_ready":
        return "I have enough to write this chapter."
    return "I drafted this chapter."
