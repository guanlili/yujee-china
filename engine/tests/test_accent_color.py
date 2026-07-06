from __future__ import annotations

import base64
import io
import re

from PIL import Image

from src.workflows.core.layout.accent_color import accent_from_photo, accent_of_group
from src.contracts.schemas import V3AnalyzePhoto

_HEX6_RE = re.compile(r"^#[0-9A-F]{6}$")
_FALLBACK = "#8A8174"


def _png_bytes(rgb: tuple[int, int, int], size: tuple[int, int] = (24, 24)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, rgb).save(buf, format="PNG")
    return buf.getvalue()


def _data_url(rgb: tuple[int, int, int], size: tuple[int, int] = (24, 24)) -> str:
    encoded = base64.b64encode(_png_bytes(rgb, size)).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _photo(photo_id: str, rgb: tuple[int, int, int], size: tuple[int, int] = (24, 24)) -> V3AnalyzePhoto:
    return V3AnalyzePhoto(
        photoId=photo_id,
        base64=_data_url(rgb, size),
        width=size[0],
        height=size[1],
    )


def _channels(hex_color: str) -> tuple[int, int, int]:
    return tuple(int(hex_color[i : i + 2], 16) for i in (1, 3, 5))  # type: ignore[return-value]


def test_accent_from_photo_accepts_common_in_memory_inputs_consistently():
    raw = _png_bytes((210, 30, 30))
    data_url = "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
    image = Image.open(io.BytesIO(raw))

    outputs = [
        accent_from_photo(data_url),
        accent_from_photo(raw),
        accent_from_photo(image),
        accent_from_photo({"base64": data_url}),
    ]

    assert len(set(outputs)) == 1
    assert _HEX6_RE.fullmatch(outputs[0])
    red, green, blue = _channels(outputs[0])
    assert red > green
    assert red > blue


def test_accent_of_group_uses_dominant_color_across_photos():
    photos = {
        "red": _photo("red", (220, 30, 30), size=(12, 12)),
        "blue": _photo("blue", (30, 70, 230), size=(32, 32)),
    }

    result = accent_of_group(["red", "blue"], photos)

    assert _HEX6_RE.fullmatch(result)
    red, green, blue = _channels(result)
    assert blue > red
    assert blue > green


def test_accent_color_falls_back_for_gray_unreadable_or_missing_inputs():
    assert accent_from_photo(_data_url((180, 180, 180))) == _FALLBACK
    assert accent_from_photo("not image data") == _FALLBACK
    assert accent_of_group(["missing"], {}) == _FALLBACK
