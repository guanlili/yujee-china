"""PhotoProfile 的 pydantic 镜像。

隐私红线(extra=forbid)和 TS/Python 字段一致性都在这里守 —— 后者防两边漂移,
这个仓库栽过契约漂移的跟头。
"""

import json
import pathlib
import re

import pytest
from pydantic import ValidationError

from src.contracts.photo_profile import PhotoProfile

VALID = {
    "v": 1,
    "subjectBox": {"x": 20, "y": 10, "w": 55, "h": 70},
    "faceBoxes": [{"x": 30, "y": 15, "w": 20, "h": 25}],
    "maskKey": None,
    "colorTemp": "warm",
    "brightness": "mid",
    "saturation": "normal",
    "dominantColors": ["#C8A05A", "#2E3B4E"],
    "composition": "focal",
    "scene": "outdoor",
    "peopleCount": "1",
    "mood": "warm",
    "description": "傍晚海边,一个人背对镜头站在礁石上",
}


def test_accepts_valid_profile():
    assert PhotoProfile.model_validate(VALID).v == 1


def test_rejects_out_of_range_box():
    bad = {**VALID, "subjectBox": {"x": 20, "y": 10, "w": 150, "h": 70}}
    with pytest.raises(ValidationError):
        PhotoProfile.model_validate(bad)


def test_subject_box_nullable():
    assert PhotoProfile.model_validate({**VALID, "subjectBox": None}).subjectBox is None


def test_composition_nullable_for_a_failed_semantic_group():
    """语义组失败时 composition 落 None —— 契约必须收得下。

    编一个 focal 会让 slot_matcher_v3 按错误的构图约束匹配槽位(它对 None 的处置
    是「视作任意,不挡」,那才是正确的降级)。
    """
    assert PhotoProfile.model_validate({**VALID, "composition": None}).composition is None


def test_face_boxes_default_empty():
    without = {k: v for k, v in VALID.items() if k != "faceBoxes"}
    assert PhotoProfile.model_validate(without).faceBoxes == []


def test_dominant_colors_capped_at_three():
    with pytest.raises(ValidationError):
        PhotoProfile.model_validate({**VALID, "dominantColors": ["#112233", "#445566", "#778899", "#AABBCC"]})


def test_description_length_capped():
    with pytest.raises(ValidationError):
        PhotoProfile.model_validate({**VALID, "description": "很长" * 200})


@pytest.mark.parametrize(
    "key",
    ["location", "place", "gps", "lat", "lng", "latitude", "longitude", "coordinate", "coordinates"],
)
def test_privacy_redline_rejects_location_keys(key):
    """隐私红线:任何位置信息字段都必须在 parse 期被拒。"""
    with pytest.raises(ValidationError):
        PhotoProfile.model_validate({**VALID, key: "anything"})


def test_ts_and_python_fields_match():
    """TS 侧字段名与 Python 侧逐一对应 —— 防两边漂移。"""
    ts = pathlib.Path(__file__).resolve().parents[2] / "packages/contracts/src/photo-profile.ts"
    source = ts.read_text(encoding="utf-8")
    body = source.split("export const PhotoProfileSchema = z.object({", 1)[1]
    body = body.split("}).strict();", 1)[0]
    # 只取顶层字段名(两空格缩进),跳过注释行
    ts_fields = set(re.findall(r"^  (\w+):", body, re.MULTILINE))
    py_fields = set(PhotoProfile.model_fields.keys())
    assert ts_fields == py_fields, (
        f"契约漂移:TS 独有={ts_fields - py_fields} Python 独有={py_fields - ts_fields}"
    )


# ── 跨语言黄金样本(2026-09-09)────────────────────────────────────────
# 与 packages/contracts 共用同一份 fixture。两侧原本各自对着【自己想象的形状】测:
# engine 测「我发的 body 对」(对着自己的桩)、web 测「我收的 body 对」(对着自己造的
# body)。形状一旦对不上,两边都绿、线上断 —— composition 可空性漂移就是这么溜过去的。


def _samples() -> dict:
    fixture = (
        pathlib.Path(__file__).resolve().parents[2]
        / "packages/contracts/fixtures/photo-profile-samples.json"
    )
    return json.loads(fixture.read_text(encoding="utf-8"))["samples"]


def test_golden_samples_all_parse():
    samples = _samples()
    assert len(samples) >= 3, "fixture 至少要覆盖 正常/语义降级/带 mask 三种"
    for name, payload in samples.items():
        PhotoProfile.model_validate(payload)  # 抛就是漂移


def test_golden_samples_round_trip_byte_identical():
    """parse 再 dump 必须逐字回到原样 —— 默认值/别名/序列化口径的漂移都会在这里现形。"""
    for name, payload in _samples().items():
        again = json.loads(PhotoProfile.model_validate(payload).model_dump_json())
        assert again == payload, f"{name} 往返不一致:{again} != {payload}"


def test_golden_sample_covers_semantic_degradation():
    """钉住 fixture 没被人「顺手修好」—— 它存在的意义就是覆盖 composition=None 那条降级路径。"""
    assert _samples()["semantic_degraded"]["composition"] is None
