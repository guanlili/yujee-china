"""Single source of truth for *which* slot the vision calls use (#166).

Vision used to hardwire the 火山 Ark (doubao) slot. We now let it switch between
two OpenAI-compatible slots via `settings.vision_provider`:

  * "ark"    → 火山 doubao-seed-1-6-vision (default; existing behavior).
  * "openai" → OpenAI GPT vision (gpt-4o-mini by default for V2). V3
    describe-content reuses this slot wiring with a describe-specific model.

Both init's batched analysis (vision.py) and the #165 inspect diagnosis
resolve their endpoint/key/model/timeout through
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


def openai_vision_slot(
    settings: Settings,
    *,
    timeout_seconds: int | None = None,
    model: str | None = None,
) -> VisionSlot:
    """Resolve the OpenAI (GPT) vision slot explicitly, independent of the V2
    `vision_provider` switch. Used as the V3 describe-content PRIMARY (architecture
    §6.8 第 2 条) with a describe-specific model override. `timeout_seconds`
    overrides the slot's default per-call budget so V3 failover can use a tighter
    primary deadline. Raises VisionSlotError if the OpenAI key is missing."""
    if not settings.openai_api_key:
        raise VisionSlotError("OPENAI_API_KEY missing; cannot run OpenAI vision slot")
    return VisionSlot(
        provider="openai",
        base_url=settings.openai_base_url,
        api_key=settings.openai_api_key,
        model=model or settings.openai_vision_model,
        timeout_seconds=(
            settings.openai_timeout_seconds if timeout_seconds is None else timeout_seconds
        ),
        # Never forward doubao's `thinking` knob to OpenAI (400 otherwise).
        extra_body=None,
        response_format=({"type": "json_object"} if settings.openai_use_json_object else None),
        supports_json_object=settings.openai_use_json_object,
    )


def ark_vision_slot(
    settings: Settings,
    *,
    model: str | None = None,
    timeout_seconds: int | None = None,
) -> VisionSlot:
    """Resolve the 火山 doubao vision slot explicitly. Used as the V3
    describe-content FAILOVER (architecture §6.8 第 2 条). Raises VisionSlotError if
    the ARK key is missing.

    ``model`` / ``timeout_seconds`` 覆盖参数是给 compose(④ 成稿)用的:它要自己的
    模型选择(compose_ark_model)和输出预算对齐的超时,不能复用判图槽写死的
    ark_vision_model / ark_timeout_seconds。其余调用方不传,行为不变。"""
    if not settings.ark_api_key:
        raise VisionSlotError("ARK_API_KEY missing; cannot run 火山 vision slot")
    return VisionSlot(
        provider="ark",
        base_url=settings.ark_base_url,
        api_key=settings.ark_api_key,
        model=model or settings.ark_vision_model,
        timeout_seconds=timeout_seconds or settings.ark_timeout_seconds,
        # `thinking` gated by ark_disable_thinking (one knob across callers).
        extra_body=(
            {"thinking": {"type": "disabled"}} if settings.ark_disable_thinking else None
        ),
        # doubao text models 400 on response_format=json_object; rely on
        # thinking-disabled + the prompt instead.
        response_format=None,
        supports_json_object=False,
    )


def select_vision_slot(settings: Settings) -> VisionSlot:
    """Resolve the vision slot from settings. Raises VisionSlotError if the
    chosen provider has no API key configured."""
    if settings.vision_provider == "openai":
        return openai_vision_slot(settings)
    # Default / "ark": 火山 doubao — unchanged behavior.
    return ark_vision_slot(settings)
