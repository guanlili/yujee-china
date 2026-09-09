"""建档的远程客户端。

`/v3/analyze` 跑在普通 1GB 的 yujee-agent 上,那台机器**没有** onnxruntime、没有
分割权重 —— 跟 CLIP embedding 一模一样的处境。所以建档也得委托给 2GB 的
yujee-agent-clip,走 /internal/photo-profile。写法对齐
features.py:_remote_clip_embeddings。
"""

from src.contracts.schemas import V3AnalyzePhoto
from src.workflows.core.profile import remote

_PIXEL = "data:image/jpeg;base64,AA=="


class _Settings:
    def __init__(self, base_url="https://clip.test", secret="sec", timeout=180):
        self.grouping_clip_base_url = base_url
        self.grouping_clip_secret = secret
        self.agent_shared_secret = "fallback"
        self.grouping_clip_timeout_seconds = timeout


def _photo(pid: str) -> V3AnalyzePhoto:
    return V3AnalyzePhoto(photoId=pid, base64=_PIXEL, width=800, height=600)


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def _install_fake_client(monkeypatch, handler):
    calls: list[dict] = []

    class _FakeClient:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json, headers):
            calls.append({"url": url, "json": json, "headers": headers})
            return handler(json)

    import httpx

    monkeypatch.setattr(httpx, "Client", _FakeClient)
    return calls


def test_no_base_url_means_no_profiles(monkeypatch):
    """没配 CLIP worker 就没有档案能力 —— 返回空,让上游退回今天的行为。"""
    assert remote.fetch_photo_profiles([_photo("p1")], _Settings(base_url=None)) == {}


def test_no_photos_short_circuits(monkeypatch):
    assert remote.fetch_photo_profiles([], _Settings()) == {}


def test_posts_photo_id_and_data_url_with_bearer(monkeypatch):
    calls = _install_fake_client(
        monkeypatch,
        lambda body: _FakeResponse(
            {"ok": True, "data": {"profiles": {i["photoId"]: {"composition": "focal"} for i in body["images"]}}}
        ),
    )
    out = remote.fetch_photo_profiles([_photo("p1")], _Settings())

    assert out == {"p1": {"composition": "focal"}}
    assert calls[0]["url"] == "https://clip.test/internal/photo-profile"
    assert calls[0]["headers"]["Authorization"] == "Bearer sec"
    assert calls[0]["json"]["images"] == [{"photoId": "p1", "dataUrl": _PIXEL}]


def test_batches_requests(monkeypatch):
    """一次别发几百张 —— 每张都是一次分割推理 + 一次视觉调用。"""
    calls = _install_fake_client(
        monkeypatch,
        lambda body: _FakeResponse(
            {"ok": True, "data": {"profiles": {i["photoId"]: {} for i in body["images"]}}}
        ),
    )
    photos = [_photo(f"p{i}") for i in range(remote.PROFILE_BATCH_SIZE * 2 + 1)]
    out = remote.fetch_photo_profiles(photos, _Settings())

    assert len(calls) == 3
    assert len(out) == len(photos)
    assert all(len(c["json"]["images"]) <= remote.PROFILE_BATCH_SIZE for c in calls)


def test_falls_back_to_shared_secret_when_clip_secret_absent(monkeypatch):
    calls = _install_fake_client(
        monkeypatch, lambda body: _FakeResponse({"ok": True, "data": {"profiles": {}}})
    )
    remote.fetch_photo_profiles([_photo("p1")], _Settings(secret=None))
    assert calls[0]["headers"]["Authorization"] == "Bearer fallback"




# ── 一个批次失败不该清空整本书的档案 ────────────────────────────────────────────
#
# 原来 raise_for_status() 直接抛出去,analyze.py 的 except 把 profiles 整个清成 {}
# —— 一次 502/超时,100 张的书一张档案都不剩。分批本来就是为了让失败可以局部化,
# 不局部化的分批等于没分批。


class _LogSpy:
    def __init__(self) -> None:
        self.warnings: list[tuple[str, dict]] = []

    def warning(self, event, **kw):
        self.warnings.append((event, kw))

    def info(self, event, **kw):
        pass


class _BoomResponse:
    def raise_for_status(self):
        import httpx

        raise httpx.HTTPStatusError("502", request=None, response=None)

    def json(self):  # pragma: no cover —— 上面已经抛了
        return {}


def _ok(body):
    return _FakeResponse(
        {"ok": True, "data": {"profiles": {i["photoId"]: {"composition": "focal"} for i in body["images"]}}}
    )


def test_one_failed_batch_only_loses_that_batch(monkeypatch):
    """第二批 502,第一批和第三批的档案必须照常拿到。"""
    seen: list[int] = []

    def _handler(body):
        seen.append(len(seen))
        return _BoomResponse() if len(seen) == 2 else _ok(body)

    _install_fake_client(monkeypatch, _handler)
    photos = [_photo(f"p{i}") for i in range(remote.PROFILE_BATCH_SIZE * 3)]

    out = remote.fetch_photo_profiles(photos, _Settings())

    assert len(seen) == 3, "第二批失败之后没有继续跑第三批"
    assert len(out) == remote.PROFILE_BATCH_SIZE * 2
    assert "p0" in out and f"p{remote.PROFILE_BATCH_SIZE * 2}" in out


def test_failed_batch_is_logged(monkeypatch):
    """静默丢档案是这批要治的病本身 —— 失败必须留痕。"""
    _install_fake_client(monkeypatch, lambda body: _BoomResponse())
    spy = _LogSpy()
    monkeypatch.setattr(remote, "log", spy)

    remote.fetch_photo_profiles([_photo("p1")], _Settings())

    assert spy.warnings, "批次失败没有打任何日志"
    assert "HTTPStatusError" in str(dict(spy.warnings[0][1]).get("error"))


def test_bad_shape_in_one_batch_only_loses_that_batch(monkeypatch):
    """形状不对的那一批丢掉,别的批照常 —— 也**不要**把半份档案混进来。"""
    seen: list[int] = []

    def _handler(body):
        seen.append(len(seen))
        return _FakeResponse({"ok": True, "data": {}}) if len(seen) == 1 else _ok(body)

    _install_fake_client(monkeypatch, _handler)
    photos = [_photo(f"p{i}") for i in range(remote.PROFILE_BATCH_SIZE * 2)]

    out = remote.fetch_photo_profiles(photos, _Settings())

    assert len(out) == remote.PROFILE_BATCH_SIZE
    assert "p0" not in out


def test_every_batch_failing_returns_empty_instead_of_raising(monkeypatch):
    """整个 worker 挂了 -> 空档案 + 日志,让 analyze 退回今天的行为,而不是靠
    上游那个 except 兜(那个 except 兜住的是异常,兜不住「静默丢了一半」)。"""
    _install_fake_client(monkeypatch, lambda body: _BoomResponse())
    assert remote.fetch_photo_profiles([_photo("p1")], _Settings()) == {}
