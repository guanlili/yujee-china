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
    background_task_timeout_seconds: int = 180
    port: int = 8001
    log_level: str = "info"

    # mode switches (see docs/agent/design.md §12)
    agent_pipeline_mode: PipelineMode = "mock"
    agent_env: AgentEnv = "development"

    # vision (火山 doubao-seed-1-6-vision)
    ark_api_key: str | None = None
    ark_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    ark_vision_model: str = "doubao-seed-1-6-vision-250815"
    ark_timeout_seconds: int = 30

    # planning + chat-edit (DeepSeek)
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"
    deepseek_timeout_seconds: int = 30


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
