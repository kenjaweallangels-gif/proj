"""Голосовые команды: грамматика для Vosk и разбор фраз (docs/05_algorithms.md, п. 4)."""
from __future__ import annotations

import json
import re

WAKE = "сборка"

COMMANDS: dict[str, list[str]] = {
    "next": ["дальше", "далее", "следующий", "готово", "есть"],
    "prev": ["назад", "предыдущий"],
    "repeat": ["повтори", "ещё раз", "еще раз"],
    "slower": ["медленнее", "тише"],
    "faster": ["быстрее", "скорее"],
    "kd": ["покажи кд", "чертёж", "чертеж", "лист"],
    "chat": ["покажи чат", "чат", "сообщения"],
    "panel": ["панель", "развернуть", "свернуть"],
    "photo": ["фото", "снимок", "сфотографируй"],
    "ok": ["норма", "годно"],
    "reject": ["брак", "не годно", "негодно"],
    "call": ["позвать технолога", "написать технологу", "вопрос"],
}

_UNITS = {"ноль": 0, "один": 1, "одна": 1, "два": 2, "две": 2, "три": 3, "четыре": 4, "пять": 5, "шесть": 6,
          "семь": 7, "восемь": 8, "девять": 9, "десять": 10, "одиннадцать": 11, "двенадцать": 12,
          "пятнадцать": 15, "двадцать": 20, "тридцать": 30}
_POINT = {"и", "точка", "запятая", "целых"}


def grammar() -> str:
    """JSON-грамматика для vosk.KaldiRecognizer(model, 16000, grammar())."""
    phrases = {WAKE}
    for syns in COMMANDS.values():
        phrases.update(f"{WAKE} {s}" for s in syns)
    phrases.update(_UNITS)
    phrases.update(_POINT)
    phrases.add("[unk]")
    return json.dumps(sorted(phrases), ensure_ascii=False)


def parse_number(words: list[str]) -> float | None:
    """«шесть и восемь» → 6.8; «три» → 3; «двадцать пять» → 25; «1,5» → 1.5."""
    txt = " ".join(words)
    m = re.search(r"\d+(?:[.,]\d+)?", txt)
    if m:
        return float(m.group(0).replace(",", "."))
    whole, frac, in_frac, seen = 0, "", False, False
    for w in words:
        if w in _POINT and seen:
            in_frac = True
            continue
        if w in _UNITS:
            seen = True
            if in_frac:
                frac += str(_UNITS[w])
            else:
                whole += _UNITS[w]
    if not seen:
        return None
    return float(f"{whole}.{frac}") if frac else float(whole)


def parse(text: str, require_wake: bool = True) -> tuple[str, float | None] | None:
    """Фраза распознавания → (команда, значение). None — не команда."""
    t = text.lower().replace("ё", "е").strip()
    t = re.sub(r"[^\w\s,.]", " ", t)
    t = re.sub(r"(?<!\d)[,.]|[,.](?!\d)", " ", t)       # пунктуация, но не десятичная запятая «1,5»
    words = t.split()
    if not words:
        return None
    if require_wake:
        if words[0] != WAKE:
            return None
        words = words[1:]
    rest = " ".join(words)
    num = parse_number(words)
    for cmd, syns in COMMANDS.items():
        for s in sorted(syns, key=len, reverse=True):
            if rest.startswith(s.replace("ё", "е")):
                return cmd, None
    if num is not None:
        return "value", num
    return None


class VoskListener:
    """Офлайн-распознавание команд. Требует модель (setup/ubuntu/04_install_models.sh) и AudioSource."""

    def __init__(self, model_dir: str, sample_rate: int = 16000):
        from vosk import KaldiRecognizer, Model  # импорт здесь, чтобы тесты не требовали модель
        self.rec = KaldiRecognizer(Model(model_dir), sample_rate, grammar())

    def feed(self, pcm16: bytes) -> tuple[str, float | None] | None:
        if self.rec.AcceptWaveform(pcm16):
            text = json.loads(self.rec.Result()).get("text", "")
            return parse(text)
        return None
