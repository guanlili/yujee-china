"""Pydantic mirrors of the cross-service contracts in @yujee/contracts.

All schemas use `extra='forbid'` so unknown keys from either AI providers or
Web callers are rejected instead of silently propagated. Callback envelopes
use a discriminated union on `event`.

V3 section (WP0.3 / issue #178) mirrors `packages/contracts/src/{enums,layout,
templates,v3}.ts` 1:1 — the TS zod definitions are the single source of truth
(architecture §6.8 第 5 条:契约 TS 先行 Python 镜像). Field names, optionality,
and enum members are kept byte-for-byte aligned; drift is the historical risk
called out in design.md §14, guarded by the cross-language fixture parity tests
in tests/test_schemas.py.
"""

import re
import base64
import binascii
from datetime import datetime
from typing import Annotated, Literal, Union, get_args

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    field_validator,
)


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


class Focal(_Strict):
    """Subject focal point (#169) — the main subject's (face-first) center in the
    ORIGINAL image, normalized to [0, 1] on each axis (x left→right, y top→bottom).
    Same space as a CSS object-position fraction, so {x*100, y*100} is a ready
    objectPosition %. Mirrors @yujee/contracts `Focal`. Absent => 0.5/0.5."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class LayoutPhotoAnalysis(_Strict):
    """External flat layout photo shape. Mirrors @yujee/contracts PhotoAnalysis:
    base render fields plus optional focal, no internal composing hints."""

    photoId: str = Field(min_length=1)
    description: str
    tags: list[str]
    quality: PhotoQuality
    orientation: PhotoOrientation
    # #169: subject focal point (0..1, face-first). Base field — survives finalize
    # (mirrors @yujee/contracts PhotoAnalysis.focal). Optional => 0.5/0.5 default.
    focal: Focal | None = None


class PhotoAnalysis(LayoutPhotoAnalysis):
    """Vision output. Extends the external render shape with design.md §2.6
    composing hints. The hints are internal and must be stripped before photos
    enter `AlbumLayoutPlan.photos`."""

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
    scale: zoom factor clamped [1, 2] (default 1; applied in BOTH web and PDF render).
    The schema guards the full clamp range so a hand-rolled tree can't ship an
    out-of-range value through finalize."""

    model_config = ConfigDict(extra="forbid", strict=True)

    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    scale: float = Field(ge=1, le=2)


class Page(_Strict):
    model_config = ConfigDict(extra="forbid", strict=True)

    pageIndex: int = Field(ge=0)
    templateId: str = Field(min_length=1)
    images: dict[str, str]
    texts: dict[str, str]
    # Optional per-slot position/scale overrides. Absent => render default 50/50/1.
    imagePos: dict[str, ImagePos] | None = None


class AlbumLayoutPlan(_Strict):
    magazine: Magazine
    photos: list[LayoutPhotoAnalysis]
    pages: list[Page] = Field(min_length=1)


# JobError is the shared error shape carried by v2 failed callbacks and the
# v2_album routes. The v1 callback envelopes (ProgressCallback / CompletedCallback
# / FailedCallback / JobUsage / CallbackEnvelope) and the standalone
# LayoutPatchEntry were removed in the v1 teardown — the agent now speaks only the
# v2 contract (schemas_v2.py).
class JobError(_Strict):
    code: str = Field(min_length=1)
    message: str


# =============================================================================
# V3 contracts (WP0.3 / #178) — mirror of @yujee/contracts src/{enums,layout,
# templates,v3}.ts. 五环节状态机的 `/v3/*` 端点 req/res + analyze callback。
#
# All models below are `_V3Strict` (extra='forbid'), matching the TS `.strict()`
# on every (nested) object. ★ analyze `exif` is the §3 privacy enforcement point:
# it carries only `takenAt`, so any lat/lng/place key is rejected at parse time.
# =============================================================================


_TAKEN_AT_DATETIME_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?$"
)
_V3_ANALYZE_IMAGE_DATA_URL_RE = re.compile(
    r"^data:image/(?:jpeg|png);base64,([A-Za-z0-9+/=]+)$"
)
_V3_ANALYZE_MAX_IMAGE_BYTES = 800 * 1024


def _validate_iso_datetime(value: str | None) -> str | None:
    """Mirror `TakenAtDateTime`: accept browser EXIF local ISO datetimes plus UTC
    `Z` strings. The JSON stays a string — we never coerce to a datetime object,
    matching the TS contract which keeps `takenAt` as a string. `None` passes
    through.

    Rejects bare dates / non-ISO junk so a malformed `takenAt` can't slip past
    the Python side while the TS side rejects it (cross-language parity)."""
    if value is None:
        return value
    if not _TAKEN_AT_DATETIME_RE.fullmatch(value):
        raise ValueError(f"takenAt must match the EXIF/UTC datetime contract: {value!r}")
    candidate = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        datetime.fromisoformat(candidate)
    except ValueError as exc:  # pragma: no cover - exercised via parametrized tests
        raise ValueError(f"takenAt must be an ISO-8601 datetime string: {value!r}") from exc
    return value


def _validate_v3_analyze_image_data_url(value: str) -> str:
    match = _V3_ANALYZE_IMAGE_DATA_URL_RE.fullmatch(value)
    if not match:
        raise ValueError("base64 must be a data:image/(jpeg|png);base64 URL")

    payload = match.group(1)
    padding = len(payload) - len(payload.rstrip("="))
    unpadded = payload[:-padding] if padding else payload
    if padding > 2 or "=" in unpadded or len(payload) % 4 != 0:
        raise ValueError("base64 image payload must be valid padded base64")

    decoded_size = (len(payload) // 4) * 3 - padding
    if decoded_size > _V3_ANALYZE_MAX_IMAGE_BYTES:
        raise ValueError("decoded image payload must be <= 800KB")

    try:
        decoded = base64.b64decode(payload, validate=True)
    except binascii.Error as exc:
        raise ValueError("base64 image payload must be valid base64") from exc
    if len(decoded) > _V3_ANALYZE_MAX_IMAGE_BYTES:
        raise ValueError("decoded image payload must be <= 800KB")
    return value


class _V3Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


# ---------- enums.ts ----------------------------------------------------------

# 整本相册的五环节状态(architecture §6.8 第 4 条)。Web 唯一真相源。
AlbumStage = Literal["analysing", "story", "theme", "cover", "ready"]
# 模板分类(§9):替代旧 slot + scene。
TemplateCategory = Literal["cover", "interior", "toc", "ending"]
# 艺术字字体包(§4.3)。closed legal set;成员清单由模板维护方敲定。
ArtFontPack = Literal["serif-classic", "sans-modern", "script-elegant", "display-bold"]


# ---------- layout.ts (V3 authoring 章节树) -----------------------------------

# 章节点缀色:`#RGB` / `#RRGGBB` 十六进制。Mirrors zod regex.
AccentColor = Annotated[str, Field(pattern=r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")]


class V3ChapterPhoto(_V3Strict):
    """章节树里的单张照片(v3-requirements §4.1).
    LLM writes `sceneDescription`; code fills width/height/orientation/takenAt.
    ⚠️ NO location/place/GPS/coordinate field (§3 privacy) — `_V3Strict` rejects
    any such key at parse time."""

    photoId: str = Field(min_length=1)
    sceneDescription: str = Field(max_length=300)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    orientation: PhotoOrientation
    takenAt: str | None = None  # EXIF; missing => null (no GPS)

    _check_taken_at = field_validator("takenAt")(_validate_iso_datetime)


class V3Chapter(_V3Strict):
    """章节(v3-requirements §4.1):一图一章不跨章。`accentColor`/`artFont`
    分析期为 null 占位,theme 环节填。"""

    chapterId: str = Field(min_length=1)
    description: str = Field(max_length=600)
    accentColor: AccentColor | None  # required key; null placeholder until theme
    artFont: ArtFontPack | None  # required key; null placeholder until theme
    photos: list[V3ChapterPhoto]


class V3LayoutTree(_V3Strict):
    """V3 章节树根。落 albums.draft_json,只活在交互期(§3 树边界)。"""

    chapters: list[V3Chapter]


# ---------- templates.ts ------------------------------------------------------
# V3 模板契约:category | pairing | images | svgs | texts | items | variableDecor
#   | hint。**图片槽 quality/orientation 概念整体作废**。
# WP0.2 是增量 bridge:packages/contracts/templates/*.json 已补 V3 字段,但仍保留
# deprecated 字段(slot/scene/quality/orientation/repeat),供现有 skeleton engine
# 和 golden fixtures 运行。WP0.4 引擎/Python consumer 迁完后再删除。

TemplateTextRole = Literal["title", "body", "explain", "decoration"]
TemplateTextLang = Literal["user", "en"]

# ---------- theme carriers (mirror packages/contracts/src/theme-carrier.ts) ----
# §3 树边界 单一真相源:章节 accentColor/artFont 烘焙进扁平 `Page.texts`
# (`dict[str,str]`),扁平渲染契约不新增树形字段,只能借这组 magic key 文法携带。
# finalize_v3 烘焙、validate_v3 校验、渲染器消费都从这里取约定。值与 TS 逐字一致
# (cross-language parity 见 tests/test_schemas.py / theme-carrier.test.ts):
#   ① SVG variableDecor 槽 → 值即色:texts[slotId] 本身就是 accentColor。
#   ② TEXT variableDecor 槽 → sibling carrier 键:内容逐字保留(含空/缺省),
#      色/字走 texts[slotId + ACCENT_SUFFIX] / texts[slotId + FONT_SUFFIX]。
#   ③ 真实 slotId(普通 id 或 bracket-path)均不含 `#`,carrier 后缀以 `#` 起头 → 零碰撞。
#   ④ finalize 幂等覆盖(不追加)。

THEME_ACCENT_CARRIER_SUFFIX = "#accentColor"
THEME_FONT_CARRIER_SUFFIX = "#artFont"

# 「持用户散文」的文字 role 子集。所有 TEXT variableDecor 槽的内容都绝不被主题色覆盖
# (主题走 sibling carrier);该集合仍用于区分 prose role 的定义。**从 TemplateTextRole
# 枚举派生**(全部 role 减去 `decoration`),将来枚举加第 4 个正文 role 自动纳入。
THEME_USER_PROSE_ROLES: frozenset[str] = frozenset(
    role for role in get_args(TemplateTextRole) if role != "decoration"
)

# @deprecated slot/scene — V3 用 category 替代(§9)。过渡期保留容忍 legacy JSON。
TemplateSlotKind = Literal["cover", "interior", "ending"]
TemplateScene = Literal[
    "opening", "portrait", "scenery", "record", "interlude", "textOnly", "ending"
]


class TemplateImageSlot(_V3Strict):
    """Addressable image position. `id` may be a bracket path (`cells[0].image`).
    @deprecated `orientation`/`quality` — V3 作废(§9);WP0.2 bridge 保留到 WP0.4."""

    id: str = Field(min_length=1)
    orientation: list[PhotoOrientation] = Field(default=None, min_length=1)
    quality: list[PhotoQuality] = Field(default=None, min_length=1)


class TemplateTextSlot(_V3Strict):
    id: str = Field(min_length=1)
    role: TemplateTextRole
    maxChars: int = Field(default=None, gt=0)
    lang: TemplateTextLang
    # V3:逐槽文案指引,透传给写作 LM(§4.2(4))。
    hint: str = Field(default=None, min_length=1, max_length=200)
    # V3:渲染变量落点(§9)。standalone 装饰槽被 apply-theme 一键刷。
    variableDecor: bool = None
    # @deprecated `repeat` — V3 用 `items` 组承载重复内容(§9)。WP0.4 后删除。
    repeat: bool = None


class TemplateSvgSlot(_V3Strict):
    """V3:装饰矢量图槽(§9)。`variableDecor:true` 的 svg 被 apply-theme 一键刷。"""

    id: str = Field(min_length=1)
    variableDecor: bool = None


class TemplateItems(_V3Strict):
    """V3:唯一「重复组」(§9),替代旧 `repeat:true` + bracket-path 键。"""

    images: list[TemplateImageSlot] = None
    texts: list[TemplateTextSlot] = None


class TemplatePairing(_V3Strict):
    """Forced spread pairing (print)。Only valid when category/slot === interior."""

    forced: bool
    with_: str = Field(min_length=1, alias="with")
    side: Literal["left", "right"]


class TemplateDef(_V3Strict):
    """模板定义。`category`/`slot`+`scene` 双轨容忍:至少一条分类必须声明
    (mirrors TS superRefine)。WP0.2 bridge 保留 deprecated 到 WP0.4。"""

    model_config = ConfigDict(extra="forbid", populate_by_name=True, strict=True)

    id: str = Field(min_length=1)
    # V3:分类(§9)。当前 JSON 应携带;可选只为兼容完整 legacy fixtures。
    category: TemplateCategory = None
    # @deprecated slot/scene — 见上,WP0.4 引擎迁移后删除。过渡期保留容忍 legacy JSON。
    slot: TemplateSlotKind = None
    scene: TemplateScene = None
    pairing: TemplatePairing | None = None
    styles: list[str] = None
    images: list[TemplateImageSlot]
    # V3:装饰矢量图槽(可选,§9)。
    svgs: list[TemplateSvgSlot] = None
    texts: list[TemplateTextSlot]
    # V3:唯一重复组(可选,§9)。
    items: TemplateItems = None

    @field_validator("styles")
    @classmethod
    def _styles_nonempty_members(cls, value: list[str] | None) -> list[str] | None:
        if value is not None and any(len(s) < 1 for s in value):
            raise ValueError("styles entries must be non-empty")
        return value

    def model_post_init(self, __context: object) -> None:
        has_v3_category = bool(self.category)
        has_legacy = bool(self.slot and self.scene)
        if not has_v3_category and not has_legacy:
            raise ValueError("template must declare category or legacy slot+scene")


# ---------- v3.ts: shared -----------------------------------------------------

V3Language = Literal["zh", "en"]
# V3 唯一异步 job = analyze;失败语义走回调 `failed`(§8.3)。
V3JobKind = Literal["analyze"]
# analyze 进度子阶段(§4.1);仅用于 progress 回调展示。
V3JobStage = Literal["describe", "group", "template", "preview"]


class V3Models(_V3Strict):
    vision: str = None
    planning: str = None


class V3Usage(_V3Strict):
    """统一 usage,各 /v3/* 端点共用(同 v2 Usage 形状)。"""

    durationMs: int = Field(ge=0)
    visionCallCount: int = Field(ge=0, default=0)
    planningInputTokens: int = Field(ge=0, default=0)
    planningOutputTokens: int = Field(ge=0, default=0)
    repairAttempts: int = Field(ge=0, default=0)
    models: V3Models


class V3ChatTurn(_V3Strict):
    role: ChatRole
    content: str


class V3AcceptedData(_V3Strict):
    requestId: str = Field(min_length=1)
    accepted: Literal[True]


class V3AcceptedResponse(_V3Strict):
    """接单成功响应(异步 analyze 用,§8 接单 5s)。"""

    ok: Literal[True]
    data: V3AcceptedData


class V3PageTextsPatch(_V3Strict):
    """一页文案补丁(章节故事 / 改页回写)。"""

    pageIndex: int = Field(ge=0)
    texts: dict[str, str]


# ---------- v3.ts: ① analyze (async 202 + callback) ---------------------------


class V3AnalyzeExif(_V3Strict):
    """★ §3 privacy enforcement point: only `takenAt`. `_V3Strict` rejects any
    lat/lng/place/coordinate key at parse time (WP0.1 TS strict() parity)."""

    takenAt: str | None = None

    _check_taken_at = field_validator("takenAt")(_validate_iso_datetime)


class V3AnalyzePhoto(_V3Strict):
    photoId: str = Field(min_length=1)
    base64: str = Field(min_length=1)  # data:image/(jpeg|png);base64,… ≤800KB
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    exif: V3AnalyzeExif = None

    _check_base64 = field_validator("base64")(_validate_v3_analyze_image_data_url)


class V3AnalyzeMeta(_V3Strict):
    promptHint: str = Field(default=None, max_length=500)


class V3AnalyzeRequest(_V3Strict):
    requestId: str = Field(min_length=1)
    albumId: str = Field(min_length=1)
    callbackUrl: HttpUrl
    language: V3Language
    meta: V3AnalyzeMeta = None
    photos: list[V3AnalyzePhoto] = Field(min_length=1, max_length=30)


# ---------- v3.ts: ② chapter-chat (sync) --------------------------------------


class V3ChapterChatRequest(_V3Strict):
    albumId: str = Field(min_length=1)
    language: V3Language
    chapter: V3Chapter
    pages: list[Page]
    history: list[V3ChatTurn] = Field(max_length=20)
    userMessage: str = Field(max_length=500)
    focusedPageIndex: int = Field(default=None, ge=0)


V3ChapterChatKind = Literal["talk", "write", "edit"]


class V3LayoutPatchEntry(_V3Strict):
    """改页的版面补丁(§4.2(3))。templateId/images/texts 局部更新。"""

    pageIndex: int = Field(ge=0)
    templateId: str = Field(default=None, min_length=1)
    images: dict[str, str] = None
    texts: dict[str, str] = None


class V3ChapterChatResponse(_V3Strict):
    kind: V3ChapterChatKind
    assistantReply: str = Field(min_length=1, max_length=500)
    # 仅 kind=='write':一次性写满本章全部页文案(§4.2(2))。
    pagesTexts: list[V3PageTextsPatch] = None
    # 仅 kind=='edit' 且涉版面:确定性引擎执行后的整页补丁(§4.2(3))。
    layoutPatch: list[V3LayoutPatchEntry] = None
    # 本章标题候选(≤4),供前端展示挑选;不回灌树(§3 数据归属)。
    nameOptions: list[str] = Field(default=None, max_length=4)
    usage: V3Usage

    @field_validator("nameOptions")
    @classmethod
    def _name_options_nonempty(cls, value: list[str] | None) -> list[str] | None:
        if value is not None and any(len(s) < 1 for s in value):
            raise ValueError("nameOptions entries must be non-empty")
        return value


# ---------- v3.ts: ③ recommend (sync) -----------------------------------------


class V3ChapterOverview(_V3Strict):
    """章节概览(每章一条),recommend 的主输入(§8 表)。"""

    chapterId: str = Field(min_length=1)
    description: str = Field(max_length=600)
    photoDescs: list[str] = Field(max_length=12)


class V3RecommendRequest(_V3Strict):
    albumId: str = Field(min_length=1)
    language: V3Language
    chapters: list[V3ChapterOverview] = Field(min_length=1)
    analysisSummary: str = Field(default=None, max_length=1000)
    userMessage: str = Field(default=None, max_length=500)


class V3ThemeOption(_V3Strict):
    """主题候选(供用户挑,不进树)。"""

    subject: str = Field(min_length=1)
    label: str = Field(min_length=1)
    tone: str = None


class V3ChapterColorRecommendation(_V3Strict):
    chapterId: str = Field(min_length=1)
    accentColor: AccentColor
    artFont: ArtFontPack


class V3RecommendResponse(_V3Strict):
    themeOptions: list[V3ThemeOption] = Field(min_length=1, max_length=3)
    chapterColors: list[V3ChapterColorRecommendation] = Field(min_length=1)
    assistantReply: str = Field(max_length=500)
    usage: V3Usage


# ---------- v3.ts: ③ apply-theme (sync, deterministic) ------------------------


class V3ChapterThemeChoice(_V3Strict):
    chapterId: str = Field(min_length=1)
    accentColor: AccentColor
    artFont: ArtFontPack


class V3ApplyThemeRequest(_V3Strict):
    albumId: str = Field(min_length=1)
    language: V3Language
    theme: V3ThemeOption
    chapters: list[V3ChapterThemeChoice] = Field(min_length=1)
    pages: list[Page]


class V3ApplyThemeResponse(_V3Strict):
    layoutPatch: list[V3LayoutPatchEntry] = Field(min_length=1)
    assistantReply: str = Field(default=None, max_length=500)
    usage: V3Usage


# ---------- v3.ts: ④ cover (sync, deterministic, optional) --------------------


class V3CoverRequest(_V3Strict):
    albumId: str = Field(min_length=1)
    language: V3Language
    # 选定的封面/封尾模板;null = 跳过该项(封面可选,§4.4)。
    coverTemplateId: str | None = Field(default=None, min_length=1)
    endingTemplateId: str | None = Field(default=None, min_length=1)
    pages: list[Page]


class V3CoverResponse(_V3Strict):
    layoutPatch: list[V3LayoutPatchEntry]  # 跳过时为空数组(§4.4「跳过=空」)。
    assistantReply: str = Field(default=None, max_length=500)
    usage: V3Usage


# ---------- v3.ts: ⑤ finalize (sync, deterministic) ---------------------------


class V3FinalizeRequest(_V3Strict):
    albumId: str = Field(min_length=1)
    language: V3Language
    tree: V3LayoutTree  # 整棵章节树(无 base64)
    pages: list[Page] = Field(min_length=1)


class V3FinalizeResponse(_V3Strict):
    layout: AlbumLayoutPlan  # 扁平定稿(对外渲染契约,不加树形字段)
    usage: V3Usage


# ---------- v3.ts: analyze callback envelope ----------------------------------
# Plain union discriminated on `event` (V3 has only one completed shape: analyze).


class V3CallbackError(_V3Strict):
    code: str = Field(min_length=1)
    message: str


class V3ProgressEvent(_V3Strict):
    requestId: str = Field(min_length=1)
    jobKind: V3JobKind
    event: Literal["progress"]
    stage: V3JobStage
    progress: int = Field(ge=0, le=100)
    message: str = None


class V3AnalyzeCompleted(_V3Strict):
    requestId: str = Field(min_length=1)
    jobKind: Literal["analyze"]
    event: Literal["completed"]
    # 预览态产物:V3 章节树 + 套好模板/填好通用文案-色的页。
    tree: V3LayoutTree
    pages: list[Page] = Field(min_length=1)
    usage: V3Usage


class V3FailedEvent(_V3Strict):
    requestId: str = Field(min_length=1)
    jobKind: V3JobKind
    event: Literal["failed"]
    error: V3CallbackError
    stage: V3JobStage = None
    progress: int = Field(default=None, ge=0, le=100)


V3Callback = Annotated[
    Union[V3ProgressEvent, V3FailedEvent, V3AnalyzeCompleted],
    Field(discriminator="event"),
]


# ---------- v3.ts: select-template legal candidate (§9 / §6) ------------------


class V3TemplateCandidate(_V3Strict):
    """模型只在确定性引擎给出的合法候选里挑(category 匹配 + 图片槽数能容纳)。"""

    templateId: str = Field(min_length=1)
    category: TemplateCategory
    imageSlotCount: int = Field(ge=0)
