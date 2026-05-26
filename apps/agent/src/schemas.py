from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


PhotoOrientation = Literal["portrait", "landscape", "square"]
PhotoQuality = Literal["hero", "detail", "fill"]
Language = Literal["zh", "en"]
JobEvent = Literal["progress", "completed", "failed"]
JobStage = Literal["vision", "writing", "composing"]


class PhotoIn(BaseModel):
    photoId: str
    base64: str
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class LayoutRequest(BaseModel):
    requestId: str = Field(min_length=1)
    prompt: str = Field(max_length=500)
    language: Language
    callbackUrl: HttpUrl
    photos: list[PhotoIn] = Field(min_length=3, max_length=30)


class LayoutAccepted(BaseModel):
    ok: Literal[True] = True
    data: dict


class Magazine(BaseModel):
    title: str = Field(min_length=1, max_length=60)
    subtitle: str | None = Field(default=None, max_length=100)
    style: str
    language: Language


class PhotoAnalysis(BaseModel):
    photoId: str
    description: str
    tags: list[str]
    quality: PhotoQuality
    orientation: PhotoOrientation


class Page(BaseModel):
    pageIndex: int = Field(ge=0)
    templateId: str
    images: dict[str, str]
    texts: dict[str, str]


class AlbumLayoutPlan(BaseModel):
    magazine: Magazine
    photos: list[PhotoAnalysis]
    pages: list[Page] = Field(min_length=1)


class JobError(BaseModel):
    code: str
    message: str


class JobUsage(BaseModel):
    visionTokens: int = 0
    planningTokens: int = 0
    durationMs: int = 0


class CallbackEnvelope(BaseModel):
    requestId: str
    event: JobEvent
    stage: JobStage | None = None
    progress: int | None = None
    message: str | None = None
    layout: AlbumLayoutPlan | None = None
    error: JobError | None = None
    usage: JobUsage | None = None
