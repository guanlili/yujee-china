from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .logging_config import configure_logging, get_logger, request_id_var
from .routes import health, layout
from .settings import get_settings


settings = get_settings()
configure_logging(settings.log_level)
log = get_logger("agent")

app = FastAPI(title="Yujee Agent", version="1.0.0")
app.include_router(health.router)
app.include_router(layout.router)


@app.middleware("http")
async def bind_request_id(request: Request, call_next):
    rid = request.headers.get("x-request-id", "-")
    token = request_id_var.set(rid)
    try:
        log.info("request.start", method=request.method, path=request.url.path)
        response = await call_next(request)
        log.info("request.end", status=response.status_code)
        return response
    finally:
        request_id_var.reset(token)


@app.exception_handler(StarletteHTTPException)
async def http_exc_handler(_: Request, exc: StarletteHTTPException):
    if isinstance(exc.detail, dict) and "ok" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={"ok": False, "error": {"code": "AGENT_INTERNAL_ERROR", "message": str(exc.detail)}},
    )


@app.exception_handler(RequestValidationError)
async def validation_exc_handler(_: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content={
            "ok": False,
            "error": {"code": "AGENT_INVALID_INPUT", "message": str(exc.errors()[0] if exc.errors() else "invalid input")},
        },
    )
