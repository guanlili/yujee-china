from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _all_paths(routes) -> set[str]:
    """收集挂载在 app 上的全部路由 path。

    新版 Starlette 把 include_router 的子路由包成 `_IncludedRouter`(无 `.path`,内含
    一个子 `.router`);这里递归展开,既支持新版也兼容旧版。"""
    paths: set[str] = set()
    for route in routes:
        path = getattr(route, "path", None)
        if isinstance(path, str):
            paths.add(path)
        sub = getattr(route, "original_router", None) or getattr(route, "router", None)
        if sub is not None and getattr(sub, "routes", None):
            paths |= _all_paths(sub.routes)
    return paths


def test_agent_route_surface_is_recognize_layout_only() -> None:
    """最小版只暴露 health + 识图 + 排版两段;后续环节端点已剥离。"""
    from src.main import app

    paths = _all_paths(app.routes)

    assert "/health" in paths
    assert {"/v3/analyze", "/v3/select-layout", "/v3/judge-layout"}.issubset(paths)

    # 已剥离的后续环节端点不得残留。
    removed = {
        "/v3/chapter-chat",
        "/v3/edit-chat",
        "/v3/write-chapter",
        "/v3/recommend",
        "/v3/apply-theme",
        "/v3/cover",
        "/v3/finalize",
        "/v3/page-edit",
        "/internal/agent-ack",
        "/internal/open-clip/embeddings",
    }
    assert removed.isdisjoint(paths)
    assert not any(path.startswith("/" + "v2" + "/album") for path in paths)


def test_select_layout_route_accepts_202_and_background_task(monkeypatch) -> None:
    from src.api import routes
    from src.main import app

    seen = []

    async def fake_run_with_timeout(req):
        seen.append(req.requestId)

    monkeypatch.setattr(routes.select_layout, "run_with_timeout", fake_run_with_timeout)
    client = TestClient(app)
    headers = {"Authorization": "Bearer test_secret"}

    resp = client.post(
        "/v3/select-layout",
        json={
            "requestId": "layout-r1",
            "callbackUrl": "https://example.com/api/v3/internal/job-progress",
            "language": "en",
            "chapters": [
                {
                    "chapterId": "ch_1",
                    "structureHint": "coast morning",
                    "photos": [
                        {
                            "photoId": "p1",
                            "ref200px": "data:image/jpeg;base64,AA==",
                            "orientation": "landscape",
                            "takenAt": None,
                        }
                    ],
                }
            ],
        },
        headers=headers,
    )

    assert resp.status_code == 202
    assert resp.json() == {"ok": True, "data": {"requestId": "layout-r1", "accepted": True}}
    assert seen == ["layout-r1"]


def test_agent_source_has_no_old_album_chain_residue() -> None:
    src_root = Path(__file__).resolve().parents[1] / "src"
    forbidden = ("schemas_" + "v2", "v2_" + "album", "/" + "v2" + "/album")
    offenders: list[str] = []

    for path in sorted(src_root.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        if any(token in text for token in forbidden):
            offenders.append(str(path.relative_to(src_root)))

    assert offenders == []
