"""单次模型调用成本估算(给 ai-trace 观测台):tokens × 官方单价。

价目表是 `packages/contracts/pricing/model-prices.json` —— 【单一真相】,
engine(这里) 和 design-agent(TS) 共读同一份,调价只改那一个文件。

在此之前有三份各写各的:本文件一份、vision_provider.py 一份(死表,只剩已下线的
gpt-4o)、packages/ai 的方舟 provider 把所有模型单价写死为 0(于是 design-agent
的花费在账上永远是 $0)。三份自然会漂移,已合并。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

__all__ = ["estimate_cost"]


@dataclass(frozen=True)
class _Tier:
    """一个输入长度分档:输入 ≤ max_input_tokens 时按本档单价;None = 兜底档。"""

    max_input_tokens: int | None
    input_per_m: float
    output_per_m: float
    # 缓存命中的输入单价。None = 与 input_per_m 同价(即该模型不打折)。
    cache_read_per_m: float | None = None


@dataclass(frozen=True)
class _ModelPricing:
    currency: str  # "CNY" | "USD"
    tiers: tuple[_Tier, ...]  # 按 max_input_tokens 升序;最后一档可为 None(不限)


def _repo_prices_from_file() -> Path | None:
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "packages" / "contracts" / "pricing" / "model-prices.json"
        if candidate.is_file():
            return candidate
    return None


def _resolve_prices_path() -> Path:
    """定位价目表。与模板目录同一套解析方式(env 覆盖 → 容器路径 → 仓内查找)。"""
    explicit = os.environ.get("YUJEE_MODEL_PRICES")
    if explicit:
        path = Path(explicit)
        if not path.is_file():
            raise RuntimeError(f"YUJEE_MODEL_PRICES points to a missing file: {path}")
        return path

    container_path = Path("/app/packages/contracts/pricing/model-prices.json")
    if container_path.is_file():
        return container_path

    repo_path = _repo_prices_from_file()
    if repo_path is not None:
        return repo_path

    raise RuntimeError("model-prices.json not found (set YUJEE_MODEL_PRICES)")


@lru_cache(maxsize=1)
def _pricing_table() -> dict[str, _ModelPricing]:
    raw = json.loads(_resolve_prices_path().read_text(encoding="utf-8"))
    table: dict[str, _ModelPricing] = {}
    for key, entry in raw["models"].items():
        tiers = tuple(
            _Tier(
                max_input_tokens=t["maxInputTokens"],
                input_per_m=float(t["input"]),
                output_per_m=float(t["output"]),
                cache_read_per_m=(
                    float(t["cacheRead"]) if t.get("cacheRead") is not None else None
                ),
            )
            for t in entry["tiers"]
        )
        table[key] = _ModelPricing(entry["currency"], tiers)
    return table


def _normalize(model: str) -> str:
    return model.strip().lower().replace(".", "-")


def _lookup(model: str) -> _ModelPricing | None:
    name = _normalize(model)
    best_key: str | None = None
    for key in _pricing_table():
        if name.startswith(key) and (best_key is None or len(key) > len(best_key)):
            best_key = key
    return _pricing_table()[best_key] if best_key else None


def estimate_cost(
    model: str,
    input_tokens: int | None,
    output_tokens: int | None,
    cached_input_tokens: int | None = None,
) -> dict[str, object] | None:
    """按价目表估算一次调用的成本。

    `input_tokens` 是【总】输入 token(含缓存命中的部分,provider 就是这么报的);
    `cached_input_tokens` 是其中命中缓存的部分 —— 命中部分按 cacheRead 价、
    其余按 input 价。不传 = 当作零命中(此前的行为,缓存命中时会【高估】)。

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

    cached = cached_input_tokens if isinstance(cached_input_tokens, int) else 0
    cached = max(0, min(cached, input_tokens))  # provider 偶发脏数据不该把成本算成负的
    fresh = input_tokens - cached
    cache_rate = tier.cache_read_per_m if tier.cache_read_per_m is not None else tier.input_per_m

    cost_in = (fresh * tier.input_per_m + cached * cache_rate) / 1_000_000
    cost_out = output_tokens * tier.output_per_m / 1_000_000
    return {
        "currency": pricing.currency,
        "input": round(cost_in, 6),
        "output": round(cost_out, 6),
        "total": round(cost_in + cost_out, 6),
    }
