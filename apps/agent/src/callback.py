import asyncio
from typing import Union

import httpx

from .logging_config import get_logger
from .schemas import (
    V3AnalyzeCompleted,
    V3FailedEvent,
    V3ProgressEvent,
)
from .settings import get_settings

log = get_logger("callback")

_TIMEOUT_SECONDS = 10
_RETRY_BACKOFFS = (1, 4)

# All envelopes share the duck-typed contract this poster relies on: `.event`
# (for logging), `.requestId` (for the giveup log), and a pydantic `model_dump`.
# The V3 analyze job posts to the Web callback URL supplied by the request.
Envelope = Union[V3ProgressEvent, V3AnalyzeCompleted, V3FailedEvent]


def _serialize(envelope: Envelope) -> dict:
    """JSON body for an envelope, honoring the two-end (zod) contract shape.

    Default rule (progress/failed): `exclude_none=True` —
    drop absent optionals so the wire stays tidy (their TS counterparts are
    `.optional()`, key-absent is the accepted shape).

    V3AnalyzeCompleted is the exception: its `tree` carries REQUIRED-NULLABLE keys
    (`chapter.accentColor`/`artFont` are null placeholders until the theme stage —
    TS `AccentColor.nullable()` requires the KEY to be present). `exclude_none=True`
    would silently drop those keys and the Web zod `.strict()` parse would reject
    the callback. So we dump with `exclude_none=False` to preserve the null
    placeholders, then prune only the genuinely-optional `usage.models.{vision,
    planning}` fields when null (TS types them `.optional()`, not `.nullable()`, so
    an explicit null there would be rejected — absent is the contract shape)."""
    if isinstance(envelope, V3AnalyzeCompleted):
        body = envelope.model_dump(exclude_none=False, mode="json")
        models = body.get("usage", {}).get("models")
        if isinstance(models, dict):
            for key in ("vision", "planning"):
                if models.get(key) is None:
                    models.pop(key, None)
        return body
    return envelope.model_dump(exclude_none=True, mode="json")


async def post(callback_url: str, envelope: Envelope) -> bool:
    settings = get_settings()
    body = _serialize(envelope)
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
