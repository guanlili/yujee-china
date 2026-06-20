"""V3 apply-theme — deterministic 刷 variableDecor 槽 + subject→标题 (WP3.2 / #190 / #236).

Covers the acceptance:
  ① only variableDecor slots are brushed; 普通正文 (body/explain/non-variableDecor) untouched.
  ② SVG (variableDecor svg) layers are filled with the accent color.
  ③ each chapter's color/font is applied per the chapter choice (章级粒度).
  ④ illegal color/font is impossible to inject (the strict DTO rejects it at parse).
  ⑤ idempotent — re-applying the same theme yields the same patch.
  ⑥ #236: the per-chapter `subject` is written into the chapter's `title` slot
     (the chapter title is persisted), clamped to the slot's maxChars.

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
_SUBJECT = "A Year Away"


def _choice(
    chapter_id: str = "c1", accent: str = _ACCENT, font: str = _FONT, subject: str = _SUBJECT
) -> V3ChapterThemeChoice:
    return V3ChapterThemeChoice(
        chapterId=chapter_id, subject=subject, accentColor=accent, artFont=font
    )


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
        chapters=chapters or [_choice()],
        pages=pages,
    )


def _title_max_chars(template_id: str) -> int:
    """The mag template's `title` slot maxChars (apply-theme clamps subject to it)."""
    tmpl = templates.get(template_id)
    slot = next(s for s in templates.text_slots(tmpl) if s.get("role") == "title")
    return int(slot["maxChars"])


# ──────────────────────────── ① only variableDecor; 正文不碰 ────────────────────────────


def test_brushes_only_variable_decor_text_slots_writing_subject_into_title():
    # mag-08 variableDecor text slots = dateNum (decoration), title (title role).
    # body/caption1/caption2 are NOT variableDecor → must stay exactly as given.
    # #236: the `title` slot is now (re)written with the chapter subject.
    page = _page(
        "mag-08",
        texts={
            "title": "Homecoming",       # variableDecor title → overwritten with subject
            "body": "We drove north.",   # not variableDecor → untouched
            "caption1": "By the lake",   # not variableDecor → untouched
            # dateNum (variableDecor decoration) is EMPTY → stays empty (not a carrier)
        },
        images={"image": "p1"},
    )
    resp = at.apply_theme(_request([page]))

    assert len(resp.layoutPatch) == 1
    patched = resp.layoutPatch[0].texts
    # 普通正文 preserved verbatim (普通正文不碰).
    assert patched["body"] == "We drove north."
    assert patched["caption1"] == "By the lake"
    # #236: title slot now holds the chapter subject (clamped to the slot maxChars).
    assert patched["title"] == _SUBJECT[: _title_max_chars("mag-08")]
    # Empty text decorations are not color carriers; only SVG variableDecor slots
    # may carry the accent color through page.texts.
    assert "dateNum" not in patched


def test_subject_is_clamped_to_the_title_slot_max_chars():
    long_subject = "A very very very long chapter title that exceeds the slot"
    page = _page("mag-08", texts={"title": "x"}, images={"image": "p1"})
    resp = at.apply_theme(_request([page], chapters=[_choice(subject=long_subject)]))
    max_chars = _title_max_chars("mag-08")
    title = resp.layoutPatch[0].texts["title"]
    assert title == long_subject[:max_chars]
    assert len(title) <= max_chars


def test_empty_decoration_text_value_is_never_replaced_with_accent_color():
    page = _page("mag-08", texts={"dateNum": "", "title": "Trip"}, images={"image": "p1"})
    resp = at.apply_theme(_request([page]))
    patched = resp.layoutPatch[0].texts
    assert patched["dateNum"] == ""
    # #236: title takes the subject.
    assert patched["title"] == _SUBJECT[: _title_max_chars("mag-08")]


def test_non_empty_decoration_value_is_never_clobbered():
    # `dateNum` already holds a generic-copy date — theme recolors via the tree, the
    # code-owned value must survive (we never overwrite a non-empty decoration slot).
    # mag-08 also has the svg-less `title` (variableDecor) → page IS themable, so an
    # entry is emitted; the date value must be preserved verbatim within it.
    page = _page("mag-08", texts={"dateNum": "08/24", "title": "Trip"}, images={"image": "p1"})
    resp = at.apply_theme(_request([page]))
    patched = resp.layoutPatch[0].texts
    assert patched["dateNum"] == "08/24"   # non-empty decoration preserved
    assert patched["title"] == _SUBJECT[: _title_max_chars("mag-08")]  # #236: subject as title


def test_page_with_only_user_prose_variable_decor_is_still_themable():
    # mag-19's only variableDecor slot is `intro`. The page IS themable (it has a
    # variableDecor slot), so an entry is emitted. If `intro` is a title role it takes
    # the subject (#236); otherwise its content is preserved.
    page = _page("mag-19", texts={"intro": "Once upon a time"}, page_index=0)
    resp = at.apply_theme(_request([page]))
    assert len(resp.layoutPatch) == 1
    intro_slot = next(
        s for s in templates.text_slots(templates.get("mag-19")) if s.get("id") == "intro"
    )
    expected = (
        _SUBJECT[: int(intro_slot["maxChars"])]
        if intro_slot.get("role") == "title"
        else "Once upon a time"
    )
    assert resp.layoutPatch[0].texts["intro"] == expected


# ──────────────────────────── ② SVG 图层被填色 ────────────────────────────


def test_variable_decor_svg_layer_is_filled_with_accent_color():
    # mag-13 carries an svg slot `divider` with variableDecor:true.
    assert any(s["id"] == "divider" and s.get("variableDecor") for s in (templates.get("mag-13").get("svgs") or []))
    page = _page("mag-13", texts={"title": "Chapter Two"}, images={"image": "p1"})
    resp = at.apply_theme(_request([page]))
    patched = resp.layoutPatch[0].texts
    assert patched["divider"] == _ACCENT                          # svg filled with accent
    assert patched["title"] == _SUBJECT[: _title_max_chars("mag-13")]  # #236: subject as title


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
