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
    assert names == {"write_page_copy"}
    # Reserved tools are registered but NOT offered.
    assert "set_style" not in names
    assert "set_palette" not in names
    assert "image_treatment" not in names


def test_reserved_tools_registered_but_disabled():
    for name in ("set_style", "set_palette", "image_treatment"):
        spec = tools.TOOL_REGISTRY[name]
        assert spec.enabled is False


def test_write_page_copy_description_mentions_guardrails():
    # G1: the call/don't-call + no-placeholder rules live in the tool description.
    desc = tools.TOOL_REGISTRY["write_page_copy"].description.lower()
    assert "only" in desc
    assert "placeholder" in desc or "dummy" in desc
    assert "question" in desc or "greeting" in desc
