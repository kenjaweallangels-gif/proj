#!/usr/bin/env python3
"""Офлайн-рендер банка звуков Rakis (numpy/scipy -> ffmpeg -> Opus -> Web/src/assets/sfx_bank.js).

Всё синтезируется: гранулярный песок, удары, металл, вода, птицы, текстуры (петли строятся спектральным синтезом — циркулярны).
Запуск:  python3 Tools/sfx/sfx_build.py [--out Web/src/assets/sfx_bank.js] [--wav-dir DIR]
Бюджет: файл банка <= 0.5 МБ (скрипт печатает итог и завершается с ошибкой, если превышен).
Нижний край: все сэмплы фильтруются HP (обычно 45-90 Гц) — постоянного НЧ-гула в банке нет.
Имена вида 'base_N' образуют группу 'base' (round-robin / случайный выбор в рантайме).
"""
import argparse, base64, json, subprocess, sys, os
import numpy as np
from scipy.signal import butter, sosfilt

SR = 48000
BUDGET = 500_000


def R(seed):
    return np.random.default_rng(seed)


def _sos(kind, f, order):
    return butter(order, f, kind, fs=SR, output='sos')


def bp(x, lo, hi, order=2):
    hi = min(hi, SR * 0.45)
    return sosfilt(_sos('bandpass', [lo, hi], order), x)


def lp(x, f, order=2):
    return sosfilt(_sos('lowpass', min(f, SR * 0.45), order), x)


def hp(x, f, order=2):
    return sosfilt(_sos('highpass', f, order), x)


def T(n):
    return np.arange(n) / SR


def N(sec):
    return int(sec * SR)


def norm(x, peak=0.85):
    return x / (np.max(np.abs(x)) + 1e-9) * peak


def fade(x, a=0.002, b=0.01):
    n = len(x); y = x.copy()
    na, nb = max(1, int(a * SR)), max(1, int(b * SR))
    y[:na] *= np.linspace(0, 1, na); y[-nb:] *= np.linspace(1, 0, nb)
    return y


def expdec(n, tau):
    return np.exp(-T(n) / tau)


def unit(x):
    return x / (np.std(x) + 1e-9)


def specnoise(n, shape, r):
    """Циркулярный шум с заданной огибающей спектра shape(f_hz)."""
    m = n // 2 + 1
    f = np.fft.rfftfreq(n, 1 / SR)
    X = (r.normal(size=m) + 1j * r.normal(size=m)) * shape(np.maximum(f, 1e-3))
    X[0] = 0
    return np.fft.irfft(X, n)


def bandshape(lo, hi, slope_lo=3.0, slope_hi=3.0):
    def s(f):
        return 1 / (1 + (lo / f) ** slope_lo) / (1 + (f / hi) ** slope_hi)
    return s


def grains(n, rate, r, fc=(500, 4500), nb=10, width=1.35, amp_pow=1.0):
    """Пуассоновские импульсы через узкие резонансы: хруст песчинок. rate — вероятность на отсчёт (массив или число)."""
    mask = r.random(n) < rate
    amps = (r.exponential(1, n) ** amp_pow) * mask * r.choice([-1.0, 1.0], n)
    edges = np.geomspace(fc[0], fc[1], nb + 1)
    band = r.integers(0, nb, n)
    out = np.zeros(n)
    for b in range(nb):
        c = np.sqrt(edges[b] * edges[b + 1])
        imp = amps * (band == b)
        if imp.any():
            out += bp(imp, c / width, c * width, 2)
    return out


def ringing(n, freqs, decays, amps, r=None):
    t = T(n); y = np.zeros(n)
    for f, d, a in zip(freqs, decays, amps):
        ph = 0 if r is None else r.uniform(0, 6.28)
        y += a * np.sin(2 * np.pi * f * t + ph) * np.exp(-t / d)
    return y


def place(dst, src, at):
    i = int(at * SR)
    if i >= len(dst):
        return
    k = min(len(src), len(dst) - i)
    dst[i:i + k] += src[:k]


# ------------------------------------------------------------------ шаги / песок
def sand_step(seed, run=False):
    r = R(seed); n = N(0.30); t = T(n)
    tau = r.uniform(0.05, 0.085) * (0.8 if run else 1.0)
    rate = (0.22 if run else 0.16) * (1 - np.exp(-t / 0.004)) * np.exp(-t / tau)
    g = grains(n, rate, r, fc=(r.uniform(500, 800), r.uniform(3200, 5200)), nb=10)
    body = bp(r.normal(size=n), 300, r.uniform(1100, 1700)) * np.exp(-t / 0.045) * (1 - np.exp(-t / 0.006)) * 0.5
    f0 = r.uniform(105, 150)
    thump = np.sin(2 * np.pi * (f0 * (0.7 + 0.3 * np.exp(-t / 0.03))) * t) * np.exp(-t / 0.022) * 0.30
    x = hp(unit(g) * 0.5 + body / (np.max(np.abs(body)) + 1e-9) * 0.5 + thump, 70)
    return fade(norm(x, 0.8))


def sandwalk_drag(seed):
    r = R(seed); n = N(0.6); t = T(n)
    c = r.uniform(0.14, 0.2)
    env = np.exp(-0.5 * ((t - c) / r.uniform(0.09, 0.13)) ** 2)
    g = grains(n, 0.09 * env + 0.004 * env, r, fc=(350, 2600), nb=9)
    body = bp(r.normal(size=n), 220, 950) * env
    x = hp(unit(g) * 0.6 * env + unit(body) * 0.3 * env, 80)
    return fade(norm(x, 0.65), 0.03, 0.08)


def packed_step(seed):
    r = R(seed); n = N(0.32); t = T(n)
    f0 = r.uniform(92, 125)
    th = np.sin(2 * np.pi * (f0 * (0.6 + 0.4 * np.exp(-t / 0.04)) * t)) * np.exp(-t / 0.06)
    kn = bp(r.normal(size=n), 220, 900) * np.exp(-t / 0.03) * 0.6
    g = grains(n, 0.07 * np.exp(-t / 0.05), r, fc=(700, 4000))
    return fade(norm(hp(th * 0.8 + kn + unit(g) * 0.08, 55), 0.82))


def rock_step(seed):
    r = R(seed); n = N(0.28); y = np.zeros(n)
    place(y, bp(r.normal(size=N(0.01)), 2500, 7000), 0)
    for _ in range(r.integers(3, 7)):
        f = r.uniform(1200, 4200); d = r.uniform(0.004, 0.012)
        place(y, ringing(N(0.05), [f, f * 1.9], [d, d * 0.6], [1, 0.4], r=r) * r.uniform(0.3, 1), r.uniform(0.0, 0.09))
    place(y, bp(r.normal(size=N(0.1)), 1500, 6000) * expdec(N(0.1), 0.02) * 0.25, 0.005)
    place(y, np.sin(2 * np.pi * r.uniform(150, 260) * T(N(0.05))) * expdec(N(0.05), 0.012) * 0.3, 0)
    return fade(norm(hp(y, 120), 0.8))


def stone_step(seed):
    r = R(seed); n = N(0.36); y = np.zeros(n)
    base = r.uniform(180, 320)
    for at, a in ((0.0, 1.0), (r.uniform(0.06, 0.09), 0.45)):
        m = N(0.2)
        s = ringing(m, [base, base * 2.3, base * 3.9, 2300], [0.03, 0.02, 0.012, 0.004], [1, 0.5, 0.3, 0.2], r=r)
        s += bp(r.normal(size=m), 1500, 5000) * expdec(m, 0.004) * 0.6
        place(y, s * a, at)
    return fade(norm(hp(y, 90), 0.8))


def metal_step(seed):
    r = R(seed); n = N(0.45)
    f = r.uniform(520, 800)
    y = ringing(n, [f, f * 2.76, f * 5.4, f * 8.9], [0.09, 0.06, 0.04, 0.02], [1, 0.6, 0.4, 0.2], r=r)
    y += bp(r.normal(size=n), 2000, 9000) * expdec(n, 0.006) * 0.8
    y += np.sin(2 * np.pi * 140 * T(n)) * expdec(n, 0.015) * 0.3
    return fade(norm(hp(y, 100), 0.8))


def cloth(seed, dur=0.5, loud=1.0):
    r = R(seed); n = N(dur); t = T(n)
    env = np.zeros(n)
    for _ in range(r.integers(3, 6)):
        c = r.uniform(0.02, dur * 0.7); w = r.uniform(0.03, 0.09)
        env += r.uniform(0.3, 1) * np.exp(-0.5 * ((t - c) / w) ** 2)
    x = bp(r.normal(size=n), r.uniform(600, 1100), r.uniform(3000, 5500)) * env
    return fade(norm(hp(x, 250), 0.6 * loud), 0.01, 0.05)


def land_sand(seed):
    r = R(seed); n = N(0.55); t = T(n)
    th = np.sin(2 * np.pi * (r.uniform(75, 100) * (0.6 + 0.4 * np.exp(-t / 0.05)) * t)) * np.exp(-t / 0.07)
    g = grains(n, 0.3 * (1 - np.exp(-t / 0.004)) * np.exp(-t / 0.13), r, fc=(450, 4200), nb=12)
    b = bp(r.normal(size=n), 250, 1300) * np.exp(-t / 0.08)
    return fade(norm(hp(th * 0.8 + unit(g) * 0.25 + unit(b) * 0.2 * np.exp(-t / 0.08), 55), 0.85), 0.002, 0.05)


def land_hard(seed):
    r = R(seed); n = N(0.4); t = T(n)
    th = np.sin(2 * np.pi * (r.uniform(110, 150) * (0.7 + 0.3 * np.exp(-t / 0.03)) * t)) * np.exp(-t / 0.05)
    c = bp(r.normal(size=n), 800, 5000) * np.exp(-t / 0.012)
    return fade(norm(hp(th * 0.7 + c * 0.7, 70), 0.85), 0.001, 0.04)


# ------------------------------------------------------------------ пустыня / червь
def sand_tick(seed):
    r = R(seed); n = N(0.05)
    return fade(norm(bp(r.normal(size=n), r.uniform(2500, 5500), 9000) * expdec(n, 0.006), 0.6), 0.0005, 0.01)


def sand_pour(seed, sec=4.0):
    """Сыпучий песок/дрейф: гранулярный шипящий текстурный слой (петля)."""
    r = R(seed); n = N(sec)
    slow = np.clip(1 + 3.0 * lp(r.normal(size=n), 3, 1), 0.3, 1.5)
    g = grains(n, 0.035 * slow, r, fc=(1200, 7500), nb=12, width=1.5, amp_pow=0.8)
    h = specnoise(n, bandshape(1500, 6500, 2, 2), r) * slow
    x = hp(unit(g) + unit(h) * 0.6, 700)
    return norm(x, 0.7)


def worm_crackle(seed):
    r = R(seed); n = N(0.22); t = T(n)
    g = grains(n, 0.05 * np.exp(-t / 0.07) + 0.002, r, fc=(600, 5500), nb=10, amp_pow=1.2)
    return fade(norm(hp(g, 150), 0.75), 0.001, 0.05)


def worm_rock(seed):
    r = R(seed); n = N(0.3); y = np.zeros(n)
    for _ in range(r.integers(2, 5)):
        f = r.uniform(500, 2200); d = r.uniform(0.01, 0.03)
        place(y, ringing(N(0.12), [f, f * 1.7], [d, d * 0.7], [1, 0.5], r=r) * r.uniform(0.4, 1), r.uniform(0, 0.15))
    place(y, bp(r.normal(size=N(0.03)), 800, 4000) * expdec(N(0.03), 0.01), 0)
    return fade(norm(hp(y, 150), 0.75))


def worm_thud(seed):
    r = R(seed); n = N(0.6); t = T(n)
    f = r.uniform(58, 72)
    y = np.sin(2 * np.pi * f * (0.75 + 0.25 * np.exp(-t / 0.08)) * t) * np.exp(-t / 0.11)
    y += bp(r.normal(size=n), 90, 500) * np.exp(-t / 0.05) * 0.5
    return fade(norm(hp(y, 42, 2), 0.85), 0.003, 0.15)


def distant_thump(seed):
    r = R(seed); n = N(1.4); t = T(n)
    y = np.sin(2 * np.pi * 62 * (0.8 + 0.2 * np.exp(-t / 0.1)) * t) * np.exp(-t / 0.16)
    y += lp(r.normal(size=n), 260) * np.exp(-t / 0.25) * 0.8
    y = hp(lp(y, 300, 3), 40)
    return fade(norm(y, 0.8), 0.01, 0.4)


def thumper_hit(seed):
    r = R(seed); n = N(0.7); t = T(n)
    f = r.uniform(70, 90)
    y = np.sin(2 * np.pi * f * (0.7 + 0.3 * np.exp(-t / 0.05)) * t) * np.exp(-t / 0.10)
    y += bp(r.normal(size=n), 200, 1200) * np.exp(-t / 0.03) * 0.7
    y += bp(r.normal(size=n), 1800, 5000) * np.exp(-t / 0.006) * 0.4
    y += ringing(n, [310, 640], [0.05, 0.03], [0.3, 0.15], r=r)
    return fade(norm(hp(y, 45), 0.85), 0.001, 0.15)


def worm_rasp(seed, sec=5.0):
    """Петля: шершавый песчаный рёв тела (100-1500 Гц) + шипение + гранулярный треск. Циркулярна."""
    r = R(seed); n = N(sec); t = T(n)
    body = specnoise(n, lambda f: bandshape(110, 1300, 3, 2.2)(f) * (1 + 1.8 * np.exp(-0.5 * (np.log(f / 260) / 0.35) ** 2) + 1.2 * np.exp(-0.5 * (np.log(f / 700) / 0.3) ** 2)), r)
    lfo = np.zeros(n)
    for _ in range(6):
        f = round(r.uniform(12, 30) * sec) / sec
        lfo += np.sin(2 * np.pi * f * t + r.uniform(0, 6.28)) / 6
    body = body * np.clip(0.75 + 0.9 * lfo, 0.15, 1.6)
    hiss = specnoise(n, bandshape(2500, 8000, 2, 2), r)
    crack = grains(n, 0.012 + 0.01 * (lfo > 0), r, fc=(500, 5000), nb=10, amp_pow=1.3)
    x = unit(body) * 0.55 + unit(hiss) * 0.2 + unit(crack) * 0.35
    return norm(hp(x, 70), 0.7)


def worm_roar(seed, sec=7.0):
    """Рёв выхода: атака 0.35 с, песчаный хрип с формантами, шипение вверх, короткий НЧ-удар только в начале."""
    r = R(seed); n = N(sec); t = T(n)
    env = (1 - np.exp(-t / 0.35)) * np.exp(-np.maximum(t - 2.2, 0) / 1.5)
    f0 = 85 * (1.25 - 0.45 * np.minimum(t / 5, 1))
    jitter = 1 + 0.03 * lp(r.normal(size=n), 14, 1) / 0.07
    phase = 2 * np.pi * np.cumsum(f0 * jitter) / SR
    src = np.zeros(n)
    for h in range(1, 28):
        src += np.sin(h * phase + r.uniform(0, 6)) / h ** 0.8
    voice = bp(src, 150, 900, 2) + bp(src, 900, 2600, 2) * 0.35
    rasp = specnoise(n, bandshape(180, 1800, 2.5, 2.2), r)
    lfo = 0.7 + 0.3 * np.sin(2 * np.pi * 23 * t + 0.4 * np.sin(2 * np.pi * 3.1 * t))
    sandhiss = specnoise(n, bandshape(2200, 8000, 2, 2), r) * np.minimum(t / 1.2, 1)
    crack = grains(n, 0.02 * env, r, fc=(500, 5500), nb=10, amp_pow=1.3)
    th = np.sin(2 * np.pi * 52 * (0.8 + 0.4 * np.exp(-t / 0.3)) * t) * np.exp(-t / 0.28)
    x = (unit(voice) * 0.5 + unit(rasp) * lfo * 0.7 + unit(sandhiss) * 0.25 + unit(crack) * 0.35) * env
    x = x + th * 1.0 * np.exp(-t / 0.4)
    return fade(norm(hp(x, 46), 0.85), 0.005, 0.6)


def worm_grind(seed, sec=4.0):
    """Скрежет пасти: стик-слип в полосе 150-900 Гц + крошка. Циркулярен."""
    r = R(seed); n = N(sec); t = T(n)
    base = specnoise(n, bandshape(150, 1200, 3, 2.5), r)
    stick = np.zeros(n)
    for _ in range(6):
        f = round(r.uniform(14, 40) * sec) / sec
        stick += np.sin(2 * np.pi * f * t + r.uniform(0, 6.28)) / 6
    am = np.clip(0.6 + 1.1 * stick, 0.1, 1.5)
    g = grains(n, 0.02 * am, r, fc=(700, 4500), nb=10)
    x = unit(base) * am * 0.8 + unit(g) * 0.4
    return norm(hp(x, 80), 0.7)


# ------------------------------------------------------------------ харвестер / переносчик
def engine_loop(seed, sec=3.0, fire=16.0):
    """Петля дизеля: импульсы сгорания (fire Гц, целое число периодов), неровность, механический шум. HP 55 Гц."""
    r = R(seed); n = N(sec); t = T(n)
    cycles = int(round(sec * fire)); per = n / cycles
    y = np.zeros(n)
    m = N(0.09); tt = T(m)
    for k in range(cycles):
        a = r.uniform(0.75, 1.0) * (1.0 if k % 2 == 0 else 0.85)
        at = int(k * per + r.normal(0, 0.003) * SR) % n
        pulse = (np.sin(2 * np.pi * 85 * tt) * np.exp(-tt / 0.018) + 0.6 * np.sin(2 * np.pi * 150 * tt + 1) * np.exp(-tt / 0.012)
                 + 0.4 * bp(r.normal(size=m), 400, 1800) * np.exp(-tt / 0.01)) * a
        y[(np.arange(m) + at) % n] += pulse
    mech = unit(specnoise(n, bandshape(300, 3500, 2, 2.5), r)) * (0.5 + 0.5 * np.maximum(0, np.cos(2 * np.pi * fire * t))) * 0.15
    rattle = unit(bp(specnoise(n, bandshape(900, 3000, 2, 2), r), 900, 3000)) * (0.5 + 0.5 * np.cos(2 * np.pi * fire * 2.5 * t)) * 0.07
    x = unit(y) * 0.5 + mech + rattle
    return norm(hp(x, 55, 2), 0.7)


def klaxon(seed, sec=1.5, hz=(415.0, 330.0)):
    n = N(sec); t = T(n); y = np.zeros(n)
    for f in hz:
        pitch = f * (1 - 0.04 * np.exp(-t / 0.05))
        ph = 2 * np.pi * np.cumsum(pitch) / SR
        for h in range(1, 14):
            y += np.sin(h * ph) / h ** 1.1 * (1 if h % 2 else 0.5)
    y = y * (0.5 + 0.5 * (np.sin(2 * np.pi * 112 * t) > 0))
    y = bp(y, 300, 3800, 2)
    y = y * np.minimum(t / 0.03, 1) * np.minimum((sec - t) / 0.08, 1)
    return norm(y, 0.7)


def track_clank(seed):
    r = R(seed); n = N(0.24)
    f = r.uniform(600, 1400)
    y = ringing(n, [f, f * 2.4, f * 4.1, f * 6.7], [0.04, 0.03, 0.02, 0.012], [1, 0.7, 0.5, 0.3], r=r)
    y += bp(r.normal(size=n), 1200, 7000) * expdec(n, 0.005)
    y += np.sin(2 * np.pi * r.uniform(130, 190) * T(n)) * expdec(n, 0.02) * 0.7
    return fade(norm(hp(y, 90), 0.8), 0.0005, 0.04)


def hyd_hiss(seed):
    r = R(seed); n = N(1.0); t = T(n)
    env = np.minimum(t / 0.05, 1) * np.exp(-np.maximum(t - 0.12, 0) / 0.28)
    x = bp(r.normal(size=n), 1800, 9000) * env
    return fade(norm(hp(x, 800), 0.6), 0.005, 0.1)


def carryall_loop(seed, sec=4.0, blade=9.0):
    r = R(seed); n = N(sec); t = T(n)
    whoosh = specnoise(n, bandshape(180, 1500, 2.5, 2), r)
    pulse = np.maximum(0, np.cos(2 * np.pi * blade * t)) ** 2.0
    jets = specnoise(n, bandshape(1500, 6500, 2, 2.2), r)
    turb = np.sin(2 * np.pi * 1180 * t + 3 * np.sin(2 * np.pi * 2 * t)) * 0.12
    x = unit(whoosh) * (0.35 + 0.65 * pulse) * 0.7 + unit(jets) * 0.45 * (0.8 + 0.2 * pulse) + turb
    return norm(hp(x, 60), 0.7)


# ------------------------------------------------------------------ сиетч
def room_stone(seed, sec=5.0):
    r = R(seed); n = N(sec)
    x = specnoise(n, lambda f: bandshape(130, 2200, 3, 2)(f) * (1 + 0.8 * np.exp(-0.5 * (np.log(f / 420) / 0.5) ** 2)), r)
    return norm(hp(x, 90), 0.6)


VOWELS = [(730, 1090), (530, 1840), (270, 2290), (570, 840), (300, 870), (660, 1720), (400, 1000)]


def babble(seed, sec=6.0, voices=6, lo_f0=105, hi_f0=250):
    """Бормотание толпы: слоговые «голоса» без слов (источник с вибрато x форманты x слоговая огибающая)."""
    r = R(seed); n = N(sec); out = np.zeros(n)
    for _ in range(voices):
        f0 = r.uniform(lo_f0, hi_f0); shift = r.uniform(0.85, 1.25)
        pos = r.uniform(0, 0.6)
        voice = np.zeros(n)
        while pos < sec:
            if r.random() < 0.25:
                pos += r.uniform(0.2, 0.7); continue
            L = r.uniform(0.09, 0.22); m = N(L)
            tt = T(m)
            fm = f0 * r.uniform(0.9, 1.15) * (1 + 0.04 * np.sin(2 * np.pi * 5.5 * tt))
            ph = 2 * np.pi * np.cumsum(fm) / SR
            src = sum(np.sin(h * ph) / h for h in range(1, 20))
            vw = VOWELS[r.integers(0, len(VOWELS))]
            seg = bp(src, vw[0] * shift * 0.8, vw[0] * shift * 1.25, 2) + bp(src, vw[1] * shift * 0.85, vw[1] * shift * 1.2, 2) * 0.5
            seg += bp(r.normal(size=m), 3000, 6500) * 0.05
            seg *= np.sin(np.pi * np.arange(m) / m) ** 1.5
            place(voice, seg * r.uniform(0.4, 1), pos)
            pos += L * r.uniform(0.9, 1.5)
        out += unit(voice)
    out = lp(out, 3200, 2)
    return norm(hp(out, 110), 0.55)


def chant(seed, sec=4.0):
    r = R(seed); n = N(sec); t = T(n); out = np.zeros(n)
    for _ in range(6):
        f0 = r.choice([130.8, 146.8, 164.8, 110.0, 123.5, 174.6]) * r.uniform(0.99, 1.01)
        ph = 2 * np.pi * np.cumsum(f0 * (1 + 0.006 * np.sin(2 * np.pi * r.uniform(4.5, 6) * t + r.uniform(0, 6)))) / SR
        src = sum(np.sin(h * ph) / h for h in range(1, 24))
        s = bp(src, 240, 380, 2) + bp(src, 700, 1000, 2) * 0.5
        pulse = 0.3 + 0.7 * np.maximum(0, np.sin(2 * np.pi * 1.6 * t - 0.5)) ** 1.5
        out += s * pulse
    out += bp(r.normal(size=n), 1500, 4000) * 0.02
    out *= np.minimum(t / 0.4, 1) * np.minimum((sec - t) / 0.6, 1)
    return norm(hp(out, 90), 0.6)


def clank(seed):
    r = R(seed); n = N(0.7)
    f = r.uniform(900, 2400)
    y = ringing(n, [f, f * 2.45, f * 4.2, f * 6.1], [0.10, 0.07, 0.04, 0.025], [1, 0.6, 0.35, 0.2], r=r)
    y += bp(r.normal(size=n), 2000, 8000) * expdec(n, 0.004) * 0.8
    y += np.sin(2 * np.pi * r.uniform(220, 400) * T(n)) * expdec(n, 0.02) * 0.4
    return fade(norm(hp(y, 150), 0.8), 0.0005, 0.12)


def anvil(seed):
    r = R(seed); n = N(1.6)
    f = 1150
    y = ringing(n, [f, f * 1.51, f * 2.31, f * 3.4, f * 4.9], [0.55, 0.4, 0.3, 0.2, 0.1], [1, 0.7, 0.5, 0.3, 0.2], r=r)
    y += bp(r.normal(size=n), 2000, 9000) * expdec(n, 0.004)
    return fade(norm(hp(y, 200), 0.8), 0.0005, 0.3)


def drip(seed, deep=False):
    r = R(seed); n = N(0.6 if deep else 0.4); t = T(n)
    f = r.uniform(380, 800) if deep else r.uniform(900, 2400)
    ph = 2 * np.pi * np.cumsum(f * (1 + 0.45 * (1 - np.exp(-t / 0.012)) * np.exp(-t / 0.05))) / SR
    y = np.sin(ph) * np.exp(-t / (0.12 if deep else 0.06))
    y += 0.25 * np.sin(2.01 * ph) * np.exp(-t / 0.03)
    y += bp(r.normal(size=n), 2500, 8000) * np.exp(-t / 0.003) * 0.4
    return fade(norm(hp(y, 250), 0.7), 0.0003, 0.08)


def water_lap(seed):
    r = R(seed); n = N(1.4); t = T(n)
    x = bp(r.normal(size=n), 300, 2200) * (0.3 + 0.7 * np.sin(np.pi * np.minimum(t / 1.4, 1)) ** 2)
    for _ in range(r.integers(6, 12)):
        f = r.uniform(500, 1800); at = r.uniform(0.05, 1.2)
        tt = T(N(0.1))
        place(x, np.sin(2 * np.pi * f * (1 + 0.8 * tt / 0.1) * tt) * np.exp(-tt / 0.03) * r.uniform(0.1, 0.4), at)
    return fade(norm(hp(x, 150), 0.55), 0.05, 0.3)


def seal_hiss(seed, sec=1.5):
    r = R(seed); n = N(sec); t = T(n)
    env = np.minimum(t / 0.06, 1) * np.exp(-np.maximum(t - 0.1, 0) / (sec * 0.35))
    x = unit(specnoise(n, bandshape(1800, 9000, 2, 1.5), r)) * env * 0.25
    clamp = np.sin(2 * np.pi * 130 * t) * np.exp(-t / 0.03) * 0.6 * (t < 0.2)
    clamp += bp(r.normal(size=n), 300, 1500) * np.exp(-t / 0.02) * 0.5
    return fade(norm(hp(x + clamp, 100), 0.7), 0.002, 0.2)


def door_thud(seed):
    r = R(seed); n = N(0.5); t = T(n)
    y = np.sin(2 * np.pi * 95 * (0.8 + 0.2 * np.exp(-t / 0.05)) * t) * np.exp(-t / 0.07)
    y += bp(r.normal(size=n), 150, 900) * np.exp(-t / 0.03) * 0.7
    return fade(norm(hp(y, 55), 0.8), 0.001, 0.12)


def loom_clack(seed):
    r = R(seed); n = N(0.18); y = np.zeros(n)
    f = r.uniform(700, 1300)
    for at, a in ((0, 1.0), (0.055, 0.5)):
        place(y, ringing(N(0.1), [f, f * 2.3], [0.012, 0.007], [1, 0.4], r=r) * a, at)
        place(y, bp(r.normal(size=N(0.01)), 1500, 6000) * 0.5 * a, at)
    return fade(norm(hp(y, 250), 0.7), 0.0003, 0.03)


def breath_dry(seed):
    r = R(seed); n = N(1.2); t = T(n)
    x = bp(r.normal(size=n), 500, 2800) * np.sin(np.pi * np.minimum(t / 1.1, 1)) ** 2
    return fade(norm(hp(x, 200), 0.4), 0.05, 0.2)


# ------------------------------------------------------------------ сад
def bird(seed):
    r = R(seed); n = N(r.uniform(0.35, 0.8)); y = np.zeros(n)
    base = r.uniform(2400, 4800)
    pos = 0.0
    for _ in range(r.integers(2, 7)):
        L = r.uniform(0.04, 0.11); m = N(L); tt = T(m)
        f0 = base * r.uniform(0.85, 1.25); sweep = r.choice([-0.45, 0.4, 0.8, -0.2])
        ph = 2 * np.pi * np.cumsum(f0 * (1 + sweep * tt / L) * (1 + 0.04 * np.sin(2 * np.pi * 60 * tt))) / SR
        s = (np.sin(ph) + 0.25 * np.sin(2 * ph)) * np.sin(np.pi * np.arange(m) / m) ** 0.7
        place(y, s * r.uniform(0.5, 1), pos)
        pos += L + r.uniform(0.03, 0.09)
        if pos > n / SR - 0.1:
            break
    return fade(norm(hp(y, 1500), 0.55), 0.002, 0.05)


def dove(seed):
    r = R(seed); n = N(1.5); y = np.zeros(n)
    f = r.uniform(340, 440)
    for i, at in enumerate((0.0, 0.42, 0.78, 1.1)):
        m = N(0.32); tt = T(m)
        fm = f * (0.92 if i == 0 else 1) * (1 - 0.1 * tt / 0.32)
        ph = 2 * np.pi * np.cumsum(fm) / SR
        s = (np.sin(ph) + 0.4 * np.sin(2 * ph) + 0.15 * np.sin(3 * ph)) * np.sin(np.pi * np.arange(m) / m) ** 1.2
        place(y, s * (0.6 if i == 3 else 1.0), at)
    return fade(norm(hp(lp(y, 1600), 220), 0.5), 0.01, 0.15)


def brook(seed, sec=5.0):
    r = R(seed); n = N(sec)
    x = unit(specnoise(n, bandshape(600, 5500, 1.5, 1.6), r)) * 0.5
    m = N(0.06); tt = T(m)
    for _ in range(int(sec * 22)):
        f = r.uniform(700, 2800); at = r.uniform(0, sec - 0.1)
        b = np.sin(2 * np.pi * f * (1 + 1.2 * tt / 0.06) * tt) * np.exp(-tt / 0.012) * r.uniform(0.05, 0.25)
        x[(np.arange(m) + int(at * SR)) % n] += b
    return norm(hp(x, 350), 0.5)


# ------------------------------------------------------------------ интерфейс (мягкий)
def ui_tick(seed):
    n = N(0.06); t = T(n)
    return fade(norm(np.sin(2 * np.pi * 1250 * t) * np.exp(-t / 0.012) * np.minimum(t / 0.002, 1), 0.5), 0.001, 0.02)


def ui_interact(seed):
    n = N(0.14); t = T(n)
    y = (np.sin(2 * np.pi * 620 * t) + 0.3 * np.sin(2 * np.pi * 1240 * t)) * np.exp(-t / 0.035) * np.minimum(t / 0.004, 1)
    return fade(norm(y, 0.5), 0.001, 0.03)


def ui_hint(seed):
    n = N(1.0); t = T(n); f = 523.25
    y = ringing(n, [f, f * 2.0, f * 3.01, f * 1.5], [0.35, 0.2, 0.1, 0.25], [1, 0.3, 0.1, 0.35]) * np.minimum(t / 0.02, 1)
    return fade(norm(y, 0.5), 0.001, 0.2)


def ui_title(seed):
    n = N(2.4); t = T(n); f = 196.0
    y = ringing(n, [f, f * 2.0, f * 3.0, f * 4.2], [1.1, 0.8, 0.5, 0.3], [1, 0.5, 0.25, 0.1]) * np.minimum(t / 0.25, 1)
    return fade(norm(hp(y, 100), 0.5), 0.01, 0.6)


def ui_pause(seed):
    r = R(seed); n = N(0.25); t = T(n)
    y = bp(r.normal(size=n), 400, 2400) * np.sin(np.pi * t / 0.25) ** 2
    return fade(norm(hp(y, 200), 0.4), 0.01, 0.05)


def ui_shutter(seed):
    r = R(seed); n = N(0.2); y = np.zeros(n)
    for at, f in ((0, 3000), (0.07, 1800)):
        place(y, bp(r.normal(size=N(0.03)), f * 0.6, f * 1.6) * expdec(N(0.03), 0.006), at)
    return fade(norm(hp(y, 600), 0.5), 0.0005, 0.03)


# ------------------------------------------------------------------ реестр: (имя, генератор, kbps)
def registry():
    L = []

    def add(name, fn, kbps=24):
        L.append((name, fn, kbps))
    for i in range(6): add(f'sand_step_{i+1}', lambda i=i: sand_step(100 + i), 28)
    for i in range(4): add(f'sand_run_{i+1}', lambda i=i: sand_step(130 + i, True), 28)
    for i in range(4): add(f'sandwalk_{i+1}', lambda i=i: sandwalk_drag(160 + i), 24)
    for i in range(3): add(f'packed_{i+1}', lambda i=i: packed_step(200 + i), 28)
    for i in range(4): add(f'rock_{i+1}', lambda i=i: rock_step(230 + i), 28)
    for i in range(3): add(f'stone_{i+1}', lambda i=i: stone_step(260 + i), 28)
    for i in range(2): add(f'metal_{i+1}', lambda i=i: metal_step(290 + i), 28)
    for i in range(3): add(f'cloth_{i+1}', lambda i=i: cloth(310 + i), 24)
    for i in range(2): add(f'land_sand_{i+1}', lambda i=i: land_sand(330 + i), 28)
    add('land_hard_1', lambda: land_hard(340), 28)
    for i in range(3): add(f'sand_tick_{i+1}', lambda i=i: sand_tick(350 + i), 24)
    add('sand_pour_1', lambda: sand_pour(360), 20)
    for i in range(5): add(f'worm_crackle_{i+1}', lambda i=i: worm_crackle(370 + i), 24)
    for i in range(4): add(f'worm_rock_{i+1}', lambda i=i: worm_rock(390 + i), 24)
    add('worm_thud_1', lambda: worm_thud(410), 28)
    add('distant_thump_1', lambda: distant_thump(420), 24)
    for i in range(2): add(f'thumper_hit_{i+1}', lambda i=i: thumper_hit(430 + i), 28)
    add('worm_rasp_1', lambda: worm_rasp(440), 20)
    add('worm_roar_1', lambda: worm_roar(450), 24)
    add('worm_grind_1', lambda: worm_grind(460), 20)
    add('engine_loop_1', lambda: engine_loop(470), 24)
    add('klaxon_1', lambda: klaxon(480), 24)
    add('klaxon_long_1', lambda: klaxon(481, 2.6), 24)
    for i in range(5): add(f'track_clank_{i+1}', lambda i=i: track_clank(490 + i), 24)
    for i in range(2): add(f'hyd_hiss_{i+1}', lambda i=i: hyd_hiss(510 + i), 20)
    add('carryall_loop_1', lambda: carryall_loop(520), 20)
    add('room_stone_1', lambda: room_stone(530), 20)
    add('babble_1', lambda: babble(540, 6.0, 5), 20)
    add('babble_2', lambda: babble(541, 6.0, 9, 95, 230), 20)
    add('chant_1', lambda: chant(550), 24)
    for i in range(5): add(f'clank_{i+1}', lambda i=i: clank(560 + i), 24)
    add('anvil_1', lambda: anvil(570), 24)
    for i in range(5): add(f'drip_{i+1}', lambda i=i: drip(580 + i), 24)
    for i in range(3): add(f'dripdeep_{i+1}', lambda i=i: drip(590 + i, True), 24)
    for i in range(2): add(f'water_lap_{i+1}', lambda i=i: water_lap(600 + i), 20)
    for i in range(2): add(f'seal_hiss_{i+1}', lambda i=i: seal_hiss(610 + i), 20)
    add('door_thud_1', lambda: door_thud(620), 28)
    for i in range(3): add(f'loom_clack_{i+1}', lambda i=i: loom_clack(630 + i), 24)
    add('breath_dry_1', lambda: breath_dry(640), 20)
    for i in range(6): add(f'bird_{i+1}', lambda i=i: bird(650 + i), 24)
    for i in range(2): add(f'dove_{i+1}', lambda i=i: dove(670 + i), 24)
    add('brook_1', lambda: brook(680), 20)
    for nme, fn in (('ui_tick', ui_tick), ('ui_interact', ui_interact), ('ui_hint', ui_hint), ('ui_title', ui_title), ('ui_pause', ui_pause), ('ui_shutter', ui_shutter)):
        add(nme + '_1', lambda fn=fn: fn(700), 24)
    return L


def encode(x, kbps):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    p = subprocess.run(['ffmpeg', '-v', 'error', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'libopus', '-b:a', f'{kbps}k',
                        '-application', 'audio', '-vbr', 'on', '-map_metadata', '-1', '-fflags', '+bitexact', '-f', 'ogg', '-'], input=pcm, capture_output=True, check=True)
    return p.stdout


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument('--out', default=os.path.join(here, '..', '..', 'Web', 'src', 'assets', 'sfx_bank.js'))
    ap.add_argument('--wav-dir', default=None)
    a = ap.parse_args()
    bank, dur, total_bin = {}, {}, 0
    for name, fn, kbps in registry():
        x = np.asarray(fn(), dtype=np.float64)
        assert np.isfinite(x).all(), name
        if a.wav_dir:
            import wave
            os.makedirs(a.wav_dir, exist_ok=True)
            with wave.open(os.path.join(a.wav_dir, name + '.wav'), 'wb') as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())
        ogg = encode(x, kbps)
        bank[name] = 'data:audio/ogg;codecs=opus;base64,' + base64.b64encode(ogg).decode()
        dur[name] = round(len(x) / SR, 3)
        total_bin += len(ogg)
    js = ('// Сгенерировано Tools/sfx/sfx_build.py (numpy/scipy -> Opus) — не править вручную.\n'
          '// SFX: имя -> data-URI (OGG/Opus, моно). Имена base_N образуют группу base. SFX_DUR: длительность, с.\n'
          f'export const SFX = {json.dumps(bank)};\nexport const SFX_DUR = {json.dumps(dur)};\n')
    with open(a.out, 'w') as f:
        f.write(js)
    print(f'{len(bank)} сэмплов, opus {total_bin/1024:.0f} КБ, js {len(js)/1024:.0f} КБ')
    if len(js) > BUDGET:
        print('ПРЕВЫШЕН БЮДЖЕТ 0.5 МБ', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
