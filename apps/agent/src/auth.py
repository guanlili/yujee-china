from fastapi import Header, HTTPException, status

from .settings import get_settings


async def require_bearer(authorization: str | None = Header(default=None)) -> None:
    settings = get_settings()
    _require_exact_bearer(authorization, settings.agent_shared_secret)


async def require_clip_bearer(authorization: str | None = Header(default=None)) -> None:
    settings = get_settings()
    secret = settings.grouping_clip_secret or settings.agent_shared_secret
    _require_exact_bearer(authorization, secret)


def _require_exact_bearer(authorization: str | None, secret: str) -> None:
    expected = f"Bearer {secret}"
    if not authorization or authorization != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"ok": False, "error": {"code": "AGENT_UNAUTHORIZED", "message": "invalid bearer"}},
        )
