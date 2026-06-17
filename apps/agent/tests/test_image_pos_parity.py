"""#165 Phase 1: ImagePos clamp + Page.imagePos parity with @yujee/contracts.

Mirrors packages/contracts/src/image-pos.test.ts. ImagePos clamps x,y∈[0,100],
scale∈[1,2]; Page.imagePos is optional (absent ⇒ None) and strict (forbids
unknown keys inside an entry)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.schemas import ImagePos, Page


def test_image_pos_accepts_in_range():
    ImagePos.model_validate({"x": 0, "y": 100, "scale": 1})
    ImagePos.model_validate({"x": 50, "y": 50, "scale": 2})


@pytest.mark.parametrize(
    "bad",
    [
        {"x": -1, "y": 50, "scale": 1},
        {"x": 101, "y": 50, "scale": 1},
        {"x": 50, "y": 50, "scale": 0.9},
        {"x": 50, "y": 50, "scale": 2.5},
    ],
)
def test_image_pos_rejects_out_of_range(bad):
    with pytest.raises(ValidationError):
        ImagePos.model_validate(bad)


def test_image_pos_rejects_unknown_key():
    with pytest.raises(ValidationError):
        ImagePos.model_validate({"x": 50, "y": 50, "scale": 1, "z": 1})


def test_page_image_pos_absent_defaults_to_none():
    page = Page.model_validate(
        {"pageIndex": 0, "templateId": "mag-08", "images": {}, "texts": {}}
    )
    assert page.imagePos is None


def test_page_image_pos_accepts_slot_keyed_map():
    page = Page.model_validate(
        {
            "pageIndex": 1,
            "templateId": "mag-10",
            "images": {"cells[0].image": "p1"},
            "texts": {},
            "imagePos": {"cells[0].image": {"x": 20, "y": 80, "scale": 1.4}},
        }
    )
    assert page.imagePos is not None
    assert page.imagePos["cells[0].image"].scale == 1.4


def test_page_image_pos_rejects_out_of_range_entry():
    with pytest.raises(ValidationError):
        Page.model_validate(
            {
                "pageIndex": 0,
                "templateId": "mag-08",
                "images": {"image": "p1"},
                "texts": {},
                "imagePos": {"image": {"x": 50, "y": 50, "scale": 9}},
            }
        )
