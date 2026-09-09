"""建档的远程客户端。

`/v3/analyze` 跑在普通 1GB 的 yujee-agent 上,那台机器**没有** onnxruntime、没有
分割权重 —— 跟 CLIP embedding 一模一样的处境。所以建档也得委托给 2GB 的
yujee-agent-clip,走 /internal/photo-profile。写法对齐
features.py:_remote_clip_embeddings。
"""

import pytest
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


def test_bad_shape_raises_so_caller_can_degrade(monkeypatch):
    """形状不对就抛,由 analyze 那层统一降级成「没有档案」——
    这里**不要**偷偷返回半份档案,那样错会一路飘到排版。"""
    _install_fake_client(monkeypatch, lambda body: _FakeResponse({"ok": True, "data": {}}))
    with pytest.raises(ValueError):
        remote.fetch_photo_profiles([_photo("p1")], _Settings())
