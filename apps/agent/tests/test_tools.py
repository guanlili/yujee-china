"""Tool registry tests (#162).

`write_page_copy` dispatch applies + clamps to the page's template text slots;
non-authored / unknown slots are filtered; placeholder/empty args demote to None
(G3); reserved tools are registered but NOT offered to the model.

mag-05 authored text slots: `title` (title, maxChars=25), `caption` (body,
maxChars=120). `topRight`/`folio` are decoration — never model-writable.
"""

from src.services import tools


def _ctx(template_id="mag-05", page_index=2):
    return tools.WritePageCopyContext(page_index=page_index, template_id=template_id)


def _call(slots, page_index=2):
    return {
        "id": "c1",
        "type": "function",
        "function": {
            "name": "write_page_copy",
            "arguments": {"pageIndex": page_index, "slots": slots},
        },
    }


def test_dispatch_applies_authored_slots():
    result = tools.dispatch(_call({"title": "Seaside", "caption": "A calm afternoon."}), ctx=_ctx())
    assert result is not None
    assert result.tool == "write_page_copy"
    assert result.payload["texts"] == {"title": "Seaside", "caption": "A calm afternoon."}


def test_dispatch_pins_pageindex_to_ctx():
    # The model's pageIndex arg is advisory; the write is pinned to ctx.page_index
    # so it can never spill onto another page (invariant 12 — one page per turn).
    result = tools.dispatch(_call({"title": "Hi"}, page_index=99), ctx=_ctx(page_index=2))
    assert result is not None
    assert result.payload["pageIndex"] == 2


def test_dispatch_clamps_to_maxchars():
    long_caption = "x" * 400
    result = tools.dispatch(_call({"caption": long_caption}), ctx=_ctx())
    assert result is not None
    # mag-05 caption maxChars=120 → clamped.
    assert len(result.payload["texts"]["caption"]) <= 120


def test_dispatch_filters_unknown_and_decoration_slots():
    result = tools.dispatch(
        _call({"title": "Keep", "folio": "1", "topRight": "x", "nope": "drop"}),
        ctx=_ctx(),
    )
    assert result is not None
    # Only the authored `title` survives; decoration (folio/topRight) + unknown
    # (nope) are filtered out.
    assert result.payload["texts"] == {"title": "Keep"}


def test_dispatch_empty_slots_demotes_to_none():
    assert tools.dispatch(_call({}), ctx=_ctx()) is None


def test_dispatch_blank_values_demote_to_none():
    assert tools.dispatch(_call({"title": "   ", "caption": ""}), ctx=_ctx()) is None


def test_dispatch_placeholder_values_demote_to_none():
    # "Dummy Title" / "标题" / echoing the slot name are all dummy tells (G3).
    assert tools.dispatch(_call({"title": "Dummy Title"}), ctx=_ctx()) is None
    assert tools.dispatch(_call({"title": "标题"}), ctx=_ctx()) is None
    assert tools.dispatch(_call({"title": "title"}), ctx=_ctx()) is None
    assert tools.dispatch(_call({"caption": "placeholder"}), ctx=_ctx()) is None


def test_dispatch_mixed_real_and_placeholder_keeps_real():
    result = tools.dispatch(
        _call({"title": "Dummy Title", "caption": "A real line of copy."}), ctx=_ctx()
    )
    assert result is not None
    assert result.payload["texts"] == {"caption": "A real line of copy."}


def test_dispatch_string_arguments_are_parsed():
    import json

    call = {
        "function": {
            "name": "write_page_copy",
            "arguments": json.dumps({"pageIndex": 2, "slots": {"title": "Hi"}}),
        }
    }
    result = tools.dispatch(call, ctx=_ctx())
    assert result is not None
    assert result.payload["texts"] == {"title": "Hi"}


def test_dispatch_unknown_template_writes_nothing():
    # Fix 3 — defense in depth: an unknown/None template has no authored-slot
    # allow-list, so model-invented slots must NOT pass through unfiltered. The
    # write is demoted to talk (None), nothing is written.
    result = tools.dispatch(
        _call({"title": "Seaside", "anything": "x"}),
        ctx=_ctx(template_id="no-such-template"),
    )
    assert result is None


def test_dispatch_unknown_tool_returns_none():
    call = {"function": {"name": "no_such_tool", "arguments": {"x": 1}}}
    assert tools.dispatch(call, ctx=_ctx()) is None


def test_dispatch_disabled_tool_returns_none():
    call = {"function": {"name": "set_style", "arguments": {"scope": "all", "style": {}}}}
    assert tools.dispatch(call, ctx=_ctx()) is None


def test_dispatch_invalid_args_return_none():
    # pageIndex missing → pydantic validation fails → demote.
    call = {"function": {"name": "write_page_copy", "arguments": {"slots": {"title": "Hi"}}}}
    # slots default to {} when pageIndex present, but here pageIndex is missing.
    assert tools.dispatch(call, ctx=_ctx()) is None


def test_dispatch_non_object_arguments_return_none():
    call = {"function": {"name": "write_page_copy", "arguments": "not json at all {"}}
    assert tools.dispatch(call, ctx=_ctx()) is None


def test_tools_for_prompt_only_enabled():
    offered = tools.tools_for_prompt()
    names = {t["function"]["name"] for t in offered}
    # #165 Phase 2: inspect_page_render + adjust_image_position joined the live set.
    assert names == {"write_page_copy", "inspect_page_render", "adjust_image_position"}
    # Reserved tools are registered but NOT offered.
    assert "set_style" not in names
    assert "set_palette" not in names


def test_reserved_tools_registered_but_disabled():
    for name in ("set_style", "set_palette"):
        spec = tools.TOOL_REGISTRY[name]
        assert spec.enabled is False


def test_write_page_copy_description_mentions_guardrails():
    # G1: the call/don't-call + no-placeholder rules live in the tool description.
    desc = tools.TOOL_REGISTRY["write_page_copy"].description.lower()
    assert "only" in desc
    assert "placeholder" in desc or "dummy" in desc
    assert "question" in desc or "greeting" in desc


# --------------------------------------------------------------------------- #
# #165 Phase 2 — inspect_page_render + adjust_image_position                    #
# --------------------------------------------------------------------------- #


def _draft_ctx(page_index=2, template_id="mag-05", image_slots=("image",)):
    return tools.DraftEditContext(
        page_index=page_index,
        template_id=template_id,
        image_slots=frozenset(image_slots),
    )


def _inspect_call(page_index=2):
    return {
        "id": "c1",
        "type": "function",
        "function": {"name": "inspect_page_render", "arguments": {"pageIndex": page_index}},
    }


def _adjust_call(image_id="image", dx=0.0, dy=-10.0, scale=1.0, page_index=2):
    return {
        "id": "c1",
        "type": "function",
        "function": {
            "name": "adjust_image_position",
            "arguments": {
                "pageIndex": page_index,
                "imageId": image_id,
                "dx": dx,
                "dy": dy,
                "scale": scale,
            },
        },
    }


def test_inspect_page_render_pins_pageindex():
    # The model's pageIndex arg is advisory; the sentinel is pinned to ctx.page_index.
    result = tools.dispatch(_inspect_call(page_index=99), ctx=_draft_ctx(page_index=2))
    assert result is not None
    assert result.tool == "inspect_page_render"
    assert result.payload == {"pageIndex": 2}


def test_adjust_image_position_computes_absolute_from_50_base():
    # x = clamp(50+dx,0,100), y = clamp(50+dy,0,100).
    result = tools.dispatch(_adjust_call(dx=10, dy=-20, scale=1.5), ctx=_draft_ctx())
    assert result is not None
    assert result.tool == "adjust_image_position"
    assert result.payload["pageIndex"] == 2  # pinned
    assert result.payload["imageId"] == "image"
    assert result.payload["x"] == 60.0
    assert result.payload["y"] == 30.0
    assert result.payload["scale"] == 1.5


def test_adjust_image_position_clamps_dx_dy_scale():
    # dx/dy clamp to [-50,50] → x/y clamp to [0,100]; scale clamps to [1,2].
    result = tools.dispatch(_adjust_call(dx=999, dy=-999, scale=99), ctx=_draft_ctx())
    assert result is not None
    assert result.payload["x"] == 100.0  # 50 + clamp(999→50)
    assert result.payload["y"] == 0.0  # 50 + clamp(-999→-50)
    assert result.payload["scale"] == 2.0


def test_adjust_image_position_clamps_scale_below_one():
    result = tools.dispatch(_adjust_call(dx=5, dy=0, scale=0.2), ctx=_draft_ctx())
    assert result is not None
    assert result.payload["scale"] == 1.0


def test_adjust_image_position_off_page_slot_demotes_to_none():
    # imageId not in the page's real image-slot set → never write (G3).
    result = tools.dispatch(_adjust_call(image_id="ghost", dy=-10), ctx=_draft_ctx())
    assert result is None


def test_adjust_image_position_noop_args_demote_to_none():
    # dx==dy==0 and scale==1.0 → degenerate no-op → talk (G3).
    result = tools.dispatch(_adjust_call(dx=0, dy=0, scale=1.0), ctx=_draft_ctx())
    assert result is None


def test_adjust_image_position_subrange_scale_noop_demotes_to_none():
    # #165 Phase-3 D2: a sub-range scale (0.5) with zero shift clamps UP to
    # {50,50,1.0}. The no-op check must run AFTER clamping, else this slips past
    # the pre-clamp gate (scale 0.5 != 1.0) and emits an inert {50,50,1.0} act.
    result = tools.dispatch(_adjust_call(dx=0, dy=0, scale=0.5), ctx=_draft_ctx())
    assert result is None


def test_adjust_image_position_scale_only_is_not_noop():
    # A pure zoom (scale!=1) with no shift is still a real adjust.
    result = tools.dispatch(_adjust_call(dx=0, dy=0, scale=1.3), ctx=_draft_ctx())
    assert result is not None
    assert result.payload["x"] == 50.0
    assert result.payload["y"] == 50.0
    assert result.payload["scale"] == 1.3


def test_phase2_tools_offered_and_described():
    offered = {t["function"]["name"] for t in tools.tools_for_prompt()}
    assert {"inspect_page_render", "adjust_image_position"} <= offered
    inspect_desc = tools.TOOL_REGISTRY["inspect_page_render"].description.lower()
    assert "only" in inspect_desc and ("crop" in inspect_desc or "cut off" in inspect_desc)
    adjust_desc = tools.TOOL_REGISTRY["adjust_image_position"].description.lower()
    assert "only" in adjust_desc and "no-op" in adjust_desc


def test_image_treatment_stub_removed():
    # The reserved #162 image_treatment stub is superseded by adjust_image_position.
    assert "image_treatment" not in tools.TOOL_REGISTRY
