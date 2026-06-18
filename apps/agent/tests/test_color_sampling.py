"""WP3.3 (#191) color sampling tests.

Stateless, in-memory only: every fixture image is built in a BytesIO buffer and
passed as base64. Nothing touches disk.
"""

from __future__ import annotations

import base64
import io
import re

import pytest
from PIL import Image

from src.services.color_sampling import (
    ColorSamplingError,
    sample_dominant_color,
)

_HEX_RE = re.compile(r"^#[0-9A-F]{6}$")


def _b64(img: Image.Image, fmt: str = "PNG", *, data_url: bool = False, **save_kw) -> str:
    buf = io.BytesIO()
    img.save(buf, fmt, **save_kw)
    raw = base64.b64encode(buf.getvalue()).decode("ascii")
    if data_url:
        mime = "jpeg" if fmt.upper() in {"JPEG", "JPG"} else fmt.lower()
        return f"data:image/{mime};base64,{raw}"
    return raw


def _solid(rgb: tuple[int, int, int], size: tuple[int, int] = (32, 32)) -> Image.Image:
    return Image.new("RGB", size, rgb)


def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _close(a: tuple[int, int, int], b: tuple[int, int, int], tol: int = 24) -> bool:
    return all(abs(x - y) <= tol for x, y in zip(a, b))


# ---------- happy path -------------------------------------------------------


def test_returns_uppercase_hex_format():
    out = sample_dominant_color(_b64(_solid((10, 120, 200))))
    assert _HEX_RE.match(out), out


def test_solid_color_image_png():
    out = sample_dominant_color(_b64(_solid((200, 30, 30))))
    assert _close(_hex_to_rgb(out), (200, 30, 30))


def test_solid_color_image_jpeg_lossy():
    # quality 60 mirrors the browser canvas export; dominant must still be close.
    out = sample_dominant_color(_b64(_solid((40, 160, 90)), "JPEG", quality=60))
    assert _close(_hex_to_rgb(out), (40, 160, 90))


def test_accepts_data_url_prefix():
    out = sample_dominant_color(_b64(_solid((120, 60, 200)), data_url=True))
    assert _close(_hex_to_rgb(out), (120, 60, 200))


def test_accepts_jpeg_data_url():
    out = sample_dominant_color(
        _b64(_solid((180, 110, 20)), "JPEG", data_url=True, quality=60)
    )
    assert _close(_hex_to_rgb(out), (180, 110, 20))


def test_dominant_picks_majority_region():
    # 80% subject red, 20% blue corner — dominant should be the red.
    img = Image.new("RGB", (50, 50), (200, 40, 40))
    for x in range(50):
        for y in range(40, 50):
            img.putpixel((x, y), (40, 40, 200))
    out = sample_dominant_color(_b64(img))
    r, g, b = _hex_to_rgb(out)
    assert r > b, out


def test_white_background_filtered_to_subject():
    # Mostly white with a saturated subject patch larger than the foreground
    # ratio floor — the subject color should win over the white backdrop.
    img = Image.new("RGB", (40, 40), (255, 255, 255))
    for x in range(0, 16):
        for y in range(0, 40):
            img.putpixel((x, y), (200, 30, 30))
    out = sample_dominant_color(_b64(img))
    r, g, b = _hex_to_rgb(out)
    assert r > 150 and g < 90 and b < 90, out


def test_overwhelmingly_white_still_returns_color():
    # Almost entirely white (below foreground floor) — must not raise; returns
    # a near-white tone rather than erroring.
    img = Image.new("RGB", (40, 40), (255, 255, 255))
    img.putpixel((0, 0), (10, 10, 10))
    out = sample_dominant_color(_b64(img))
    assert _HEX_RE.match(out)
    assert _close(_hex_to_rgb(out), (255, 255, 255), tol=30)


def test_grayscale_image_converted():
    img = Image.new("L", (32, 32), 128)
    out = sample_dominant_color(_b64(img))
    assert _close(_hex_to_rgb(out), (128, 128, 128), tol=30)


def test_rgba_with_alpha_handled():
    img = Image.new("RGBA", (32, 32), (60, 180, 75, 128))
    out = sample_dominant_color(_b64(img))
    assert _HEX_RE.match(out)


# ---------- errors -----------------------------------------------------------


@pytest.mark.parametrize("bad", ["", "   ", "data:image/png;base64,"])
def test_empty_input_raises(bad):
    with pytest.raises(ColorSamplingError):
        sample_dominant_color(bad)


def test_invalid_base64_raises():
    with pytest.raises(ColorSamplingError):
        sample_dominant_color("not!!!base64@@@")


def test_non_image_bytes_raises():
    payload = base64.b64encode(b"this is plain text, not an image").decode("ascii")
    with pytest.raises(ColorSamplingError):
        sample_dominant_color(payload)


# ---------- stateless / no-disk ----------------------------------------------


def test_deterministic_repeated_calls():
    b64 = _b64(_solid((90, 140, 30)))
    assert sample_dominant_color(b64) == sample_dominant_color(b64)


def test_does_not_write_files(tmp_path, monkeypatch):
    # Run from an empty cwd and assert the call leaves no files behind.
    monkeypatch.chdir(tmp_path)
    sample_dominant_color(_b64(_solid((10, 20, 30))))
    assert list(tmp_path.iterdir()) == []
