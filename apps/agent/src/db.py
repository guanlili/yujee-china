"""Agent-owned database boundary.

The Web app owns public album state through Drizzle. The Agent owns only the
edit-loop tables in the independent `agent` schema. This module intentionally
does not read or write `public.albums`; cross-service album data is fetched via
internal HTTP surfaces.
"""

from __future__ import annotations

import asyncio
from time import monotonic, time
from typing import Any
from uuid import uuid4

from .logging_config import get_logger
from .settings import get_settings

log = get_logger("agent_db")
_TURN_LEASE_POLL_SECONDS = 0.1
_TURN_LEASE_WAIT_SECONDS = 30.0
_TURN_LEASE_STALE_SECONDS = 300.0


class AgentDbUnavailable(RuntimeError):
    """Agent-owned DB boundary is unavailable or misconfigured."""


class _TurnAlreadyInFlight(RuntimeError):
    pass


def _as_session_json(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _in_flight_turn_id(session_json: Any) -> str | None:
    in_flight = _as_session_json(session_json).get("inFlight")
    if not isinstance(in_flight, dict):
        return None
    turn_id = in_flight.get("turnId")
    return turn_id if isinstance(turn_id, str) and turn_id else None


def _in_flight_is_stale(session_json: Any, now: float) -> bool:
    in_flight = _as_session_json(session_json).get("inFlight")
    if not isinstance(in_flight, dict):
        return True
    started_at = in_flight.get("startedAt")
    if not isinstance(started_at, (int, float)):
        return True
    return now - float(started_at) > _TURN_LEASE_STALE_SECONDS


class _SerializedTurnLease:
    def __init__(
        self,
        *,
        album_id: str,
        chapter_id: str | None,
        turn_id: str,
        history: list[dict[str, str]],
    ) -> None:
        self.album_id = album_id
        self.chapter_id = chapter_id
        self.turn_id = turn_id
        self.history = history

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
        if album_id != self.album_id or chapter_id != self.chapter_id:
            raise AgentDbUnavailable("agent edit turn lease album/chapter mismatch")

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
        payload_json: dict[str, Any] = dict(payload)
        payload_json["_turnId"] = self.turn_id
        if usage is not None:
            payload_json["usage"] = usage

        def run() -> str:
            with psycopg.connect(settings.database_url) as conn:  # type: ignore[attr-defined]
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        select id, session_json
                          from agent.edit_sessions
                         where album_id = %s
                         for update
                        """,
                        (album_id,),
                    )
                    row = cur.fetchone()
                    if row is None:
                        raise AgentDbUnavailable("agent edit turn lease session is missing")
                    session_id, session_json = row
                    if _in_flight_turn_id(session_json) != self.turn_id:
                        raise AgentDbUnavailable("agent edit turn lease is no longer active")
                    current_session_json = _as_session_json(session_json)

                    cur.execute(
                        """
                        update agent.edit_sessions
                           set version = version + 1,
                               session_json = %s::jsonb,
                               updated_at = now()
                         where id = %s
                        """,
                        (
                            Jsonb(
                                {
                                    **current_session_json,
                                    "albumId": album_id,
                                    "chapterId": chapter_id,
                                    "inFlight": current_session_json.get("inFlight"),
                                }
                            ),
                            session_id,
                        ),
                    )
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
        except AgentDbUnavailable:
            raise
        except Exception as exc:
            log.warning("agent_db.serialized_turn_pending_failed", error=str(exc))
            raise AgentDbUnavailable("agent edit serialized pending turn failed") from exc

    async def cancel(self) -> None:
        settings = get_settings()
        if not settings.database_url:
            raise AgentDbUnavailable("DATABASE_URL is required for agent edit turn cancel")

        try:
            import psycopg  # type: ignore[import-not-found]
            from psycopg.types.json import Jsonb  # type: ignore[import-not-found]
        except ModuleNotFoundError as exc:
            log.warning("agent_db.psycopg_missing")
            raise AgentDbUnavailable("psycopg is required for agent edit turn cancel") from exc

        def run() -> None:
            with psycopg.connect(settings.database_url) as conn:  # type: ignore[attr-defined]
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        select id, session_json
                          from agent.edit_sessions
                         where album_id = %s
                         for update
                        """,
                        (self.album_id,),
                    )
                    row = cur.fetchone()
                    if row is None:
                        conn.commit()
                        return
                    session_id, session_json = row
                    if _in_flight_turn_id(session_json) != self.turn_id:
                        conn.commit()
                        return
                    next_session_json = {
                        **_as_session_json(session_json),
                        "albumId": self.album_id,
                        "chapterId": self.chapter_id,
                    }
                    next_session_json.pop("inFlight", None)
                    cur.execute(
                        """
                        update agent.edit_sessions
                           set session_json = %s::jsonb,
                               updated_at = now()
                         where id = %s
                        """,
                        (Jsonb(next_session_json), session_id),
                    )
                conn.commit()

        try:
            await asyncio.to_thread(run)
        except Exception as exc:
            log.warning("agent_db.serialized_turn_cancel_failed", error=str(exc))
            raise AgentDbUnavailable("agent edit serialized turn cancel failed") from exc


class AgentEditRepository:
    async def begin_serialized_turn(
        self, album_id: str, *, chapter_id: str | None, limit: int = 20
    ) -> _SerializedTurnLease:
        settings = get_settings()
        if not settings.database_url:
            raise AgentDbUnavailable("DATABASE_URL is required for agent edit turn serialization")

        try:
            import psycopg  # type: ignore[import-not-found]
            from psycopg.types.json import Jsonb  # type: ignore[import-not-found]
        except ModuleNotFoundError as exc:
            log.warning("agent_db.psycopg_missing")
            raise AgentDbUnavailable("psycopg is required for agent edit turn serialization") from exc

        turn_id = f"turn_{uuid4().hex}"

        def run() -> list[dict[str, str]]:
            with psycopg.connect(settings.database_url) as conn:  # type: ignore[attr-defined]
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        insert into agent.edit_sessions (album_id, version, session_json)
                        values (%s, 0, %s::jsonb)
                        on conflict (album_id)
                        do update set updated_at = now()
                        returning id
                        """,
                        (album_id, Jsonb({"albumId": album_id, "chapterId": chapter_id})),
                    )
                    cur.execute(
                        """
                        select id, session_json
                          from agent.edit_sessions
                         where album_id = %s
                         for update
                        """,
                        (album_id,),
                    )
                    session_id, session_json = cur.fetchone()
                    if _in_flight_turn_id(session_json) and not _in_flight_is_stale(
                        session_json, time()
                    ):
                        raise _TurnAlreadyInFlight()

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
                    next_session_json = {
                        **_as_session_json(session_json),
                        "albumId": album_id,
                        "chapterId": chapter_id,
                        "inFlight": {
                            "turnId": turn_id,
                            "chapterId": chapter_id,
                            "startedAt": time(),
                        },
                    }
                    cur.execute(
                        """
                        update agent.edit_sessions
                           set session_json = %s::jsonb,
                               updated_at = now()
                         where id = %s
                        """,
                        (Jsonb(next_session_json), session_id),
                    )
                conn.commit()
            return [{"role": role, "content": content} for role, content in reversed(rows)]

        deadline = monotonic() + _TURN_LEASE_WAIT_SECONDS
        while True:
            try:
                history = await asyncio.to_thread(run)
                break
            except _TurnAlreadyInFlight as exc:
                if monotonic() >= deadline:
                    raise AgentDbUnavailable("agent edit turn already in flight") from exc
                await asyncio.sleep(_TURN_LEASE_POLL_SECONDS)
            except AgentDbUnavailable:
                raise
            except Exception as exc:
                log.warning("agent_db.serialized_turn_begin_failed", error=str(exc))
                raise AgentDbUnavailable("agent edit serialized turn database operation failed") from exc

        return _SerializedTurnLease(
            album_id=album_id,
            chapter_id=chapter_id,
            turn_id=turn_id,
            history=history,
        )

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
            from psycopg.types.json import Jsonb  # type: ignore[import-not-found]
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
                     returning id, session_id, album_id, payload_json
                        """,
                        (op_id,),
                    )
                    row: Any = cur.fetchone()
                    if row is None:
                        conn.commit()
                        return False
                    _op_pk, session_id, album_id, payload_json = row
                    turn_id = (
                        payload_json.get("_turnId")
                        if isinstance(payload_json, dict)
                        else None
                    )

                    cur.execute(
                        """
                        update agent.edit_messages
                           set status = 'committed'
                         where op_id = %s
                           and status = 'pending'
                        """,
                        (op_id,),
                    )
                    if isinstance(turn_id, str) and turn_id:
                        cur.execute(
                            """
                            select session_json
                              from agent.edit_sessions
                             where id = %s
                             for update
                            """,
                            (session_id,),
                        )
                        session_row = cur.fetchone()
                        if session_row is not None:
                            session_json = session_row[0]
                            if _in_flight_turn_id(session_json) == turn_id:
                                next_session_json = {
                                    **_as_session_json(session_json),
                                    "albumId": album_id,
                                }
                                next_session_json.pop("inFlight", None)
                                cur.execute(
                                    """
                                    update agent.edit_sessions
                                       set session_json = %s::jsonb,
                                           updated_at = now()
                                     where id = %s
                                    """,
                                    (Jsonb(next_session_json), session_id),
                                )
                    conn.commit()
                    return True

        try:
            return await asyncio.to_thread(run)
        except Exception as exc:
            log.warning("agent_db.ack_failed", error=str(exc))
            raise AgentDbUnavailable("agent edit ack database operation failed") from exc


agent_edit_repo = AgentEditRepository()
