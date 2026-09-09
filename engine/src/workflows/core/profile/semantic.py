"""语义组:一次视觉模型调用同时出五个字段。

⚠️ 隐私红线(v3-requirements §3):提示词明确禁止写地名/位置,契约层的
extra=forbid 是第二道闸。两道都要在。

模型不可靠是常态 —— 枚举外的值、非 JSON、套围栏都会发生。一律落安全默认,
绝不抛异常:一张照片解析失败不该打挂整本分析。

⚠️ 但「不抛」不等于「不吭声」:每一次降级都要留一条带 photoId 和异常类型的日志。
视觉槽整体不可用时(key 轮换掉了、上游限流、代理挡死)每张照片都会静静落回退值,
而 tree_builder 会老老实实把回退值回填进章节树 —— 没有日志就没人知道视觉组挂了。
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import re

from PIL import Image

from ....logging_config import get_logger

log = get_logger("photo_profile")

PROMPT = """你在为一本纪念相册分析单张照片。只输出 JSON，不要任何解释文字。

{
  "composition": "closeup | focal | wide",
  "scene": "indoor | outdoor | nature | city | interior",
  "peopleCount": "0 | 1 | 2-3 | 4+",
  "mood": "warm | cool | sentimental | energetic | quiet",
  "description": "一句话描述画面内容，不超过 60 字"
}

规则：
- composition：closeup=人物或物体特写；focal=有明确主体的中景；wide=大场景/风光。
- description 只描述看得见的画面。
- **严禁写任何地名、位置、坐标信息**，即使你认得出这是哪里。写"海边"可以，写具体城市名不行。
- 值必须从上面给的选项里选，不要自造。
"""

_COMPOSITION = {"closeup", "focal", "wide"}
_SCENE = {"indoor", "outdoor", "nature", "city", "interior"}
_PEOPLE = {"0", "1", "2-3", "4+"}
_MOOD = {"warm", "cool", "sentimental", "energetic", "quiet"}

# 安全默认:模型给不出可用值时落这里。
#
# ⚠️ composition 落 **None**,不是编一个 focal。slot_matcher_v3 遇到 None 会
# 「视作任意,不挡」—— 那是正确的降级;编一个 focal 会让选版按**错误的构图约束**
# 去匹配槽位,比没有档案更糟,而且在成品上查不出来。其余三个枚举没有硬约束消费方,
# 取最不容易造成明显错配的中间态即可;description 落空串。
_FALLBACK = {
    "composition": None,
    "scene": "outdoor",
    "peopleCount": "0",
    "mood": "quiet",
    "description": "",
}

# 契约 PhotoProfile.description 是 max_length=300,这里先截断,免得组装层被拒。
_DESCRIPTION_MAX = 300


def semantic_features(
    image: Image.Image, *, photo_id: str = "", stats: dict | None = None
) -> dict:
    """`stats`:成本计数的出参。记的是**真的发出去并回来了**的调用数 ——
    失败的调用不计费,拿档案份数去凑会让成本表虚高,还反过来掩盖「视觉组全挂了」
    (那种情况下每张照片都有档案,但一次调用都没成功)。"""
    try:
        raw = _call_vision(image)
    except Exception as exc:  # noqa: BLE001 —— 一张照片的模型失败不该打挂整本分析
        log.warning(
            "photo_profile.vision_call_failed",
            photo_id=photo_id,
            error=f"{type(exc).__name__}: {exc}",
        )
        return dict(_FALLBACK)
    if stats is not None:
        # 解不出 JSON 也照计:token 已经烧掉了。
        stats["visionCalls"] = stats.get("visionCalls", 0) + 1
    return _parse(raw, photo_id=photo_id)


def _parse(raw: str, *, photo_id: str = "") -> dict:
    data = _loads_lenient(raw)
    if not isinstance(data, dict):
        # 模型返回了东西但解不出 JSON。也要留痕 —— 否则「全书 composition 都是
        # None」分不清是视觉组挂了还是模型在胡说,处置完全不同。
        log.warning("photo_profile.vision_unparseable", photo_id=photo_id)
        return dict(_FALLBACK)

    def pick(key: str, allowed: set[str]):
        value = data.get(key)
        if isinstance(value, str) and value in allowed:
            return value
        log.warning(
            "photo_profile.vision_value_rejected", photo_id=photo_id, field=key
        )
        return _FALLBACK[key]

    description = data.get("description")
    description = description[:_DESCRIPTION_MAX] if isinstance(description, str) else ""

    return {
        "composition": pick("composition", _COMPOSITION),
        "scene": pick("scene", _SCENE),
        "peopleCount": pick("peopleCount", _PEOPLE),
        "mood": pick("mood", _MOOD),
        "description": description,
    }


def _loads_lenient(raw: str):
    """模型爱套 ```json 围栏、爱在 JSON 前后加话。剥掉再解析。"""
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    fenced = re.search(r"```(?:json)?\s*(.+?)\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    else:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]
    try:
        return json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None


def _image_to_data_url(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _call_vision(image: Image.Image) -> str:
    """调视觉槽(默认 ARK doubao)。照片以 data URL 进 content ——
    写法参照 workflows/core/compose/handler.py:_build_chapter_messages。

    ai_client.chat_completion 是 async,而建档整条是同步的(A5 的 build_profile
    在 run_in_threadpool 里跑)。所以这里用 asyncio.run 起一次性事件循环 ——
    线程池线程里没有在跑的 loop,这样是安全的。
    """
    from ....providers.ai_client import chat_completion, extract_text
    from ....providers.vision_provider import select_vision_slot
    from ....settings import get_settings

    slot = select_vision_slot(get_settings())
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "image_url": {"url": _image_to_data_url(image)}},
            ],
        }
    ]

    response = asyncio.run(
        chat_completion(
            base_url=slot.base_url,
            api_key=slot.api_key,
            model=slot.model,
            messages=messages,
            timeout_seconds=slot.timeout_seconds,
            response_format=slot.response_format,
            extra_body=slot.extra_body,
            temperature=0.2,
        )
    )
    return extract_text(response)
