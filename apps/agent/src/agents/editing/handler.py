from __future__ import annotations

from ...schemas import V3EditChatRequest, V3EditChatResponse


class EditChatError(RuntimeError):
    pass


async def run(req: V3EditChatRequest) -> V3EditChatResponse:
    raise EditChatError("not implemented")
