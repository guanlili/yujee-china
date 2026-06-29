from __future__ import annotations

from src.agents.theme_recommend import handler as recommend_v3
from src.agents.writing import handler as writing
from src.engine import apply_theme_v3
from src.schemas import Page, V3ChapterThemeChoice


def test_writing_helpers_have_public_names_and_private_aliases():
    page = Page(pageIndex=0, templateId="mag-13", images={"image": "p1"}, texts={})
    specs = writing.page_slot_specs(page)

    assert specs == writing._page_slot_specs(page)
    assert writing._page_slot_specs is writing.page_slot_specs
    assert writing.clean_texts(
        {"title": "  A title  ", "bogus": "drop me"},
        specs,
    ) == {"title": "A title"}
    assert writing._clean_texts is writing.clean_texts
    assert writing.page_slot_specs.__doc__
    assert writing.clean_texts.__doc__


def test_apply_page_has_public_name_and_private_alias():
    choice = V3ChapterThemeChoice(
        chapterId="c1",
        subject="Coast",
        accentColor="#C0392B",
        artFont="script-elegant",
    )
    page = Page(pageIndex=0, templateId="mag-13", images={"image": "p1"}, texts={})

    assert apply_theme_v3.apply_page(page, choice) == apply_theme_v3._apply_page(page, choice)
    assert apply_theme_v3._apply_page is apply_theme_v3.apply_page
    assert apply_theme_v3.apply_page.__doc__


def test_theme_recommend_accent_coercion_delegates_to_finalize_color(monkeypatch):
    calls: list[object] = []

    def fake_finalize_color(raw: object) -> str:
        calls.append(raw)
        return "#123456"

    monkeypatch.setattr(recommend_v3, "finalize_color", fake_finalize_color, raising=False)

    assert recommend_v3._coerce_accent("not a hex color") == "#123456"
    assert calls == ["not a hex color"]
