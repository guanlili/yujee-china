"""章标题在砍掉豆包识图后由时间/地点确定性派生。"""
from src.workflows.core.chaptering import tree_builder


def test_label_from_time_and_place():
    label = tree_builder.deterministic_chapter_label(
        taken_ats=["2024-03-11T09:00:00Z", "2024-03-12T18:00:00Z"],
        places=["杭州", "杭州"],
    )
    assert "2024" in label and "杭州" in label


def test_label_carries_the_date_span_not_only_the_month():
    # 只写年月会让同月的两章撞名,标签必须带日期跨度。
    label = tree_builder.deterministic_chapter_label(
        taken_ats=["2024-03-11T09:00:00Z", "2024-03-14T18:00:00Z"], places=[]
    )
    assert label == "2024 年 03 月 11–14 日"


def test_label_span_across_months_and_years():
    assert tree_builder.deterministic_chapter_label(
        taken_ats=["2024-03-30T09:00:00Z", "2024-04-02T09:00:00Z"], places=[]
    ) == "2024 年 03 月 30 日 – 04 月 02 日"
    assert tree_builder.deterministic_chapter_label(
        taken_ats=["2024-12-30T09:00:00Z", "2025-01-02T09:00:00Z"], places=[]
    ) == "2024 年 12 月 30 日 – 2025 年 01 月 02 日"


def test_label_without_place_falls_back_to_time_only():
    label = tree_builder.deterministic_chapter_label(
        taken_ats=["2024-03-11T09:00:00Z"], places=[]
    )
    assert "2024" in label
    assert label.strip() != ""


def test_label_without_any_signal_is_still_nonempty():
    assert tree_builder.deterministic_chapter_label(taken_ats=[], places=[]).strip() != ""
