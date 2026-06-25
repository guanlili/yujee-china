"""V3 cover/ending — deterministic auto-fill of the optional 封面/封尾 pages (WP4.1 / #192).

Covers the acceptance (§4.4):
  ① 选 cover/ending 模板 → 自动填充成稿 (the page gets the chosen templateId, its photo
     slotted into the hero image slot, generic decoration code-filled, user-prose empty).
  ② 跳过 (no template chosen) = 空补丁不报错 (empty layoutPatch, no exception).
  ③ page0 非 cover 也合法 (validate_v3 accepts a layout whose page 0 is interior — the
     page0-must-cover rule is gone from the V3 engine, WP0.4; cover is optional).
  ④ 非法模板/容量兜底 (unknown id / wrong category raise CoverV3Error; a cover holding one
     image with more photos given drops the extras, never reuses/invents).

Grounded in real templates (cover: mag-01/mag-13/p01, cap=1; ending: mag-20, cap=1).
The v2 skeleton.py / finalize.py engines are untouched (Option B — cover lives in
cover_v3; the page0-cover deletion already happened in the V3 engine at WP0.4).
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from src.engine import templates
from src.schemas import (
    AlbumLayoutPlan,
    LayoutPhotoAnalysis,
    Magazine,
    Page,
    V3CoverRequest,
    V3CoverResponse,
    V3Models,
    V3Usage,
)
from src.engine import cover_v3
from src.engine import finalize_v3 as fv3
from src.engine import skeleton_v3


# A real cover template (category=cover, holds one hero image) and a real ending one.
_COVER_TID = "mag-01"
_ENDING_TID = "mag-20"


def _page(
    template_id: str = "mag-08",
    *,
    images: dict[str, str] | None = None,
    texts: dict[str, str] | None = None,
    page_index: int = 0,
) -> Page:
    return Page(
        pageIndex=page_index,
        templateId=template_id,
        images=images if images is not None else {},
        texts=texts or {},
    )


def _request(
    pages: list[Page],
    *,
    cover: str | None = None,
    ending: str | None = None,
    cover_photo: str | None = None,
    cover_photo_desc: str | None = None,
    hint: str | None = None,
    user_message: str = "",
    history: list[dict[str, str]] | None = None,
) -> V3CoverRequest:
    extra: dict[str, Any] = {}
    if cover_photo is not None:
        extra["coverPhoto"] = cover_photo
    if cover_photo_desc is not None:
        extra["coverPhotoDesc"] = cover_photo_desc
    if hint is not None:
        extra["hint"] = hint
    return V3CoverRequest(
        albumId="album-1",
        language="en",
        coverTemplateId=cover,
        endingTemplateId=ending,
        userMessage=user_message,
        history=history or [],
        pages=pages,
        **extra,
    )


def _run(req: V3CoverRequest, **kwargs: Any) -> V3CoverResponse:
    return asyncio.run(cover_v3.build_cover(req, **kwargs))


# ---------- categories sanity (the test assumptions) --------------------------


def test_test_templates_have_the_expected_categories() -> None:
    """Guards the fixtures: mag-01 is a cover, mag-20 is an ending, each holds 1 image."""
    cover = templates.get(_COVER_TID)
    ending = templates.get(_ENDING_TID)
    assert cover is not None and ending is not None
    assert skeleton_v3.template_category(cover) == "cover"
    assert skeleton_v3.template_category(ending) == "ending"
    assert skeleton_v3.image_capacity(cover) == 1
    assert skeleton_v3.image_capacity(ending) == 1


# ---------- ① 选 cover 模板 → 自动填充成稿 -------------------------------------


def test_cover_chosen_autofills_first_page() -> None:
    page = _page(images={"image": "p1"}, page_index=0)
    res = _run(_request([page], cover=_COVER_TID))

    assert len(res.layoutPatch) == 1
    entry = res.layoutPatch[0]
    assert entry.pageIndex == 0
    assert entry.templateId == _COVER_TID
    # The page's photo is slotted into the cover's hero image slot (declaration order).
    cover_img_slot = templates.image_slot_ids(templates.get(_COVER_TID))[0]
    assert entry.images == {cover_img_slot: "p1"}


def test_cover_autofill_fills_folio_but_leaves_user_prose_empty() -> None:
    # mag-01 has a `folio` decoration slot + title/explain user-prose slots.
    page = _page(images={"image": "p1"}, page_index=0)
    res = _run(_request([page], cover=_COVER_TID))
    texts = res.layoutPatch[0].texts or {}

    # folio (decoration) is code-filled with the 1-based page number.
    assert texts.get("folio") == "01"
    # User-prose slots (heading/caption) are NEVER auto-written (§4.1 不生成正式文案).
    assert "heading" not in texts
    assert "caption1" not in texts
    assert "caption2" not in texts


def test_ending_chosen_autofills_last_page() -> None:
    body = _page("mag-08", images={"image": "p1"}, page_index=0)
    ending_slot = _page("mag-08", images={"image": "p2"}, page_index=1)
    res = _run(_request([body, ending_slot], ending=_ENDING_TID))

    assert len(res.layoutPatch) == 1
    entry = res.layoutPatch[0]
    assert entry.pageIndex == 1  # designed onto the LAST page
    assert entry.templateId == _ENDING_TID
    ending_img_slot = templates.image_slot_ids(templates.get(_ENDING_TID))[0]
    assert entry.images == {ending_img_slot: "p2"}


def test_cover_and_ending_together_use_distinct_pages() -> None:
    first = _page(images={"image": "p1"}, page_index=0)
    middle = _page("mag-08", images={"image": "p2"}, page_index=1)
    last = _page(images={"image": "p3"}, page_index=2)
    res = _run(
        _request([first, middle, last], cover=_COVER_TID, ending=_ENDING_TID)
    )

    by_index = {e.pageIndex: e for e in res.layoutPatch}
    assert set(by_index) == {0, 2}
    assert by_index[0].templateId == _COVER_TID
    assert by_index[2].templateId == _ENDING_TID


def test_single_page_with_both_chosen_raises_when_ending_has_no_distinct_page() -> None:
    page = _page(images={"image": "p1"}, page_index=0)
    with pytest.raises(cover_v3.CoverV3Error, match="distinct landing page"):
        _run(
            _request([page], cover=_COVER_TID, ending=_ENDING_TID)
        )


def test_duplicate_page_index_with_both_chosen_raises_no_distinct_landing_page() -> None:
    cover_slot = _page(images={"image": "p1"}, page_index=0)
    ending_slot = _page(images={"image": "p2"}, page_index=0)
    with pytest.raises(cover_v3.CoverV3Error, match="distinct landing page"):
        _run(
            _request([cover_slot, ending_slot], cover=_COVER_TID, ending=_ENDING_TID)
        )


def test_both_chosen_raise_when_first_and_last_land_on_same_page_index() -> None:
    cover_slot = _page(images={"image": "p1"}, page_index=0)
    body = _page("mag-08", images={"image": "p2"}, page_index=1)
    ending_slot = _page(images={"image": "p3"}, page_index=0)

    with pytest.raises(cover_v3.CoverV3Error, match="distinct landing page"):
        _run(
            _request([cover_slot, body, ending_slot], cover=_COVER_TID, ending=_ENDING_TID)
        )


# ---------- ② 跳过 = 空补丁不报错 ---------------------------------------------


def test_skip_returns_empty_patch_no_error() -> None:
    page = _page(images={"image": "p1"}, page_index=0)
    res = _run(_request([page]))  # neither cover nor ending
    assert res.layoutPatch == []
    assert res.needsUserInput is False


def test_skip_with_no_pages_returns_empty_patch() -> None:
    res = _run(_request([]))
    assert res.layoutPatch == []
    assert res.needsUserInput is False


def test_skip_with_no_template_ids_does_not_run_copy_or_color_seams() -> None:
    page = _page(images={"image": "p1"}, page_index=0)
    calls: list[str] = []

    async def copy_fn(payload):  # noqa: ANN001
        calls.append(f"copy:{payload}")
        return cover_v3.CoverCopyResult(cover_texts={"title": "Should not run"})

    async def color_fn(payload):  # noqa: ANN001
        calls.append(f"color:{payload}")
        return "#123456"

    res = _run(_request([page]), copy_fn=copy_fn, color_design_fn=color_fn)

    assert res.layoutPatch == []
    assert res.needsUserInput is False
    assert calls == []


def test_clarification_turn_returns_empty_patch_and_skips_color() -> None:
    page = _page(images={"image": "p1"}, page_index=0)
    color_called = False

    async def copy_fn(payload):  # noqa: ANN001
        return cover_v3.CoverCopyResult(
            needs_user_input=True,
            assistant_reply="What title should I put on the cover?",
        )

    async def color_fn(payload):  # noqa: ANN001
        nonlocal color_called
        color_called = True
        return "#123456"

    res = _run(_request([page], cover=_COVER_TID), copy_fn=copy_fn, color_design_fn=color_fn)

    assert res.needsUserInput is True
    assert res.assistantReply == "What title should I put on the cover?"
    assert res.layoutPatch == []
    assert color_called is False


def test_clarification_hard_cap_forces_landing_instead_of_reasking() -> None:
    page = _page(images={"image": "p1"}, page_index=0)
    history = [
        {"role": "assistant", "content": "What title should I use?"},
        {"role": "user", "content": "I'm not sure."},
        {"role": "assistant", "content": "Could you share one mood or phrase?"},
    ]

    async def copy_fn(payload):  # noqa: ANN001
        return cover_v3.CoverCopyResult(
            needs_user_input=True,
            assistant_reply="One more question?",
        )

    res = _run(_request([page], cover=_COVER_TID, history=history), copy_fn=copy_fn)

    assert res.needsUserInput is False
    assert res.assistantReply is None
    assert len(res.layoutPatch) == 1
    assert res.layoutPatch[0].templateId == _COVER_TID


def test_chosen_cover_template_but_no_pages_raises() -> None:
    with pytest.raises(cover_v3.CoverV3Error, match="landing page"):
        _run(_request([], cover=_COVER_TID))


def test_chosen_ending_template_but_no_pages_raises() -> None:
    with pytest.raises(cover_v3.CoverV3Error, match="landing page"):
        _run(_request([], ending=_ENDING_TID))


# ---------- ③ page0 非 cover 也合法(删 page0-cover) --------------------------


def test_page0_interior_is_valid_no_forced_cover() -> None:
    """The V3 engine no longer forces page 0 to be a cover — a layout whose page 0 is an
    interior template (and which carries no cover at all) passes validate_v3."""
    plan = AlbumLayoutPlan(
        magazine=Magazine(title="No Cover", subtitle=None, style="editorial", language="en"),
        photos=[
            LayoutPhotoAnalysis(
                photoId="p1", description="", tags=[], quality="detail", orientation="landscape"
            )
        ],
        pages=[Page(pageIndex=0, templateId="mag-08", images={"image": "p1"}, texts={})],
    )
    # mag-08 is an interior template, so page 0 is NOT a cover — must still validate.
    assert skeleton_v3.template_category(templates.get("mag-08")) != "cover"
    assert fv3.validate_v3(plan) is None


# ---------- ④ 非法模板 / 容量兜底 --------------------------------------------


def test_unknown_cover_template_raises() -> None:
    page = _page(images={"image": "p1"}, page_index=0)
    with pytest.raises(cover_v3.CoverV3Error):
        _run(_request([page], cover="does-not-exist"))


def test_wrong_category_as_cover_raises() -> None:
    # mag-08 is interior — choosing it as the COVER is a caller bug.
    page = _page(images={"image": "p1"}, page_index=0)
    with pytest.raises(cover_v3.CoverV3Error):
        _run(_request([page], cover="mag-08"))


def test_wrong_category_as_ending_raises() -> None:
    # the cover template mag-01 is NOT an ending.
    page = _page(images={"image": "p1"}, page_index=0)
    with pytest.raises(cover_v3.CoverV3Error):
        _run(_request([page], ending=_COVER_TID))


def test_extra_photos_beyond_capacity_are_dropped() -> None:
    """A cover holds ONE hero — given a page with several photos, only the first lands
    (capacity cap); extras are dropped, never reused/invented (no over-capacity error)."""
    page = _page(images={"a": "p1", "b": "p2", "c": "p3"}, page_index=0)
    res = _run(_request([page], cover=_COVER_TID))
    cover_img_slot = templates.image_slot_ids(templates.get(_COVER_TID))[0]
    assert res.layoutPatch[0].images == {cover_img_slot: "p1"}


def test_cover_page_with_no_photo_still_designs_with_empty_images() -> None:
    """A reserved cover page may carry no photo yet — it still gets the chosen template
    (empty image map), so the user sees the cover layout to fill in."""
    page = _page(images={}, page_index=0)
    res = _run(_request([page], cover=_COVER_TID))
    assert len(res.layoutPatch) == 1
    assert res.layoutPatch[0].templateId == _COVER_TID
    assert res.layoutPatch[0].images == {}


def test_base64_reaches_only_accent_extraction_not_copy_or_color_payloads() -> None:
    secret_base64 = "data:image/png;base64,SECRET_PAYLOAD_SHOULD_NOT_BE_PROMPTED"
    page = _page(images={"image": "p1"}, page_index=0)
    captured: dict[str, Any] = {}

    def accent_fn(photo):  # noqa: ANN001
        captured["accent_photo"] = photo
        return "#AABBCC"

    async def copy_fn(payload):  # noqa: ANN001
        captured["copy_payload"] = payload
        return cover_v3.CoverCopyResult(cover_texts={"title": "Lake Days"})

    async def color_fn(payload):  # noqa: ANN001
        captured["color_payload"] = payload
        return "#112233"

    res = _run(
        _request(
            [page],
            cover=_COVER_TID,
            cover_photo=secret_base64,
            cover_photo_desc="A family beside a blue lake.",
            hint="quiet and warm",
            user_message="Use a gentle title.",
        ),
        copy_fn=copy_fn,
        color_design_fn=color_fn,
        accent_from_photo_fn=accent_fn,
    )

    assert res.layoutPatch
    assert captured["accent_photo"] == secret_base64
    assert secret_base64 not in repr(captured["copy_payload"])
    assert secret_base64 not in repr(captured["color_payload"])


def test_landing_cleans_authored_copy_slots() -> None:
    page = _page(images={"image": "p1"}, page_index=0)

    async def copy_fn(payload):  # noqa: ANN001
        return cover_v3.CoverCopyResult(
            cover_texts={
                "title": "A very long cover title that must be clamped",
                "explain1": "",
                "explain2": "  A quiet lake morning  ",
                "unknownSlot": "must be dropped",
            }
        )

    res = _run(_request([page], cover=_COVER_TID), copy_fn=copy_fn)
    texts = res.layoutPatch[0].texts or {}

    assert texts["title"] == "A very long "
    assert texts["explain2"] == "A quiet lake morning"
    assert "explain1" not in texts
    assert "unknownSlot" not in texts


def test_color_design_result_exits_through_finalize_color() -> None:
    page = _page(images={"image": "p1"}, page_index=0)
    finalize_inputs: list[str] = []

    async def color_fn(payload):  # noqa: ANN001
        return "not-a-color"

    def finalizer(value: str) -> str:
        finalize_inputs.append(value)
        return "#4A5568"

    res = _run(
        _request([page], cover=_COVER_TID),
        color_design_fn=color_fn,
        finalize_color_fn=finalizer,
    )
    texts = res.layoutPatch[0].texts or {}

    assert finalize_inputs == ["not-a-color"]
    assert texts["title#accentColor"] == "#4A5568"
    assert texts["title#artFont"] == "serif-classic"


# ---------- route-level: auth gate + contract envelope + error shape ----------


def _client():
    from fastapi.testclient import TestClient

    from src.main import app

    return TestClient(app)


def _route_body(
    *, cover: str | None = None, ending: str | None = None, pages: list[dict] | None = None
) -> dict:
    body: dict = {
        "albumId": "alb_v3",
        "language": "en",
        "pages": pages if pages is not None else [
            {"pageIndex": 0, "templateId": "mag-08", "images": {"image": "p1"}, "texts": {}}
        ],
    }
    if cover is not None:
        body["coverTemplateId"] = cover
    if ending is not None:
        body["endingTemplateId"] = ending
    return body


def test_route_requires_auth() -> None:
    res = _client().post("/v3/cover", json=_route_body(cover=_COVER_TID))
    assert res.status_code == 401


def test_route_happy_path_returns_contract_envelope() -> None:
    res = _client().post(
        "/v3/cover",
        json=_route_body(cover=_COVER_TID),
        headers={"Authorization": "Bearer test_secret"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    parsed = V3CoverResponse(**body["data"])  # two-end parity
    assert parsed.needsUserInput is False
    assert len(parsed.layoutPatch) == 1
    assert parsed.layoutPatch[0].templateId == _COVER_TID


def test_route_skip_returns_empty_patch_ok() -> None:
    res = _client().post(
        "/v3/cover",
        json=_route_body(),  # no cover/ending → skip
        headers={"Authorization": "Bearer test_secret"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    parsed = V3CoverResponse(**body["data"])
    assert parsed.layoutPatch == []
    assert parsed.needsUserInput is False


def test_route_awaits_async_build_cover_and_returns_needs_user_input_default(monkeypatch) -> None:
    awaited = False

    async def fake_build(req):  # noqa: ANN001
        nonlocal awaited
        awaited = True
        return V3CoverResponse(
            layoutPatch=[],
            usage=V3Usage(durationMs=1, models=V3Models()),
        )

    monkeypatch.setattr(cover_v3, "build_cover", fake_build)

    res = _client().post(
        "/v3/cover",
        json=_route_body(cover=_COVER_TID),
        headers={"Authorization": "Bearer test_secret"},
    )

    assert res.status_code == 200, res.text
    assert awaited is True
    body = res.json()
    assert body["ok"] is True
    assert body["data"]["layoutPatch"] == []
    assert body["data"]["needsUserInput"] is False


def test_route_invalid_template_is_422_contract_error() -> None:
    res = _client().post(
        "/v3/cover",
        json=_route_body(cover="does-not-exist"),
        headers={"Authorization": "Bearer test_secret"},
    )
    assert res.status_code == 422
    body = res.json()
    detail = body.get("detail", body)
    assert detail["ok"] is False
    assert detail["error"]["code"] == "AGENT_OUTPUT_VALIDATION"
