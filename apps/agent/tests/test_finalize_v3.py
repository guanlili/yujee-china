"""V3 deterministic finalize (WP0.4 / #179).

Covers flatten of a V3 tree + preview pages into the external AlbumLayoutPlan,
cover optionality (page 0 need not be a cover), recognition of V3 template
fields, and the V3-shaped validate (no quality/hero/orientation, repeat-group
slots accepted). The v2 finalize.validate_v2 is untouched.
"""

from __future__ import annotations

import pytest

from src import templates
from src.schemas import (
    Page,
    V3Chapter,
    V3ChapterPhoto,
    V3FinalizeRequest,
    V3LayoutTree,
)
from src.services import finalize_v3 as fv3
from src.services import skeleton_v3 as sk


def _photo(idx: int, orientation: str = "landscape") -> V3ChapterPhoto:
    return V3ChapterPhoto(
        photoId=f"p{idx}",
        sceneDescription=f"scene {idx}",
        width=800,
        height=600,
        orientation=orientation,
    )


def _request(chapters: list[V3Chapter], pages: list[Page], language: str = "en") -> V3FinalizeRequest:
    return V3FinalizeRequest(
        albumId="album-1",
        language=language,
        tree=V3LayoutTree(chapters=chapters),
        pages=pages,
    )


def _chapter(chapter_id: str, photos: list[V3ChapterPhoto], description: str = "desc") -> V3Chapter:
    return V3Chapter(
        chapterId=chapter_id,
        description=description,
        accentColor=None,
        artFont=None,
        photos=photos,
    )


def _skeleton_pages(photo_ids: list[str]) -> list[Page]:
    return [Page(**pd) for pd in sk.build_skeleton_v3([{"photos": photo_ids}])]


def test_finalize_flattens_tree_into_album_layout_plan():
    photos = [_photo(i) for i in range(3)]
    chapter = _chapter("c1", photos, description="A day out")
    pages = _skeleton_pages([p.photoId for p in photos])

    layout = fv3.finalize_v3(_request([chapter], pages))

    assert layout.magazine.title == "A day out"
    assert layout.magazine.language == "en"
    assert {p.photoId for p in layout.photos} == {"p0", "p1", "p2"}
    assert [p.pageIndex for p in layout.pages] == list(range(len(layout.pages)))
    assert fv3.validate_v3(layout) is None


def test_cover_is_optional_page0_need_not_be_cover():
    photos = [_photo(0)]
    chapter = _chapter("c1", photos)
    # A single interior page; page 0 is interior, NOT a cover. v2 would reject;
    # V3 must accept (covers are optional, §4.4).
    page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-08"))
    layout = fv3.finalize_v3(_request([chapter], [page]))
    first_tpl = templates.TEMPLATES[layout.pages[0].templateId]
    assert sk.template_category(first_tpl) == "interior"
    assert fv3.validate_v3(layout) is None


def test_finalize_output_photos_carry_neutral_quality():
    # V3 input photos have no quality; the external contract still requires one.
    # finalize synthesizes a neutral value — never "hero", never derived.
    photos = [_photo(0)]
    chapter = _chapter("c1", photos)
    page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-03"))
    layout = fv3.finalize_v3(_request([chapter], [page]))
    assert layout.photos[0].quality == "detail"
    assert layout.photos[0].description == "scene 0"


def test_finalize_dedupes_photos_across_chapters_first_seen_order():
    p0, p1 = _photo(0), _photo(1)
    # p0 appears in two chapters; output photos[] keeps it once, first-seen.
    c1 = _chapter("c1", [p0, p1])
    c2 = _chapter("c2", [p0])
    pages = [
        Page(**sk.build_page_v3("interior", ["p0", "p1"], template_id="mag-07", page_index=0)),
        Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-03", page_index=1)),
    ]
    layout = fv3.finalize_v3(_request([c1, c2], pages))
    ids = [p.photoId for p in layout.photos]
    assert ids == ["p0", "p1"]


def test_aspect_ratio_mismatch_does_not_raise():
    # A landscape photo placed into mag-08 (legacy fixture marks its slot
    # portrait-only) must finalize without an orientation error.
    photo = _photo(0, orientation="landscape")
    chapter = _chapter("c1", [photo])
    page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-08"))
    layout = fv3.finalize_v3(_request([chapter], [page]))
    assert fv3.validate_v3(layout) is None


def test_validate_rejects_unknown_template():
    photos = [_photo(0)]
    layout = fv3.finalize_v3(
        _request([_chapter("c1", photos)], [Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-03"))])
    )
    bad = layout.model_copy(
        update={"pages": [layout.pages[0].model_copy(update={"templateId": "nope-999"})]}
    )
    assert "not in TemplateRegistry" in (fv3.validate_v3(bad) or "")


def test_validate_accepts_underfilled_larger_template():
    photos = [_photo(0), _photo(1), _photo(2)]
    # mag-10 has 4 image slots. V3 legal candidates may have capacity >= N, so a
    # 3-photo page may leave the fourth slot empty; the renderer simply has no
    # content for that declared slot.
    page = Page(**sk.build_page_v3("interior", ["p0", "p1", "p2"], template_id="mag-10"))
    layout = fv3.finalize_v3(_request([_chapter("c1", photos)], [page]))
    assert fv3.validate_v3(layout) is None


def test_validate_accepts_repeat_group_text_slot_keys():
    # mag-10 has a repeat text base slot "cells"; a bracket-path key must validate
    # against the base slot, not be rejected as unknown.
    photos = [_photo(i) for i in range(4)]
    page = Page(**sk.build_page_v3("interior", ["p0", "p1", "p2", "p3"], template_id="mag-10"))
    page = page.model_copy(update={"texts": {"cells[0]": "a caption", "cells[1]": "b caption"}})
    layout = fv3.finalize_v3(_request([_chapter("c1", photos)], [page]))
    assert fv3.validate_v3(layout) is None


def test_validate_rejects_unknown_text_slot():
    photos = [_photo(0)]
    page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-03"))
    page = page.model_copy(update={"texts": {"nonexistent": "x"}})
    with pytest.raises(fv3.FinalizeV3Error):
        fv3.finalize_v3(_request([_chapter("c1", photos)], [page]))


def test_validate_rejects_bracket_key_for_plain_text_slot():
    photos = [_photo(0)]
    page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-03"))
    # mag-03 declares a plain `location` text slot, not an items/repeat base.
    page = page.model_copy(update={"texts": {"location[0]": "not a repeat slot"}})
    with pytest.raises(fv3.FinalizeV3Error):
        fv3.finalize_v3(_request([_chapter("c1", photos)], [page]))


def test_validate_reuse_cap_is_album_wide_twice_no_cover_exemption():
    # V3 cover is optional, so there is NO page-0 exemption (unlike v2). Every
    # placement counts: a photo may appear at most twice TOTAL across the album.
    from src.schemas import AlbumLayoutPlan, LayoutPhotoAnalysis, Magazine

    def _plan(template_ids: list[str]) -> AlbumLayoutPlan:
        pages = [
            Page(**sk.build_page_v3("interior", ["p0"], template_id=tid, page_index=i))
            for i, tid in enumerate(template_ids)
        ]
        return AlbumLayoutPlan(
            magazine=Magazine(title="t", subtitle=None, style="editorial", language="en"),
            photos=[LayoutPhotoAnalysis(photoId="p0", description="d", tags=[], quality="detail", orientation="landscape")],
            pages=pages,
        )

    # 2 placements == cap, accepted.
    assert fv3.validate_v3(_plan(["mag-03", "mag-05"])) is None
    # 3 placements > cap of 2 => rejected even though one is on page 0 (no cover
    # exemption — page 0 is a plain interior page here).
    bad = fv3.validate_v3(_plan(["mag-03", "mag-05", "mag-06"]))
    assert "reused more than 2 times" in (bad or "")


def test_validate_rejects_unused_photo():
    from src.schemas import AlbumLayoutPlan, LayoutPhotoAnalysis, Magazine

    page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-03"))
    plan = AlbumLayoutPlan(
        magazine=Magazine(title="t", subtitle=None, style="editorial", language="en"),
        photos=[
            LayoutPhotoAnalysis(photoId="p0", description="d", tags=[], quality="detail", orientation="landscape"),
            LayoutPhotoAnalysis(photoId="ghost", description="d", tags=[], quality="detail", orientation="landscape"),
        ],
        pages=[page],
    )
    assert "unused photos" in (fv3.validate_v3(plan) or "")


def test_zh_default_title_when_no_description():
    photos = [_photo(0)]
    chapter = _chapter("c1", photos, description="")
    page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-03"))
    layout = fv3.finalize_v3(_request([chapter], [page], language="zh"))
    assert layout.magazine.title == "照片里的时光"


# =============================================================================
# WP5.1 (#194) — flatten + 单一 validate + variableDecor 烘焙(svg 收口)
# =============================================================================

_ACCENT = "#C0392B"
_FONT = "script-elegant"


def _themed_chapter(
    chapter_id: str,
    photos: list[V3ChapterPhoto],
    *,
    accent: str | None = _ACCENT,
    font: str | None = _FONT,
    description: str = "desc",
) -> V3Chapter:
    return V3Chapter(
        chapterId=chapter_id,
        description=description,
        accentColor=accent,
        artFont=font,
        photos=photos,
    )


def test_flat_output_is_only_magazine_photos_pages_no_tree_field():
    # §3 树边界: the flattened contract is exactly magazine + photos + pages[]; a page
    # carries only pageIndex/templateId/images/texts/imagePos — never a tree-shaped
    # field (chapterId/accentColor/artFont/variableDecor live ONLY in the tree).
    photos = [_photo(0)]
    chapter = _themed_chapter("c1", photos)
    page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-08"))
    layout = fv3.finalize_v3(_request([chapter], [page]))

    assert set(layout.model_dump().keys()) == {"magazine", "photos", "pages"}
    allowed_page_keys = {"pageIndex", "templateId", "images", "texts", "imagePos"}
    for flat in layout.pages:
        assert set(flat.model_dump().keys()) <= allowed_page_keys
        for forbidden in ("chapterId", "accentColor", "artFont", "variableDecor", "tree"):
            assert forbidden not in flat.texts
            assert forbidden not in flat.images


def test_single_validate_passes_on_baked_layout():
    # The SINGLE validate_v3 (§6.8 第 7 条) accepts the baked svg/items/variableDecor/
    # 章节色/字体 keys it itself produced — finalize never emits a layout its own
    # validate would reject.
    photos = [_photo(0)]
    chapter = _themed_chapter("c1", photos)
    page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-13"))
    page = page.model_copy(update={"texts": {"title": "Homecoming"}})
    layout = fv3.finalize_v3(_request([chapter], [page]))
    assert fv3.validate_v3(layout) is None


def test_chapter_color_and_font_baked_into_title_variable_decor_slot():
    # mag-08 `title` is a variableDecor title (user prose). Its prose is kept verbatim;
    # the chapter accentColor/artFont ride sibling carrier keys (§3 树边界: baked into
    # flat texts, no tree field).
    photos = [_photo(0)]
    chapter = _themed_chapter("c1", photos)
    page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-08"))
    page = page.model_copy(update={"texts": {"title": "Homecoming"}})
    layout = fv3.finalize_v3(_request([chapter], [page]))
    texts = layout.pages[0].texts
    assert texts["title"] == "Homecoming"  # prose untouched
    assert texts["title#accentColor"] == _ACCENT
    assert texts["title#artFont"] == _FONT
    assert fv3.validate_v3(layout) is None


def test_empty_decoration_variable_decor_slot_stays_empty_theme_rides_carrier():
    # mag-03 `location` is a variableDecor text decoration slot. Missing/empty
    # visible content must stay missing/empty; theme rides sibling carrier keys so a
    # color token never becomes user-facing text.
    photos = [_photo(0), _photo(1)]
    chapter = _themed_chapter("c1", photos)
    missing = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-03", page_index=0))
    empty = Page(**sk.build_page_v3("interior", ["p1"], template_id="mag-03", page_index=1))
    empty = empty.model_copy(update={"texts": {"location": ""}})

    layout = fv3.finalize_v3(_request([chapter], [missing, empty]))

    missing_texts = layout.pages[0].texts
    assert "location" not in missing_texts
    assert missing_texts["location#accentColor"] == _ACCENT
    assert missing_texts["location#artFont"] == _FONT

    empty_texts = layout.pages[1].texts
    assert empty_texts["location"] == ""
    assert empty_texts["location#accentColor"] == _ACCENT
    assert empty_texts["location#artFont"] == _FONT


def test_nonempty_decoration_value_is_preserved_color_rides_carrier():
    # mag-08 `dateNum` is a variableDecor decoration slot. A code-owned value (a date)
    # is NEVER clobbered; the accent rides a carrier key instead.
    photos = [_photo(0)]
    chapter = _themed_chapter("c1", photos)
    page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-08"))
    page = page.model_copy(update={"texts": {"dateNum": "08/24"}})
    layout = fv3.finalize_v3(_request([chapter], [page]))
    texts = layout.pages[0].texts
    assert texts["dateNum"] == "08/24"  # date preserved
    assert texts["dateNum#accentColor"] == _ACCENT


def test_svg_variable_decor_slot_baked_into_flat_page_seam_closed():
    # WP3.2 seam收口: mag-13 svg `divider` is a variableDecor vector → finalize lands
    # its accent color into the flat page.texts (re-derived from the tree, the single
    # source of truth — even if apply-theme never ran or wrote a stale value).
    photos = [_photo(0)]
    chapter = _themed_chapter("c1", photos)
    page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-13"))
    page = page.model_copy(update={"texts": {"title": "Two", "divider": "#000000"}})
    layout = fv3.finalize_v3(_request([chapter], [page]))
    texts = layout.pages[0].texts
    assert texts["divider"] == _ACCENT  # seam value re-baked from the tree
    assert texts["title"] == "Two"
    assert fv3.validate_v3(layout) is None


def test_validate_rejects_svg_sibling_carrier_but_accepts_bare_svg_color():
    # SVG variableDecor is value-as-color (`divider: "#C0392B"`). Sibling carrier
    # keys are only legal for text/items text variableDecor slots.
    from src.schemas import AlbumLayoutPlan, LayoutPhotoAnalysis, Magazine

    base_page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-13"))
    valid_page = base_page.model_copy(update={"texts": {"title": "Two", "divider": _ACCENT}})
    invalid_page = base_page.model_copy(
        update={"texts": {"title": "Two", "divider#accentColor": _ACCENT}}
    )

    base_plan = {
        "magazine": Magazine(title="t", subtitle=None, style="editorial", language="en"),
        "photos": [
            LayoutPhotoAnalysis(
                photoId="p0",
                description="d",
                tags=[],
                quality="detail",
                orientation="landscape",
            )
        ],
    }

    valid_plan = AlbumLayoutPlan(**base_plan, pages=[valid_page])
    invalid_plan = AlbumLayoutPlan(**base_plan, pages=[invalid_page])

    assert fv3.validate_v3(valid_plan) is None
    problem = fv3.validate_v3(invalid_plan)
    assert problem is not None
    assert "carrier" in problem
    assert "no text variableDecor slot" in problem


def test_items_group_variable_decor_is_baked():
    # mag-02 `items.texts` carries a variableDecor decoration (`numbers`) and a
    # variableDecor title (`titles`). The items repeat group is themed via sibling
    # carriers: empty decoration stays absent/empty; title prose stays verbatim.
    template = templates.get("mag-02")
    texts: dict[str, str] = {"titles[0]": "Chapter One", "numbers[0]": ""}
    fv3._bake_text_slots(texts, template["items"]["texts"], _ACCENT, _FONT)
    assert texts["numbers[0]"] == ""
    assert "numbers" not in texts
    assert texts["numbers[0]#accentColor"] == _ACCENT
    assert texts["numbers[0]#artFont"] == _FONT
    assert texts["titles[0]"] == "Chapter One"  # title prose kept
    assert texts["titles[0]#accentColor"] == _ACCENT
    assert texts["titles[0]#artFont"] == _FONT


def test_validate_accepts_item_text_carriers_when_top_level_repeat_slot_shares_id():
    # mag-02 keeps legacy top-level repeat slots (`numbers` / `titles`) that are
    # not variableDecor, while the same ids under `items.texts` are variableDecor.
    # Carrier validation must accept the item slot instead of stopping at the
    # top-level repeat slot.
    from src.schemas import AlbumLayoutPlan, Magazine

    page = Page(
        pageIndex=0,
        templateId="mag-02",
        images={},
        texts={
            "numbers[0]": "01",
            "numbers[0]#accentColor": _ACCENT,
            "titles[0]": "Beginnings",
            "titles[0]#accentColor": _ACCENT,
        },
    )
    plan = AlbumLayoutPlan(
        magazine=Magazine(title="t", subtitle=None, style="editorial", language="en"),
        photos=[],
        pages=[page],
    )

    assert fv3.validate_v3(plan) is None


def test_plain_body_text_not_touched_by_bake():
    # 普通正文 (non-variableDecor body/explain) is never themed. mag-19's body-style
    # slots stay byte-identical; only the variableDecor `intro` title gets a carrier.
    photos = [_photo(0)]
    chapter = _themed_chapter("c1", photos)
    page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-19"))
    page = page.model_copy(update={"texts": {"intro": "Once upon a time"}})
    layout = fv3.finalize_v3(_request([chapter], [page]))
    texts = layout.pages[0].texts
    assert texts["intro"] == "Once upon a time"  # prose untouched
    # no spurious color written onto the prose value itself
    assert texts["intro"] != _ACCENT


def test_no_bake_when_chapter_theme_unset():
    # A chapter with null accentColor (theme环节 not done) is left un-themed — finalize
    # bakes nothing, the page texts are byte-identical to input.
    photos = [_photo(0)]
    chapter = _chapter("c1", photos)  # accentColor=None
    page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-08"))
    page = page.model_copy(update={"texts": {"title": "Homecoming"}})
    layout = fv3.finalize_v3(_request([chapter], [page]))
    texts = layout.pages[0].texts
    assert texts == {"title": "Homecoming"}
    assert "title#accentColor" not in texts


def test_page_with_no_owning_chapter_is_not_baked():
    # A photo-less toc page (mag-02, 0 images) maps to no chapter → never themed.
    photos = [_photo(0)]
    chapter = _themed_chapter("c1", photos)
    body = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-08", page_index=0))
    toc = Page(pageIndex=1, templateId="mag-02", images={}, texts={"heading": "Contents"})
    layout = fv3.finalize_v3(_request([chapter], [body, toc]))
    toc_flat = layout.pages[1]
    assert toc_flat.texts == {"heading": "Contents"}  # un-themed (no owning chapter)


def test_validate_rejects_carrier_without_variable_decor_slot():
    # A theme carrier is only legal for a declared variableDecor slot. mag-06 has NO
    # variableDecor slot, so a stray carrier key must be rejected by the single validate.
    from src.schemas import AlbumLayoutPlan, LayoutPhotoAnalysis, Magazine

    page = Page(**sk.build_page_v3("interior", ["p0"], template_id="mag-06"))
    page = page.model_copy(update={"texts": {"caption#accentColor": _ACCENT}})
    plan = AlbumLayoutPlan(
        magazine=Magazine(title="t", subtitle=None, style="editorial", language="en"),
        photos=[LayoutPhotoAnalysis(photoId="p0", description="d", tags=[], quality="detail", orientation="landscape")],
        pages=[page],
    )
    problem = fv3.validate_v3(plan)
    assert problem is not None and "carrier" in problem


# ---------- /v3/finalize route (WP5.1) ---------------------------------------


def _client():
    from fastapi.testclient import TestClient

    from src.main import app

    return TestClient(app)


def _route_body() -> dict:
    return {
        "albumId": "alb_v3",
        "language": "en",
        "tree": {
            "chapters": [
                {
                    "chapterId": "c1",
                    "description": "A day out",
                    "accentColor": _ACCENT,
                    "artFont": _FONT,
                    "photos": [
                        {
                            "photoId": "p0",
                            "sceneDescription": "scene 0",
                            "width": 800,
                            "height": 600,
                            "orientation": "landscape",
                        }
                    ],
                }
            ]
        },
        "pages": [
            {"pageIndex": 0, "templateId": "mag-08", "images": {"image": "p0"}, "texts": {"title": "Homecoming"}}
        ],
    }


def test_route_requires_auth() -> None:
    res = _client().post("/v3/finalize", json=_route_body())
    assert res.status_code == 401


def test_route_happy_path_returns_flat_layout_envelope() -> None:
    from src.schemas import V3FinalizeResponse

    res = _client().post(
        "/v3/finalize",
        json=_route_body(),
        headers={"Authorization": "Bearer test_secret"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    parsed = V3FinalizeResponse(**body["data"])  # two-end parity
    assert set(parsed.layout.model_dump().keys()) == {"magazine", "photos", "pages"}
    flat = parsed.layout.pages[0]
    assert flat.texts["title"] == "Homecoming"
    assert flat.texts["title#accentColor"] == _ACCENT


def test_route_validate_violation_is_422_contract_error() -> None:
    body = _route_body()
    # Reference a photo the tree doesn't carry → validate_v3 unused/missing violation.
    body["pages"][0]["images"] = {"image": "ghost"}
    res = _client().post(
        "/v3/finalize",
        json=body,
        headers={"Authorization": "Bearer test_secret"},
    )
    assert res.status_code == 422
    detail = res.json().get("detail", res.json())
    assert detail["ok"] is False
    assert detail["error"]["code"] == "AGENT_OUTPUT_VALIDATION"
