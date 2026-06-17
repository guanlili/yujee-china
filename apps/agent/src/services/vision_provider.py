"""Single source of truth for *which* slot the vision calls use (#166).

Vision used to hardwire the 火山 Ark (doubao) slot. We now let it switch between
two OpenAI-compatible slots via `settings.vision_provider`:

  * "ark"    → 火山 doubao-seed-1-6-vision (default; existing behavior).
  * "openai" → OpenAI GPT vision (gpt-4o-mini by default).

Both init's batched analysis (vision.py) and the #165 inspect diagnosis
(inspect_render.py) resolve their endpoint/key/model/timeout through
`select_vision_slot()` so there is exactly one place that knows the per-provider
quirks:

  * doubao's `thinking` extra_body (``{"thinking": {"type": "disabled"}}``) is a
    Volcano-only knob. OpenAI rejects it with HTTP 400, so it is attached ONLY on
    the ark branch — the openai branch's `extra_body` is always None.
  * OpenAI accepts ``response_format={"type": "json_object"}`` and returns valid
    JSON reliably, so the openai branch can opt into it (default on). doubao text
    models 400 on json_object, so the ark branch leaves response_format None and
    relies on thinking-disabled + the prompt's "STRICT JSON only" instruction.

The chosen slot's key must be present; a missing key raises VisionSlotError so the
caller can map it to the same AGENT_VISION_FAILED surface as before.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..settings import Settings


class VisionSlotError(Exception):
    """The configured vision slot is unusable (e.g. its API key is missing)."""


# --- Cost observation (#166) -------------------------------------------------
# Per-MILLION-token list prices in **USD**, keyed by the model id we send. Used
# only to log an estimated per-call cost so prod can eyeball spend per provider;
# it is NOT part of any cross-service contract (Usage carries token counts, not
# cents — see docs/agent/design.md). Keep in sync with provider price pages.
#
# OpenAI gpt-4o-mini (2024-07): $0.15 / 1M input, $0.60 / 1M output.
# OpenAI gpt-4o      (2024-08): $2.50 / 1M input, $10.00 / 1M output.
# Volcano doubao-seed-1-6-vision bills primarily per *image*, not per token, so
# we leave its token unit price at 0.0 (token-based estimate would understate
# it); the real doubao cost is reconciled Web-side per the design doc. Add a
# token price here only if Volcano switches that model to token billing.
_VISION_PRICE_USD_PER_MTOK: dict[str, tuple[float, float]] = {
    # model id -> (input_usd_per_million, output_usd_per_million)
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-2024-08-06": (2.50, 10.00),
    "gpt-4o-mini-2024-07-18": (0.15, 0.60),
}


def estimate_cost_usd(model: str, prompt_tokens: int, completion_tokens: int) -> float | None:
    """Best-effort USD estimate for one vision call from its token usage. Returns
    None when the model has no token price entry (e.g. doubao's per-image billing),
    so callers can omit the cost rather than log a misleading 0."""
    price = _VISION_PRICE_USD_PER_MTOK.get(model)
    if price is None:
        return None
    in_usd, out_usd = price
    return (prompt_tokens * in_usd + completion_tokens * out_usd) / 1_000_000


@dataclass(frozen=True)
class VisionSlot:
    """Resolved per-call wiring for one vision provider. Fields line up 1:1 with
    ``ai_client.chat_completion`` kwargs so callers just splat them in."""

    provider: str
    base_url: str
    api_key: str
    model: str
    timeout_seconds: int
    # Volcano-only extra_body (thinking toggle). None for OpenAI — must never be
    # sent there. May be None for ark too when ark_disable_thinking is False.
    extra_body: dict[str, Any] | None
    # response_format for the /chat/completions body, or None to omit it.
    response_format: dict[str, Any] | None
    # Whether the slot can honor a JSON response_format at all (lets callers that
    # don't pass a fixed response_format decide whether to request json_object).
    supports_json_object: bool


def resolved_vision_model(settings: Settings) -> str:
    """The model id the configured provider would use, WITHOUT requiring its key.

    Same single source of truth as `select_vision_slot` for *which* model name
    matches `vision_provider`, but never raises — startup logging needs the right
    name even before keys are validated, and key checks live elsewhere."""
    if settings.vision_provider == "openai":
        return settings.openai_vision_model
    return settings.ark_vision_model


def select_vision_slot(settings: Settings) -> VisionSlot:
    """Resolve the vision slot from settings. Raises VisionSlotError if the
    chosen provider has no API key configured."""
    provider = settings.vision_provider

    if provider == "openai":
        if not settings.openai_api_key:
            raise VisionSlotError(
                "OPENAI_API_KEY missing; cannot run vision with vision_provider=openai"
            )
        return VisionSlot(
            provider="openai",
            base_url=settings.openai_base_url,
            api_key=settings.openai_api_key,
            model=settings.openai_vision_model,
            timeout_seconds=settings.openai_timeout_seconds,
            # Never forward doubao's `thinking` knob to OpenAI (400 otherwise).
            extra_body=None,
            response_format=(
                {"type": "json_object"} if settings.openai_use_json_object else None
            ),
            supports_json_object=settings.openai_use_json_object,
        )

    # Default / "ark": 火山 doubao — unchanged behavior.
    if not settings.ark_api_key:
        raise VisionSlotError("ARK_API_KEY missing; cannot run real vision stage")
    return VisionSlot(
        provider="ark",
        base_url=settings.ark_base_url,
        api_key=settings.ark_api_key,
        model=settings.ark_vision_model,
        timeout_seconds=settings.ark_timeout_seconds,
        # `thinking` is now gated by ark_disable_thinking for BOTH callers (init
        # vision.py and #165 inspect_render.py). inspect used to disable thinking
        # unconditionally; routing it through this slot deliberately unifies the
        # two so there is one knob — at the default (disable=True) inspect's
        # behavior is unchanged. Do NOT re-fork a separate inspect-only path.
        extra_body=(
            {"thinking": {"type": "disabled"}} if settings.ark_disable_thinking else None
        ),
        # doubao text models 400 on response_format=json_object; rely on
        # thinking-disabled + the prompt instead.
        response_format=None,
        supports_json_object=False,
    )
