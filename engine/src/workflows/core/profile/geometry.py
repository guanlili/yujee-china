"""几何组:主体包围盒 + 人脸框。

⚠️ 坐标一律 0-100 百分比,与 imagePos 的 objectPosition 同口径。
别改成 0-1 —— 两套坐标系并存,Agent 心算必错。

模型(RMBG-1.4)按需惰性加载,进程内缓存一份。box_from_mask 是纯函数,
可以脱离模型单测。
"""

from __future__ import annotations

from PIL import Image


def box_from_mask(mask: Image.Image, threshold: int = 128) -> dict | None:
    """alpha mask -> 主体包围盒(0-100 百分比)。前景为空返回 None。

    threshold:RMBG 输出边缘是渐变的,低于阈值的弱像素视作背景,免得噪点撑大框。
    """
    grey = mask.convert("L")
    width, height = grey.size
    if width == 0 or height == 0:
        return None

    binary = grey.point(lambda value: 255 if value >= threshold else 0)
    bbox = binary.getbbox()  # (left, upper, right, lower);全黑返回 None
    if bbox is None:
        return None

    left, upper, right, lower = bbox
    return {
        "x": left / width * 100,
        "y": upper / height * 100,
        "w": (right - left) / width * 100,
        "h": (lower - upper) / height * 100,
    }
