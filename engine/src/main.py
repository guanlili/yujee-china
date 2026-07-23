from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .logging_config import configure_logging, get_logger, request_id_var
from .api import routes
from .providers.vision_provider import resolved_vision_model
from .settings import get_settings


def _validate_startup_config() -> None:
    """Fail-fast checks for Agent startup config; see docs/agent/design.md.

    - AGENT_PIPELINE_MODE must be 'mock' or 'real' (Settings literal enforces this).
    - production env may only run with mode=real.
    - real mode demands the API keys at startup so the first user request doesn't
      blow up (or, worse, silently degrade) on credentials we could have detected
      at boot.

    SELECT_LAYOUT_API_KEY 是**必检**的:名字是历史产物,它是仓里唯一的 Gemini 槽,
    如今唯一的用途就是 ④ `/v3/compose` 成稿(`/v3/select-layout` 自己是纯确定性的,
    不用这把 key)。缺它时 compose 不会报错 —— 每章记一条 warning,照常发 `completed`
    + 空 `pagesTexts`,观测台上一片绿,用户却拿到一本全是模板示例文案的书。这种「静默
    成功」必须在启动时就拦下。
    """
    settings = get_settings()
    if settings.agent_env == "production" and settings.agent_pipeline_mode != "real":
        raise RuntimeError(
            "AGENT_ENV=production requires AGENT_PIPELINE_MODE=real "
            f"(got {settings.agent_pipeline_mode!r})"
        )
    if settings.agent_pipeline_mode == "real":
        missing: list[str] = []
        if not settings.ark_api_key:
            missing.append("ARK_API_KEY")
        if not settings.deepseek_api_key:
            missing.append("DEEPSEEK_API_KEY")
        if not settings.select_layout_api_key:
            missing.append("SELECT_LAYOUT_API_KEY")
        if missing:
            raise RuntimeError(
                "AGENT_PIPELINE_MODE=real requires env vars: " + ", ".join(missing)
            )


settings = get_settings()
configure_logging(settings.log_level)
_validate_startup_config()
log = get_logger("agent")

app = FastAPI(title="Yujee Agent", version="1.0.0")
app.include_router(routes.router)


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
            "error": {
                "code": "AGENT_INVALID_INPUT",
                "message": str(exc.errors()[0] if exc.errors() else "invalid input"),
            },
        },
    )


log.info(
    "agent.startup",
    mode=settings.agent_pipeline_mode,
    env=settings.agent_env,
    vision_provider=settings.vision_provider,
    # Resolved per provider so openai mode logs gpt-*, not the doubao default.
    vision_model=resolved_vision_model(settings),
    planning_model=settings.deepseek_model,
)
