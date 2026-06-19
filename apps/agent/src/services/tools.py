"""Extensible tool registry for the draft-period editor (#162).

The editor used to mix "对话"(assistantReply) and "改文案"(pagesTexts) in one
blob, which read badly. #162 separates talk from act with a **tool layer**: the
dialog model (火山 Ark doubao) is offered OpenAI function-calling tools; it calls
a tool ONLY to change a page's words, and otherwise just talks. The draft-edit
service maps a tool_call → a typed page write, and no tool_call → a talk turn.

This module is the registry + the only currently-live tool, `write_page_copy`.
Future style/palette/image tools register here too (reserved + disabled below)
so they plug into the same dispatch without touching the service.

Guardrails (issue #162):
  * G1 — the tool DESCRIPTION text itself tells the model to call it ONLY to
    change a page's words, never for questions/opinions/greetings or when the
    user says not to change anything, and never with placeholder/dummy text.
  * G3 — defense in depth: `dispatch` validates the args server-side and DEMOTES
    a degenerate call (empty slots, or placeholder text like "Dummy Title" /
    "标题" / echoing the slot name) to a talk turn by returning None. The clamp to
    the page's real template slots reuses `layout_rules.clamp_texts_for_template`
    (the same call chapter-chat uses), and non-authored (decoration) slots are
    filtered out, so an act turn can only ever touch legitimate authored slots.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field, ValidationError

from .. import templates as registry
from . import ai_client, layout_rules
from ..schemas import _Strict


# --------------------------------------------------------------------------- #
# tool spec + registry                                                         #
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class ToolResult:
    """A successful act-tool outcome the service folds into its response. Today
    only `write_page_copy` produces one; the typed payload is generic so future
    tools (style/palette/image) can return their own shapes."""

    tool: str
    payload: dict[str, Any]


# handler signature: (validated_args, *, ctx) -> ToolResult | None
ToolHandler = Callable[..., "ToolResult | None"]


@dataclass(frozen=True)
class ToolSpec:
    """One registered tool. `json_schema` is the full OpenAI tool definition
    ({type:'function', function:{name,description,parameters}}). `enabled=False`
    tools are registered (so the shape exists and tests can assert they are NOT
    offered) but never sent to the model and never dispatched."""

    name: str
    description: str
    json_schema: dict[str, Any]
    handler: ToolHandler
    enabled: bool = True


# --------------------------------------------------------------------------- #
# write_page_copy — the only live tool                                          #
# --------------------------------------------------------------------------- #


# G1: this description is sent verbatim to the model. It is the FIRST line of
# defense — it must spell out exactly when (and when NOT) to call.
_WRITE_PAGE_COPY_DESCRIPTION = (
    "Apply new copy to a single page of the album. Call this ONLY when the user "
    "asks you to change the words on a page (rewrite, shorten, fix a title, add a "
    "caption, etc.). Do NOT call it for questions, opinions, greetings, or "
    "small talk, and do NOT call it when the user says not to change anything or "
    "is only asking what you think. Never call it with placeholder or dummy text "
    "(e.g. \"Dummy Title\", \"标题\", or the slot name itself); write the real, "
    "final copy the user wants, in the reader's language."
)


def _write_page_copy_schema() -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "write_page_copy",
            "description": _WRITE_PAGE_COPY_DESCRIPTION,
            "parameters": {
                "type": "object",
                "properties": {
                    "pageIndex": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "The pageIndex of the page to rewrite.",
                    },
                    "slots": {
                        "type": "object",
                        "description": (
                            "Map of text slot id -> new copy for that slot. Only "
                            "include slots you are actually changing; omit the rest."
                        ),
                        "additionalProperties": {"type": "string"},
                    },
                },
                "required": ["pageIndex", "slots"],
            },
        },
    }


class WritePageCopyArgs(_Strict):
    """Pydantic mirror of the write_page_copy tool args (strict — reject unknown
    keys, matching the tool's JSON schema)."""

    pageIndex: int = Field(ge=0)
    slots: dict[str, str] = Field(default_factory=dict)


@dataclass(frozen=True)
class WritePageCopyContext:
    """What the handler needs to clamp a write to the page being edited: the
    page's templateId + pageIndex. The service builds this from the request page
    so the model can never write to a different page or invent slots."""

    page_index: int
    template_id: str


# Placeholder/dummy detection (G3). A call is degenerate when, after dropping
# slots whose value is empty/placeholder, nothing real is left to write.
_PLACEHOLDER_VALUES = {
    "dummy title",
    "dummy text",
    "placeholder",
    "title",
    "heading",
    "body",
    "text",
    "caption",
    "标题",
    "正文",
    "副标题",
    "占位",
    "占位符",
    "示例",
    "示例文本",
}


def _is_placeholder(slot: str, value: str) -> bool:
    """True if `value` is empty, a known placeholder phrase, or just echoes the
    slot name/role (the model's "I have nothing real to write" tells)."""
    norm = value.strip().lower()
    if not norm:
        return True
    if norm in _PLACEHOLDER_VALUES:
        return True
    # Echoing the slot key (e.g. slot "title" -> value "Title") is a dummy tell.
    if norm == slot.strip().lower():
        return True
    # "<slot> ..." placeholder like "Title here" / "body placeholder".
    if re.fullmatch(rf"{re.escape(slot.strip().lower())}\s*(here|placeholder|文字|内容)?", norm):
        return True
    return False


def _authored_slot_ids(template_id: str) -> set[str] | None:
    """Slots the model may write: every NON-decoration text slot on the template.
    Decoration slots (dates/numbers/labels) are auto-filled, never model-written —
    same allowed-set chapter-chat's `grounding.page_texts` derives.

    Returns None when the template is UNKNOWN (registry miss) — distinct from a
    known template that simply has no authored slots (empty set). The handler
    treats None as "no authored slots at all → write nothing" (defense in depth),
    instead of letting model-invented slots pass through unfiltered."""
    tpl = registry.get(template_id)
    if not tpl:
        return None
    return {
        meta["id"]
        for meta in tpl.get("texts", [])
        if meta.get("role") != "decoration"
    }


def _handle_write_page_copy(
    args: WritePageCopyArgs, *, ctx: WritePageCopyContext
) -> ToolResult | None:
    """Apply copy to ONE page. Steps (in order):
      1. drop empty/placeholder slots (G3 — degenerate-arg detection);
      2. filter to the page's authored (non-decoration) template slots;
      3. clamp to each slot's maxChars via the shared clamp helper;
    Returns a ToolResult, or None when nothing real survives → demote to talk."""
    allowed = _authored_slot_ids(ctx.template_id)
    # Unknown/None template (registry miss): there is no authored-slot allow-list to
    # enforce, so do NOT pass model-invented slots through unfiltered. Demote to talk
    # (write nothing), consistent with degenerate-arg handling (G3, defense in depth).
    if allowed is None:
        return None
    real: dict[str, str] = {}
    for slot, value in args.slots.items():
        if _is_placeholder(slot, value):
            continue
        # Only authored slots on THIS page's template.
        if slot not in allowed:
            continue
        real[slot] = value.strip()

    if not real:
        return None  # degenerate / off-page / all-placeholder → talk (G3)

    clamped = layout_rules.clamp_texts_for_template(ctx.template_id, real)
    # Clamp can in theory empty a slot if maxChars==0; drop any that went blank.
    clamped = {slot: text for slot, text in clamped.items() if text.strip()}
    if not clamped:
        return None

    # The page is always the one the user is editing — the model's pageIndex arg
    # is advisory; we pin the write to ctx.page_index so it can never spill onto
    # another page (invariant 12: this turn only ever sees/edits one page).
    return ToolResult(
        tool="write_page_copy",
        payload={"pageIndex": ctx.page_index, "texts": clamped},
    )


# --------------------------------------------------------------------------- #
# inspect_page_render — diagnose a mis-positioned photo (#165 Phase 2)          #
# --------------------------------------------------------------------------- #
#
# A diagnosis-only tool: the model calls it when the user complains a photo is
# cropped/mis-positioned and the model needs to SEE the rendered page to decide.
# It produces no edit; the draft-edit service maps the (page-pinned) sentinel to
# a NEW response kind "inspect", which Phase 3's browser turns into a screenshot
# round-trip (rendered-page screenshot → diagnosis → follow-up adjust).


_INSPECT_PAGE_RENDER_DESCRIPTION = (
    "Call this ONLY when the user complains a photo is mis-positioned/cropped/a "
    "face or subject is cut off and you need to SEE the page to diagnose. Do NOT "
    "call it for text/copy edits or general chat."
)


def _inspect_page_render_schema() -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "inspect_page_render",
            "description": _INSPECT_PAGE_RENDER_DESCRIPTION,
            "parameters": {
                "type": "object",
                "properties": {
                    "pageIndex": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "The pageIndex of the page to inspect.",
                    }
                },
                "required": ["pageIndex"],
            },
        },
    }


class InspectPageRenderArgs(_Strict):
    """Pydantic mirror of inspect_page_render args (strict)."""

    pageIndex: int = Field(ge=0)


def _handle_inspect_page_render(
    args: InspectPageRenderArgs, *, ctx: Any
) -> ToolResult | None:
    """Return a sentinel pinned to ctx.page_index (the model's arg is advisory —
    same pin as write_page_copy: this turn only ever sees/edits one page,
    invariant 12). The service maps this to kind="inspect"."""
    return ToolResult(
        tool="inspect_page_render",
        payload={"pageIndex": ctx.page_index},
    )


# --------------------------------------------------------------------------- #
# adjust_image_position — move/zoom a photo within its frame (#165 Phase 2)     #
# --------------------------------------------------------------------------- #
#
# Called after a crop is diagnosed to reposition a photo inside its slot. The
# payload field names (x/y/scale) match the Phase-1 ImagePos shape the render
# layer + imagePosJson consume. #169: args are now ABSOLUTE object-position
# (x/y ∈ [0,100]) — the model picks where the subject should land, NOT a relative
# nudge from 50/50. The write is pinned to the page's real image-slot set so it
# can never touch an off-page / invented slot.


_ADJUST_IMAGE_POSITION_DESCRIPTION = (
    "Call ONLY to reposition/zoom a photo within its frame after diagnosing a "
    "crop. x/y are the ABSOLUTE object-position the subject should sit at: x in "
    "[0,100] (0 = pin LEFT edge, 50 = centered, 100 = pin RIGHT edge), y in "
    "[0,100] (0 = pin TOP, 50 = centered, 100 = pin BOTTOM); scale 1.0–2.0 zooms. "
    "Never call with the centered no-op {x:50,y:50,scale:1}."
)


def _adjust_image_position_schema() -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "adjust_image_position",
            "description": _ADJUST_IMAGE_POSITION_DESCRIPTION,
            "parameters": {
                "type": "object",
                "properties": {
                    "pageIndex": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "The pageIndex of the page being adjusted.",
                    },
                    "imageId": {
                        "type": "string",
                        "description": (
                            "The image slot id to move (must be a real slot on this "
                            "page, e.g. \"image\" / \"imageTop\" / \"cells[0].image\")."
                        ),
                    },
                    "x": {
                        "type": "number",
                        "description": (
                            "Absolute horizontal object-position in [0,100]: 0 pins "
                            "the LEFT edge, 50 centers, 100 pins the RIGHT edge."
                        ),
                    },
                    "y": {
                        "type": "number",
                        "description": (
                            "Absolute vertical object-position in [0,100]: 0 pins the "
                            "TOP, 50 centers, 100 pins the BOTTOM."
                        ),
                    },
                    "scale": {
                        "type": "number",
                        "description": "Zoom factor 1.0–2.0 (1.0 = no zoom).",
                    },
                },
                "required": ["pageIndex", "imageId", "x", "y", "scale"],
            },
        },
    }


class AdjustImagePositionArgs(_Strict):
    """Pydantic mirror of adjust_image_position args (strict). #169: absolute
    target x/y (not relative dx/dy)."""

    pageIndex: int = Field(ge=0)
    imageId: str
    x: float
    y: float
    scale: float


@dataclass(frozen=True)
class AdjustImagePositionContext:
    """What the handler needs to pin an adjust to the page being edited: the
    page's pageIndex + the set of image slotIds that actually exist on it. The
    service builds `image_slots` from `req.page.images` so the model can never
    move an off-page / invented slot (G3)."""

    page_index: int
    image_slots: frozenset[str]


@dataclass(frozen=True)
class DraftEditContext:
    """The single ctx the draft-edit service passes to `dispatch` — it carries
    everything ALL of the draft-period tools need (page_index + template_id for
    write_page_copy, image_slots for adjust_image_position, page_index alone for
    inspect_page_render). One object so dispatch stays tool-agnostic; each handler
    reads only the attributes it needs."""

    page_index: int
    template_id: str
    image_slots: frozenset[str]


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _handle_adjust_image_position(
    args: AdjustImagePositionArgs, *, ctx: AdjustImagePositionContext
) -> ToolResult | None:
    """Map absolute x/y/scale → an ImagePos {x,y,scale} for ONE real slot (#169).

    Demotes to None (→ talk, G3) when the slot is off-page/invented, or the call
    is effectively a no-op. Clamps x,y∈[0,100], scale∈[1,2] FIRST, and only THEN
    tests for a no-op: a centered target {x:50,y:50} with a sub-range scale (e.g.
    0.5) clamps up to {50,50,1.0} and must demote, not emit an inert act (#165
    Phase-3 D2)."""
    # Off-page / invented slot → never write to it (G3).
    if args.imageId not in ctx.image_slots:
        return None

    x = _clamp(args.x, 0.0, 100.0)
    y = _clamp(args.y, 0.0, 100.0)
    scale = _clamp(args.scale, 1.0, 2.0)

    # No-op AFTER clamping → nothing actually changes from the 50/50/1.0 default,
    # so demote to talk (G1 says never call it; G3 enforces). Checking pre-clamp
    # would let a sub-range scale (0.5) sneak past and emit an inert {50,50,1.0}.
    if x == 50.0 and y == 50.0 and scale == 1.0:
        return None

    return ToolResult(
        tool="adjust_image_position",
        payload={
            "pageIndex": ctx.page_index,  # pinned (invariant 12)
            "imageId": args.imageId,
            "x": x,
            "y": y,
            "scale": scale,
        },
    )


# --------------------------------------------------------------------------- #
# reserved tools — registered but DISABLED (definitions only)                  #
# --------------------------------------------------------------------------- #


def _not_implemented(*_args: Any, **_kwargs: Any) -> ToolResult | None:
    raise NotImplementedError("reserved tool is not enabled")


def _reserved_schema(name: str, description: str, parameters: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {"name": name, "description": description, "parameters": parameters},
    }


_SET_STYLE_SCHEMA = _reserved_schema(
    "set_style",
    "Reserved: change typography (font/size/color) for a scope. Not yet enabled.",
    {
        "type": "object",
        "properties": {
            "scope": {"type": "string"},
            "style": {
                "type": "object",
                "properties": {
                    "font": {"type": "string"},
                    "size": {"type": "string"},
                    "color": {"type": "string"},
                },
            },
        },
        "required": ["scope", "style"],
    },
)

_SET_PALETTE_SCHEMA = _reserved_schema(
    "set_palette",
    "Reserved: change the color palette for a scope. Not yet enabled.",
    {
        "type": "object",
        "properties": {"scope": {"type": "string"}, "palette": {"type": "object"}},
        "required": ["scope", "palette"],
    },
)

# NOTE (#165 Phase 2): the reserved `image_treatment` stub from #162 is SUPERSEDED
# by the live `adjust_image_position` tool below (which moves/zooms a photo within
# its frame via the Phase-1 ImagePos contract) and removed. Crop/filter/frame
# treatments, if ever needed, get their own tool then.


# --------------------------------------------------------------------------- #
# registry                                                                      #
# --------------------------------------------------------------------------- #


TOOL_REGISTRY: dict[str, ToolSpec] = {
    "write_page_copy": ToolSpec(
        name="write_page_copy",
        description=_WRITE_PAGE_COPY_DESCRIPTION,
        json_schema=_write_page_copy_schema(),
        handler=_handle_write_page_copy,
        enabled=True,
    ),
    # #165 Phase 2 — diagnose a mis-positioned photo, then move/zoom it. Both live.
    "inspect_page_render": ToolSpec(
        name="inspect_page_render",
        description=_INSPECT_PAGE_RENDER_DESCRIPTION,
        json_schema=_inspect_page_render_schema(),
        handler=_handle_inspect_page_render,
        enabled=True,
    ),
    "adjust_image_position": ToolSpec(
        name="adjust_image_position",
        description=_ADJUST_IMAGE_POSITION_DESCRIPTION,
        json_schema=_adjust_image_position_schema(),
        handler=_handle_adjust_image_position,
        enabled=True,
    ),
    # Reserved — registered for shape parity / future plug-in, never offered to
    # the model and never dispatched (enabled=False).
    "set_style": ToolSpec(
        name="set_style",
        description="Reserved typography tool.",
        json_schema=_SET_STYLE_SCHEMA,
        handler=_not_implemented,
        enabled=False,
    ),
    "set_palette": ToolSpec(
        name="set_palette",
        description="Reserved palette tool.",
        json_schema=_SET_PALETTE_SCHEMA,
        handler=_not_implemented,
        enabled=False,
    ),
}


def tools_for_prompt() -> list[dict[str, Any]]:
    """The OpenAI `tools=[...]` array — ENABLED tools only. Disabled/reserved
    tools are never shown to the model."""
    return [spec.json_schema for spec in TOOL_REGISTRY.values() if spec.enabled]


# Arg validators per tool (the pydantic mirror of each tool's parameters).
_ARG_MODELS: dict[str, type[BaseModel]] = {
    "write_page_copy": WritePageCopyArgs,
    "inspect_page_render": InspectPageRenderArgs,
    "adjust_image_position": AdjustImagePositionArgs,
}


def _parse_arguments(raw: Any) -> dict[str, Any] | None:
    """A tool_call's `function.arguments` is a JSON STRING; parse it loosely
    (the same escape hatch the JSON-content path uses). Returns None if it isn't
    a JSON object."""
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        parsed = ai_client.parse_json_loose(raw)
    except ValueError:
        try:
            parsed = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return None
    return parsed if isinstance(parsed, dict) else None


def dispatch(tool_call: dict[str, Any], *, ctx: Any) -> ToolResult | None:
    """Look up the tool named in `tool_call`, validate its args, run its handler.

    Returns None — meaning "treat this turn as talk, write nothing" (G3) — when:
      * the tool name is unknown or disabled;
      * the arguments aren't a JSON object or fail pydantic validation;
      * the handler demotes (degenerate/placeholder/off-page args).
    Only a non-None ToolResult is an act turn."""
    function = tool_call.get("function") if isinstance(tool_call, dict) else None
    if not isinstance(function, dict):
        return None
    name = function.get("name")
    spec = TOOL_REGISTRY.get(name) if isinstance(name, str) else None
    if spec is None or not spec.enabled:
        return None

    arg_model = _ARG_MODELS.get(name)
    raw_args = _parse_arguments(function.get("arguments"))
    if raw_args is None:
        return None
    if arg_model is not None:
        try:
            validated: Any = arg_model.model_validate(raw_args)
        except ValidationError:
            return None
    else:
        validated = raw_args

    return spec.handler(validated, ctx=ctx)
