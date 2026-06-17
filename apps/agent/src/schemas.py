"""Pydantic mirrors of the cross-service contracts in @yujee/contracts.

All schemas use `extra='forbid'` so unknown keys from either AI providers or
Web callers are rejected instead of silently propagated. Callback envelopes
use a discriminated union on `event`.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


# ---------- shared enums ------------------------------------------------------

PhotoOrientation = Literal["portrait", "landscape", "square"]
PhotoQuality = Literal["hero", "detail", "fill"]
Language = Literal["zh", "en"]
ChatRole = Literal["user", "assistant"]
PeopleCount = Literal["0", "1", "2-3", "4+"]
Scene = Literal["indoor", "outdoor", "nature", "city", "interior"]
Mood = Literal["warm", "cool", "sentimental", "energetic", "quiet"]
TimeOfDay = Literal["morning", "day", "evening", "night"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------- vision request (Web→Agent init payload) ---------------------------


class PhotoIn(_Strict):
    photoId: str = Field(min_length=1)
    base64: str = Field(min_length=1)
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class LayoutRequest(_Strict):
    requestId: str = Field(min_length=1)
    prompt: str = Field(min_length=1, max_length=500)
    language: Language
    callbackUrl: HttpUrl
    photos: list[PhotoIn] = Field(min_length=1, max_length=30)


# ---------- domain ------------------------------------------------------------


class Magazine(_Strict):
    title: str = Field(min_length=1, max_length=60)
    subtitle: str | None = Field(default=None, max_length=100)
    style: str = Field(min_length=1)
    language: Language


class PhotoAnalysis(_Strict):
    """Vision output. Carries the 5 design.md §2.6 extension fields used as
    composing hints. Web-side zod (the canonical @yujee/contracts PhotoAnalysis)
    keeps only photoId/description/tags/quality/orientation and drops the rest,
    so on the chat-edit round-trip the Web sends back a layout without these
    fields. They must therefore be optional on input — vision still populates
    them on output; the contract never requires them."""

    photoId: str = Field(min_length=1)
    description: str
    tags: list[str]
    quality: PhotoQuality
    orientation: PhotoOrientation
    peopleCount: PeopleCount | None = None
    scene: Scene | None = None
    mood: Mood | None = None
    timeOfDay: TimeOfDay | None = None
    location: str | None = None


class PhotoGroup(_Strict):
    groupId: str = Field(min_length=1)
    label: str = Field(min_length=1)
    photoIds: list[str] = Field(min_length=1)
    role: Literal["opening", "body", "closing"] | None = None


class VisionResult(_Strict):
    photos: list[PhotoAnalysis]
    groups: list[PhotoGroup]


class ImagePos(_Strict):
    """Per-image render override (#165 Phase 1). Mirrors @yujee/contracts
    `ImagePos`. Keyed (in Page.imagePos) by the same slotId as Page.images.
    Absent => renderer falls back to objectPosition 50% 50%, no zoom.

    x, y: object-position percentages clamped [0, 100] (default 50/50).
    scale: zoom factor clamped [1, 2] (default 1; web-only, PDF ignores >1).
    The schema guards the full clamp range so a hand-rolled tree can't ship an
    out-of-range value through finalize."""

    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    scale: float = Field(ge=1, le=2)


class Page(_Strict):
    pageIndex: int = Field(ge=0)
    templateId: str = Field(min_length=1)
    images: dict[str, str]
    texts: dict[str, str]
    # Optional per-slot position/scale overrides. Absent => render default 50/50/1.
    imagePos: dict[str, ImagePos] | None = None


class AlbumLayoutPlan(_Strict):
    magazine: Magazine
    photos: list[PhotoAnalysis]
    pages: list[Page] = Field(min_length=1, max_length=16)


# JobError is the shared error shape carried by v2 failed callbacks and the
# v2_album routes. The v1 callback envelopes (ProgressCallback / CompletedCallback
# / FailedCallback / JobUsage / CallbackEnvelope) and the standalone
# LayoutPatchEntry were removed in the v1 teardown — the agent now speaks only the
# v2 contract (schemas_v2.py).
class JobError(_Strict):
    code: str = Field(min_length=1)
    message: str
