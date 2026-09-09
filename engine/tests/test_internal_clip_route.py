"""/internal/open-clip/embeddings 路由。

这个 endpoint 的调用方(features.py:_remote_clip_embeddings)和鉴权
(auth.require_clip_bearer)早就写好了,只有路由本身在 0cfc019d「瘦身到最小版」
那次被删掉了 —— 而 features.py 一直在调它。

⚠️ 生产 `yujee-agent-clip` 上这个路由**是通的**(2026-09-09 带鉴权实测返回了合法
embeddings),说明线上跑的镜像里有、而源码里没有:源码落后于生产,且那个镜像在本仓
历史里复现不出来。所以这里补路由不是「修线上的 bug」,是**拆哑雷** —— 谁下次拿
当前源码重新 deploy CLIP worker,analyze 就会当场 404(grouping.py 的
emb_future.result() 没有 try/except)。

响应形状由调用方决定,不能改:body["data"]["embeddings"],长度等于请求图片数。
"""

import base64
import io
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from src.main import app
from src.settings import reset_settings_cache


def _data_url() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (120, 90, 60)).save(buf, format="JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


@pytest.fixture(autouse=True)
def _reset_settings():
    reset_settings_cache()
    yield
    reset_settings_cache()


def _enable(monkeypatch, enabled: str = "true") -> None:
    monkeypatch.setenv("AGENT_ENABLE_CLIP_EMBEDDINGS", enabled)
    monkeypatch.setenv("AGENT_SHARED_SECRET", "s3cret")
    # ⚠️ 必须显式设成同一个值,不能 delenv:本机 engine/.env 里有真的
    # GROUPING_CLIP_SECRET,而 delenv 只能删 os.environ、删不掉 .env 文件里的那份,
    # require_clip_bearer 会优先用它,测试就会莫名 401。
    monkeypatch.setenv("GROUPING_CLIP_SECRET", "s3cret")
    reset_settings_cache()


def test_disabled_by_default_returns_404(monkeypatch):
    """普通 1GB Agent 没装 torch,这个口必须是关的。"""
    _enable(monkeypatch, "false")
    client = TestClient(app)
    resp = client.post(
        "/internal/open-clip/embeddings",
        json={"images": [_data_url()]},
        headers={"Authorization": "Bearer s3cret"},
    )
    assert resp.status_code == 404


def test_requires_bearer(monkeypatch):
    _enable(monkeypatch)
    client = TestClient(app)
    resp = client.post("/internal/open-clip/embeddings", json={"images": [_data_url()]})
    assert resp.status_code == 401


def test_returns_shape_the_caller_expects(monkeypatch):
    """响应形状必须是 features.py 读的那个:body['data']['embeddings'],长度对齐。"""
    _enable(monkeypatch)

    from src.workflows.core.chaptering import features

    monkeypatch.setattr(features, "clip_embeddings", lambda images: [[0.1, 0.2]] * len(images))

    client = TestClient(app)
    resp = client.post(
        "/internal/open-clip/embeddings",
        json={"images": [_data_url(), _data_url()]},
        headers={"Authorization": "Bearer s3cret"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert len(body["data"]["embeddings"]) == 2


def test_empty_images_returns_empty_list(monkeypatch):
    _enable(monkeypatch)
    client = TestClient(app)
    resp = client.post(
        "/internal/open-clip/embeddings",
        json={"images": []},
        headers={"Authorization": "Bearer s3cret"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["embeddings"] == []


def test_rejects_non_data_url(monkeypatch):
    """只认 base64 内联,不外联取图 —— 外联即 SSRF。"""
    _enable(monkeypatch)

    from src.workflows.core.chaptering import features

    monkeypatch.setattr(features, "clip_embeddings", lambda images: [[0.1]] * len(images))

    client = TestClient(app)
    resp = client.post(
        "/internal/open-clip/embeddings",
        json={"images": ["https://evil.example.com/a.jpg"]},
        headers={"Authorization": "Bearer s3cret"},
    )
    assert resp.status_code == 400


def test_inference_is_single_flight(monkeypatch):
    """并发推理必须串行。

    CLIP worker 是 shared-cpu-1x / 2048MB,实测 torch+open_clip 加载峰值就吃掉
    ~1.36GB,只剩 ~690MB;而 run_in_threadpool 默认 40 线程 —— 不串行,两三个并发
    就把机器撑爆。这条测的是「真的没有重叠」,不是「代码里有把锁」。
    """
    import threading
    from concurrent.futures import ThreadPoolExecutor

    _enable(monkeypatch)

    from src.workflows.core.chaptering import features

    state = {"inside": 0, "max_inside": 0}
    guard = threading.Lock()

    def _slow_embeddings(images):
        with guard:
            state["inside"] += 1
            state["max_inside"] = max(state["max_inside"], state["inside"])
        time.sleep(0.15)
        with guard:
            state["inside"] -= 1
        return [[0.1, 0.2]] * len(images)

    monkeypatch.setattr(features, "clip_embeddings", _slow_embeddings)

    client = TestClient(app)

    def _post():
        return client.post(
            "/internal/open-clip/embeddings",
            json={"images": [_data_url()]},
            headers={"Authorization": "Bearer s3cret"},
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = [f.result() for f in [pool.submit(_post) for _ in range(4)]]

    assert all(r.status_code == 200 for r in results)
    assert state["max_inside"] == 1, f"推理并发了 {state['max_inside']} 路,单飞锁没生效"
