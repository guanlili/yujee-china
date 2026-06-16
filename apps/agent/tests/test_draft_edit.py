"""Draft-edit service tests (#162).

Talk/act separation via the tool layer, with a mock `complete` (no real API):
  * a write_page_copy tool_call → kind="act" + merged pageWrite;
  * no tool_call → kind="talk", no pageWrite;
  * degenerate tool args → talk (G3);
  * focusedPageIndex present → FOCUS block in the prompt;
  * the merge touches only the target page's texts (single-page scope).
"""

import json

import pytest
from fastapi.testclient import TestClient

from src.schemas_v2 import V2DraftEditRequest, V2DraftEditResponse
from src.services import draft_edit

_AUTH = {"Authorization": "Bearer test_secret", "X-Request-Id": "req_162"}


@pytest.fixture()
def client():
    from src.main import app

    return TestClient(app)


def _route_body(user_message="hello", focused=None):
    return {
        "albumId": "a1",
        "language": "en",
        "page": {
            "pageIndex": 2,
            "templateId": "mag-05",
            "images": {"image": "p1"},
            "texts": {"title": "Old", "caption": "Old caption."},
        },
        "photos": [
            {
                "photoId": "p1",
                "description": "a beach",
                "tags": ["sea"],
                "quality": "detail",
                "orientation": "landscape",
                "peopleCount": "0",
                "scene": "outdoor",
                "mood": "warm",
            }
        ],
        "history": [],
        "userMessage": user_message,
        "focusedPageIndex": focused,
    }


def test_route_act_turn_in_mock_mode(client):
    resp = client.post(
        "/v2/album/draft-edit", headers=_AUTH, json=_route_body("rewrite the title")
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["kind"] == "act"
    assert data["pageWrite"]["pageIndex"] == 2
    assert "pageWrite" in data


def test_route_talk_turn_in_mock_mode(client):
    resp = client.post(
        "/v2/album/draft-edit", headers=_AUTH, json=_route_body("what do you think?")
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["kind"] == "talk"
    assert "pageWrite" not in data  # exclude_none drops it on a talk turn


def test_route_rejects_unknown_field(client):
    body = {**_route_body(), "draftTree": {}}
    resp = client.post("/v2/album/draft-edit", headers=_AUTH, json=body)
    # The app maps request validation errors to 400 (strict models reject the
    # unknown field — invariant 12: no whole tree smuggled in).
    assert resp.status_code == 400


def test_route_requires_bearer(client):
    resp = client.post("/v2/album/draft-edit", json=_route_body())
    assert resp.status_code in (401, 403)


def _req(user_message="hello", focused=None, texts=None, page_index=2):
    return V2DraftEditRequest.model_validate(
        {
            "albumId": "a1",
            "language": "en",
            "page": {
                "pageIndex": page_index,
                "templateId": "mag-05",
                "images": {"image": "p1"},
                "texts": texts if texts is not None else {"title": "Old", "caption": "Old caption."},
            },
            "photos": [
                {
                    "photoId": "p1",
                    "description": "a beach",
                    "tags": ["sea"],
                    "quality": "detail",
                    "orientation": "landscape",
                    "peopleCount": "0",
                    "scene": "outdoor",
                    "mood": "warm",
                }
            ],
            "history": [],
            "userMessage": user_message,
            "focusedPageIndex": focused,
        }
    )


def _tool_call_complete(slots, page_index=2, text=None):
    async def complete(**_kwargs):
        return {
            "choices": [
                {
                    "message": {
                        "content": text,
                        "tool_calls": [
                            {
                                "id": "c1",
                                "type": "function",
                                "function": {
                                    "name": "write_page_copy",
                                    "arguments": json.dumps(
                                        {"pageIndex": page_index, "slots": slots}
                                    ),
                                },
                            }
                        ],
                    }
                }
            ],
            "usage": {"prompt_tokens": 5, "completion_tokens": 7},
        }

    return complete


def _talk_complete(text="Sure, I think this page looks great."):
    async def complete(**_kwargs):
        return {
            "choices": [{"message": {"content": text}}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 4},
        }

    return complete


def _capture_messages_complete(box, *, tool_calls=None, text="ok"):
    """A complete that records the messages it was called with so a test can
    assert on the system prompt."""

    async def complete(**kwargs):
        box["messages"] = kwargs.get("messages")
        box["tools"] = kwargs.get("tools")
        box["tool_choice"] = kwargs.get("tool_choice")
        message = {"content": text}
        if tool_calls is not None:
            message["tool_calls"] = tool_calls
        return {"choices": [{"message": message}], "usage": {}}

    return complete


@pytest.mark.asyncio
async def test_tool_call_yields_act():
    resp = await draft_edit.run(
        _req("rewrite the title"),
        complete=_tool_call_complete({"title": "Seaside", "caption": "A calm afternoon."}),
    )
    assert isinstance(resp, V2DraftEditResponse)
    assert resp.kind == "act"
    assert resp.pageWrite is not None
    assert resp.pageWrite.pageIndex == 2
    assert resp.pageWrite.texts == {"title": "Seaside", "caption": "A calm afternoon."}
    assert resp.assistantReply  # non-empty


@pytest.mark.asyncio
async def test_act_uses_model_text_else_fixed_confirmation():
    # No model text → fixed confirmation.
    resp = await draft_edit.run(
        _req("change it"), complete=_tool_call_complete({"title": "New"}, text=None)
    )
    assert resp.kind == "act"
    assert resp.assistantReply == "Updated page 2"
    # Model text present → used.
    resp2 = await draft_edit.run(
        _req("change it"),
        complete=_tool_call_complete({"title": "New"}, text="Done — fresh title."),
    )
    assert resp2.assistantReply == "Done — fresh title."


@pytest.mark.asyncio
async def test_no_tool_call_yields_talk():
    resp = await draft_edit.run(_req("what do you think?"), complete=_talk_complete())
    assert resp.kind == "talk"
    assert resp.pageWrite is None
    assert resp.assistantReply == "Sure, I think this page looks great."


@pytest.mark.asyncio
async def test_degenerate_tool_args_demote_to_talk():
    # Placeholder text → G3 demotes the act to talk; no pageWrite.
    resp = await draft_edit.run(
        _req("change the title"),
        complete=_tool_call_complete({"title": "Dummy Title"}, text="I cannot decide."),
    )
    assert resp.kind == "talk"
    assert resp.pageWrite is None
    # The model's accompanying text becomes the talk reply.
    assert resp.assistantReply == "I cannot decide."


@pytest.mark.asyncio
async def test_empty_slots_demote_to_talk_with_fallback_reply():
    resp = await draft_edit.run(
        _req("change the title"), complete=_tool_call_complete({}, text=None)
    )
    assert resp.kind == "talk"
    assert resp.pageWrite is None
    assert resp.assistantReply == "Okay."  # fixed non-empty fallback (contract min_length=1)


@pytest.mark.asyncio
async def test_act_clamps_and_filters_to_page_template():
    # caption clamped to 120, decoration/unknown slots filtered.
    resp = await draft_edit.run(
        _req("rewrite"),
        complete=_tool_call_complete(
            {"caption": "y" * 400, "folio": "9", "nope": "x", "title": "T"}
        ),
    )
    assert resp.kind == "act"
    assert set(resp.pageWrite.texts.keys()) == {"caption", "title"}
    assert len(resp.pageWrite.texts["caption"]) <= 120


@pytest.mark.asyncio
async def test_focused_page_index_adds_focus_block():
    box = {}
    await draft_edit.run(_req("change this", focused=2), complete=_capture_messages_complete(box))
    system = box["messages"][0]["content"]
    assert "FOCUS" in system
    assert "focusedPageIndex" in system
    # And the payload carries it.
    user = box["messages"][1]["content"]
    assert '"focusedPageIndex": 2' in user


@pytest.mark.asyncio
async def test_no_focus_omits_focus_block():
    box = {}
    await draft_edit.run(_req("change this", focused=None), complete=_capture_messages_complete(box))
    system = box["messages"][0]["content"]
    assert "FOCUS" not in system


@pytest.mark.asyncio
async def test_tools_offered_with_auto_choice():
    box = {}
    await draft_edit.run(_req("hello"), complete=_capture_messages_complete(box))
    assert box["tool_choice"] == "auto"
    names = {t["function"]["name"] for t in box["tools"]}
    # #165 Phase 2: inspect_page_render + adjust_image_position joined the live set.
    assert names == {"write_page_copy", "inspect_page_render", "adjust_image_position"}


@pytest.mark.asyncio
async def test_pagewrite_touches_only_target_page_texts():
    # The request page has {title, caption}; the act write only carries the slots
    # the model changed (title) — the merge is single-page and slot-scoped.
    resp = await draft_edit.run(
        _req("change the title", texts={"title": "Old", "caption": "Keep me."}),
        complete=_tool_call_complete({"title": "Brand New"}),
    )
    assert resp.kind == "act"
    assert resp.pageWrite.pageIndex == 2
    assert resp.pageWrite.texts == {"title": "Brand New"}
    # caption is NOT in the write — Web merges only the returned slots onto the page.


@pytest.mark.asyncio
async def test_zh_fixed_confirmation():
    req = _req("改标题")
    req = req.model_copy(update={"language": "zh"})
    resp = await draft_edit.run(req, complete=_tool_call_complete({"title": "海边"}, text=None))
    assert resp.kind == "act"
    assert resp.assistantReply == "改好了第 2 页"


# --------------------------------------------------------------------------- #
# #165 Phase 2 — inspect / adjust mapping                                       #
# --------------------------------------------------------------------------- #


def _inspect_call_complete(page_index=2, text=None):
    async def complete(**_kwargs):
        return {
            "choices": [
                {
                    "message": {
                        "content": text,
                        "tool_calls": [
                            {
                                "id": "c1",
                                "type": "function",
                                "function": {
                                    "name": "inspect_page_render",
                                    "arguments": json.dumps({"pageIndex": page_index}),
                                },
                            }
                        ],
                    }
                }
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2},
        }

    return complete


def _adjust_call_complete(image_id="image", dx=0.0, dy=-15.0, scale=1.0, page_index=2, text=None):
    async def complete(**_kwargs):
        return {
            "choices": [
                {
                    "message": {
                        "content": text,
                        "tool_calls": [
                            {
                                "id": "c1",
                                "type": "function",
                                "function": {
                                    "name": "adjust_image_position",
                                    "arguments": json.dumps(
                                        {
                                            "pageIndex": page_index,
                                            "imageId": image_id,
                                            "dx": dx,
                                            "dy": dy,
                                            "scale": scale,
                                        }
                                    ),
                                },
                            }
                        ],
                    }
                }
            ],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2},
        }

    return complete


@pytest.mark.asyncio
async def test_inspect_call_yields_inspect_kind():
    resp = await draft_edit.run(
        _req("the face is cut off"), complete=_inspect_call_complete(page_index=99)
    )
    assert resp.kind == "inspect"
    # pinned to the page being edited (ctx.page_index=2), NOT the model's 99.
    assert resp.inspectRequest is not None
    assert resp.inspectRequest.pageIndex == 2
    assert resp.pageWrite is None
    assert resp.imagePosWrite is None
    assert resp.assistantReply  # short non-empty line


@pytest.mark.asyncio
async def test_adjust_call_yields_act_with_imagepos_write():
    resp = await draft_edit.run(
        _req("move the photo up"),
        complete=_adjust_call_complete(image_id="image", dx=0, dy=-15, scale=1.0),
    )
    assert resp.kind == "act"
    assert resp.imagePosWrite is not None
    assert resp.imagePosWrite.pageIndex == 2
    assert resp.imagePosWrite.imageId == "image"
    assert resp.imagePosWrite.x == 50.0  # 50 + 0
    assert resp.imagePosWrite.y == 35.0  # 50 + (-15)
    assert resp.imagePosWrite.scale == 1.0
    assert resp.pageWrite is None


@pytest.mark.asyncio
async def test_adjust_off_page_slot_demotes_to_talk():
    # imageId not on the page → dispatch returns None → talk (no write).
    resp = await draft_edit.run(
        _req("move that photo"),
        complete=_adjust_call_complete(image_id="ghost", dy=-15),
    )
    assert resp.kind == "talk"
    assert resp.imagePosWrite is None
    assert resp.pageWrite is None


@pytest.mark.asyncio
async def test_adjust_noop_args_demote_to_talk():
    resp = await draft_edit.run(
        _req("center it"),
        complete=_adjust_call_complete(dx=0, dy=0, scale=1.0),
    )
    assert resp.kind == "talk"
    assert resp.imagePosWrite is None


@pytest.mark.asyncio
async def test_write_page_copy_still_yields_act_pagewrite():
    # #162 path unchanged: copy edits still map to kind="act" + pageWrite.
    resp = await draft_edit.run(
        _req("rewrite the title"),
        complete=_tool_call_complete({"title": "Seaside"}),
    )
    assert resp.kind == "act"
    assert resp.pageWrite is not None
    assert resp.pageWrite.texts == {"title": "Seaside"}
    assert resp.imagePosWrite is None
    assert resp.inspectRequest is None


@pytest.mark.asyncio
async def test_talk_still_yields_talk():
    resp = await draft_edit.run(_req("what do you think?"), complete=_talk_complete())
    assert resp.kind == "talk"
    assert resp.pageWrite is None
    assert resp.imagePosWrite is None
    assert resp.inspectRequest is None
