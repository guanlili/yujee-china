import asyncio
from typing import Union

import httpx

from ..logging_config import get_logger
from ..schemas import CompletedCallback, FailedCallback, ProgressCallback
from ..schemas_v2 import (
    V2FailedCallback,
    V2FinalizeCompletedCallback,
    V2InitCompletedCallback,
    V2ProgressCallback,
)
from ..settings import get_settings

log = get_logger("callback")

_TIMEOUT_SECONDS = 10
_RETRY_BACKOFFS = (1, 4)

# v1 and v2 envelopes share the duck-typed contract this poster relies on:
# `.event` (for logging), `.requestId` (for the giveup log), and a pydantic
# `model_dump`. v2 callbacks go to a separate Web route (`/api/v2/internal/
# job-progress`); the URL is the caller's choice, the wire mechanics are shared.
Envelope = Union[
    ProgressCallback,
    CompletedCallback,
    FailedCallback,
    V2ProgressCallback,
    V2InitCompletedCallback,
    V2FinalizeCompletedCallback,
    V2FailedCallback,
]


async def post(callback_url: str, envelope: Envelope) -> bool:
    settings = get_settings()
    body = envelope.model_dump(exclude_none=True, mode="json")
    headers = {
        "Authorization": f"Bearer {settings.agent_shared_secret}",
        "Content-Type": "application/json",
    }
    attempts = 1 + len(_RETRY_BACKOFFS)
    for attempt in range(1, attempts + 1):
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
                resp = await client.post(callback_url, json=body, headers=headers)
            if resp.status_code < 500:
                log.info(
                    "callback.sent",
                    cb_event=envelope.event,
                    status=resp.status_code,
                    attempt=attempt,
                )
                return True
            log.warning("callback.5xx", status=resp.status_code, attempt=attempt)
        except (httpx.HTTPError, asyncio.TimeoutError) as exc:
            log.warning("callback.error", error=str(exc), attempt=attempt)
        if attempt <= len(_RETRY_BACKOFFS):
            await asyncio.sleep(_RETRY_BACKOFFS[attempt - 1])
    log.error("callback.giveup", cb_event=envelope.event, request_id=envelope.requestId)
    return False
