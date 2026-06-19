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

import pytest

from src import templates
from src.schemas import (
    AlbumLayoutPlan,
    LayoutPhotoAnalysis,
    Magazine,
    Page,
    V3CoverRequest,
)
from src.services import cover_v3
from src.services import finalize_v3 as fv3
from src.services import skeleton_v3


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
) -> V3CoverRequest:
    return V3CoverRequest(
        albumId="album-1",
        language="en",
        coverTemplateId=cover,
        endingTemplateId=ending,
        pages=pages,
    )


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
    res = cover_v3.build_cover(_request([page], cover=_COVER_TID))

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
    res = cover_v3.build_cover(_request([page], cover=_COVER_TID))
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
    res = cover_v3.build_cover(_request([body, ending_slot], ending=_ENDING_TID))

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
    res = cover_v3.build_cover(
        _request([first, middle, last], cover=_COVER_TID, ending=_ENDING_TID)
    )

    by_index = {e.pageIndex: e for e in res.layoutPatch}
    assert set(by_index) == {0, 2}
    assert by_index[0].templateId == _COVER_TID
    assert by_index[2].templateId == _ENDING_TID


def test_single_page_with_both_chosen_raises_when_ending_has_no_distinct_page() -> None:
    page = _page(images={"image": "p1"}, page_index=0)
    with pytest.raises(cover_v3.CoverV3Error, match="distinct landing page"):
        cover_v3.build_cover(
            _request([page], cover=_COVER_TID, ending=_ENDING_TID)
        )


def test_duplicate_page_index_with_both_chosen_raises_no_distinct_landing_page() -> None:
    cover_slot = _page(images={"image": "p1"}, page_index=0)
    ending_slot = _page(images={"image": "p2"}, page_index=0)
    with pytest.raises(cover_v3.CoverV3Error, match="distinct landing page"):
        cover_v3.build_cover(
            _request([cover_slot, ending_slot], cover=_COVER_TID, ending=_ENDING_TID)
        )


def test_both_chosen_raise_when_first_and_last_land_on_same_page_index() -> None:
    cover_slot = _page(images={"image": "p1"}, page_index=0)
    body = _page("mag-08", images={"image": "p2"}, page_index=1)
    ending_slot = _page(images={"image": "p3"}, page_index=0)

    with pytest.raises(cover_v3.CoverV3Error, match="distinct landing page"):
        cover_v3.build_cover(
            _request([cover_slot, body, ending_slot], cover=_COVER_TID, ending=_ENDING_TID)
        )


# ---------- ② 跳过 = 空补丁不报错 ---------------------------------------------


def test_skip_returns_empty_patch_no_error() -> None:
    page = _page(images={"image": "p1"}, page_index=0)
    res = cover_v3.build_cover(_request([page]))  # neither cover nor ending
    assert res.layoutPatch == []


def test_skip_with_no_pages_returns_empty_patch() -> None:
    res = cover_v3.build_cover(_request([]))
    assert res.layoutPatch == []


def test_chosen_cover_template_but_no_pages_raises() -> None:
    with pytest.raises(cover_v3.CoverV3Error, match="landing page"):
        cover_v3.build_cover(_request([], cover=_COVER_TID))


def test_chosen_ending_template_but_no_pages_raises() -> None:
    with pytest.raises(cover_v3.CoverV3Error, match="landing page"):
        cover_v3.build_cover(_request([], ending=_ENDING_TID))


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
        cover_v3.build_cover(_request([page], cover="does-not-exist"))


def test_wrong_category_as_cover_raises() -> None:
    # mag-08 is interior — choosing it as the COVER is a caller bug.
    page = _page(images={"image": "p1"}, page_index=0)
    with pytest.raises(cover_v3.CoverV3Error):
        cover_v3.build_cover(_request([page], cover="mag-08"))


def test_wrong_category_as_ending_raises() -> None:
    # the cover template mag-01 is NOT an ending.
    page = _page(images={"image": "p1"}, page_index=0)
    with pytest.raises(cover_v3.CoverV3Error):
        cover_v3.build_cover(_request([page], ending=_COVER_TID))


def test_extra_photos_beyond_capacity_are_dropped() -> None:
    """A cover holds ONE hero — given a page with several photos, only the first lands
    (capacity cap); extras are dropped, never reused/invented (no over-capacity error)."""
    page = _page(images={"a": "p1", "b": "p2", "c": "p3"}, page_index=0)
    res = cover_v3.build_cover(_request([page], cover=_COVER_TID))
    cover_img_slot = templates.image_slot_ids(templates.get(_COVER_TID))[0]
    assert res.layoutPatch[0].images == {cover_img_slot: "p1"}


def test_cover_page_with_no_photo_still_designs_with_empty_images() -> None:
    """A reserved cover page may carry no photo yet — it still gets the chosen template
    (empty image map), so the user sees the cover layout to fill in."""
    page = _page(images={}, page_index=0)
    res = cover_v3.build_cover(_request([page], cover=_COVER_TID))
    assert len(res.layoutPatch) == 1
    assert res.layoutPatch[0].templateId == _COVER_TID
    assert res.layoutPatch[0].images == {}


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
    from src.schemas import V3CoverResponse

    res = _client().post(
        "/v3/cover",
        json=_route_body(cover=_COVER_TID),
        headers={"Authorization": "Bearer test_secret"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    parsed = V3CoverResponse(**body["data"])  # two-end parity
    assert len(parsed.layoutPatch) == 1
    assert parsed.layoutPatch[0].templateId == _COVER_TID


def test_route_skip_returns_empty_patch_ok() -> None:
    from src.schemas import V3CoverResponse

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
