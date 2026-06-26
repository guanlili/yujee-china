from __future__ import annotations

import asyncio
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
