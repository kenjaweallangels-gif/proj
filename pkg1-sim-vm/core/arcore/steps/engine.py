"""Движок шагов операции — машина состояний (docs/05_algorithms.md, п. 3)."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum


class State(str, Enum):
    IDLE = "idle"
    ALIGNING = "aligning"
    MANUAL_ALIGN = "manual_align"
    SHOWING = "showing"
    WAITING_VALUE = "waiting_value"
    WAITING_PHOTO = "waiting_photo"
    DONE = "done"


@dataclass
class LogEvent:
    t: float
    step_id: str | None
    event: str
    data: dict = field(default_factory=dict)


class StepEngine:
    ALIGN_TIMEOUT_S = 20.0
    MIN_QUALITY = 0.5

    def __init__(self, package_data: dict, clock=time.monotonic):
        self.pkg = package_data
        self.steps: list[dict] = package_data["steps"]
        self.clock = clock
        self.index = 0
        self.state = State.IDLE
        self.log: list[LogEvent] = []
        self.values: dict[str, float] = {}
        self.photos: set[str] = set()
        self._step_started = clock()
        self._align_started: float | None = None
        self.speed = 1.0

    # ---------- свойства ----------
    @property
    def step(self) -> dict:
        return self.steps[self.index]

    def _emit(self, event: str, **data) -> None:
        self.log.append(LogEvent(self.clock(), self.step["id"] if self.steps else None, event, data))

    # ---------- жизненный цикл ----------
    def start(self) -> None:
        self.index = 0
        self.state = State.ALIGNING if self.step["kind"] == "align" else State.SHOWING
        self._align_started = self.clock()
        self._step_started = self.clock()
        self._emit("start", op=self.pkg["operation"]["id"])

    def on_anchor(self, quality: float, err_mm: float | None = None) -> None:
        """Сообщение трекера: привязка найдена с качеством quality."""
        if self.state in (State.ALIGNING, State.MANUAL_ALIGN) and quality >= self.MIN_QUALITY:
            self._emit("aligned", quality=round(quality, 3), err_mm=err_mm)
            self.state = State.SHOWING

    def tick(self) -> None:
        if self.state == State.ALIGNING and self._align_started is not None:
            if self.clock() - self._align_started > self.ALIGN_TIMEOUT_S:
                self.state = State.MANUAL_ALIGN
                self._emit("align_timeout")
        norm = self.step.get("norm_s")
        if norm and self.state == State.SHOWING and self.clock() - self._step_started > 1.5 * norm:
            if not any(e.event == "over_norm" and e.step_id == self.step["id"] for e in self.log):
                self._emit("over_norm", norm_s=norm)

    def needs(self) -> str | None:
        s = self.step
        confirm = s.get("confirm", "voice")
        if confirm == "value" and s["id"] not in self.values:
            return "value"
        if confirm == "photo" and s["id"] not in self.photos:
            return "photo"
        return None

    # ---------- команды ----------
    def command(self, cmd: str, value: float | None = None) -> bool:
        """Возвращает True, если команда изменила состояние."""
        if self.state == State.DONE:
            return False
        if cmd == "next":
            if self.state in (State.ALIGNING, State.MANUAL_ALIGN):
                self._emit("rejected", reason="нет привязки")
                return False
            need = self.needs()
            if need == "value":
                self.state = State.WAITING_VALUE
                self._emit("need_value")
                return False
            if need == "photo":
                self.state = State.WAITING_PHOTO
                self._emit("need_photo")
                return False
            return self._advance()
        if cmd == "value" and value is not None:
            self.values[self.step["id"]] = float(value)
            ok = self._value_ok(float(value))
            self._emit("value", value=value, ok=ok)
            if ok:
                self.state = State.SHOWING
                return self._advance()
            return False
        if cmd == "photo":
            self.photos.add(self.step["id"])
            self._emit("photo")
            self.state = State.SHOWING
            return self._advance()
        if cmd == "prev" and self.index > 0:
            self.index -= 1
            self.state = State.SHOWING
            self._step_started = self.clock()
            self._emit("prev")
            return True
        if cmd == "repeat":
            self._emit("repeat")
            return True
        if cmd in ("slower", "faster"):
            self.speed = max(0.5, self.speed - 0.5) if cmd == "slower" else min(2.0, self.speed + 0.5)
            self._emit(cmd, speed=self.speed)
            return True
        if cmd in ("kd", "chat", "panel"):
            self._emit(cmd)
            return True
        if cmd == "manual_aligned" and self.state == State.MANUAL_ALIGN:
            self.state = State.SHOWING
            self._emit("aligned_manual")
            return True
        return False

    def _value_ok(self, v: float) -> bool:
        chk = self.step.get("check") or {}
        if "nominal_mm" in chk and "tol_mm" in chk:
            return abs(v - chk["nominal_mm"]) <= chk["tol_mm"]
        tq = (self.step.get("params") or {}).get("torque_nm")
        if tq:
            return abs(v - tq) <= 0.1 * tq
        return True

    def _advance(self) -> bool:
        self._emit("done", duration_s=round(self.clock() - self._step_started, 1))
        if self.index >= len(self.steps) - 1:
            self.state = State.DONE
            self._emit("operation_done")
            return True
        self.index += 1
        self.state = State.SHOWING
        self._step_started = self.clock()
        return True

    # ---------- для клиента ----------
    def message(self) -> dict:
        s = self.step
        return {"type": "step", "op": self.pkg["operation"]["id"], "index": self.index, "total": len(self.steps),
                "id": s["id"], "title": s["title"], "state": self.state.value, "speed": self.speed,
                "need": self.needs()}
