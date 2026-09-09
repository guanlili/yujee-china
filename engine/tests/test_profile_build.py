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
        lambda image, **_: {"subjectBox": {"x": 10.0, "y": 20.0, "w": 50.0, "h": 60.0}, "faceBoxes": []},
    )
    monkeypatch.setattr(
        build, "semantic_features",
        lambda image, **_: {
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
    monkeypatch.setattr(
        build, "subject_geometry", lambda image, **_: (_ for _ in ()).throw(RuntimeError("model down"))
    )
    profile = build.build_profile(Image.new("RGB", (32, 32)))
    assert profile["subjectBox"] is None
    assert profile["faceBoxes"] == []
    PhotoProfile.model_validate(profile)  # 降级后仍然是合法档案


def test_semantic_failure_degrades_not_crashes(monkeypatch):
    """语义组整个抛出来也一样要降级 —— semantic_features 自己兜了底,但组装层
    不能假设它永远不抛(比如 settings 缺 key 时 select_vision_slot 会 raise)。"""
    monkeypatch.setattr(
        build, "semantic_features", lambda image, **_: (_ for _ in ()).throw(RuntimeError("vision down"))
    )
    profile = build.build_profile(Image.new("RGB", (32, 32)))
    # composition 落 None,不是编一个 focal —— 理由见
    # test_semantic_failure_leaves_composition_none_not_a_made_up_focal。
    assert profile["composition"] is None
    assert profile["description"] == ""
    PhotoProfile.model_validate(profile)


def test_color_group_is_really_computed():
    """色彩组不打桩 —— 暖色图必须读出 warm,证明三组是真的合到一起了。"""
    profile = build.build_profile(Image.new("RGB", (64, 64), (220, 150, 70)))
    assert profile["colorTemp"] == "warm"
    assert profile["dominantColors"]


# ── 一张坏图不该毒死整本 ────────────────────────────────────────────────────────


class _LogSpy:
    """替掉模块的 log,记下真的打了哪些日志。断言的是生产代码的行为,不是桩的行为。"""

    def __init__(self) -> None:
        self.warnings: list[tuple[str, dict]] = []

    def warning(self, event, **kw):
        self.warnings.append((event, kw))

    def info(self, event, **kw):
        pass

    def exception(self, event, **kw):
        self.warnings.append((event, kw))


def _truncated_jpeg() -> Image.Image:
    """能 open、不能 decode —— 上传中断/存储截断的真实形态。"""
    import io

    buf = io.BytesIO()
    Image.new("RGB", (400, 300), (200, 140, 80)).save(buf, format="JPEG", quality=90)
    raw = buf.getvalue()
    return Image.open(io.BytesIO(raw[: len(raw) // 2]))


def test_undecodable_image_raises_instead_of_fabricating_a_profile():
    """图本身解不开时**抛**,由调用方只丢这一张。

    ⚠️ 别改成「色彩组也包一层 try 落默认值」:那样会给一张根本没看过的照片编出
    一整份 neutral/mid/normal 的档案,跟语义组编 focal 是同一种病 —— 下游拿它当
    真值去选 LUT、算构图。少一份档案是诚实的降级,编一份不是。
    """
    with pytest.raises(OSError):
        build.build_profile(_truncated_jpeg(), photo_id="p3")


def test_undecodable_image_fails_before_burning_inference_and_a_vision_call(monkeypatch):
    """而且要**早**炸。

    Image.open 是惰性的,不在最前面把解码兑现掉,坏图要跑完一次分割推理 + 一次视觉
    模型调用(几秒 + 真金白银)才在色彩组炸出来 —— 结果一样是「这张没档案」,
    代价却全花了。这条钉的就是那笔白花的钱:变异「raise 改 pass」时上一条照样绿
    (色彩组随后自己会抛),只有这一条抓得住。
    """
    touched: list[str] = []
    monkeypatch.setattr(
        build, "subject_geometry", lambda image, **_: touched.append("geometry") or {}
    )
    monkeypatch.setattr(
        build, "semantic_features", lambda image, **_: touched.append("semantic") or {}
    )

    with pytest.raises(OSError):
        build.build_profile(_truncated_jpeg(), photo_id="p3")

    assert touched == [], f"坏图上白跑了:{touched}"


def test_geometry_failure_is_logged_with_photo_id(monkeypatch):
    """几何组挂了必须留痕。原来这个 except 一行日志都不打 —— 整机的分割权重丢了
    也只表现为「所有 subjectBox 都是 null」,查不出根因。"""
    monkeypatch.setattr(
        build, "subject_geometry", lambda image, **_: (_ for _ in ()).throw(RuntimeError("model down"))
    )
    spy = _LogSpy()
    monkeypatch.setattr(build, "log", spy)

    build.build_profile(Image.new("RGB", (32, 32)), photo_id="p7")

    events = {e for e, _ in spy.warnings}
    assert events, "几何组失败没有打任何日志"
    kw = dict(spy.warnings[0][1])
    assert kw.get("photo_id") == "p7"
    assert "RuntimeError" in str(kw.get("error"))


def test_semantic_failure_is_logged_with_photo_id(monkeypatch):
    monkeypatch.setattr(
        build, "semantic_features", lambda image, **_: (_ for _ in ()).throw(RuntimeError("vision down"))
    )
    spy = _LogSpy()
    monkeypatch.setattr(build, "log", spy)

    build.build_profile(Image.new("RGB", (32, 32)), photo_id="p9")

    assert spy.warnings, "语义组失败没有打任何日志"
    kw = dict(spy.warnings[0][1])
    assert kw.get("photo_id") == "p9"
    assert "RuntimeError" in str(kw.get("error"))


def test_semantic_failure_leaves_composition_none_not_a_made_up_focal(monkeypatch):
    """语义组挂了,composition 必须是 None。

    slot_matcher_v3 遇到 None 会「视作任意,不挡」,那是正确的降级;编一个 focal
    会让选版按**错误的构图约束**去匹配槽位 —— 比没有档案更糟,而且查不出来。
    """
    monkeypatch.setattr(
        build, "semantic_features", lambda image, **_: (_ for _ in ()).throw(RuntimeError("vision down"))
    )
    profile = build.build_profile(Image.new("RGB", (32, 32)))
    assert profile["composition"] is None
    assert profile["description"] == ""


def test_vision_call_stats_are_threaded_through(monkeypatch):
    """成本计数要能从组装层穿到语义组 —— 否则 usage.visionCallCount 只能靠猜。"""
    seen: dict = {}

    def _semantic(image, *, photo_id="", stats=None):
        seen["stats_is"] = stats
        if stats is not None:
            stats["visionCalls"] = stats.get("visionCalls", 0) + 1
        return {
            "composition": "focal", "scene": "outdoor", "peopleCount": "1",
            "mood": "warm", "description": "",
        }

    monkeypatch.setattr(build, "semantic_features", _semantic)
    stats: dict = {}
    build.build_profile(Image.new("RGB", (32, 32)), photo_id="p1", stats=stats)
    assert seen["stats_is"] is stats
    assert stats["visionCalls"] == 1
