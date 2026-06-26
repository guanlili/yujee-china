from __future__ import annotations

from collections.abc import Awaitable, Callable
from time import perf_counter
from typing import Any, Protocol

from ...db import agent_edit_repo
from ...engine import gemini_layout
from ...schemas import (
    V3ChapterChatRequest,
    V3ChatTurn,
    V3EditChatRequest,
    V3EditChatResponse,
    V3EditProgressDecision,
    V3LayoutPatchEntry,
    V3PageTextsPatch,
    V3Usage,
)
from ..writing import handler as chapter_chat_v3
from .web_client import WebAgentDataClient


class EditChatError(RuntimeError):
    pass


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


def _usage(duration_ms: int, *, models: dict[str, str | None] | None = None) -> V3Usage:
    return V3Usage(durationMs=duration_ms, models=models or {})


def _kind_from_bundle(
    pages_texts: list[V3PageTextsPatch] | None, patches: list[V3LayoutPatchEntry]
) -> str:
    if pages_texts:
        return "write"
    if patches:
        return "edit"
    return "talk"


def _op_kind(
    req: V3EditChatRequest,
    pages_texts: list[V3PageTextsPatch] | None,
    patches: list[V3LayoutPatchEntry],
    progress: V3EditProgressDecision | None,
) -> str:
    text = req.userMessage.lower()
    if "layout" in text or "版式" in text:
        return "swap_layout"
    if "photo" in text or "image" in text or "换图" in text:
        return "swap_image"
    if pages_texts:
        return "write_chapter"
    if patches:
        return "edit_text"
    if progress and progress.chapterDone:
        return "advance"
    return "edit_text"


def _wants_layout_swap(req: V3EditChatRequest) -> bool:
    text = req.userMessage.lower()
    return "layout" in text or "版式" in text


def _page_index(page: dict[str, Any] | Any) -> int | None:
    value = page.get("pageIndex") if isinstance(page, dict) else getattr(page, "pageIndex", None)
    return value if isinstance(value, int) and value >= 0 else None


def _patches_from_pages(
    pages: list[dict[str, Any]], *, page_indexes: list[int]
) -> list[V3LayoutPatchEntry]:
    patches: list[V3LayoutPatchEntry] = []
    for offset, page in enumerate(pages):
        if offset >= len(page_indexes):
            break
        template_id = page.get("templateId")
        if not isinstance(template_id, str) or not template_id:
            continue
        images = page.get("images")
        patches.append(
            V3LayoutPatchEntry(
                pageIndex=page_indexes[offset],
                templateId=template_id,
                images=images if isinstance(images, dict) else None,
                texts=page.get("texts") if isinstance(page.get("texts"), dict) else {},
            )
        )
    return patches


async def _case4_layout_swap(req: V3EditChatRequest, tools: EditTools) -> list[V3LayoutPatchEntry]:
    chapter_id = req.focus.chapterId
    if not chapter_id:
        return []

    page_info = await tools.get_page_info(
        albumId=req.albumId,
        chapterId=chapter_id,
        scope="page" if req.focus.pageIndex is not None else "chapter",
        pageIndex=req.focus.pageIndex,
    )
    page_indexes = [
        idx
        for idx in (_page_index(page) for page in list(page_info.get("pages", []) or []))
        if idx is not None
    ]
    if req.focus.pageIndex is not None:
        page_indexes = [req.focus.pageIndex]
    if not page_indexes:
        return []

    photos = await tools.get_page_photos(albumId=req.albumId, chapterId=chapter_id)
    if not photos:
        return []

    chapters = [{"chapterId": chapter_id, "structureHint": req.userMessage, "photos": photos}]
    result = await gemini_layout.gemini_layout(chapters, mode="case4-swap", allowAddPages=True)
    legal_pages = gemini_layout.legalize_layout(chapters, result.pages)
    return _patches_from_pages(legal_pages, page_indexes=page_indexes)


def _history_turns(rows: list[dict[str, str]]) -> list[V3ChatTurn]:
    turns: list[V3ChatTurn] = []
    for row in rows:
        role = row.get("role")
        content = row.get("content")
        if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
            turns.append(V3ChatTurn(role=role, content=content))
    return turns[-20:]


async def _chapter_chat_bundle(
    req: V3EditChatRequest,
    *,
    history: list[dict[str, str]],
    tools: EditTools,
    complete: Callable[..., Awaitable[dict[str, Any]]] | None = None,
    call_intent: Callable[[str], Awaitable[list[str]]] | None = None,
) -> tuple[str, list[V3PageTextsPatch] | None, list[V3LayoutPatchEntry], V3Usage]:
    chapter_id = req.focus.chapterId
    if not chapter_id:
        return "Tell me more about what you want to change.", None, [], _usage(1)

    page_info = await tools.get_page_info(
        albumId=req.albumId,
        chapterId=chapter_id,
        scope="chapter",
        pageIndex=None,
    )
    chapter_req = V3ChapterChatRequest(
        albumId=req.albumId,
        language=req.language,
        chapter=page_info["chapter"],
        pages=page_info["pages"],
        history=_history_turns(history),
        userMessage=req.userMessage,
        **({"focusedPageIndex": req.focus.pageIndex} if req.focus.pageIndex is not None else {}),
    )
    response = await chapter_chat_v3.run(
        chapter_req,
        complete=complete,
        call_intent=call_intent,
    )
    return (
        response.assistantReply,
        response.pagesTexts,
        response.layoutPatch or [],
        response.usage,
    )


async def run(
    req: V3EditChatRequest,
    *,
    repo: EditRepo | None = None,
    tools: EditTools | None = None,
    complete: Callable[..., Awaitable[dict[str, Any]]] | None = None,
    call_intent: Callable[[str], Awaitable[list[str]]] | None = None,
) -> V3EditChatResponse:
    start = perf_counter()
    repo = repo or agent_edit_repo
    tools = tools or WebAgentDataClient()

    history = await repo.list_committed_messages(req.albumId, chapter_id=req.focus.chapterId, limit=20)

    patches: list[V3LayoutPatchEntry] = []
    pages_texts: list[V3PageTextsPatch] | None = None
    progress: V3EditProgressDecision | None = None
    assistant_reply = "Tell me more about what you want to change."
    usage: V3Usage | None = None

    if _wants_layout_swap(req):
        try:
            patches = await _case4_layout_swap(req, tools)
        except Exception as exc:
            raise EditChatError(f"case4 layout swap failed: {exc}") from exc
        if patches:
            assistant_reply = "Updated the layout."
    elif req.focus.chapterId:
        try:
            assistant_reply, pages_texts, patches, usage = await _chapter_chat_bundle(
                req,
                history=history,
                tools=tools,
                complete=complete,
                call_intent=call_intent,
            )
        except Exception as exc:
            raise EditChatError(f"chapter edit failed: {exc}") from exc

    duration_ms = max(1, int((perf_counter() - start) * 1000))
    usage = usage or _usage(duration_ms)
    op_kind = _op_kind(req, pages_texts, patches, progress)
    payload = {
        "kind": _kind_from_bundle(pages_texts, patches),
        "patches": [patch.model_dump(exclude_none=True, mode="json") for patch in patches],
        "pagesTexts": [patch.model_dump(mode="json") for patch in pages_texts] if pages_texts else None,
        "progressDecision": progress.model_dump(mode="json") if progress else None,
        "history": history,
    }
    op_id = await repo.create_pending_turn(
        album_id=req.albumId,
        chapter_id=req.focus.chapterId,
        user_content=req.userMessage,
        assistant_content=assistant_reply,
        kind=op_kind,
        payload=payload,
        usage=usage.model_dump(mode="json"),
    )

    return V3EditChatResponse(
        kind=_kind_from_bundle(pages_texts, patches),
        assistantReply=assistant_reply,
        patches=patches,
        pagesTexts=pages_texts,
        progressDecision=progress,
        opId=op_id,
        usage=usage,
    )
