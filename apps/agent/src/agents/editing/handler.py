from __future__ import annotations

from time import perf_counter
from typing import Any, Protocol

from ...db import agent_edit_repo
from ...engine import gemini_layout
from ...schemas import (
    V3EditChatRequest,
    V3EditChatResponse,
    V3EditProgressDecision,
    V3LayoutPatchEntry,
    V3PageTextsPatch,
    V3Usage,
)
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


def _patches_from_pages(
    pages: list[dict[str, Any]], *, base_page_index: int
) -> list[V3LayoutPatchEntry]:
    patches: list[V3LayoutPatchEntry] = []
    for offset, page in enumerate(pages):
        template_id = page.get("templateId")
        if not isinstance(template_id, str) or not template_id:
            continue
        images = page.get("images")
        patches.append(
            V3LayoutPatchEntry(
                pageIndex=base_page_index + offset,
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

    photos = await tools.get_page_photos(albumId=req.albumId, chapterId=chapter_id)
    if not photos:
        return []

    chapters = [{"chapterId": chapter_id, "structureHint": req.userMessage, "photos": photos}]
    result = await gemini_layout.gemini_layout(chapters, mode="case4-swap", allowAddPages=True)
    legal_pages = gemini_layout.legalize_layout(chapters, result.pages)
    return _patches_from_pages(legal_pages, base_page_index=req.focus.pageIndex or 0)


async def run(
    req: V3EditChatRequest,
    *,
    repo: EditRepo | None = None,
    tools: EditTools | None = None,
) -> V3EditChatResponse:
    start = perf_counter()
    repo = repo or agent_edit_repo
    tools = tools or WebAgentDataClient()

    history = await repo.list_committed_messages(req.albumId, chapter_id=req.focus.chapterId, limit=20)

    patches: list[V3LayoutPatchEntry] = []
    pages_texts: list[V3PageTextsPatch] | None = None
    progress: V3EditProgressDecision | None = None
    assistant_reply = "Tell me more about what you want to change."

    if _wants_layout_swap(req):
        try:
            patches = await _case4_layout_swap(req, tools)
        except Exception as exc:
            raise EditChatError(f"case4 layout swap failed: {exc}") from exc
        if patches:
            assistant_reply = "Updated the layout."

    duration_ms = max(1, int((perf_counter() - start) * 1000))
    usage = _usage(duration_ms)
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
