"""三组合一 -> PhotoProfile。

分层原则:三组各自失败都降级,不抛 —— 一张照片的某一组缺失只该让它退回默认排版,
不该打挂整本分析。

⚠️ 但降级有个下限:**图本身解不开就抛**,不编一份全默认的档案。
`Image.open` 是惰性的,截断的 JPEG 能 open 成功,真解码要到 color 组 convert 的
时候才炸(实测 `Image.open OK` -> `OSError: image file is truncated`)。给一张
根本没看过的照片编出 neutral/mid/normal + focal,跟语义组编 focal 是同一种病:
下游会拿它当真值去选 LUT、算构图。少一份档案是诚实的降级,编一份不是 —— 调用方
(routes.py 的 /internal/photo-profile)按张兜住,只丢这一张。

⚠️ 每一次降级都要留一条带 photoId 和异常类型的日志。整组失效(权重丢了、视觉槽
不可用)时每张照片都会静静落回退值,而 tree_builder 会老老实实把回退值回填进章节树
—— 没有日志就没人知道哪一组挂了。

⚠️ 隐私红线的第三道闸:这里只组装三组已知字段,不透传任何模型原始输出。
上游两道是 semantic 的提示词和契约的 extra="forbid"。
"""

from __future__ import annotations

from PIL import Image

from ....logging_config import get_logger
from .color import color_features
from .geometry import subject_geometry
from .semantic import semantic_features

log = get_logger("photo_profile")

PHOTO_PROFILE_VERSION = 1

# 几何降级:跑不出主体,imagePos 走默认 50/50/1。
_GEOMETRY_FALLBACK = {"subjectBox": None, "faceBoxes": []}

# 语义降级:与 semantic._FALLBACK 一致。这里再写一份是因为 semantic_features
# 本身也可能整个抛(例如 settings 缺 key 时 select_vision_slot 直接 raise),
# 那种情况下拿不到它的兜底。composition 落 None 的理由见 semantic._FALLBACK。
_SEMANTIC_FALLBACK = {
    "composition": None,
    "scene": "outdoor",
    "peopleCount": "0",
    "mood": "quiet",
    "description": "",
}


def build_profile(
    image: Image.Image, *, photo_id: str = "", stats: dict | None = None
) -> dict:
    # 惰性解码在这里兑现。放在最前面有两个好处:坏图不用白烧一次分割推理 + 一次
    # 视觉模型调用才被发现;而且炸在一个调用方包了 try 的地方。
    try:
        image.load()
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "photo_profile.undecodable_image",
            photo_id=photo_id,
            error=f"{type(exc).__name__}: {exc}",
        )
        raise

    try:
        geometry = subject_geometry(image)
    except Exception as exc:  # noqa: BLE001 —— 模型挂了降级成「没主体」,走默认 50/50/1
        log.warning(
            "photo_profile.geometry_failed",
            photo_id=photo_id,
            error=f"{type(exc).__name__}: {exc}",
        )
        geometry = dict(_GEOMETRY_FALLBACK)

    try:
        semantic = semantic_features(image, photo_id=photo_id, stats=stats)
    except Exception as exc:  # noqa: BLE001 —— 一张照片的语义失败不该打挂整本分析
        log.warning(
            "photo_profile.semantic_failed",
            photo_id=photo_id,
            error=f"{type(exc).__name__}: {exc}",
        )
        semantic = dict(_SEMANTIC_FALLBACK)

    return {
        "v": PHOTO_PROFILE_VERSION,
        "subjectBox": geometry["subjectBox"],
        "faceBoxes": geometry["faceBoxes"],
        "maskKey": None,  # 建档不存 mask,真抠图时按需生成
        **color_features(image),
        **semantic,
    }
