"""Thin OpenAI-compatible /chat/completions HTTP helper used by both
vision (Volcano Ark doubao) and planning (DeepSeek). One retry on network /
non-2xx; the caller does any JSON-parse retry / repair separately so failures
stay attributable to the right pipeline stage."""

import json
import os
import re
import time
from typing import Any, Literal

import httpx

from ..logging_config import get_logger

log = get_logger("ai_client")


# ── LLM 调用追踪(调试用)──────────────────────────────────────────────────
# 设环境变量 YUJEE_LLM_TRACE=/path/to/trace.txt 开启:每次 LLM 调用把
# 「系统指令 + 用户上下文(base64 图片脱敏) + 模型输出」追加到该文件,看每步 AI 在想啥。
# 不设则零开销。绝不因追踪失败影响真实调用。
def _redact_messages(messages: list[dict[str, Any]]) -> str:
    out: list[str] = []
    for m in messages:
        role = str(m.get("role", "?")).upper()
        content = m.get("content")
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            parts: list[str] = []
            for p in content:
                if isinstance(p, dict) and p.get("type") == "image_url":
                    parts.append("[图片已脱敏]")
                elif isinstance(p, dict) and p.get("type") == "text":
                    parts.append(str(p.get("text", "")))
                else:
                    parts.append(str(p)[:200])
            text = "\n".join(parts)
        else:
            text = str(content)
        out.append(f"--- {role} ---\n{text}")
    return "\n".join(out)


def _trace_llm_call(model: str, messages: list[dict[str, Any]], response: dict[str, Any]) -> None:
    path = os.environ.get("YUJEE_LLM_TRACE")
    if not path:
        return
    try:
        try:
            msg = response["choices"][0]["message"]
            output = msg.get("content") or json.dumps(msg, ensure_ascii=False)
        except Exception:
            output = json.dumps(response, ensure_ascii=False)[:4000]
        entry = (
            "\n" + "=" * 90 + "\n"
            + f"[{time.strftime('%H:%M:%S')}] model={model}\n"
            + _redact_messages(messages) + "\n"
            + "--- 输出 OUTPUT ---\n" + (output or "") + "\n"
        )
        with open(path, "a", encoding="utf-8") as f:
            f.write(entry)
    except Exception:
        pass  # 追踪绝不能弄崩真实调用


AIErrorKind = Literal["4xx", "5xx", "timeout", "transport"]


class AIRequestError(Exception):
    """Raised when the upstream model HTTP call fails after the network retry."""

    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        kind: AIErrorKind | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.kind = kind

    @property
    def failover_eligible(self) -> bool:
        # transport errors (connection drop / RemoteProtocolError — e.g. OpenAI
        # unreachable from CN) are exactly when failing over to the other provider
        # helps; only 4xx (request/config error, same on both) stays non-eligible.
        return self.kind in {"5xx", "timeout", "transport"}


_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


def parse_json_loose(raw: str) -> Any:
    """Tolerant JSON parser. Strips markdown code fences and falls back to the
    first balanced {…} or […] in the text — common with chat models that wrap
    their JSON in prose despite a strict prompt."""
    if not raw:
        raise ValueError("empty model response")
    text = raw.strip()

    fence = _JSON_FENCE_RE.search(text)
    if fence:
        text = fence.group(1).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        end = text.rfind(closer)
        if 0 <= start < end:
            chunk = text[start : end + 1]
            try:
                return json.loads(chunk)
            except json.JSONDecodeError:
                continue
    raise ValueError("model response did not contain valid JSON")


async def chat_completion(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    timeout_seconds: int,
    response_format: dict[str, Any] | None = None,
    max_tokens: int | None = None,
    temperature: float = 0.3,
    extra_body: dict[str, Any] | None = None,
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str | dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Call an OpenAI-compatible /chat/completions endpoint. Returns the parsed
    response envelope. One retry on transport error or 5xx; raises
    AIRequestError if both attempts fail.

    `tools` / `tool_choice` (OpenAI function-calling) are forwarded into the POST
    body only when supplied — existing callers that omit them get the exact same
    request as before. Parse any returned tool_calls with `extract_tool_calls`;
    `parse_json_loose` stays the escape hatch for the JSON-content path."""

    url = f"{base_url.rstrip('/')}/chat/completions"
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "stream": False,
    }
    if response_format is not None:
        body["response_format"] = response_format
    if max_tokens is not None:
        body["max_tokens"] = max_tokens
    if tools is not None:
        body["tools"] = tools
    if tool_choice is not None:
        body["tool_choice"] = tool_choice
    if extra_body:
        body.update(extra_body)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    last_error: str = ""
    last_status_code: int | None = None
    last_kind: AIErrorKind | None = None
    for attempt in (1, 2):
        try:
            async with httpx.AsyncClient(timeout=timeout_seconds) as client:
                resp = await client.post(url, json=body, headers=headers)
            if resp.status_code >= 500:
                last_error = f"upstream_5xx status={resp.status_code}"
                last_status_code = resp.status_code
                last_kind = "5xx"
                log.warning("ai.upstream_5xx", model=model, status=resp.status_code, attempt=attempt)
            elif resp.status_code >= 400:
                log.warning("ai.upstream_4xx", model=model, status=resp.status_code, attempt=attempt, body=resp.text[:400])
                raise AIRequestError(
                    f"upstream_4xx status={resp.status_code} body_len={len(resp.text)}",
                    status_code=resp.status_code,
                    kind="4xx",
                )
            else:
                data = resp.json()
                _trace_llm_call(model, messages, data)
                return data
        except httpx.TimeoutException as exc:
            last_error = f"transport={type(exc).__name__}"
            last_status_code = None
            last_kind = "timeout"
            log.warning("ai.transport_error", model=model, attempt=attempt, error=type(exc).__name__)
        except httpx.HTTPError as exc:
            last_error = f"transport={type(exc).__name__}"
            last_status_code = None
            last_kind = "transport"
            log.warning("ai.transport_error", model=model, attempt=attempt, error=type(exc).__name__)
    raise AIRequestError(
        f"model {model} failed after retry: {last_error}",
        status_code=last_status_code,
        kind=last_kind,
    )


def extract_text(response: dict[str, Any]) -> str:
    """Pull the first choice's message content out of an OpenAI-compatible
    response envelope. Raises ValueError if absent."""
    choices = response.get("choices") or []
    if not choices:
        raise ValueError("model response missing choices[]")
    content = (choices[0].get("message") or {}).get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("model response missing message.content")
    return content


def extract_text_optional(response: dict[str, Any]) -> str:
    """Like `extract_text` but returns "" instead of raising when the first
    choice carries no text content — the normal case on a function-calling turn
    where the model answers with tool_calls and `message.content` is null."""
    choices = response.get("choices") or []
    if not choices:
        return ""
    content = (choices[0].get("message") or {}).get("content")
    return content.strip() if isinstance(content, str) else ""


def extract_tool_calls(response: dict[str, Any]) -> list[dict[str, Any]]:
    """Pull the first choice's `tool_calls` out of an OpenAI-compatible response.
    Returns [] when the model answered with plain text (no tool call). Each entry
    is the raw OpenAI tool_call dict: {id, type:'function', function:{name,arguments}}
    where `arguments` is a JSON STRING the caller parses (loosely)."""
    choices = response.get("choices") or []
    if not choices:
        return []
    tool_calls = (choices[0].get("message") or {}).get("tool_calls")
    if not isinstance(tool_calls, list):
        return []
    return [tc for tc in tool_calls if isinstance(tc, dict)]


def extract_usage(response: dict[str, Any]) -> tuple[int, int]:
    """Returns (prompt_tokens, completion_tokens). Missing fields → 0."""
    usage = response.get("usage") or {}
    return int(usage.get("prompt_tokens", 0) or 0), int(usage.get("completion_tokens", 0) or 0)
