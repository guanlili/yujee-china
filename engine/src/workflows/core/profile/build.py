"""三组合一 -> PhotoProfile。

分层原则:任何一组失败都降级,不抛 —— 一张照片的档案缺失只该让它退回默认
排版,不该打挂整本分析。

⚠️ 隐私红线的第三道闸:这里只组装三组已知字段,不透传任何模型原始输出。
上游两道是 semantic 的提示词和契约的 extra="forbid"。
"""

from __future__ import annotations

from PIL import Image

from .color import color_features
from .geometry import subject_geometry
from .semantic import semantic_features

PHOTO_PROFILE_VERSION = 1

# 几何降级:跑不出主体,imagePos 走默认 50/50/1。
_GEOMETRY_FALLBACK = {"subjectBox": None, "faceBoxes": []}

# 语义降级:与 semantic._FALLBACK 一致。这里再写一份是因为 semantic_features
# 本身也可能整个抛(例如 settings 缺 key 时 select_vision_slot 直接 raise),
# 那种情况下拿不到它的兜底。
_SEMANTIC_FALLBACK = {
    "composition": "focal",
    "scene": "outdoor",
    "peopleCount": "0",
    "mood": "quiet",
    "description": "",
}


def build_profile(image: Image.Image) -> dict:
    try:
        geometry = subject_geometry(image)
    except Exception:  # noqa: BLE001 —— 模型挂了降级成「没主体」,走默认 50/50/1
        geometry = dict(_GEOMETRY_FALLBACK)

    try:
        semantic = semantic_features(image)
    except Exception:  # noqa: BLE001 —— 一张照片的语义失败不该打挂整本分析
        semantic = dict(_SEMANTIC_FALLBACK)

    return {
        "v": PHOTO_PROFILE_VERSION,
        "subjectBox": geometry["subjectBox"],
        "faceBoxes": geometry["faceBoxes"],
        "maskKey": None,  # 建档不存 mask,真抠图时按需生成
        **color_features(image),
        **semantic,
    }
