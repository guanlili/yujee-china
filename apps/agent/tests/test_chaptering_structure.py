from __future__ import annotations

from src.agents.chapter_describer import handler as chapter_describer
from src.agents.unplaced_refiner import handler as unplaced_refiner
from src.chaptering import grouping, refinement, tree_builder, unplaced
from src.chaptering.schema import GroupingChapter, GroupingResult, UnplacedAssignments


def test_chaptering_package_owns_stage1_business_steps() -> None:
    assert grouping.group_photos.__module__ == "src.chaptering.grouping"
    assert refinement.refine_unplaced.__module__ == "src.chaptering.refinement"
    assert unplaced.group_unplaced.__module__ == "src.chaptering.unplaced"
    assert tree_builder.assemble_stage1_tree.__module__ == "src.chaptering.tree_builder"


def test_stage1_ai_capabilities_are_separate_agents() -> None:
    assert chapter_describer.describe_chapters.__module__ == (
        "src.agents.chapter_describer.handler"
    )
    assert unplaced_refiner.assign_unplaced_to_chapters.__module__ == (
        "src.agents.unplaced_refiner.handler"
    )


def test_chaptering_schema_names_the_stage1_intermediate_contracts() -> None:
    grouping_result = GroupingResult(
        chapters=[GroupingChapter(chapterId="ch_1", photoIds=["p1"])],
        unplacedPhotoIds=["p2"],
    )
    assignments = UnplacedAssignments(assignments={"p2": "ch_1"})

    assert grouping_result.chapters[0].chapterId == "ch_1"
    assert assignments.assignments == {"p2": "ch_1"}
