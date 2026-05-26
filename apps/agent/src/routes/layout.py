from fastapi import APIRouter, Depends

from ..auth import require_bearer

router = APIRouter()


@router.post("/v1/layout", status_code=202, dependencies=[Depends(require_bearer)])
async def submit_layout() -> dict:
    return {"ok": True, "data": {"requestId": "", "accepted": True}}
