"""WP3.3 color sampling tool (#191).

Pure, stateless helper: given a chapter representative image as base64 (raw or
`data:image/...;base64,` data URL), sample its dominant color and return a hex
string `#RRGGBB`. Consumed by `recommend-chapter-colors` (WP3.1) to seed each
chapter's `accentColor`.

Privacy (architecture §3): the base64 / decoded pixels live only in memory for
the duration of the call. Nothing is written to disk, no temp files, and the
raw image (or its base64) is never logged — only the resulting hex / failure
reason. The Agent stays stateless: this module holds no module-level state.

Format note: the layout contract does not yet define the `accentColor` field
shape (it lands with WP3.1/WP3.2 on the contracts side). Per the WP3.3 brief we
emit hex `#RRGGBB` (uppercase), the conventional CSS/print accent-color form;
WP3.1 can normalize if the final contract differs.

Algorithm: decode → downscale (thumbnail, area-cheap) → optionally drop near-
white/near-black background pixels → median-cut quantize to a small palette →
pick the most populous palette entry. Simple, dependency-light, deterministic.
"""

from __future__ import annotations

import base64
import binascii
import io
import re

from PIL import Image, UnidentifiedImageError

from ..logging_config import get_logger

log = get_logger("color_sampling")

# Downscale target: dominant color is robust to resolution, and a small canvas
# keeps quantize cheap. Browser images arrive ~800px; 64px is plenty.
_SAMPLE_BOX = (64, 64)

# Representative images should already be browser-compressed thumbnails. Keep a
# hard guard so malformed or hostile inputs cannot force large in-memory decodes.
_MAX_IMAGE_BYTES = 10 * 1024 * 1024
_MAX_IMAGE_PIXELS = 16_000_000

# Median-cut palette size. Few buckets => a stable, saturated "main" color
# rather than a muddy average.
_PALETTE_COLORS = 8

# Background filtering thresholds. Photo backdrops are often near-white or
# near-black; skipping them biases the pick toward the subject's color. We only
# apply the filter when enough non-background pixels survive, so an image that
# is genuinely mostly white/black still yields a sensible color.
_NEAR_WHITE = 245
_NEAR_BLACK = 12
_MIN_FOREGROUND_RATIO = 0.10

_DATA_URL_RE = re.compile(
    r"^data:image/[a-zA-Z0-9.+-]+;base64,", re.IGNORECASE
)


class ColorSamplingError(Exception):
    """Raised when the input cannot be decoded into a sampleable image."""


def _strip_data_url(b64: str) -> str:
    """Return the bare base64 payload, dropping a `data:image/...;base64,` prefix
    if present. Whitespace (newlines from wrapped data URLs) is removed."""
    payload = _DATA_URL_RE.sub("", b64.strip(), count=1)
    return "".join(payload.split())


def _decode_image(image_base64: str) -> Image.Image:
    """Decode base64 (raw or data URL) into an RGB Pillow image, in memory only."""
    if not image_base64 or not image_base64.strip():
        raise ColorSamplingError("empty image base64")

    payload = _strip_data_url(image_base64)
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ColorSamplingError("invalid base64 payload") from exc
    if len(raw) > _MAX_IMAGE_BYTES:
        raise ColorSamplingError("image payload too large")

    try:
        # `Image.open` is lazy. Check dimensions before forcing decode, then
        # downscale before RGB conversion to keep memory bounded.
        with Image.open(io.BytesIO(raw)) as img:
            width, height = img.size
            if width <= 0 or height <= 0 or width * height > _MAX_IMAGE_PIXELS:
                raise ColorSamplingError("image dimensions too large")
            img.thumbnail(_SAMPLE_BOX, Image.Resampling.BILINEAR)
            return img.convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        raise ColorSamplingError("undecodable image data") from exc


def _to_hex(rgb: tuple[int, int, int]) -> str:
    r, g, b = rgb
    return f"#{r:02X}{g:02X}{b:02X}"


def _is_background(rgb: tuple[int, int, int]) -> bool:
    r, g, b = rgb
    if r >= _NEAR_WHITE and g >= _NEAR_WHITE and b >= _NEAR_WHITE:
        return True
    if r <= _NEAR_BLACK and g <= _NEAR_BLACK and b <= _NEAR_BLACK:
        return True
    return False


def sample_dominant_color(image_base64: str) -> str:
    """Sample the dominant color of an image and return it as hex `#RRGGBB`.

    Args:
        image_base64: the image as base64, either a raw base64 string or a
            `data:image/...;base64,` data URL. Processed in memory only; never
            written to disk or logged.

    Returns:
        Uppercase hex color string, e.g. ``"#CA1E1C"``.

    Raises:
        ColorSamplingError: if the input is empty, not valid base64, or not a
            decodable image.
    """
    img = _decode_image(image_base64)

    # Downscale in place; thumbnail keeps aspect ratio and is area-cheap.
    img.thumbnail(_SAMPLE_BOX, Image.Resampling.BILINEAR)

    pixels = list(img.getdata())
    if not pixels:
        raise ColorSamplingError("image has no pixels")

    foreground = [px for px in pixels if not _is_background(px)]
    if len(foreground) >= len(pixels) * _MIN_FOREGROUND_RATIO:
        sample_img = Image.new("RGB", (len(foreground), 1))
        sample_img.putdata(foreground)
    else:
        # Image is overwhelmingly near-white/near-black; sample it as-is so we
        # still return its true dominant tone instead of erroring.
        sample_img = img

    # Median-cut into a few buckets, then take the most populous one.
    quantized = sample_img.quantize(
        colors=_PALETTE_COLORS, method=Image.Quantize.MEDIANCUT
    )
    color_counts = quantized.getcolors()  # list[(count, palette_index)]
    if not color_counts:
        raise ColorSamplingError("could not quantize image")

    _, dominant_index = max(color_counts, key=lambda item: item[0])
    palette = quantized.getpalette()  # flat [r,g,b, r,g,b, ...]
    base = dominant_index * 3
    rgb = (palette[base], palette[base + 1], palette[base + 2])

    hex_color = _to_hex(rgb)
    # Privacy: log only the derived result, never the image/base64.
    log.debug("sampled_dominant_color", hex=hex_color)
    return hex_color
