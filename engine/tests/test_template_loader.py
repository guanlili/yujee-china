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

    assert len(json_files) == 47
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

    # 不写死 id:模板会被重新归类(Web 模板台的页面类型下拉框直接改模板 JSON 的
    # category)。守不变式:COVER_TEMPLATE_IDS 必须与模板 JSON 派生出来的一致且非空。
    assert expected_covers, "至少要有一个封面模板"
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
                    {"id": "title", "role": "title", "lang": "user"},
                    {"id": "folio", "role": "decoration", "lang": "en"},
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
    assert "caption(explain)" in summary
    assert "title(title)" in summary


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
                    }
                ],
                "items": {
                    "images": [{"id": "itemImage"}],
                    "texts": [
                        {
                            "id": "caption",
                            "role": "explain",
                            "lang": "user",
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
        "texts": [{"id": "caption", "role": "explain", "lang": "user"}],
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

    # hint 字段已从契约删除：带 hint 的槽应作为未知字段被拒。
    write_template(
        "bad-hint",
        texts=[{"id": "body", "role": "body", "lang": "user", "hint": "x"}],
    )
    with pytest.raises(RuntimeError, match=r"unsupported fields.*hint"):
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


# ---------- 示例文案:槽位自带的 sample(单一真相)------------------------------
# 示例文案就是模板 JSON 里槽位自己的 `sample` 字段 —— 同一个串既是 Web 画板的预览
# 占位,也是写作 LM 的输出示例(例驱动)。曾经并存的 copy-examples/ 目录已删除:两套
# 示例=信息误差。缺 sample 的槽须优雅降级(写作侧 omit 示例,绝不崩)。


def test_text_slot_sample_is_loaded_from_template_json():
    from src.workflows.core.layout import templates as registry

    template = registry.get("mag-01")
    assert template is not None
    by_id = {slot["id"]: slot for slot in registry.text_slots(template)}
    # 这个串同时是画板占位和写作示例(单一真相)。
    assert by_id["title"].get("sample")
    assert by_id["body"].get("sample")


def test_text_slot_without_sample_loads_fine(tmp_path):
    from src.workflows.core.layout import templates as registry

    # sample 是可选的:没有它的槽照样加载(写作侧据此 omit 示例,绝不崩)。
    template_file = tmp_path / "no-sample.json"
    template_file.write_text(
        json.dumps(
            {
                "id": "no-sample",
                "category": "interior",
                "images": [{"id": "image"}],
                "texts": [{"id": "body", "role": "body", "lang": "user"}],
            }
        ),
        encoding="utf-8",
    )

    loaded = registry._load_templates_from_dir(tmp_path)
    slot = registry.text_slots(loaded["no-sample"])[0]
    assert slot.get("sample") is None


def test_loader_accepts_spread_on_interior(tmp_path):
    from src.workflows.core.layout import templates

    (tmp_path / "spread-ok.json").write_text(json.dumps({
        "id": "spread-ok", "category": "interior", "spread": True,
        "images": [{"id": "image1"}],
        "texts": [{"id": "title", "role": "title", "lang": "user"}],
    }), encoding="utf-8")

    loaded = templates._load_templates_from_dir(tmp_path)
    assert loaded["spread-ok"]["spread"] is True


def test_loader_rejects_spread_on_cover(tmp_path):
    from src.workflows.core.layout import templates

    (tmp_path / "spread-bad.json").write_text(json.dumps({
        "id": "spread-bad", "category": "cover", "spread": True,
        "images": [{"id": "image1"}],
        "texts": [{"id": "title", "role": "title", "lang": "user"}],
    }), encoding="utf-8")

    with pytest.raises(RuntimeError, match="spread is only valid on interior"):
        templates._load_templates_from_dir(tmp_path)


def test_loader_rejects_spread_with_pairing(tmp_path):
    from src.workflows.core.layout import templates

    (tmp_path / "spread-pairing-bad.json").write_text(json.dumps({
        "id": "spread-pairing-bad", "category": "interior", "spread": True,
        "pairing": {"forced": True, "with": "some-other-id", "side": "left"},
        "images": [{"id": "image1"}],
        "texts": [{"id": "title", "role": "title", "lang": "user"}],
    }), encoding="utf-8")

    with pytest.raises(RuntimeError, match="spread and pairing are mutually exclusive"):
        templates._load_templates_from_dir(tmp_path)
