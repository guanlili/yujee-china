"""Shared HTTP error mapping for the V3 *sync* endpoints (P1 de-dup).

The 5 sync `/v3/*` endpoints (chapter-chat, recommend, apply-theme, cover,
finalize) all wrapped their model/engine call in the SAME try/except:

  * a KNOWN service error → `log.warning("<name>.failed", ...)` + an
    `HTTPException(status, contract-error-detail)` carrying that endpoint's
    status + error code;
  * any other `Exception` → `log.exception("<name>.unhandled", ...)` + a 500
    `AGENT_INTERNAL_ERROR` in the same contract shape.

`sync_endpoint_errors` is a context manager around just that call. The success
path, the surrounding `log.info(...accepted/completed...)` calls, and the
message truncation (`str(exc)[:300]`) stay exactly as they were — this is a pure
relocation, so the emitted log calls and HTTPException are byte-identical to the
inlined versions.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

from fastapi import HTTPException, status

# The contract error envelope every sync endpoint returns on failure.
INTERNAL_ERROR_CODE = "AGENT_INTERNAL_ERROR"


def _contract_detail(code: str, exc: BaseException) -> dict[str, Any]:
    """The `detail=` payload for the contract error shape (truncated message)."""
    return {
        "ok": False,
        "error": {"code": code, "message": str(exc)[:300]},
    }


@contextmanager
def sync_endpoint_errors(
    log: Any,
    name: str,
    known_error: type[BaseException],
    *,
    known_status: int,
    known_code: str,
) -> Iterator[None]:
    """Map a sync endpoint's call failures to the V3 contract error responses.

    Wrap ONLY the model/engine call:

        with sync_endpoint_errors(log, "v3_cover", CoverV3Error,
                                  known_status=422, known_code="AGENT_OUTPUT_VALIDATION"):
            response = cover_v3.build_cover(req)

    On `known_error`: `log.warning("<name>.failed", error=str(exc))` then raise
    `HTTPException(known_status, contract detail with known_code)`.
    On any other Exception: `log.exception("<name>.unhandled", error=str(exc))`
    then raise `HTTPException(500, contract detail with AGENT_INTERNAL_ERROR)`.
    """
    try:
        yield
    except known_error as exc:
        log.warning(f"{name}.failed", error=str(exc))
        raise HTTPException(
            status_code=known_status,
            detail=_contract_detail(known_code, exc),
        ) from exc
    except Exception as exc:  # noqa: BLE001 — must answer in contract shape
        log.exception(f"{name}.unhandled", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=_contract_detail(INTERNAL_ERROR_CODE, exc),
        ) from exc
