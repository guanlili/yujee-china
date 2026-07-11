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
