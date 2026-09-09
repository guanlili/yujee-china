"""建档的远程客户端 —— 委托给 2GB 的 CLIP worker。

`/v3/analyze` 跑在普通 1GB 的 yujee-agent 上,那台机器没有 onnxruntime、没有分割
权重,跟 CLIP embedding 一模一样的处境。所以建档也走 HTTP 委托,写法对齐
features.py:_remote_clip_embeddings(同一个 base_url、同一把 secret、同一种信封)。

照片 base64 只在请求内存里,不落盘不进日志(§隐私)。
"""

from __future__ import annotations

import time
from typing import Any, Sequence

from ....logging_config import get_logger

log = get_logger("photo_profile")

# 比 CLIP 的 30 小得多:每张照片是一次分割推理 + 一次视觉模型调用,不是一次
# 轻量 embedding。批太大会顶穿 grouping_clip_timeout_seconds。
PROFILE_BATCH_SIZE = 8


def fetch_photo_profiles(
    photos: Sequence[Any], settings: Any, *, stats: dict | None = None
) -> dict[str, dict]:
    """批量建档。返回 {photoId: profile}。

    **失败按批局部化**:一批 502/超时/形状不对,只丢这一批,其余批照常返回。
    分批本来就是为了让失败可以局部化 —— 原来这里 raise_for_status() 直接抛出去,
    analyze 的 except 把 profiles 整个清成 {},一次抖动就是 100 张的书一张档案不剩。

    形状不对的那一批也是丢整批,**不**把半份档案混进来 —— 那样错会一路飘到排版
    还查不出来。整个 worker 都挂了就返回 {},上游退回今天的行为。

    `stats`:成本计数的出参(`visionCalls`)。视觉调用发生在对面那台 worker 上,
    本机看不见,只能靠响应带回来 —— usage.visionCallCount 唯一的真实来源。

    **总时长有预算**(settings.photo_profile_budget_seconds)。分批是串行的,每批的
    超时是 grouping_clip_timeout_seconds(180s),而 analyze 的总预算才 600s:100 张
    = 13 批,每批只要慢到 60s 就是 780s,整本 AGENT_TIMEOUT。上游的 try/except 只接得住
    异常,接不住「耗时」。超预算就停止建档、用已经拿到的那部分继续 —— 建档是锦上添花,
    不能让它把 analyze 拖挂。单批超时同时压进剩余预算里,否则「还剩 1s 还去发一批,
    这批自己等 180s」照样冲出预算,预算就只是个装饰。
    """
    base_url = getattr(settings, "grouping_clip_base_url", None)
    if not base_url or not photos:
        return {}

    import httpx

    url = base_url.rstrip("/") + "/internal/photo-profile"
    secret = settings.grouping_clip_secret or settings.agent_shared_secret
    headers = {"Authorization": f"Bearer {secret}"}

    per_batch_timeout = settings.grouping_clip_timeout_seconds
    budget = getattr(settings, "photo_profile_budget_seconds", None)
    deadline = time.monotonic() + budget if budget else None

    items = [{"photoId": photo.photoId, "dataUrl": photo.base64} for photo in photos]
    total_batches = (len(items) + PROFILE_BATCH_SIZE - 1) // PROFILE_BATCH_SIZE
    out: dict[str, dict] = {}
    failed_batches = 0
    batches = 0
    with httpx.Client(timeout=per_batch_timeout) as client:
        for start in range(0, len(items), PROFILE_BATCH_SIZE):
            timeout = per_batch_timeout
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    log.warning(
                        "photo_profile.budget_exhausted",
                        budget_seconds=budget,
                        done_batches=batches,
                        total_batches=total_batches,
                        profiles=len(out),
                    )
                    break
                timeout = min(per_batch_timeout, remaining)

            chunk = items[start : start + PROFILE_BATCH_SIZE]
            batches += 1
            try:
                out.update(_fetch_batch(client, url, headers, chunk, timeout, stats))
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


def _fetch_batch(
    client: Any,
    url: str,
    headers: dict,
    chunk: list[dict],
    timeout: float,
    stats: dict | None = None,
) -> dict[str, dict]:
    response = client.post(url, json={"images": chunk}, headers=headers, timeout=timeout)
    response.raise_for_status()
    body = response.json()
    data = body.get("data", {}) if isinstance(body, dict) else {}
    profiles = data.get("profiles") if isinstance(data, dict) else None
    if not isinstance(profiles, dict):
        raise ValueError("remote photo-profile service returned invalid profiles")
    if stats is not None:
        # 老版本 worker 不带这个字段 —— 当 0,别为一个计数器把整批档案判死。
        calls = data.get("visionCallCount")
        if isinstance(calls, int):
            stats["visionCalls"] = stats.get("visionCalls", 0) + calls
    return profiles
