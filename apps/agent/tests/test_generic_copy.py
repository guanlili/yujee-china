"""V3 generic copy + generic color preview layer (WP1.5 / #184).

Covers the §4.1(e) / §7.1 preview-state contract: after WP1.4 select-template builds
the flat pages with empty texts, `generic_copy.fill_generic_copy` code-fills the
deterministic decoration (folio page numbers, date from the photos' code-filled
takenAt) and leaves user-content slots empty for the章节故事环节. No LLM, no base64.

These run against the REAL template registry so the decoration ids we own
(`folio` / `date`) are exercised on actual interior templates (mag-08 has both).
"""

from __future__ import annotations

from src.schemas import V3Chapter, V3ChapterPhoto, Page
from src.services import generic_copy


def _photo(pid: str, *, w: int = 800, h: int = 1200, taken_at: str | None = None) -> V3ChapterPhoto:
    return V3ChapterPhoto(
        photoId=pid,
        sceneDescription=f"scene {pid}",
        width=w,
        height=h,
        orientation="portrait" if h >= w else "landscape",
        takenAt=taken_at,
    )


def _chapter(cid: str, photos: list[V3ChapterPhoto]) -> V3Chapter:
    return V3Chapter(
        chapterId=cid, description=f"{cid} desc", accentColor=None, artFont=None, photos=photos
    )


# ---------- folio (page number) ----------------------------------------------


def test_folio_filled_with_padded_page_number():
    chapters = [_chapter("c1", [_photo("p1")])]
    pages = generic_copy.fill_generic_copy(
        [{"pageIndex": 0, "templateId": "mag-06", "images": {"image": "p1"}, "texts": {}}],
        chapters,
    )
    assert len(pages) == 1
    # mag-06 declares a `folio` decoration slot (maxChars 2) → "01" for page 0.
    assert pages[0]["texts"]["folio"] == "01"


def test_folio_uses_one_based_page_index():
    chapters = [_chapter("c1", [_photo("p1")])]
    pages = generic_copy.fill_generic_copy(
        [{"pageIndex": 4, "templateId": "mag-06", "images": {"image": "p1"}, "texts": {}}],
        chapters,
    )
    assert pages[0]["texts"]["folio"] == "05"


# ---------- date decoration ----------------------------------------------------


def test_date_decor_from_taken_at():
    chapters = [_chapter("c1", [_photo("p1", taken_at="2024-03-15T08:30:00Z")])]
    pages = generic_copy.fill_generic_copy(
        [{"pageIndex": 0, "templateId": "mag-08", "images": {"image": "p1"}, "texts": {}}],
        chapters,
    )
    # mag-08 has a `date` decoration slot (maxChars 12) → "03/24".
    assert pages[0]["texts"]["date"] == "03/24"
    # folio still filled alongside.
    assert pages[0]["texts"]["folio"] == "01"


def test_date_decor_omitted_without_taken_at():
    chapters = [_chapter("c1", [_photo("p1", taken_at=None)])]
    pages = generic_copy.fill_generic_copy(
        [{"pageIndex": 0, "templateId": "mag-08", "images": {"image": "p1"}, "texts": {}}],
        chapters,
    )
    # No takenAt anywhere on the page → no invented date (§3 / no fake dates).
    assert "date" not in pages[0]["texts"]
    assert pages[0]["texts"]["folio"] == "01"


def test_date_decor_uses_earliest_taken_at_on_page():
    photos = [
        _photo("p1", taken_at="2024-07-20T10:00:00Z"),
        _photo("p2", taken_at="2024-03-01T10:00:00Z"),
        _photo("p3", taken_at="2024-05-10T10:00:00Z"),
    ]
    chapters = [_chapter("c1", photos)]
    pages = generic_copy.fill_generic_copy(
        [
            {
                "pageIndex": 0,
                "templateId": "mag-04",  # holds 3 images + date decoration slot
                "images": {"image1": "p1", "image2": "p2", "image3": "p3"},
                "texts": {},
            }
        ],
        chapters,
    )
    # Earliest of the three (March) wins.
    assert pages[0]["texts"]["date"] == "03/24"


# ---------- user-content slots stay empty (no正式文案) -------------------------


def test_user_content_slots_left_empty():
    chapters = [_chapter("c1", [_photo("p1", taken_at="2024-03-15T08:30:00Z")])]
    pages = generic_copy.fill_generic_copy(
        [{"pageIndex": 0, "templateId": "mag-08", "images": {"image": "p1"}, "texts": {}}],
        chapters,
    )
    texts = pages[0]["texts"]
    # mag-08 user slots: explain1/explain2/title/body — NONE filled (§4.1: 不生成正式文案).
    for user_slot in ("explain1", "explain2", "title", "body"):
        assert user_slot not in texts, user_slot


def test_location_decoration_never_filled():
    """§3 隐私: a `label` decoration slot is never given a value (no place)."""
    chapters = [_chapter("c1", [_photo("p1", taken_at="2024-03-15T08:30:00Z")])]
    pages = generic_copy.fill_generic_copy(
        [{"pageIndex": 0, "templateId": "mag-03", "images": {"image": "p1"}, "texts": {}}],
        chapters,
    )
    assert "label" not in pages[0]["texts"]
    # folio is still filled on mag-03.
    assert pages[0]["texts"]["folio"] == "01"


# ---------- robustness ---------------------------------------------------------


def test_existing_non_empty_text_never_clobbered():
    chapters = [_chapter("c1", [_photo("p1")])]
    pages = generic_copy.fill_generic_copy(
        [{"pageIndex": 0, "templateId": "mag-06", "images": {"image": "p1"}, "texts": {"folio": "XX"}}],
        chapters,
    )
    assert pages[0]["texts"]["folio"] == "XX"


def test_unknown_template_keeps_existing_texts():
    chapters = [_chapter("c1", [_photo("p1")])]
    pages = generic_copy.fill_generic_copy(
        [{"pageIndex": 0, "templateId": "does-not-exist", "images": {"image": "p1"}, "texts": {"a": "b"}}],
        chapters,
    )
    assert pages[0]["texts"] == {"a": "b"}


def test_input_pages_not_mutated():
    chapters = [_chapter("c1", [_photo("p1")])]
    src_page = {"pageIndex": 0, "templateId": "mag-06", "images": {"image": "p1"}, "texts": {}}
    generic_copy.fill_generic_copy([src_page], chapters)
    assert src_page["texts"] == {}  # original untouched


def test_filled_pages_revalidate_as_page_objects():
    """The generic-copy output must still satisfy the strict Page contract so it can
    ride the V3AnalyzeCompleted callback unchanged."""
    chapters = [_chapter("c1", [_photo("p1", taken_at="2024-03-15T08:30:00Z")])]
    pages = generic_copy.fill_generic_copy(
        [{"pageIndex": 0, "templateId": "mag-08", "images": {"image": "p1"}, "texts": {}}],
        chapters,
    )
    obj = Page(**pages[0])
    assert obj.texts["folio"] == "01"
    assert obj.texts["date"] == "03/24"


def test_chapter_color_placeholders_left_null():
    """通用色 = the null placeholder (theme环节 fills real值). The tree's
    accentColor/artFont must stay None after the generic-copy stage."""
    chapters = [_chapter("c1", [_photo("p1")])]
    generic_copy.fill_generic_copy(
        [{"pageIndex": 0, "templateId": "mag-06", "images": {"image": "p1"}, "texts": {}}],
        chapters,
    )
    assert chapters[0].accentColor is None
    assert chapters[0].artFont is None
