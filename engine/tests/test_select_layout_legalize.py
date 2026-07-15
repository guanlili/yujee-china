"""legalize.finalize_candidate_pages —— 评委赢家候选 → 最终页。

这个文件此前有 4 个测试,全部在测【旧线框评委流程】的死代码
(build_candidate_catalog / legalize_layout / template_previews 完整性),而生产
真正在用的 finalize_candidate_pages 反而零覆盖。旧流程已随「真图缩略图评委」上线
而整条拆除,测试重写为守护活代码。
"""

from src.workflows.core.layout import legalize


def test_finalize_reindexes_pages_and_normalizes_images():
    pages = legalize.finalize_candidate_pages(
        {"chapterId": "ch_1"},
        [
            {"pageIndex": 7, "templateId": "mag-15", "images": {"image1": "p2", "image2": "p1"}},
            {"pageIndex": 3, "templateId": "mag-23", "slots": {"main": "p3"}},
        ],
    )

    assert [p["pageIndex"] for p in pages] == [0, 1]
    assert pages[0]["images"] == {"image1": "p2", "image2": "p1"}
    # Gemini 侧的 `slots` 键也被归一成 `images`。
    assert pages[1]["images"] == {"main": "p3"}
    assert all(isinstance(p["texts"], dict) for p in pages)


def test_finalize_keeps_existing_texts_and_defaults_to_empty():
    pages = legalize.finalize_candidate_pages(
        None,  # chapter 参数保留签名,当前未用
        [
            {"templateId": "mag-10", "images": {"image[0]": "p1"}, "texts": {"explain[0]": "已有文案"}},
            {"templateId": "mag-15", "images": {"image1": "p2"}, "texts": "不是字典"},
        ],
    )

    assert pages[0]["texts"] == {"explain[0]": "已有文案"}
    assert pages[1]["texts"] == {}  # 非法 texts 归空,不透传脏数据


def test_photo_helpers_shared_with_write_copy():
    # write_copy 从这里借 _photos/_photo_id(公共章节字段读取);签名别悄悄变。
    chapter = {"photos": [{"photoId": "p1"}, {"photoId": "p2"}]}
    photos = legalize._photos(chapter)
    assert [legalize._photo_id(p) for p in photos] == ["p1", "p2"]
