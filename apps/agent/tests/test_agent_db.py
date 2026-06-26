from __future__ import annotations

import asyncio
import inspect
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import pytest


REPO_ROOT = Path(__file__).resolve().parents[3]
AGENT_DIR = REPO_ROOT / "apps" / "agent"
MIGRATION = AGENT_DIR / "migrations" / "versions" / "20260626_0001_agent_edit_boundary.py"


def test_agent_edit_boundary_migration_static_contract() -> None:
    migration = MIGRATION.read_text(encoding="utf-8")
    alembic_ini = (AGENT_DIR / "alembic.ini").read_text(encoding="utf-8")
    dockerfile = (AGENT_DIR / "Dockerfile").read_text(encoding="utf-8")

    assert 'op.execute("create schema if not exists agent")' in migration
    assert '"edit_sessions"' in migration
    assert '"edit_messages"' in migration
    assert '"edit_ops"' in migration
    assert 'sa.Column("op_id", sa.Text(), nullable=True)' in migration
    assert 'sa.ForeignKeyConstraint(["op_id"], ["agent.edit_ops.op_id"]' in migration
    assert '"idx_agent_edit_messages_op_status"' in migration
    assert '["op_id", "status"]' in migration
    assert "script_location = %(here)s/migrations" in alembic_ini
    assert "COPY apps/agent/alembic.ini ./alembic.ini" in dockerfile
    assert "COPY apps/agent/migrations ./migrations" in dockerfile
    assert "COPY packages/contracts/template-previews ./packages/contracts/template-previews" in dockerfile


def test_agent_edit_repo_stage3_methods_static_contract() -> None:
    from src.db import AgentEditRepository, _SerializedTurnLease, _in_flight_is_stale

    assert hasattr(AgentEditRepository, "list_committed_messages")
    assert hasattr(AgentEditRepository, "create_pending_turn")
    assert hasattr(AgentEditRepository, "begin_serialized_turn")

    history_source = inspect.getsource(AgentEditRepository.list_committed_messages)
    pending_source = inspect.getsource(AgentEditRepository.create_pending_turn)
    begin_source = inspect.getsource(AgentEditRepository.begin_serialized_turn)
    lease_create_source = inspect.getsource(_SerializedTurnLease.create_pending_turn)
    lease_cancel_source = inspect.getsource(_SerializedTurnLease.cancel)
    ack_source = inspect.getsource(AgentEditRepository.acknowledge_op)
    stale_source = inspect.getsource(_in_flight_is_stale)
    assert "status = 'committed'" in history_source
    assert "order by created_at desc" in history_source
    assert "status" in pending_source
    assert "'pending'" in pending_source
    assert "agent.edit_ops" in pending_source
    assert "agent.edit_messages" in pending_source
    assert "for update" in begin_source.lower()
    assert "status = 'committed'" in begin_source
    assert "agent.edit_sessions" in begin_source
    assert "inFlight" in begin_source
    assert "startedAt" in begin_source
    assert "_TURN_LEASE_STALE_SECONDS" in stale_source
    assert "yield" not in begin_source
    assert "for update" in lease_create_source.lower()
    assert "_in_flight_turn_id" in lease_create_source
    assert "_turnId" in lease_create_source
    assert "inFlight" in lease_create_source
    assert "agent.edit_ops" in lease_create_source
    assert "agent.edit_messages" in lease_create_source
    assert "for update" in lease_cancel_source.lower()
    assert "_in_flight_turn_id" in lease_cancel_source
    assert "_turnId" in ack_source
    assert "for update" in ack_source.lower()
    assert "_in_flight_turn_id" in ack_source


@pytest.mark.skipif(
    not os.environ.get("AGENT_TEST_DATABASE_URL"),
    reason="set AGENT_TEST_DATABASE_URL to run agent DB turn-lease integration test",
)
def test_agent_edit_repo_begin_turn_lease_waits_without_interleaving(monkeypatch) -> None:
    database_url = os.environ["AGENT_TEST_DATABASE_URL"]
    env = {**os.environ, "DATABASE_URL": database_url}
    migration = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(AGENT_DIR / "alembic.ini"), "upgrade", "head"],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert migration.returncode == 0, migration.stderr[-1000:]

    import psycopg  # type: ignore[import-not-found]

    from src import settings as settings_module
    from src.db import AgentEditRepository

    album_id = f"album-{uuid4()}"

    def cleanup() -> None:
        with psycopg.connect(database_url) as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                cur.execute("delete from agent.edit_messages where album_id = %s", (album_id,))
                cur.execute("delete from agent.edit_ops where album_id = %s", (album_id,))
                cur.execute("delete from agent.edit_sessions where album_id = %s", (album_id,))
            conn.commit()

    cleanup()
    try:
        monkeypatch.setenv("DATABASE_URL", database_url)
        settings_module.reset_settings_cache()
        repo = AgentEditRepository()

        async def scenario() -> str:
            first = await repo.begin_serialized_turn(album_id, chapter_id="c1", limit=20)
            second_task = asyncio.create_task(
                repo.begin_serialized_turn(album_id, chapter_id="c1", limit=20)
            )
            await asyncio.sleep(0.2)
            assert second_task.done() is False
            await first.cancel()
            second = await asyncio.wait_for(second_task, timeout=5)
            return await second.create_pending_turn(
                album_id=album_id,
                chapter_id="c1",
                user_content="u",
                assistant_content="a",
                kind="edit_text",
                payload={"patches": []},
                usage={"durationMs": 1},
            )

        op_id = asyncio.run(scenario())

        with psycopg.connect(database_url) as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                cur.execute("select status from agent.edit_ops where op_id = %s", (op_id,))
                assert cur.fetchone()[0] == "pending"
                cur.execute("select session_json from agent.edit_sessions where album_id = %s", (album_id,))
                assert "inFlight" in cur.fetchone()[0]

        assert asyncio.run(repo.acknowledge_op(op_id)) is True
        with psycopg.connect(database_url) as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                cur.execute("select session_json from agent.edit_sessions where album_id = %s", (album_id,))
                assert "inFlight" not in cur.fetchone()[0]
    finally:
        cleanup()
        settings_module.reset_settings_cache()


@pytest.mark.skipif(
    not os.environ.get("AGENT_TEST_DATABASE_URL"),
    reason="set AGENT_TEST_DATABASE_URL to run agent DB ack integration test",
)
def test_agent_edit_repo_ack_integration(monkeypatch) -> None:
    database_url = os.environ["AGENT_TEST_DATABASE_URL"]
    env = {**os.environ, "DATABASE_URL": database_url}
    migration = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(AGENT_DIR / "alembic.ini"), "upgrade", "head"],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert migration.returncode == 0, migration.stderr[-1000:]

    try:
        import psycopg  # type: ignore[import-not-found]
    except ModuleNotFoundError as exc:  # pragma: no cover - opt-in env should install deps
        raise AssertionError("psycopg is required when AGENT_TEST_DATABASE_URL is set") from exc

    from src import settings as settings_module
    from src.db import AgentEditRepository

    album_id = f"album-{uuid4()}"
    op_id = f"op-{uuid4()}"
    talk_content = f"talk-{uuid4()}"

    def cleanup() -> None:
        with psycopg.connect(database_url) as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                cur.execute("delete from agent.edit_messages where album_id = %s", (album_id,))
                cur.execute("delete from agent.edit_ops where album_id = %s", (album_id,))
                cur.execute("delete from agent.edit_sessions where album_id = %s", (album_id,))
            conn.commit()

    cleanup()
    try:
        with psycopg.connect(database_url) as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                cur.execute(
                    "insert into agent.edit_sessions (album_id, session_json) values (%s, '{}'::jsonb) returning id",
                    (album_id,),
                )
                session_id = cur.fetchone()[0]
                cur.execute(
                    """
                    insert into agent.edit_ops (op_id, album_id, session_id, kind, status, payload_json)
                    values (%s, %s, %s, 'edit_text', 'pending', '{}'::jsonb)
                    """,
                    (op_id, album_id, session_id),
                )
                cur.execute(
                    """
                    insert into agent.edit_messages (op_id, album_id, chapter_id, role, content, status)
                    values (%s, %s, 'c1', 'assistant', 'pending message', 'pending')
                    """,
                    (op_id, album_id),
                )
                cur.execute(
                    """
                    insert into agent.edit_messages (op_id, album_id, chapter_id, role, content, status)
                    values (null, %s, 'c1', 'user', %s, 'committed')
                    """,
                    (album_id, talk_content),
                )
            conn.commit()

        monkeypatch.setenv("DATABASE_URL", database_url)
        settings_module.reset_settings_cache()
        repo = AgentEditRepository()

        assert asyncio.run(repo.acknowledge_op(op_id)) is True
        assert asyncio.run(repo.acknowledge_op(op_id)) is True
        assert asyncio.run(repo.acknowledge_op(f"missing-{uuid4()}")) is False

        with psycopg.connect(database_url) as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                cur.execute("select status from agent.edit_ops where op_id = %s", (op_id,))
                assert cur.fetchone()[0] == "committed"
                cur.execute("select status from agent.edit_messages where op_id = %s", (op_id,))
                assert cur.fetchone()[0] == "committed"
                cur.execute(
                    "select status from agent.edit_messages where op_id is null and content = %s",
                    (talk_content,),
                )
                assert cur.fetchone()[0] == "committed"
    finally:
        cleanup()
        settings_module.reset_settings_cache()


@pytest.mark.skipif(
    not os.environ.get("AGENT_TEST_DATABASE_URL"),
    reason="set AGENT_TEST_DATABASE_URL to run agent DB history integration test",
)
def test_agent_edit_repo_committed_history_excludes_pending(monkeypatch) -> None:
    database_url = os.environ["AGENT_TEST_DATABASE_URL"]
    env = {**os.environ, "DATABASE_URL": database_url}
    migration = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(AGENT_DIR / "alembic.ini"), "upgrade", "head"],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert migration.returncode == 0, migration.stderr[-1000:]

    import psycopg  # type: ignore[import-not-found]

    from src import settings as settings_module
    from src.db import AgentEditRepository

    album_id = f"album-{uuid4()}"
    op_id = f"op-{uuid4()}"

    def cleanup() -> None:
        with psycopg.connect(database_url) as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                cur.execute("delete from agent.edit_messages where album_id = %s", (album_id,))
                cur.execute("delete from agent.edit_ops where album_id = %s", (album_id,))
                cur.execute("delete from agent.edit_sessions where album_id = %s", (album_id,))
            conn.commit()

    cleanup()
    try:
        with psycopg.connect(database_url) as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                cur.execute(
                    "insert into agent.edit_sessions (album_id, session_json) values (%s, '{}'::jsonb) returning id",
                    (album_id,),
                )
                session_id = cur.fetchone()[0]
                cur.execute(
                    """
                    insert into agent.edit_ops (op_id, album_id, session_id, kind, status, payload_json)
                    values (%s, %s, %s, 'edit_text', 'pending', '{}'::jsonb)
                    """,
                    (op_id, album_id, session_id),
                )
                cur.execute(
                    """
                    insert into agent.edit_messages (op_id, album_id, chapter_id, role, content, status)
                    values (null, %s, 'c1', 'user', 'committed user', 'committed')
                    """,
                    (album_id,),
                )
                cur.execute(
                    """
                    insert into agent.edit_messages (op_id, album_id, chapter_id, role, content, status)
                    values (%s, %s, 'c1', 'assistant', 'pending assistant', 'pending')
                    """,
                    (op_id, album_id),
                )
            conn.commit()

        monkeypatch.setenv("DATABASE_URL", database_url)
        settings_module.reset_settings_cache()
        repo = AgentEditRepository()

        assert asyncio.run(repo.list_committed_messages(album_id, chapter_id="c1", limit=20)) == [
            {"role": "user", "content": "committed user"}
        ]
    finally:
        cleanup()
        settings_module.reset_settings_cache()


@pytest.mark.skipif(
    not os.environ.get("AGENT_TEST_DATABASE_URL"),
    reason="set AGENT_TEST_DATABASE_URL to run agent DB pending-turn integration test",
)
def test_agent_edit_repo_create_pending_turn_inserts_op_and_messages(monkeypatch) -> None:
    database_url = os.environ["AGENT_TEST_DATABASE_URL"]
    env = {**os.environ, "DATABASE_URL": database_url}
    migration = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(AGENT_DIR / "alembic.ini"), "upgrade", "head"],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert migration.returncode == 0, migration.stderr[-1000:]

    import psycopg  # type: ignore[import-not-found]

    from src import settings as settings_module
    from src.db import AgentEditRepository

    album_id = f"album-{uuid4()}"

    def cleanup() -> None:
        with psycopg.connect(database_url) as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                cur.execute("delete from agent.edit_messages where album_id = %s", (album_id,))
                cur.execute("delete from agent.edit_ops where album_id = %s", (album_id,))
                cur.execute("delete from agent.edit_sessions where album_id = %s", (album_id,))
            conn.commit()

    cleanup()
    try:
        monkeypatch.setenv("DATABASE_URL", database_url)
        settings_module.reset_settings_cache()
        repo = AgentEditRepository()

        op_id = asyncio.run(
            repo.create_pending_turn(
                album_id=album_id,
                chapter_id="c1",
                user_content="u",
                assistant_content="a",
                kind="edit_text",
                payload={"patches": []},
                usage={"durationMs": 1},
            )
        )

        with psycopg.connect(database_url) as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                cur.execute("select status, kind, payload_json from agent.edit_ops where op_id = %s", (op_id,))
                status, kind, payload = cur.fetchone()
                assert status == "pending"
                assert kind == "edit_text"
                assert payload["patches"] == []

                cur.execute(
                    "select role, content, status from agent.edit_messages where op_id = %s order by created_at, role",
                    (op_id,),
                )
                rows = cur.fetchall()
                assert {(role, content, status) for role, content, status in rows} == {
                    ("user", "u", "pending"),
                    ("assistant", "a", "pending"),
                }

        assert asyncio.run(repo.acknowledge_op(op_id)) is True
        with psycopg.connect(database_url) as conn:  # type: ignore[attr-defined]
            with conn.cursor() as cur:
                cur.execute("select status from agent.edit_ops where op_id = %s", (op_id,))
                assert cur.fetchone()[0] == "committed"
                cur.execute("select distinct status from agent.edit_messages where op_id = %s", (op_id,))
                assert cur.fetchall() == [("committed",)]
    finally:
        cleanup()
        settings_module.reset_settings_cache()
