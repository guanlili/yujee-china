from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def test_agent_route_surface_keeps_health_and_v3_only() -> None:
    from src.main import app

    paths = {route.path for route in app.routes}

    assert "/health" in paths
    assert {
        "/v3/analyze",
        "/v3/select-layout",
        "/v3/chapter-chat",
        "/v3/page-edit",
        "/v3/recommend",
        "/v3/apply-theme",
        "/v3/cover",
        "/v3/finalize",
        "/internal/agent-ack",
    }.issubset(paths)
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
