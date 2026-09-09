"""建档结果回传 web —— 整批功能的出口。

engine 建完档必须把 {albumId, profiles} POST 回 web 的
`/api/v3/internal/photo-profiles` 落到 `album_photos.profile`,否则:
Agent 永远读不到档案 -> 整批三个照片能力(整本调色 / 构图裁切 / 抠图)全部空转。
(analyze 里那次回填只写章节树的 composition/sceneDescription,不落档案本体。)

回传失败**不能**打挂 analyze —— 档案是增强不是必需 —— 但必须打日志:
静默丢档案正是这批要治的病。
"""

import asyncio

import pytest

from src.workflows.core.profile import publish


class _Settings:
    agent_shared_secret = "shared"
    grouping_clip_secret = "clip-secret"


_PROFILES = {"p1": {"v": 1, "composition": "wide"}}


class _FakeResponse:
    def __init__(self, status_code=200):
        self.status_code = status_code


def _install(monkeypatch, handler):
    calls: list[dict] = []

    class _FakeAsyncClient:
        def __init__(self, *a, **kw):
            self.kwargs = kw

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json, headers):
            calls.append({"url": url, "json": json, "headers": headers})
            return handler(len(calls))

    import httpx

    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)
    return calls


class _LogSpy:
    def __init__(self) -> None:
        self.warnings: list[tuple[str, dict]] = []

    def warning(self, event, **kw):
        self.warnings.append((event, kw))

    def info(self, event, **kw):
        pass


def _run(monkeypatch, *, callback_url="https://yujeeai.com/api/v3/internal/job-progress", profiles=None):
    return asyncio.run(
        publish.publish_photo_profiles(
            album_id="alb_1",
            profiles=_PROFILES if profiles is None else profiles,
            callback_url=callback_url,
            settings=_Settings(),
        )
    )


def test_posts_album_id_and_profiles(monkeypatch):
    calls = _install(monkeypatch, lambda n: _FakeResponse(200))

    assert _run(monkeypatch) is True
    assert calls[0]["json"] == {"albumId": "alb_1", "profiles": _PROFILES}


def test_url_is_derived_from_the_callback_origin(monkeypatch):
    """用 web 自己给的回调地址推 origin,不靠 WEB_BASE_URL —— 那个变量至今没有任何
    消费方,主 Agent 上是不是对的没人验过;而 callbackUrl 是 web 每次请求自己带来的。"""
    calls = _install(monkeypatch, lambda n: _FakeResponse(200))
    _run(monkeypatch)
    assert calls[0]["url"] == "https://yujeeai.com/api/v3/internal/photo-profiles"

    calls = _install(monkeypatch, lambda n: _FakeResponse(200))
    _run(monkeypatch, callback_url="http://192.168.1.7:3000/api/v3/internal/job-progress")
    assert calls[0]["url"] == "http://192.168.1.7:3000/api/v3/internal/photo-profiles"


def test_uses_the_agent_shared_secret_not_the_clip_secret(monkeypatch):
    """web 的 requireAgentSecret 认的是 AGENT_SHARED_SECRET。拿 CLIP worker 那把
    去敲会 401,而 401 在这条路上表现为「静默没有档案」。"""
    calls = _install(monkeypatch, lambda n: _FakeResponse(200))
    _run(monkeypatch)
    assert calls[0]["headers"]["Authorization"] == "Bearer shared"


def test_empty_profiles_does_not_call_web(monkeypatch):
    calls = _install(monkeypatch, lambda n: _FakeResponse(200))
    assert _run(monkeypatch, profiles={}) is False
    assert calls == []


def test_retries_once_then_gives_up_without_raising(monkeypatch):
    """回传是整批功能的唯一出口,一次网络抖动就丢掉全书档案太亏,重试一次。
    仍然失败就认栽 —— 但绝不抛,analyze 不能因为它挂掉。"""
    monkeypatch.setattr(publish, "_RETRY_BACKOFF_SECONDS", 0)
    calls = _install(monkeypatch, lambda n: _FakeResponse(503))
    spy = _LogSpy()
    monkeypatch.setattr(publish, "log", spy)

    assert _run(monkeypatch) is False
    assert len(calls) == 2
    assert spy.warnings, "回传失败没有打任何日志 —— 静默丢档案正是要治的病"


def test_recovers_on_the_retry(monkeypatch):
    monkeypatch.setattr(publish, "_RETRY_BACKOFF_SECONDS", 0)
    calls = _install(monkeypatch, lambda n: _FakeResponse(200 if n == 2 else 500))
    assert _run(monkeypatch) is True
    assert len(calls) == 2


def test_transport_exception_is_caught_not_raised(monkeypatch):
    monkeypatch.setattr(publish, "_RETRY_BACKOFF_SECONDS", 0)

    def _boom(n):
        import httpx

        raise httpx.ConnectError("no route to host")

    _install(monkeypatch, _boom)
    spy = _LogSpy()
    monkeypatch.setattr(publish, "log", spy)

    assert _run(monkeypatch) is False
    assert "ConnectError" in str(dict(spy.warnings[0][1]).get("error"))


def test_4xx_is_not_retried(monkeypatch):
    """401/400 重试一遍还是 401 —— 白等一轮,而且掩盖了「凭据配错了」这个信号。"""
    monkeypatch.setattr(publish, "_RETRY_BACKOFF_SECONDS", 0)
    calls = _install(monkeypatch, lambda n: _FakeResponse(401))
    assert _run(monkeypatch) is False
    assert len(calls) == 1
