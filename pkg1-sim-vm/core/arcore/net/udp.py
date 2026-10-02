"""Публикация сообщений клиенту отображения по UDP JSON (docs/02_hal_contracts.md)."""
from __future__ import annotations

import json
import socket

import numpy as np


class UdpDisplaySink:
    def __init__(self, host: str = "127.0.0.1", port: int = 47100, fov_diag_deg: float = 52.0):
        self.addr = (host, port)
        self.fov_diag_deg = fov_diag_deg
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def publish(self, msg: dict) -> None:
        data = json.dumps(msg, ensure_ascii=False, default=_np).encode("utf-8")
        self.sock.sendto(data, self.addr)


class UdpInput:
    """Команды от клиента (кнопки, жесты) — порт 47101."""

    def __init__(self, port: int = 47101):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("0.0.0.0", port))
        self.sock.setblocking(False)

    def poll(self) -> list[dict]:
        out = []
        while True:
            try:
                data, _ = self.sock.recvfrom(65536)
            except BlockingIOError:
                return out
            try:
                out.append(json.loads(data.decode("utf-8")))
            except ValueError:
                continue


def _np(o):
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (np.floating, np.integer, np.bool_)):
        return o.item()
    raise TypeError(type(o))
