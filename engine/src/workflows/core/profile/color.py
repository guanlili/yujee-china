"""色彩组:纯像素统计,零模型零网络。

阈值都是经验值,改之前先看 tests/test_profile_color.py 的合成图期望。
"""

from __future__ import annotations

import colorsys

from PIL import Image

_SAMPLE_SIZE = 96  # 缩到这个尺寸再统计:够稳,又不至于为一张大图跑几百万像素


def _to_rgb(image: Image.Image) -> Image.Image:
    """任何模式统一到 RGB —— 用户会传 RGBA(PNG)、L(老照片扫描)、P(GIF)。"""
    return image.convert("RGB")


def color_features(image: Image.Image) -> dict:
    small = _to_rgb(image).resize((_SAMPLE_SIZE, _SAMPLE_SIZE), Image.Resampling.BILINEAR)
    # 走 tobytes 而不是 getdata():后者在 Pillow 14 会被移除,且逐像素建 tuple 更慢。
    # RGB 模式下每像素恰好 3 字节,切片即通道。
    raw = small.tobytes()
    n = len(raw) // 3

    r_mean = sum(raw[0::3]) / n
    b_mean = sum(raw[2::3]) / n

    hsv = [
        colorsys.rgb_to_hsv(raw[i] / 255, raw[i + 1] / 255, raw[i + 2] / 255)
        for i in range(0, len(raw), 3)
    ]
    v_mean = sum(h[2] for h in hsv) / n
    s_mean = sum(h[1] for h in hsv) / n

    # 色温:红蓝均值之差。±12 是经验阈值(0-255 尺度上约 5%)。
    warm_cool = r_mean - b_mean
    if warm_cool > 12:
        color_temp = "warm"
    elif warm_cool < -12:
        color_temp = "cool"
    else:
        color_temp = "neutral"

    if v_mean < 0.32:
        brightness = "dark"
    elif v_mean > 0.72:
        brightness = "bright"
    else:
        brightness = "mid"

    if s_mean < 0.18:
        saturation = "muted"
    elif s_mean > 0.55:
        saturation = "vivid"
    else:
        saturation = "normal"

    return {
        "colorTemp": color_temp,
        "brightness": brightness,
        "saturation": saturation,
        "dominantColors": _dominant_colors(small),
    }


def _dominant_colors(small: Image.Image, k: int = 3) -> list[str]:
    """主色调:Pillow 自带的中位切分量化,不引入 sklearn。"""
    quantized = small.quantize(colors=k, method=Image.Quantize.MEDIANCUT)
    palette = quantized.getpalette() or []
    counts = sorted(quantized.getcolors() or [], reverse=True)
    out: list[str] = []
    for _count, index in counts[:k]:
        r, g, b = palette[index * 3 : index * 3 + 3]
        out.append(f"#{r:02X}{g:02X}{b:02X}")
    return out
