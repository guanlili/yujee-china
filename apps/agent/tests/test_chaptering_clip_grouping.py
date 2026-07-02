from __future__ import annotations

import base64
import io
import sys
import threading
import time

from PIL import Image

from src import settings as settings_mod
from src.chaptering import features
from src.chaptering.grouping import group_photos
from src.chaptering.schema import GroupingParams
from src.schemas import V3AnalyzePhoto


def _data_url(color: tuple[int, int, int]) -> str:
    image = Image.new("RGB", (32, 32), color)
    buf = io.BytesIO()
    image.save(buf, format="JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _photo(
    photo_id: str,
    *,
    color: tuple[int, int, int] = (128, 128, 128),
    taken_at: str | None = None,
) -> V3AnalyzePhoto:
    payload: dict[str, object] = {
        "photoId": photo_id,
        "base64": _data_url(color),
        "width": 32,
        "height": 32,
    }
    if taken_at is not None:
        payload["exif"] = {"takenAt": taken_at}
    return V3AnalyzePhoto.model_validate(payload)


def _chapter_ids(result) -> list[list[str]]:
    return [chapter.photoIds for chapter in result.chapters]


def test_grouping_params_control_time_boundary() -> None:
    photos = [
        _photo("p1", taken_at="2024-03-01T10:00:00Z"),
        _photo("p2", taken_at="2024-03-02T10:00:00Z"),
        _photo("p3", taken_at="2024-03-12T10:00:00Z"),
    ]

    result = group_photos(photos, GroupingParams(timeGapDays=7, subsplitMin=99))

    assert _chapter_ids(result) == [["p1", "p2"], ["p3"]]
    assert result.unplacedPhotoIds == []


def test_visual_subsplit_uses_clip_and_color_distance(monkeypatch) -> None:
    photos = [
        _photo("warm1", color=(220, 40, 35), taken_at="2024-03-01T10:00:00Z"),
        _photo("warm2", color=(225, 45, 38), taken_at="2024-03-01T10:01:00Z"),
        _photo("cool1", color=(30, 80, 220), taken_at="2024-03-01T10:02:00Z"),
        _photo("cool2", color=(35, 85, 225), taken_at="2024-03-01T10:03:00Z"),
    ]

    def fake_clip_embeddings(images):
        assert len(images) == 4
        return [
            [1.0, 0.0, 0.0],
            [0.98, 0.02, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.98, 0.02],
        ]

    monkeypatch.setattr(features, "clip_embeddings", fake_clip_embeddings)

    result = group_photos(
        photos,
        GroupingParams(subsplitMin=2, clipMinPhotos=2, alphaIn=0.45, tauIn=0.35),
    )

    assert _chapter_ids(result) == [["warm1", "warm2"], ["cool1", "cool2"]]
    assert result.unplacedPhotoIds == []


def test_visual_subsplit_marks_single_outliers_as_unplaced(monkeypatch) -> None:
    photos = [
        _photo("warm1", color=(220, 40, 35), taken_at="2024-03-01T10:00:00Z"),
        _photo("warm2", color=(225, 45, 38), taken_at="2024-03-01T10:01:00Z"),
        _photo("cool1", color=(30, 80, 220), taken_at="2024-03-01T10:02:00Z"),
        _photo("cool2", color=(35, 85, 225), taken_at="2024-03-01T10:03:00Z"),
        _photo("odd", color=(20, 180, 90), taken_at="2024-03-01T10:04:00Z"),
    ]

    def fake_clip_embeddings(images):
        assert len(images) == 5
        return [
            [1.0, 0.0, 0.0],
            [0.98, 0.02, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.98, 0.02],
            [0.0, 0.0, 1.0],
        ]

    monkeypatch.setattr(features, "clip_embeddings", fake_clip_embeddings)

    result = group_photos(
        photos,
        GroupingParams(subsplitMin=2, clipMinPhotos=2, alphaIn=0.45, tauIn=0.35),
    )

    assert _chapter_ids(result) == [["warm1", "warm2"], ["cool1", "cool2"]]
    assert result.unplacedPhotoIds == ["odd"]


def test_small_time_groups_still_run_clip_per_cell(monkeypatch) -> None:
    # 新默认:每个时间/地点簇(≥3 张)都进 CLIP+颜色,小簇不再整簇跳过。
    photos = [
        *[
            _photo(f"early{i}", taken_at=f"2024-03-01T10:{i:02d}:00Z")
            for i in range(6)
        ],
        *[
            _photo(f"late{i}", taken_at=f"2024-03-12T10:{i:02d}:00Z")
            for i in range(10)
        ],
    ]
    seen_sizes: list[int] = []

    def fake_clip_embeddings(images):
        seen_sizes.append(len(images))
        return [[1.0, 0.0] for _ in images]

    monkeypatch.setattr(features, "clip_embeddings", fake_clip_embeddings)
    monkeypatch.setattr(features, "pix_feat", lambda image: [0.0])

    # tauIn 足够大 → 每个簇内视觉高度相似,不切散,仍是两章。
    result = group_photos(
        photos, GroupingParams(timeGapDays=7, alphaIn=1.0, tauIn=0.86)
    )

    assert sorted(seen_sizes) == [6, 10]
    assert _chapter_ids(result) == [
        [f"early{i}" for i in range(6)],
        [f"late{i}" for i in range(10)],
    ]
    assert result.unplacedPhotoIds == []


def test_time_groups_above_ten_photos_use_clip_and_leave_outliers(monkeypatch) -> None:
    photos = [
        _photo(f"warm{i}", color=(220, 40, 35), taken_at=f"2024-03-01T10:{i:02d}:00Z")
        for i in range(5)
    ] + [
        _photo(f"cool{i}", color=(30, 80, 220), taken_at=f"2024-03-01T11:{i:02d}:00Z")
        for i in range(5)
    ] + [
        _photo("odd", color=(20, 180, 90), taken_at="2024-03-01T12:00:00Z")
    ]

    def fake_clip_embeddings(images):
        assert len(images) == 11
        return [
            *[[1.0, 0.0, 0.0] for _ in range(5)],
            *[[0.0, 1.0, 0.0] for _ in range(5)],
            [0.0, 0.0, 1.0],
        ]

    monkeypatch.setattr(features, "clip_embeddings", fake_clip_embeddings)
    monkeypatch.setattr(features, "pix_feat", lambda image: [0.0])

    result = group_photos(
        photos,
        GroupingParams(subsplitMin=2, alphaIn=1.0, tauIn=0.35),
    )

    assert _chapter_ids(result) == [
        [f"warm{i}" for i in range(5)],
        [f"cool{i}" for i in range(5)],
    ]
    assert result.unplacedPhotoIds == ["odd"]


def test_large_time_groups_process_visual_features_concurrently(monkeypatch) -> None:
    photos = [
        *[
            _photo(f"day1_{i}", taken_at=f"2024-03-01T10:{i:02d}:00Z")
            for i in range(11)
        ],
        *[
            _photo(f"day2_{i}", taken_at=f"2024-03-12T10:{i:02d}:00Z")
            for i in range(11)
        ],
    ]
    lock = threading.Lock()
    active = 0
    max_active = 0

    def fake_clip_embeddings(images):
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        time.sleep(0.05)
        with lock:
            active -= 1
        return [[1.0, 0.0] for _ in images]

    monkeypatch.setattr(features, "clip_embeddings", fake_clip_embeddings)
    monkeypatch.setattr(features, "pix_feat", lambda image: [0.0])

    result = group_photos(
        photos,
        GroupingParams(
            timeGapDays=7,
            subsplitMin=2,
            alphaIn=1.0,
            tauIn=0.35,
            visualConcurrency=2,
        ),
    )

    assert max_active == 2
    assert _chapter_ids(result) == [
        [f"day1_{i}" for i in range(11)],
        [f"day2_{i}" for i in range(11)],
    ]


def test_unbounded_concurrency_runs_all_cells_at_once(monkeypatch) -> None:
    # visualConcurrency<=0(默认)时,有几个时间簇就并发跑几个 CLIP,不封顶。
    days = ["2024-03-01", "2024-03-12", "2024-03-23"]
    photos = [
        _photo(f"day{d}_{i}", taken_at=f"{day}T10:{i:02d}:00Z")
        for d, day in enumerate(days)
        for i in range(3)
    ]
    lock = threading.Lock()
    active = 0
    max_active = 0

    def fake_clip_embeddings(images):
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        time.sleep(0.05)
        with lock:
            active -= 1
        return [[1.0, 0.0] for _ in images]

    monkeypatch.setattr(features, "clip_embeddings", fake_clip_embeddings)
    monkeypatch.setattr(features, "pix_feat", lambda image: [0.0])

    group_photos(
        photos,
        GroupingParams(timeGapDays=7, alphaIn=1.0, tauIn=0.35, visualConcurrency=0),
    )

    assert max_active == 3


def test_small_time_cell_still_enters_clip(monkeypatch) -> None:
    # 默认门槛 clipMinPhotos=3:3 张的时间簇也进 CLIP+颜色,不再整簇跳过。
    photos = [
        _photo("warm1", color=(220, 40, 35), taken_at="2024-03-01T10:00:00Z"),
        _photo("warm2", color=(225, 45, 38), taken_at="2024-03-01T10:01:00Z"),
        _photo("cool1", color=(30, 80, 220), taken_at="2024-03-01T10:02:00Z"),
    ]
    seen: list[int] = []

    def fake_clip_embeddings(images):
        seen.append(len(images))
        return [[1.0, 0.0, 0.0], [0.98, 0.02, 0.0], [0.0, 1.0, 0.0]]

    monkeypatch.setattr(features, "clip_embeddings", fake_clip_embeddings)

    group_photos(
        photos,
        GroupingParams(timeGapDays=7, alphaIn=1.0, tauIn=0.35),
    )

    assert seen == [3]


def test_clip_embeddings_can_use_remote_open_clip_service(monkeypatch) -> None:
    calls: list[dict[str, object]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"ok": True, "data": {"embeddings": [[1.0, 0.0], [0.0, 1.0]]}}

    class FakeClient:
        def __init__(self, *, timeout: float) -> None:
            assert timeout == 45

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url, *, json, headers):
            calls.append({"url": url, "json": json, "headers": headers})
            return FakeResponse()

    monkeypatch.setenv("GROUPING_CLIP_BASE_URL", "https://clip.test")
    monkeypatch.setenv("GROUPING_CLIP_TIMEOUT_SECONDS", "45")
    monkeypatch.setenv("GROUPING_CLIP_SECRET", "clip_secret")
    settings_mod.reset_settings_cache()
    monkeypatch.setattr("httpx.Client", FakeClient)

    try:
        result = features.clip_embeddings(
            [
                Image.new("RGB", (16, 16), (255, 0, 0)),
                Image.new("RGB", (16, 16), (0, 0, 255)),
            ]
        )
    finally:
        settings_mod.reset_settings_cache()

    assert result == [[1.0, 0.0], [0.0, 1.0]]
    assert calls[0]["url"] == "https://clip.test/internal/open-clip/embeddings"
    assert calls[0]["headers"] == {"Authorization": "Bearer clip_secret"}
    assert len(calls[0]["json"]["images"]) == 2


def test_remote_open_clip_batches_requests_at_thirty_images(monkeypatch) -> None:
    calls: list[int] = []

    class FakeResponse:
        def __init__(self, count: int) -> None:
            self.count = count

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"ok": True, "data": {"embeddings": [[1.0, 0.0] for _ in range(self.count)]}}

    class FakeClient:
        def __init__(self, *, timeout: float) -> None:
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url, *, json, headers):
            count = len(json["images"])
            calls.append(count)
            return FakeResponse(count)

    monkeypatch.setenv("GROUPING_CLIP_BASE_URL", "https://clip.test")
    monkeypatch.setenv("GROUPING_CLIP_SECRET", "clip_secret")
    settings_mod.reset_settings_cache()
    monkeypatch.setattr("httpx.Client", FakeClient)

    try:
        result = features.clip_embeddings(
            [Image.new("RGB", (16, 16), (i, i, i)) for i in range(65)]
        )
    finally:
        settings_mod.reset_settings_cache()

    assert calls == [30, 30, 5]
    assert len(result) == 65


def test_load_clip_can_import_from_grouping_pythonpath(monkeypatch, tmp_path) -> None:
    vendor = tmp_path / "vendor"
    vendor.mkdir()
    (vendor / "open_clip.py").write_text(
        """
class FakeModel:
    loaded_from_grouping_pythonpath = True
    visual = type("Visual", (), {"image_size": 224})()

    def eval(self):
        return self


def create_model_and_transforms(model_name, pretrained, device):
    return FakeModel(), None, lambda image: image
""".strip()
    )

    monkeypatch.setenv("GROUPING_PYTHONPATH", str(vendor))
    monkeypatch.delitem(sys.modules, "open_clip", raising=False)
    settings_mod.reset_settings_cache()
    features._load_clip.cache_clear()

    try:
        model, preprocess = features._load_clip()

        assert model.loaded_from_grouping_pythonpath is True
        assert preprocess is not None
    finally:
        features._load_clip.cache_clear()
        settings_mod.reset_settings_cache()
        monkeypatch.delitem(sys.modules, "open_clip", raising=False)
        if str(vendor) in sys.path:
            sys.path.remove(str(vendor))
