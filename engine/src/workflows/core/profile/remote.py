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

    **失败按批局部化**:一批 502/超时/形状不对,只丢这一批,其余批照常返回。
    分批本来就是为了让失败可以局部化 —— 原来这里 raise_for_status() 直接抛出去,
    analyze 的 except 把 profiles 整个清成 {},一次抖动就是 100 张的书一张档案不剩。

    形状不对的那一批也是丢整批,**不**把半份档案混进来 —— 那样错会一路飘到排版
    还查不出来。整个 worker 都挂了就返回 {},上游退回今天的行为。
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
    failed_batches = 0
    batches = 0
    with httpx.Client(timeout=settings.grouping_clip_timeout_seconds) as client:
        for start in range(0, len(items), PROFILE_BATCH_SIZE):
            chunk = items[start : start + PROFILE_BATCH_SIZE]
            batches += 1
            try:
                out.update(_fetch_batch(client, url, headers, chunk))
            except Exception as exc:  # noqa: BLE001 —— 一批的失败只该丢这一批
                failed_batches += 1
                log.warning(
                    "photo_profile.batch_failed",
                    batch_index=batches - 1,
                    size=len(chunk),
                    error=f"{type(exc).__name__}: {exc}",
                )

    if failed_batches:
        # 全挂和挂一批的处置完全不同(前者是 worker/凭据的事,后者是抖动),
        # 收尾必须把比例说清楚,否则只能从一堆 warning 里数。
        log.warning(
            "photo_profile.incomplete",
            failed_batches=failed_batches,
            batches=batches,
            profiles=len(out),
            photos=len(items),
        )
    return out


def _fetch_batch(client: Any, url: str, headers: dict, chunk: list[dict]) -> dict[str, dict]:
    response = client.post(url, json={"images": chunk}, headers=headers)
    response.raise_for_status()
    body = response.json()
    profiles = body.get("data", {}).get("profiles") if isinstance(body, dict) else None
    if not isinstance(profiles, dict):
        raise ValueError("remote photo-profile service returned invalid profiles")
    return profiles
