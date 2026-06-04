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
    "mag-12",
    "mag-13",
    "mag-14",
    "mag-15",
    "mag-16",
    "mag-17",
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

    assert len(json_files) == 21
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

    assert templates.COVER_TEMPLATE_IDS == ["mag-01", "mag-13", "mag-20", "p01"]


def test_prompt_summary_handles_optional_constraints(tmp_path):
    from src import templates

    template_file = tmp_path / "optional-01.json"
    template_file.write_text(
        json.dumps(
            {
                "id": "optional-01",
                "category": "single",
                "imageSlots": {
                    "image": {},
                    "thumb": {"quality": ["detail"]},
                },
                "textSlots": {
                    "caption": {"type": "caption"},
                    "title": {"type": "heading", "recommendedMaxChars": 24},
                    "folio": {"type": "meta", "recommendedMaxChars": 2},
                },
            }
        ),
        encoding="utf-8",
    )

    loaded = templates._load_templates_from_dir(tmp_path)
    summary = templates._summarize_templates_for_prompt(loaded)

    assert "optional-01 [single]" in summary
    assert "image(any)" in summary
    assert "thumb(quality~detail)" in summary
    assert "caption<=?c" in summary
    assert "title<=24c" in summary
