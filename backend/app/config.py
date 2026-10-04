from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Все настройки берутся из переменных окружения (префикс PLM_) или .env."""

    model_config = SettingsConfigDict(env_prefix="PLM_", env_file=".env", extra="ignore")

    app_name: str = "ПрофПЛМ — управление составом и производством"
    database_url: str = "sqlite:///./plm.db"
    secret_key: str = "change-me-in-production-please-32+chars"
    access_token_minutes: int = 60 * 8
    refresh_token_days: int = 14
    # Блокировка учётки после N неудачных входов
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    cors_origins: str = "*"
    seed_demo: bool = True
    static_dir: str = "../../frontend/dist"

    # ИИ: локальная модель (Ollama / vLLM / LM Studio — OpenAI-совместимый API)
    local_llm_url: str = "http://localhost:11434/v1"
    local_llm_model: str = "qwen2.5:14b-instruct"
    local_llm_enabled: bool = False
    # ИИ: облачная модель (Anthropic Claude) — только для неконфиденциальных данных
    anthropic_api_key: str = ""
    cloud_llm_model: str = "claude-opus-5-5"
    cloud_llm_enabled: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
