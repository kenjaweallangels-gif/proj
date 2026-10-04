#!/usr/bin/env python3
"""
vo_verify.py — измерения качества озвучки без прослушивания (слух не заменяют, но ловят регрессии).

    python3 Tools/tts/piper_build.py --keep-wav /tmp/vo_wav            # сначала WAV
    python3 Tools/tts/vo_verify.py /tmp/vo_wav --f0                    # F0 по персонажам: медиана, p10–p90, вариативность (ст. в полутонах)
    python3 Tools/tts/vo_verify.py /tmp/vo_wav --asr 12                # ASR (faster-whisper small, ar) на N репликах: CER к арабице Line_NativeScript
    python3 Tools/tts/vo_verify.py /tmp/vo_wav --dur                   # длительности WAV против VO_DUR (субтитры)

Ориентиры: женщины 180–250 Гц, мужчины 90–140 Гц; sd_st (разброс F0 внутри реплики) у живой речи 2–4 полутона, у монотонной < 1.5.
Нужны: pip install librosa faster-whisper.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import wave
from collections import defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(ROOT, "Content", "Rakis", "Data")
FEMALE = {"Ilva", "Ossana", "Priestess", "Mother", "Weaver", "Carrier", "Pilgrim", "Girl", "Child"}


def load(p):
    with wave.open(p) as w:
        sr = w.getframerate()
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return a, sr


def f0_of(a, sr):
    import librosa
    f, v, _ = librosa.pyin(a, fmin=70, fmax=450, sr=sr, frame_length=2048)
    f = f[~np.isnan(f)]
    if len(f) < 8:
        return None
    med = float(np.median(f))
    return med, float(np.percentile(f, 10)), float(np.percentile(f, 90)), float(np.std(12 * np.log2(f / med)))


def rows():
    out = {}
    for r in csv.DictReader(open(os.path.join(DATA, "Dialogue_S1.csv"), encoding="utf-8")):
        out[r["DialogueID"]] = r
    for r in csv.DictReader(open(os.path.join(DATA, "Barks.csv"), encoding="utf-8")):
        out[r["BarkID"]] = {"Speaker": r["Archetype"], "BarkID": r["BarkID"]}
    return out


def norm(t):
    t = re.sub("[ً-ْـ]", "", t)
    t = re.sub("[إأآ]", "ا", t).replace("ى", "ي").replace("ة", "ه")
    return re.sub(r"[^ء-ي ]", "", t).strip()


def cer(a, b):
    a, b = a.replace(" ", ""), b.replace(" ", "")
    d = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        n = [i]
        for j, cb in enumerate(b, 1):
            n.append(min(d[j] + 1, n[-1] + 1, d[j - 1] + (ca != cb)))
        d = n
    return d[-1] / max(1, len(a))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wavdir")
    ap.add_argument("--f0", action="store_true")
    ap.add_argument("--asr", type=int, default=0)
    ap.add_argument("--dur", action="store_true")
    a = ap.parse_args()
    R = rows()
    files = sorted(f for f in os.listdir(a.wavdir) if f.endswith(".wav"))
    if a.f0:
        per = defaultdict(list)
        for f in files:
            did = f[:-4]
            spk = R.get(did, {}).get("Speaker")
            if not spk or spk == "Lore":
                continue
            x, sr = load(os.path.join(a.wavdir, f))
            if len(x) / sr < 1.0:
                continue
            m = f0_of(x, sr)
            if m:
                per[spk].append(m)
        print(f"{'speaker':10s} {'n':>3s} {'F0 med':>7s} {'p10':>5s} {'p90':>5s} {'sd_st':>6s}  ожидание")
        for spk, v in sorted(per.items()):
            arr = np.array(v)
            fem = spk in FEMALE
            med = float(np.median(arr[:, 0]))
            ok = (160 <= med <= 280) if fem else (80 <= med <= 150)
            print(f"{spk:10s} {len(v):3d} {med:7.0f} {np.median(arr[:, 1]):5.0f} {np.median(arr[:, 2]):5.0f} {np.median(arr[:, 3]):6.2f}  {'жен. 180–250' if fem else 'муж. 90–140'} {'OK' if ok else 'ВНЕ'}")
    if a.dur:
        durs = json.load(open(os.path.join(HERE, "vo_durations.json")))
        bad = 0
        for f in files:
            did = f[:-4]
            if did in durs:
                x, sr = load(os.path.join(a.wavdir, f))
                if abs(len(x) / sr - durs[did]) > 0.15:
                    bad += 1; print("расхождение", did, round(len(x) / sr, 2), durs[did])
        print(f"длительности: {len(files)} WAV, расхождений >0.15 с: {bad}")
    if a.asr:
        from faster_whisper import WhisperModel
        wm = WhisperModel("small", device="cpu", compute_type="int8")
        sel = [f for f in files if R.get(f[:-4], {}).get("Line_NativeScript")][:: max(1, len(files) // a.asr)][: a.asr]
        cs = []
        for f in sel:
            segs, _ = wm.transcribe(os.path.join(a.wavdir, f), language="ar", beam_size=3)
            hyp = norm(" ".join(s.text for s in segs))
            ref = norm(R[f[:-4]]["Line_NativeScript"])
            cs.append(cer(ref, hyp))
            print(f[:-4], round(cs[-1], 2), "|", hyp, "|", ref)
        print("средний CER:", round(float(np.mean(cs)), 3))


if __name__ == "__main__":
    main()
