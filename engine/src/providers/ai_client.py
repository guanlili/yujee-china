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
# 每次 LLM 调用把「系统指令 + 用户上下文(base64 图片脱敏) + 模型输出」追加到文件,
# 看每步 AI 在想啥。开关:
#   * 默认:dev 常开(写 apps/agent/llm-trace.txt),生产(AGENT_ENV=production 或 Fly
#     运行时)零写入 —— 隐私 + 磁盘安全。
#   * YUJEE_LLM_TRACE=/path → 写指定路径(任何环境生效,含生产强开排障)。
#   * YUJEE_LLM_TRACE=off|0|false → 关闭(dev 临时静音的逃生阀)。
# 绝不因追踪失败影响真实调用。
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


def _extract_image_urls(messages: list[dict[str, Any]]) -> list[str]:
    """抽出发给视觉模型的图片(image_url.url，通常是 base64 data URL)，
    供本地观测台把「视觉 AI 到底收到了什么」直接渲染出来。"""
    urls: list[str] = []
    for m in messages:
        content = m.get("content")
        if not isinstance(content, list):
            continue
        for p in content:
            if isinstance(p, dict) and p.get("type") == "image_url":
                slot = p.get("image_url")
                url = slot.get("url") if isinstance(slot, dict) else None
                if isinstance(url, str) and url:
                    urls.append(url)
    return urls


# 监控默认写到这里:相对本文件定位到 apps/agent/llm-trace.txt,与启动 CWD 无关。
_DEFAULT_TRACE_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "llm-trace.txt")

# 显式关闭追踪的取值(dev 也能用它临时静音)。
_TRACE_OFF_VALUES = frozenset({"", "0", "off", "false", "no"})


def _is_production() -> bool:
    """生产判别:以 fly.toml 显式设的 AGENT_ENV=production 为准;再以 Fly 运行时变量
    (FLY_APP_NAME / FLY_MACHINE_ID)做兜底防线 —— 万一 AGENT_ENV 漏配,也绝不在线上写。"""
    if os.environ.get("AGENT_ENV", "development").strip().lower() == "production":
        return True
    if os.environ.get("FLY_APP_NAME") or os.environ.get("FLY_MACHINE_ID"):
        return True
    return False


def _trace_path() -> str | None:
    """解析本次是否写 trace、写到哪:

    - `YUJEE_LLM_TRACE=/path` → 写该路径(任何环境生效,含生产强开排障)。
    - `YUJEE_LLM_TRACE=off|0|false|no|空` → 关闭(dev 临时静音的逃生阀)。
    - 未设 → dev 默认开(写 apps/agent/llm-trace.txt),生产关。
    """
    raw = os.environ.get("YUJEE_LLM_TRACE")
    if raw is not None:
        val = raw.strip()
        if val.lower() in _TRACE_OFF_VALUES:
            return None
        return val
    return None if _is_production() else _DEFAULT_TRACE_PATH


def _jsonl_path() -> str | None:
    """结构化 trace(JSONL,含真实 token usage,给 :8787 观测台用)。
    `AI_TRACE_JSONL=/path` 覆盖;`=off` 关;未设则跟随文本 trace 目录写 ai-trace.jsonl。"""
    raw = os.environ.get("AI_TRACE_JSONL")
    if raw is not None:
        return None if raw.strip().lower() in _TRACE_OFF_VALUES else raw.strip()
    base = _trace_path()
    return os.path.join(os.path.dirname(base), "ai-trace.jsonl") if base else None


def _extract_usage(response: Any) -> tuple[int | None, int | None]:
    """从响应里取真实 (输入 token, 输出 token)。兼容 OpenAI(usage.prompt/completion_tokens)
    与 Gemini native(usageMetadata.promptTokenCount/candidatesTokenCount)。"""
    if not isinstance(response, dict):
        return None, None
    u = response.get("usage")
    if isinstance(u, dict) and u.get("prompt_tokens") is not None:
        return u.get("prompt_tokens"), u.get("completion_tokens")
    um = response.get("usageMetadata")
    if isinstance(um, dict):
        return um.get("promptTokenCount"), um.get("candidatesTokenCount")
    return None, None


def _write_jsonl(source: str, model: str, messages: list[dict[str, Any]], output: str, response: Any) -> None:
    path = _jsonl_path()
    if not path:
        return
    try:
        redacted = _redact_messages(messages)
        images = _extract_image_urls(messages)
        in_tok, out_tok = _extract_usage(response)
        rec = {
            "ts": time.time(),
            "time": time.strftime("%H:%M:%S"),
            "source": source,
            "model": model,
            "input": redacted,
            "output": output,
            "inputTokens": in_tok,
            "outputTokens": out_tok,
            "imageCount": len(images),
            # 实际发给视觉 AI 的图(base64 data URL)，本地观测台直接渲染。仅本地 dev 写盘。
            "images": images,
        }
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _trace_llm_call(model: str, messages: list[dict[str, Any]], response: dict[str, Any]) -> None:
    path = _trace_path()
    if not path:
        _write_jsonl("workflow", model, messages, "", response)
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
        _write_jsonl("workflow", model, messages, output or "", response)
    except Exception:
        pass  # 追踪绝不能弄崩真实调用


def trace_marker(title: str, *, input: str = "", output: str = "") -> None:
    """把“没有真实 LLM 输出”的关键分支也写进同一份 trace。

    用途是本地排障:例如某个 AI 环节因为缺 key / 无散落照片 / 模型失败而走了代码
    fallback。它不是业务日志,生产环境仍复用 `_trace_path()` 的关闭策略。
    """
    path = _trace_path()
    if not path:
        return
    try:
        entry = (
            "\n" + "=" * 90 + "\n"
            + f"[{time.strftime('%H:%M:%S')}] marker={title}\n"
        )
        if input:
            entry += "--- 输入 INPUT ---\n" + input + "\n"
        if output:
            entry += "--- 输出 OUTPUT ---\n" + output + "\n"
        with open(path, "a", encoding="utf-8") as f:
            f.write(entry)
    except Exception:
        pass


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
