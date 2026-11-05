"""gemini_client.generate_content 的重试 / 错误路径补测。

被测实现(engine/src/providers/gemini_client.py L202-264):
- 循环 `for attempt in (1, 2)` —— 总共最多 2 次请求;
- 5xx:记录 kind="5xx" 后落到下一次 attempt,2 次都 5xx 才抛;
- httpx.TimeoutException:kind="timeout",同样重试;
- 4xx:**当场** raise AIRequestError(kind="4xx"),不重试;
- 成功:返回 resp.json()。

这里用假 AsyncClient 钉住「重试几次 / 错误分类」,不发真实网络。
"""

from collections.abc import Callable

import httpx
import pytest

from src.providers import gemini_client
from src.providers.ai_client import AIRequestError


class FakeResponse:
    """只补 generate_content 用到的三个成员:status_code / text / json()。"""

    def __init__(self, status_code: int, json_data: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self._json = json_data or {}
        self.text = text

    def json(self) -> dict:
        return self._json


class FakeAsyncClient:
    """复刻 `async with httpx.AsyncClient() as c: await c.post(...)` 的形状。"""

    posts: list[tuple[str, dict]] = []

    def __init__(self, handler: Callable[[str, dict], object]) -> None:
        self._handler = handler

    async def __aenter__(self) -> "FakeAsyncClient":
        return self

    async def __aexit__(self, *_args: object) -> bool:
        return False

    async def post(self, url: str, **kwargs: object) -> object:
        # 每次 attempt 都新建一个 client,把调用次数汇到共享列表里。
        FakeAsyncClient.posts.append((url, kwargs))
        return self._handler(url, kwargs)


def _install_fake_client(monkeypatch: pytest.MonkeyPatch, behaviors: list[object]) -> None:
    """按序消费 behaviors:每个元素是 FakeResponse 或一个要 raise 的 Exception。"""
    calls = {"n": 0}

    def handler(_url: str, _kwargs: dict) -> object:
        b = behaviors[min(calls["n"], len(behaviors) - 1)]
        calls["n"] += 1
        if isinstance(b, Exception):
            raise b
        return b

    FakeAsyncClient.posts = []
    monkeypatch.setattr(gemini_client.httpx, "AsyncClient", lambda **_kw: FakeAsyncClient(handler))


def _messages() -> list[dict]:
    return [
        {"role": "system", "content": "be terse"},
        {"role": "user", "content": "hi"},
    ]


@pytest.mark.asyncio
async def test_5xx_twice_retries_then_raises_5xx(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_client(
        monkeypatch,
        [FakeResponse(500, text="boom"), FakeResponse(502, text="boom again")],
    )
    with pytest.raises(AIRequestError) as exc_info:
        await gemini_client.generate_content(
            base_url="https://generativelanguage.googleapis.com",
            api_key="k",
            model="gemini-2.5-flash",
            messages=_messages(),
            timeout_seconds=30,
            max_output_tokens=None,
            use_json_object=False,
            disable_thinking=False,
        )
    err = exc_info.value
    assert err.kind == "5xx"
    # 两次 attempt 都发了请求,且都打到 generateContent 端点。
    assert len(FakeAsyncClient.posts) == 2
    assert ":generateContent" in FakeAsyncClient.posts[0][0]


@pytest.mark.asyncio
async def test_timeout_retries_then_raises_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    timeout = httpx.TimeoutException("read timed out")
    _install_fake_client(monkeypatch, [timeout, timeout])
    with pytest.raises(AIRequestError) as exc_info:
        await gemini_client.generate_content(
            base_url="https://generativelanguage.googleapis.com",
            api_key="k",
            model="gemini-2.5-flash",
            messages=_messages(),
            timeout_seconds=30,
            max_output_tokens=None,
            use_json_object=False,
            disable_thinking=False,
        )
    assert exc_info.value.kind == "timeout"
    assert len(FakeAsyncClient.posts) == 2


@pytest.mark.asyncio
async def test_4xx_raises_immediately_without_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_client(monkeypatch, [FakeResponse(400, text="bad request")])
    with pytest.raises(AIRequestError) as exc_info:
        await gemini_client.generate_content(
            base_url="https://generativelanguage.googleapis.com",
            api_key="k",
            model="gemini-2.5-flash",
            messages=_messages(),
            timeout_seconds=30,
            max_output_tokens=None,
            use_json_object=False,
            disable_thinking=False,
        )
    err = exc_info.value
    assert err.kind == "4xx"
    assert err.status_code == 400
    # 4xx 是请求/配置错误,重试无意义 —— 实现当场 raise,只发 1 次。
    assert len(FakeAsyncClient.posts) == 1


@pytest.mark.asyncio
async def test_success_returns_json_body(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}
    _install_fake_client(monkeypatch, [FakeResponse(200, json_data=payload)])
    # 成功路径会走统一 trace;这里不发真实日志/网络,钉成 no-op。
    monkeypatch.setattr(gemini_client, "_trace_native_call", lambda *_a, **_kw: None)

    data = await gemini_client.generate_content(
        base_url="https://generativelanguage.googleapis.com",
        api_key="k",
        model="gemini-2.5-flash",
        messages=_messages(),
        timeout_seconds=30,
        max_output_tokens=None,
        use_json_object=False,
        disable_thinking=False,
    )
    assert data == payload
    assert len(FakeAsyncClient.posts) == 1
