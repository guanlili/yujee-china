"""Stage2 排版选模板评委(LLM 调用层)。

代码确定性地随机生成 N 个整章候选(候选目录构造 + 合法化夹紧在 `layout/legalize.py`),
把【照片信息 + 候选方案 + 照片/模板预览图】发给评委,让模型选出最佳候选 index。
生产走豆包(`judge_layout_doubao`),prompt 在 `judge_layout.md`。
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import httpx

from .....providers import ai_client
from .....providers.vision_provider import VisionSlotError, ark_vision_slot
from .. import template_previews, templates
from ..legalize import (
    _photo_id,
    _photo_ref,
    _photos,
)
from ..simple_id import to_simple
from .....logging_config import get_logger
from .....settings import get_settings
from .....skills import load_prompt
from .schema import GeminiLayoutUnavailable, LayoutJudgeResult

log = get_logger("select_layout")

_PROMPT_DIR = Path(__file__).resolve().parent
_DATA_URL_RE = re.compile(r"^data:(?P<mime>[-\w.+/]+);base64,(?P<data>.+)$", re.DOTALL)


def _get(obj: Mapping[str, Any] | Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _native_base_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/openai"):
        return base[: -len("/openai")]
    return base


def _native_model_path(model: str) -> str:
    return model.removeprefix("models/")


def _native_part(part: dict[str, Any]) -> dict[str, Any] | None:
    if part.get("type") == "text":
        return {"text": str(part.get("text") or "")}
    if part.get("type") != "image_url":
        return None

    image_url = part.get("image_url")
    url = image_url.get("url") if isinstance(image_url, Mapping) else None
    if not isinstance(url, str):
        return None
    match = _DATA_URL_RE.match(url)
    if not match:
        raise ValueError("Gemini native select-layout only accepts data-url images")
    return {
        "inline_data": {
            "mime_type": match.group("mime"),
            "data": match.group("data"),
        }
    }


def _native_payload(
    messages: list[dict[str, Any]],
    *,
    max_output_tokens: int | None,
    use_json_object: bool,
    disable_thinking: bool,
) -> dict[str, Any]:
    system = str(messages[0].get("content") or "")
    content = messages[1].get("content")
    if isinstance(content, str):
        parts = [{"text": content}]
    else:
        parts = [
            native
            for item in (content or [])
            if isinstance(item, dict)
            for native in [_native_part(item)]
            if native is not None
        ]

    generation_config: dict[str, Any] = {"temperature": 0.1}
    if use_json_object:
        generation_config["response_mime_type"] = "application/json"
    if max_output_tokens is not None:
        generation_config["maxOutputTokens"] = max_output_tokens
    if disable_thinking:
        generation_config["thinkingConfig"] = {"thinkingBudget": 0}

    return {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": generation_config,
    }


def _native_text(response: Mapping[str, Any]) -> str:
    candidates = response.get("candidates") or []
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("Gemini native response missing candidates[]")
    content = candidates[0].get("content") if isinstance(candidates[0], Mapping) else None
    parts = content.get("parts") if isinstance(content, Mapping) else None
    if not isinstance(parts, list):
        raise ValueError("Gemini native response missing content.parts[]")
    text = "\n".join(
        str(part.get("text"))
        for part in parts
        if isinstance(part, Mapping) and isinstance(part.get("text"), str)
    ).strip()
    if not text:
        raise ValueError("Gemini native response missing text")
    return text


def _native_usage(response: Mapping[str, Any]) -> tuple[int, int]:
    usage = response.get("usageMetadata") if isinstance(response, Mapping) else None
    if not isinstance(usage, Mapping):
        return 0, 0
    input_tokens = usage.get("promptTokenCount")
    output_tokens = usage.get("candidatesTokenCount")
    return (
        input_tokens if isinstance(input_tokens, int) else 0,
        output_tokens if isinstance(output_tokens, int) else 0,
    )


def _trace_native_call(
    model: str,
    messages: list[dict[str, Any]],
    response: Mapping[str, Any],
) -> None:
    try:
        ai_client._trace_llm_call(  # noqa: SLF001 - reuse the shared redaction path.
            model,
            messages,
            {"choices": [{"message": {"content": _native_text(response)}}]},
        )
    except Exception:
        pass


def _gemini_client_kwargs(proxy_setting: str | None, timeout_seconds: int) -> dict[str, Any]:
    """Gemini httpx client 的网络出口参数。

    未设 → 沿用环境代理(trust_env 默认);"direct" → 强制直连、忽略环境代理
    (本机可直达 Gemini、但 shell 全局代理出口被地区墙拒时用);其他 → 显式代理 URL。"""
    kwargs: dict[str, Any] = {"timeout": timeout_seconds}
    proxy = (proxy_setting or "").strip()
    if proxy.lower() == "direct":
        kwargs["trust_env"] = False
    elif proxy:
        kwargs["proxy"] = proxy
        kwargs["trust_env"] = False
    return kwargs


async def _native_generate_content(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    timeout_seconds: int,
    max_output_tokens: int | None,
    use_json_object: bool,
    disable_thinking: bool,
    proxy: str | None = None,
) -> dict[str, Any]:
    url = f"{_native_base_url(base_url)}/models/{_native_model_path(model)}:generateContent"
    body = _native_payload(
        messages,
        max_output_tokens=max_output_tokens,
        use_json_object=use_json_object,
        disable_thinking=disable_thinking,
    )
    headers = {"Content-Type": "application/json"}

    last_error = ""
    last_status_code: int | None = None
    last_kind: ai_client.AIErrorKind | None = None
    client_kwargs = _gemini_client_kwargs(proxy, timeout_seconds)
    for attempt in (1, 2):
        try:
            async with httpx.AsyncClient(**client_kwargs) as client:
                resp = await client.post(
                    url,
                    params={"key": api_key},
                    json=body,
                    headers=headers,
                )
            if resp.status_code >= 500:
                last_error = f"upstream_5xx status={resp.status_code}"
                last_status_code = resp.status_code
                last_kind = "5xx"
                log.warning(
                    "gemini_native.upstream_5xx",
                    model=model,
                    status=resp.status_code,
                    attempt=attempt,
                    body=resp.text[:400],
                )
            elif resp.status_code >= 400:
                log.warning(
                    "gemini_native.upstream_4xx",
                    model=model,
                    status=resp.status_code,
                    attempt=attempt,
                    body=resp.text[:400],
                )
                raise ai_client.AIRequestError(
                    f"upstream_4xx status={resp.status_code} body_len={len(resp.text)}",
                    status_code=resp.status_code,
                    kind="4xx",
                )
            else:
                data = resp.json()
                _trace_native_call(model, messages, data)
                return data
        except httpx.TimeoutException as exc:
            last_error = f"transport={type(exc).__name__}"
            last_status_code = None
            last_kind = "timeout"
            log.warning(
                "gemini_native.transport_error",
                model=model,
                attempt=attempt,
                error=type(exc).__name__,
            )
        except httpx.HTTPError as exc:
            last_error = f"transport={type(exc).__name__}"
            last_status_code = None
            last_kind = "transport"
            log.warning(
                "gemini_native.transport_error",
                model=model,
                attempt=attempt,
                error=type(exc).__name__,
            )

    raise ai_client.AIRequestError(
        f"model {model} failed after retry: {last_error}",
        status_code=last_status_code,
        kind=last_kind,
    )


def _judge_messages(
    chapter: Any,
    candidates: Sequence[Sequence[Mapping[str, Any]]],
    id_map: dict[str, str],
) -> list[dict[str, Any]]:
    """评委输入:候选结构(simple id)+ 照片元信息 + 照片预览 + 模板线框图。"""
    real_to_simple = {real: simple for simple, real in id_map.items()}

    photos_payload: list[dict[str, Any]] = []
    for photo in _photos(chapter):
        pid = _photo_id(photo)
        photos_payload.append(
            {
                "photoId": real_to_simple.get(pid, pid),
                "orientation": _get(photo, "orientation"),
                "composition": _get(photo, "composition"),
            }
        )

    candidates_payload: list[dict[str, Any]] = []
    used_template_ids: list[str] = []
    for index, pages in enumerate(candidates):
        cand_pages: list[dict[str, Any]] = []
        for page in pages:
            template_id = page.get("templateId")
            if isinstance(template_id, str) and template_id not in used_template_ids:
                used_template_ids.append(template_id)
            simple_slots = {
                slot_id: real_to_simple.get(photo_id, photo_id)
                for slot_id, photo_id in (page.get("images") or {}).items()
            }
            cand_pages.append({"templateId": template_id, "slots": simple_slots})
        candidates_payload.append({"index": index, "pages": cand_pages})

    text_payload = {
        # 章节背景(内容采集答案):评委据此在候选里选更贴合基调的版式。空串=用户跳过采访。
        "chapterContext": _get(chapter, "chapterContext", "") or "",
        "photos": photos_payload,
        "candidates": candidates_payload,
        "output": {"winnerIndex": 0},
    }
    content: list[dict[str, Any]] = [
        {"type": "text", "text": json.dumps(text_payload, ensure_ascii=False)}
    ]
    for photo in _photos(chapter):
        ref = _photo_ref(photo)
        if ref:
            content.append({"type": "image_url", "image_url": {"url": ref}})
    previews = template_previews.load_template_previews()
    for template_id in used_template_ids:
        preview = previews.by_template.get(template_id)
        if preview is not None and preview.previewImage:
            content.append({"type": "image_url", "image_url": {"url": preview.previewImage}})

    return [
        {"role": "system", "content": load_prompt(_PROMPT_DIR / "judge_layout.md")},
        {"role": "user", "content": content},
    ]


async def judge_layout(
    chapter: Any,
    candidates: Sequence[Sequence[Mapping[str, Any]]],
) -> LayoutJudgeResult:
    """让 Gemini 从 N 个代码随机候选里选最佳。返回 winner_index(已夹紧到合法范围)。"""
    if not candidates:
        raise ValueError("judge_layout requires at least one candidate")

    settings = get_settings()
    api_key = getattr(settings, "select_layout_api_key", None)
    if not api_key:
        raise GeminiLayoutUnavailable("SELECT_LAYOUT_API_KEY missing")

    photo_ids = [_photo_id(photo) for photo in _photos(chapter)]
    _, id_map = to_simple(photo_ids)
    messages = _judge_messages(chapter, candidates, id_map)
    response = await _native_generate_content(
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
    parsed = ai_client.parse_json_loose(_native_text(response))
    raw_index = parsed.get("winnerIndex") if isinstance(parsed, Mapping) else None
    if isinstance(raw_index, bool) or not isinstance(raw_index, int):
        raise ValueError("Gemini judge response missing integer winnerIndex")
    # 夹紧到合法范围(模型若越界则退化为第 0 个候选)。
    winner = raw_index if 0 <= raw_index < len(candidates) else 0
    input_tokens, output_tokens = _native_usage(response)
    return LayoutJudgeResult(
        winner_index=winner,
        call_count=1,
        model=getattr(settings, "select_layout_model"),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


_JUDGE_DOUBAO_MAX_OUTPUT_TOKENS = 200


async def judge_layout_doubao(
    chapter: Any,
    candidates: Sequence[Sequence[Mapping[str, Any]]],
) -> LayoutJudgeResult:
    """豆包(火山 Ark)版排版评委:gemini 在国内地区墙 400 时的替代,不是兜底 ——
    直接顶替 gemini 做『选择』这一步。豆包是 OpenAI 兼容协议,`_judge_messages`
    产出的 OpenAI 风格 messages 可以原样喂给它,不需要 gemini 那层 native 转换。
    返回 winner_index 已夹紧到合法范围。"""
    if not candidates:
        raise ValueError("judge_layout_doubao requires at least one candidate")

    slot = ark_vision_slot(get_settings())  # 缺 ARK_API_KEY 时抛 VisionSlotError

    photo_ids = [_photo_id(photo) for photo in _photos(chapter)]
    _, id_map = to_simple(photo_ids)
    messages = _judge_messages(chapter, candidates, id_map)
    response = await ai_client.chat_completion(
        base_url=slot.base_url,
        api_key=slot.api_key,
        model=slot.model,
        messages=messages,
        timeout_seconds=slot.timeout_seconds,
        temperature=0.2,
        max_tokens=_JUDGE_DOUBAO_MAX_OUTPUT_TOKENS,
        response_format=slot.response_format,
        extra_body=slot.extra_body,
    )
    input_tokens, output_tokens = ai_client.extract_usage(response)
    parsed = ai_client.parse_json_loose(ai_client.extract_text(response))
    raw_index = parsed.get("winnerIndex") if isinstance(parsed, Mapping) else None
    if isinstance(raw_index, bool) or not isinstance(raw_index, int):
        raise ValueError("doubao judge response missing integer winnerIndex")
    # 夹紧到合法范围(模型若越界则退化为最后一个候选,而非第 0 个 —— 与
    # `_parse_winner`/`judge_layout` 的越界=0 语义不同,按需求文档明确要求 clamp 到边界)。
    winner = max(0, min(raw_index, len(candidates) - 1))
    return LayoutJudgeResult(
        winner_index=winner,
        call_count=1,
        model=slot.model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


async def judge_page_template(
    photos: Sequence[Mapping[str, Any]],
    candidate_template_ids: Sequence[str],
) -> tuple[str, LayoutJudgeResult]:
    """单页 relayout 评委:给该页照片(带 ref200px)+ N 个候选模板(同图槽数),
    视觉评委选最合适的模板 id。复用整章判图:合成「单页 chapter + 每候选一页 candidates」,
    先 gemini,失败保底豆包;两者都不可用则退化为第 0 个候选(不阻断)。"""
    if not candidate_template_ids:
        raise ValueError("judge_page_template requires at least one candidate template")
    chapter = {"chapterContext": "", "photos": list(photos)}
    photo_ids = [_photo_id(photo) for photo in photos]
    candidates: list[list[dict[str, Any]]] = []
    for template_id in candidate_template_ids:
        template = templates.get(template_id)
        if template is None:
            raise ValueError(f"unknown candidate template: {template_id}")
        slot_ids = templates.image_slot_ids(template)
        candidates.append([{"templateId": template_id, "images": dict(zip(slot_ids, photo_ids, strict=False))}])

    try:
        result = await judge_layout(chapter, candidates)
    except Exception as exc:  # noqa: BLE001 — gemini 缺 key/地区墙/超时/解析失败都保底豆包
        log.info("judge_page_template.gemini_fallback_doubao", error=str(exc))
        try:
            result = await judge_layout_doubao(chapter, candidates)
        except Exception as exc2:  # noqa: BLE001 — 豆包也不可用则退化取第 0 个,不阻断 relayout
            log.warning("judge_page_template.both_unavailable_default0", error=str(exc2))
            result = LayoutJudgeResult(winner_index=0)
    return candidate_template_ids[result.winner_index], result


def _judge_thumbnail_messages(
    thumbnails: Sequence[str], *, chapter_context: str = ""
) -> list[dict[str, Any]]:
    """P2 评委输入:N 张真实渲染缩略图(每候选一张,前置「候选 i」文本标记防串位),
    加 chapterContext 供贴合基调。模型直接看图选最佳。prompt 在 `judge_thumbnails.md`。"""
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": json.dumps(
                {
                    "chapterContext": chapter_context or "",
                    "candidateCount": len(thumbnails),
                    "output": {"winnerIndex": 0},
                },
                ensure_ascii=False,
            ),
        }
    ]
    for i, thumb in enumerate(thumbnails):
        content.append({"type": "text", "text": f"候选 {i}"})
        content.append({"type": "image_url", "image_url": {"url": thumb}})
    return [
        {"role": "system", "content": load_prompt(_PROMPT_DIR / "judge_thumbnails.md")},
        {"role": "user", "content": content},
    ]


async def judge_layout_thumbnails(
    thumbnails: Sequence[str], *, chapter_context: str = ""
) -> LayoutJudgeResult:
    """P2 评委:每候选一张真实渲染缩略图,选最佳 index(夹紧到合法范围)。

    首选 Gemini;Gemini 不可用(缺 key / 地区墙 400 / 超时 / 解析失败)时**保底 fallback 到豆包**
    (火山 ARK vision 槽)—— 比降级取候选0(随机)好得多。豆包也失败才让调用方降级取 0。"""
    if not thumbnails:
        raise ValueError("judge_layout_thumbnails requires at least one thumbnail")

    settings = get_settings()
    messages = _judge_thumbnail_messages(thumbnails, chapter_context=chapter_context)
    api_key = getattr(settings, "select_layout_api_key", None)

    # ① 首选 Gemini。
    if api_key:
        try:
            response = await _native_generate_content(
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
            winner = _parse_winner(_native_text(response), len(thumbnails))
            in_tok, out_tok = _native_usage(response)
            return LayoutJudgeResult(
                winner_index=winner, call_count=1,
                model=getattr(settings, "select_layout_model"),
                input_tokens=in_tok, output_tokens=out_tok,
            )
        except Exception as exc:  # noqa: BLE001 —— Gemini 任何失败都转豆包保底
            ai_client.trace_marker("judge_thumbnails.gemini_fallback_to_ark", input=str(exc)[:200])

    # ② 保底:豆包(ARK vision)。用同一套缩略图 messages(OpenAI 兼容,豆包直接吃)。
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
            max_tokens=256,
            response_format=slot.response_format,
            extra_body=slot.extra_body,
        )
        winner = _parse_winner(ai_client.extract_text(response), len(thumbnails))
        in_tok, out_tok = ai_client.extract_usage(response)
        return LayoutJudgeResult(
            winner_index=winner, call_count=1, model=slot.model,
            input_tokens=in_tok, output_tokens=out_tok,
        )
    except Exception as exc:  # noqa: BLE001 —— 豆包也挂 → 让调用方降级取候选0
        raise GeminiLayoutUnavailable(f"both gemini and ark judge unavailable: {exc}") from exc


def _parse_winner(text: str, count: int) -> int:
    """从评委响应解析 winnerIndex,夹紧到 [0, count)。解析不出整数则抛(触发上层 fallback/降级)。"""
    parsed = ai_client.parse_json_loose(text)
    raw = parsed.get("winnerIndex") if isinstance(parsed, Mapping) else None
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise ValueError("judge response missing integer winnerIndex")
    return raw if 0 <= raw < count else 0
