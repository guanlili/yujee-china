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
    # 页面 HTML 真相(C 方案,zod 镜像):engine 不生成也不消费它,仅为契约对齐;
    # 图片 src 保持 {{IMG_SRC:slotId}} token,base64 绝不入库。
    html: str | None = Field(default=None, max_length=65536)


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
# it carries only `takenAt`, so any lat/lng coordinate key is rejected at parse
# time (place names don't enter via analyze either — they reach the tree through
# the content-interview step, see V3Chapter.place / chapterContext).
# ★ analyze photo also accepts `clusterId` (#232): an opaque co-location/co-time
# label the browser derives locally from EXIF time/GPS (c1/c2/…) — NOT a
# coordinate. §3 privacy red line, 2026-07 revision («地名文字可出、坐标止步浏览器»):
# coordinates (lat/lng/GPS) in any form stay forbidden; CITY-LEVEL PLACE-NAME
# STRINGS are allowed (browser-side reverse geocoding; the coordinates themselves
# never leave the browser). Structured place field: V3Chapter.place only.
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
# 艺术字字体 id(§4.3)。closed legal set;镜像 contracts/src/enums.ts ArtFontPack。
# B1 定稿:旧 4 抽象包(兼容保留)+ 真实字体库(中文 9 + 英文,按角色分工)。三处手工对齐。
ArtFontPack = Literal[
    # 旧占位包(兼容保留,勿新用)
    "serif-classic",
    "sans-modern",
    "script-elegant",
    "display-bold",
    # 中文(9)
    "noto-serif-sc",
    "noto-sans-sc",
    "zcool-xiaowei",
    "lxgw-wenkai",
    "smiley-sans",
    "zcool-qingke-huangyou",
    "long-cang",
    "zhi-mang-xing",
    "liu-jian-mao-cao",
    # 英文·正文
    "eb-garamond",
    "source-serif-4",
    "lora",
    "libre-baskerville",
    "inter",
    "work-sans",
    "dm-sans",
    "poppins",
    "raleway",
    # 英文·标题
    "playfair-display",
    "cormorant-garamond",
    "bebas-neue",
    "archivo-black",
    "abril-fatface",
    "montserrat",
    # 英文·装饰
    "ibm-plex-mono",
    "jetbrains-mono",
    "great-vibes",
    "dancing-script",
    "sacramento",
    "parisienne",
]


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
    # 章标识:分析期由 EXIF 时间跨度确定性派生(同树内保证不重名),UI 章节卡片/
    # 书籍树读它。迁移字段:老树无此键 => ""(读取方降级到 description)。
    title: str = Field(default="", max_length=120)
    # 目录(TOC)占位:分析期留空,后期写目录环节才填。
    description: str = Field(default="", max_length=600)
    # 内容采集(分组后采访)答案:自由文字,给排版/写文案当章节背景。
    # Web 拼「时间:… 地点:…」前缀 + 用户原话;坐标绝不进(仅地名文字,§3 隐私)。
    chapterContext: str = Field(default="", max_length=500)
    # 拍摄地点:城市级地名文字(浏览器本地反地理编码,坐标不出浏览器,§3 2026-07 口径)。
    # 章不跨 cluster(#232)故挂章级;采访提交时写回。跳过采访/老树 => ""。
    place: str = Field(default="", max_length=100)
    # 章节关键词,设计环节当每组内容画像。分析期已砍掉识图,恒为 [];老树 => []。
    keywords: list[str] = Field(default_factory=list)
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
#   | sample。单一 `category` 取代旧 slot+scene;图片槽 quality/orientation 保留,
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
    lang: TemplateTextLang
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
V3JobKind = Literal["analyze", "select-layout", "compose"]
# analyze 进度子阶段(§4.1);仅用于 progress 回调展示。
V3JobStage = Literal[
    "describe", "group", "template", "preview", "layout", "legalize", "compose", "wrap"
]


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


# ---------- ④ compose 一次性成稿(async 202 + callback) ------------------------
# 用户选完设计之后的一把成稿:按章并发让 Gemini【看真实照片】+【读用户讲的故事】写满
# 全书文案,并出封面/封尾文案与字体。取代原来的 /v3/design(同步只出字体+封面文案)。


class ComposeTextSlotSpec(_V3Strict):
    """封面/封尾模板的一个文字槽规格(Web 从模板 JSON 提取后传入)。"""

    id: str = Field(min_length=1)
    role: str = Field(min_length=1)
    # sample 是这个槽在版面上的实际长度参考,既当风格示例也当篇幅预算(不设字数上限)。
    sample: str = Field(default="", max_length=300)


class ComposePhoto(_V3Strict):
    """一张照片:200px 缩略图**真图**进模型上下文(§隐私:只在请求内存里)。"""

    photoId: str = Field(min_length=1)
    ref200px: str = Field(min_length=1)
    takenAt: str | None = None
    # 城市级地名文字(§3 privacy 2026-07 口径:地名可出、坐标止步浏览器)。
    place: str | None = Field(default=None, max_length=120)

    _check_ref200px = field_validator("ref200px")(_validate_v3_analyze_image_data_url)
    _check_taken_at = field_validator("takenAt")(_validate_iso_datetime)


class ComposePage(_V3Strict):
    """已选定版式的一页:pageIndex 是整册连续页序(select-layout 出的),写回时按它对位。"""

    pageIndex: int = Field(ge=0)
    templateId: str = Field(min_length=1)
    images: dict[str, str] = Field(default_factory=dict)


class ComposeChapter(_V3Strict):
    chapterId: str = Field(min_length=1)
    title: str = Field(default="", max_length=120)
    # 用户在采访环节讲的原话:成稿的最高优先级素材。跳过采访/老相册 => ""。
    chapterContext: str = Field(default="", max_length=500)
    photos: list[ComposePhoto] = Field(default_factory=list)
    pages: list[ComposePage] = Field(default_factory=list)


class ComposeFonts(_V3Strict):
    title: ArtFontPack
    body: ArtFontPack
    decoration: ArtFontPack


class ComposeRequest(_V3Strict):
    requestId: str = Field(min_length=1)
    callbackUrl: HttpUrl
    language: V3Language
    albumTitle: str = Field(default="", max_length=120)
    coverTemplateId: str = Field(default="", max_length=64)
    endingTemplateId: str = Field(default="", max_length=64)
    coverSlots: list[ComposeTextSlotSpec] = Field(default_factory=list)
    endingSlots: list[ComposeTextSlotSpec] = Field(default_factory=list)
    # 用户在设计卡里自己选的字体;非空即直接采用,不让模型再选一遍。
    userFontChoice: ComposeFonts | None = None
    chapters: list[ComposeChapter] = Field(min_length=1)


# ---------- v3.ts: ② chapter-chat (sync) --------------------------------------


class V3LayoutPatchEntry(_V3Strict):
    """改页的版面补丁(§4.2(3))。templateId/images/texts 局部更新。"""

    pageIndex: int = Field(ge=0)
    templateId: str = Field(default=None, min_length=1)
    images: dict[str, str] = None
    texts: dict[str, str] = None


class V3StoryProgress(_V3Strict):
    currentChapterId: str | None = Field(min_length=1)
    doneChapterIds: list[str]

    @field_validator("doneChapterIds")
    @classmethod
    def _done_chapter_ids_nonempty(cls, value: list[str]) -> list[str]:
        if any(len(item) < 1 for item in value):
            raise ValueError("doneChapterIds entries must be non-empty")
        return value


# ---------- v3.ts: ②b page-edit (sync, two-stage) -----------------------------
# 镜像 v3.ts V3PageEditRequest/Response。请求复用 V3ChapterChatRequest 同形字段;响应复用
# V3LayoutPatchEntry(不另造补丁形状)。全 `_V3Strict`(extra='forbid')。§3 隐私:
# V3Chapter/Page 本身已 strict,拒任何 place/GPS/坐标 key。


# ---------- v3.ts: ③ recommend (sync) -----------------------------------------


class V3ChapterOverview(_V3Strict):
    """章节概览(每章一条),recommend 的主输入(§8 表)。"""

    chapterId: str = Field(min_length=1)
    description: str = Field(max_length=600)
    # Stage1 extracted source color. Recommend may use it as evidence, but it is
    # not the final theme `accentColor`.
    extractedColor: AccentColor | None = None
    photoDescs: list[str] = Field(max_length=12)


# ---------- v3.ts: ③ apply-theme (sync, deterministic) ------------------------


# ---------- v3.ts: ④ cover (sync, deterministic, optional) --------------------


# ---------- v3.ts: ⑤ finalize (sync, deterministic) ---------------------------


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


class ComposeCompleted(_V3Strict):
    """④ 成稿完成:全书文案一次性回来。

    `pagesTexts` 形状是 `{pageIndex: {slotId: 文案}}`(JSON 序列化后 key 是字符串)。
    **只含写出来的页**:某章写不出来 → 该章页面不出现在这里,Web 保留模板 sample 文案,
    不发 `failed`(成稿是叠加性的一步,绝不阻断交付)。

    ⚠️ `coverTexts` / `endingTexts` 跟 `pagesTexts` 的约定**不一样**:它们按封面/封尾
    模板声明的槽位给全 key,模型没写出来的槽带着**空串**回来(封面 title 槽会兜相册
    标题,其余就是 `""`)。Web 侧写回时必须**忽略空串**,否则会把模板 sample 洗成空白。"""

    requestId: str = Field(min_length=1)
    jobKind: Literal["compose"]
    event: Literal["completed"]
    pagesTexts: dict[int, dict[str, str]] = Field(default_factory=dict)
    coverTexts: dict[str, str] = Field(default_factory=dict)
    endingTexts: dict[str, str] = Field(default_factory=dict)
    # 三款字体 id(title/body/decoration);由代码按 场景×语言 查表或用户选择填。
    fonts: dict[str, str] = Field(default_factory=dict)
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


V3Callback = Union[
    V3ProgressEvent,
    V3FailedEvent,
    V3AnalyzeCompleted,
    SelectLayoutCompleted,
    ComposeCompleted,
]


# ---------- v3.ts: select-template legal candidate (§9 / §6) ------------------


class V3TemplateCandidate(_V3Strict):
    """模型只在确定性引擎给出的合法候选里挑(category 匹配 + 图片槽数能容纳)。"""

    templateId: str = Field(min_length=1)
    category: TemplateCategory
    imageSlotCount: int = Field(ge=0)
