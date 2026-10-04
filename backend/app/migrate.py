"""Программный запуск миграций Alembic при старте приложения."""
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import Engine

BACKEND_DIR = Path(__file__).resolve().parent.parent


def alembic_config() -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return cfg


def upgrade_to_head(engine: Engine) -> None:
    """Применить все миграции, используя соединение из пула приложения."""
    cfg = alembic_config()
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
