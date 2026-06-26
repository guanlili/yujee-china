"""Agent-owned database boundary.

The Web app owns public album state through Drizzle. The Agent owns only the
edit-loop tables in the independent `agent` schema. This module intentionally
does not read or write `public.albums`; cross-service album data is fetched via
internal HTTP surfaces.
"""

from __future__ import annotations

import asyncio
from typing import Any
from uuid import uuid4

from .logging_config import get_logger
from .settings import get_settings

log = get_logger("agent_db")


class AgentDbUnavailable(RuntimeError):
    """Agent-owned DB boundary is unavailable or misconfigured."""


class AgentEditRepository:
    async def list_committed_messages(
        self, album_id: str, *, chapter_id: str | None, limit: int = 20
    ) -> list[dict[str, str]]:
        settings = get_settings()
        if not settings.database_url:
            raise AgentDbUnavailable("DATABASE_URL is required for agent edit history")

        try:
            import psycopg  # type: ignore[import-not-found]
        except ModuleNotFoundError as exc:
            log.warning("agent_db.psycopg_missing")
            raise AgentDbUnavailable("psycopg is required for agent edit history") from exc

        def run() -> list[dict[str, str]]:
            with psycopg.connect(settings.database_url) as conn:  # type: ignore[attr-defined]
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        select role, content
                          from agent.edit_messages
                         where album_id = %s
                           and status = 'committed'
                           and (%s::text is null or chapter_id = %s)
                         order by created_at desc
                         limit %s
                        """,
                        (album_id, chapter_id, chapter_id, limit),
                    )
                    rows = cur.fetchall()
            return [{"role": role, "content": content} for role, content in reversed(rows)]

        try:
            return await asyncio.to_thread(run)
        except Exception as exc:
            log.warning("agent_db.history_failed", error=str(exc))
            raise AgentDbUnavailable("agent edit history database operation failed") from exc

    async def create_pending_turn(
        self,
        *,
        album_id: str,
        chapter_id: str | None,
        user_content: str,
        assistant_content: str,
        kind: str,
        payload: dict[str, Any],
        usage: dict[str, Any] | None = None,
    ) -> str:
        settings = get_settings()
        if not settings.database_url:
            raise AgentDbUnavailable("DATABASE_URL is required for agent edit pending turn")

        try:
            import psycopg  # type: ignore[import-not-found]
            from psycopg.types.json import Jsonb  # type: ignore[import-not-found]
        except ModuleNotFoundError as exc:
            log.warning("agent_db.psycopg_missing")
            raise AgentDbUnavailable("psycopg is required for agent edit pending turn") from exc

        op_id = f"op_{uuid4().hex}"
        session_json = {"albumId": album_id, "chapterId": chapter_id}
        payload_json: dict[str, Any] = dict(payload)
        if usage is not None:
            payload_json["usage"] = usage

        def run() -> str:
            with psycopg.connect(settings.database_url) as conn:  # type: ignore[attr-defined]
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        insert into agent.edit_sessions (album_id, version, session_json)
                        values (%s, 0, %s::jsonb)
                        on conflict (album_id)
                        do update set
                          version = agent.edit_sessions.version + 1,
                          session_json = excluded.session_json,
                          updated_at = now()
                        returning id
                        """,
                        (album_id, Jsonb(session_json)),
                    )
                    session_id = cur.fetchone()[0]
                    cur.execute(
                        """
                        insert into agent.edit_ops (op_id, album_id, session_id, kind, status, payload_json)
                        values (%s, %s, %s, %s, 'pending', %s::jsonb)
                        """,
                        (op_id, album_id, session_id, kind, Jsonb(payload_json)),
                    )
                    cur.execute(
                        """
                        insert into agent.edit_messages (op_id, album_id, chapter_id, role, content, status)
                        values (%s, %s, %s, 'user', %s, 'pending')
                        """,
                        (op_id, album_id, chapter_id, user_content),
                    )
                    cur.execute(
                        """
                        insert into agent.edit_messages (op_id, album_id, chapter_id, role, content, status)
                        values (%s, %s, %s, 'assistant', %s, 'pending')
                        """,
                        (op_id, album_id, chapter_id, assistant_content),
                    )
                conn.commit()
            return op_id

        try:
            return await asyncio.to_thread(run)
        except Exception as exc:
            log.warning("agent_db.pending_turn_failed", error=str(exc))
            raise AgentDbUnavailable("agent edit pending turn database operation failed") from exc

    async def acknowledge_op(self, op_id: str) -> bool:
        """Mark an edit op and its associated messages committed.

        Idempotent: a known committed op still returns True. Unknown opIds return
        False so Web callers are not disrupted by stale retries.
        """
        settings = get_settings()
        if not settings.database_url:
            raise AgentDbUnavailable("DATABASE_URL is required for agent edit ack")

        try:
            import psycopg  # type: ignore[import-not-found]
        except ModuleNotFoundError as exc:
            log.warning("agent_db.psycopg_missing")
            raise AgentDbUnavailable("psycopg is required for agent edit ack") from exc

        def run() -> bool:
            with psycopg.connect(settings.database_url) as conn:  # type: ignore[attr-defined]
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        update agent.edit_ops
                           set status = 'committed'
                         where op_id = %s
                           and status in ('pending', 'committed')
                     returning id
                        """,
                        (op_id,),
                    )
                    row: Any = cur.fetchone()
                    if row is None:
                        conn.commit()
                        return False

                    cur.execute(
                        """
                        update agent.edit_messages
                           set status = 'committed'
                         where op_id = %s
                           and status = 'pending'
                        """,
                        (op_id,),
                    )
                    conn.commit()
                    return True

        try:
            return await asyncio.to_thread(run)
        except Exception as exc:
            log.warning("agent_db.ack_failed", error=str(exc))
            raise AgentDbUnavailable("agent edit ack database operation failed") from exc


agent_edit_repo = AgentEditRepository()
