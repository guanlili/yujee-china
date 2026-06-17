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
from . import ai_client, writing_guides
from .grounding import GroundingContext, page_texts, skipped_texts


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
    r"^\s*(?:please\s+)?skip(?:\s+(?:this|the|current))?(?:\s+chapter)?\s*[.!。]?\s*$"
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
    system = writing_guides.persona_block() + "\n\n" + (
        "You are helping write one chapter of a memoir photo album. "
        "Return STRICT JSON only, matching V2ChapterChatResponse: "
        '{"assistantReply":string,"chapterBrief"?:{"userWords"?:string,'
        '"factNote"?:string,"mood"?:string},"state":"empty|asking|brief_ready|'
        'generated|skipped|finalized","pagesTexts"?:[{"pageIndex":number,'
        '"texts":object}],"nameOptions"?:[string]}. '
        "Only use the supplied chapter slice; never output another chapter or "
        "the whole album. Do not mention base64 or hidden image data. "
        "You may also return `nameOptions`: up to 4 short chapter-title "
        "candidates (editor.html chipName1-4) grounded only in this chapter's "
        "photo analysis and the user's words — evocative but never inventing "
        "people, places, events, or dates. "
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

    # The core of authoring: tell the model how to write each slot by its role.
    system += "\n\n" + writing_guides.guides_block()

    payload = {
        "language": req.language,
        "theme": req.theme.model_dump(exclude_none=True) if req.theme else None,
        "chapter": req.chapter.model_dump(exclude_none=True),
        # Per page, the role/lang/maxChars of each slot the model must write.
        "pageSlots": {
            str(page.pageIndex): writing_guides.page_slot_specs(page.templateId)
            for page in req.chapter.pages
        },
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
    name_options = _coerce_name_options(parsed.get("nameOptions"))
    if mode == "generated_passthrough":
        state: V2ChapterState = req.chapter.state
        reply = _text(parsed.get("assistantReply")) or _default_reply(req.language, state)
        return V2ChapterChatResponse(
            assistantReply=reply[:500],
            chapterBrief=brief,
            state=state,
            nameOptions=name_options,
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
            nameOptions=name_options,
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
        nameOptions=name_options,
        usage=usage,
    )


def _coerce_name_options(raw: Any) -> list[str] | None:
    """Tolerant parse of model `nameOptions`: keep up to 4 non-empty, de-duped
    title strings. Returns None when none survive (the field stays optional)."""
    if not isinstance(raw, list):
        return None
    seen: set[str] = set()
    names: list[str] = []
    for item in raw:
        name = _text(item)
        if not name or name in seen:
            continue
        seen.add(name)
        names.append(name[:120])
        if len(names) == 4:
            break
    return names or None


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
    if state == "skipped":
        return "skipped_generate"
    if state in ("empty", "asking"):
        if _skip_requested(req.userMessage):
            return "skipped_generate"
        return "ask"
    raise ChapterChatError(f"unsupported chapter state: {state}")


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
        lowered.strip(" .!。").startswith(marker) for marker in _SKIP_MARKERS
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


def _grounding_context(req: V2ChapterChatRequest) -> GroundingContext:
    """Build the shared grounding context from this chapter slice (cluster
    place/timeRange + the chapter's own photos)."""
    return GroundingContext(
        language=req.language,
        place=req.chapter.cluster.place.strip()
        if isinstance(req.chapter.cluster.place, str) and req.chapter.cluster.place.strip()
        else "",
        time_range=req.chapter.cluster.timeRange.strip()
        if isinstance(req.chapter.cluster.timeRange, str)
        and req.chapter.cluster.timeRange.strip()
        else "",
        photos_by_id={p.photoId: p for p in req.chapter.photos},
    )


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

    ctx = _grounding_context(req)
    out: list[V2PageTexts] = []
    for page in req.chapter.pages:
        if skipped:
            texts = skipped_texts(page, ctx)
        else:
            texts = page_texts(page, raw_by_index.get(page.pageIndex, {}), ctx)
        out.append(V2PageTexts(pageIndex=page.pageIndex, texts=texts))
    return out


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
