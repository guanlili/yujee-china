"""LLM I/O 监控(trace)开关逻辑 —— dev 默认常开、生产绝不写。

trace 把每次 LLM 调用的 system/user(图片脱敏)/output 追加到文件,本地调试看 AI
每步在想啥。生产环境(AGENT_ENV=production 或 Fly 运行时)必须零写入(隐私 + 磁盘)。
"""

import pytest

from src import ai_client


@pytest.fixture(autouse=True)
def _clean_trace_env(monkeypatch):
    # 每个用例从干净环境出发,避免外部 shell 的 YUJEE_LLM_TRACE/AGENT_ENV/FLY_* 干扰。
    for var in ("YUJEE_LLM_TRACE", "AGENT_ENV", "FLY_APP_NAME", "FLY_MACHINE_ID"):
        monkeypatch.delenv(var, raising=False)


class TestTracePathGating:
    def test_dev_default_on(self):
        # 不设任何变量(默认 development)→ 默认写到 apps/agent/llm-trace.txt。
        path = ai_client._trace_path()
        assert path is not None
        assert path.endswith("llm-trace.txt")

    def test_dev_env_explicit(self, monkeypatch):
        monkeypatch.setenv("AGENT_ENV", "development")
        assert ai_client._trace_path() is not None

    def test_production_off(self, monkeypatch):
        monkeypatch.setenv("AGENT_ENV", "production")
        assert ai_client._trace_path() is None

    def test_fly_runtime_off_defense_in_depth(self, monkeypatch):
        # AGENT_ENV 没设对,但 Fly 运行时存在 → 仍视为生产,不写。
        monkeypatch.setenv("FLY_APP_NAME", "yujee-agent")
        assert ai_client._trace_path() is None

    def test_explicit_path_overrides_anywhere(self, monkeypatch, tmp_path):
        # 显式给路径 → 任何环境都写到该路径(连生产都能强开,用于排障)。
        target = str(tmp_path / "force.txt")
        monkeypatch.setenv("AGENT_ENV", "production")
        monkeypatch.setenv("YUJEE_LLM_TRACE", target)
        assert ai_client._trace_path() == target

    def test_explicit_off_disables_in_dev(self, monkeypatch):
        # 显式关 → dev 也不写(逃生阀)。
        monkeypatch.setenv("YUJEE_LLM_TRACE", "off")
        assert ai_client._trace_path() is None


class TestTraceWrite:
    def test_writes_when_on(self, monkeypatch, tmp_path):
        target = tmp_path / "t.txt"
        monkeypatch.setenv("YUJEE_LLM_TRACE", str(target))
        resp = {"choices": [{"message": {"content": "hello-output"}}]}
        ai_client._trace_llm_call("m", [{"role": "user", "content": "hi-input"}], resp)
        text = target.read_text(encoding="utf-8")
        assert "hello-output" in text
        assert "hi-input" in text

    def test_silent_in_production(self, monkeypatch):
        # 生产:即便调用也不抛错、不写(无显式路径 → 直接 no-op)。
        monkeypatch.setenv("AGENT_ENV", "production")
        ai_client._trace_llm_call("m", [{"role": "user", "content": "hi"}], {"choices": []})
