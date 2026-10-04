#!/usr/bin/env python3
"""Анализ WAV (float32/PCM) из Web/tools/audio_render.mjs: RMS/peak, доля энергии < 60 Гц, тональность НЧ, щелчки.
python3 Tools/sfx/sfx_analyze.py DIR/*.wav [--skip 0]
Колонки: rms/peak dBFS; lf60 — доля энергии < 60 Гц от полной (%); lf120; lfMed — медиана по 0.5-с окнам доли энергии <60 Гц, % (постоянный гул => высокая медиана; редкие удары её не поднимают); tonal — пик НЧ-спектра (20-250 Гц) над медианой, дБ (>=18 — тональный гул);
clicks — число скачков |x[i]-x[i-1]| > 0.5 (щелчки/разрывы); bands — энергия по октавам, дБ относительно полной.
"""
import sys
import numpy as np
from scipy.io import wavfile
from scipy.signal import welch


def db(x):
    return 20 * np.log10(max(x, 1e-9))


def analyze(path, skip=0.0):
    sr, x = wavfile.read(path)
    x = x.astype(np.float64) / (32768.0 if x.dtype == np.int16 else 1.0)
    m = x.mean(axis=1) if x.ndim == 2 else x
    m = m[int(skip * sr):]
    if len(m) < sr:
        return None
    nan = int((~np.isfinite(m)).sum())
    rms = np.sqrt(np.mean(m ** 2)); peak = np.max(np.abs(x))
    f, P = welch(m, sr, nperseg=16384)
    tot = P.sum()
    lf60 = P[f < 60].sum() / tot * 100; lf120 = P[f < 120].sum() / tot * 100
    # окна 0.5 с: постоянство НЧ
    w = int(0.5 * sr); fr = []
    for i in range(0, len(m) - w, w):
        ff, pp = welch(m[i:i + w], sr, nperseg=8192)
        fr.append((pp[ff < 60].sum() / (pp.sum() + 1e-18), pp.sum()))
    fr = np.array(fr)
    loud = fr[:, 1] > 1e-8
    stable = float(np.median(fr[loud, 0])) * 100 if loud.any() else 0.0
    sel = (f >= 20) & (f <= 250)
    Pl = 10 * np.log10(P[sel] + 1e-18)
    tonal = float(Pl.max() - np.median(Pl))
    d = np.abs(np.diff(m))
    clicks = int((d > 0.5).sum())
    edges = [20, 60, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
    bands = []
    for a, b in zip(edges[:-1], edges[1:]):
        bands.append(int(round(10 * np.log10(P[(f >= a) & (f < b)].sum() / tot + 1e-12))))
    return dict(rms=db(rms), peak=db(peak), lf60=lf60, lf120=lf120, stable=stable, tonal=tonal, clicks=clicks, nan=nan, bands=bands, dc=float(np.mean(m)))


def main():
    args = sys.argv[1:]
    skip = 0.0
    if '--skip' in args:
        i = args.index('--skip'); skip = float(args[i + 1]); del args[i:i + 2]
    print(f"{'scene':<16}{'rms':>7}{'peak':>7}{'lf<60%':>8}{'lf<120%':>9}{'lfMed%':>10}{'tonal':>7}{'clicks':>7}{'nan':>5}  bands(20-60..8k-16k, dB rel.)")
    for p in args:
        r = analyze(p, skip)
        name = p.split('/')[-1].replace('.wav', '')
        if not r:
            print(f'{name:<16} слишком короткий'); continue
        print(f"{name:<16}{r['rms']:>7.1f}{r['peak']:>7.1f}{r['lf60']:>8.2f}{r['lf120']:>9.2f}{r['stable']:>10.2f}{r['tonal']:>7.1f}{r['clicks']:>7d}{r['nan']:>5d}  {r['bands']}")


if __name__ == '__main__':
    main()
