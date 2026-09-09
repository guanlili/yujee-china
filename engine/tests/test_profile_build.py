"""三组合一。重点:输出必须能被 PhotoProfile 契约直接 parse —— 这是 A/B 两线的接缝。"""

import pytest
from PIL import Image

from src.contracts.photo_profile import PhotoProfile
from src.workflows.core.profile import build


@pytest.fixture(autouse=True)
def _stub_heavy(monkeypatch):
    """几何和语义打桩 —— 单测不下模型权重、不打真 API。色彩组是纯像素,真跑。"""
    monkeypatch.setattr(
        build, "subject_geometry",
        lambda image: {"subjectBox": {"x": 10.0, "y": 20.0, "w": 50.0, "h": 60.0}, "faceBoxes": []},
    )
    monkeypatch.setattr(
        build, "semantic_features",
        lambda image: {
            "composition": "focal", "scene": "outdoor", "peopleCount": "1",
            "mood": "warm", "description": "海边",
        },
    )


def test_output_parses_as_contract():
    """A 线的产出必须能被 B 线的契约直接吃下 —— 这是两线的接缝,漂了就白干。"""
    profile = build.build_profile(Image.new("RGB", (64, 64), (200, 140, 80)))
    parsed = PhotoProfile.model_validate(profile)
    assert parsed.v == 1
    assert parsed.subjectBox.w == 50.0


def test_mask_key_defaults_to_none():
    """建档不存 mask —— 绝大多数照片不会被抠。"""
    assert build.build_profile(Image.new("RGB", (32, 32)))["maskKey"] is None


def test_no_location_keys_in_output():
    """隐私红线的第三道闸:组装层自己也不许漏进位置字段。"""
    profile = build.build_profile(Image.new("RGB", (32, 32)))
    forbidden = {"location", "place", "gps", "lat", "lng", "latitude", "longitude", "coordinate", "coordinates"}
    assert not (set(profile) & forbidden)


def test_geometry_failure_degrades_not_crashes(monkeypatch):
    """模型挂了要降级成「没主体」,不是整本分析失败。"""
    monkeypatch.setattr(build, "subject_geometry", lambda image: (_ for _ in ()).throw(RuntimeError("model down")))
    profile = build.build_profile(Image.new("RGB", (32, 32)))
    assert profile["subjectBox"] is None
    assert profile["faceBoxes"] == []
    PhotoProfile.model_validate(profile)  # 降级后仍然是合法档案


def test_semantic_failure_degrades_not_crashes(monkeypatch):
    """语义组整个抛出来也一样要降级 —— semantic_features 自己兜了底,但组装层
    不能假设它永远不抛(比如 settings 缺 key 时 select_vision_slot 会 raise)。"""
    monkeypatch.setattr(
        build, "semantic_features", lambda image: (_ for _ in ()).throw(RuntimeError("vision down"))
    )
    profile = build.build_profile(Image.new("RGB", (32, 32)))
    assert profile["composition"] == "focal"
    assert profile["description"] == ""
    PhotoProfile.model_validate(profile)


def test_color_group_is_really_computed():
    """色彩组不打桩 —— 暖色图必须读出 warm,证明三组是真的合到一起了。"""
    profile = build.build_profile(Image.new("RGB", (64, 64), (220, 150, 70)))
    assert profile["colorTemp"] == "warm"
    assert profile["dominantColors"]
