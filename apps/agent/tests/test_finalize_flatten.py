"""Acceptance tests for Stage 5 finalize (tech-plan §9.2 / §5.2).

Covers: derive_default_theme when /theme is skipped (B7), tree → contiguous
flat pageIndex, cover→toc?→chapters→ending order, the TOC threshold + flat
bracket-path `titles[i]` keys (P0-3), 30-photo bound + no dropped photo
(M2), the ≤2 non-cover reuse budget for 1-photo albums (P0-4), the all-fill
cover/ending hero exemption with chapter pages NOT exempt (B8), first-page
detection by category=='cover' (P2-9), and "finalize with no chat at all".
"""

from __future__ import annotations

import re

import pytest

from src.schemas import Magazine, Page, PhotoAnalysis
from src.schemas_v2 import (
    AlbumDraft,
    LayoutV2,
    V2BasePages,
    V2Brief,
    V2Chapter,
    V2Cluster,
    V2Exif,
    V2Meta,
    V2Photo,
    V2PhotoAnalysis,
    V2ThemePartial,
)
from src.services import finalize, skeleton


# ---------- fixture builders --------------------------------------------------


def _photo(
    idx: int,
    quality: str = "detail",
    orientation: str = "portrait",
    used: bool = True,
    people_count: str = "1",
    focal: dict | None = None,
) -> V2Photo:
    pid = f"p{idx:03d}"
    return V2Photo(
        photoId=pid,
        analysis=V2PhotoAnalysis(
            photoId=pid,
            description=f"photo {idx}",
            tags=["trip"],
            quality=quality,  # type: ignore[arg-type]
            orientation=orientation,  # type: ignore[arg-type]
            focal=focal,  # type: ignore[arg-type]
            peopleCount=people_count,
            scene="outdoor",
            mood="warm",
        ),
        exif=V2Exif(takenAt=None, place=None, order=idx),
        used=used,
    )


def _chapter(
    cid: str,
    photos: list[V2Photo],
    *,
    state: str = "empty",
    role: str = "body",
    label: str = "A day out",
    brief: V2Brief | None = None,
    place: str | None = None,
    time_range: str | None = None,
) -> V2Chapter:
    skeleton_photos = [finalize._skeleton_photo(p) for p in photos]
    pages = [Page(**pg) for pg in skeleton.build_chapter_pages("alb", cid, skeleton_photos)]
    return V2Chapter(
        chapterId=cid,
        state=state,  # type: ignore[arg-type]
        cluster=V2Cluster(label=label, place=place, timeRange=time_range, role=role),  # type: ignore[arg-type]
        photoIds=[p.photoId for p in photos],
        brief=brief,
        askCount=0,
        pages=pages,
    )


def _draft(
    photos: list[V2Photo],
    chapters: list[V2Chapter],
    *,
    theme: V2ThemePartial | None = None,
    prompt_hint: str | None = None,
    style: str = "warm-film",
    language: str = "en",
    cover: Page | None = None,
) -> AlbumDraft:
    return AlbumDraft(
        version="v2",
        meta=V2Meta(theme=theme, style=style, language=language, promptHint=prompt_hint),  # type: ignore[arg-type]
        photoPool=photos,
        # finalize re-derives ending (and the cover unless one is supplied here as
        # a /theme-authored cover); these placeholders satisfy the input schema.
        basePages=V2BasePages(
            cover=cover or Page(pageIndex=0, templateId="mag-01", images={}, texts={}),
            ending=Page(pageIndex=0, templateId="mag-03", images={}, texts={}),
        ),
        chapters=chapters,
    )


def _used_image_ids(layout: LayoutV2) -> list[str]:
    return [pid for page in layout.pages for pid in page.images.values()]


def _assert_well_formed(layout: LayoutV2) -> None:
    assert finalize.validate_v2(layout) is None
    # contiguous pageIndex 0..N-1
    assert [page.pageIndex for page in layout.pages] == list(range(len(layout.pages)))
    # first is a cover-category template; last is a legal final page.
    from src import templates as registry

    assert registry.get(layout.pages[0].templateId)["slot"] == "cover"
    assert registry.get(layout.pages[-1].templateId) is not None


# ---------- tests -------------------------------------------------------------


def test_finalize_with_no_chat_derives_default_theme_and_completes():
    """Whole flow with zero chatting: theme absent, every chapter empty."""
    photos = [_photo(i, quality=q) for i, q in enumerate(["hero", "detail", "detail", "fill"], 1)]
    draft = _draft(
        photos,
        [_chapter("c1", photos, state="empty")],
        theme=None,
        prompt_hint="Summer by the sea",
    )

    layout = finalize.finalize(draft)

    _assert_well_formed(layout)
    # derive_default_theme used the prompt hint as the subject (B7)
    assert layout.magazine.title == "Summer by the sea"
    # cover is non-empty (some real template), ending present
    assert layout.pages[0].templateId
    assert len(layout.pages) >= 3  # cover + at least one body + ending


def test_finalize_subject_falls_back_to_first_chapter_label():
    photos = [_photo(1, "detail"), _photo(2, "detail")]
    draft = _draft(
        photos,
        [_chapter("c1", photos, label="Mountain trip")],
        theme=None,
        prompt_hint=None,
    )

    layout = finalize.finalize(draft)

    assert layout.magazine.title == "Mountain trip"
    _assert_well_formed(layout)


def test_single_photo_uses_cover_display_and_non_cover_photo_twice():
    """1-photo album: body 1× + ending 1× = 2 ≤ cap; cover display is allowed."""
    photos = [_photo(1, "hero")]
    draft = _draft(photos, [_chapter("c1", photos)], prompt_hint="One moment")

    layout = finalize.finalize(draft)

    _assert_well_formed(layout)
    assert layout.pages[0].templateId in {"mag-01", "mag-13", "p01"}
    assert _used_image_ids(layout).count("p001") >= 2
    non_cover_uses = [
        pid for page in layout.pages[1:] for pid in page.images.values()
    ]
    assert non_cover_uses.count("p001") == 2


def test_theme_authored_cover_is_preserved_not_re_derived():
    """A cover the user customized via /theme survives finalize (template + hero
    photo + title), instead of being clobbered by re-derivation."""
    photos = [
        _photo(1, "detail", orientation="portrait"),
        _photo(2, "detail", orientation="landscape"),
        _photo(3, "detail", orientation="portrait"),
    ]
    chapter = _chapter("c1", photos)
    custom_cover = Page(
        pageIndex=0,
        templateId="mag-13",  # image cover (landscape hero/detail slot)
        images={"image": "p002"},
        texts={"title": "My Chosen Title"},
    )
    draft = _draft(
        photos,
        [chapter],
        theme=V2ThemePartial(subject="Our Trip", tone="warm", style="warm-film"),
        cover=custom_cover,
    )

    layout = finalize.finalize(draft)

    _assert_well_formed(layout)
    cover = layout.pages[0]
    assert cover.templateId == "mag-13"  # user template preserved
    assert cover.images == {"image": "p002"}  # user hero photo preserved
    assert cover.texts.get("title") == "My Chosen Title"  # user copy preserved


def test_theme_missing_re_derives_cover_ignoring_stale_basepage():
    """Without a /theme subject, finalize re-derives the cover under the budget
    so a stale placeholder basePage is not trusted."""
    photos = [_photo(1, "fill")]
    draft = _draft(
        photos,
        [_chapter("c1", photos)],
        theme=None,
        prompt_hint="Solo",
        cover=Page(pageIndex=0, templateId="mag-13", images={"image": "p001"}, texts={}),
    )

    layout = finalize.finalize(draft)

    _assert_well_formed(layout)
    assert layout.pages[0].templateId in {"mag-01", "mag-13", "p01"}
    assert "p001" in layout.pages[0].images.values()


def test_flatten_order_is_cover_then_chapters_then_ending_without_toc():
    photos = [_photo(i, "detail") for i in range(1, 5)]
    draft = _draft(photos, [_chapter("c1", photos[:2]), _chapter("c2", photos[2:])])

    layout = finalize.finalize(draft)

    _assert_well_formed(layout)
    # 2 chapters → no TOC
    assert all(page.templateId != "mag-02" for page in layout.pages)
    # nothing between cover (0) and first chapter body page
    assert layout.pages[1].templateId != "mag-02"


def test_toc_added_when_four_chapters_and_eight_pages_with_flat_bracket_keys():
    # 4 chapters × 6 detail photos → [3,3] = 2 pages each = 8 body pages,
    # crossing both TOC thresholds (≥4 chapters AND ≥8 pages).
    photos = [_photo(i, "detail") for i in range(1, 25)]
    chapters = [
        _chapter(f"c{n}", photos[n * 6 : n * 6 + 6], label=f"Chapter {n + 1}")
        for n in range(4)
    ]
    draft = _draft(photos, chapters)

    layout = finalize.finalize(draft)

    _assert_well_formed(layout)
    assert layout.pages[1].templateId == "mag-02"  # TOC sits right after the cover
    toc = layout.pages[1]
    assert toc.images == {}
    # P0-3: flat bracket-path keys, every value a plain string (never a list)
    assert toc.texts, "TOC must carry chapter titles"
    title_keys = [key for key in toc.texts if key.startswith("titles[")]
    for key in title_keys:
        assert re.fullmatch(r"titles\[\d+\]", key), key
    for value in toc.texts.values():
        assert isinstance(value, str)
    # one entry per chapter, in order
    titles = [toc.texts[f"titles[{i}]"] for i in range(4)]
    assert titles == [f"Chapter {i + 1}" for i in range(4)]


def test_toc_titles_are_clamped_to_the_array_slot_budget():
    long_label = "L" * 300  # mag-02 titles recommend <= 16 chars
    photos = [_photo(i, "detail") for i in range(1, 25)]
    chapters = [
        _chapter(f"c{n}", photos[n * 6 : n * 6 + 6], label=(long_label if n == 0 else f"Chapter {n + 1}"))
        for n in range(4)
    ]
    draft = _draft(photos, chapters)

    layout = finalize.finalize(draft)

    toc = next(p for p in layout.pages if p.templateId == "mag-02")
    assert len(toc.texts["titles[0]"]) <= 16  # clamped, not the raw 300


def test_toc_skipped_when_four_chapters_but_under_eight_pages():
    # 4 chapters × 1 photo = 4 body + cover + ending = 6 pages (< 8) → no TOC.
    photos = [_photo(i, "detail") for i in range(1, 5)]
    chapters = [_chapter(f"c{n}", [photos[n]], label=f"C{n}") for n in range(4)]
    draft = _draft(photos, chapters)

    layout = finalize.finalize(draft)

    _assert_well_formed(layout)
    assert all(page.templateId != "mag-02" for page in layout.pages)


def test_thirty_photos_stays_within_48_pages_and_drops_nothing():
    photos = [_photo(i, ["hero", "detail", "fill"][i % 3]) for i in range(1, 31)]
    chapters = [
        _chapter(f"c{n}", photos[n * 6 : n * 6 + 6], label=f"Part {n + 1}")
        for n in range(5)
    ]
    draft = _draft(photos, chapters)

    layout = finalize.finalize(draft)

    _assert_well_formed(layout)
    assert 1 <= len(layout.pages) <= 48
    # every used photo still appears at least once (no dropped image, M2)
    used_ids = {p.photoId for p in photos}
    assert used_ids.issubset(set(_used_image_ids(layout)))
    # photos[] mirrors the used pool and stays within the reuse cap
    assert {p.photoId for p in layout.photos} == used_ids
    counts = {pid: _used_image_ids(layout).count(pid) for pid in used_ids}
    assert all(1 <= c <= 2 for c in counts.values())


def test_all_fill_album_exempts_cover_and_ending_from_hero_rule():
    photos = [_photo(i, "fill") for i in range(1, 6)]
    draft = _draft(photos, [_chapter("c1", photos)], prompt_hint="Quiet days")

    layout = finalize.finalize(draft)

    _assert_well_formed(layout)  # passes despite all-fill, thanks to the exemption
    assert layout.pages[0].templateId in {"mag-01", "mag-13", "p01"}
    ending = layout.pages[-1]
    assert list(ending.images.values())  # final page still carries an image


def test_extension_fields_are_stripped_from_output_photos():
    photos = [_photo(1, "detail"), _photo(2, "detail")]
    layout = finalize.finalize(_draft(photos, [_chapter("c1", photos)]))

    for photo in layout.photos:
        assert photo.scene is None
        assert photo.mood is None
        assert photo.peopleCount is None
        assert photo.timeOfDay is None
        assert photo.location is None


def test_unused_pool_photos_excluded_from_layout_photos():
    used = [_photo(1, "detail"), _photo(2, "detail")]
    folded = _photo(3, "fill", used=False)
    draft = _draft(used + [folded], [_chapter("c1", used)])

    layout = finalize.finalize(draft)

    _assert_well_formed(layout)
    assert {p.photoId for p in layout.photos} == {"p001", "p002"}


def test_generated_chapter_keeps_authored_text_untouched():
    photos = [_photo(1, "detail", orientation="landscape", people_count="0")]
    chapter = _chapter("c1", photos, state="generated")
    chapter.pages[0] = Page(pageIndex=0, templateId="mag-05", images={"image": "p001"}, texts={})
    # authored copy on the body page
    body = chapter.pages[0]
    authored = {meta["id"]: "user authored copy" for meta in
                _text_slots(body.templateId) if meta["role"] != "decoration"}
    chapter.pages[0] = body.model_copy(update={"texts": authored})
    draft = _draft(photos, [chapter])

    layout = finalize.finalize(draft)

    body_pages = [p for p in layout.pages if p.templateId == body.templateId]
    assert body_pages
    # the authored values survive (clamped, but starting from the author's text)
    assert any("user authored" in v for v in body_pages[0].texts.values())


def test_empty_chapter_gets_ambiance_copy_with_only_cluster_facts():
    photos = [_photo(1, "detail", orientation="landscape", people_count="0")]
    chapter = _chapter("c1", photos, state="empty", place="Kyoto", time_range="spring")
    chapter.pages[0] = Page(pageIndex=0, templateId="mag-05", images={"image": "p001"}, texts={})
    draft = _draft(
        photos,
        [chapter],
    )

    layout = finalize.finalize(draft)

    _assert_well_formed(layout)
    body = next(p for p in layout.pages[1:-1])
    assert body.texts  # ambiance copy was filled in
    blob = " ".join(body.texts.values())
    # the only concrete names allowed are the EXIF/cluster facts from the tree
    assert "Kyoto" in blob  # cluster.place surfaces
    assert "spring" in blob  # cluster.timeRange surfaces
    # nothing the model could have invented — descriptions are not leaked verbatim
    assert "photo 1" not in blob


# ---------- validate_v2 direct unit tests -------------------------------------


def _mag(language: str = "en") -> Magazine:
    return Magazine(title="T", subtitle=None, style="warm-film", language=language)


def _pa(pid: str, quality: str = "detail", orientation: str = "portrait") -> PhotoAnalysis:
    return PhotoAnalysis(
        photoId=pid, description="", tags=[], quality=quality, orientation=orientation  # type: ignore[arg-type]
    )


def _text_slots(template_id: str):
    from src import templates as registry

    return registry.get(template_id)["texts"]


def test_validate_rejects_first_page_not_cover():
    layout = LayoutV2(
        magazine=_mag(),
        photos=[_pa("p1")],
        pages=[Page(pageIndex=0, templateId="mag-19", images={"image": "p1"}, texts={})],
    )
    problem = finalize.validate_v2(layout)
    assert problem is not None and "must be cover" in problem


def test_validate_rejects_fill_in_hero_on_chapter_page_but_not_on_ending():
    fill = _pa("f1", quality="fill")
    other = _pa("d1", quality="detail")

    # fill photo in mag-03's hero slot on a MIDDLE page → violation
    bad = LayoutV2(
        magazine=_mag(),
        photos=[fill, other],
        pages=[
            Page(pageIndex=0, templateId="mag-01", images={"image": "f1"}, texts={"heading": "T"}),
            Page(pageIndex=1, templateId="mag-03", images={"image": "f1"}, texts={}),
            Page(pageIndex=2, templateId="mag-19", images={"image": "d1"}, texts={}),
        ],
    )
    problem = finalize.validate_v2(bad)
    assert problem is not None and "hero slot" in problem

    # same fill photo in the ENDING's hero slot (last page) → exempt, OK
    good = LayoutV2(
        magazine=_mag(),
        photos=[fill, other],
        pages=[
            Page(pageIndex=0, templateId="mag-01", images={"image": "d1"}, texts={"heading": "T"}),
            Page(pageIndex=1, templateId="mag-19", images={"image": "d1"}, texts={}),
            Page(pageIndex=2, templateId="mag-03", images={"image": "f1"}, texts={}),
        ],
    )
    assert finalize.validate_v2(good) is None


def test_validate_rejects_reuse_over_twice():
    photo = _pa("p1", quality="detail")
    layout = LayoutV2(
        magazine=_mag(),
        photos=[photo],
        pages=[
            Page(pageIndex=0, templateId="mag-01", images={"image": "p1"}, texts={"heading": "T"}),
            Page(pageIndex=1, templateId="mag-19", images={"image": "p1"}, texts={}),
            Page(pageIndex=2, templateId="mag-19", images={"image": "p1"}, texts={}),
            Page(pageIndex=3, templateId="mag-03", images={"image": "p1"}, texts={}),
        ],
    )
    problem = finalize.validate_v2(layout)
    assert problem is not None and "reused more than 2" in problem


def test_validate_rejects_non_sequential_page_index():
    layout = LayoutV2(
        magazine=_mag(),
        photos=[_pa("p1")],
        pages=[
            Page(pageIndex=0, templateId="mag-01", images={"image": "p1"}, texts={"heading": "T"}),
            Page(pageIndex=5, templateId="mag-19", images={"image": "p1"}, texts={}),
        ],
    )
    problem = finalize.validate_v2(layout)
    assert problem is not None and "sequential" in problem


def test_validate_rejects_unused_photo():
    layout = LayoutV2(
        magazine=_mag(),
        photos=[_pa("p1"), _pa("ghost")],
        pages=[
            Page(pageIndex=0, templateId="mag-01", images={"image": "p1"}, texts={"heading": "T"}),
            Page(pageIndex=1, templateId="mag-19", images={"image": "p1"}, texts={}),
        ],
    )
    problem = finalize.validate_v2(layout)
    assert problem is not None and "unused photos" in problem


def test_finalize_raises_on_validation_failure(monkeypatch):
    photos = [_photo(1, "detail"), _photo(2, "detail")]
    draft = _draft(photos, [_chapter("c1", photos)])

    monkeypatch.setattr(finalize, "validate_v2", lambda layout: "boom")
    with pytest.raises(finalize.FinalizeError, match="boom"):
        finalize.finalize(draft)
