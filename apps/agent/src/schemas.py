"""Pydantic mirrors of the cross-service contracts in @yujee/contracts.

All schemas use `extra='forbid'` so unknown keys from either AI providers or
Web callers are rejected instead of silently propagated. Callback envelopes
use a discriminated union on `event`.

V3 section (WP0.3 / issue #178) mirrors `packages/contracts/src/{enums,layout,
templates,v3}.ts` 1:1 — the TS zod definitions are the single source of truth
(architecture §6.8 第 5 条:契约 TS 先行 Python 镜像). Field names, optionality,
and enum members are kept byte-for-byte aligned; cross-language drift is guarded
by the fixture parity tests in tests/test_schemas.py.
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
    model_validator,
)


# ---------- shared enums ------------------------------------------------------

PhotoOrientation = Literal["portrait", "landscape", "square"]
PhotoQuality = Literal["hero", "detail", "fill"]
# 画面构图(识图模型输出,不可由宽高推导):特写/重点/全景。排版按此匹配模板槽位。
PhotoComposition = Literal["closeup", "focal", "wide"]
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
    """Vision output. Extends the external render shape with internal composing
    hints. The hints are stripped before photos enter `AlbumLayoutPlan.photos`."""

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


# JobError is the shared error shape carried by V3 failed callbacks.
class JobError(_Strict):
    code: str = Field(min_length=1)
    message: str


# =============================================================================
# V3 contracts (WP0.3 / #178) — mirror of @yujee/contracts src/{enums,layout,
# templates,v3}.ts. 五环节状态机的 `/v3/*` 端点 req/res + async callback。
#
# All models below are `_V3Strict` (extra='forbid'), matching the TS `.strict()`
# on every (nested) object. ★ analyze `exif` is the §3 privacy enforcement point:
# it carries only `takenAt`, so any lat/lng/place key is rejected at parse time.
# ★ analyze photo also accepts `clusterId` (#232): an opaque co-location/co-time
# label the browser derives locally from EXIF time/GPS (c1/c2/…) — NOT a
# coordinate. §3 privacy red line allows it but still forbids any
# location/place/GPS/lat/lng/coordinate field.
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
    ⚠️ NO location/place/GPS/lat/lng/coordinate field (§3 privacy) — `_V3Strict`
    rejects any such key at parse time. The opaque `clusterId` (#232) used for
    cluster grouping lives only on the analyze input photo, not on this tree node."""

    photoId: str = Field(min_length=1)
    sceneDescription: str = Field(max_length=300)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    orientation: PhotoOrientation
    # 识图模型写;排版按朝向×构图匹配模板槽位。旧树无此字段 => None(视作任意)。
    composition: PhotoComposition | None = None
    takenAt: str | None = None  # EXIF; missing => null (no GPS)

    _check_taken_at = field_validator("takenAt")(_validate_iso_datetime)


class V3Chapter(_V3Strict):
    """章节(v3-requirements §4.1):一图一章不跨章。`accentColor`/`artFont`
    分析期为 null 占位,theme 环节填。"""

    chapterId: str = Field(min_length=1)
    # 目录(TOC)专用占位:分析/识图阶段留空,后期写目录环节才填。
    description: str = Field(default="", max_length=600)
    # 内容采集(分组后采访)答案:自由文字,给排版/写文案当章节背景。
    # Web 拼「时间:… 地点:…」前缀 + 用户原话;坐标绝不进(仅地名文字,§3 隐私)。
    chapterContext: str = Field(default="", max_length=500)
    # Stage1 extracted source color. Distinct from final theme `accentColor`.
    # Migration field: older trees omit it; Stage1 PR249 trees may carry null.
    extractedColor: AccentColor | None = None
    accentColor: AccentColor | None  # required key; null placeholder until theme
    artFont: ArtFontPack | None  # required key; null placeholder until theme
    photos: list[V3ChapterPhoto]


class V3LayoutTree(_V3Strict):
    """V3 章节树根。落 albums.draft_json,只活在交互期(§3 树边界)。"""

    chapters: list[V3Chapter]


# ---------- templates.ts ------------------------------------------------------
# 模板契约:category | pairing | images | svgs | texts | items | variableDecor
#   | hint。单一 `category` 取代旧 slot+scene;图片槽 quality/orientation 保留,
#   作为图位特征匹配(确定性照片打分)的输入。packages/contracts/templates/*.json
#   是真相源。

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

class TemplateImageSlot(_V3Strict):
    """Addressable image position. `id` may be a bracket path (`cells[0].image`).
    `orientation`/`quality` feed the deterministic image-slot feature matching."""

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
    """Forced spread pairing (print)。Only valid when category == interior."""

    forced: bool
    with_: str = Field(min_length=1, alias="with")
    side: Literal["left", "right"]


class TemplateDef(_V3Strict):
    """模板定义。单一 `category` 分类(必填),取代旧 slot+scene
    (mirrors TS TemplateDef)。"""

    model_config = ConfigDict(extra="forbid", populate_by_name=True, strict=True)

    id: str = Field(min_length=1)
    # 分类(§9):唯一分类字段,必填。
    category: TemplateCategory
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
        # pairing 只在 interior 有意义(mirrors TS superRefine)。
        if self.pairing is not None and self.category != "interior":
            raise ValueError("pairing is only valid on interior templates")


# ---------- v3.ts: shared -----------------------------------------------------

V3Language = Literal["zh", "en"]
V3JobKind = Literal["analyze", "select-layout"]
# analyze 进度子阶段(§4.1);仅用于 progress 回调展示。
V3JobStage = Literal["describe", "group", "template", "preview", "layout", "legalize", "wrap"]


class V3Models(_V3Strict):
    vision: str = None
    planning: str = None


class V3Usage(_V3Strict):
    """统一 usage,各 /v3/* 端点共用(同 v2 Usage 形状)。"""

    durationMs: int = Field(ge=0)
    visionCallCount: int = Field(ge=0, default=0)
    geminiCallCount: int = Field(ge=0, default=0)
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
    # #232 opaque co-location/co-time cluster label (c1/c2/…), browser-derived
    # from EXIF time/GPS. NOT a coordinate. None/absent => browser couldn't
    # derive it (no EXIF / no GPS); the Agent then degrades to the current
    # "one big batch / model groups freely" behavior (backward compatible).
    # Mirrors TS `clusterId: z.string().min(1).nullish()` — old payloads without
    # the key still parse.
    clusterId: str | None = Field(default=None, min_length=1)
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
    photos: list[V3AnalyzePhoto] = Field(min_length=1, max_length=100)


# ---------- v3.ts: ②0 select-layout (async 202 + callback) -------------------


class SelectLayoutPhoto(_V3Strict):
    photoId: str = Field(min_length=1)
    ref200px: str = Field(min_length=1)
    orientation: PhotoOrientation
    # 构图(来自 Stage1 树):排版随机引擎按朝向×构图匹配槽位。旧相册 => None(任意)。
    composition: PhotoComposition | None = None
    takenAt: str | None

    _check_ref200px = field_validator("ref200px")(_validate_v3_analyze_image_data_url)
    _check_taken_at = field_validator("takenAt")(_validate_iso_datetime)


class SelectLayoutChapter(_V3Strict):
    chapterId: str = Field(min_length=1)
    photos: list[SelectLayoutPhoto] = Field(min_length=1)
    structureHint: str = Field(default=None, max_length=600)
    # 章节背景(内容采集答案):评委据此选更贴合的版式(生日→温馨…)。跳过采访/老相册 => ""。
    chapterContext: str = Field(default="", max_length=500)


class SelectLayoutRequest(_V3Strict):
    requestId: str = Field(min_length=1)
    callbackUrl: HttpUrl
    language: V3Language
    chapters: list[SelectLayoutChapter] = Field(min_length=1)


# ---------- P2 排版评委(rendered-thumbnail judge,two-phase) ------------------


class CandidatePage(_V3Strict):
    templateId: str = Field(min_length=1)
    images: dict[str, str]  # slotId → photoId


class JudgeCandidate(_V3Strict):
    candidateIndex: int = Field(ge=0)
    thumbnail: str = Field(min_length=1)  # data:image/jpeg;base64,...(仅图槽、无文字)
    pages: list[CandidatePage] = Field(min_length=1)


class JudgeLayoutUnit(_V3Strict):
    unitKey: str = Field(min_length=1)
    chapterId: str = Field(min_length=1)
    chosenIndex: int | None = Field(default=None, ge=0)
    candidates: list[JudgeCandidate] = Field(min_length=1)


class JudgeLayoutRequest(_V3Strict):
    requestId: str = Field(min_length=1)
    callbackUrl: HttpUrl
    language: V3Language
    units: list[JudgeLayoutUnit] = Field(min_length=1)


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


class V3StoryProgress(_V3Strict):
    currentChapterId: str | None = Field(min_length=1)
    doneChapterIds: list[str]

    @field_validator("doneChapterIds")
    @classmethod
    def _done_chapter_ids_nonempty(cls, value: list[str]) -> list[str]:
        if any(len(item) < 1 for item in value):
            raise ValueError("doneChapterIds entries must be non-empty")
        return value


class V3EditChatFocus(_V3Strict):
    chapterId: str | None = Field(default=None, min_length=1)
    pageIndex: int | None = Field(default=None, ge=0)

    @model_validator(mode="before")
    @classmethod
    def _reject_explicit_null_fields(cls, value):
        if isinstance(value, dict):
            for key in ("chapterId", "pageIndex"):
                if key in value and value[key] is None:
                    raise ValueError(f"{key} cannot be null")
        return value


class V3EditProgressDecision(_V3Strict):
    pageDone: bool | None = None
    chapterDone: bool | None = None
    advanceTo: Literal["theme"] | None = None


class V3EditNavigation(_V3Strict):
    pageIndex: int | None = Field(default=None, ge=0)
    chapterId: str | None = Field(default=None, min_length=1)

    @model_validator(mode="before")
    @classmethod
    def _reject_explicit_null_fields(cls, value):
        if isinstance(value, dict):
            for key in ("pageIndex", "chapterId"):
                if key in value and value[key] is None:
                    raise ValueError(f"{key} cannot be null")
        return value

    @model_validator(mode="after")
    def _requires_target(self):
        if self.pageIndex is None and self.chapterId is None:
            raise ValueError("navigation requires pageIndex or chapterId")
        return self


class V3EditChatRequest(_V3Strict):
    albumId: str = Field(min_length=1)
    language: V3Language
    userMessage: str = Field(max_length=500)
    focus: V3EditChatFocus
    progress: V3StoryProgress


V3EditChatKind = Literal["talk", "write", "edit"]


class V3EditChatResponse(_V3Strict):
    kind: V3EditChatKind
    assistantReply: str = Field(min_length=1, max_length=500)
    patches: list[V3LayoutPatchEntry] = Field(default_factory=list)
    pagesTexts: list[V3PageTextsPatch] | None = None
    progressDecision: V3EditProgressDecision | None = None
    navigation: V3EditNavigation | None = None
    opId: str = Field(min_length=1)
    usage: V3Usage


# ---------- v3.ts: ②b page-edit (sync, two-stage) -----------------------------
# 镜像 v3.ts V3PageEditRequest/Response。请求复用 V3ChapterChatRequest 同形字段;响应复用
# V3LayoutPatchEntry(不另造补丁形状)。全 `_V3Strict`(extra='forbid')。§3 隐私:
# V3Chapter/Page 本身已 strict,拒任何 place/GPS/坐标 key。


# 段一意图(可观测)。单意图(本期不做多意图 plan)。
V3PageEditIntent = Literal["edit_text", "change_layout", "advance", "talk"]


class V3PageEditRequest(_V3Strict):
    language: V3Language
    chapter: V3Chapter
    pages: list[Page]
    focusedPageIndex: int = Field(ge=0)
    userMessage: str = Field(max_length=500)
    history: list[V3ChatTurn] = Field(max_length=20)


class V3PageEditResponse(_V3Strict):
    assistantReply: str = Field(min_length=1, max_length=500)
    intent: V3PageEditIntent
    # edit_text→一条 {pageIndex, texts};change_layout→一条 {pageIndex, templateId, images}。
    layoutPatch: list[V3LayoutPatchEntry] = None
    # intent=='advance' 时为 True:用户想进下一章 → web 导航(Agent 不导航)。
    advanceIntent: bool = None
    usage: V3Usage


# ---------- v3.ts: ③ recommend (sync) -----------------------------------------


class V3ChapterOverview(_V3Strict):
    """章节概览(每章一条),recommend 的主输入(§8 表)。"""

    chapterId: str = Field(min_length=1)
    description: str = Field(max_length=600)
    # Stage1 extracted source color. Recommend may use it as evidence, but it is
    # not the final theme `accentColor`.
    extractedColor: AccentColor | None = None
    photoDescs: list[str] = Field(max_length=12)


class V3RecommendRequest(_V3Strict):
    albumId: str = Field(min_length=1)
    language: V3Language
    chapters: list[V3ChapterOverview] = Field(min_length=1)
    analysisSummary: str | None = Field(default=None, max_length=1000)
    userMessage: str | None = Field(default=None, max_length=500)
    fontHint: str | None = Field(default=None, max_length=200)


class V3ChapterThemeColor(_V3Strict):
    chapterId: str = Field(min_length=1)
    accentColor: AccentColor
    subject: str | None = Field(default=None, min_length=1)


class V3BookThemeOption(_V3Strict):
    optionId: str = Field(min_length=1, max_length=80)
    artFont: ArtFontPack
    chapters: list[V3ChapterThemeColor] = Field(min_length=1)
    style: str | None = Field(default=None, min_length=1, max_length=160)
    label: str | None = Field(default=None, min_length=1, max_length=160)


class V3RecommendResponse(_V3Strict):
    bookThemeOptions: list[V3BookThemeOption] = Field(min_length=3, max_length=3)
    assistantReply: str = Field(max_length=500)
    usage: V3Usage


# ---------- v3.ts: ③ apply-theme (sync, deterministic) ------------------------


class V3ChapterThemeChoice(_V3Strict):
    """用户选定的每章主题/色/字体。

    `subject` 存在时 = 用户确认的该章标题(一句话主题);apply-theme 只在它存在且 title
    槽为空时持久化,并把色/字体刷到 variableDecor 槽。"""

    chapterId: str = Field(min_length=1)
    subject: str | None = Field(default=None, min_length=1)
    accentColor: AccentColor
    artFont: ArtFontPack


class V3ApplyThemeRequest(_V3Strict):
    albumId: str = Field(min_length=1)
    language: V3Language
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
    # Stage5: 200px base64 thumbnails are for local color extraction only; do not
    # forward them to LLM prompts.
    coverPhoto: str | None = None
    endingPhoto: str | None = None
    # Textual guidance may be sent to 5a copy / 5b AI color design instead of base64.
    coverPhotoDesc: str | None = None
    # Cover/ending pages have no chapter owner, so Stage5 carries the selected
    # whole-book art font explicitly for page-level text carriers.
    artFont: ArtFontPack | None = None
    hint: str | None = None
    userMessage: str = ""
    history: list[V3ChatTurn] = Field(default_factory=list, max_length=20)
    pages: list[Page]

    @field_validator("coverPhoto", "endingPhoto", "coverPhotoDesc", "artFont", "hint", mode="before")
    @classmethod
    def _reject_explicit_null_stage5_optional(cls, value):
        if value is None:
            raise ValueError("omit Stage5 optional fields instead of sending null")
        return value


class V3CoverResponse(_V3Strict):
    layoutPatch: list[V3LayoutPatchEntry]  # 跳过时为空数组(§4.4「跳过=空」)。
    assistantReply: str = Field(default=None, max_length=500)
    needsUserInput: bool = False
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


# ---------- v3.ts: async callback envelope ------------------------------------
# Plain union discriminated on `event` plus `jobKind` for completed variants.


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
    # Stage1 tree-only. Stage2 select-layout is the only creator of pages.
    tree: V3LayoutTree
    usage: V3Usage


class SelectLayoutCompleted(_V3Strict):
    requestId: str = Field(min_length=1)
    jobKind: Literal["select-layout"]
    event: Literal["completed"]
    pages: list[Page] = Field(min_length=1)
    usage: V3Usage


class LayoutCandidate(_V3Strict):
    candidateIndex: int = Field(ge=0)
    pages: list[CandidatePage] = Field(min_length=1)


class SelectLayoutCandidateUnit(_V3Strict):
    unitKey: str = Field(min_length=1)
    chapterId: str = Field(min_length=1)
    candidates: list[LayoutCandidate] = Field(min_length=1)


class SelectLayoutCandidates(_V3Strict):
    """P2 phase 1 回调:候选结构交回浏览器去渲染。不推进 stage。"""

    requestId: str = Field(min_length=1)
    jobKind: Literal["select-layout"]
    event: Literal["candidates"]
    units: list[SelectLayoutCandidateUnit] = Field(min_length=1)
    usage: V3Usage


class AgentAckRequest(_V3Strict):
    opId: str = Field(min_length=1)


class AgentAckResponse(_V3Strict):
    ok: bool


class V3FailedEvent(_V3Strict):
    requestId: str = Field(min_length=1)
    jobKind: V3JobKind
    event: Literal["failed"]
    error: V3CallbackError
    stage: V3JobStage = None
    progress: int = Field(default=None, ge=0, le=100)


V3Callback = Union[V3ProgressEvent, V3FailedEvent, V3AnalyzeCompleted, SelectLayoutCompleted]


# ---------- v3.ts: select-template legal candidate (§9 / §6) ------------------


class V3TemplateCandidate(_V3Strict):
    """模型只在确定性引擎给出的合法候选里挑(category 匹配 + 图片槽数能容纳)。"""

    templateId: str = Field(min_length=1)
    category: TemplateCategory
    imageSlotCount: int = Field(ge=0)
