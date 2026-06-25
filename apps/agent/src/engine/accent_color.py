"""Deterministic photo accent-color extraction for V3+ design inputs."""

from __future__ import annotations

import base64
import binascii
import colorsys
import io
from collections.abc import Mapping, Sequence
from typing import Any

from PIL import Image, UnidentifiedImageError

from ..schemas import V3AnalyzePhoto

_FALLBACK_ACCENT = "#8A8174"
_HUE_BUCKETS = 24
_SAMPLE_MAX_SIDE = 96
_MIN_ALPHA = 128
_MIN_VALUE = 0.18
_MIN_SATURATION = 0.20
_NEAR_WHITE_VALUE = 0.90
_NEAR_WHITE_SATURATION = 0.35
_DESIGN_SATURATION = 0.56
_DESIGN_VALUE = 0.76
_IMAGE_FIELD_KEYS = (
    "base64",
    "dataUrl",
    "data_url",
    "imageData",
    "image_data",
    "bytes",
    "image",
    "ref",
)


def accent_of_group(
    photo_ids: Sequence[str], photos_by_id: Mapping[str, V3AnalyzePhoto]
) -> str:
    """Whole photo group -> extracted color '#RRGGBB'.

    This is an AI design input, not the final accentColor. Missing/unreadable
    photos are ignored; if no colorful pixels remain, a neutral fallback is used.
    """
    try:
        images: list[Image.Image] = []
        for photo_id in photo_ids:
            photo = photos_by_id.get(photo_id)
            if photo is None:
                continue
            image = _image_from_input(photo)
            if image is not None:
                images.append(image)
        return _accent_from_images(images)
    except Exception:
        return _FALLBACK_ACCENT


def accent_from_photo(photo: Any) -> str:
    """Single photo -> extracted color '#RRGGBB'.

    Accepted in-memory inputs: V3AnalyzePhoto-like objects with a ``base64``
    attribute, mappings with common base64/image/ref fields, data URL/base64
    strings, raw image bytes, and PIL Image instances. No IO, model, or network
    work is performed.
    """
    try:
        image = _image_from_input(photo)
        if image is None:
            return _FALLBACK_ACCENT
        return _accent_from_images([image])
    except Exception:
        return _FALLBACK_ACCENT


def _accent_from_images(images: Sequence[Image.Image]) -> str:
    bucket_weights = [0.0 for _ in range(_HUE_BUCKETS)]
    for image in images:
        for hue, saturation, value in _iter_colorful_pixels(image):
            bucket = min(_HUE_BUCKETS - 1, int(hue * _HUE_BUCKETS))
            bucket_weights[bucket] += saturation * value

    best_bucket, best_weight = max(
        enumerate(bucket_weights), key=lambda item: (item[1], -item[0])
    )
    if best_weight <= 0:
        return _FALLBACK_ACCENT

    hue = (best_bucket + 0.5) / _HUE_BUCKETS
    red, green, blue = colorsys.hsv_to_rgb(hue, _DESIGN_SATURATION, _DESIGN_VALUE)
    return _rgb_to_hex(red, green, blue)


def _iter_colorful_pixels(image: Image.Image):
    sampled = image.convert("RGBA")
    sampled.thumbnail((_SAMPLE_MAX_SIDE, _SAMPLE_MAX_SIDE), Image.Resampling.BILINEAR)
    data = sampled.tobytes()
    for idx in range(0, len(data), 4):
        red, green, blue, alpha = data[idx : idx + 4]
        if alpha < _MIN_ALPHA:
            continue
        hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
        if value < _MIN_VALUE:
            continue
        if saturation < _MIN_SATURATION:
            continue
        if value > _NEAR_WHITE_VALUE and saturation < _NEAR_WHITE_SATURATION:
            continue
        yield hue, saturation, value


def _image_from_input(value: Any) -> Image.Image | None:
    if isinstance(value, Image.Image):
        return value.copy()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return _image_from_bytes(bytes(value))
    if isinstance(value, str):
        return _image_from_string(value)
    if isinstance(value, Mapping):
        for key in _IMAGE_FIELD_KEYS:
            if key not in value:
                continue
            image = _image_from_input(value[key])
            if image is not None:
                return image
        return None
    for key in _IMAGE_FIELD_KEYS:
        try:
            field = getattr(value, key)
        except Exception:
            continue
        if field is None:
            continue
        image = _image_from_input(field)
        if image is not None:
            return image
    return None


def _image_from_string(value: str) -> Image.Image | None:
    payload = value.strip()
    if not payload:
        return None
    if payload.lower().startswith("data:image/") and "," in payload:
        payload = payload.split(",", 1)[1]
    try:
        return _image_from_bytes(base64.b64decode(payload, validate=True))
    except (binascii.Error, ValueError):
        padding = "=" * ((4 - len(payload) % 4) % 4)
        try:
            return _image_from_bytes(base64.b64decode(payload + padding, validate=True))
        except (binascii.Error, ValueError):
            return None


def _image_from_bytes(data: bytes) -> Image.Image | None:
    try:
        with Image.open(io.BytesIO(data)) as image:
            return image.convert("RGBA")
    except (OSError, UnidentifiedImageError):
        return None


def _rgb_to_hex(red: float, green: float, blue: float) -> str:
    channels = (round(red * 255), round(green * 255), round(blue * 255))
    return "#{:02X}{:02X}{:02X}".format(*channels)
