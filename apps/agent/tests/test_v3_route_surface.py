from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
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
        # 新版 Starlette:include_router 产生 `_IncludedRouter`,真正的子路由在
        # `original_router.routes`(旧版直接有 `.router`)。
        sub = getattr(route, "original_router", None) or getattr(route, "router", None)
        if sub is not None and getattr(sub, "routes", None):
            paths |= _all_paths(sub.routes)
    return paths


def test_agent_route_surface_keeps_health_and_v3_only() -> None:
    from src.main import app

    paths = _all_paths(app.routes)

    assert "/health" in paths
    assert {
        "/v3/analyze",
        "/v3/select-layout",
        "/v3/chapter-chat",
        "/v3/edit-chat",
        "/v3/recommend",
        "/v3/apply-theme",
        "/v3/cover",
        "/v3/finalize",
        "/internal/agent-ack",
        "/internal/open-clip/embeddings",
    }.issubset(paths)
    # page_edit 已被 edit_loop 吸收 —— /v3/page-edit 不再存在。
    assert "/v3/page-edit" not in paths
    assert not any(path.startswith("/" + "v2" + "/album") for path in paths)


def test_select_layout_route_accepts_202_and_background_task(monkeypatch) -> None:
    from src import routes
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


def test_internal_agent_ack_contract_surface(monkeypatch) -> None:
    from src import routes
    from src.main import app

    class FakeEditRepo:
        def __init__(self) -> None:
            self.seen: list[str] = []

        async def acknowledge_op(self, op_id: str) -> bool:
            self.seen.append(op_id)
            return op_id == "known-op"

    repo = FakeEditRepo()
    monkeypatch.setattr(routes, "agent_edit_repo", repo, raising=False)
    client = TestClient(app)
    headers = {"Authorization": "Bearer test_secret"}

    known = client.post("/internal/agent-ack", json={"opId": "known-op"}, headers=headers)
    assert known.status_code == 200
    assert known.json() == {"ok": True}

    unknown = client.post("/internal/agent-ack", json={"opId": "unknown-op"}, headers=headers)
    assert unknown.status_code == 200
    assert unknown.json() == {"ok": False}
    assert repo.seen == ["known-op", "unknown-op"]


def test_internal_open_clip_embeddings_can_be_enabled(monkeypatch) -> None:
    from src import routes
    from src import settings as settings_module
    from src.main import app

    try:
        monkeypatch.setenv("AGENT_ENABLE_CLIP_EMBEDDINGS", "true")
        settings_module.reset_settings_cache()
        monkeypatch.setattr(
            routes.chapter_features,
            "image_from_data_url",
            lambda image: object(),
        )
        monkeypatch.setattr(
            routes.chapter_features,
            "clip_embeddings",
            lambda images: [[1.0, 0.0], [0.0, 1.0]],
        )

        client = TestClient(app)
        headers = {"Authorization": "Bearer test_secret"}
        resp = client.post(
            "/internal/open-clip/embeddings",
            json={
                "images": [
                    "data:image/jpeg;base64,AA==",
                    "data:image/jpeg;base64,AA==",
                ]
            },
            headers=headers,
        )
    finally:
        settings_module.reset_settings_cache()

    assert resp.status_code == 200
    assert resp.json() == {
        "ok": True,
        "data": {"embeddings": [[1.0, 0.0], [0.0, 1.0]]},
    }


def test_internal_open_clip_embeddings_accepts_grouping_clip_secret(monkeypatch) -> None:
    from src import routes
    from src import settings as settings_module
    from src.main import app

    try:
        monkeypatch.setenv("AGENT_ENABLE_CLIP_EMBEDDINGS", "true")
        monkeypatch.setenv("GROUPING_CLIP_SECRET", "clip_secret")
        settings_module.reset_settings_cache()
        monkeypatch.setattr(
            routes.chapter_features,
            "image_from_data_url",
            lambda image: object(),
        )
        monkeypatch.setattr(
            routes.chapter_features,
            "clip_embeddings",
            lambda images: [[1.0, 0.0]],
        )

        client = TestClient(app)
        resp = client.post(
            "/internal/open-clip/embeddings",
            json={"images": ["data:image/jpeg;base64,AA=="]},
            headers={"Authorization": "Bearer clip_secret"},
        )
    finally:
        settings_module.reset_settings_cache()

    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "data": {"embeddings": [[1.0, 0.0]]}}


def test_internal_open_clip_embeddings_disabled_by_default() -> None:
    from src import settings as settings_module
    from src.main import app

    try:
        settings_module.reset_settings_cache()
        client = TestClient(app)
        headers = {"Authorization": "Bearer test_secret"}
        resp = client.post(
            "/internal/open-clip/embeddings",
            json={"images": ["data:image/jpeg;base64,AA=="]},
            headers=headers,
        )
    finally:
        settings_module.reset_settings_cache()

    assert resp.status_code == 503
    assert resp.json()["error"]["message"] == (
        "open_clip embeddings are disabled on this Agent instance"
    )


def test_internal_agent_ack_infra_failure_is_503(monkeypatch) -> None:
    from src import routes
    from src.db import AgentDbUnavailable
    from src.main import app

    class BrokenEditRepo:
        async def acknowledge_op(self, op_id: str) -> bool:
            raise AgentDbUnavailable("DATABASE_URL is required for agent ack")

    monkeypatch.setattr(routes, "agent_edit_repo", BrokenEditRepo(), raising=False)
    client = TestClient(app)
    headers = {"Authorization": "Bearer test_secret"}

    resp = client.post("/internal/agent-ack", json={"opId": "known-op"}, headers=headers)

    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "AGENT_DB_UNAVAILABLE"


def test_agent_edit_repo_missing_database_url_is_infra_failure(monkeypatch) -> None:
    from src import settings as settings_module
    from src.db import AgentDbUnavailable, AgentEditRepository

    monkeypatch.delenv("DATABASE_URL", raising=False)
    settings_module.reset_settings_cache()

    with pytest.raises(AgentDbUnavailable):
        asyncio.run(AgentEditRepository().acknowledge_op("known-op"))


def test_agent_source_has_no_old_album_chain_residue() -> None:
    src_root = Path(__file__).resolve().parents[1] / "src"
    forbidden = ("schemas_" + "v2", "v2_" + "album", "/" + "v2" + "/album")
    offenders: list[str] = []

    for path in sorted(src_root.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        if any(token in text for token in forbidden):
            offenders.append(str(path.relative_to(src_root)))

    assert offenders == []
