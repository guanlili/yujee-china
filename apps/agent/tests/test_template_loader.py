import importlib
import json
import sys
from pathlib import Path

import pytest


EXPECTED_TEMPLATE_IDS = [
    "mag-01",
    "mag-02",
    "mag-03",
    "mag-04",
    "mag-05",
    "mag-06",
    "mag-07",
    "mag-08",
    "mag-09",
    "mag-10",
    "mag-11",
    "mag-13",
    "mag-15",
    "mag-18",
    "mag-19",
    "mag-20",
    "p01",
]


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def test_loader_reads_shared_template_json_count():
    from src import templates

    template_dir = _repo_root() / "packages" / "contracts" / "templates"
    json_files = sorted(template_dir.glob("*.json"))

    assert len(json_files) == 17
    assert templates.TEMPLATE_IDS == EXPECTED_TEMPLATE_IDS
    assert len(templates.TEMPLATES) == len(json_files)


def test_loader_fail_fast_when_explicit_template_path_is_missing(monkeypatch, tmp_path):
    missing = tmp_path / "missing-templates"
    monkeypatch.setenv("YUJEE_TEMPLATE_DIR", str(missing))
    sys.modules.pop("src.templates", None)

    try:
        with pytest.raises(RuntimeError, match="YUJEE_TEMPLATE_DIR"):
            importlib.import_module("src.templates")
    finally:
        monkeypatch.delenv("YUJEE_TEMPLATE_DIR", raising=False)
        sys.modules.pop("src.templates", None)
        importlib.import_module("src.templates")


def test_cover_ids_are_derived_from_template_json():
    from src import templates

    assert templates.COVER_TEMPLATE_IDS == ["mag-01", "mag-13", "p01"]


def test_prompt_summary_handles_optional_constraints(tmp_path):
    from src import templates

    template_file = tmp_path / "optional-01.json"
    template_file.write_text(
        json.dumps(
            {
                "id": "optional-01",
                "category": "interior",
                "images": [
                    {"id": "image"},
                    {"id": "thumb", "quality": ["detail"]},
                ],
                "texts": [
                    {"id": "caption", "role": "explain", "lang": "user"},
                    {"id": "title", "role": "title", "lang": "user", "maxChars": 24},
                    {"id": "folio", "role": "decoration", "lang": "en", "maxChars": 2},
                ],
            }
        ),
        encoding="utf-8",
    )

    loaded = templates._load_templates_from_dir(tmp_path)
    summary = templates._summarize_templates_for_prompt(loaded)

    assert "optional-01 [interior]" in summary
    assert "image(any)" in summary
    assert "thumb(quality~detail)" in summary
    assert "caption<=?c" in summary
    assert "title<=24c" in summary


def test_loader_accepts_category_only_v3_template(tmp_path):
    from src import templates

    template_file = tmp_path / "v3-only.json"
    template_file.write_text(
        json.dumps(
            {
                "id": "v3-only",
                "category": "interior",
                "images": [{"id": "image"}],
                "svgs": [{"id": "divider", "variableDecor": True}],
                "texts": [
                    {
                        "id": "title",
                        "role": "title",
                        "lang": "user",
                        "maxChars": 24,
                        "hint": "Write a concise page title.",
                    }
                ],
                "items": {
                    "images": [{"id": "itemImage"}],
                    "texts": [
                        {
                            "id": "caption",
                            "role": "explain",
                            "lang": "user",
                            "maxChars": 70,
                        }
                    ],
                },
            }
        ),
        encoding="utf-8",
    )

    loaded = templates._load_templates_from_dir(tmp_path)
    template = loaded["v3-only"]

    assert template["category"] == "interior"
    assert "slot" not in template
    assert "scene" not in template
    assert template["svgs"] == [{"id": "divider", "variableDecor": True}]
    assert template["items"] == {
        "images": [{"id": "itemImage"}],
        "texts": [{"id": "caption", "role": "explain", "lang": "user", "maxChars": 70}],
    }


def test_loader_rejects_invalid_v3_nested_fields(tmp_path):
    from src import templates

    def write_template(template_id: str, **overrides):
        data = {
            "id": template_id,
            "category": "interior",
            "images": [{"id": "image"}],
            "texts": [{"id": "body", "role": "body", "lang": "user"}],
        }
        data.update(overrides)
        (tmp_path / f"{template_id}.json").write_text(json.dumps(data), encoding="utf-8")

    write_template("bad-items", items={"texts": [{"id": "caption", "role": "bad", "lang": "user"}]})
    with pytest.raises(RuntimeError, match=r"bad-items\.json\.items\.texts\[0\]\.role"):
        templates._load_templates_from_dir(tmp_path)

    for path in tmp_path.glob("*.json"):
        path.unlink()

    write_template("bad-svgs", svgs=[{"id": 123}])
    with pytest.raises(RuntimeError, match=r"bad-svgs\.json\.svgs\[0\]\.id"):
        templates._load_templates_from_dir(tmp_path)


def test_loader_mirrors_template_def_edge_constraints(tmp_path):
    from src import templates

    def write_template(template_id: str, **overrides):
        data = {
            "id": template_id,
            "category": "interior",
            "images": [{"id": "image"}],
            "texts": [{"id": "body", "role": "body", "lang": "user"}],
        }
        data.update(overrides)
        (tmp_path / f"{template_id}.json").write_text(json.dumps(data), encoding="utf-8")

    write_template(
        "valid-edge",
        pairing={"forced": True, "with": "mag-08", "side": "left"},
        styles=[],
    )
    loaded = templates._load_templates_from_dir(tmp_path)
    assert loaded["valid-edge"]["pairing"] == {"forced": True, "with": "mag-08", "side": "left"}
    assert loaded["valid-edge"]["styles"] == []

    for path in tmp_path.glob("*.json"):
        path.unlink()

    write_template("bad-pairing", pairing={"forced": True, "with": "mag-08"})
    with pytest.raises(RuntimeError, match=r"bad-pairing\.json\.pairing missing required fields"):
        templates._load_templates_from_dir(tmp_path)

    for path in tmp_path.glob("*.json"):
        path.unlink()

    write_template("bad-pairing-extra", pairing={"forced": True, "with": "mag-08", "side": "left", "x": 1})
    with pytest.raises(RuntimeError, match=r"bad-pairing-extra\.json\.pairing has unsupported fields"):
        templates._load_templates_from_dir(tmp_path)

    for path in tmp_path.glob("*.json"):
        path.unlink()

    write_template(
        "bad-hint",
        texts=[{"id": "body", "role": "body", "lang": "user", "hint": "x" * 201}],
    )
    with pytest.raises(RuntimeError, match=r"bad-hint\.json\.texts\[0\]\.hint"):
        templates._load_templates_from_dir(tmp_path)

    for path in tmp_path.glob("*.json"):
        path.unlink()

    write_template("bad-styles", styles=[""])
    with pytest.raises(RuntimeError, match=r"bad-styles\.json\.styles entries"):
        templates._load_templates_from_dir(tmp_path)


def test_layout_rules_treat_optional_image_slot_hints_as_any(monkeypatch, tmp_path):
    def write_template(template_id: str, category: str, images: list, texts: list):
        (tmp_path / f"{template_id}.json").write_text(
            json.dumps(
                {
                    "id": template_id,
                    "category": category,
                    "images": images,
                    "texts": texts,
                }
            ),
            encoding="utf-8",
        )

    write_template(
        "mag-01", "cover",
        [{"id": "image"}], [{"id": "title", "role": "title", "lang": "user"}],
    )
    write_template(
        "mag-02", "toc",
        [], [{"id": "items", "role": "body", "lang": "user"}],
    )
    write_template(
        "optional-01", "interior",
        [{"id": "image"}], [{"id": "caption", "role": "explain", "lang": "user"}],
    )

    monkeypatch.setenv("YUJEE_TEMPLATE_DIR", str(tmp_path))
    sys.modules.pop("src.templates", None)
    sys.modules.pop("src.services.layout_rules", None)

    try:
        templates = importlib.import_module("src.templates")
        layout_rules = importlib.import_module("src.services.layout_rules")

        from src.schemas import AlbumLayoutPlan, Magazine, Page, PhotoAnalysis

        magazine = Magazine(title="Optional hints", style="warm-film", language="en")
        fill_photo = PhotoAnalysis(
            photoId="p1",
            description="d",
            tags=["t"],
            quality="fill",
            orientation="square",
        )
        layout = AlbumLayoutPlan(
            magazine=magazine,
            photos=[fill_photo],
            pages=[
                Page(pageIndex=0, templateId="mag-01", images={"image": "p1"}, texts={"title": "x"}),
                Page(pageIndex=1, templateId="optional-01", images={}, texts={"caption": "x"}),
            ],
        )

        assert templates.image_slot_map(templates.TEMPLATES["optional-01"])["image"] == {"id": "image"}
        assert layout_rules.violation(layout) == "page 1: missing image slot 'image' in template optional-01"

        coerced = layout_rules.coerce_image_slots(layout)
        assert coerced.pages[1].images == {"image": "p1"}
        assert layout_rules.violation(coerced) is None

        fallback = layout_rules.build_text_first_layout(magazine, [fill_photo])
        assert fallback.pages[0].templateId == "mag-01"
        assert fallback.pages[0].images == {"image": "p1"}
        assert layout_rules.violation(fallback) is None
    finally:
        monkeypatch.delenv("YUJEE_TEMPLATE_DIR", raising=False)
        sys.modules.pop("src.templates", None)
        sys.modules.pop("src.services.layout_rules", None)
        importlib.import_module("src.templates")
        importlib.import_module("src.services.layout_rules")
