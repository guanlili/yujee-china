"""V3 chapter-chat turn dispatcher (§4.2, issue #185 / WP2.1).

Option B: this is a NEW V3 module. The v2 service (`chapter_chat.py`) is left
untouched (it is deleted wholesale in #197). V3 chapter authoring is NOT a
pipeline — §4.2(2) makes引导/写/改 a free interleaving of *turns*. Each
`/v3/chapter-chat` call is ONE turn; the Agent dispatches by the user's intent
THIS turn (not a fixed sequence). The chapter-internal "state" is the turn
itself; the across-chapter sequential state (一章一确定 → 解锁导出, §4.2(1)) is
Web's (§8.3 stage 推进权在 Web) — the Agent stays stateless.

Turn kinds (V3ChapterChatKind, mirror of packages/contracts/src/v3.ts):

  * talk  — 引导: AI asks/guides, never auto-writes (Frame 4 红线). No patch.
  * write — 写: collect-then-write — fill EVERY page of this chapter's pagesTexts
            in one shot (§4.2(2)).
  * edit  — 改: rewrite the focused page (§4.2(3)). Pure-text intent → DeepSeek
            rewrites that page's texts (returned as a layoutPatch entry). The
            image/layout升级 path (用户要换图/挪图 → 识图模型出意图 → 确定性
            pick_template/assign_images) is **WP2.3 (#187)**: this module marks a
            clear seam for it and, until then, an image-leaning edit is answered
            with a talk-style reply that asks the user to confirm (never fabricates
            a layout). Pure-text edits work end-to-end today.

One DeepSeek call per turn does BOTH the dispatch (it returns `kind`) and the
turn's content (reply / pagesTexts / page texts). Keeping classification +
authoring in the same call avoids a second round-trip inside the 60s sync budget
and lets the model weigh history + userMessage + focusedPageIndex together. Code
clamps/validates the result against the template slot specs so a drifted model
can never inject illegal slots or overflow maxChars.
"""

from __future__ import annotations

import json
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any

from .. import templates as registry
from ..schemas import (
    Page,
    V3ChapterChatKind,
    V3ChapterChatRequest,
    V3ChapterChatResponse,
    V3LayoutPatchEntry,
    V3Models,
    V3PageTextsPatch,
    V3Usage,
)
from ..settings import get_settings
from . import ai_client, writing_guides

CompleteFn = Callable[..., Awaitable[dict[str, Any]]]

_VALID_KINDS: tuple[str, ...] = ("talk", "write", "edit")
_BRACKET_KEY_RE = re.compile(r"^([A-Za-z0-9_-]+)\[(\d+)\](?:\..*)?$")


class ChapterChatV3Error(Exception):
    """Raised when the chapter-chat model call or JSON response is unusable.

    The route maps this to an HTTP error code (§8.3 同步端点走 HTTP 错误码);
    the front end may retry without polluting stage."""


# ---------- prompt assembly ---------------------------------------------------


def _page_slot_specs_by_index(pages: list[Page]) -> dict[int, list[dict[str, Any]]]:
    """Per-page authored-slot specs (id/role/lang/maxChars[/repeat]).

    Reuses `writing_guides.page_slot_specs` (read-only, shared with v2 — calling it
    cannot break v2). It already drops decoration slots (code auto-fills those) and
    surfaces only the slots the LM must author. The逐槽 `hint` 透传 is WP2.2 (#186);
    this WP wires the turn dispatch and leaves `page_slot_specs` as the seam where
    that hint will flow in."""
    return {page.pageIndex: _page_slot_specs(page) for page in pages}


def _page_slot_specs(page: Page) -> list[dict[str, Any]]:
    """Authored text slots for a concrete page.

    Plain slots stay as declared. Repeat slots are expanded to the bracket keys
    the renderer can address for this page's actual image slots, e.g. a mag-10
    page with ``cells[0].image`` and ``cells[1].image`` exposes ``cells[0]`` and
    ``cells[1]``. When a future template has only V3 ``items.texts`` declarations,
    expose those item keys as ``caption[0]`` etc. using the same image indices.
    """
    tpl = registry.get(page.templateId)
    if not tpl:
        return []

    base_specs = writing_guides.page_slot_specs(page.templateId)
    indices_by_base = _bracket_indices_by_base(page.images.keys())
    all_indices = sorted({idx for indices in indices_by_base.values() for idx in indices})

    specs: list[dict[str, Any]] = []
    expanded_bases: set[str] = set()
    for spec in base_specs:
        slot_id = str(spec["id"])
        if spec.get("repeat") is True:
            indices = indices_by_base.get(slot_id, [])
            if indices:
                expanded_bases.add(slot_id)
                for idx in indices:
                    item_spec = {**spec, "id": f"{slot_id}[{idx}]", "repeatIndex": idx}
                    item_spec.pop("repeat", None)
                    specs.append(item_spec)
                continue
        specs.append(spec)

    # V3 items.texts are addressed as itemId[index]. If the template already has
    # an authored top-level repeat slot (mag-10's legacy `cells`), that path is
    # the renderer-compatible source of truth for this WP; otherwise items.texts
    # become required authored slots for each page item.
    item_texts = tpl.get("items", {}).get("texts", [])
    has_authored_repeat = bool(expanded_bases)
    if all_indices:
        for slot in item_texts:
            if slot["role"] not in writing_guides.AUTHORED_ROLES:
                continue
            if has_authored_repeat:
                continue
            for idx in all_indices:
                specs.append(_slot_spec(slot, slot_id=f"{slot['id']}[{idx}]", repeat_index=idx))
    return specs


def _bracket_indices_by_base(keys: Any) -> dict[str, list[int]]:
    indices: dict[str, set[int]] = {}
    for key in keys:
        if not isinstance(key, str):
            continue
        match = _BRACKET_KEY_RE.fullmatch(key)
        if not match:
            continue
        indices.setdefault(match.group(1), set()).add(int(match.group(2)))
    return {base: sorted(values) for base, values in indices.items()}


def _slot_spec(slot: dict[str, Any], *, slot_id: str, repeat_index: int | None = None) -> dict[str, Any]:
    spec: dict[str, Any] = {
        "id": slot_id,
        "role": slot["role"],
        "lang": slot["lang"],
    }
    if slot.get("maxChars"):
        spec["maxChars"] = slot["maxChars"]
    if slot.get("hint"):
        spec["hint"] = slot["hint"]
    if repeat_index is not None:
        spec["repeatIndex"] = repeat_index
    return spec


def _authored_slot_ids(specs: list[dict[str, Any]]) -> set[str]:
    return {str(spec["id"]) for spec in specs}


def _max_chars_by_slot(specs: list[dict[str, Any]]) -> dict[str, int]:
    out: dict[str, int] = {}
    for spec in specs:
        max_chars = spec.get("maxChars")
        if isinstance(max_chars, int) and max_chars > 0:
            out[str(spec["id"])] = max_chars
    return out


def build_messages(req: V3ChapterChatRequest) -> list[dict[str, str]]:
    """Build the per-turn dispatch+authoring prompt from this chapter slice only.

    Single-chapter scope (§8.3 Web 每次传单章切片): the model never sees another
    chapter or the whole album. The system prompt fixes the STRICT JSON contract
    and the dispatch rule; the user payload carries the chapter tree slice, the
    per-page slot specs, history, the user's message, and the focused page (if any).
    """
    slot_specs = _page_slot_specs_by_index(req.pages)
    focused = req.focusedPageIndex

    system = writing_guides.persona_block() + "\n\n" + (
        "You are helping a user write ONE chapter of a memoir photo album, one "
        "conversational turn at a time. Return STRICT JSON only, matching: "
        '{"kind":"talk|write|edit","assistantReply":string,'
        '"pagesTexts"?:[{"pageIndex":number,"texts":object}],'
        '"pageTexts"?:{"pageIndex":number,"texts":object},'
        '"nameOptions"?:[string]}. '
        "Decide `kind` from THIS turn's intent (the three actions interleave "
        "freely — there is no fixed order):\n"
        "- talk: the user is still telling the story, asking, or unsure. GUIDE "
        "them — ask ONE focused question; NEVER write the chapter unprompted "
        "(this is a hard rule). Return only assistantReply (no texts).\n"
        "- write: the user has given enough and wants the chapter written (or "
        "explicitly asks to write/generate/finish). Fill EVERY page in "
        "`pagesTexts` in one shot using the supplied page slots.\n"
        "- edit: the user points at ONE page and asks to change its wording/tone "
        "(a focused page is supplied). Rewrite ONLY that page into `pageTexts`. "
        "If instead the user wants to change/replace/move a PHOTO, do NOT invent a "
        "layout — set kind=talk and ask them to confirm; an image change is "
        "handled by a separate step.\n"
        "Only use the supplied chapter slice; never output another chapter or the "
        "whole album. Do not mention base64 or hidden image data. "
        "You may also return `nameOptions`: up to 4 short chapter-title candidates, "
        "grounded only in this chapter's photos and the user's words — evocative "
        "but never inventing people, places, events, or dates."
    )
    system += "\n\n" + writing_guides.guides_block()

    payload: dict[str, Any] = {
        "language": req.language,
        "chapter": req.chapter.model_dump(exclude_none=True),
        # Per page: the role/lang/maxChars of each slot the model may write.
        "pageSlots": {str(idx): specs for idx, specs in slot_specs.items()},
        "history": [turn.model_dump() for turn in req.history],
        "userMessage": req.userMessage,
        "focusedPageIndex": focused,
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


# ---------- model call --------------------------------------------------------


async def run(
    req: V3ChapterChatRequest,
    *,
    complete: CompleteFn | None = None,
) -> V3ChapterChatResponse:
    started = time.monotonic()
    messages = build_messages(req)
    response = await _complete(messages, complete=complete, max_tokens=1800, temperature=0.35)
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
        raise ChapterChatV3Error("DEEPSEEK_API_KEY missing; cannot run chapter-chat")
    try:
        return await ai_client.chat_completion(
            base_url=settings.deepseek_base_url,
            api_key=settings.deepseek_api_key,
            model=settings.deepseek_model,
            messages=messages,
            timeout_seconds=settings.deepseek_timeout_seconds,
            response_format=(
                {"type": "json_object"} if settings.deepseek_use_json_object else None
            ),
            max_tokens=max_tokens,
            temperature=temperature,
            extra_body=(
                {"thinking": {"type": "disabled"}} if settings.deepseek_disable_thinking else None
            ),
        )
    except ai_client.AIRequestError as exc:
        raise ChapterChatV3Error(f"chapter-chat model call failed: {exc}") from exc


def _parse_model_json(response: dict[str, Any]) -> dict[str, Any]:
    try:
        parsed = ai_client.parse_json_loose(ai_client.extract_text(response))
    except ValueError as exc:
        raise ChapterChatV3Error(
            f"chapter-chat model response was not valid JSON: {exc}"
        ) from exc
    if not isinstance(parsed, dict):
        raise ChapterChatV3Error(
            f"chapter-chat model response must be an object, got {type(parsed).__name__}"
        )
    return parsed


def _usage_from_response(response: dict[str, Any], duration_ms: int) -> V3Usage:
    settings = get_settings()
    prompt_tokens, completion_tokens = ai_client.extract_usage(response)
    return V3Usage(
        durationMs=duration_ms,
        planningInputTokens=prompt_tokens,
        planningOutputTokens=completion_tokens,
        models=V3Models(planning=settings.deepseek_model),
    )


# ---------- response coercion -------------------------------------------------


def _coerce_response(
    req: V3ChapterChatRequest,
    parsed: dict[str, Any],
    usage: V3Usage,
) -> V3ChapterChatResponse:
    kind = _resolve_kind(req, parsed.get("kind"))
    # Optional V3 response fields are strict-typed lists with an absent-sentinel
    # default — passing None explicitly fails strict validation. Build kwargs and
    # only include a field when it actually has a value.
    name_options = _coerce_name_options(parsed.get("nameOptions"))
    extra: dict[str, Any] = {}
    if name_options is not None:
        extra["nameOptions"] = name_options

    if kind == "write":
        pages_texts = _coerce_pages_texts(req, parsed.get("pagesTexts"))
        if _missing_required_texts(req, pages_texts):
            reply = _default_reply(req.language, "talk")
            return V3ChapterChatResponse(
                kind="talk",
                assistantReply=reply[:500],
                usage=usage,
                **extra,
            )
        reply = _text(parsed.get("assistantReply")) or _default_reply(req.language, "write")
        return V3ChapterChatResponse(
            kind="write",
            assistantReply=reply[:500],
            pagesTexts=pages_texts,
            usage=usage,
            **extra,
        )

    if kind == "edit":
        patch = _coerce_edit_patch(req, parsed.get("pageTexts"))
        if patch is not None:
            reply = _text(parsed.get("assistantReply")) or _default_reply(req.language, "edit")
            return V3ChapterChatResponse(
                kind="edit",
                assistantReply=reply[:500],
                layoutPatch=[patch],
                usage=usage,
                **extra,
            )
        # Model classified edit but produced no usable focused-page texts (or the
        # focus is missing / out of slice). Degrade to a talk turn rather than emit
        # an empty/invalid patch — never fabricate a layout. The image升级 path
        # (WP2.3 #187) owns real photo-change edits.

    # talk — 引导: reply only, never a patch (Frame 4 红线). Also the fallthrough for
    # an edit turn that had nothing to apply.
    reply = _text(parsed.get("assistantReply")) or _default_reply(req.language, "talk")
    return V3ChapterChatResponse(
        kind="talk",
        assistantReply=reply[:500],
        usage=usage,
        **extra,
    )


def _resolve_kind(req: V3ChapterChatRequest, raw: Any) -> V3ChapterChatKind:
    """Trust the model's dispatch when it is one of the three kinds; otherwise fall
    back to a safe default. `edit` is only honored when a focused page is actually
    in this turn's slice — without one there is nothing to edit, so treat it as
    talk (引导). Unknown/missing kind → talk: never auto-write (Frame 4 红线)."""
    kind = raw if isinstance(raw, str) else ""
    if kind == "edit":
        if req.focusedPageIndex is None:
            return "talk"
        if not any(p.pageIndex == req.focusedPageIndex for p in req.pages):
            return "talk"
        return "edit"
    if kind in ("talk", "write"):
        return kind  # type: ignore[return-value]
    return "talk"


def _coerce_pages_texts(
    req: V3ChapterChatRequest, raw: Any
) -> list[V3PageTextsPatch]:
    """Write turn: one V3PageTextsPatch per page in this chapter (§4.2(2) writes the
    WHOLE chapter). Each page keeps only its template's authored slots, each clamped
    to that slot's maxChars. Pages the model omitted come back with an empty texts
    map (the章节故事环节 can refine; we never drop a page or invent slots)."""
    raw_by_index = _raw_texts_by_index(raw)
    slot_specs = _page_slot_specs_by_index(req.pages)
    out: list[V3PageTextsPatch] = []
    for page in req.pages:
        specs = slot_specs.get(page.pageIndex, [])
        texts = _clean_texts(raw_by_index.get(page.pageIndex, {}), specs)
        out.append(V3PageTextsPatch(pageIndex=page.pageIndex, texts=texts))
    return out


def _missing_required_texts(req: V3ChapterChatRequest, pages_texts: list[V3PageTextsPatch]) -> list[str]:
    by_index = {patch.pageIndex: patch.texts for patch in pages_texts}
    missing: list[str] = []
    for page in req.pages:
        specs = _page_slot_specs(page)
        required = {str(spec["id"]) for spec in specs}
        if not required:
            continue
        present = set(by_index.get(page.pageIndex, {}).keys())
        for slot_id in sorted(required - present):
            missing.append(f"{page.pageIndex}:{slot_id}")
    return missing


def _coerce_edit_patch(
    req: V3ChapterChatRequest, raw: Any
) -> V3LayoutPatchEntry | None:
    """Edit turn (pure-text): rewrite ONLY the focused page's texts. Returns a single
    layoutPatch entry carrying the cleaned texts (no templateId/images change — the
    photo/layout升级 is WP2.3). None when there is nothing usable to apply."""
    focused = req.focusedPageIndex
    if focused is None:
        return None
    page = next((p for p in req.pages if p.pageIndex == focused), None)
    if page is None:
        return None
    if not isinstance(raw, dict):
        return None
    raw_texts = raw.get("texts")
    if not isinstance(raw_texts, dict):
        return None
    specs = _page_slot_specs(page)
    texts = _clean_texts(raw_texts, specs)
    if not texts:
        return None
    return V3LayoutPatchEntry(pageIndex=focused, texts=texts)


def _raw_texts_by_index(raw: Any) -> dict[int, dict[str, Any]]:
    by_index: dict[int, dict[str, Any]] = {}
    if not isinstance(raw, list):
        return by_index
    for item in raw:
        if not isinstance(item, dict):
            continue
        try:
            page_index = int(item["pageIndex"])
        except (KeyError, TypeError, ValueError):
            continue
        texts = item.get("texts")
        if isinstance(texts, dict):
            by_index[page_index] = texts
    return by_index


def _clean_texts(
    raw_texts: dict[str, Any], specs: list[dict[str, Any]]
) -> dict[str, str]:
    """Keep only the page's AUTHORED slots, trim, drop empties, clamp to maxChars.

    A drifted model cannot inject a non-existent slot id (kept set = the template's
    authored slots) nor overflow a slot (maxChars clamp), mirroring the v2 grounding
    guardrails without the v2 cluster/grounding machinery."""
    allowed = _authored_slot_ids(specs)
    max_chars = _max_chars_by_slot(specs)
    out: dict[str, str] = {}
    for key, value in raw_texts.items():
        if not isinstance(key, str) or key not in allowed:
            continue
        text = _text(value)
        if not text:
            continue
        cap = max_chars.get(key)
        out[key] = text[:cap] if cap else text
    return out


def _coerce_name_options(raw: Any) -> list[str] | None:
    """Tolerant parse of model `nameOptions`: up to 4 non-empty, de-duped titles.
    Returns None when none survive (the field stays optional)."""
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


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) and value.strip() else ""


def _default_reply(language: str, kind: str) -> str:
    if language == "zh":
        if kind == "write":
            return "这一章的文案我已经写好了。"
        if kind == "edit":
            return "这一页我已经按你的想法改好了。"
        return "再和我说说这一章的故事吧?"
    if kind == "write":
        return "I drafted the copy for this chapter."
    if kind == "edit":
        return "I rewrote this page the way you asked."
    return "Tell me more about the story in this chapter."
