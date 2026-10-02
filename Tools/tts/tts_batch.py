#!/usr/bin/env python3
"""
tts_batch.py — черновая озвучка (draft VO) по Content/Rakis/Data/Dialogue_S1.csv (и Barks.csv).

    python3 Tools/tts/tts_batch.py                         # RU, бэкенд — auto
    python3 Tools/tts/tts_batch.py --lang en --backend espeak-ng
    python3 Tools/tts/tts_batch.py --barks                 # + Barks.csv → Export/vo/barks/
    python3 Tools/tts/tts_batch.py --only DLG_A1_003,DLG_B5_H01 --force
    python3 Tools/tts/tts_batch.py --backend plan          # только план (без синтеза)

Результат: Export/vo/<DialogueID>.wav (RU) или Export/vo/en/<DialogueID>.wav (EN).
Импорт в UE: Tools/unreal_python/audio_setup.py (→ /Game/Rakis/Audio/VO/<DialogueID>, = VO_File).

Бэкенды (подключаемые, см. BACKENDS):
  piper     — офлайн нейросетевой TTS; модели через env PIPER_MODEL_RU / PIPER_MODEL_EN или --piper-model;
  espeak-ng — офлайн формантный; голос/высота/темп по спикеру и эмоции;
  plan      — фоллбек: печатает план (что и каким голосом), ничего не пишет.
'auto' выбирает piper (если есть бинарь и модель) → espeak-ng → plan.
Пение жрицы: озвучивается только часть до '[' (выдуманный язык), перевод в скобках не читается.
Идемпотентность: существующие WAV пропускаются, если не указан --force.
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA = os.path.join(ROOT, "Content", "Rakis", "Data")
OUT = os.path.join(ROOT, "Export", "vo")

# Профили голосов: espeak-ng вариант, высота (0..99), темп (слов/мин), piper speaker id
VOICES = {
    "Kair": {"variant": "m3", "pitch": 38, "speed": 150, "piper_speaker": 0},
    "Ilva": {"variant": "f2", "pitch": 55, "speed": 140, "piper_speaker": 1},
    "Rayn": {"variant": "m1", "pitch": 58, "speed": 175, "piper_speaker": 2},
    "Ossana": {"variant": "f4", "pitch": 45, "speed": 160, "piper_speaker": 3},
    "Rider1": {"variant": "m2", "pitch": 35, "speed": 155, "piper_speaker": 4},
    "Rider2": {"variant": "m7", "pitch": 42, "speed": 160, "piper_speaker": 5},
    "Guard": {"variant": "m6", "pitch": 30, "speed": 145, "piper_speaker": 6},
    "Harmat": {"variant": "m4", "pitch": 22, "speed": 120, "piper_speaker": 7},
    "Priestess": {"variant": "f5", "pitch": 62, "speed": 95, "piper_speaker": 8},
    "Crowd": {"variant": "m5", "pitch": 45, "speed": 150, "piper_speaker": 9},
    "Lore": {"variant": "m3", "pitch": 40, "speed": 135, "piper_speaker": 0},
    # барки — по архетипу
    "Trader": {"variant": "m1", "pitch": 50, "speed": 175, "piper_speaker": 2},
    "Artisan": {"variant": "m2", "pitch": 44, "speed": 150, "piper_speaker": 4},
    "WaterCarrier": {"variant": "f3", "pitch": 50, "speed": 145, "piper_speaker": 1},
    "Child": {"variant": "f1", "pitch": 85, "speed": 180, "piper_speaker": 8},
    "Pilgrim": {"variant": "m5", "pitch": 40, "speed": 125, "piper_speaker": 9},
    "Elder": {"variant": "m4", "pitch": 25, "speed": 115, "piper_speaker": 7},
    "Weaver": {"variant": "f2", "pitch": 52, "speed": 140, "piper_speaker": 3},
}
# Эмоции: поправки к темпу/высоте/громкости; Whisper → вариант whisper у espeak-ng
EMOTION = {
    "Neutral": (0, 0, 100), "Calm": (-10, -2, 90), "Tense": (+15, +3, 110), "Afraid": (+25, +8, 105),
    "Angry": (+10, +5, 130), "Whisper": (-15, 0, 60), "Reverent": (-25, -4, 85), "Wry": (0, +2, 95),
}


def tts_text(line: str) -> str:
    t = line.split("[", 1)[0].strip()  # пение: без перевода
    t = t.replace("…", "...").replace("«", "").replace("»", "")
    return re.sub(r"\s+", " ", t)


# ---------------------------------------------------------------- бэкенды
class Backend:
    name = "base"

    def available(self, lang: str) -> bool:
        return False

    def synth(self, text: str, out_wav: str, voice: dict, emotion: str, lang: str) -> None:
        raise NotImplementedError


class PlanBackend(Backend):
    name = "plan"

    def available(self, lang):
        return True

    def synth(self, text, out_wav, voice, emotion, lang):
        print(f"  PLAN {os.path.relpath(out_wav, ROOT)}  [{lang}/{voice['variant']} p{voice['pitch']} "
              f"s{voice['speed']} {emotion}]  {text}")


class EspeakBackend(Backend):
    name = "espeak-ng"

    def __init__(self):
        self.bin = shutil.which("espeak-ng") or shutil.which("espeak")

    def available(self, lang):
        return self.bin is not None

    def synth(self, text, out_wav, voice, emotion, lang):
        ds, dp, amp = EMOTION.get(emotion, EMOTION["Neutral"])
        variant = "whisper" if emotion == "Whisper" else voice["variant"]
        cmd = [self.bin, "-v", f"{'ru' if lang == 'ru' else 'en-us'}+{variant}",
               "-p", str(max(0, min(99, voice["pitch"] + dp))),
               "-s", str(max(80, voice["speed"] + ds)), "-a", str(amp), "-w", out_wav, text]
        subprocess.run(cmd, check=True, capture_output=True)


class PiperBackend(Backend):
    name = "piper"

    def __init__(self, model_override: str | None):
        self.bin = shutil.which("piper")
        self.model_override = model_override

    def model(self, lang):
        return self.model_override or os.environ.get(f"PIPER_MODEL_{lang.upper()}")

    def available(self, lang):
        m = self.model(lang)
        return bool(self.bin and m and os.path.exists(m))

    def synth(self, text, out_wav, voice, emotion, lang):
        ds, _, _ = EMOTION.get(emotion, EMOTION["Neutral"])
        length_scale = round(150.0 / max(80, voice["speed"] + ds), 2)  # темп
        cmd = [self.bin, "--model", self.model(lang), "--output_file", out_wav,
               "--length_scale", str(length_scale)]
        if os.environ.get("PIPER_MULTISPEAKER"):
            cmd += ["--speaker", str(voice["piper_speaker"])]
        subprocess.run(cmd, input=text.encode("utf-8"), check=True, capture_output=True)


def pick_backend(name: str, lang: str, piper_model: str | None) -> Backend:
    cands = {"piper": PiperBackend(piper_model), "espeak-ng": EspeakBackend(), "plan": PlanBackend()}
    if name != "auto":
        b = cands[name]
        if not b.available(lang):
            print(f"[tts] бэкенд {name} недоступен — переключаюсь на plan")
            return cands["plan"]
        return b
    for key in ("piper", "espeak-ng", "plan"):
        if cands[key].available(lang):
            return cands[key]
    return cands["plan"]


# ---------------------------------------------------------------- main
def load(path: str, id_col: str, speaker_col: str) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["_id"], r["_speaker"] = r[id_col], r[speaker_col]
    return rows


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="tts_batch")
    ap.add_argument("--csv", default=os.path.join(DATA, "Dialogue_S1.csv"))
    ap.add_argument("--barks", action="store_true", help="также Barks.csv → Export/vo/barks/")
    ap.add_argument("--lang", choices=["ru", "en"], default="ru")
    ap.add_argument("--backend", choices=["auto", "piper", "espeak-ng", "plan"], default="auto")
    ap.add_argument("--piper-model", default=None)
    ap.add_argument("--only", default="", help="ID через запятую")
    ap.add_argument("--force", action="store_true", help="перезаписать существующие WAV")
    args = ap.parse_args(argv)

    backend = pick_backend(args.backend, args.lang, args.piper_model)
    print(f"[tts] бэкенд: {backend.name}, язык: {args.lang}")
    col = "Line_RU" if args.lang == "ru" else "Line_EN"
    base_out = OUT if args.lang == "ru" else os.path.join(OUT, "en")

    jobs = [(r, base_out) for r in load(args.csv, "DialogueID", "Speaker")]
    if args.barks:
        jobs += [(r, os.path.join(base_out, "barks")) for r in load(os.path.join(DATA, "Barks.csv"), "BarkID", "Archetype")]
    only = {s for s in args.only.split(",") if s}
    done = skipped = failed = 0
    for r, out_dir in jobs:
        if only and r["_id"] not in only:
            continue
        text = tts_text(r[col])
        if not text:
            continue
        out_wav = os.path.join(out_dir, f"{r['_id']}.wav")
        if os.path.exists(out_wav) and not args.force and backend.name != "plan":
            skipped += 1
            continue
        if backend.name != "plan":
            os.makedirs(out_dir, exist_ok=True)
        voice = VOICES.get(r["_speaker"], VOICES["Crowd"])
        try:
            backend.synth(text, out_wav, voice, r.get("Emotion") or "Neutral", args.lang)
            done += 1
        except (subprocess.CalledProcessError, OSError) as e:
            failed += 1
            print(f"[tts] FAIL {r['_id']}: {e}")
    print(f"[tts] готово: {done}, пропущено (есть): {skipped}, ошибок: {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
