from pathlib import Path

import pytest


def test_env_example_contains_non_empty_shared_secret_placeholder():
    env_example = Path(__file__).resolve().parents[1] / ".env.example"
    values = {}
    for line in env_example.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value

    assert values["AGENT_SHARED_SECRET"].strip()


def _real_mode(monkeypatch, **env) -> None:
    monkeypatch.setenv("AGENT_PIPELINE_MODE", "real")
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    from src import settings as s

    s.reset_settings_cache()


_REAL_KEYS = {
    "ARK_API_KEY": "fake_ark",
    "DEEPSEEK_API_KEY": "fake_deepseek",
    "SELECT_LAYOUT_API_KEY": "fake_gemini",
}


def test_real_mode_requires_gemini_key(monkeypatch):
    """缺 Gemini key 时 compose 是**静默降级**(照发 completed + 空 pagesTexts,
    用户拿到一本全是模板示例文案的书),没有任何 error 信号 —— 只能在启动时拦。"""
    from src.main import _validate_startup_config

    env = {k: v for k, v in _REAL_KEYS.items() if k != "SELECT_LAYOUT_API_KEY"}
    monkeypatch.delenv("SELECT_LAYOUT_API_KEY", raising=False)
    _real_mode(monkeypatch, **env)
    with pytest.raises(RuntimeError, match="SELECT_LAYOUT_API_KEY"):
        _validate_startup_config()


def test_real_mode_passes_with_all_keys(monkeypatch):
    from src.main import _validate_startup_config

    _real_mode(monkeypatch, **_REAL_KEYS)
    _validate_startup_config()
