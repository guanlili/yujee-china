"""Pydantic mirror of @yujee/contracts `v2.ts` — authoring tree + /v2/album/*
endpoints + v2 callback.

Mirrors packages/contracts/src/v2.ts 1:1. Every model is `_Strict`
(extra='forbid'), so unknown keys are rejected, never stripped. This is the
enforcement point for D-GPS privacy: `V2InitExif` has only `takenAt`, so any
lat/lng in the payload is rejected at parse time (tech-plan §3.1 / P0-2).

Callback completed has two mutually-exclusive shapes (init→draftTree,
finalize→layout); they are discriminated on `jobKind`, not `event`
(tech-plan §1.1 / P0-1).
"""

from typing import Annotated, Literal, Union

from pydantic import Field, HttpUrl

from .schemas import (
    Language,
    Magazine,
    Page,
    PhotoAnalysis,
    PhotoOrientation,
    PhotoQuality,
    PeopleCount,
    Scene,
    Mood,
    TimeOfDay,
    JobError,
    _Strict,
)

# ---------- shared enums ------------------------------------------------------

V2Style = Literal[
    "warm-film", "editorial-mono", "soft-pastel", "bold-contrast", "vintage-print"
]
V2JobKind = Literal["init", "finalize", "add"]
# 'writing' (#161): init writes the whole first draft (cover + chapter copy)
# right after 'skeleton'; it sits between 'skeleton' and 'finalize'.
V2JobStage = Literal["vision", "grouping", "skeleton", "writing", "finalize"]
V2ChapterState = Literal[
    "empty", "asking", "brief_ready", "generated", "skipped", "finalized"
]
V2ChapterRole = Literal["opening", "body", "closing"]
ChatRole = Literal["user", "assistant"]

# ---------- usage -------------------------------------------------------------


class V2Models(_Strict):
    vision: str | None = None
    planning: str | None = None


class Usage(_Strict):
    durationMs: int = Field(ge=0)
    visionCallCount: int = Field(ge=0, default=0)
    planningInputTokens: int = Field(ge=0, default=0)
    planningOutputTokens: int = Field(ge=0, default=0)
    repairAttempts: int = Field(ge=0, default=0)
    models: V2Models


# ---------- theme / brief -----------------------------------------------------


class V2Theme(_Strict):
    subject: str
    occasion: str | None = None
    timeframe: str | None = None
    tone: str
    style: V2Style


class V2ThemePartial(_Strict):
    """`V2Theme.partial()` — all optional (draft phase before /theme)."""

    subject: str | None = None
    occasion: str | None = None
    timeframe: str | None = None
    tone: str | None = None
    style: V2Style | None = None


class V2Brief(_Strict):
    userWords: str | None = None
    factNote: str | None = None
    mood: str | None = None


# ---------- authoring tree ----------------------------------------------------


class V2PhotoAnalysis(_Strict):
    """Internal analysis. Extension fields (peopleCount/scene/mood/timeOfDay) are
    composing/grouping hints; finalize strips them — they never reach the flat
    AlbumLayoutPlan.photos."""

    photoId: str = Field(min_length=1)
    description: str
    tags: list[str]
    quality: PhotoQuality
    orientation: PhotoOrientation
    peopleCount: PeopleCount
    scene: Scene
    mood: Mood
    timeOfDay: TimeOfDay | None = None


class V2Exif(_Strict):
    takenAt: str | None = None  # low-sensitivity, stored
    place: str | None = None  # v1 always null (D-GPS); kept for v2 reuse
    order: int = Field(ge=0)  # upload order, sort fallback when EXIF missing


class V2Photo(_Strict):
    photoId: str = Field(min_length=1)
    analysis: V2PhotoAnalysis
    exif: V2Exif
    duplicateOf: str | None = None
    used: bool


class V2Cluster(_Strict):
    label: str
    timeRange: str | None = None
    place: str | None = None
    role: V2ChapterRole


class V2Chapter(_Strict):
    chapterId: str = Field(min_length=1)
    state: V2ChapterState
    cluster: V2Cluster
    photoIds: list[str]
    brief: V2Brief | None = None
    askCount: int = Field(ge=0, default=0)
    pages: list[Page]


class V2Meta(_Strict):
    theme: V2ThemePartial | None = None
    style: V2Style = "warm-film"
    language: Language
    promptHint: str | None = Field(default=None, max_length=500)


class V2BasePages(_Strict):
    cover: Page
    toc: Page | None = None
    ending: Page


class AlbumDraft(_Strict):
    version: Literal["v2"]
    meta: V2Meta
    photoPool: list[V2Photo]
    basePages: V2BasePages
    chapters: list[V2Chapter]


# ---------- v2 flat layout (finalize output; pages bound 1..48) ---------------


class LayoutV2(_Strict):
    """Same shape as AlbumLayoutPlan but pages bound is [1, 48] for v2 (tech-plan
    §5.2 / M2). The external TS contract (layout.ts) has no upper bound, so Web
    accepts it; the 48 cap is the Agent-side safety net."""

    magazine: Magazine
    photos: list[PhotoAnalysis]
    pages: list[Page] = Field(min_length=1, max_length=48)


# ---------- endpoint requests / responses -------------------------------------


class V2AcceptedData(_Strict):
    requestId: str = Field(min_length=1)
    accepted: Literal[True]


class V2AcceptedResponse(_Strict):
    ok: Literal[True]
    data: V2AcceptedData


class V2InitExif(_Strict):
    """★ Only `takenAt`. lat/lng are rejected here (extra='forbid') — the D-GPS
    privacy enforcement point."""

    takenAt: str | None = None


class V2InitPhoto(_Strict):
    photoId: str = Field(min_length=1)
    base64: str = Field(min_length=1)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    exif: V2InitExif | None = None


class V2InitMeta(_Strict):
    promptHint: str | None = Field(default=None, max_length=500)


class V2InitRequest(_Strict):
    requestId: str = Field(min_length=1)
    albumId: str = Field(min_length=1)
    callbackUrl: HttpUrl
    language: Language
    meta: V2InitMeta | None = None
    photos: list[V2InitPhoto] = Field(min_length=1, max_length=30)


class V2AddPhotosRequest(_Strict):
    """Mid-edit add-photos (W11). Only the NEW photos: the agent runs vision +
    grouping + skeleton on them alone to produce new chapter pages. It does not
    need the existing layout — templates are seeded by new chapterIds, and the Web
    side appends the returned pages before the (untouched) ending page."""

    requestId: str = Field(min_length=1)
    albumId: str = Field(min_length=1)
    callbackUrl: HttpUrl
    language: Language
    meta: V2InitMeta | None = None
    newPhotos: list[V2InitPhoto] = Field(min_length=1, max_length=30)


class V2ClusterOverview(_Strict):
    chapterId: str
    label: str
    place: str | None = None
    timeRange: str | None = None
    photoDescs: list[str] = Field(max_length=8)


class V2ThemeRequest(_Strict):
    albumId: str = Field(min_length=1)
    language: Language
    clustersOverview: list[V2ClusterOverview] = Field(min_length=1)
    currentTheme: V2Theme | None = None
    userMessage: str | None = Field(default=None, max_length=500)


class V2CoverDraft(_Strict):
    templateId: str
    texts: dict[str, str]
    heroPhotoId: str | None = None


class V2ThemeOption(_Strict):
    """A proposed theme choice for the user to pick (editor.html themeOpt1-3).
    `subject` is the option title, `label` a short user-facing line; tone/style
    hint the option's mood/template. Display-only — never merged into the tree."""

    subject: str = Field(min_length=1)
    label: str = Field(min_length=1)
    tone: str | None = None
    style: V2Style | None = None


class V2ThemeResponse(_Strict):
    theme: V2Theme
    cover: V2CoverDraft | None = None
    # 2-3 theme candidates proposed before a theme is fixed; absent once decided.
    # Display-only (invariant 12) — Web passes them through, never into draft_json.
    themeOptions: list[V2ThemeOption] | None = Field(default=None, min_length=2, max_length=3)
    assistantReply: str = Field(max_length=500)
    usage: Usage


class V2ChatTurn(_Strict):
    role: ChatRole
    content: str


class V2ChapterIn(_Strict):
    chapterId: str
    state: V2ChapterState
    cluster: V2Cluster
    photos: list[V2PhotoAnalysis]
    brief: V2Brief | None = None
    pages: list[Page]


class V2ChapterChatRequest(_Strict):
    albumId: str = Field(min_length=1)
    language: Language
    theme: V2Theme | None = None
    chapter: V2ChapterIn
    history: list[V2ChatTurn] = Field(default_factory=list, max_length=20)
    userMessage: str = Field(max_length=500)


class V2PageTexts(_Strict):
    pageIndex: int = Field(ge=0)
    texts: dict[str, str]


class V2ChapterChatResponse(_Strict):
    assistantReply: str = Field(min_length=1, max_length=500)
    chapterBrief: V2Brief | None = None
    state: V2ChapterState
    pagesTexts: list[V2PageTexts] | None = None
    # ≤4 chapter-title candidates (editor.html chipName1-4) from this chapter's
    # photo analysis + user input. Display-only (invariant 12); no invented facts.
    nameOptions: list[str] | None = Field(default=None, max_length=4)
    usage: Usage


class V2FinalizeRequest(_Strict):
    requestId: str = Field(min_length=1)
    albumId: str = Field(min_length=1)
    callbackUrl: HttpUrl
    draftTree: AlbumDraft


class V2LayoutPatchEntry(_Strict):
    pageIndex: int = Field(ge=0)
    templateId: str | None = None
    images: dict[str, str] | None = None
    texts: dict[str, str] | None = None


class V2EditRequest(_Strict):
    albumId: str = Field(min_length=1)
    currentLayout: LayoutV2
    history: list[V2ChatTurn] = Field(default_factory=list, max_length=20)
    userMessage: str = Field(max_length=500)
    language: Language
    # The page the user selected in the editor (W11): when set, "change this / this
    # page" refers to it.
    focusedPageIndex: int | None = Field(default=None, ge=0)


class V2EditResponse(_Strict):
    layoutPatch: list[V2LayoutPatchEntry] = Field(min_length=1, max_length=48)
    assistantReply: str = Field(min_length=1, max_length=500)
    usage: Usage


# ---------- draft-edit (#162) -------------------------------------------------
# The editor's draft-period turn: talk (opinions/questions) and act (write one
# page's copy) are PHYSICALLY separated via a tool layer. Unlike /v2/album/edit
# (finalize era; needs a flat layout_json) this operates BEFORE finalize, on a
# SINGLE skeleton page slice + that page's photos only — no base64, no whole
# draft tree (invariant 12). `pageWrite` is present iff kind=="act".


class V2DraftEditPage(_Strict):
    """One skeleton page slice the user is editing (the only page sent — invariant
    12: never the whole draft tree). Same shape as a draft `Page`."""

    pageIndex: int = Field(ge=0)
    templateId: str = Field(min_length=1)
    images: dict[str, str]
    texts: dict[str, str]


class V2DraftEditRequest(_Strict):
    albumId: str = Field(min_length=1)
    language: Language
    theme: V2Theme | None = None
    page: V2DraftEditPage
    # Only the photos used on `page` (their analysis — pure text, no base64).
    # Required (mirrors TS `photos: z.array(...)`, no default): the Web caller
    # always sends the page's photos, even if an empty array. TS↔py parity.
    photos: list[V2PhotoAnalysis]
    history: list[V2ChatTurn] = Field(default_factory=list, max_length=20)
    userMessage: str = Field(max_length=500)
    # The page the user selected in the editor; additive on draft-edit only. A
    # spread is 2 pages (L+R) so this carries the PRECISE single pageIndex.
    focusedPageIndex: int | None = Field(default=None, ge=0)


class V2DraftPageWrite(_Strict):
    pageIndex: int = Field(ge=0)
    texts: dict[str, str]


class V2DraftInspectRequest(_Strict):
    """Present iff kind=="inspect": the agent asks the browser to render + screenshot
    this page so vision can diagnose a reported crop (#165 Phase 2). The page is
    pinned to the page being edited (invariant 12)."""

    pageIndex: int = Field(ge=0)


class V2DraftImagePosWrite(_Strict):
    """Present iff kind=="act" via adjust_image_position: the absolute per-slot
    position/scale to apply (#165 Phase 2). Field names + ranges mirror the
    Phase-1 `ImagePos` shape the render layer + imagePosJson consume; the Web side
    folds {x,y,scale} into Page.imagePos[imageId]."""

    pageIndex: int = Field(ge=0)
    imageId: str = Field(min_length=1)
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    scale: float = Field(ge=1, le=2)


class V2DraftEditResponse(_Strict):
    # #165 Phase 2: "inspect" joins talk/act. inspect → the agent needs to SEE the
    # page (browser screenshots → /v2/album/inspect-page); act → either a copy edit
    # (pageWrite) or an image move/zoom (imagePosWrite). Exactly one payload is set
    # per kind; talk sets none.
    kind: Literal["talk", "act", "inspect"]
    assistantReply: str = Field(min_length=1, max_length=500)
    # Present iff kind=="act" via write_page_copy: the clamped copy to apply.
    pageWrite: V2DraftPageWrite | None = None
    # Present iff kind=="act" via adjust_image_position: the per-slot position write.
    imagePosWrite: V2DraftImagePosWrite | None = None
    # Present iff kind=="inspect": the screenshot/inspect directive for the browser.
    inspectRequest: V2DraftInspectRequest | None = None
    usage: Usage


# ---------- inspect-page (#165 Phase 2 — vision diagnosis) --------------------
# POST /v2/album/inspect-page: after draft-edit returns kind="inspect", the
# browser renders + screenshots the page and posts it here. The agent runs ONE
# vision call (火山 doubao-1.6-vision, same model/key as init) to diagnose the
# reported crop and suggest a move/zoom; the Web side then drives a follow-up
# draft-edit so the model can call adjust_image_position with the diagnosis.
#
# Privacy: `screenshot` (a base64 data URI of the RENDERED page, 800px-class like
# init's photos) is the ONLY new base64 channel; it is passed into the upstream
# vision body and then dropped — never logged, never persisted, never returned
# (same posture as the init vision call, invariant 1).


class V2InspectPage(_Strict):
    """The single page being inspected (slotId→photoId map lets vision name a real
    `imageId`; texts give context). Same fields as a draft page slice, strict."""

    pageIndex: int = Field(ge=0)
    templateId: str = Field(min_length=1)
    images: dict[str, str]
    texts: dict[str, str]


class V2InspectRequest(_Strict):
    albumId: str = Field(min_length=1)
    language: Language
    page: V2InspectPage
    # The page's photo analyses (pure text, no base64) so vision can name subjects.
    photos: list[V2PhotoAnalysis]
    # base64 data URI of the rendered-page screenshot (the only new base64 channel).
    screenshot: str = Field(min_length=1)
    userMessage: str = Field(max_length=500)


class V2InspectDiagnosis(_Strict):
    """The vision verdict. `imageId` is one of the page's slotIds, or null when
    vision could not pin a slot (then the caller degrades to a talk message).
    suggestedDx/Dy are percentage-point shifts (clamped [-50,50]); suggestedScale
    [1,2]; confidence [0,1]."""

    imageId: str | None = None
    problem: str
    suggestedDx: float = Field(ge=-50, le=50)
    suggestedDy: float = Field(ge=-50, le=50)
    suggestedScale: float = Field(ge=1, le=2)
    confidence: float = Field(ge=0, le=1)


class V2InspectResponse(_Strict):
    diagnosis: V2InspectDiagnosis
    assistantReply: str = Field(min_length=1, max_length=500)
    usage: Usage


# ---------- v2 callback envelope ----------------------------------------------
# completed has two shapes discriminated by jobKind (NOT event) — P0-1.


class V2ProgressCallback(_Strict):
    event: Literal["progress"]
    jobKind: V2JobKind
    requestId: str = Field(min_length=1)
    stage: V2JobStage
    progress: int = Field(ge=0, le=100)
    message: str | None = None


class V2InitCompletedCallback(_Strict):
    event: Literal["completed"]
    jobKind: Literal["init"]
    requestId: str = Field(min_length=1)
    draftTree: AlbumDraft
    usage: Usage


class V2FinalizeCompletedCallback(_Strict):
    event: Literal["completed"]
    jobKind: Literal["finalize"]
    requestId: str = Field(min_length=1)
    layout: LayoutV2
    usage: Usage


class V2AddCompletedCallback(_Strict):
    event: Literal["completed"]
    jobKind: Literal["add"]
    requestId: str = Field(min_length=1)
    newPhotos: list[PhotoAnalysis]
    newPages: list[Page] = Field(min_length=1)
    usage: Usage


class V2FailedCallback(_Strict):
    event: Literal["failed"]
    jobKind: V2JobKind
    requestId: str = Field(min_length=1)
    error: JobError
    stage: V2JobStage | None = None
    progress: int | None = Field(default=None, ge=0, le=100)


V2CompletedCallback = Annotated[
    Union[V2InitCompletedCallback, V2FinalizeCompletedCallback, V2AddCompletedCallback],
    Field(discriminator="jobKind"),
]

V2Callback = Union[V2ProgressCallback, V2FailedCallback, V2CompletedCallback]
