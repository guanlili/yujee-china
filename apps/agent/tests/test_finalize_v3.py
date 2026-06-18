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


def test_validate_rejects_missing_image_slot():
    photos = [_photo(0), _photo(1)]
    # mag-07 holds 2; drop one slot so a declared slot is unfilled.
    page = Page(**sk.build_page_v3("interior", ["p0", "p1"], template_id="mag-07"))
    layout = fv3.finalize_v3(_request([_chapter("c1", photos)], [page]))
    short = dict(layout.pages[0].images)
    short.pop(next(iter(short)))
    broken = layout.model_copy(
        update={"pages": [layout.pages[0].model_copy(update={"images": short})]}
    )
    assert "missing image slot" in (fv3.validate_v3(broken) or "")


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
