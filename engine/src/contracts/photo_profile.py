"""照片视觉档案(PhotoProfile)的 pydantic 镜像。

TS 侧真相源:packages/contracts/src/photo-profile.ts —— 两边字段必须逐字对应,
tests/test_photo_profile_schema.py 里有一道机械守卫防漂移。

⚠️ 隐私红线(v3-requirements §3):本 schema **不得**新增任何 location/place/
GPS/lat/lng/coordinate 字段。`extra="forbid"` 是这条红线的执行机制,改成
allow/ignore 等于拆掉红线。
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

PHOTO_PROFILE_VERSION = 1

HexColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
# 坐标一律 0-100 百分比,与 imagePos 的 objectPosition 同口径。
Pct = Annotated[float, Field(ge=0, le=100)]


class PhotoBox(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: Pct
    y: Pct
    w: Pct
    h: Pct


class PhotoProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    v: Literal[1] = PHOTO_PROFILE_VERSION

    # 几何组(RMBG mask 派生)
    subjectBox: PhotoBox | None = None
    faceBoxes: list[PhotoBox] = Field(default_factory=list)
    maskKey: str | None = None

    # 色彩组(纯像素算法)
    colorTemp: Literal["warm", "neutral", "cool"]
    brightness: Literal["dark", "mid", "bright"]
    saturation: Literal["muted", "normal", "vivid"]
    dominantColors: list[HexColor] = Field(max_length=3)

    # 语义组(视觉模型)
    #
    # ⚠️ composition 可为 None,**这是刻意的**。视觉调用失败/返回枚举外的值时,语义组
    # 必须落 None 而不是编一个 focal:slot_matcher_v3 遇到 None 会「视作任意,不挡」,
    # 那是正确的降级;编一个值会让选版按错误的构图约束去匹配槽位,比没有档案更糟,
    # 而且在成品上查不出来(见 semantic._FALLBACK 的注释)。
    # 📌 TS 侧真相源 packages/contracts/src/photo-profile.ts 的 `composition` 目前
    # 还是 z.enum([...]) 不可空 —— 那边补上 `.nullable()` 之前,语义组失败的照片会被
    # web 的逐条 safeParse 整条跳过(色彩/几何一起丢)。engine 侧的章节树回填不受
    # 影响(tree_builder 本来就把非法值当 None)。
    composition: Literal["closeup", "focal", "wide"] | None = None
    scene: Literal["indoor", "outdoor", "nature", "city", "interior"]
    peopleCount: Literal["0", "1", "2-3", "4+"]
    mood: Literal["warm", "cool", "sentimental", "energetic", "quiet"]
    description: str = Field(max_length=300)
