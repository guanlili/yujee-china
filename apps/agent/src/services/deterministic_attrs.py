"""Deterministic per-photo attribute fill (WP1.2, issue #181).

These fields are filled by CODE, never by the LLM (V3 requirements §4.1(c)):
  - width / height : the compressed dimensions the browser already sends
  - orientation    : derived from width/height (portrait | landscape | square)
  - takenAt        : EXIF capture time, forwarded by the browser (compress.ts)

PRIVACY (architecture §3 D-GPS red line): the ONLY EXIF value consumed here is
`takenAt`. There is no GPS / lat / lng / place input or output in this module —
`takenAt` exists solely as a chaptering time signal (see grouping.py).
"""

from dataclasses import dataclass
from typing import Literal

Orientation = Literal["portrait", "landscape", "square"]


@dataclass(frozen=True)
class PhotoDimensions:
    """Raw deterministic inputs the browser supplies per photo."""

    photo_id: str
    width: int
    height: int
    taken_at: str | None = None


@dataclass(frozen=True)
class DeterministicPhotoAttrs:
    """Code-filled attributes for one photo. LLM never writes these."""

    photo_id: str
    width: int
    height: int
    orientation: Orientation
    taken_at: str | None


def compute_orientation(width: int, height: int) -> Orientation:
    """Pure geometry: orientation from the compressed dimensions."""
    if width <= 0 or height <= 0:
        # Defensive: degenerate dimensions are treated as square rather than raising
        # (the analyze pipeline must not die on a bad single photo).
        return "square"
    if width > height:
        return "landscape"
    if height > width:
        return "portrait"
    return "square"


def fill_deterministic_attrs(photos: list[PhotoDimensions]) -> list[DeterministicPhotoAttrs]:
    """Batch-fill the deterministic per-photo attributes from code, no LLM."""
    return [
        DeterministicPhotoAttrs(
            photo_id=photo.photo_id,
            width=photo.width,
            height=photo.height,
            orientation=compute_orientation(photo.width, photo.height),
            taken_at=photo.taken_at,
        )
        for photo in photos
    ]
