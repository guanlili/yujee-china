"""色彩组:纯像素统计,零模型零网络。

判据用「合成图」而不是真照片 —— 合成图的期望值是确定的,真照片只能眼睛看,
测不出回归。真照片的验收放在 Task Z1 端到端。
"""

from PIL import Image

from src.workflows.core.profile.color import color_features


def _solid(rgb: tuple[int, int, int]) -> Image.Image:
    return Image.new("RGB", (64, 64), rgb)


def test_warm_image_reads_warm():
    assert color_features(_solid((220, 150, 70)))["colorTemp"] == "warm"


def test_cool_image_reads_cool():
    assert color_features(_solid((70, 130, 220)))["colorTemp"] == "cool"


def test_grey_image_reads_neutral():
    assert color_features(_solid((128, 128, 128)))["colorTemp"] == "neutral"


def test_dark_image_reads_dark():
    assert color_features(_solid((18, 18, 22)))["brightness"] == "dark"


def test_bright_image_reads_bright():
    assert color_features(_solid((238, 238, 232)))["brightness"] == "bright"


def test_grey_is_muted_and_vivid_is_vivid():
    assert color_features(_solid((128, 128, 128)))["saturation"] == "muted"
    assert color_features(_solid((230, 20, 20)))["saturation"] == "vivid"


def test_dominant_colors_are_hex_and_capped_at_three():
    out = color_features(Image.new("RGB", (64, 64)))
    colors = out["dominantColors"]
    assert len(colors) <= 3
    assert all(c.startswith("#") and len(c) == 7 for c in colors)


def test_output_keys_match_contract_exactly():
    """键名与 PhotoProfile 色彩组逐字对应 —— 漂了下游组装会静默丢字段。"""
    assert set(color_features(_solid((100, 100, 100)))) == {
        "colorTemp",
        "brightness",
        "saturation",
        "dominantColors",
    }


def test_handles_rgba_and_greyscale_input():
    """用户传的图不一定是 RGB —— PNG 带 alpha、老照片是 L 模式,都不许炸。"""
    for mode in ("RGBA", "L", "P"):
        out = color_features(Image.new(mode, (32, 32)))
        assert out["colorTemp"] in {"warm", "neutral", "cool"}
