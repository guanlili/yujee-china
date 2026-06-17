"""#165 Phase 1: per-image position overrides flatten through finalize (inv 12).

A chapter page that carries `imagePos` must keep it in the flat LayoutV2; a page
without one stays absent (None) so the renderer applies its 50/50/1 default and
pre-#165 albums are byte-unchanged. A stale override pointing at a slot whose
photo is gone must be dropped.
"""

from __future__ import annotations

from src.schemas import ImagePos, Page
from src.services import finalize

from tests.test_finalize_flatten import _chapter, _draft, _photo


def _find_page_with_image(layout, photo_id: str):
    for page in layout.pages:
        if photo_id in page.images.values():
            return page
    raise AssertionError(f"no flat page references {photo_id}")


def test_chapter_page_image_pos_survives_finalize():
    photos = [_photo(1, "hero"), _photo(2, "detail"), _photo(3, "detail")]
    chapter = _chapter("c1", photos)
    # stamp an override onto the first chapter page's first image slot
    first = chapter.pages[0]
    slot, pid = next(iter(first.images.items()))
    chapter.pages[0] = first.model_copy(
        update={"imagePos": {slot: ImagePos(x=20, y=80, scale=1.5)}}
    )

    layout = finalize.finalize(_draft(photos, [chapter], prompt_hint="Trip"))

    page = _find_page_with_image(layout, pid)
    assert page.imagePos is not None
    assert page.imagePos[slot].x == 20
    assert page.imagePos[slot].y == 80
    assert page.imagePos[slot].scale == 1.5


def test_pages_without_override_have_image_pos_absent():
    photos = [_photo(1, "hero"), _photo(2, "detail")]
    layout = finalize.finalize(_draft(photos, [_chapter("c1", photos)], prompt_hint="Trip"))
    # no override anywhere ⇒ every flat page leaves imagePos as None (default-fill
    # happens at the renderer / DB row, not by fabricating override entries here).
    assert all(page.imagePos is None for page in layout.pages)


def test_stale_override_on_missing_slot_is_dropped():
    photos = [_photo(1, "hero"), _photo(2, "detail")]
    chapter = _chapter("c1", photos)
    first = chapter.pages[0]
    slot = next(iter(first.images.keys()))
    chapter.pages[0] = first.model_copy(
        update={
            "imagePos": {
                slot: ImagePos(x=10, y=10, scale=1.2),
                "ghostSlot": ImagePos(x=99, y=1, scale=2),  # not in images ⇒ drop
            }
        }
    )

    layout = finalize.finalize(_draft(photos, [chapter], prompt_hint="Trip"))

    page = _find_page_with_image(layout, first.images[slot])
    assert page.imagePos is not None
    assert slot in page.imagePos
    assert "ghostSlot" not in page.imagePos
