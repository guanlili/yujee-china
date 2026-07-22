from src.workflows.core.layout import sample_texts


def test_fills_sample_into_empty_texts():
    pages = [{"pageIndex": 0, "templateId": "mag-01", "images": {}, "texts": {}}]
    out = sample_texts.fill_sample_texts(pages)
    assert out[0]["texts"]["title"] == "DUE NORTH"


def test_does_not_overwrite_existing_text():
    pages = [{"pageIndex": 0, "templateId": "mag-01", "images": {}, "texts": {"title": "已有"}}]
    out = sample_texts.fill_sample_texts(pages)
    assert out[0]["texts"]["title"] == "已有"


def test_unknown_template_is_left_alone():
    pages = [{"pageIndex": 0, "templateId": "nope-99", "images": {}, "texts": {}}]
    out = sample_texts.fill_sample_texts(pages)
    assert out[0]["texts"] == {}
