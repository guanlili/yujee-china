"""Stage2 排版评委(LLM 调用层)——统一真图缩略图逻辑。

代码确定性地随机生成候选,浏览器用真实模板 + 真照片渲染缩略图,评委直接看图选
(`judge_layout_thumbnails`,prompt 在 `judge_thumbnails.md`)。单页换版式复用同一
评委(`judge_page_template`)。旧线框结构评委(slots JSON + 灰盒线框)已整条移除。
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from .....providers import ai_client, gemini_client
from .....logging_config import get_logger
from .....settings import get_settings
from ....prompts import load_prompt
from .schema import GeminiLayoutUnavailable, LayoutBatchJudgeResult, LayoutJudgeResult

log = get_logger("select_layout")

_PROMPT_DIR = Path(__file__).resolve().parent
_DATA_URL_RE = re.compile(r"^data:(?P<mime>[-\w.+/]+);base64,(?P<data>.+)$", re.DOTALL)

# 豆包 vision 要求图片每边 ≥14px。浏览器偶发把某候选渲成 1×1(空/坏缩略图),
# 送进豆包会整批 400、判图落空(Gemini 无此限制,但保底豆包会被它搞挂)。
# 补边到 16×16(贴左上、白底):豆包收得下,坏图对判图无用但不再毁掉整批。
_MIN_THUMB_EDGE = 16


def _pad_tiny_thumbnail(data_url: str) -> str:
    """把 <14px 的坏缩略图补边到 16×16(白底)。非 data-url/解码失败/已够大 → 原样返回。"""
    m = _DATA_URL_RE.match(data_url)
    if not m:
        return data_url
    try:
        import base64
        import io

        from PIL import Image

        raw = base64.b64decode(m.group("data"))
        img = Image.open(io.BytesIO(raw))
        w, h = img.size
        if w >= 14 and h >= 14:
            return data_url
        canvas = Image.new("RGB", (max(w, _MIN_THUMB_EDGE), max(h, _MIN_THUMB_EDGE)), "white")
        canvas.paste(img, (0, 0))
        buf = io.BytesIO()
        canvas.save(buf, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:  # noqa: BLE001 —— 补边失败绝不阻断判图,原样送(大不了那批落 0)
        return data_url


async def judge_page_template(
    candidates: Sequence[Mapping[str, Any]],
) -> tuple[str, LayoutJudgeResult]:
    """单页换版式评委:浏览器把该页照片按每个候选模板渲染成真图缩略图,评委看图
    选最贴合的一张 —— 与整书排版同一套 `judge_layout_thumbnails` 逻辑,不再走线框。

    `candidates` 元素为 {templateId, thumbnail}。单候选不调评委;评委不可用
    (缺 key / 网络 / 解析失败)退化取第 0 个,不阻断换版式。"""
    if not candidates:
        raise ValueError("judge_page_template requires at least one candidate")
    template_ids = [str(c["templateId"]) for c in candidates]
    if len(candidates) == 1:
        return template_ids[0], LayoutJudgeResult(winner_index=0)
    thumbnails = [str(c["thumbnail"]) for c in candidates]
    try:
        result = await judge_layout_thumbnails(thumbnails)
    except Exception as exc:  # noqa: BLE001 — 评委不可用则退化取第 0 个,不阻断换版式
        log.warning("judge_page_template.judge_unavailable_default0", error=str(exc))
        result = LayoutJudgeResult(winner_index=0)
    return template_ids[result.winner_index], result


def _judge_thumbnails_batch_messages(
    units: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """批量判图输入:多个单元合并进一次会话(有些单元一共就两三页,逐单元开会话
    纯浪费)。每单元若干张真实渲染候选缩略图,前置「单元 u 候选 i」标记防串位。
    评委只看页面(纯视觉判断)—— chapter 概念是分簇/写文案的内部事,不进评委上下文。
    prompt 在 `judge_thumbnails.md`。"""
    payload = {
        "units": [
            {
                "unitIndex": u,
                "candidateCount": len(unit["thumbnails"]),
            }
            for u, unit in enumerate(units)
        ],
        "output": {"winners": [{"unitIndex": 0, "winnerIndex": 0}]},
    }
    content: list[dict[str, Any]] = [
        {"type": "text", "text": json.dumps(payload, ensure_ascii=False)}
    ]
    for u, unit in enumerate(units):
        for i, thumb in enumerate(unit["thumbnails"]):
            content.append({"type": "text", "text": f"单元 {u} 候选 {i}"})
            content.append({"type": "image_url", "image_url": {"url": thumb}})
    return [
        {"role": "system", "content": load_prompt(_PROMPT_DIR / "judge_thumbnails.md")},
        {"role": "user", "content": content},
    ]


async def judge_thumbnails_batch(
    units: Sequence[Mapping[str, Any]],
) -> LayoutBatchJudgeResult:
    """批量真图评委:一次会话逐单元选最佳(winners[i] 对应第 i 个输入单元)。

    units 元素为 {thumbnails: [dataUrl...]}(纯视觉,不携带章节信息)。
    首选 Gemini;Gemini 不可用(缺 key / 地区墙 400 / 超时 / 解析失败)时**保底
    fallback 到豆包**(火山 ARK vision 槽)。豆包也失败才抛,由调用方逐单元降级取 0。"""
    if not units or any(not unit["thumbnails"] for unit in units):
        raise ValueError("judge_thumbnails_batch requires units with at least one thumbnail each")

    settings = get_settings()
    # 坏缩略图(1×1)补边,否则豆包保底会整批 400。Gemini 无此限制,补了也无害。
    units = [
        {**unit, "thumbnails": [_pad_tiny_thumbnail(t) for t in unit["thumbnails"]]}
        for unit in units
    ]
    messages = _judge_thumbnails_batch_messages(units)
    counts = [len(unit["thumbnails"]) for unit in units]
    api_key = getattr(settings, "select_layout_api_key", None)

    # ① 首选 Gemini。
    if api_key:
        try:
            response = await gemini_client.generate_content(
                base_url=getattr(settings, "select_layout_base_url"),
                api_key=api_key,
                model=getattr(settings, "select_layout_model"),
                messages=messages,
                timeout_seconds=getattr(settings, "select_layout_timeout_seconds"),
                max_output_tokens=getattr(settings, "select_layout_max_output_tokens"),
                use_json_object=getattr(settings, "select_layout_use_json_object"),
                disable_thinking=getattr(settings, "select_layout_disable_thinking"),
                proxy=getattr(settings, "select_layout_proxy", None),
            )
            winners = _parse_batch_winners(
                gemini_client._native_text(response),  # noqa: SLF001 - internal parse helper
                counts,
            )
            in_tok, out_tok = gemini_client._native_usage(response)  # noqa: SLF001
            return LayoutBatchJudgeResult(
                winners=winners, call_count=1,
                model=getattr(settings, "select_layout_model"),
                input_tokens=in_tok, output_tokens=out_tok,
            )
        except Exception as exc:  # noqa: BLE001 —— Gemini 任何失败都转豆包保底
            ai_client.trace_marker("judge_thumbnails.gemini_fallback_to_ark", input=str(exc)[:200])

    # ② 保底:豆包(ARK vision)。用同一套 messages(OpenAI 兼容,豆包直接吃)。
    try:
        from .....providers import vision_provider
        slot = vision_provider.select_vision_slot(settings)
        response = await ai_client.chat_completion(
            base_url=slot.base_url,
            api_key=slot.api_key,
            model=slot.model,
            messages=messages,
            timeout_seconds=slot.timeout_seconds,
            temperature=0.2,
            max_tokens=512,
            response_format=slot.response_format,
            extra_body=slot.extra_body,
        )
        winners = _parse_batch_winners(ai_client.extract_text(response), counts)
        in_tok, out_tok = ai_client.extract_usage(response)
        return LayoutBatchJudgeResult(
            winners=winners, call_count=1, model=slot.model,
            input_tokens=in_tok, output_tokens=out_tok,
        )
    except Exception as exc:  # noqa: BLE001 —— 豆包也挂 → 让调用方逐单元降级取 0
        raise GeminiLayoutUnavailable(f"both gemini and ark judge unavailable: {exc}") from exc


async def judge_layout_thumbnails(
    thumbnails: Sequence[str],
) -> LayoutJudgeResult:
    """单单元判图:批量评委的 1 单元特例(单页换版式 judge_page_template 在用)。"""
    result = await judge_thumbnails_batch(
        [{"thumbnails": list(thumbnails)}]
    )
    return LayoutJudgeResult(
        winner_index=result.winners[0],
        call_count=result.call_count,
        model=result.model,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
    )


def _parse_batch_winners(text: str, counts: Sequence[int]) -> list[int]:
    """从评委响应解析逐单元 winnerIndex。

    宽容:按 unitIndex 对位,缺项/越界/非整数落回 0(该单元退化取候选 0,
    不拖垮整批);整体解析不出 JSON 或 winners 非列表则抛(触发上层 fallback)。"""
    parsed = ai_client.parse_json_loose(text)
    raw = parsed.get("winners") if isinstance(parsed, Mapping) else None
    if not isinstance(raw, list):
        raise ValueError("judge response missing winners[]")
    winners = [0] * len(counts)
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        u, w = item.get("unitIndex"), item.get("winnerIndex")
        if isinstance(u, bool) or not isinstance(u, int) or not (0 <= u < len(counts)):
            continue
        if isinstance(w, bool) or not isinstance(w, int):
            continue
        winners[u] = w if 0 <= w < counts[u] else 0
    return winners
