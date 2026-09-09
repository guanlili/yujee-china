"""建档的远程客户端 —— 委托给 2GB 的 CLIP worker。

`/v3/analyze` 跑在普通 1GB 的 yujee-agent 上,那台机器没有 onnxruntime、没有分割
权重,跟 CLIP embedding 一模一样的处境。所以建档也走 HTTP 委托,写法对齐
features.py:_remote_clip_embeddings(同一个 base_url、同一把 secret、同一种信封)。

照片 base64 只在请求内存里,不落盘不进日志(§隐私)。
"""

from __future__ import annotations

from typing import Any, Sequence

from ....logging_config import get_logger

log = get_logger("photo_profile")

# 比 CLIP 的 30 小得多:每张照片是一次分割推理 + 一次视觉模型调用,不是一次
# 轻量 embedding。批太大会顶穿 grouping_clip_timeout_seconds。
PROFILE_BATCH_SIZE = 8


def fetch_photo_profiles(photos: Sequence[Any], settings: Any) -> dict[str, dict]:
    """批量建档。返回 {photoId: profile}。

    形状不对直接抛 —— 由调用方(analyze)统一降级成「没有档案」。**不要**偷偷
    返回半份档案,那样错会一路飘到排版还查不出来。
    """
    base_url = getattr(settings, "grouping_clip_base_url", None)
    if not base_url or not photos:
        return {}

    import httpx

    url = base_url.rstrip("/") + "/internal/photo-profile"
    secret = settings.grouping_clip_secret or settings.agent_shared_secret
    headers = {"Authorization": f"Bearer {secret}"}

    items = [{"photoId": photo.photoId, "dataUrl": photo.base64} for photo in photos]
    out: dict[str, dict] = {}
    with httpx.Client(timeout=settings.grouping_clip_timeout_seconds) as client:
        for start in range(0, len(items), PROFILE_BATCH_SIZE):
            chunk = items[start : start + PROFILE_BATCH_SIZE]
            response = client.post(url, json={"images": chunk}, headers=headers)
            response.raise_for_status()
            body = response.json()
            profiles = (
                body.get("data", {}).get("profiles") if isinstance(body, dict) else None
            )
            if not isinstance(profiles, dict):
                raise ValueError("remote photo-profile service returned invalid profiles")
            out.update(profiles)
    return out
