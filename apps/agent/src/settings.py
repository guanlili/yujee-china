from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


PipelineMode = Literal["mock", "real"]
AgentEnv = Literal["development", "staging", "production"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # core
    agent_shared_secret: str = Field(..., min_length=1)
    web_base_url: str = "http://localhost:3000"
    # Total budget for an init/finalize/layout background task. Must cover the
    # worst case of its network stage(s) including ai_client's one retry
    # (each call can take up to 2× its per-call timeout):
    #   init: vision (2 × ark_timeout=240s) + first-pass writing (#161). Writing
    #     fires 1 cover + N chapter DeepSeek calls, each ≤ 2 × deepseek_timeout
    #     (2 × 60 = 120s), capped to INIT_WRITE_CONCURRENCY (default 3) in flight.
    #     With ⌈(N+1)/3⌉ serialized waves of ≤120s, a 30-photo album (~10 chapters
    #     → 11 units → 4 waves) worst-cases ≈ 240 + 4 × 120 = 720s. We keep 600s:
    #     the 720s figure assumes EVERY call hits its full 2× retry ceiling, which
    #     is pathological; a slow-but-healthy run lands well under 600s (vision
    #     ~20s + ~4 waves × ~30s ≈ 140s). Revisit if real writing latencies push a
    #     full album past 600s — raising this and/or INIT_WRITE_CONCURRENCY are the
    #     two knobs (left for architect/prod confirmation on real-model latency).
    #   layout/planning: writing (2 × 60) + composing (2 × 60) = 240s.
    #   finalize: deterministic, no network.
    background_task_timeout_seconds: int = 600
    port: int = 8001
    log_level: str = "info"

    # mode switches (see docs/agent/design.md §12)
    agent_pipeline_mode: PipelineMode = "mock"
    agent_env: AgentEnv = "development"

    # init first-pass writing (#161): cover + N chapters are written concurrently
    # with an asyncio.Semaphore so init doesn't serialize one DeepSeek call per
    # chapter. Default 3 keeps us well under provider rate limits while cutting
    # wall-clock roughly N×; raise/lower per provider headroom.
    init_write_concurrency: int = Field(default=3, ge=1)

    # Which slot the vision calls (init batch analysis + #165 inspect diagnosis)
    # use. "ark" = 火山 doubao-seed-1-6-vision (the default; current behavior must
    # not regress). "openai" = OpenAI GPT vision (the openai_* slot below).
    # Chosen as an EXPLICIT switch rather than auto-selecting on openai_api_key
    # presence: auto-select would silently flip the vision provider the moment
    # OPENAI_API_KEY is set for any unrelated reason, and would also send doubao's
    # `thinking` extra_body to a slot the operator never intended. Explicit is
    # predictable and keeps the ark default rock-solid. See services/vision_provider.py.
    vision_provider: Literal["ark", "openai"] = "ark"

    # vision (火山 doubao-seed-1-6-vision)
    ark_api_key: str | None = None
    ark_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    ark_vision_model: str = "doubao-seed-1-6-vision-250815"
    # 6-image batched vision + structured JSON on the real doubao-seed-1-6
    # reasoning model exceeds 30s even with thinking disabled (observed: two
    # ReadTimeouts at ~30s → pipeline.vision_failed). 120s covers a slow single
    # attempt; ai_client still retries once, so worst case = 2 × 120s, which
    # fits inside background_task_timeout_seconds=600.
    ark_timeout_seconds: int = 120
    # doubao-seed-* are reasoning models: reasoning_tokens share the max_tokens
    # budget and can truncate the JSON content (intermittent AGENT_VISION_FAILED,
    # worsening as photo count grows). Disable thinking for this structured
    # extraction. Ignored by non-doubao providers that don't accept `thinking`.
    ark_disable_thinking: bool = True

    # OpenAI (GPT) vision slot — used only when vision_provider="openai".
    # base_url is the public OpenAI API; override for an Azure/compatible gateway.
    # gpt-4o-mini is the cheap multimodal default; bump to gpt-4o for harder crops.
    openai_api_key: str | None = None  # env OPENAI_API_KEY
    openai_base_url: str = "https://api.openai.com/v1"
    openai_vision_model: str = "gpt-4o-mini"
    openai_timeout_seconds: int = 120
    # GPT supports response_format=json_object and reliably returns valid JSON for
    # this structured extraction, so default ON for the openai slot (the doubao
    # slot keeps thinking-disabled instead — doubao text models 400 on json_object,
    # see deepseek_use_json_object). OpenAI must NEVER receive doubao's `thinking`
    # extra_body (400 InvalidRequest); the slot helper guarantees that.
    openai_use_json_object: bool = True

    # planning + chat-edit (DeepSeek slot; in prod points at Volcano Ark doubao)
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    # doubao-seed-2-0-lite composing runs longer than the 30s budget under real
    # prod load (full pages JSON, max_tokens=8192), tripping a per-call timeout
    # that left albums half-generated. 60s covers a slow single attempt while
    # still fitting inside background_task_timeout_seconds=180 on the happy path
    # (vision ~20s + writing ~20s + one composing call ~50s ≈ 90s).
    deepseek_timeout_seconds: int = 60
    # doubao-seed text models reject response_format=json_object (400
    # InvalidParameter); DeepSeek supports it. Default off so the configured
    # doubao planning model works; flip on only for a provider that supports it.
    deepseek_use_json_object: bool = False
    # Planning/chat-edit are combinatorial constraint satisfaction (slot
    # orientation+quality fit, photo reuse, page count): doubao's thinking
    # materially improves rule compliance here, so keep it ON by default
    # (unlike vision). Set True only for a non-reasoning planning provider.
    # NOTE: this governs the *writing* + chat-edit calls only; composing has its
    # own switch below.
    deepseek_disable_thinking: bool = False
    # Composing is the same reasoning-heavy slot, BUT it emits the full pages
    # JSON (max_tokens 8192) over a system prompt carrying the whole template
    # registry. With thinking ON, doubao-seed-2-0-lite did not return within
    # 60s on prod (verified: both internal attempts ReadTimeout at ~60s →
    # composing_failed → half-generated albums). Disable thinking here so a
    # single call lands well under the timeout; the repair loop + layout_rules
    # still catch any rule violations. Flip OFF only if a faster/abler composing
    # provider makes thinking affordable again.
    composing_disable_thinking: bool = True


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reset_settings_cache() -> None:
    """Tests-only: clear the cached Settings instance so env overrides take effect."""
    global _settings
    _settings = None
