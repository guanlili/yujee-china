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
    agent_enable_analyze: bool = True
    # Only the dedicated 2GB CLIP service enables this internal endpoint.
    agent_enable_clip_embeddings: bool = False

    # mode switches (see docs/agent/design.md)
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

    # OpenAI (GPT) vision slot — used by V2 when vision_provider="openai". V3
    # describe-content uses the same endpoint/key/json/thinking wiring but has its
    # own model knob below, so enabling WP1.3 does not silently change V2 behavior.
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

    # V3 describe-content failover (architecture §6.8 第 2 条 / v3-impl-plan §6.2):
    # the recognition model defaults to OPENAI (GPT-5.5 Mini, using the openai_*
    # endpoint/key). ai_client already retries once on 5xx/timeouts within the
    # per-call budget, so a 30s budget = 30s + one retry ≈ 60s worst case for the
    # primary attempt. If the OpenAI slot still 5xx/times-out after that retry, OR
    # the whole batch hasn't finished within describe_batch_deadline_seconds,
    # describe-content降级火山 (the ark_* slot). Missing keys and 4xx are config /
    # request failures, not failover cases. 数值可微调,不改「先 GPT、自动降级火山」语义。
    describe_openai_model: str = "gpt-5.5-mini"
    describe_openai_timeout_seconds: int = 30
    describe_batch_deadline_seconds: int = 90
    # The unified describe call now emits, in ONE response, per-chapter
    # description + per-photo scene + per-page photoIds + per-page templateId
    # (selecting templates / paging folded into the same call). That combined
    # output is materially larger than the old describe-only reply, so the
    # output budget needs headroom: a truncated response is non-lossy (the
    # coverage guard rejects it) but FATAL (hard AGENT_VISION_FAILED, no graceful
    # degrade — it propagates rather than failing over on the same bad-output
    # class). 16384 is a conservative headroom bump accepted by both configured
    # vision models (ark doubao-seed-1-6-vision with thinking disabled, and the
    # openai describe slot). Route-splitting (#232) remains the primary per-call
    # output bound; this is just headroom for dense single routes.
    describe_max_output_tokens: int = 16384

    # V3 describe cluster-aware concurrency (#232 WP-C). When the browser stamps
    # photos with `clusterId` (EXIF time/GPS-derived), whole clusters are packed
    # into concurrent describe routes by total photo COUNT — semantic grouping
    # (the clusters themselves) is never re-cut by count. These thresholds only
    # set concurrency WIDTH: ≤lo → 1 route, >lo → 2 routes, >hi → 3 routes. A
    # single oversized cluster still gets its own route (the model sub-chapters
    # it; the omitted-photo retry net guarantees coverage). All clusterId null →
    # degrade to the legacy single-batch path. 数值可微调,不改语义。
    describe_concurrency_threshold_lo: int = 20
    describe_concurrency_threshold_hi: int = 40
    describe_max_concurrency: int = 3

    # Stage1 本地分章:CLIP 图片 embedding + 灰度/颜色距离。
    # grouping_clip_model_path 支持本地权重;未设置时 open_clip 按 model/pretrained
    # 配置加载。
    grouping_clip_model_name: str = "ViT-B-32"
    grouping_clip_pretrained: str = "openai"
    grouping_clip_model_path: str | None = None
    grouping_pythonpath: str | None = None
    # Normal 1GB Agent can call a separate 2GB CLIP service for embeddings.
    # When unset, embeddings are computed locally.
    grouping_clip_base_url: str | None = None
    grouping_clip_secret: str | None = None
    grouping_clip_timeout_seconds: int = 180

    # Stage2 select-layout: Gemini native generateContent. The default base URL
    # keeps the old `/openai` suffix for env compatibility; the handler strips it.
    # Missing key is non-fatal for the stage: workflows/select_layout.py catches it
    # and uses the deterministic skeleton fallback.
    select_layout_api_key: str | None = None
    select_layout_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    select_layout_model: str = "gemini-2.5-flash"
    select_layout_timeout_seconds: int = 60
    select_layout_max_output_tokens: int = 4096
    select_layout_use_json_object: bool = True
    select_layout_disable_thinking: bool = True
    select_layout_max_images_per_batch: int = 24
    select_layout_max_concurrency: int = Field(default=3, ge=1)
    # 每章代码随机生成多少个候选交给 LLM 评委挑选(P1 新排版逻辑)。
    select_layout_candidate_count: int = Field(default=3, ge=1)
    # Gemini 判图的网络出口:未设=沿用环境代理(HTTPS_PROXY,httpx trust_env 默认);
    # "direct"=强制直连、忽略环境代理(本机能直达 Gemini 但 shell 全局代理出口被
    # Gemini 地区墙拒时用这个);其他值=显式代理 URL(如 http://127.0.0.1:7890)。
    # 只影响 Gemini 判图这一个 httpx client,Ark/DeepSeek 的出口行为不变。
    select_layout_proxy: str | None = None

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
