import importlib
import json
import sys
from pathlib import Path

import pytest


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def test_loader_reads_shared_template_json_count():
    from src.workflows.core.layout import templates

    template_dir = _repo_root() / "packages" / "contracts" / "templates"
    json_files = sorted(template_dir.glob("*.json"))
    # Derive the expected id set straight from the shipped template JSONs so this
    # test never goes stale when templates are added/removed.
    expected_ids = sorted(path.stem for path in json_files)

    assert len(json_files) == 48
    # mag-24 has no JSON, so it is (correctly) absent from the loaded registry.
    assert "mag-24" not in expected_ids
    assert templates.TEMPLATE_IDS == expected_ids
    assert len(templates.TEMPLATES) == len(json_files)


def test_loader_fail_fast_when_explicit_template_path_is_missing(monkeypatch, tmp_path):
    missing = tmp_path / "missing-templates"
    monkeypatch.setenv("YUJEE_TEMPLATE_DIR", str(missing))
    sys.modules.pop("src.workflows.core.layout.templates", None)

    try:
        with pytest.raises(RuntimeError, match="YUJEE_TEMPLATE_DIR"):
            importlib.import_module("src.workflows.core.layout.templates")
    finally:
        monkeypatch.delenv("YUJEE_TEMPLATE_DIR", raising=False)
        sys.modules.pop("src.workflows.core.layout.templates", None)
        importlib.import_module("src.workflows.core.layout.templates")


def test_cover_ids_are_derived_from_template_json():
    from src.workflows.core.layout import templates

    template_dir = _repo_root() / "packages" / "contracts" / "templates"
    expected_covers = sorted(
        path.stem
        for path in template_dir.glob("*.json")
        if json.loads(path.read_text(encoding="utf-8")).get("category") == "cover"
    )

    assert expected_covers == ["mag-01", "mag-13", "mag-23", "mag-32", "p01"]
    assert templates.COVER_TEMPLATE_IDS == expected_covers


def test_prompt_summary_handles_optional_constraints(tmp_path):
    from src.workflows.core.layout import templates

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
    from src.workflows.core.layout import templates

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
    from src.workflows.core.layout import templates

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
    from src.workflows.core.layout import templates

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


def test_optional_image_slot_hints_treated_as_any(monkeypatch, tmp_path):
    """Loader coverage: an image slot declared with no orientation/quality hints
    loads as ``{"id": ...}`` — it accepts any image. (The former V2
    ``layout_rules`` violation/coerce/build assertions were dropped together with
    that orphaned module in the engine refactor; this keeps the genuine loader
    assertion.)"""
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
    sys.modules.pop("src.workflows.core.layout.templates", None)

    try:
        templates = importlib.import_module("src.workflows.core.layout.templates")
        assert templates.image_slot_map(templates.TEMPLATES["optional-01"])["image"] == {"id": "image"}
    finally:
        monkeypatch.delenv("YUJEE_TEMPLATE_DIR", raising=False)
        sys.modules.pop("src.workflows.core.layout.templates", None)
        importlib.import_module("src.workflows.core.layout.templates")


# ---------- 示例文案(copy-examples)加载 -------------------------------------
# 示例文案与模板分文件、并列存放(packages/contracts/copy-examples/),通过与模板【同一】
# 机制到达 Agent。它们给写作 LM 做「输出示例」(例驱动);缺失须优雅降级,绝不崩。


def test_copy_example_returns_slot_texts_map():
    from src.workflows.core.layout import templates as registry

    # mag-01 ships example copy keyed by slot id (examples[0].texts).
    example = registry.copy_example("mag-01")
    assert example["title"] == "VENUES"
    assert example["explain1"] and example["explain2"]


def test_copy_example_repeat_group_keys_use_brackets():
    from src.workflows.core.layout import templates as registry

    # mag-10's repeat group example keys as explain[0..3] — same bracket shape the
    # writing-side per-page expansion produces.
    example = registry.copy_example("mag-10")
    assert example["explain[0]"] == "Low tide at dawn."
    assert "explain[3]" in example


def test_copy_example_missing_file_returns_empty_dict():
    from src.workflows.core.layout import templates as registry

    # mag-20 has no copy-example file → empty dict (graceful degrade, never KeyError).
    assert registry.copy_example("mag-20") == {}
    assert registry.copy_example("does-not-exist") == {}
