#!/usr/bin/env python3
"""
music_analyze.py — замеры рендеров музыки (Web/tools/music_render.mjs → <dir>/*.f32).

    python3 Tools/tts/music_analyze.py /tmp/mus_render [--wav]        # таблица; --wav пишет <имя>.wav (16 бит) для прослушивания

Метрики по состоянию: RMS/peak (дБFS, по моно-сумме и по каналам), доля энергии <60 Гц, доля «тишины» (окна 0.5 с с RMS < −50 дБFS и
< −40 дБFS), NaN/Inf, клиппинг (|x|≥0.999), разрывы (макс. |Δ| между соседними сэмплами в окне 20 мс относительно RMS — детектор щелчков).
"""
import glob
import json
import os
import sys
import wave

import numpy as np


def load(path):
    meta = json.load(open(path[:-4] + ".json"))
    x = np.fromfile(path, dtype="<f4").reshape(-1, meta["ch"])
    return x, meta


def db(v):
    return 20 * np.log10(max(v, 1e-9))


def win_rms(m, sr, w=0.5):
    n = int(w * sr)
    k = len(m) // n
    return np.sqrt((m[: k * n].reshape(k, n) ** 2).mean(axis=1))


def analyze(x, meta):
    sr = meta["sr"]
    m = x.mean(axis=1)
    res = {
        "nan": int(np.sum(~np.isfinite(x))),
        "rms": db(np.sqrt(np.mean(m ** 2))),
        "peak": db(np.abs(x).max()),
        "clip": int(np.sum(np.abs(x) >= 0.999)),
    }
    X = np.abs(np.fft.rfft(m)) ** 2
    f = np.fft.rfftfreq(len(m), 1 / sr)
    tot = X.sum() + 1e-30
    res["sub60"] = 100 * X[f < 60].sum() / tot
    res["sub40"] = 100 * X[f < 40].sum() / tot
    wr = win_rms(m, sr)
    res["sil50"] = 100 * np.mean(wr < 10 ** (-50 / 20))
    res["sil40"] = 100 * np.mean(wr < 10 ** (-40 / 20))
    res["rms_act"] = db(np.sqrt(np.mean(wr[wr > 10 ** (-50 / 20)] ** 2))) if np.any(wr > 10 ** (-50 / 20)) else -120
    # саб-полоса (<60 Гц) во времени: сколько секунд она слышна (> −50 дБFS в окнах 0.5 с) и самый длинный непрерывный отрезок
    Y = np.fft.irfft(np.fft.rfft(m) * (f < 60), len(m))
    ws = win_rms(Y, sr)
    on = ws > 10 ** (-50 / 20)
    res["sub_s"] = float(on.sum() * 0.5)
    run = best = 0
    for v in on:
        run = run + 1 if v else 0
        best = max(best, run)
    res["sub_run"] = best * 0.5
    # щелчки: максимум |Δ| / локальный RMS (окно 20 мс) — у плавного звука мал
    d = np.abs(np.diff(m))
    w = int(0.02 * sr)
    k = len(d) // w
    dm = d[: k * w].reshape(k, w).max(axis=1)
    rr = np.sqrt((m[: k * w].reshape(k, w) ** 2).mean(axis=1)) + 1e-5
    res["click"] = float(np.max(dm / rr)) if k else 0.0
    res["maxd"] = float(d.max())
    return res


def main():
    d = sys.argv[1]
    wav = "--wav" in sys.argv
    print(f"{'state':14s} {'RMS':>6s} {'RMSact':>7s} {'peak':>6s} {'<60Hz%':>7s} {'<40Hz%':>7s} {'sil50%':>7s} {'sil40%':>7s} {'clip':>5s} {'nan':>4s} {'click':>6s} {'maxΔ':>6s} {'subS':>5s} {'subRun':>6s}")
    for p in sorted(glob.glob(os.path.join(d, "*.f32"))):
        x, meta = load(p)
        r = analyze(x, meta)
        print(f"{meta['state']:14s} {r['rms']:6.1f} {r['rms_act']:7.1f} {r['peak']:6.1f} {r['sub60']:7.2f} {r['sub40']:7.2f} {r['sil50']:7.1f} {r['sil40']:7.1f} {r['clip']:5d} {r['nan']:4d} {r['click']:6.1f} {r['maxd']:6.3f} {r['sub_s']:5.1f} {r['sub_run']:6.1f}")
        if wav:
            with wave.open(p[:-4] + ".wav", "wb") as w:
                w.setnchannels(meta["ch"]); w.setsampwidth(2); w.setframerate(meta["sr"])
                w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


if __name__ == "__main__":
    main()
