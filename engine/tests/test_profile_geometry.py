"""几何组。

模型推理部分不在单测里跑(慢、要下权重),单测只覆盖纯几何的 box_from_mask ——
坐标口径(0-100 而不是 0-1)是这个方案最容易错的地方,必须锁死。
真实抠图质量的验收在 Task Z1,靠眼睛看,不靠指标。
"""

from PIL import Image

from src.workflows.core.profile.geometry import box_from_mask


def _mask_with_rect(size, rect, fg=255, bg=0):
    """在 size 的画布上画一个 rect=(left, top, right, bottom) 的前景块。"""
    img = Image.new("L", size, bg)
    for x in range(rect[0], rect[2]):
        for y in range(rect[1], rect[3]):
            img.putpixel((x, y), fg)
    return img


def test_box_is_percentage_0_to_100_not_0_to_1():
    """铁律:坐标是 0-100,与 imagePos 同口径。返回 0-1 会让 Agent 心算全错。"""
    mask = _mask_with_rect((100, 100), (10, 20, 60, 80))
    box = box_from_mask(mask)
    assert box == {"x": 10.0, "y": 20.0, "w": 50.0, "h": 60.0}


def test_box_scales_with_canvas_size():
    """同样位置的主体,在不同分辨率上得到同样的百分比。"""
    small = box_from_mask(_mask_with_rect((100, 100), (25, 25, 75, 75)))
    large = box_from_mask(_mask_with_rect((400, 400), (100, 100, 300, 300)))
    assert small == large


def test_empty_mask_returns_none():
    """纯风景/抽象构图跑不出主体 —— 返回 None,让 imagePos 走默认 50/50/1。"""
    assert box_from_mask(Image.new("L", (50, 50), 0)) is None


def test_full_mask_returns_full_frame():
    box = box_from_mask(Image.new("L", (50, 50), 255))
    assert box == {"x": 0.0, "y": 0.0, "w": 100.0, "h": 100.0}


def test_threshold_ignores_faint_noise():
    """RMBG 输出的边缘是渐变的,弱于阈值的噪点不该把包围盒撑大。"""
    mask = _mask_with_rect((100, 100), (40, 40, 60, 60), fg=255, bg=0)
    mask.putpixel((2, 2), 40)  # 远处一个弱噪点
    box = box_from_mask(mask, threshold=128)
    assert box["x"] == 40.0 and box["y"] == 40.0


def test_non_square_canvas_uses_own_axis():
    """长宽不等时 x 按宽算、y 按高算 —— 混用会让竖图的框整个歪掉。"""
    box = box_from_mask(_mask_with_rect((200, 100), (100, 25, 200, 75)))
    assert box == {"x": 50.0, "y": 25.0, "w": 50.0, "h": 50.0}


# ── 模型接入部分 ────────────────────────────────────────────────────────────────
#
# 真权重不进单测(慢、要下 4~170MB)。这里把 onnx session 打桩,验的是**接线**:
# 建档和抠图用的是不同的模型/尺寸、预处理归一化对得上、输出能变回原图尺寸的 mask。
# 真实抠图质量的验收在 Task Z1,靠眼睛看。

import numpy as np
import pytest

from src.workflows.core.profile import geometry


class _FakeSession:
    """记录喂进来的张量,回一个「中间一块是前景」的假 logits。"""

    def __init__(self, side: int):
        self.side = side
        self.seen: list = []

    def get_inputs(self):
        class _I:
            name = "input"

        return [_I()]

    def run(self, _outputs, feed):
        tensor = feed["input"]
        self.seen.append(tensor)
        out = np.zeros((1, 1, self.side, self.side), dtype=np.float32)
        quarter = self.side // 4
        out[0, 0, quarter : quarter * 3, quarter : quarter * 3] = 1.0
        return [out]


@pytest.fixture
def fake_sessions(monkeypatch):
    made: dict = {}

    def _fake_session(spec):
        made[spec.name] = made.get(spec.name) or _FakeSession(spec.size)
        return made[spec.name]

    monkeypatch.setattr(geometry, "_session", _fake_session)
    return made


def test_profile_and_cutout_use_different_models():
    """建档用 u2netp(320²,只要包围盒),真抠图用 isnet(1024²,要精细边缘)。

    320² 的糙边正是 2026-08-29 否决自动抠图的那个病,不能拿它去抠图;
    反过来为了一个包围盒跑 1024² 也是白烧内存和时间。
    """
    profile = geometry.SPECS["profile"]
    cutout = geometry.SPECS["cutout"]
    assert profile.size == 320 and cutout.size == 1024
    assert profile.setting != cutout.setting
    # 两个模型的归一化不一样,张冠李戴会让 mask 整个糊掉。
    assert profile.mean == (0.485, 0.456, 0.406)
    assert cutout.mean == (0.5, 0.5, 0.5)


def test_preprocess_makes_nchw_float32_at_model_size():
    spec = geometry.SPECS["profile"]
    tensor = geometry._preprocess(Image.new("RGB", (800, 600), (128, 128, 128)), spec)
    assert tensor.shape == (1, 3, spec.size, spec.size)
    assert tensor.dtype == np.float32


def test_preprocess_applies_the_specs_mean_and_std():
    """归一化必须真的用 spec 的 mean/std —— 用错模型的常数 mask 会糊。"""
    spec = geometry.SPECS["cutout"]  # mean 0.5 / std 1.0
    tensor = geometry._preprocess(Image.new("RGB", (64, 64), (255, 255, 255)), spec)
    # 纯白 -> 1.0,减 0.5 除 1.0 = 0.5
    assert np.allclose(tensor, 0.5, atol=1e-6)


def test_mask_from_output_is_L_mode_at_original_size():
    out = np.zeros((1, 1, 320, 320), dtype=np.float32)
    out[0, 0, 80:240, 80:240] = 1.0
    mask = geometry._mask_from_output(out, (800, 600))
    assert mask.mode == "L" and mask.size == (800, 600)
    pixels = mask.tobytes()  # 不用 getdata():Pillow 14 会删
    assert max(pixels) == 255 and min(pixels) == 0


def test_subject_mask_runs_the_profile_model_and_returns_original_size(fake_sessions):
    mask = geometry.subject_mask(Image.new("RGB", (400, 200), (10, 20, 30)))
    assert mask.mode == "L" and mask.size == (400, 200)
    assert "profile" in fake_sessions and "cutout" not in fake_sessions
    assert fake_sessions["profile"].seen[0].shape == (1, 3, 320, 320)


def test_subject_mask_quality_cutout_runs_the_fine_model(fake_sessions):
    """persistMask 那条按需路径要精细边缘,必须换 1024² 的 isnet。"""
    geometry.subject_mask(Image.new("RGB", (400, 200)), quality="cutout")
    assert "cutout" in fake_sessions and "profile" not in fake_sessions
    assert fake_sessions["cutout"].seen[0].shape == (1, 3, 1024, 1024)


def test_subject_geometry_returns_0_100_box_and_face_list(fake_sessions):
    out = geometry.subject_geometry(Image.new("RGB", (400, 200)))
    assert set(out) == {"subjectBox", "faceBoxes"}
    box = out["subjectBox"]
    # 假 session 的前景是正中间那 1/2 见方 -> 25..75
    assert box["x"] == pytest.approx(25.0, abs=1.0)
    assert box["w"] == pytest.approx(50.0, abs=1.0)
    assert out["faceBoxes"] == []


def test_detect_faces_returns_empty_until_a_detector_is_wired():
    """人脸框还没接检测器 —— 返回 [],让 avoid-face-crop 退化成 center-subject。

    签名和 0-100 口径先钉死,将来接上 YuNet 时不用动调用方。
    """
    assert geometry.detect_faces(Image.new("RGB", (64, 64))) == []


# ── 抠图的 alpha 分段拉伸 ──────────────────────────────────────────────────────
#
# 2026-09-09 端到端验收(25 张真人像)发现的:isnet 输出的是**软 mask**,灰度区 =
# 模型不确定的区域。棚拍纯背景那几张 mask 是纯白、抠得完美;但光线复杂、背景有
# 帘子的(IMG_9287 / IMG_9350 / IMG_9059),大片衣服区域 alpha 只有一百多 ——
# 抠出来叠到版式上就是**鬼影**,用户点了「抠图」拿到一个半透明的自己。
#
# ⚠️ 别改成纯二值化:对照图看过,二值化会在衣服上炸出白色破洞(alpha<128 的整片
# 区域被归零),边缘也变硬 —— 破洞比半透明更难看。


def test_cutout_spec_stretches_alpha_but_profile_does_not():
    """只治抠图,不动构图。

    实测四张:拉伸对包围盒的影响都 < 0.3 个百分点(box_from_mask 的阈值 128 落在
    拉伸区间内,128 附近像素的归属不变)。既然对建档没区别,就不改没必要改的。
    """
    assert geometry.SPECS["cutout"].alpha_stretch == (40, 170)
    assert geometry.SPECS["profile"].alpha_stretch is None


def test_stretch_pushes_uncertain_midtones_toward_opaque():
    """「模型不太确定」的大片区域要被推实 —— 这就是鬼影的解药。"""
    mask = Image.new("L", (10, 10), 140)
    out = geometry._stretch_alpha(mask, 40, 170)
    assert out.getpixel((5, 5)) > 190, "中等 alpha 没有被推实,主体仍会是半透明"

    # 上界以上一律全不透明
    assert geometry._stretch_alpha(Image.new("L", (4, 4), 170), 40, 170).getpixel((1, 1)) == 255
    assert geometry._stretch_alpha(Image.new("L", (4, 4), 200), 40, 170).getpixel((1, 1)) == 255


def test_stretch_clamps_low_alpha_to_fully_transparent():
    """下界以下是背景残留,必须干净归零,否则边上一圈脏雾。"""
    assert geometry._stretch_alpha(Image.new("L", (4, 4), 39), 40, 170).getpixel((1, 1)) == 0
    assert geometry._stretch_alpha(Image.new("L", (4, 4), 0), 40, 170).getpixel((1, 1)) == 0


def test_stretch_keeps_edges_soft_not_binarized():
    """边缘的渐变必须还在 —— 压成硬边就是二值化那条被否掉的路。

    造一条 0..255 的横向渐变,拉伸后区间内仍应保留多级中间值。
    """
    width = 256
    ramp = Image.new("L", (width, 4))
    for x in range(width):
        for y in range(4):
            ramp.putpixel((x, y), x)

    out = geometry._stretch_alpha(ramp, 40, 170)
    values = set(out.tobytes())
    middle = {v for v in values if 0 < v < 255}
    assert len(middle) > 50, f"中间灰阶只剩 {len(middle)} 级,边缘被压成硬边了"


def test_stretch_is_monotonic():
    """越不透明的像素拉伸后不能反而更透明。"""
    ramp = Image.new("L", (256, 1))
    for x in range(256):
        ramp.putpixel((x, 0), x)
    out = list(geometry._stretch_alpha(ramp, 40, 170).tobytes())
    assert out == sorted(out)


def test_cutout_mask_comes_back_stretched(fake_sessions, monkeypatch):
    """接线:走 subject_mask(quality='cutout') 时拉伸必须真的生效。"""
    import numpy as np

    class _PlateauSession:
        """输出:背景 0、大片 2/3(min-max 归一化后正好 170)、一小块 1.0。"""

        def get_inputs(self):
            class _I:
                name = "input"

            return [_I()]

        def run(self, _outputs, feed):
            out = np.zeros((1, 1, 1024, 1024), dtype=np.float32)
            out[0, 0, 200:800, 200:800] = 2.0 / 3.0
            out[0, 0, 400:500, 400:500] = 1.0
            return [out]

    monkeypatch.setattr(geometry, "_session", lambda spec: _PlateauSession())

    mask = geometry.subject_mask(Image.new("RGB", (1024, 1024)), quality="cutout")
    # 那片 170 的区域(取一个不与 1.0 小块重叠的点)必须被推到 255
    assert mask.getpixel((250, 250)) == 255, "cutout 的软 mask 没被拉伸,主体会是半透明"


def test_stretch_does_not_move_the_bounding_box():
    """隔离性:拉伸只治抠图,不该动构图。"""
    raw = Image.new("L", (200, 200), 0)
    for x in range(50, 150):
        for y in range(60, 160):
            raw.putpixel((x, y), 140)

    before = box_from_mask(raw)
    after = box_from_mask(geometry._stretch_alpha(raw, 40, 170))
    for key in ("x", "y", "w", "h"):
        assert abs(before[key] - after[key]) < 0.5, f"{key} 被拉伸挪动了"
