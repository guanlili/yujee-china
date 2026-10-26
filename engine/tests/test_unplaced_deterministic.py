"""散图确定性归章 + 建树的端到端覆盖(不 mock 任何一环)。

砍掉 AI 补充分章后,`group_unplaced` 是散落照片归章的唯一路径,这里用真实的
`group_unplaced` + 真实的 `assemble_stage1_tree` 钉住:
1. 同 cluster 的散图整块归到同一章;
2. 无 EXIF 的散图按位置就近归章;
3. 散图 id 不在 photos_by_id 里时抛错。

每例都断言不变式:建出的树覆盖输入全集,且每张照片恰好出现一次。
"""

from __future__ import annotations

import pytest

from src.contracts.schemas import V3AnalyzePhoto
from src.workflows.core.chaptering.schema import (
    GroupingChapter,
    GroupingResult,
    UnplacedAssignments,
)
from src.workflows.core.chaptering.tree_builder import assemble_stage1_tree
from src.workflows.core.chaptering.unplaced import group_unplaced

_PIXEL = "data:image/jpeg;base64,AA=="


def _photo(
    photo_id: str,
    *,
    taken_at: str | None = None,
    cluster_id: str | None = None,
    width: int = 800,
    height: int = 600,
) -> V3AnalyzePhoto:
    # exif 字段的类型不含 None,缺 EXIF 只能整个键不传。
    extra = {"exif": {"takenAt": taken_at}} if taken_at else {}
    return V3AnalyzePhoto(
        photoId=photo_id,
        base64=_PIXEL,
        width=width,
        height=height,
        clusterId=cluster_id,
        **extra,
    )


def _by_id(photos: list[V3AnalyzePhoto]) -> dict[str, V3AnalyzePhoto]:
    return {p.photoId: p for p in photos}


def _assert_covers_each_photo_once(tree, photos_by_id) -> None:
    """本次改动最重要的正确性要求:树里的照片 == 输入全集,且无重复。"""
    seen = [p.photoId for c in tree.chapters for p in c.photos]
    assert sorted(seen) == sorted(photos_by_id)
    assert len(seen) == len(set(seen))


def test_unplaced_cluster_lands_whole_in_one_chapter():
    photos = [
        _photo("p1", taken_at="2024-03-01T09:00:00Z", cluster_id="c1"),
        _photo("p2", taken_at="2024-03-01T10:00:00Z", cluster_id="c1"),
        _photo("p3", taken_at="2024-06-01T09:00:00Z", cluster_id="c2"),
        _photo("p4", taken_at="2024-06-01T10:00:00Z", cluster_id="c2"),
        # 同一个 cluster 的两张散图:时间横跨两章中点,必须整块走。
        _photo("p5", taken_at="2024-03-02T09:00:00Z", cluster_id="c9"),
        _photo("p6", taken_at="2024-05-20T09:00:00Z", cluster_id="c9"),
    ]
    photos_by_id = _by_id(photos)
    grouping = GroupingResult(
        chapters=[
            GroupingChapter(chapterId="ch_1", photoIds=["p1", "p2"]),
            GroupingChapter(chapterId="ch_2", photoIds=["p3", "p4"]),
        ],
        unplacedPhotoIds=["p5", "p6"],
    )

    assignments = group_unplaced(grouping, photos_by_id)

    assert assignments.assignments["p5"] == assignments.assignments["p6"]
    # cluster 的最早时间是 03-02,离 ch_1 更近。
    assert assignments.assignments["p5"] == "ch_1"

    tree = assemble_stage1_tree(grouping, assignments, photos_by_id)
    _assert_covers_each_photo_once(tree, photos_by_id)
    members = {c.chapterId: [p.photoId for p in c.photos] for c in tree.chapters}
    assert set(members["ch_1"]) == {"p1", "p2", "p5", "p6"}
    assert set(members["ch_2"]) == {"p3", "p4"}


def test_unplaced_without_exif_falls_back_to_nearest_position():
    # 全员无 EXIF:只能按输入位置就近归章。
    photos = [
        _photo("p1"),
        _photo("p2"),
        _photo("p3"),
        _photo("p4"),
        _photo("p5"),  # 位置 4,离 ch_2(位置均值 2.5)比 ch_1(0.5)更近
    ]
    photos_by_id = _by_id(photos)
    grouping = GroupingResult(
        chapters=[
            GroupingChapter(chapterId="ch_1", photoIds=["p1", "p2"]),
            GroupingChapter(chapterId="ch_2", photoIds=["p3", "p4"]),
        ],
        unplacedPhotoIds=["p5"],
    )

    assignments = group_unplaced(grouping, photos_by_id)

    assert assignments.assignments == {"p5": "ch_2"}

    tree = assemble_stage1_tree(grouping, assignments, photos_by_id)
    _assert_covers_each_photo_once(tree, photos_by_id)
    members = {c.chapterId: [p.photoId for p in c.photos] for c in tree.chapters}
    assert members["ch_2"] == ["p3", "p4", "p5"]


def test_unplaced_photo_id_missing_from_photos_by_id_raises():
    photos = [
        _photo("p1", taken_at="2024-03-01T09:00:00Z"),
        _photo("p2", taken_at="2024-03-01T10:00:00Z"),
    ]
    photos_by_id = _by_id(photos)
    grouping = GroupingResult(
        chapters=[GroupingChapter(chapterId="ch_1", photoIds=["p1", "p2"])],
        unplacedPhotoIds=["p_ghost"],
    )

    with pytest.raises(ValueError, match="p_ghost"):
        group_unplaced(grouping, photos_by_id)


def test_tree_gives_every_chapter_a_distinct_label():
    # 单月上传:两章都落在 2024-03,标签必须仍然互不相同。
    photos = [
        _photo("p1", taken_at="2024-03-11T09:00:00Z"),
        _photo("p2", taken_at="2024-03-14T09:00:00Z"),
        _photo("p3", taken_at="2024-03-11T09:00:00Z"),
        _photo("p4", taken_at="2024-03-14T09:00:00Z"),
        _photo("p5", taken_at="2024-03-20T09:00:00Z"),
    ]
    photos_by_id = _by_id(photos)
    grouping = GroupingResult(
        chapters=[
            GroupingChapter(chapterId="ch_1", photoIds=["p1", "p2"]),
            GroupingChapter(chapterId="ch_2", photoIds=["p3", "p4"]),
            GroupingChapter(chapterId="ch_3", photoIds=["p5"]),
        ],
        unplacedPhotoIds=[],
    )

    tree = assemble_stage1_tree(
        grouping, UnplacedAssignments(assignments={}), photos_by_id
    )

    _assert_covers_each_photo_once(tree, photos_by_id)
    labels = [c.title for c in tree.chapters]
    assert len(set(labels)) == len(labels), labels
    assert all(label.strip() for label in labels)
    # 标签带日期跨度,不只是年月。
    assert labels[0] == "2024 年 03 月 11–14 日"
    assert labels[1] == "2024 年 03 月 11–14 日 · 第 2 段"
    assert labels[2] == "2024 年 03 月 20 日"


def test_tree_labels_stay_distinct_without_any_exif():
    photos = [_photo("p1"), _photo("p2"), _photo("p3")]
    photos_by_id = _by_id(photos)
    grouping = GroupingResult(
        chapters=[
            GroupingChapter(chapterId="ch_1", photoIds=["p1"]),
            GroupingChapter(chapterId="ch_2", photoIds=["p2"]),
            GroupingChapter(chapterId="ch_3", photoIds=["p3"]),
        ],
        unplacedPhotoIds=[],
    )

    tree = assemble_stage1_tree(
        grouping, UnplacedAssignments(assignments={}), photos_by_id
    )

    _assert_covers_each_photo_once(tree, photos_by_id)
    labels = [c.title for c in tree.chapters]
    assert labels == ["这一段", "这一段 2", "这一段 3"]
    # 章标识落在 title,description 是写目录环节的位置,分析期必须留空。
    assert [c.description for c in tree.chapters] == ["", "", ""]


def test_tree_labels_localize_for_english_books():
    """EN 书的章标签按 language=en 出(2026-10-26 浏览器实测 EN 界面露出「这一段」后补)。"""
    photos = [
        _photo("p1", taken_at="2024-03-11T09:00:00Z"),
        _photo("p2", taken_at="2024-03-14T09:00:00Z"),
    ]
    photos_by_id = _by_id(photos)
    grouping = GroupingResult(
        chapters=[GroupingChapter(chapterId="ch_1", photoIds=["p1", "p2"])],
        unplacedPhotoIds=[],
    )

    tree = assemble_stage1_tree(
        grouping, UnplacedAssignments(assignments={}), photos_by_id, language="en"
    )
    assert [c.title for c in tree.chapters] == ["Mar 11–14, 2024"]

    # 无 EXIF 的回退标识与消歧序号同样走 EN 文案。
    no_time_photos = [_photo("p1"), _photo("p2")]
    no_time = GroupingResult(
        chapters=[
            GroupingChapter(chapterId="ch_1", photoIds=["p1"]),
            GroupingChapter(chapterId="ch_2", photoIds=["p2"]),
        ],
        unplacedPhotoIds=[],
    )
    tree2 = assemble_stage1_tree(
        no_time, UnplacedAssignments(assignments={}), _by_id(no_time_photos),
        language="en",
    )
    assert [c.title for c in tree2.chapters] == [
        "Untitled section", "Untitled section 2",
    ]

    # 同日撞名的消歧后缀也按语言出。
    same_day_photos = [
        _photo("p1", taken_at="2024-03-11T09:00:00Z"),
        _photo("p2", taken_at="2024-03-11T21:00:00Z"),
    ]
    same_day = GroupingResult(
        chapters=[
            GroupingChapter(chapterId="ch_1", photoIds=["p1"]),
            GroupingChapter(chapterId="ch_2", photoIds=["p2"]),
        ],
        unplacedPhotoIds=[],
    )
    tree3 = assemble_stage1_tree(
        same_day, UnplacedAssignments(assignments={}), _by_id(same_day_photos),
        language="en",
    )
    assert [c.title for c in tree3.chapters] == [
        "Mar 11, 2024", "Mar 11, 2024 · Part 2",
    ]


def test_tree_titles_never_exceed_the_contract_max_length(monkeypatch):
    # 建树用的是构造后赋值(绕过 pydantic 校验),所以哪怕标签算长了,落进
    # V3Chapter.title 的值也必须 <= 120,否则 Web 侧 zod 会把整个 analyze 打回。
    monkeypatch.setattr(
        "src.workflows.core.chaptering.tree_builder.deterministic_chapter_label",
        lambda **kwargs: "长" * 300,
    )
    photos = [
        _photo("p1", taken_at="2024-03-01T09:00:00Z"),
        _photo("p2", taken_at="2024-06-01T09:00:00Z"),
    ]
    photos_by_id = _by_id(photos)
    grouping = GroupingResult(
        chapters=[
            GroupingChapter(chapterId="ch_1", photoIds=["p1"]),
            GroupingChapter(chapterId="ch_2", photoIds=["p2"]),
        ],
        unplacedPhotoIds=[],
    )
    tree = assemble_stage1_tree(grouping, UnplacedAssignments(assignments={}), photos_by_id)

    assert all(len(c.title) <= 120 for c in tree.chapters)
    # 截断不能把消歧吃掉:同一棵树里章标识仍要两两不同。
    assert len({c.title for c in tree.chapters}) == len(tree.chapters)
