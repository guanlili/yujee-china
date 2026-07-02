"""Gemini-assisted Stage2 layout selection (LLM 调用层)。

把【已分组章节的照片信息 + 合法模板候选目录 + 照片/模板预览图】发给 Gemini,
让模型每页选一个模板并把照片映射到图槽,返回原始 pages。确定性的候选目录构造与
合法化夹紧在 `engine/legalize.py`;prompt 在 `select_layout.md`。
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import httpx

from ... import ai_client
from ...engine import skeleton_v3, template_previews
from ...engine.legalize import (
    _chapter_id,
    _photo_id,
    _photo_ref,
    _photos,
    build_candidate_catalog,
)
from ...engine.simple_id import from_simple_at_paths, to_simple
from ...logging_config import get_logger
from ...settings import get_settings
from ...skills import load_prompt
from .schema import GeminiLayoutResult, GeminiLayoutUnavailable, LayoutJudgeResult

log = get_logger("select_layout")

_PROMPT_DIR = Path(__file__).resolve().parent
_DATA_URL_RE = re.compile(r"^data:(?P<mime>[-\w.+/]+);base64,(?P<data>.+)$", re.DOTALL)


def _get(obj: Mapping[str, Any] | Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _unit_payload(chapter: Any, id_map: dict[str, str]) -> dict[str, Any]:
    photos: list[dict[str, Any]] = []
    for photo in _photos(chapter):
        pid = _photo_id(photo)
        simple = next(k for k, v in id_map.items() if v == pid)
        photos.append(
            {
                "photoId": simple,
                "orientation": _get(photo, "orientation"),
                "takenAt": _get(photo, "takenAt"),
            }
        )
    return {
        "chapterId": _chapter_id(chapter),
        "structureHint": _get(chapter, "structureHint", None),
        # 章节背景(内容采集答案):评委据此选更贴合的版式。空串=用户跳过采访。
        "chapterContext": _get(chapter, "chapterContext", "") or "",
        "photos": photos,
        "candidates": [
            {key: value for key, value in candidate.items() if key != "previewImage"}
            for candidate in build_candidate_catalog("interior", len(photos))
        ],
    }


def _messages(chapters: Sequence[Any], id_map: dict[str, str]) -> list[dict[str, Any]]:
    text_payload = {
        "mode": "select",
        "allowAddPages": True,
        "units": [_unit_payload(chapter, id_map) for chapter in chapters],
        "output": {
            "pages": [
                {
                    "chapterId": "chapter id",
                    "templateId": "one candidate templateId",
                    "slots": {"slotId": "simple photoId"},
                }
            ]
        },
    }
    content: list[dict[str, Any]] = [
        {"type": "text", "text": json.dumps(text_payload, ensure_ascii=False)}
    ]
    previews = template_previews.load_template_previews()
    for chapter in chapters:
        for photo in _photos(chapter):
            ref = _photo_ref(photo)
            if ref:
                content.append({"type": "image_url", "image_url": {"url": ref}})
        cap = min(len(_photos(chapter)), skeleton_v3.max_capacity("interior"))
        for capacity in range(1, cap + 1):
            image = previews.bucket_images.get(("interior", capacity))
            if image:
                content.append({"type": "image_url", "image_url": {"url": image}})

    return [
        {"role": "system", "content": load_prompt(_PROMPT_DIR / "select_layout.md")},
        {"role": "user", "content": content},
    ]


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
    for attempt in (1, 2):
        try:
            async with httpx.AsyncClient(timeout=timeout_seconds) as client:
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


def _judge_thumbnail_messages(thumbnails: Sequence[str]) -> list[dict[str, Any]]:
    """P2 评委输入:N 张真实渲染缩略图(每候选一张)。模型只看图选最佳,无需结构文字。"""
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": json.dumps(
                {
                    "candidates": [{"index": i} for i in range(len(thumbnails))],
                    "output": {"winnerIndex": 0},
                },
                ensure_ascii=False,
            ),
        }
    ]
    for thumb in thumbnails:
        content.append({"type": "image_url", "image_url": {"url": thumb}})
    return [
        {"role": "system", "content": load_prompt(_PROMPT_DIR / "judge_layout.md")},
        {"role": "user", "content": content},
    ]


async def judge_layout_thumbnails(thumbnails: Sequence[str]) -> LayoutJudgeResult:
    """P2 评委:每候选一张真实渲染缩略图,选最佳 index(夹紧到合法范围)。

    首选 Gemini;Gemini 不可用(缺 key / 地区墙 400 / 超时 / 解析失败)时**保底 fallback 到豆包**
    (火山 ARK vision 槽)—— 比降级取候选0(随机)好得多。豆包也失败才让调用方降级取 0。"""
    if not thumbnails:
        raise ValueError("judge_layout_thumbnails requires at least one thumbnail")

    settings = get_settings()
    messages = _judge_thumbnail_messages(thumbnails)
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
        from ... import vision_provider
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


async def gemini_layout(
    chapters: Sequence[Mapping[str, Any] | Any],
    *,
    mode: str = "select",
    allowAddPages: bool = True,
) -> GeminiLayoutResult:
    if mode not in {"select", "case4-swap"} or not allowAddPages:
        raise ValueError("gemini_layout expects mode='select' or 'case4-swap' and allowAddPages=True")

    settings = get_settings()
    api_key = getattr(settings, "select_layout_api_key", None)
    if not api_key:
        raise GeminiLayoutUnavailable("SELECT_LAYOUT_API_KEY missing")

    photo_ids = [_photo_id(photo) for chapter in chapters for photo in _photos(chapter)]
    _, id_map = to_simple(photo_ids)
    messages = _messages(chapters, id_map)
    response = await _native_generate_content(
        base_url=getattr(settings, "select_layout_base_url"),
        api_key=api_key,
        model=getattr(settings, "select_layout_model"),
        messages=messages,
        timeout_seconds=getattr(settings, "select_layout_timeout_seconds"),
        max_output_tokens=getattr(settings, "select_layout_max_output_tokens"),
        use_json_object=getattr(settings, "select_layout_use_json_object"),
        disable_thinking=getattr(settings, "select_layout_disable_thinking"),
    )
    raw_text = _native_text(response)
    parsed = ai_client.parse_json_loose(raw_text)
    pages = parsed.get("pages") if isinstance(parsed, Mapping) else None
    if not isinstance(pages, list):
        raise ValueError("Gemini layout response missing pages[]")
    real_pages = from_simple_at_paths(
        pages,
        id_map,
        value_paths=(("*", "slots", "*"),),
    )
    input_tokens, output_tokens = _native_usage(response)
    return GeminiLayoutResult(
        pages=[page for page in real_pages if isinstance(page, dict)],
        call_count=1,
        model=getattr(settings, "select_layout_model"),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )
