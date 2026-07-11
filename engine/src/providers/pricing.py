"""单次模型调用成本估算(给 ai-trace 观测台):tokens × 官方单价。

价目是人工维护的快照(2026-07-11 查证),调价/新模型在 `_PRICING` 里补一条即可。
金额单位为每 1,000,000 token;方舟系按输入长度分档(千 token 口径)。

来源:
- doubao-seed-1.6 系(含 vision):火山方舟定价页,三档 0.8/8、1.2/16、2.4/24 CNY。
- doubao-seed-2.0 系:方舟费用参考(lite 0.6/3.6 起,pro 3.2/16 起)。
- deepseek-v4-pro:官方 2026-05-31 后正式价 $0.435/$0.87。
- gpt-5.4-mini:OpenAI 定价页 $0.75/$4.50。
- gemini-2.5-flash:Google AI 定价 $0.30/$2.50。
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["estimate_cost"]


@dataclass(frozen=True)
class _Tier:
    """一个输入长度分档:输入 ≤ max_input_tokens 时按本档单价;None = 兜底档。"""

    max_input_tokens: int | None
    input_per_m: float
    output_per_m: float


@dataclass(frozen=True)
class _ModelPricing:
    currency: str  # "CNY" | "USD"
    tiers: tuple[_Tier, ...]  # 按 max_input_tokens 升序;最后一档可为 None(不限)


def _flat(currency: str, input_per_m: float, output_per_m: float) -> _ModelPricing:
    return _ModelPricing(currency, (_Tier(None, input_per_m, output_per_m),))


# 键与模型 id 做前缀匹配(id 先归一化:小写、"." → "-");取能匹配的最长键。
_PRICING: dict[str, _ModelPricing] = {
    "doubao-seed-1-6": _ModelPricing(
        "CNY",
        (
            _Tier(32_000, 0.8, 8.0),
            _Tier(128_000, 1.2, 16.0),
            _Tier(None, 2.4, 24.0),
        ),
    ),
    "doubao-seed-2-0-lite": _ModelPricing(
        "CNY",
        (
            _Tier(32_000, 0.6, 3.6),
            _Tier(128_000, 0.9, 5.4),
            _Tier(None, 1.8, 10.8),
        ),
    ),
    "doubao-seed-2-0-pro": _ModelPricing(
        "CNY",
        (
            _Tier(32_000, 3.2, 16.0),
            _Tier(128_000, 4.8, 24.0),
            _Tier(None, 9.6, 48.0),
        ),
    ),
    "deepseek-v4-pro": _flat("USD", 0.435, 0.87),
    "deepseek-v4-flash": _flat("USD", 0.14, 0.28),
    "gpt-5-4-mini": _flat("USD", 0.75, 4.5),
    "gemini-2-5-flash": _flat("USD", 0.30, 2.50),
}


def _normalize(model: str) -> str:
    return model.strip().lower().replace(".", "-")


def _lookup(model: str) -> _ModelPricing | None:
    name = _normalize(model)
    best_key: str | None = None
    for key in _PRICING:
        if name.startswith(key) and (best_key is None or len(key) > len(best_key)):
            best_key = key
    return _PRICING[best_key] if best_key else None


def estimate_cost(
    model: str, input_tokens: int | None, output_tokens: int | None
) -> dict[str, object] | None:
    """按价目表估算一次调用的成本。

    返回 {"currency", "input", "output", "total"}(金额,保留 6 位小数);
    模型不在价目表或 token 数缺失时返回 None —— 调用方把 cost 记为 null,
    观测台不显示,而不是显示一个错的数。
    """
    if not isinstance(input_tokens, int) or not isinstance(output_tokens, int):
        return None
    if input_tokens < 0 or output_tokens < 0:
        return None
    pricing = _lookup(model)
    if pricing is None:
        return None
    tier = pricing.tiers[-1]
    for candidate in pricing.tiers:
        if candidate.max_input_tokens is None or input_tokens <= candidate.max_input_tokens:
            tier = candidate
            break
    cost_in = input_tokens * tier.input_per_m / 1_000_000
    cost_out = output_tokens * tier.output_per_m / 1_000_000
    return {
        "currency": pricing.currency,
        "input": round(cost_in, 6),
        "output": round(cost_out, 6),
        "total": round(cost_in + cost_out, 6),
    }
