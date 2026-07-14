"""Vision provider-slot switching (#166).

Covers `select_vision_slot` wiring for both slots: the ark (doubao) slot sends
`thinking` disabled; the openai slot sends NO doubao extra_body and DOES request a
json_object response_format; a missing key for the chosen slot raises. Plus the
per-model cost estimate. No live network.
"""

import pytest

from src.providers.vision_provider import (
    VisionSlotError,
    estimate_cost_usd,
    resolved_vision_model,
    select_vision_slot,
)


# 测试必须与开发机的 .env 完全隔离。
# Settings 用 pydantic-settings 的 env_file=".env" 【直接读文件】—— monkeypatch 环境变量
# 盖不住它。所以这里把 env_file 关掉,让 Settings 只认环境变量 + 源码默认值:
#   · 无 key 降级:开发机 .env 里有真 key,不关掉就永远模拟不出「无 key」
#     (那些用例只会在 CI 无 .env 时碰巧过)。
#   · 默认模型:开发机 .env 覆盖了 OPENAI_VISION_MODEL 之类,断言【源码默认值】的用例会挂。
# 需要某个 key/模型的用例自己显式传进来。
_API_KEY_ENVS = ("ARK_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY")


@pytest.fixture
def _real_env(monkeypatch):
    from src import settings as s

    monkeypatch.setitem(s.Settings.model_config, "env_file", None)  # 不读 .env
    monkeypatch.setenv("AGENT_SHARED_SECRET", "test-secret")        # 唯一必填字段
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    for key in _API_KEY_ENVS:
        monkeypatch.setenv(key, "")                                 # 判空是 `if not ...`,空串=无 key

    def _apply(**env):
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        s.reset_settings_cache()
        return s.get_settings()

    yield _apply
    s.reset_settings_cache()


# ---- select_vision_slot -----------------------------------------------------


def test_select_slot_ark_default_carries_thinking(_real_env):
    settings = _real_env(ARK_API_KEY="fake_ark")
    slot = select_vision_slot(settings)
    assert slot.provider == "ark"
    assert slot.base_url == settings.ark_base_url
    assert slot.api_key == "fake_ark"
    assert slot.model == settings.ark_vision_model
    assert slot.extra_body == {"thinking": {"type": "disabled"}}
    assert slot.response_format is None  # doubao 400s on json_object


def test_select_slot_openai_has_no_thinking_and_json_object(_real_env):
    settings = _real_env(VISION_PROVIDER="openai", OPENAI_API_KEY="fake_oai")
    slot = select_vision_slot(settings)
    assert slot.provider == "openai"
    assert slot.base_url == "https://api.openai.com/v1"
    assert slot.api_key == "fake_oai"
    assert slot.model == "gpt-4o-mini"  # V2 OpenAI vision default; V3 describe has its own model.
    assert slot.extra_body is None  # CRITICAL: never send doubao `thinking` to OpenAI
    assert slot.response_format == {"type": "json_object"}


def test_select_slot_ark_no_thinking_when_disabled_off(_real_env):
    settings = _real_env(ARK_API_KEY="fake_ark", ARK_DISABLE_THINKING="false")
    assert select_vision_slot(settings).extra_body is None


def test_select_slot_openai_missing_key_raises(_real_env):
    settings = _real_env(VISION_PROVIDER="openai")
    with pytest.raises(VisionSlotError):
        select_vision_slot(settings)


def test_select_slot_ark_missing_key_raises(_real_env):
    settings = _real_env()  # no ARK_API_KEY
    with pytest.raises(VisionSlotError):
        select_vision_slot(settings)


def test_resolved_vision_model_tracks_provider_without_key(_real_env):
    # No keys set: resolved_vision_model must still return the provider's model
    # (startup logging uses it before keys are validated).
    assert resolved_vision_model(_real_env()) == "doubao-seed-1-6-vision-250815"
    assert resolved_vision_model(_real_env(VISION_PROVIDER="openai")) == "gpt-4o-mini"


# ---- cost estimate ----------------------------------------------------------


def test_estimate_cost_gpt4o_mini():
    # 1M input @ $0.15 + 1M output @ $0.60 = $0.75
    assert estimate_cost_usd("gpt-4o-mini", 1_000_000, 1_000_000) == pytest.approx(0.75)


def test_estimate_cost_unknown_model_is_none():
    assert estimate_cost_usd("doubao-seed-1-6-vision-250815", 1000, 1000) is None
