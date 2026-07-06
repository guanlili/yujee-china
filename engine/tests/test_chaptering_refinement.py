from __future__ import annotations

import asyncio

from src.workflows.core.chaptering.chapter_describer.schema import DescribeResult
from src.workflows.core.chaptering import refinement, tree_builder
from src.workflows.core.chaptering.schema import (
    GroupingChapter,
    GroupingResult,
    NewChapter,
    UnplacedAssignments,
)
from src.contracts.schemas import V3AnalyzePhoto


def _photo(photo_id: str, *, taken_at: str | None = None) -> V3AnalyzePhoto:
    payload: dict[str, object] = {
        "photoId": photo_id,
        "base64": "data:image/jpeg;base64,AA==",
        "width": 800,
        "height": 600,
    }
    if taken_at:
        payload["exif"] = {"takenAt": taken_at}
    return V3AnalyzePhoto.model_validate(payload)


def test_refinement_accepts_ai_new_chapter_assignments() -> None:
    photos = {
        "p1": _photo("p1", taken_at="2024-03-01T10:00:00Z"),
        "p2": _photo("p2", taken_at="2024-03-01T10:05:00Z"),
        "p3": _photo("p3", taken_at="2024-03-01T10:10:00Z"),
    }
    grouping = GroupingResult(
        chapters=[GroupingChapter(chapterId="ch_1", photoIds=["p1"])],
        unplacedPhotoIds=["p2", "p3"],
    )
    descriptions = DescribeResult(
        chapterDescriptions={"ch_1": "A seaside travel chapter."},
        imageDescriptions={"p1": "People near the ocean."},
        chapterTitleHints={"ch_1": "Xiamen seaside trip"},
        chapterKeywords={"ch_1": ["Xiamen", "ocean", "couple"]},
        chapterVisualSummaries={"ch_1": "Two people near the sea."},
    )

    async def fake_assigner(grouping_arg, descriptions_arg, photos_arg, *, language):
        assert grouping_arg is grouping
        assert descriptions_arg.chapterKeywords["ch_1"] == [
            "Xiamen",
            "ocean",
            "couple",
        ]
        assert set(photos_arg) == {"p1", "p2", "p3"}
        assert language == "en"
        return UnplacedAssignments(
            assignments={"p2": "ch_1", "p3": "new_ch_1"},
            newChapters=[
                NewChapter(
                    chapterId="new_ch_1",
                    photoIds=["p3"],
                    chapterTitleHint="Family dinner",
                    chapterKeywords=["family", "restaurant", "dinner"],
                    chapterVisualSummary="A warm indoor dinner scene.",
                )
            ],
        )

    result = asyncio.run(
        refinement.refine_unplaced(
            grouping,
            descriptions,
            photos,
            language="en",
            assigner=fake_assigner,
        )
    )

    assert result.assignments == {"p2": "ch_1", "p3": "new_ch_1"}
    assert result.newChapters[0].chapterId == "new_ch_1"
    assert result.newChapters[0].chapterKeywords == [
        "family",
        "restaurant",
        "dinner",
    ]


def test_tree_builder_adds_ai_created_chapters() -> None:
    photos = {
        "p1": _photo("p1", taken_at="2024-03-01T10:00:00Z"),
        "p2": _photo("p2", taken_at="2024-03-01T10:05:00Z"),
    }
    grouping = GroupingResult(
        chapters=[GroupingChapter(chapterId="ch_1", photoIds=["p1"])],
        unplacedPhotoIds=["p2"],
    )
    descriptions = DescribeResult(
        chapterDescriptions={"ch_1": "A seaside travel chapter."},
        imageDescriptions={"p1": "People near the ocean."},
        chapterTitleHints={"ch_1": "Xiamen seaside trip"},
        chapterKeywords={"ch_1": ["Xiamen", "ocean", "couple"]},
        chapterVisualSummaries={"ch_1": "Two people near the sea."},
    )
    assignments = UnplacedAssignments(
        assignments={"p2": "new_ch_1"},
        newChapters=[
            NewChapter(
                chapterId="new_ch_1",
                photoIds=["p2"],
                chapterTitleHint="Family dinner",
                chapterKeywords=["family", "restaurant", "dinner"],
                chapterVisualSummary="A warm indoor dinner scene.",
            )
        ],
    )

    tree = tree_builder.assemble_stage1_tree(grouping, descriptions, assignments, photos)

    assert [chapter.chapterId for chapter in tree.chapters] == ["ch_1", "new_ch_1"]
    # 章节 description 是目录占位:分析期统一留空。
    assert tree.chapters[1].description == ""
    assert tree.chapters[1].photos[0].photoId == "p2"
    assert tree.chapters[1].photos[0].sceneDescription == "A warm indoor dinner scene."
