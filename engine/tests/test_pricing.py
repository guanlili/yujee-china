"""单次模型调用成本估算(pricing.estimate_cost):分档、前缀匹配、未知模型返回 None。"""

from __future__ import annotations

from src.providers.pricing import estimate_cost


def test_doubao_vision_low_tier():
    # doubao-seed-1.6-vision,≤32k 档:0.8/8 CNY per 1M。
    cost = estimate_cost("doubao-seed-1-6-vision-250815", 10_000, 1_000)
    assert cost == {
        "currency": "CNY",
        "input": round(10_000 * 0.8 / 1_000_000, 6),
        "output": round(1_000 * 8.0 / 1_000_000, 6),
        "total": round((10_000 * 0.8 + 1_000 * 8.0) / 1_000_000, 6),
    }


def test_doubao_tier_selected_by_input_length():
    # 输入 200k tokens 落 (128, 256] 档:2.4/24,全部 token 按该档计。
    cost = estimate_cost("doubao-seed-1-6-vision-250815", 200_000, 2_000)
    assert cost is not None
    assert cost["input"] == round(200_000 * 2.4 / 1_000_000, 6)
    assert cost["output"] == round(2_000 * 24.0 / 1_000_000, 6)


def test_deepseek_and_dotted_model_ids():
    cost = estimate_cost("deepseek-v4-pro-260425", 1_000_000, 1_000_000)
    assert cost == {"currency": "USD", "input": 0.435, "output": 0.87, "total": 1.305}
    # 模型 id 里的 "." 归一化后也能命中(gemini-2.5-flash → gemini-2-5-flash)。
    assert estimate_cost("gemini-2.5-flash", 1_000_000, 0) == {
        "currency": "USD",
        "input": 0.30,
        "output": 0.0,
        "total": 0.30,
    }


def test_deepseek_v4_flash():
    cost = estimate_cost("deepseek-v4-flash-260425", 1_000_000, 1_000_000)
    assert cost == {"currency": "USD", "input": 0.14, "output": 0.28, "total": 0.42}


def test_seed_2_0_lite_prefix_beats_shorter_match():
    cost = estimate_cost("doubao-seed-2-0-lite-260428", 10_000, 10_000)
    assert cost is not None
    assert cost["currency"] == "CNY"
    assert cost["input"] == round(10_000 * 0.6 / 1_000_000, 6)


def test_unknown_model_or_missing_tokens_returns_none():
    assert estimate_cost("mystery-model-9000", 100, 100) is None
    assert estimate_cost("doubao-seed-1-6-vision-250815", None, 100) is None
    assert estimate_cost("doubao-seed-1-6-vision-250815", 100, None) is None
    assert estimate_cost("doubao-seed-1-6-vision-250815", -1, 100) is None


# ---- 2026-07-14 修复的三个真实算错 -------------------------------------------
#   1. design-agent 的花费恒为 $0    —— 方舟 provider 把单价写死为 0(TS 侧,见 model-cost.ts)
#   2. gemini select-layout 完全不计 —— usageMetadata 在 trace 里被整个丢掉
#   3. 缓存命中按全价算 → 高估        —— 命中部分单价低到 1/50

import pytest

from src.providers.ai_client import _extract_usage


@pytest.mark.parametrize(
    "model",
    [
        "doubao-seed-1-6-vision-250815",
        "deepseek-v4-flash-260425",
        "deepseek-v4-pro-260425",  # design-agent 实际配的就是这个
        "gemini-2.5-flash",
        "gpt-5.4-mini",
    ],
)
def test_every_live_model_is_priced(model: str) -> None:
    """线上跑的每个模型都必须能算出成本。算不出 = 那部分花费在账上凭空消失。"""
    cost = estimate_cost(model, 1000, 100)
    assert cost is not None, f"{model} 不在价目表里,它的花费会被静默丢掉"
    assert cost["total"] > 0


def test_cache_hit_is_discounted_not_charged_at_full_input_price() -> None:
    """deepseek 命中价 0.0028 vs 全价 0.14 —— 50 倍差。不打折就是高估。"""
    full = estimate_cost("deepseek-v4-flash", 1_000_000, 0, 0)
    all_cached = estimate_cost("deepseek-v4-flash", 1_000_000, 0, 1_000_000)
    assert full is not None and all_cached is not None
    assert full["input"] == pytest.approx(0.14)
    assert all_cached["input"] == pytest.approx(0.0028)


def test_cache_hit_cannot_exceed_total_input() -> None:
    """provider 偶发脏数据(cached > total)不该把成本算成负的。"""
    cost = estimate_cost("deepseek-v4-flash", 1000, 0, 999_999)
    assert cost is not None
    assert cost["input"] >= 0


def test_model_without_cache_price_charges_full_rate() -> None:
    """没配 cacheRead 的模型,命中也按 input 全价 —— 不能凭空打折。"""
    a = estimate_cost("gemini-2-5-flash", 1_000_000, 0, 0)
    b = estimate_cost("gemini-2-5-flash", 1_000_000, 0, 1_000_000)
    assert a is not None and b is not None
    assert a["total"] == pytest.approx(b["total"])


def test_extract_usage_openai_shape_with_cache_hit() -> None:
    resp = {
        "usage": {
            "prompt_tokens": 1000,
            "completion_tokens": 200,
            "prompt_cache_hit_tokens": 800,
        }
    }
    assert _extract_usage(resp) == (1000, 200, 800)


def test_extract_usage_openai_cached_tokens_details() -> None:
    """方舟/OpenAI 报在 prompt_tokens_details.cached_tokens 里。"""
    resp = {
        "usage": {
            "prompt_tokens": 1000,
            "completion_tokens": 200,
            "prompt_tokens_details": {"cached_tokens": 600},
        }
    }
    assert _extract_usage(resp) == (1000, 200, 600)


def test_extract_usage_gemini_counts_thinking_tokens_as_output() -> None:
    """thoughtsTokenCount 按 output 计费,却【不含】在 candidatesTokenCount 里。
    不加上就会低估输出成本 —— gemini-2.5-flash 默认开思考。"""
    resp = {
        "usageMetadata": {
            "promptTokenCount": 5000,
            "candidatesTokenCount": 300,
            "thoughtsTokenCount": 1200,
            "cachedContentTokenCount": 2000,
        }
    }
    assert _extract_usage(resp) == (5000, 1500, 2000)


def test_extract_usage_missing_returns_nones() -> None:
    assert _extract_usage({"choices": [{"message": {"content": "hi"}}]}) == (None, None, None)
