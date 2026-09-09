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
