from __future__ import annotations

import base64
import io

from PIL import Image

from src.workflows.core.chaptering.grouping import group_photos
from src.workflows.core.chaptering.schema import GroupingParams, GroupingResult
from src.contracts.schemas import V3AnalyzePhoto


def _data_url(color: tuple[int, int, int] = (128, 128, 128)) -> str:
    image = Image.new("RGB", (32, 32), color)
    buf = io.BytesIO()
    image.save(buf, format="JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _photo(
    photo_id: str,
    *,
    cluster_id: str | None = None,
    taken_at: str | None = None,
) -> V3AnalyzePhoto:
    payload = {
        "photoId": photo_id,
        "base64": _data_url(),
        "width": 32,
        "height": 32,
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


def _stub_clip_features(monkeypatch) -> None:
    # 默认已开启每簇 CLIP+颜色子分组;本地无 torch,用同质 stub 让子分组不切散。
    from src.workflows.core.chaptering import features

    monkeypatch.setattr(
        features, "clip_embeddings", lambda images: [[1.0, 0.0] for _ in images]
    )
    monkeypatch.setattr(features, "pix_feat", lambda image: [0.0])


def test_grouping_has_full_coverage_no_duplicates(monkeypatch):
    _stub_clip_features(monkeypatch)
    photos = [
        _photo("p1", cluster_id="c1", taken_at="2024-01-01T10:00:00Z"),
        _photo("p2", cluster_id="c1", taken_at="2024-01-01T10:01:00Z"),
        _photo("p3", cluster_id="c2", taken_at="2024-01-02T10:00:00Z"),
        _photo("p4", cluster_id=None, taken_at="2024-01-03T10:00:00Z"),
    ]

    result = group_photos(photos)

    _assert_partition(result, {"p1", "p2", "p3", "p4"})


def test_grouping_keeps_cluster_atomic(monkeypatch):
    _stub_clip_features(monkeypatch)
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
        _photo("p3", cluster_id="evening", taken_at="2024-01-10T18:00:00Z"),
        _photo("p4", cluster_id="evening", taken_at="2024-01-10T18:05:00Z"),
    ]

    result = group_photos(photos)

    assert _chapter_photo_ids(result) == [["p1", "p2"], ["p3", "p4"]]
    assert result.unplacedPhotoIds == []


def test_grouping_keeps_undated_photos_together_without_visual_subsplit():
    photos = [_photo(f"p{i + 1}") for i in range(25)]

    result = group_photos(photos, GroupingParams(subsplitMin=99))

    assert _chapter_photo_ids(result) == [
        [f"p{i + 1}" for i in range(25)],
    ]
    assert result.unplacedPhotoIds == []


def test_grouping_time_gap_splits_later_units():
    cluster_ids = [f"p{i + 1}" for i in range(25)]
    photos = [
        _photo(photo_id, cluster_id="oversized", taken_at="2024-01-01T10:00:00Z")
        for photo_id in cluster_ids
    ]
    photos.append(_photo("p26", cluster_id="next", taken_at="2024-01-12T10:00:00Z"))

    result = group_photos(photos, GroupingParams(subsplitMin=99))

    assert _chapter_photo_ids(result) == [cluster_ids, ["p26"]]
    assert result.unplacedPhotoIds == []
