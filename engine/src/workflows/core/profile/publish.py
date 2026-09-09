"""建档结果回传 web —— 整批功能的**唯一出口**。

analyze 里那次回填只写章节树的 composition/sceneDescription;档案本体
(subjectBox/faceBoxes/色彩组/语义组)要落到 `album_photos.profile` 才有人读得到。
不回传的后果不是报错,是 **整批三个照片能力集体空转**:profile 列恒 NULL ->
design-agent 永远看不到档案 -> 整本调色 / 构图裁切 / 抠图三个工具全在猜。

失败**不打挂 analyze**(档案是增强不是必需),但必须打日志 —— 静默丢档案正是
这条路要治的病。

⚠️ 鉴权用 `agent_shared_secret`,不是 `grouping_clip_secret`:对面是 web 的
`requireAgentSecret`(与 job-progress 同款),拿 CLIP worker 那把去敲会 401,
而 401 在这条路上的表现就是「悄悄地没有档案」。
"""

from __future__ import annotations

import asyncio
from typing import Any, Mapping
from urllib.parse import urlsplit, urlunsplit

from ....logging_config import get_logger

log = get_logger("photo_profile")

# web 侧的接收端点(apps/web/src/app/api/v3/internal/photo-profiles/route.ts)。
_SINK_PATH = "/api/v3/internal/photo-profiles"

_TIMEOUT_SECONDS = 15
# 只重一次:这是全书档案的唯一出口,一次网络抖动就全丢太亏;但 analyze 的总预算
# 有限,重三次的收益远不如把时间留给别的阶段。
_RETRY_BACKOFF_SECONDS = 1.0


def _sink_url(callback_url: str) -> str:
    """从 web 自己给的回调地址推 origin。

    刻意**不用** settings.web_base_url:那个变量在这个仓里至今没有任何消费方,
    主 Agent 上配得对不对没人验过;而 callbackUrl 是 web 每次请求自己带来的,
    信任级别与「把整棵树 POST 回去」完全一样。
    """
    parts = urlsplit(callback_url)
    return urlunsplit((parts.scheme, parts.netloc, _SINK_PATH, "", ""))


async def publish_photo_profiles(
    *,
    album_id: str,
    profiles: Mapping[str, Any],
    callback_url: str,
    settings: Any,
) -> bool:
    if not profiles:
        return False

    import httpx

    url = _sink_url(callback_url)
    headers = {
        "Authorization": f"Bearer {settings.agent_shared_secret}",
        "Content-Type": "application/json",
    }
    body = {"albumId": album_id, "profiles": dict(profiles)}

    for attempt in (1, 2):
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
                response = await client.post(url, json=body, headers=headers)
            if response.status_code < 300:
                log.info("photo_profile.published", album_id=album_id, count=len(profiles))
                return True
            # 4xx 重试一遍还是 4xx —— 白等一轮,而且掩盖了「凭据/契约配错了」这个信号。
            retryable = response.status_code >= 500
            log.warning(
                "photo_profile.publish_rejected",
                album_id=album_id,
                status=response.status_code,
                attempt=attempt,
            )
            if not retryable:
                return False
        except Exception as exc:  # noqa: BLE001 —— 回传挂了不该连坐整次 analyze
            log.warning(
                "photo_profile.publish_failed",
                album_id=album_id,
                attempt=attempt,
                error=f"{type(exc).__name__}: {exc}",
            )
        if attempt == 1 and _RETRY_BACKOFF_SECONDS:
            await asyncio.sleep(_RETRY_BACKOFF_SECONDS)

    log.warning(
        "photo_profile.publish_giveup", album_id=album_id, count=len(profiles)
    )
    return False
