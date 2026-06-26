"""Agent-owned database boundary.

The Web app owns public album state through Drizzle. The Agent owns only the
edit-loop tables in the independent `agent` schema. This module intentionally
does not read or write `public.albums`; cross-service album data is fetched via
internal HTTP surfaces.
"""

from __future__ import annotations

import asyncio
from typing import Any

from .logging_config import get_logger
from .settings import get_settings

log = get_logger("agent_db")


class AgentDbUnavailable(RuntimeError):
    """Agent-owned DB boundary is unavailable or misconfigured."""


class AgentEditRepository:
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
