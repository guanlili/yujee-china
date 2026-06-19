"""V3 apply-theme — deterministic 刷 variableDecor 槽 (WP3.2 / #190).

Covers the acceptance:
  ① only variableDecor slots are brushed; 普通正文 (body/explain/non-variableDecor) untouched.
  ② SVG (variableDecor svg) layers are filled with the accent color.
  ③ each chapter's color/font is applied per the chapter choice (章级粒度).
  ④ illegal color/font is impossible to inject (the strict DTO rejects it at parse).
  ⑤ idempotent — re-applying the same theme yields the same patch.

Grounded in real templates (mag-08: variableDecor `dateNum`+`title`; mag-13: svg
`divider`). The v2 theme.py is untouched (Option B — apply lives in apply_theme_v3).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src import templates
from src.schemas import (
    Page,
    V3ApplyThemeRequest,
    V3ChapterThemeChoice,
    V3ThemeOption,
)
from src.services import apply_theme_v3 as at
from src.services import finalize_v3 as fv3
from src.schemas import (
    AlbumLayoutPlan,
    LayoutPhotoAnalysis,
    Magazine,
)

_ACCENT = "#C0392B"
_FONT = "script-elegant"


def _theme() -> V3ThemeOption:
    return V3ThemeOption(subject="A Year Away", label="The Journey")


def _choice(chapter_id: str = "c1", accent: str = _ACCENT, font: str = _FONT) -> V3ChapterThemeChoice:
    return V3ChapterThemeChoice(chapterId=chapter_id, accentColor=accent, artFont=font)


def _page(template_id: str, *, texts: dict[str, str] | None = None, images: dict[str, str] | None = None, page_index: int = 0) -> Page:
    return Page(
        pageIndex=page_index,
        templateId=template_id,
        images=images or {},
        texts=texts or {},
    )


def _request(pages: list[Page], chapters: list[V3ChapterThemeChoice] | None = None) -> V3ApplyThemeRequest:
    return V3ApplyThemeRequest(
        albumId="album-1",
        language="en",
        theme=_theme(),
        chapters=chapters or [_choice()],
        pages=pages,
    )


# ──────────────────────────── ① only variableDecor; 正文不碰 ────────────────────────────


def test_brushes_only_variable_decor_text_slots_leaving_prose_untouched():
    # mag-08 variableDecor text slots = dateNum (decoration), title (title/user prose).
    # body/caption1/caption2 are NOT variableDecor → must stay exactly as given.
    page = _page(
        "mag-08",
        texts={
            "title": "Homecoming",       # variableDecor title (user prose) → untouched
            "body": "We drove north.",   # not variableDecor → untouched
            "caption1": "By the lake",   # not variableDecor → untouched
            # dateNum (variableDecor decoration) is EMPTY → gets the accent token
        },
        images={"image": "p1"},
    )
    resp = at.apply_theme(_request([page]))

    assert len(resp.layoutPatch) == 1
    patched = resp.layoutPatch[0].texts
    # 普通正文 + user-prose title preserved verbatim (普通正文不碰 / title 内容不重写).
    assert patched["body"] == "We drove north."
    assert patched["caption1"] == "By the lake"
    assert patched["title"] == "Homecoming"
    # Empty text decorations are not color carriers; only SVG variableDecor slots
    # may carry the accent color through page.texts.
    assert "dateNum" not in patched


def test_empty_decoration_text_value_is_never_replaced_with_accent_color():
    page = _page("mag-08", texts={"dateNum": "", "title": "Trip"}, images={"image": "p1"})
    resp = at.apply_theme(_request([page]))
    patched = resp.layoutPatch[0].texts
    assert patched["dateNum"] == ""
    assert patched["title"] == "Trip"


def test_non_empty_decoration_value_is_never_clobbered():
    # `dateNum` already holds a generic-copy date — theme recolors via the tree, the
    # code-owned value must survive (we never overwrite a non-empty decoration slot).
    # mag-08 also has the svg-less `title` (variableDecor prose) → page IS themable,
    # so an entry is emitted; the date value must be preserved verbatim within it.
    page = _page("mag-08", texts={"dateNum": "08/24", "title": "Trip"}, images={"image": "p1"})
    resp = at.apply_theme(_request([page]))
    patched = resp.layoutPatch[0].texts
    assert patched["dateNum"] == "08/24"   # non-empty decoration preserved
    assert patched["title"] == "Trip"      # title prose preserved


def test_page_with_only_user_prose_variable_decor_is_still_themable():
    # mag-19's only variableDecor slot is `intro` (title/prose). The page IS themable
    # (it has a variableDecor slot), so an entry is emitted — but the prose content is
    # preserved verbatim (color/font ride the tree, not the flat page).
    page = _page("mag-19", texts={"intro": "Once upon a time"}, page_index=0)
    resp = at.apply_theme(_request([page]))
    assert len(resp.layoutPatch) == 1
    assert resp.layoutPatch[0].texts["intro"] == "Once upon a time"


# ──────────────────────────── ② SVG 图层被填色 ────────────────────────────


def test_variable_decor_svg_layer_is_filled_with_accent_color():
    # mag-13 carries an svg slot `divider` with variableDecor:true.
    assert any(s["id"] == "divider" and s.get("variableDecor") for s in (templates.get("mag-13").get("svgs") or []))
    page = _page("mag-13", texts={"title": "Chapter Two"}, images={"image": "p1"})
    resp = at.apply_theme(_request([page]))
    patched = resp.layoutPatch[0].texts
    assert patched["divider"] == _ACCENT          # svg filled with accent
    assert patched["title"] == "Chapter Two"      # title prose untouched


def test_svg_themed_key_survives_finalize_v3_validate():
    # The svg-decoration carrier apply-theme writes into page.texts must pass the V3
    # finalize validate (additive svg-id recognition), so the theme survives flatten.
    layout = AlbumLayoutPlan(
        magazine=Magazine(title="T", subtitle=None, style="editorial", language="en"),
        photos=[LayoutPhotoAnalysis(photoId="p1", description="d", tags=[], quality="detail", orientation="landscape")],
        pages=[_page("mag-13", texts={"divider": _ACCENT, "title": "X"}, images={"image": "p1"})],
    )
    assert fv3.validate_v3(layout) is None


# ──────────────────────────── ③ 章级:每章色/字体按章节选择 ────────────────────────────


def test_applies_the_chapters_chosen_accent_color():
    other = "#1F618D"
    page = _page("mag-13", texts={}, images={"image": "p1"})
    resp = at.apply_theme(_request([page], chapters=[_choice(accent=other, font="sans-modern")]))
    assert resp.layoutPatch[0].texts["divider"] == other


def test_single_chapter_governs_all_its_pages():
    pages = [
        _page("mag-08", texts={}, images={"image": "p1"}, page_index=0),
        _page("mag-13", texts={"title": "Two"}, images={"image": "p2"}, page_index=1),
    ]
    resp = at.apply_theme(_request(pages, chapters=[_choice(accent="#2ECC71")]))
    by_index = {e.pageIndex: e.texts for e in resp.layoutPatch}
    assert "dateNum" not in by_index[0]
    assert by_index[1]["divider"] == "#2ECC71"


def test_rejects_ambiguous_multi_chapter_pages_request():
    pages = [
        _page("mag-13", texts={"title": "One"}, images={"image": "p1"}, page_index=0),
        _page("mag-13", texts={"title": "Two"}, images={"image": "p2"}, page_index=1),
    ]
    with pytest.raises(at.ApplyThemeV3Error, match="ambiguous multi-chapter"):
        at.apply_theme(_request(pages, chapters=[_choice("c1"), _choice("c2", accent="#1F618D")]))


# ──────────────────────────── ④ 非法色/字体兜底 ────────────────────────────


def test_illegal_accent_color_rejected_at_parse():
    with pytest.raises(ValidationError):
        V3ChapterThemeChoice(chapterId="c1", accentColor="not-a-color", artFont=_FONT)


def test_illegal_art_font_rejected_at_parse():
    with pytest.raises(ValidationError):
        V3ChapterThemeChoice(chapterId="c1", accentColor=_ACCENT, artFont="comic-sans")


def test_empty_plan_raises_apply_theme_error():
    # mag-06 has NO variableDecor slot → page is not themable → no patch → error
    # (contract layoutPatch.min(1); a no-op apply is a caller bug).
    page = _page("mag-06")
    with pytest.raises(at.ApplyThemeV3Error):
        at.apply_theme(_request([page]))


# ──────────────────────────── ⑤ 幂等 ────────────────────────────


def test_apply_theme_is_idempotent():
    page = _page("mag-13", texts={"title": "Stay"}, images={"image": "p1"})
    req = _request([page])
    first = at.apply_theme(req)
    # Re-feed the brushed page back in: the same theme yields the same texts (no drift).
    rebrushed = Page(
        pageIndex=0,
        templateId="mag-13",
        images={"image": "p1"},
        texts=first.layoutPatch[0].texts,
    )
    second = at.apply_theme(_request([rebrushed]))
    assert second.layoutPatch[0].texts == first.layoutPatch[0].texts
