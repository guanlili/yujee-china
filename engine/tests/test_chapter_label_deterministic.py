"""章标题在砍掉豆包识图后由时间/地点确定性派生。"""
from src.workflows.core.chaptering import tree_builder


def test_label_from_time_and_place():
    label = tree_builder.deterministic_chapter_label(
        taken_ats=["2024-03-11T09:00:00Z", "2024-03-12T18:00:00Z"],
        places=["杭州", "杭州"],
    )
    assert "2024" in label and "杭州" in label


def test_label_without_place_falls_back_to_time_only():
    label = tree_builder.deterministic_chapter_label(
        taken_ats=["2024-03-11T09:00:00Z"], places=[]
    )
    assert "2024" in label
    assert label.strip() != ""


def test_label_without_any_signal_is_still_nonempty():
    assert tree_builder.deterministic_chapter_label(taken_ats=[], places=[]).strip() != ""
