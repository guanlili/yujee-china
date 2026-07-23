from src.workflows.core.layout import sample_texts


def test_fills_sample_into_empty_texts():
    pages = [{"pageIndex": 0, "templateId": "mag-01", "images": {}, "texts": {}}]
    out = sample_texts.fill_sample_texts(pages)
    assert out[0]["texts"]["title"] == "DUE NORTH"


def test_does_not_overwrite_existing_text():
    pages = [{"pageIndex": 0, "templateId": "mag-01", "images": {}, "texts": {"title": "已有"}}]
    out = sample_texts.fill_sample_texts(pages)
    assert out[0]["texts"]["title"] == "已有"


def test_fills_sample_into_repeat_group_slots():
    # mag-10 顶层零文字、explain 全在 items 重复组:4 格照片必须换来 4 个填了 sample 的
    # explain[i],否则用户在 story 环节看到的是四个空文字框。
    page = {
        "pageIndex": 0,
        "templateId": "mag-10",
        "images": {f"image[{i}]": f"p{i}" for i in range(4)},
        "texts": {},
    }
    out = sample_texts.fill_sample_texts([page])
    texts = out[0]["texts"]
    assert sorted(texts) == [f"explain[{i}]" for i in range(4)]
    assert all(texts[f"explain[{i}]"] == "something/where/someone" for i in range(4))


def test_repeat_group_does_not_overwrite_existing_text():
    page = {
        "pageIndex": 0,
        "templateId": "mag-10",
        "images": {f"image[{i}]": f"p{i}" for i in range(2)},
        "texts": {"explain[0]": "已有"},
    }
    out = sample_texts.fill_sample_texts([page])
    assert out[0]["texts"]["explain[0]"] == "已有"
    assert out[0]["texts"]["explain[1]"] == "something/where/someone"


def test_repeat_group_without_instances_adds_nothing():
    page = {"pageIndex": 0, "templateId": "mag-10", "images": {}, "texts": {}}
    out = sample_texts.fill_sample_texts([page])
    assert out[0]["texts"] == {}


def test_unknown_template_is_left_alone():
    pages = [{"pageIndex": 0, "templateId": "nope-99", "images": {}, "texts": {}}]
    out = sample_texts.fill_sample_texts(pages)
    assert out[0]["texts"] == {}
