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
from PIL import Image

from src.settings import reset_settings_cache


def _client():
    """TestClient —— app 必须在**用例体内**才 import。

    ⚠️ 别改回模块级 `from src.main import app`:模块级 import 在**收集期**执行,
    那时 conftest 的 autouse fixture 还没跑、AGENT_SHARED_SECRET 没设,
    `src/main.py:47` 的 `get_settings()` 当场 ValidationError —— 整条
    `PYTHONPATH=engine engine/.venv/bin/python -m pytest engine/tests`
    (CLAUDE.md 写死的仓根跑法)在收集期就 `Interrupted: 1 error during collection`,
    四百多个用例一个都跑不了。旁边 test_v3_route_surface.py 每个用例都在函数体内
    import,就是为了避这个坑。
    """
    from fastapi.testclient import TestClient
    from src.main import app

    return TestClient(app)


def _max_concurrency() -> int:
    from src.api.routes import PROFILE_MAX_CONCURRENCY

    return PROFILE_MAX_CONCURRENCY


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
    client = _client()
    resp = client.post(
        "/internal/open-clip/embeddings",
        json={"images": [_data_url()]},
        headers={"Authorization": "Bearer s3cret"},
    )
    assert resp.status_code == 404


def test_requires_bearer(monkeypatch):
    _enable(monkeypatch)
    client = _client()
    resp = client.post("/internal/open-clip/embeddings", json={"images": [_data_url()]})
    assert resp.status_code == 401


def test_returns_shape_the_caller_expects(monkeypatch):
    """响应形状必须是 features.py 读的那个:body['data']['embeddings'],长度对齐。"""
    _enable(monkeypatch)

    from src.workflows.core.chaptering import features

    monkeypatch.setattr(features, "clip_embeddings", lambda images: [[0.1, 0.2]] * len(images))

    client = _client()
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
    client = _client()
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

    client = _client()
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

    client = _client()

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


# ── /internal/photo-profile ───────────────────────────────────────────────────


def _stub_build(monkeypatch):
    """建档打桩 —— 路由测试不下模型权重、不打真视觉 API。"""
    from src.workflows.core.profile import build

    monkeypatch.setattr(
        build,
        "build_profile",
        lambda image, **_: {
            "v": 1,
            "subjectBox": {"x": 10.0, "y": 20.0, "w": 50.0, "h": 60.0},
            "faceBoxes": [],
            "maskKey": None,
            "colorTemp": "warm",
            "brightness": "mid",
            "saturation": "normal",
            "dominantColors": ["#C8A05A"],
            "composition": "focal",
            "scene": "outdoor",
            "peopleCount": "1",
            "mood": "warm",
            "description": "海边",
        },
    )


def test_photo_profile_disabled_returns_404(monkeypatch):
    _enable(monkeypatch, "false")
    client = _client()
    resp = client.post(
        "/internal/photo-profile",
        json={"images": [{"photoId": "p1", "dataUrl": _data_url()}]},
        headers={"Authorization": "Bearer s3cret"},
    )
    assert resp.status_code == 404


def test_photo_profile_requires_bearer(monkeypatch):
    _enable(monkeypatch)
    client = _client()
    resp = client.post(
        "/internal/photo-profile",
        json={"images": [{"photoId": "p1", "dataUrl": _data_url()}]},
    )
    assert resp.status_code == 401


def test_photo_profile_returns_profiles_keyed_by_photo_id(monkeypatch):
    _enable(monkeypatch)
    _stub_build(monkeypatch)
    client = _client()
    resp = client.post(
        "/internal/photo-profile",
        json={
            "images": [
                {"photoId": "p1", "dataUrl": _data_url()},
                {"photoId": "p2", "dataUrl": _data_url()},
            ]
        },
        headers={"Authorization": "Bearer s3cret"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert set(body["data"]["profiles"]) == {"p1", "p2"}
    assert body["data"]["profiles"]["p1"]["composition"] == "focal"


def test_photo_profile_output_parses_as_contract(monkeypatch):
    """路由吐出来的东西必须还能被契约吃下 —— 这是 A/B 两线的接缝。"""
    from src.contracts.photo_profile import PhotoProfile

    _enable(monkeypatch)
    _stub_build(monkeypatch)
    client = _client()
    resp = client.post(
        "/internal/photo-profile",
        json={"images": [{"photoId": "p1", "dataUrl": _data_url()}]},
        headers={"Authorization": "Bearer s3cret"},
    )
    PhotoProfile.model_validate(resp.json()["data"]["profiles"]["p1"])


def test_photo_profile_empty_returns_empty_map(monkeypatch):
    _enable(monkeypatch)
    client = _client()
    resp = client.post(
        "/internal/photo-profile",
        json={"images": []},
        headers={"Authorization": "Bearer s3cret"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["profiles"] == {}


def test_photo_profile_accepts_persist_mask_without_implementing_it(monkeypatch):
    """persistMask 收下但本批不实现(要等 B 线的 R2 写入口)。

    关键是**不能报错** —— 调用方带了这个参数不该 422,否则 B 线接上之前
    连普通建档都调不通。
    """
    _enable(monkeypatch)
    _stub_build(monkeypatch)
    client = _client()
    resp = client.post(
        "/internal/photo-profile",
        json={"images": [{"photoId": "p1", "dataUrl": _data_url()}], "persistMask": True},
        headers={"Authorization": "Bearer s3cret"},
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["profiles"]["p1"]["maskKey"] is None


def test_photo_profile_rejects_non_data_url(monkeypatch):
    _enable(monkeypatch)
    _stub_build(monkeypatch)
    client = _client()
    resp = client.post(
        "/internal/photo-profile",
        json={"images": [{"photoId": "p1", "dataUrl": "https://evil.example.com/a.jpg"}]},
        headers={"Authorization": "Bearer s3cret"},
    )
    assert resp.status_code == 400


class _Overlap:
    """记录一段代码的进出窗口,数出「同时在里面的最大路数」。

    用真实进出计数,不看代码里有没有 gather/锁 —— 「并发了但锁失效」和
    「锁住了但没并发」这两种病只测一条都漏得掉。
    """

    def __init__(self) -> None:
        import threading

        self._guard = threading.Lock()
        self.inside = 0
        self.max_inside = 0
        self.calls = 0

    def enter(self) -> None:
        with self._guard:
            self.inside += 1
            self.calls += 1
            self.max_inside = max(self.max_inside, self.inside)

    def exit(self) -> None:
        with self._guard:
            self.inside -= 1


def _instrument_profile_pipeline(monkeypatch, *, inference_delay=0.05, vision_delay=0.20):
    """把「本地推理」和「视觉网络调用」各插一个探针。

    本地推理走**真的** subject_mask(连带它的 @locked),只把 onnx session 换掉;
    视觉那头把 _call_vision 换成一段 sleep,模拟网络等待。
    """
    import numpy as np

    from src.workflows.core.profile import geometry, semantic

    inference = _Overlap()
    vision = _Overlap()

    class _FakeSession:
        def get_inputs(self):
            class _I:
                name = "input"

            return [_I()]

        def run(self, _outputs, feed):
            inference.enter()
            try:
                time.sleep(inference_delay)
                out = np.zeros((1, 1, 320, 320), dtype=np.float32)
                out[0, 0, 80:240, 80:240] = 1.0
                return [out]
            finally:
                inference.exit()

    monkeypatch.setattr(geometry, "_session", lambda spec: _FakeSession())

    def _fake_call_vision(image):
        vision.enter()
        try:
            time.sleep(vision_delay)  # 视觉模型的网络往返
            return (
                '{"composition":"focal","scene":"outdoor","peopleCount":"1",'
                '"mood":"warm","description":"海边"}'
            )
        finally:
            vision.exit()

    monkeypatch.setattr(semantic, "_call_vision", _fake_call_vision)
    return inference, vision


def test_photo_profile_runs_the_batch_concurrently(monkeypatch):
    """一批之内必须真并发,否则开关一开 analyze 就废。

    每张 ≈ 0.6s 本地推理 + 2~3s 视觉网络。逐个 await 的话 100 张 ≈ 5-6 分钟,
    而 grouping_clip_timeout_seconds 默认才 180s。

    两条一起断言:
      - 视觉调用**有重叠** —— 网络等待真并发了
      - 本地推理**无重叠** —— 单飞锁还在守着 2GB 内存
    只测一条会漏掉「并发了但锁失效」或「锁住了但没并发」。
    """
    _enable(monkeypatch)
    inference, vision = _instrument_profile_pipeline(monkeypatch)

    count = 6
    client = _client()
    resp = client.post(
        "/internal/photo-profile",
        json={"images": [{"photoId": f"p{i}", "dataUrl": _data_url()} for i in range(count)]},
        headers={"Authorization": "Bearer s3cret"},
    )

    assert resp.status_code == 200
    assert len(resp.json()["data"]["profiles"]) == count
    assert vision.calls == count and inference.calls == count

    assert vision.max_inside > 1, (
        f"视觉调用没有并发(最大同时 {vision.max_inside} 路)—— 逐个 await 的话"
        " 100 张的书要跑 5-6 分钟,analyze 必超时"
    )
    assert inference.max_inside == 1, (
        f"本地推理并发了 {inference.max_inside} 路 —— 单飞锁失效,2GB 会被撑爆"
    )


def test_photo_profile_concurrency_is_bounded(monkeypatch):
    """并发度必须有上限:视觉模型有速率限制,不能一次 gather 一百个。

    ⚠️ 本地推理的耗时必须调到 ~0:推理是串行的,它会把各路错开着送进视觉阶段,
    重叠数天然被 vision_delay/inference_delay 压住,根本摸不到上限 —— 那样这条
    断言就是废的(第一版正是这个毛病,去掉信号量它照样绿)。
    """
    _enable(monkeypatch)
    inference, vision = _instrument_profile_pipeline(
        monkeypatch, inference_delay=0.0, vision_delay=0.30
    )

    client = _client()
    over = _max_concurrency() + 6
    resp = client.post(
        "/internal/photo-profile",
        json={"images": [{"photoId": f"p{i}", "dataUrl": _data_url()} for i in range(over)]},
        headers={"Authorization": "Bearer s3cret"},
    )

    assert resp.status_code == 200
    assert vision.max_inside <= _max_concurrency(), (
        f"并发放到了 {vision.max_inside} 路,超过上限 {_max_concurrency()}"
    )


# ── 一张坏图不该毒死整批 ────────────────────────────────────────────────────────
#
# 三个模块的抬头都写着「一张照片的失败不该打挂整本」,而三处放大器叠加下来这句话
# 一条都不成立:
#   - _decode_data_url 抛 HTTPException  -> 整批 400
#   - asyncio.gather 没有 return_exceptions -> 整批 500
#   - (remote.py 那头的 raise_for_status  -> 整本书的档案被清空,见 test_profile_remote)
#
# 截断的 JPEG 是最常见的那一张坏图:Image.open 是**惰性**的,截断文件能 open 成功,
# 真解码发生在后面 convert 的时候(实测:Image.open OK -> OSError image file is truncated)。


def _truncated_data_url() -> str:
    """能 open、不能 decode 的 JPEG —— 上传中断/存储截断的真实形态。"""
    buf = io.BytesIO()
    Image.new("RGB", (400, 300), (200, 140, 80)).save(buf, format="JPEG", quality=90)
    raw = buf.getvalue()
    return "data:image/jpeg;base64," + base64.b64encode(raw[: len(raw) // 2]).decode("ascii")


def test_one_truncated_photo_does_not_kill_the_batch(monkeypatch):
    """一批 8 张里塞一张截断 JPEG,另外 7 张的档案必须照常拿得到。"""
    _enable(monkeypatch)
    _stub_build(monkeypatch)

    images = [{"photoId": f"p{i}", "dataUrl": _data_url()} for i in range(8)]
    images[3]["dataUrl"] = _truncated_data_url()

    resp = _client().post(
        "/internal/photo-profile",
        json={"images": images},
        headers={"Authorization": "Bearer s3cret"},
    )

    assert resp.status_code == 200
    profiles = resp.json()["data"]["profiles"]
    assert set(profiles) == {f"p{i}" for i in range(8)} - {"p3"}


def test_one_failed_build_does_not_kill_the_batch(monkeypatch):
    """建档本身抛(色彩组在坏图上 raise、onnx 挂了…)也只该少那一张。"""
    _enable(monkeypatch)

    from src.workflows.core.profile import build

    def _flaky(image, **kwargs):
        if kwargs.get("photo_id") == "p3":
            raise OSError("image file is truncated")
        return {"v": 1, "composition": "focal"}

    monkeypatch.setattr(build, "build_profile", _flaky)

    resp = _client().post(
        "/internal/photo-profile",
        json={"images": [{"photoId": f"p{i}", "dataUrl": _data_url()} for i in range(8)]},
        headers={"Authorization": "Bearer s3cret"},
    )

    assert resp.status_code == 200
    assert set(resp.json()["data"]["profiles"]) == {f"p{i}" for i in range(8)} - {"p3"}


def test_whole_batch_undecodable_still_400(monkeypatch):
    """一张都解不出来 = 调用方发错了东西,该让它知道,而不是回一个空 map 假装成功。"""
    _enable(monkeypatch)
    _stub_build(monkeypatch)
    resp = _client().post(
        "/internal/photo-profile",
        json={"images": [{"photoId": "p1", "dataUrl": _truncated_data_url()}]},
        headers={"Authorization": "Bearer s3cret"},
    )
    assert resp.status_code == 400


def test_concurrency_limit_is_shared_across_requests(monkeypatch):
    """限流必须是**进程级**的,不是每请求一把。

    唯一调用方 profile/remote.py 每批正好发 PROFILE_BATCH_SIZE 张,而上限也是同一个
    数 —— 每请求新建的信号量因此从不 block,等于没有限流。并发几个请求就能跑出
    请求数 × 8 路视觉调用,被上游速率限制整批打回。

    ⚠️ 必须用 `with TestClient(app)`:不进上下文管理器时 TestClient 每个请求都新起
    一个 portal(各自一个事件循环),那样连线上「一个 uvicorn 一个 loop」的情形都
    模拟不出来,这条断言会被假绿喂饱。
    """
    _enable(monkeypatch)
    inference, vision = _instrument_profile_pipeline(
        monkeypatch, inference_delay=0.0, vision_delay=0.30
    )

    from concurrent.futures import ThreadPoolExecutor

    from fastapi.testclient import TestClient

    from src.main import app

    batch = _max_concurrency()
    requests = 4
    with TestClient(app) as client:

        def _post():
            return client.post(
                "/internal/photo-profile",
                json={
                    "images": [
                        {"photoId": f"p{i}", "dataUrl": _data_url()} for i in range(batch)
                    ]
                },
                headers={"Authorization": "Bearer s3cret"},
            )

        with ThreadPoolExecutor(max_workers=requests) as pool:
            results = [f.result() for f in [pool.submit(_post) for _ in range(requests)]]

    assert all(r.status_code == 200 for r in results)
    assert vision.calls == batch * requests
    assert vision.max_inside <= batch, (
        f"{requests} 个并发请求跑出了 {vision.max_inside} 路视觉调用,上限是 {batch}"
        " —— 信号量是每请求新建的,限流形同虚设"
    )


def test_response_reports_the_real_vision_call_count(monkeypatch):
    """成本计数必须从这里往回带 —— 调用它的那台 1GB Agent 自己看不见视觉调用。"""
    _enable(monkeypatch)
    _instrument_profile_pipeline(monkeypatch, inference_delay=0.0, vision_delay=0.0)

    resp = _client().post(
        "/internal/photo-profile",
        json={"images": [{"photoId": f"p{i}", "dataUrl": _data_url()} for i in range(3)]},
        headers={"Authorization": "Bearer s3cret"},
    )

    assert resp.status_code == 200
    assert resp.json()["data"]["visionCallCount"] == 3


def test_vision_call_count_excludes_failed_calls(monkeypatch):
    """视觉槽整体挂掉时每张照片仍然有档案(语义组降级),但一次调用都没成功 ——
    计数必须是 0,否则成本表虚高,还掩盖了「视觉组全挂了」这个信号。"""
    _enable(monkeypatch)
    _instrument_profile_pipeline(monkeypatch, inference_delay=0.0, vision_delay=0.0)

    from src.workflows.core.profile import semantic

    def _boom(image):
        raise RuntimeError("ARK down")

    monkeypatch.setattr(semantic, "_call_vision", _boom)

    resp = _client().post(
        "/internal/photo-profile",
        json={"images": [{"photoId": f"p{i}", "dataUrl": _data_url()} for i in range(3)]},
        headers={"Authorization": "Bearer s3cret"},
    )

    body = resp.json()
    assert len(body["data"]["profiles"]) == 3
    assert body["data"]["visionCallCount"] == 0
