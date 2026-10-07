"""Хранилище сервера: SQLAlchemy 2.0. DATABASE_URL: sqlite (разработка) или postgresql+psycopg (цех).

Таблицы: operations (пакеты), runs (выполнения), run_events (журнал = LogEvent движка шагов), messages (чат).
Миграции на пилоте — Alembic; здесь create_all для скорости разработки.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Operation(Base):
    __tablename__ = "operations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    revision: Mapped[str] = mapped_column(String(16), default="")
    title: Mapped[str] = mapped_column(String(256))
    package: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    operation_id: Mapped[str] = mapped_column(ForeignKey("operations.id"))
    operator: Mapped[str] = mapped_column(String(64))
    serial: Mapped[str] = mapped_column(String(64), default="")
    device: Mapped[str] = mapped_column(String(64), default="")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RunEvent(Base):
    __tablename__ = "run_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id"), index=True)
    step_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    event: Mapped[str] = mapped_column(String(32))
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    client_t: Mapped[float | None] = mapped_column(nullable=True)      # время на очках (monotonic) — для порядка
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id"), index=True)
    step_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    author: Mapped[str] = mapped_column(String(64))
    role: Mapped[str] = mapped_column(String(16), default="operator")   # operator | technologist | master | qc
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


def make_session_factory(url: str | None = None):
    url = url or os.environ.get("DATABASE_URL", "sqlite:///./ar_server.db")
    kw = {"connect_args": {"check_same_thread": False}} if url.startswith("sqlite") else {"pool_pre_ping": True}
    engine = create_engine(url, **kw)
    Base.metadata.create_all(engine)
    return sessionmaker(engine, expire_on_commit=False)
