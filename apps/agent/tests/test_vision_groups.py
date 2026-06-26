from __future__ import annotations

import asyncio
import json

import pytest

from src import ai_client
from src.agents.image_grouping.handler import group_photos
from src.agents.image_grouping.schema import GroupingChapter, GroupingResult
from src.agents.image_understanding import handler as vision
from src.agents.image_understanding.schema import DescribeResult
from src.agents.regroup_unplaced.handler import group_unplaced
from src.schemas import V3AnalyzePhoto


def _photo(
    photo_id: str,
    *,
    cluster_id: str | None = None,
    taken_at: str | None = None,
) -> V3AnalyzePhoto:
    payload = {
        "photoId": photo_id,
        "base64": "data:image/jpeg;base64,AA==",
        "width": 800,
        "height": 600,
        "clusterId": cluster_id,
    }
    if taken_at is not None:
        payload["exif"] = {"takenAt": taken_at}
    return V3AnalyzePhoto.model_validate(payload)


def _assert_partition(result: GroupingResult, expected: set[str]) -> None:
    chapter_ids = [pid for chapter in result.chapters for pid in chapter.photoIds]
    all_ids = chapter_ids + list(result.unplacedPhotoIds)
    assert len(result.chapters) >= 1
    assert set(all_ids) == expected
    assert len(all_ids) == len(set(all_ids))


def _chapter_photo_ids(result: GroupingResult) -> list[list[str]]:
    return [chapter.photoIds for chapter in result.chapters]


def test_grouping_never_returns_zero_chapters():
    result = group_photos([])

    assert len(result.chapters) == 1
    assert result.chapters[0].chapterId == "ch_1"
    assert result.chapters[0].photoIds == []
    assert result.unplacedPhotoIds == []


def test_grouping_has_full_coverage_no_duplicates():
    photos = [
        _photo("p1", cluster_id="c1", taken_at="2024-01-01T10:00:00Z"),
        _photo("p2", cluster_id="c1", taken_at="2024-01-01T10:01:00Z"),
        _photo("p3", cluster_id="c2", taken_at="2024-01-02T10:00:00Z"),
        _photo("p4", cluster_id=None, taken_at="2024-01-03T10:00:00Z"),
    ]

    result = group_photos(photos)

    _assert_partition(result, {"p1", "p2", "p3", "p4"})


def test_grouping_keeps_cluster_atomic():
    photos = [
        _photo("p1", cluster_id="c1"),
        _photo("p2", cluster_id="c1"),
        _photo("p3", cluster_id="c2"),
        _photo("p4", cluster_id="c2"),
    ]

    result = group_photos(photos)

    owner: dict[str, str] = {}
    for chapter in result.chapters:
        for photo_id in chapter.photoIds:
            owner[photo_id] = chapter.chapterId
    for photo_id in result.unplacedPhotoIds:
        owner[photo_id] = "__unplaced__"
    assert owner["p1"] == owner["p2"]
    assert owner["p3"] == owner["p4"]


def test_grouping_splits_distinct_dates_and_clusters_into_chapters():
    photos = [
        _photo("p1", cluster_id="morning", taken_at="2024-01-01T09:00:00Z"),
        _photo("p2", cluster_id="morning", taken_at="2024-01-01T09:05:00Z"),
        _photo("p3", cluster_id="evening", taken_at="2024-01-04T18:00:00Z"),
        _photo("p4", cluster_id="evening", taken_at="2024-01-04T18:05:00Z"),
    ]

    result = group_photos(photos)

    assert _chapter_photo_ids(result) == [["p1", "p2"], ["p3", "p4"]]
    assert result.unplacedPhotoIds == []


def test_grouping_splits_many_unclustered_undated_photos_by_soft_limit():
    photos = [_photo(f"p{i + 1}") for i in range(25)]

    result = group_photos(photos)

    assert _chapter_photo_ids(result) == [
        [f"p{i + 1}" for i in range(20)],
        [f"p{i + 1}" for i in range(20, 25)],
    ]
    assert result.unplacedPhotoIds == []


def test_grouping_keeps_oversized_cluster_atomic_when_splitting_later_units():
    cluster_ids = [f"p{i + 1}" for i in range(25)]
    photos = [
        _photo(photo_id, cluster_id="oversized", taken_at="2024-01-01T10:00:00Z")
        for photo_id in cluster_ids
    ]
    photos.append(_photo("p26", cluster_id="next", taken_at="2024-01-05T10:00:00Z"))

    result = group_photos(photos)

    assert _chapter_photo_ids(result) == [cluster_ids, ["p26"]]
    assert result.unplacedPhotoIds == []


def test_describe_chapters_retries_recoverable_missing_scene(monkeypatch):
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    monkeypatch.setenv("VISION_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "fake_oai")
    monkeypatch.setenv("ARK_API_KEY", "fake_ark")
    from src import settings as s

    s.reset_settings_cache()
    calls: list[list[dict]] = []

    def _completion(content: dict) -> dict:
        return {
            "choices": [{"message": {"content": json.dumps(content)}}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 4},
        }

    async def fake_completion(**kwargs):
        calls.append(kwargs["messages"])
        if len(calls) == 1:
            return _completion(
                {
                    "chapters": [
                        {
                            "chapterId": "ch_1",
                            "description": "One chapter.",
                            "scenes": {"1": "scene one"},
                        }
                    ]
                }
            )
        return _completion(
            {
                "chapters": [
                    {
                        "chapterId": "ch_1",
                        "description": "One chapter.",
                        "scenes": {"1": "scene one", "2": "scene two"},
                    }
                ]
            }
        )

    monkeypatch.setattr(ai_client, "chat_completion", fake_completion)
    try:
        result = asyncio.run(
            vision.describe_chapters(
                GroupingResult(
                    chapters=[GroupingChapter(chapterId="ch_1", photoIds=["p1", "p2"])],
                    unplacedPhotoIds=[],
                ),
                {"p1": _photo("p1"), "p2": _photo("p2")},
                language="en",
            )
        )
    finally:
        s.reset_settings_cache()

    assert result.imageDescriptions == {"p1": "scene one", "p2": "scene two"}
    assert result.tokens_billed == 14
    assert result.call_count == 1
    assert len(calls) == 2
    assert "describe_retry" not in calls[0][-1]["content"]
    assert len(calls[1]) == 3
    assert "scenes.p2 must be a string" in calls[1][-1]["content"]


def test_unplaced_cluster_assignment_is_atomic_when_model_unavailable(monkeypatch):
    photos = [
        _photo("p1", cluster_id="c1", taken_at="2024-01-01T10:00:00Z"),
        _photo("p2", cluster_id="c2", taken_at="2024-01-03T10:00:00Z"),
        _photo("p3", cluster_id="c3", taken_at="2024-01-02T10:00:00Z"),
        _photo("p4", cluster_id="c3", taken_at="2024-01-02T10:01:00Z"),
    ]
    grouping = GroupingResult(
        chapters=[
            GroupingChapter(chapterId="ch_1", photoIds=["p1"]),
            GroupingChapter(chapterId="ch_2", photoIds=["p2"]),
        ],
        unplacedPhotoIds=["p3", "p4"],
    )
    descriptions = DescribeResult(
        chapterDescriptions={"ch_1": "morning", "ch_2": "afternoon"},
        imageDescriptions={
            "p1": "morning",
            "p2": "afternoon",
            "p3": "middle",
            "p4": "middle detail",
        },
    )

    assignments = group_unplaced(
        grouping,
        descriptions,
        {photo.photoId: photo for photo in photos},
        language="en",
    )

    assert set(assignments.assignments) == {"p3", "p4"}
    assert assignments.assignments["p3"] == assignments.assignments["p4"]
    assert assignments.assignments["p3"] in {"ch_1", "ch_2"}


def test_unplaced_regroup_rejects_zero_target_chapters():
    with pytest.raises(ValueError, match="at least one chapter"):
        group_unplaced(
            GroupingResult(chapters=[], unplacedPhotoIds=["p1"]),
            DescribeResult(chapterDescriptions={}, imageDescriptions={"p1": "scene"}),
            {"p1": _photo("p1")},
            language="en",
        )
