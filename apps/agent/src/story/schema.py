"""章节故事业务层内部协议。"""

from __future__ import annotations

from collections.abc import Awaitable
from typing import Any, Protocol


class EditTurn(Protocol):
    history: list[dict[str, str]]
    session_json: dict[str, Any]

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
    ) -> str: ...

    async def cancel(self) -> None: ...


class EditRepo(Protocol):
    async def list_committed_messages(
        self, album_id: str, *, chapter_id: str | None, limit: int = 20
    ) -> list[dict[str, str]]: ...

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
    ) -> str: ...

    async def begin_serialized_turn(
        self, album_id: str, *, chapter_id: str | None, limit: int = 20
    ) -> EditTurn: ...


class EditTools(Protocol):
    async def get_page_info(
        self,
        *,
        albumId: str,
        chapterId: str,
        scope: str,
        pageIndex: int | None = None,
    ) -> dict[str, Any]: ...

    async def get_page_photos(self, *, albumId: str, chapterId: str) -> list[dict[str, Any]]: ...

    async def get_book_tree(
        self,
        *,
        albumId: str,
        chapterId: str | None = None,
        pageIndex: int | None = None,
    ) -> dict[str, Any]: ...


CompleteFn = Awaitable[dict[str, Any]]

__all__ = ["CompleteFn", "EditRepo", "EditTools", "EditTurn"]
