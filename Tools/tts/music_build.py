#!/usr/bin/env python3
"""
music_build.py — офлайн-синтез музыкальных стемов «Ракиса» (numpy → ffmpeg/Opus) → Web/src/assets/music.js.

    python3 Tools/tts/music_build.py                       # собрать все паки → Web/src/assets/music.js
    python3 Tools/tts/music_build.py --keep-wav /tmp/mus   # + сохранить WAV каждого стема для анализа
    python3 Tools/tts/music_build.py --only voc,perc       # пересобрать часть паков (остальные берутся из кэша .cache/music)

Эстетика: оригинальный материал в духе «киношного» эпоса пустыни (без цитат): женский вокализ без слов с мелизмами и глиссандо
(формантный синтез: гласные, вибрато с задержкой, дыхание), горловое/обертоновое пение, низкий мужской хор, «медь» с перегрузом,
дудук и волынкоподобный дрон, рамочные барабаны, металлический скрежет. Лад — хиджаз-подобный на D (D Eb F# G A Bb C).

Стемы короткие (4–16 с), с запечёнными fade на краях; зацикливание/нахлёст делает рантайм (music.js). Все стемы моно: ширину даёт рантайм.
Паки: voc (вокал), choir (хор + горловое), brass (медь + дудук + волынка), perc (барабаны, удары, скрежет, подъёмы, саб-бум).
Опус моно 26–32 кбит/с. Детерминированно (seed).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import tempfile
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_JS = os.path.join(ROOT, "Web", "src", "assets", "music.js")
CACHE = os.path.join(HERE, ".cache", "music")
SR = 24000
GAP = 0.25          # тишина между стемами в паке, с
TARGET_RMS = {"voc": -20.0, "choir": -20.0, "brass": -20.0, "perc": None}   # дБFS; perc нормируется по пику


# ======================================================================================================================
# Примитивы
# ======================================================================================================================
def rng(seed):
    return np.random.default_rng(seed)


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def mtof(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=float) - 69.0) / 12.0)


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def pw(t, pts):
    """Кусочно-линейная огибающая: pts=[(t,v),...]."""
    xs, ys = zip(*pts)
    return np.interp(t, xs, ys)


def smooth_noise(n, cutoff, seed):
    """Гауссов шум, срезанный ФНЧ в частотной области; нормирован к std=1."""
    r = rng(seed)
    x = r.standard_normal(n)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    X *= np.exp(-(f / max(cutoff, 1e-3)) ** 2)
    y = np.fft.irfft(X, n)
    s = y.std()
    return y / s if s > 0 else y


def fft_filter(x, fn):
    n = len(x)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    return np.fft.irfft(X * fn(f), n)


def lowpass(x, fc, order=2):
    return fft_filter(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * order)))


def highpass(x, fc, order=2):
    return fft_filter(x, lambda f: 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** (2 * order)))


def bandpass_noise(n, f0, bw, seed):
    r = rng(seed)
    x = r.standard_normal(n)
    y = fft_filter(x, lambda f: np.exp(-0.5 * ((f - f0) / bw) ** 2))
    s = y.std()
    return y / s if s > 0 else y


def fade_edges(x, a=0.05, b=0.15):
    n = len(x)
    ia, ib = int(a * SR), int(b * SR)
    if ia > 0:
        x[:ia] *= np.sin(0.5 * np.pi * np.arange(ia) / ia) ** 2
    if ib > 0:
        x[n - ib:] *= np.cos(0.5 * np.pi * np.arange(ib) / ib) ** 2
    return x


def reverb_ir(rt60, dark=0.6, pre=0.02, seed=5):
    n = int(rt60 * SR * 1.1)
    r = rng(seed)
    w = r.standard_normal(n)
    t = np.arange(n) / SR
    env = 10 ** (-3 * t / rt60)
    ir = w * env
    ir = fft_filter(ir, lambda f: 1 / (1 + (f / (9000 * (1 - dark * 0.7))) ** 2) * (1 / (1 + (60 / np.maximum(f, 1)) ** 2)))
    ir[: int(pre * SR)] = 0
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    return ir


def convolve(x, ir):
    n = len(x) + len(ir) - 1
    N = 1 << (n - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[:n]
    return y


def add_reverb(x, wet=0.2, rt60=1.2, dark=0.6, seed=5, tail=True):
    y = convolve(x, reverb_ir(rt60, dark, seed=seed))
    out = np.zeros(len(y))
    out[: len(x)] += x * (1 - wet * 0.3)
    out += y * wet * 2.0
    return out if tail else out[: len(x)]


def rms_db(x):
    r = np.sqrt(np.mean(x ** 2)) + 1e-12
    return 20 * np.log10(r)


def active_rms_db(x, thresh_db=-50):
    """RMS по «звучащим» окнам (для нормировки стемов с паузами)."""
    w = int(0.05 * SR)
    n = len(x) // w
    if n == 0:
        return rms_db(x)
    fr = x[: n * w].reshape(n, w)
    e = np.sqrt((fr ** 2).mean(axis=1))
    mx = e.max() + 1e-12
    sel = e > mx * 10 ** (-24 / 20)
    return 20 * np.log10(np.sqrt((fr[sel] ** 2).mean()) + 1e-12)


# ======================================================================================================================
# Формантный голос (гармонический синтез с огибающей резонаторов)
# ======================================================================================================================
# Гласные: [(F, полоса)] ×4. Женский / мужской наборы.
VOW_F = {
    "ah": [(820, 100), (1200, 120), (2850, 160), (3600, 220)],
    "oh": [(520, 90), (900, 110), (2800, 160), (3500, 220)],
    "oo": [(360, 80), (820, 110), (2700, 160), (3500, 220)],
    "ee": [(320, 80), (2300, 140), (3000, 180), (3700, 220)],
    "eh": [(620, 100), (1800, 130), (2750, 170), (3500, 220)],
    "um": [(300, 90), (1000, 160), (2400, 220), (3400, 300)],      # закрытый «м», носовой
}
VOW_M = {
    "ah": [(660, 90), (1080, 100), (2650, 150), (3400, 200)],
    "oh": [(450, 80), (800, 100), (2600, 150), (3300, 200)],
    "oo": [(310, 70), (820, 100), (2300, 150), (3200, 200)],
    "ee": [(280, 70), (2150, 120), (2750, 160), (3400, 200)],
    "eh": [(520, 90), (1700, 120), (2550, 160), (3300, 200)],
    "um": [(280, 80), (900, 150), (2200, 200), (3100, 280)],
}


def vowel_track(n, segs, table, trans=0.22):
    """segs=[(t_start, vowel)] → массивы F[4,n], BW[4,n] с плавным переходом гласных."""
    t = np.arange(n) / SR
    F = np.zeros((4, n))
    B = np.zeros((4, n))
    cur = np.array([table[segs[0][1]][i][0] for i in range(4)], float)[:, None] * np.ones((4, n))
    curb = np.array([table[segs[0][1]][i][1] for i in range(4)], float)[:, None] * np.ones((4, n))
    F[:] = cur
    B[:] = curb
    for ts, v in segs[1:]:
        w = smoothstep((t - ts) / trans)
        tgt = np.array([table[v][i][0] for i in range(4)], float)[:, None]
        tgb = np.array([table[v][i][1] for i in range(4)], float)[:, None]
        F = F * (1 - w) + tgt * w
        B = B * (1 - w) + tgb * w
    return F, B


def resonance(f, Fc, bw):
    """Амплитудная характеристика резонатора 2-го порядка (на частоте Fc ≈ Q)."""
    r = f / Fc
    Q = Fc / bw
    return 1.0 / np.sqrt((1 - r * r) ** 2 + (r / Q) ** 2)


def harmonic_voice(f0, F, B, amp, *, tilt=1.0, nharm=None, fmax=7500.0, ctrl=48, seed=1, formant_gain=1.0, odd_boost=1.0, even_cut=1.0):
    """
    f0[n] (Гц), F/B[4,n], amp[n]. Гармоники k·f0 с амплитудой tilt·H(k·f0). Огибающая считается на редкой сетке (ctrl сэмплов)
    и интерполируется; фаза — интеграл мгновенной частоты. Возвращает сигнал длины n.
    """
    n = len(f0)
    phi = 2 * np.pi * np.cumsum(f0) / SR
    idx = np.arange(0, n, ctrl)
    if idx[-1] != n - 1:
        idx = np.append(idx, n - 1)
    f0c = f0[idx]
    Fc, Bc = F[:, idx], B[:, idx]
    K = nharm or int(fmax / max(f0.min(), 40))
    K = min(K, 90)
    out = np.zeros(n)
    r = rng(seed)
    allx = np.arange(n)
    for k in range(1, K + 1):
        fk = k * f0c
        a = np.ones_like(fk)
        for i in range(4):
            a *= resonance(fk, Fc[i], Bc[i]) / (Fc[i] / Bc[i]) ** 0.5     # деление на sqrt(Q): пики не доминируют чрезмерно
        a = a * (k ** -tilt) * formant_gain
        if k % 2 == 1:
            a = a * odd_boost
        else:
            a = a * even_cut
        a = a * (1 / (1 + (fk / fmax) ** 8)) * (fk < 11500)
        ak = np.interp(allx, idx, a)
        out += ak * np.cos(k * phi + r.uniform(0, 0.8))
    return out * amp


def note_contour(notes, n, *, glide=0.11, vib_rate=5.3, vib_depth=0.35, vib_delay=0.45, drift=0.10, seed=3, start=0.15, orn_depth=0.5):
    """
    notes=[(midi, dur, vowel, kind)] → f0[n], амплитуда-огибающая[n], момент начала каждой ноты, словарь гласных-сегментов.
    kind: 'n' обычная, 'scoop' (заход снизу), 'tr' (трель/форшлаг), 'fall' (падение в конце), 'turn' (группетто), 'gam' (быстрое «гамак»-дрожание).
    Глиссандо между нотами — косинусное, длительность glide.
    """
    t = np.arange(n) / SR
    cur_t = start
    pitch = np.zeros(n)
    amp = np.zeros(n)
    onsets = []
    prev = None
    vsegs = []
    note_ts = []
    for (m, d, vow, kind) in notes:
        note_ts.append((cur_t, d, m, kind))
        vsegs.append((cur_t - 0.04, vow))
        cur_t += d
    # высота: ступенчатая функция + сглаживание глиссандо
    midi = np.full(n, float(notes[0][0]))
    for i, (ts, d, m, kind) in enumerate(note_ts):
        if i == 0:
            midi[:] = m
            continue
        g = glide * (1.7 if kind == 'scoop' else 1.0) * (0.6 if d < 0.5 else 1.0)
        w = smoothstep((t - (ts - g * 0.5)) / g)
        midi = midi * (1 - w) + m * w
    # украшения
    for (ts, d, m, kind) in note_ts:
        i0, i1 = int(ts * SR), min(n, int((ts + d) * SR))
        seg = t[i0:i1] - ts
        if kind == 'scoop':
            midi[i0:i1] += -1.6 * np.exp(-seg / 0.22) * orn_depth * 1.5
        elif kind == 'fall':
            fs = max(d - 0.9, d * 0.5)
            midi[i0:i1] += -2.6 * smoothstep((seg - fs) / (d - fs + 1e-6)) ** 1.6 * orn_depth * 2.0
        elif kind == 'tr':
            on = np.clip((seg - 0.25) / 0.2, 0, 1) * np.clip((d - 0.1 - seg) / 0.2, 0, 1)
            midi[i0:i1] += 0.9 * orn_depth * 2.0 * on * (0.5 - 0.5 * np.cos(2 * np.pi * 6.4 * seg))
        elif kind == 'turn':
            # группетто: +1, 0, -1, 0 за первые 0.45 с
            seq = np.interp(seg, [0, 0.1, 0.2, 0.3, 0.4, 0.5], [0, 1.0, 0, -1.0, 0, 0])
            midi[i0:i1] += seq * orn_depth * 1.6
        elif kind == 'gam':
            midi[i0:i1] += 0.45 * np.sin(2 * np.pi * 8.5 * seg) * np.clip(seg / 0.2, 0, 1) * orn_depth * 2
    # вибрато с задержкой в каждой ноте + дрейф
    vib = np.zeros(n)
    for (ts, d, m, kind) in note_ts:
        i0, i1 = int(ts * SR), min(n, int((ts + d) * SR))
        seg = t[i0:i1] - ts
        grow = smoothstep((seg - vib_delay) / 0.9)
        rate = vib_rate * (1 + 0.04 * np.sin(2 * np.pi * 0.31 * seg))
        vib[i0:i1] = grow * np.sin(2 * np.pi * np.cumsum(rate) / SR + ts)
    midi = midi + vib * vib_depth + smooth_noise(n, 2.0, seed) * drift + smooth_noise(n, 25, seed + 1) * 0.04
    f0 = mtof(midi)
    # амплитуда: нота = мягкая атака, лёгкое «дыхание» внутри долгих нот
    env = np.zeros(n)
    for i, (ts, d, m, kind) in enumerate(note_ts):
        i0, i1 = int(ts * SR), min(n, int((ts + d) * SR))
        seg = t[i0:i1] - ts
        a_t = 0.12 if i == 0 or d > 1.0 else 0.05
        e = np.clip(seg / a_t, 0, 1) ** 1.5
        rel = 0.25 if i == len(note_ts) - 1 else 0.05
        e *= np.clip((d - seg) / rel, 0, 1) if i == len(note_ts) - 1 else 1.0
        if d > 1.6:
            e *= 0.82 + 0.18 * np.sin(2 * np.pi * (seg / d) * 1.0 + 1.0) ** 2 + 0.0
            e *= 1 + 0.25 * np.sin(np.pi * np.clip(seg / d, 0, 1))      # купол: набор к середине
        env[i0:i1] = np.maximum(env[i0:i1], e) if kind != 'x' else e
    # внутринотные «провалы» на стыках быстрых нот (лёгкая артикуляция)
    for (ts, d, m, kind) in note_ts[1:]:
        i0 = int(ts * SR)
        w = int(0.05 * SR)
        env[max(0, i0 - w): i0 + w] *= 1 - 0.22 * np.hanning(len(env[max(0, i0 - w): i0 + w]))
    return f0, env, vsegs, note_ts


def sing(notes, *, female=True, level=1.0, breath=0.05, tilt=1.0, seed=7, vib_depth=0.35, vib_rate=5.3, tail=1.0, pressed=0.0, glide=0.17, fmax=7500.0):
    dur = sum(d for (_, d, _, _) in notes) + 0.15 + tail
    n = int(dur * SR)
    f0, env, vsegs, note_ts = note_contour(notes, n, seed=seed, vib_depth=vib_depth, vib_rate=vib_rate, glide=glide)
    F, B = vowel_track(n, vsegs, VOW_F if female else VOW_M)
    # настройка F1 под f0 для высоких нот (солистка «подтягивает» гласную)
    if female:
        F[0] = np.maximum(F[0], np.minimum(f0 * 1.02, 1100))
    # «Прижатость» (pressed): более яркий источник
    sig = harmonic_voice(f0, F, B, env, tilt=tilt - 0.35 * pressed, seed=seed, fmax=fmax)
    # шум дыхания через те же форманты: узкополосные шумы вокруг F1..F3
    r = rng(seed + 11)
    t = np.arange(n) / SR
    br = np.zeros(n)
    for i in range(3):
        nz = smooth_noise(n, max(40.0, B[i].mean() * 0.8), seed + 20 + i)
        ph = 2 * np.pi * np.cumsum(F[i]) / SR
        br += nz * np.cos(ph) * (0.8 if i == 0 else 0.5 if i == 1 else 0.3)
    # дыхание — сильнее на атаках нот и в концах фраз
    atk = np.zeros(n)
    for (ts, d, m, kind) in note_ts:
        i0 = int(ts * SR)
        seg = np.arange(n) / SR - ts
        atk += np.exp(-np.clip(seg, 0, None) / 0.12) * (seg >= 0) * (1.0 if d > 0.9 else 0.4)
    bamp = (breath * (0.35 + 0.65 * env) + breath * 1.5 * np.clip(atk, 0, 1)) * (env > 1e-3)
    sig = sig / (np.sqrt(np.mean(sig ** 2)) + 1e-9)
    br = br / (np.sqrt(np.mean(br ** 2)) + 1e-9) * 0.5
    out = sig + br * bamp * 2.0 * np.sqrt(np.mean((sig * (env > 0.05)) ** 2) + 1e-9)
    out = highpass(out, 110 if female else 55)
    return out * level


# ======================================================================================================================
# Хор, горловое пение, медь, дудук, волынка
# ======================================================================================================================
def choir_pad(freqs, dur, vowels, *, voices=5, seed=1, fade=(3.5, 4.0), vib=0.0, level=1.0, bright=1.0):
    """Мужской хор: каждый тон — несколько расстроенных голосов (±10 центов), общие форманты, медленный переход гласных."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    r = rng(seed)
    segs = [(0.0, vowels[0])]
    for i, v in enumerate(vowels[1:], 1):
        segs.append((dur * i / len(vowels), v))
    F, B = vowel_track(n, segs, VOW_M, trans=2.5)
    out = np.zeros(n)
    for fi, fb in enumerate(freqs):
        for v in range(voices):
            det = r.uniform(-10, 10) / 100.0 / 12 * 1.0       # доли полутона → ниже пересчёт
            cents = r.uniform(-11, 11)
            f0 = fb * 2 ** (cents / 1200) * (1 + 0.0012 * smooth_noise(n, 0.6, seed * 100 + fi * 10 + v))
            f0 = f0 * (1 + 0.004 * np.sin(2 * np.pi * r.uniform(4.2, 5.2) * t + r.uniform(0, 6)) * smoothstep((t - 3) / 3) * vib)
            amp = np.ones(n) * r.uniform(0.7, 1.0)
            out += harmonic_voice(f0, F, B, amp, tilt=1.05 / bright, seed=seed * 7 + fi * 3 + v, fmax=6500.0, ctrl=64)
    env = pw(t, [(0, 0), (fade[0], 1), (dur - fade[1], 1), (dur, 0)])
    env = env ** 1.4 * (0.85 + 0.15 * np.sin(2 * np.pi * t / 7.3 + seed))
    out = highpass(out * env, 58)
    out = out / (np.sqrt(np.mean(out ** 2)) + 1e-9)
    return fade_edges(out * level, 0.02, 0.05)


def throat_song(f0v, harmonics, durs, dur, *, seed=3, level=1.0, growl=0.0):
    """Обертоновое пение: бурдон f0 (прижатый источник) + узкая подвижная форманта на гармониках — «поёт» мелодию."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    # траектория центра узкой форманты (в гармониках): ступени со скольжением
    ts = np.cumsum([0.4] + list(durs))
    hk = np.zeros(n)
    hk[:] = harmonics[0]
    for i in range(1, len(harmonics)):
        w = smoothstep((t - ts[i - 1]) / 0.45)
        hk = hk * (1 - w) + harmonics[i] * w
    hk = hk * (1 + 0.0015 * np.sin(2 * np.pi * 5.6 * t) * smoothstep((t - 3) / 2))
    f0 = f0v * (1 + 0.0016 * smooth_noise(n, 0.5, seed))
    F = np.zeros((4, n))
    B = np.zeros((4, n))
    F[0] = 340; B[0] = 130
    F[1] = f0 * hk; B[1] = 18 + 0 * t
    F[2] = f0 * (hk + 5.0); B[2] = 260
    F[3] = 3200; B[3] = 400
    amp = pw(t, [(0, 0), (2.5, 1), (dur - 3.5, 1), (dur, 0)]) * (0.88 + 0.12 * np.sin(2 * np.pi * t / 5.1))
    sig = harmonic_voice(f0, F, B, amp, tilt=0.55, seed=seed, fmax=6000.0, ctrl=24)
    # низкий «рычащий» подслой: октавой ниже, слабый (каргыраа-подобный) — только если f0>= 60 Гц
    if growl > 0:
        sub = harmonic_voice(f0 * 0.5, np.stack([np.full(n, 300.), np.full(n, 700.), np.full(n, 1800.), np.full(n, 3000.)]),
                             np.stack([np.full(n, 150.)] * 4), amp, tilt=1.3, fmax=1500.0, ctrl=64)
        sub = sub / (np.sqrt(np.mean(sub ** 2)) + 1e-9)
        sig = sig / (np.sqrt(np.mean(sig ** 2)) + 1e-9) + growl * sub
    sig = highpass(sig, 62)
    sig = sig / (np.sqrt(np.mean(sig ** 2)) + 1e-9)
    return fade_edges(sig * level, 0.02, 0.05)


def brass_swell(freqs, dur, *, peak_at=0.55, attack=3.0, drive=3.0, bright=1.0, seed=1, scoop=0.3, level=1.0, stab=False):
    """Низкая «медь»: пилообразные гармоники, раскрытие яркости по огибающей, перегруз tanh, лёгкое скольжение вверх."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    r = rng(seed)
    if stab:
        env = pw(t, [(0, 0), (0.12, 1), (0.5, 0.75), (dur * 0.6, 0.35), (dur, 0)])
    else:
        env = pw(t, [(0, 0), (attack, 0.8), (dur * peak_at, 1.0), (dur - 1.2, 0.35), (dur, 0)])
    env = env ** 1.3
    br = 0.12 + 0.88 * env                           # яркость растёт с громкостью
    out = np.zeros(n)
    for fi, fb in enumerate(freqs):
        for v in range(3):
            cents = r.uniform(-8, 8)
            sl = 1 - scoop * 0.02 * np.exp(-t / 0.5)
            f0 = fb * 2 ** (cents / 1200) * sl * (1 + 0.0018 * smooth_noise(n, 0.7, seed * 50 + fi * 5 + v))
            f0 = f0 * (1 + 0.003 * np.sin(2 * np.pi * 4.6 * t) * smoothstep((t - 1.5) / 2))
            phi = 2 * np.pi * np.cumsum(f0) / SR
            idx = np.arange(0, n, 48)
            Kmax = int(9000 / fb)
            sig = np.zeros(n)
            for k in range(1, min(Kmax, 60) + 1):
                fc = 380 + 2600 * br * bright            # частота среза растёт с яркостью
                ac = (k ** -0.95) / np.sqrt(1 + ((k * fb) / fc[idx]) ** 4)
                sig += np.interp(np.arange(n), idx, ac) * np.cos(k * phi + r.uniform(0, 6.28))
            out += sig
    out = out / (np.sqrt(np.mean(out ** 2)) + 1e-9)
    out = np.tanh(out * drive * (0.4 + 0.9 * env)) * env                 # перегруз — «грязная медь»; громче → грязнее
    out = out + 0.04 * bandpass_noise(n, 1800, 900, seed + 9) * env      # шум дутья
    out = highpass(out, 55)
    out = lowpass(out, 4200)
    out = out / (np.sqrt(np.mean(out ** 2)) + 1e-9)
    return fade_edges(out * level * np.maximum(env, 0) ** 0.5, 0.01, 0.2)


def duduk(notes, *, level=1.0, seed=2, breath=0.05):
    """Дудук: язычковый тон (богатые гармоники, нос), вибрато с задержкой, скольжения, шум дыхания."""
    dur = sum(d for (_, d, _, _) in notes) + 0.5
    n = int(dur * SR)
    f0, env, vsegs, _ = note_contour(notes, n, glide=0.15, vib_rate=4.9, vib_depth=0.22, vib_delay=0.6, seed=seed, orn_depth=0.45)
    F = np.zeros((4, n)); B = np.zeros((4, n))
    F[0] = 700 + 0 * f0; B[0] = 260
    F[1] = 1250; B[1] = 300
    F[2] = 2350; B[2] = 450
    F[3] = 3400; B[3] = 600
    sig = harmonic_voice(f0, F, B, env, tilt=0.75, odd_boost=1.0, even_cut=0.55, seed=seed, fmax=6000.0)
    sig = sig / (np.sqrt(np.mean(sig ** 2)) + 1e-9)
    nz = bandpass_noise(n, 2400, 1300, seed + 4) * env * breath * 1.4
    nz += smooth_noise(n, 80, seed + 5) * 0
    out = highpass(sig * env ** 0.5 + nz, 120)
    return fade_edges(out * level, 0.03, 0.2)


def pipe_drone(f_list, dur, *, seed=4, level=1.0):
    """Волынкоподобный дрон: ровный язычковый тон (нечётные гармоники), две-три высоты, едва слышное биение."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    r = rng(seed)
    F = np.stack([np.full(n, 560.), np.full(n, 1450.), np.full(n, 2300.), np.full(n, 3300.)])
    B = np.stack([np.full(n, 220.), np.full(n, 260.), np.full(n, 400.), np.full(n, 600.)])
    for i, f in enumerate(f_list):
        for c in (-2.5, 2.5):
            f0 = f * 2 ** ((c + r.uniform(-0.8, 0.8)) / 1200) * (1 + 0.0007 * smooth_noise(n, 0.4, seed + i))
            out += harmonic_voice(f0, F, B, np.ones(n), tilt=0.55, odd_boost=1.0, even_cut=0.35, seed=seed + i, fmax=5200.0, ctrl=64) * (1.0 if i == 0 else 0.6)
    env = pw(t, [(0, 0), (3.2, 1), (dur - 3.5, 1), (dur, 0)]) * (0.8 + 0.2 * np.sin(2 * np.pi * t / 6.7 + 1))
    out = highpass(out * env, 100)
    out = out / (np.sqrt(np.mean(out ** 2)) + 1e-9)
    return fade_edges(out * level, 0.03, 0.1)


# ======================================================================================================================
# Ударные
# ======================================================================================================================
MEMBRANE = [(1.0, 1.0, 1.0), (1.59, 0.55, 0.62), (2.14, 0.38, 0.45), (2.30, 0.28, 0.40), (2.65, 0.2, 0.30), (2.92, 0.14, 0.25), (3.5, 0.08, 0.2)]


def membrane_hit(f0, dur, *, decay=0.7, drop=0.28, slap=0.3, thump=0.5, seed=1, slap_f=1700, soft=0.0, body_noise=0.1):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    r = rng(seed)
    for (ratio, a, dm) in MEMBRANE:
        f = f0 * ratio * (1 + drop * np.exp(-t / (0.045 + 0.02 * ratio * 0)))
        ph = 2 * np.pi * np.cumsum(f) / SR + r.uniform(0, 1)
        out += a * np.sin(ph) * np.exp(-t / (decay * dm))
    out /= np.max(np.abs(out)) + 1e-9
    # глухой удар рукой (низкий шум)
    th = bandpass_noise(n, f0 * 1.4, f0 * 0.8, seed + 2) * np.exp(-t / 0.05) * thump
    # хлопок
    sl = bandpass_noise(n, slap_f, slap_f * 0.55, seed + 3) * np.exp(-t / 0.018) * slap * (1 - soft)
    bn = lowpass(r.standard_normal(n), 900) * np.exp(-t / (decay * 0.5)) * body_noise
    out = out + th + sl + bn
    out = highpass(out, max(40, f0 * 0.55))
    out[: int(0.0015 * SR)] *= np.linspace(0, 1, int(0.0015 * SR))
    return fade_edges(out, 0.0, 0.12)


def rim_tek(f0, dur, *, decay=0.09, seed=1, level=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    r = rng(seed)
    for ratio, a in [(1, 1.0), (1.9, 0.6), (2.7, 0.4), (3.9, 0.25)]:
        out += a * np.sin(2 * np.pi * f0 * ratio * t + r.uniform(0, 6)) * np.exp(-t / (decay / (0.6 + 0.4 * ratio)))
    out += bandpass_noise(n, 3000, 1400, seed + 1) * np.exp(-t / 0.012) * 0.6
    out = highpass(out, 300)
    out = out / (np.max(np.abs(out)) + 1e-9)
    return fade_edges(out * level, 0.0, 0.05)


def big_impact(f0, dur, *, seed=1):
    """Тяжёлый оркестровый удар (там-там/тайко): низкий корпус + рык + металлический шлейф."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    r = rng(seed)
    body = np.zeros(n)
    for ratio, a, dm in [(1, 1.0, 1.0), (1.5, 0.45, 0.7), (2.01, 0.5, 0.55), (2.76, 0.3, 0.4), (3.9, 0.2, 0.3)]:
        f = f0 * ratio * (1 + 0.35 * np.exp(-t / 0.06))
        body += a * np.sin(2 * np.pi * np.cumsum(f) / SR + r.uniform(0, 6)) * np.exp(-t / (1.1 * dm))
    crash = lowpass(bandpass_noise(n, 1400, 1300, seed + 1), 5500) * np.exp(-t / 0.8) * 0.5
    thump = lowpass(r.standard_normal(n), 400) * np.exp(-t / 0.09) * 0.8
    metal = np.zeros(n)
    for ratio, a in [(1, 1.0), (2.32, 0.7), (3.87, 0.5), (5.41, 0.4), (7.1, 0.3)]:
        metal += a * np.sin(2 * np.pi * 330 * ratio * (1 + 0.003 * smooth_noise(n, 1.2, seed + int(ratio * 10))) * t + r.uniform(0, 6)) * np.exp(-t / (1.9 / (0.5 + 0.5 * ratio)))
    out = body * 1.0 + thump + crash * 0.8 + metal * 0.08
    out = highpass(out, f0 * 0.6)
    out = np.tanh(out * 1.3)
    out[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    return fade_edges(out, 0.0, 0.5)


def sub_boom(dur, *, seed=1, f_start=44.0, f_end=34.0):
    """Саб-бум для сцен червя: спад 44→34 Гц + октава + рык. Время жизни ограничено dur."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = f_end + (f_start - f_end) * np.exp(-t / 1.2)
    out = np.sin(2 * np.pi * np.cumsum(f) / SR) * pw(t, [(0, 0), (0.04, 1), (1.0, 0.8), (dur * 0.7, 0.2), (dur, 0)])
    out += 0.45 * np.sin(2 * np.pi * np.cumsum(f * 2) / SR) * np.exp(-t / 1.4)
    out += 0.25 * lowpass(rng(seed).standard_normal(n), 90) * np.exp(-t / 1.0) * 3
    out = out / (np.max(np.abs(out)) + 1e-9)
    return fade_edges(out, 0.0, 0.8)


def metal_scrape(base, dur, *, seed=1, glide=0.04, shimmer=1.0):
    """Смычком по металлу: неупругие парциалы с дрожащей амплитудой + трение (полосовой шум), swell."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    r = rng(seed)
    out = np.zeros(n)
    env = pw(t, [(0, 0), (dur * 0.42, 1), (dur * 0.6, 0.9), (dur, 0)]) ** 1.3
    for ratio, a in [(1, 1.0), (2.32, 0.8), (3.87, 0.7), (5.41, 0.55), (7.12, 0.45), (9.3, 0.3), (12.6, 0.2)]:
        slide = 1 + glide * (smoothstep(t / dur) - 0.4)
        fm = base * ratio * slide * (1 + 0.004 * smooth_noise(n, 3.0, seed + int(ratio * 7)))
        am = 0.55 + 0.45 * np.clip(smooth_noise(n, 4.0 * shimmer, seed + int(ratio * 13)), -1.5, 1.5) / 1.5
        out += a * am * np.sin(2 * np.pi * np.cumsum(fm) / SR + r.uniform(0, 6))
    fr = bandpass_noise(n, base * 4.5, base * 2.2, seed + 3) * (0.5 + 0.5 * np.clip(smooth_noise(n, 9, seed + 4), -1.5, 1.5) / 1.5)
    out = out / (np.max(np.abs(out)) + 1e-9) + 0.5 * fr * 0.6
    out = highpass(out * env, 250)
    out = out / (np.max(np.abs(out)) + 1e-9)
    return fade_edges(out, 0.03, 0.3)


def gong(base, dur, *, seed=1):
    n = int(dur * SR)
    t = np.arange(n) / SR
    r = rng(seed)
    out = np.zeros(n)
    for ratio, a, dm in [(1, 1.0, 1.0), (1.51, 0.6, 0.8), (2.27, 0.7, 0.7), (2.89, 0.5, 0.6), (3.77, 0.45, 0.5), (4.92, 0.3, 0.4), (6.31, 0.25, 0.3)]:
        f = base * ratio * (1 + 0.0025 * smooth_noise(n, 0.9, seed + int(ratio * 11)))
        out += a * np.sin(2 * np.pi * np.cumsum(f) / SR + r.uniform(0, 6)) * (0.7 + 0.3 * np.sin(2 * np.pi * r.uniform(0.6, 3) * t)) * np.exp(-t / (dur * 0.33 * dm))
    out *= np.clip(t / 0.006, 0, 1)
    out = highpass(out, 120)
    out = out / (np.max(np.abs(out)) + 1e-9)
    return fade_edges(out, 0.0, 0.6)


def riser(dur, *, seed=1):
    """Нагнетание 14–16 с: узкая полоса шума вверх + тревожный кластер хора/меди (D–Eb) + металлический шелест. Без саба."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = pw(t, [(0, 0), (dur * 0.35, 0.22), (dur * 0.9, 1.0), (dur, 0.0)]) ** 1.6
    # шум с ростом центра
    nz = np.zeros(n)
    blocks = 24
    seg = n // blocks
    for i in range(blocks):
        fc = 300 * (3600 / 300) ** (i / blocks)
        b = bandpass_noise(seg + 4096, fc, fc * 0.45, seed + i)[:seg + 4096]
        w = np.hanning(2 * seg)[: seg + 4096] if False else None
        s0 = i * seg
        win = np.sin(np.linspace(0, np.pi, seg + 4096)) ** 2
        e = min(n, s0 + seg + 4096)
        nz[s0:e] += b[: e - s0] * win[: e - s0]
    nz = nz / (np.sqrt(np.mean(nz ** 2)) + 1e-9)
    # кластер: D3, Eb3, A3, Bb3 (хор «ah» + расстройка) — растущая напряжённость
    cl = choir_pad([mtof(50), mtof(51), mtof(57), mtof(58)], dur, ['oh', 'ah'], voices=3, seed=seed + 3, fade=(dur * 0.55, 1.5), bright=1.3)
    br = brass_swell([mtof(38), mtof(45), mtof(51)], dur, attack=dur * 0.7, peak_at=0.85, drive=2.4, bright=1.1, seed=seed + 5, scoop=0.0)
    sh = metal_scrape(1250, dur, seed=seed + 8, shimmer=1.6)
    out = nz * 0.30 + cl * 0.55 + br * 0.55 + sh * 0.22
    out = out * env
    out = highpass(out, 70)
    return fade_edges(out / (np.max(np.abs(out)) + 1e-9) * 0.9, 0.1, 0.4)


# ======================================================================================================================
# Сборка стемов
# ======================================================================================================================
D = {"D2": 38, "Eb2": 39, "G2": 43, "A2": 45, "Bb2": 46, "C3": 48, "D3": 50, "Eb3": 51, "F3": 53, "Fs3": 54, "G3": 55, "A3": 57, "Bb3": 58, "C4": 60}


def build_voc():
    P = {}
    # (midi, dur, vowel, kind)
    P["v_call"] = sing([(69, 3.0, 'ah', 'scoop'), (67, 0.55, 'ah', 'n'), (66, 0.5, 'oh', 'n'), (67, 0.6, 'ah', 'turn'), (63, 1.3, 'ah', 'n'), (62, 4.2, 'oh', 'fall')], seed=11, breath=0.06)
    P["v_high"] = sing([(74, 2.4, 'ah', 'scoop'), (72, 0.75, 'ah', 'tr'), (70, 0.7, 'oh', 'n'), (69, 1.0, 'ah', 'n'), (67, 0.55, 'ah', 'n'), (66, 0.55, 'oh', 'n'), (67, 0.5, 'ah', 'n'),
                       (69, 2.0, 'ah', 'tr'), (67, 3.6, 'oo', 'fall')], seed=12, breath=0.05, vib_depth=0.4)
    P["v_long"] = sing([(69, 1.4, 'oh', 'n'), (74, 5.2, 'ah', 'scoop'), (72, 1.0, 'oh', 'n'), (70, 1.1, 'ah', 'n'), (69, 3.2, 'oo', 'fall')], seed=13, breath=0.05, vib_depth=0.45)
    P["v_low"] = sing([(62, 3.2, 'oh', 'scoop'), (60, 1.1, 'oh', 'n'), (58, 0.8, 'oo', 'n'), (60, 0.7, 'oh', 'n'), (57, 4.0, 'oo', 'fall')], seed=14, breath=0.07, tilt=1.1)
    P["v_orn"] = sing([(69, 0.45, 'ah', 'n'), (70, 0.32, 'ah', 'n'), (69, 0.3, 'oh', 'n'), (67, 0.32, 'ah', 'n'), (66, 0.6, 'ah', 'gam'), (67, 0.45, 'ah', 'n'), (69, 0.6, 'oh', 'n'),
                      (70, 0.5, 'ah', 'n'), (72, 1.6, 'ah', 'scoop'), (70, 0.5, 'oh', 'n'), (69, 0.6, 'ah', 'n'), (67, 0.6, 'ah', 'n'), (66, 0.6, 'oh', 'turn'), (63, 2.8, 'oo', 'fall')], seed=15, breath=0.05)
    P["v_sigh"] = sing([(66, 2.6, 'oo', 'scoop'), (69, 3.6, 'ah', 'fall')], seed=16, breath=0.09, vib_depth=0.3, tilt=1.15)
    P["v_air"] = sing([(74, 2.0, 'ah', 'n'), (78, 1.2, 'ah', 'scoop'), (79, 0.9, 'ah', 'n'), (78, 0.9, 'oh', 'turn'), (75, 1.0, 'ah', 'n'), (74, 3.4, 'oo', 'fall')], seed=17, breath=0.06, vib_depth=0.3, tilt=1.15)
    P["v_wail"] = sing([(74, 1.0, 'ah', 'n'), (79, 6.4, 'ah', 'scoop'), (78, 0.9, 'ah', 'tr'), (75, 0.9, 'oh', 'n'), (74, 3.6, 'oh', 'fall')], seed=18, breath=0.04, vib_depth=0.55, pressed=0.8, tilt=0.95)
    P["v_answer"] = sing([(66, 1.6, 'oh', 'scoop'), (67, 1.0, 'ah', 'n'), (69, 0.6, 'ah', 'turn'), (67, 0.6, 'ah', 'n'), (66, 0.5, 'oh', 'n'), (63, 0.9, 'ah', 'n'), (62, 3.8, 'oo', 'fall')], seed=19, breath=0.07)
    out = {}
    for k, v in P.items():
        v = add_reverb(v, wet=0.10, rt60=0.9, dark=0.7, seed=3, tail=False)
        out[k] = v
    return out


def build_choir():
    C = {}
    C["c_open"] = choir_pad([mtof(38), mtof(45), mtof(50), mtof(57)], 15, ['oh', 'ah', 'oh'], seed=21, voices=4)
    C["c_min"] = choir_pad([mtof(38), mtof(45), mtof(50), mtof(53)], 15, ['oo', 'oh', 'ah'], seed=22, voices=4)
    C["c_phryg"] = choir_pad([mtof(39), mtof(46), mtof(51), mtof(55)], 15, ['oh', 'ah', 'oo'], seed=23, voices=4)
    C["c_low"] = choir_pad([mtof(38), mtof(45)], 14, ['oo', 'oh'], seed=24, voices=5, level=1.0)
    C["t_a"] = throat_song(mtof(38), [10, 12, 10, 9, 12, 14, 12, 10, 8, 10], [1.6] * 10, 16, seed=25, growl=0.35)
    C["t_b"] = throat_song(mtof(38), [8, 9, 10, 12, 9, 10, 8], [2.0] * 7, 16, seed=26, growl=0.25)
    return C


def build_brass():
    B = {}
    B["b_open"] = brass_swell([mtof(38), mtof(45), mtof(50)], 10, seed=31)
    B["b_min7"] = brass_swell([mtof(38), mtof(45), mtof(48), mtof(53)], 10, seed=32, drive=3.4)
    B["b_phryg"] = brass_swell([mtof(39), mtof(46), mtof(55), mtof(51)], 10, seed=33, drive=3.2)
    B["b_major"] = brass_swell([mtof(38), mtof(45), mtof(54), mtof(50), mtof(62)], 11, seed=34, drive=3.6, bright=1.15)
    B["b_stab"] = brass_swell([mtof(38), mtof(45), mtof(50), mtof(53)], 5.5, seed=35, drive=4.2, stab=True, bright=1.2)
    B["d_1"] = duduk([(57, 2.8, 'x', 'scoop'), (58, 0.7, 'x', 'n'), (57, 0.7, 'x', 'n'), (55, 0.9, 'x', 'n'), (54, 0.7, 'x', 'n'), (55, 0.6, 'x', 'n'), (57, 3.4, 'x', 'fall')], seed=36)
    B["d_2"] = duduk([(62, 3.0, 'x', 'scoop'), (60, 1.0, 'x', 'n'), (58, 0.8, 'x', 'n'), (57, 1.0, 'x', 'turn'), (55, 1.0, 'x', 'n'), (54, 0.8, 'x', 'n'), (50, 4.2, 'x', 'fall')], seed=37)
    B["d_3"] = duduk([(69, 2.2, 'x', 'scoop'), (67, 0.8, 'x', 'n'), (66, 1.5, 'x', 'gam'), (62, 4.4, 'x', 'fall')], seed=38, level=0.9)
    B["p_drone"] = pipe_drone([mtof(50), mtof(57)], 14, seed=39)
    return B


def build_perc():
    P = {}
    for i, f in enumerate([78, 88, 98]):
        P[f"doum_big{i}"] = add_reverb(membrane_hit(f, 2.0, decay=0.9, drop=0.3, slap=0.22, thump=0.7, seed=40 + i, slap_f=1500), wet=0.12, rt60=1.0, tail=False)
    for i, f in enumerate([112, 128]):
        P[f"doum_mid{i}"] = membrane_hit(f, 1.2, decay=0.55, drop=0.25, slap=0.3, thump=0.5, seed=50 + i, slap_f=1900)
    for i, f in enumerate([160, 175, 190]):
        P[f"dum_hand{i}"] = membrane_hit(f, 0.7, decay=0.30, drop=0.22, slap=0.18, thump=0.4, seed=60 + i, slap_f=1800, soft=0.5)
    for i, f in enumerate([950, 1100, 1250]):
        P[f"tek{i}"] = rim_tek(f, 0.25, seed=70 + i)
    P["ka0"] = rim_tek(700, 0.18, decay=0.05, seed=75, level=0.6)
    P["ka1"] = rim_tek(820, 0.18, decay=0.05, seed=76, level=0.6)
    P["imp0"] = big_impact(58, 4.2, seed=80)
    P["imp1"] = big_impact(66, 4.2, seed=81)
    P["boom0"] = sub_boom(5.0, seed=82)
    P["boom1"] = sub_boom(4.2, seed=83, f_start=48, f_end=37)
    P["scr0"] = metal_scrape(1180, 7.0, seed=84)
    P["scr1"] = metal_scrape(560, 7.0, seed=85, glide=-0.05)
    P["scr2"] = metal_scrape(340, 6.5, seed=86, shimmer=0.7)
    P["gong"] = gong(196, 7.5, seed=87)
    P["riser"] = riser(15.0, seed=88)
    return P


def build_peak():
    """Пик «пожирания»: удар + бум + медь + гонг + вопль + хор, 13 с. Лежит в паке perc."""
    dur = 13.0
    n = int(dur * SR)
    out = np.zeros(n)

    def put(x, at, g):
        i = int(at * SR)
        m = min(len(x), n - i)
        out[i:i + m] += x[:m] * g

    put(big_impact(56, 4.2, seed=90), 0.0, 1.0)
    put(sub_boom(4.6, seed=91), 0.0, 0.8)
    put(brass_swell([mtof(38), mtof(45), mtof(54), mtof(50)], 9.5, attack=0.5, peak_at=0.18, drive=4.4, bright=1.3, seed=92, scoop=0.0), 0.05, 0.75)
    put(gong(150, 8.0, seed=93), 0.02, 0.5)
    put(sing([(79, 7.5, 'ah', 'scoop'), (78, 1.0, 'ah', 'tr'), (75, 0.9, 'oh', 'n'), (74, 2.5, 'oh', 'fall')], seed=94, breath=0.04, vib_depth=0.55, pressed=1.0, tilt=0.9), 0.6, 0.55)
    put(choir_pad([mtof(38), mtof(45), mtof(50), mtof(57), mtof(62)], 12, ['ah', 'oh'], voices=4, seed=95, fade=(0.6, 5.5), bright=1.4), 0.1, 0.65)
    put(metal_scrape(900, 6.0, seed=96), 1.2, 0.35)
    put(big_impact(62, 4.0, seed=97), 3.4, 0.55)
    out = np.tanh(out / (np.max(np.abs(out)) + 1e-9) * 1.4)
    return {"peak": fade_edges(out, 0.0, 0.8)}


# ======================================================================================================================
# Нормировка, упаковка, кодирование
# ======================================================================================================================
def normalise(name, x, pack):
    x = np.nan_to_num(x)
    if pack == "perc":
        peak = np.max(np.abs(x)) + 1e-9
        target = 0.5 if name.startswith(("imp", "boom", "peak")) else 0.4
        x = x / peak * target
    else:
        r = active_rms_db(x)
        x = x * 10 ** ((TARGET_RMS[pack] - r) / 20)
        pk = np.max(np.abs(x))
        if pk > 0.7:
            x = x / pk * 0.7
    return x


def encode_pack(items, pack, bitrate):
    parts = []
    index = {}
    pos = 0.0
    gap = np.zeros(int(GAP * SR))
    for name, x in items.items():
        x = normalise(name, x, pack)
        index[name] = [round(pos, 3), round(len(x) / SR, 3)]
        parts += [x, gap]
        pos += len(x) / SR + GAP
    pcm = np.concatenate(parts).astype(np.float32)
    assert np.isfinite(pcm).all()
    return pcm, index


def write_wav(path, x, sr=SR):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


def opus(pcm, bitrate_k):
    with tempfile.TemporaryDirectory() as td:
        wav = os.path.join(td, "in.wav")
        ogg = os.path.join(td, "out.ogg")
        write_wav(wav, pcm)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libopus", "-b:a", f"{bitrate_k}k", "-vbr", "constrained",
                        "-application", "audio", "-ac", "1", ogg], check=True)
        return open(ogg, "rb").read()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep-wav", default=None)
    ap.add_argument("--only", default=None)
    ap.add_argument("--bitrate", type=int, default=0, help="переопределить битрейт всех паков, кбит/с")
    a = ap.parse_args()
    os.makedirs(CACHE, exist_ok=True)
    plan = {"voc": (build_voc, 24), "choir": (build_choir, 24), "brass": (build_brass, 24), "perc": (lambda: {**build_perc(), **build_peak()}, 26)}
    only = set(a.only.split(",")) if a.only else set(plan)
    packs = {}
    total = 0
    for pack, (fn, br) in plan.items():
        cj = os.path.join(CACHE, pack + ".json")
        if pack not in only and os.path.exists(cj):
            packs[pack] = json.load(open(cj))
            total += len(base64.b64decode(packs[pack]["uri"].split(",", 1)[1]))
            continue
        print(f"[{pack}] синтез…", flush=True)
        items = fn()
        pcm, index = encode_pack(items, pack, br)
        if a.keep_wav:
            os.makedirs(a.keep_wav, exist_ok=True)
            write_wav(os.path.join(a.keep_wav, pack + ".wav"), pcm)
        data = opus(pcm, a.bitrate or br)
        total += len(data)
        uri = "data:audio/ogg;codecs=opus;base64," + base64.b64encode(data).decode()
        packs[pack] = {"uri": uri, "items": index, "dur": round(len(pcm) / SR, 2)}
        json.dump(packs[pack], open(cj, "w"))
        print(f"[{pack}] {len(items)} стемов, {len(pcm) / SR:.1f} с, {len(data) / 1024:.0f} КБ")
    with open(OUT_JS, "w") as f:
        f.write("// Сгенерировано Tools/tts/music_build.py (numpy-синтез → Opus моно) — не править вручную.\n")
        f.write("// MUSIC.<pack> = {uri, items:{имя:[начало_с, длительность_с]}, dur}. Паки: voc, choir, brass, perc.\n")
        f.write("export const MUSIC = " + json.dumps(packs, ensure_ascii=False) + ";\n")
    print(f"итого Opus: {total / 1024:.0f} КБ, base64 ≈ {total * 4 / 3 / 1024:.0f} КБ → {OUT_JS}")


if __name__ == "__main__":
    main()
