"""Gemini 原生(non-OpenAI-compatible)带图客户端。

仓里唯一能带图调 Gemini generateContent 的客户端。原住在
`workflows/core/layout/select_layout/handler.py`,该文件后续会整体删除,
先把这段搬到共享位置供其它调用点复用。
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

import httpx

from . import ai_client
from ..logging_config import get_logger

log = get_logger("gemini_client")

_DATA_URL_RE = re.compile(r"^data:(?P<mime>[-\w.+/]+);base64,(?P<data>.+)$", re.DOTALL)


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
    """把这次 Gemini native 调用写进统一 trace。

    重点是【必须把 usageMetadata 原样带上】。这里原本只把响应重包成
    {"choices":[{"message":{"content": ...}}]},usageMetadata 整个丢掉 ——
    于是 ai_client 取不到 token,select-layout(每次生成都跑、带全部照片的那次调用)
    的成本一路是 null,在观测台上等于【不花钱】。
    """
    try:
        envelope: dict[str, Any] = {
            "choices": [{"message": {"content": _native_text(response)}}]
        }
        usage = response.get("usageMetadata")
        if usage is not None:
            envelope["usageMetadata"] = usage
        ai_client._trace_llm_call(  # noqa: SLF001 - reuse the shared redaction path.
            model,
            messages,
            envelope,
        )
    except Exception:
        pass


def client_kwargs(proxy_setting: str | None, timeout_seconds: int) -> dict[str, Any]:
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


async def generate_content(
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
    kwargs = client_kwargs(proxy, timeout_seconds)
    for attempt in (1, 2):
        try:
            async with httpx.AsyncClient(**kwargs) as client:
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
