from __future__ import annotations

from src.workflows.core.chaptering import grouping, tree_builder, unplaced
from src.workflows.core.chaptering.schema import GroupingChapter, GroupingResult, UnplacedAssignments


def test_chaptering_package_owns_stage1_business_steps() -> None:
    assert grouping.group_photos.__module__ == "src.workflows.core.chaptering.grouping"
    assert unplaced.group_unplaced.__module__ == "src.workflows.core.chaptering.unplaced"
    assert tree_builder.assemble_stage1_tree.__module__ == "src.workflows.core.chaptering.tree_builder"


def test_stage1_has_no_ai_capabilities_left() -> None:
    """分章环节已砍掉豆包识图与 AI 补充分章:这两个 agent 包不该复活。"""
    from pathlib import Path

    chaptering_root = Path(unplaced.__file__).resolve().parent
    assert not (chaptering_root / "chapter_describer").exists()
    assert not (chaptering_root / "unplaced_refiner").exists()
    assert not (chaptering_root / "refinement.py").exists()


def test_chaptering_schema_names_the_stage1_intermediate_contracts() -> None:
    grouping_result = GroupingResult(
        chapters=[GroupingChapter(chapterId="ch_1", photoIds=["p1"])],
        unplacedPhotoIds=["p2"],
    )
    assignments = UnplacedAssignments(assignments={"p2": "ch_1"})

    assert grouping_result.chapters[0].chapterId == "ch_1"
    assert assignments.assignments == {"p2": "ch_1"}
