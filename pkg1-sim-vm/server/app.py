"""Сервер участка (FastAPI): пакеты операций, журнал выполнения, чат по шагам.

Запуск: make server → uvicorn --factory server.app:create_app (http://<ip>:8080/docs — Swagger). Очки и пульт мастера ходят сюда по Wi-Fi.
Безопасность пилота: только локальная сеть цеха; токен устройства в заголовке X-Device-Token (AR_DEVICE_TOKEN).
Кадры камеры на сервер НЕ передаются; фото — только по команде шага (POST /api/runs/{id}/photos).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select

from arcore.io.package import validate
from server.db import Message, Operation, Run, RunEvent, make_session_factory


# Модели запросов — на уровне модуля (иначе FastAPI с `from __future__ import annotations` не разрешит типы)
class RunIn(BaseModel):
    operation_id: str
    operator: str
    serial: str = ""
    device: str = ""


class EventIn(BaseModel):
    step_id: str | None = None
    event: str
    data: dict = Field(default_factory=dict)
    t: float | None = None


class MsgIn(BaseModel):
    author: str
    role: str = "operator"
    text: str
    step_id: str | None = None


def data_dir() -> Path:
    return Path(os.environ.get("AR_DATA_DIR", "./server_data"))


def create_app(database_url: str | None = None) -> FastAPI:
    app = FastAPI(title="AR-сборка: сервер участка", version="0.1")
    Session = make_session_factory(database_url)
    token = os.environ.get("AR_DEVICE_TOKEN")
    DATA_DIR = data_dir()
    (DATA_DIR / "files").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "photos").mkdir(parents=True, exist_ok=True)
    rooms: dict[int, set[WebSocket]] = {}

    def auth(x_device_token: str | None = Header(default=None)):
        if token and x_device_token != token:
            raise HTTPException(401, "Неверный токен устройства")

    # ---------- пакеты операций ----------
    @app.get("/api/operations", dependencies=[Depends(auth)])
    def list_operations():
        with Session() as s:
            return [{"id": o.id, "revision": o.revision, "title": o.title, "updated_at": o.updated_at}
                    for o in s.scalars(select(Operation).order_by(Operation.id))]

    @app.get("/api/operations/{op_id}", dependencies=[Depends(auth)])
    def get_operation(op_id: str):
        with Session() as s:
            o = s.get(Operation, op_id)
            if not o:
                raise HTTPException(404, "Операция не найдена")
            return o.package

    @app.post("/api/operations", status_code=201, dependencies=[Depends(auth)])
    def put_operation(package: dict):
        try:
            validate(package)
        except Exception as e:          # jsonschema.ValidationError | ValueError
            raise HTTPException(422, f"Пакет не прошёл проверку: {getattr(e, 'message', e)}")
        op = package["operation"]
        with Session() as s:
            o = s.get(Operation, op["id"]) or Operation(id=op["id"])
            o.revision, o.title, o.package = op.get("revision", ""), op["title"], package
            s.add(o)
            s.commit()
        return {"id": op["id"], "revision": op.get("revision", "")}

    # ---------- выполнения и журнал ----------
    @app.post("/api/runs", status_code=201, dependencies=[Depends(auth)])
    def start_run(r: RunIn):
        with Session() as s:
            if not s.get(Operation, r.operation_id):
                raise HTTPException(404, "Операция не найдена")
            run = Run(**r.model_dump())
            s.add(run)
            s.commit()
            return {"id": run.id}

    @app.post("/api/runs/{run_id}/events", dependencies=[Depends(auth)])
    def add_events(run_id: int, events: list[EventIn]):
        """Пакетная досылка: очки копят события офлайн и отправляют списком."""
        with Session() as s:
            run = s.get(Run, run_id)
            if not run:
                raise HTTPException(404, "Выполнение не найдено")
            for e in events:
                s.add(RunEvent(run_id=run_id, step_id=e.step_id, event=e.event, data=e.data, client_t=e.t))
                if e.event == "operation_done":
                    run.finished_at = datetime.now(timezone.utc)
            s.commit()
        return {"accepted": len(events)}

    @app.get("/api/runs/{run_id}", dependencies=[Depends(auth)])
    def get_run(run_id: int):
        with Session() as s:
            run = s.get(Run, run_id)
            if not run:
                raise HTTPException(404, "Выполнение не найдено")
            ev = s.scalars(select(RunEvent).where(RunEvent.run_id == run_id).order_by(RunEvent.id)).all()
            msgs = s.scalars(select(Message).where(Message.run_id == run_id).order_by(Message.id)).all()
            return {"id": run.id, "operation_id": run.operation_id, "operator": run.operator, "serial": run.serial,
                    "started_at": run.started_at, "finished_at": run.finished_at,
                    "events": [{"step_id": e.step_id, "event": e.event, "data": e.data, "t": e.client_t} for e in ev],
                    "messages": [_msg(m) for m in msgs]}

    @app.post("/api/runs/{run_id}/photos", status_code=201, dependencies=[Depends(auth)])
    async def upload_photo(run_id: int, step_id: str, file: UploadFile = File(...)):
        if file.content_type not in ("image/jpeg", "image/png"):
            raise HTTPException(415, "Только JPEG/PNG")
        name = f"run{run_id}_{step_id}_{int(datetime.now().timestamp())}{Path(file.filename or '').suffix or '.jpg'}"
        (DATA_DIR / "photos" / name).write_bytes(await file.read())
        with Session() as s:
            s.add(RunEvent(run_id=run_id, step_id=step_id, event="photo_file", data={"file": name}))
            s.commit()
        return {"file": name}

    # ---------- чат ----------
    def _msg(m: Message) -> dict:
        return {"id": m.id, "author": m.author, "role": m.role, "text": m.text, "step_id": m.step_id,
                "created_at": m.created_at.isoformat() if m.created_at else None}

    def _save(run_id: int, m: MsgIn) -> dict:
        with Session() as s:
            if not s.get(Run, run_id):
                raise HTTPException(404, "Выполнение не найдено")
            row = Message(run_id=run_id, **m.model_dump())
            s.add(row)
            s.commit()
            return _msg(row)

    @app.post("/api/runs/{run_id}/messages", status_code=201, dependencies=[Depends(auth)])
    async def post_message(run_id: int, m: MsgIn):
        out = _save(run_id, m)
        for ws in list(rooms.get(run_id, ())):
            try:
                await ws.send_json(out)
            except Exception:
                rooms[run_id].discard(ws)
        return out

    @app.websocket("/ws/chat/{run_id}")
    async def chat(ws: WebSocket, run_id: int):
        await ws.accept()
        rooms.setdefault(run_id, set()).add(ws)
        try:
            while True:
                data = await ws.receive_json()
                out = _save(run_id, MsgIn(**data))
                for peer in list(rooms[run_id]):
                    await peer.send_json(out)
        except WebSocketDisconnect:
            rooms[run_id].discard(ws)

    @app.get("/api/health")
    def health():
        return {"ok": True}

    # модели GLB, листы КД (PNG) — кладутся технологом в server_data/files
    app.mount("/files", StaticFiles(directory=DATA_DIR / "files"), name="files")
    return app

