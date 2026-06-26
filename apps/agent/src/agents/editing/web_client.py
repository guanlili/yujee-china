from __future__ import annotations

from typing import Any

import httpx

from ...settings import get_settings


class WebAgentDataClient:
    async def get_page_info(
        self,
        *,
        albumId: str,
        chapterId: str,
        scope: str,
        pageIndex: int | None = None,
    ) -> dict[str, Any]:
        settings = get_settings()
        url = f"{settings.web_base_url.rstrip('/')}/api/v3/internal/agent-data"
        params: dict[str, Any] = {
            "type": "page-info",
            "albumId": albumId,
            "chapterId": chapterId,
            "scope": scope,
        }
        if pageIndex is not None:
            params["pageIndex"] = pageIndex
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                url,
                params=params,
                headers={"Authorization": f"Bearer {settings.agent_shared_secret}"},
            )
            resp.raise_for_status()
            body = resp.json()
        if body.get("type") != "page-info":
            raise RuntimeError("agent-data page-info returned wrong type")
        data = body.get("data")
        if not isinstance(data, dict):
            raise RuntimeError("agent-data page-info missing data")
        return data

    async def get_page_photos(self, *, albumId: str, chapterId: str) -> list[dict[str, Any]]:
        settings = get_settings()
        url = f"{settings.web_base_url.rstrip('/')}/api/v3/internal/agent-data"
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                url,
                params={"type": "page-photos", "albumId": albumId, "chapterId": chapterId},
                headers={"Authorization": f"Bearer {settings.agent_shared_secret}"},
            )
            resp.raise_for_status()
            body = resp.json()
        if body.get("type") != "page-photos":
            raise RuntimeError("agent-data page-photos returned wrong type")
        return list(body.get("data", {}).get("photos", []))
