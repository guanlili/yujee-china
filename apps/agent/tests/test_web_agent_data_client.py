"""WebAgentDataClient(story/web_client)契约测试 —— 所有流程共享的 agent-data 客户端。

从已删除的 test_chat_edit_v3 迁来:验证它解开 Web `{ok, data:{type, data}}` 信封,且把
type/params 正确发出。WebAgentDataClient 现是 edit_loop / cover 等流程的共享读取器。
"""

from __future__ import annotations

import asyncio
from typing import Any

from src.story.web_client import WebAgentDataClient


class _FakeHttpResponse:
    def __init__(self, body: dict[str, Any]) -> None:
        self._body = body

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self._body


def test_web_agent_data_client_unwraps_web_ok_envelope(monkeypatch):
    from src import settings as settings_module

    bodies = [
        {
            "ok": True,
            "data": {
                "type": "page-info",
                "data": {"chapter": {"chapterId": "c1"}, "pages": []},
            },
        },
        {
            "ok": True,
            "data": {
                "type": "page-photos",
                "data": {
                    "photos": [
                        {
                            "photoId": "p1",
                            "ref200px": "data:image/jpeg;base64,AA==",
                            "orientation": "landscape",
                            "takenAt": None,
                        }
                    ]
                },
            },
        },
    ]
    calls: list[dict[str, Any]] = []

    class FakeAsyncClient:
        def __init__(self, *, timeout: int) -> None:
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, url: str, *, params: dict[str, Any], headers: dict[str, str]):
            calls.append({"url": url, "params": params, "headers": headers})
            return _FakeHttpResponse(bodies.pop(0))

    monkeypatch.setenv("AGENT_SHARED_SECRET", "shared")
    monkeypatch.setenv("WEB_BASE_URL", "http://web.test")
    settings_module.reset_settings_cache()
    monkeypatch.setattr("src.story.web_client.httpx.AsyncClient", FakeAsyncClient)

    client = WebAgentDataClient()
    page_info = asyncio.run(
        client.get_page_info(albumId="alb", chapterId="c1", scope="chapter")
    )
    page_photos = asyncio.run(client.get_page_photos(albumId="alb", chapterId="c1"))

    assert page_info["chapter"]["chapterId"] == "c1"
    assert page_photos[0]["photoId"] == "p1"
    assert calls[0]["params"]["type"] == "page-info"
    assert calls[1]["params"]["type"] == "page-photos"
