"""
Instrument voices for the offline music renderer. Every function renders a list of notes into a stereo
stem (2, n) and returns it. A note is a dict: t (start, s), d (held duration, s), m (MIDI pitch, float ok),
v (velocity 0..1), pan (-1..1, optional).

All voices are band-limited (wavetables / additive partials below 0.44 * SR) and enveloped with smooth
attacks, so nothing clicks; brightness is shaped by filters downstream (see tracks.py).
"""
import numpy as np
import os
BRIGHT = float(os.environ.get('MUSIC_BRIGHT', '1.0'))
from dsp import (SR, TWO_PI, midi_hz, table, nharm_for, osc, env_ar, filt, sweep, pan_gains, pink, brown, curve)


def _slow_drift(n, rng, rate=0.12, depth=1.0):
    """Cheap smooth random modulation: computed every 256 samples and interpolated."""
    m = n // 256 + 2
    t = np.arange(m) * 256 / SR
    d = np.zeros(m)
    for _ in range(3):
        d += np.sin(TWO_PI * rate * rng.uniform(0.5, 1.6) * t + rng.uniform(0, TWO_PI))
    return np.interp(np.arange(n), np.arange(m) * 256, d) * (depth / 3)


def _add(out, start, sig, pan, gain=1.0):
    i0 = int(round(start * SR))
    if i0 >= out.shape[1]:
        return
    n = min(len(sig), out.shape[1] - i0)
    if n <= 0:
        return
    gl, gr = pan_gains(pan)
    out[0, i0:i0 + n] += sig[:n] * (gl * gain)
    out[1, i0:i0 + n] += sig[:n] * (gr * gain)


def pad(notes, n_total, voices=6, detune=9.0, kind='warm', attack=2.5, release=4.0, spread=0.7,
        limit=48, vib=0.0, vib_rate=4.8, seed=0, octave_mix=0.0):
    """Ensemble pad / analogue strings: detuned band-limited voices with slow pitch drift."""
    rng = np.random.default_rng(seed)
    out = np.zeros((2, n_total))
    for nt in notes:
        f0 = float(midi_hz(nt['m']))
        n = int((nt['d'] + release) * SR)
        env = env_ar(n, nt.get('a', attack), release) * nt['v']
        tab = table(kind, nharm_for(f0 * 1.03, limit))
        base_pan = nt.get('pan', 0.0)
        dr = _slow_drift(n, rng, 0.11, 1.0)
        vibrato = 0.0
        if vib > 0:
            tt = np.arange(n) / SR
            vibrato = vib * np.sin(TWO_PI * vib_rate * tt + rng.uniform(0, TWO_PI)) * np.clip(tt / 1.5, 0, 1)
        acc_l = np.zeros(n); acc_r = np.zeros(n)
        for k in range(voices):
            x = (k / max(1, voices - 1)) * 2 - 1 if voices > 1 else 0.0
            cents = x * detune + rng.normal(0, 1.2)
            fr = f0 * 2 ** (cents / 1200) * (1 + 0.0009 * dr * rng.uniform(0.6, 1.4) + vibrato)
            s = osc(tab, fr, n, rng.uniform())
            gl, gr = pan_gains(np.clip(base_pan + x * spread, -1, 1))
            acc_l += s * gl; acc_r += s * gr
        if octave_mix > 0:
            tab2 = table('tri', nharm_for(f0 * 2.05, 16))
            s = osc(tab2, f0 * 2 * (1 + 0.0007 * dr), n, rng.uniform()) * octave_mix * voices * 0.5
            acc_l += s * 0.7; acc_r += s * 0.7
        g = 1.0 / np.sqrt(voices)
        i0 = int(round(nt['t'] * SR))
        m = min(n, n_total - i0)
        if m <= 0:
            continue
        out[0, i0:i0 + m] += acc_l[:m] * env[:m] * g
        out[1, i0:i0 + m] += acc_r[:m] * env[:m] * g
    return out


def choir(notes, n_total, seed=0, vowel_curve=None, attack=3.0, release=4.5):
    """Synthetic choir: a soft saw ensemble through a formant bank morphing between 'oo' and 'ah'."""
    raw = pad(notes, n_total, voices=5, detune=7.0, kind='saw', attack=attack, release=release, spread=0.8,
              limit=40, vib=0.0035, vib_rate=5.2, seed=seed)
    oo = [(320, 6, 1.0), (800, 7, 0.45), (2300, 9, 0.12), (3000, 10, 0.06)]
    ah = [(700, 6, 1.0), (1150, 7, 0.6), (2800, 9, 0.2), (3500, 10, 0.08)]
    def bank(x, fs):
        y = np.zeros_like(x)
        for f, q, g in fs:
            y += filt(x, 'bp', f, q) * g
        return y
    a = bank(raw, oo); b = bank(raw, ah)
    if vowel_curve is None:
        vowel_curve = 0.5 + 0.5 * np.sin(TWO_PI * np.arange(n_total) / SR / 23.0)
    return (a * (1 - vowel_curve) + b * vowel_curve) * 2.2


def piano(notes, n_total, seed=0, bright=1.0, B=0.00035):
    """Additive piano: stiff-string partials (inharmonicity B), hammer-position comb, two detuned strings,
    two-stage decay with faster decay of the upper partials, damper release, a soft hammer thump."""
    rng = np.random.default_rng(seed)
    out = np.zeros((2, n_total))
    for nt in notes:
        f0 = float(midi_hz(nt['m']))
        v = nt['v']
        rel = 0.35
        t60 = float(np.clip(14.0 * (261.6 / f0) ** 0.62, 1.6, 22.0))
        hold = nt['d']
        n = int(min(hold + rel, t60 * 1.05) * SR) + 1
        t = np.arange(n) / SR
        sig = np.zeros(n)
        nmax = int(min(36, 0.44 * SR / f0))
        slope = 1.15 + 0.9 * (1 - v) / max(bright, 0.3)
        x0 = 1 / 7.6 + rng.uniform(-0.01, 0.01)
        for k in range(1, nmax + 1):
            fk = k * f0 * np.sqrt(1 + B * k * k)
            if fk > 0.44 * SR:
                break
            a = (1.0 / k ** slope) * (0.25 + abs(np.sin(np.pi * k * x0)))
            tk = t60 / (1 + 0.012 * k * k * (f0 / 261.6) ** 0.5)
            # length where this partial is above -80 dB
            m = min(n, int(tk * 1.3 * SR) + 1)
            tt = t[:m]
            e = 0.72 * np.exp(-6.91 * tt / (tk * 0.22)) + 0.28 * np.exp(-6.91 * tt / tk)
            det = 1 + rng.uniform(0.0002, 0.0006)
            ph1 = rng.uniform(0, TWO_PI); ph2 = rng.uniform(0, TWO_PI)
            s = np.sin(TWO_PI * fk * tt + ph1)
            if k <= 10:
                s = 0.5 * (s + np.sin(TWO_PI * fk * det * tt + ph2))
            sig[:m] += a * e * s
        # damper
        h = int(hold * SR)
        if h < n:
            r = n - h
            sig[h:] *= np.exp(-np.arange(r) / (rel * 0.3 * SR))
        # attack shaping (2 ms) + hammer thump
        a = int(0.002 * SR)
        sig[:a] *= np.sin(0.5 * np.pi * np.arange(a) / a)
        th = int(0.012 * SR)
        thump = rng.standard_normal(th) * np.exp(-np.arange(th) / (0.0025 * SR))
        thump = filt(thump, 'lp', min(4000, f0 * 6), 0.7) * 0.05 * v
        sig[:th] += thump
        sig *= v * 0.35
        pan = nt.get('pan', np.clip((nt['m'] - 64) / 30, -0.6, 0.6))
        _add(out, nt['t'], sig, pan)
    return out


BELL_GLASS = [(1.0, 1.0, 1.0), (2.005, 0.42, 0.6), (3.01, 0.22, 0.45), (4.16, 0.14, 0.3), (5.43, 0.08, 0.22), (6.79, 0.05, 0.15)]
BELL_TUBE = [(1.0, 1.0, 1.0), (2.76, 0.45, 0.55), (5.40, 0.25, 0.32), (8.93, 0.12, 0.18)]
BELL_BOWL = [(1.0, 1.0, 1.0), (2.32, 0.5, 0.8), (4.25, 0.3, 0.55), (6.63, 0.18, 0.4), (9.38, 0.1, 0.25)]


def bell(notes, n_total, partials=BELL_GLASS, decay=6.0, seed=0, attack=0.004):
    """Inharmonic additive bells / glass: each partial with its own decay; slight beating pairs."""
    rng = np.random.default_rng(seed)
    out = np.zeros((2, n_total))
    for nt in notes:
        f0 = float(midi_hz(nt['m']))
        dec = nt.get('decay', decay)
        n = int(dec * 1.2 * SR)
        t = np.arange(n) / SR
        sig = np.zeros(n)
        for ratio, amp, dk in partials:
            f = f0 * ratio
            if f > 0.44 * SR:
                continue
            td = dec * dk
            e = np.exp(-6.91 * t / td)
            beat = 1 + 0.15 * np.sin(TWO_PI * rng.uniform(0.3, 1.3) * t + rng.uniform(0, TWO_PI))
            sig += amp * e * beat * np.sin(TWO_PI * f * t + rng.uniform(0, TWO_PI))
        a = max(2, int(attack * SR))
        sig[:a] *= np.sin(0.5 * np.pi * np.arange(a) / a) ** 2
        sig *= nt['v'] * 0.25
        _add(out, nt['t'], sig, nt.get('pan', rng.uniform(-0.6, 0.6)))
    return out


def pluck(notes, n_total, seed=0, cut0=3200.0, cut1=380.0, fdecay=0.22, decay=0.9, kind_mix=0.35, q=1.1):
    """Analogue pluck (arpeggios / harp-like): saw + square through a decaying resonant low-pass."""
    rng = np.random.default_rng(seed)
    out = np.zeros((2, n_total))
    for nt in notes:
        f0 = float(midi_hz(nt['m']))
        dur = nt['d'] + decay
        n = int(dur * SR)
        t = np.arange(n) / SR
        tab1 = table('saw', nharm_for(f0, 40)); tab2 = table('square', nharm_for(f0, 40))
        ph = rng.uniform()
        s = osc(tab1, f0 * 1.0015, n, ph) * (1 - kind_mix) + osc(tab2, f0 * 0.9985, n, ph) * kind_mix
        c0 = nt.get('cut', cut0) * BRIGHT
        cutoff = cut1 + (c0 - cut1) * np.exp(-t / fdecay)
        cutoff = np.minimum(cutoff, 0.42 * SR)
        y = sweep(s, cutoff, q=q, block=128, stages=2)
        env = np.exp(-t / (decay * 0.45))
        a = int(0.003 * SR)
        env[:a] *= np.arange(a) / a
        h = int(nt['d'] * SR)
        if h < n:
            env[h:] *= np.exp(-np.arange(n - h) / (0.12 * SR))
        y *= env * nt['v'] * 0.5
        _add(out, nt['t'], y, nt.get('pan', rng.uniform(-0.5, 0.5)))
    return out


def lead(notes, n_total, seed=0, vib=0.006, attack=0.35, release=1.2, kind='tri'):
    """Soft distant lead (flute-like synth): triangle + sine, delayed vibrato, breath noise."""
    rng = np.random.default_rng(seed)
    out = np.zeros((2, n_total))
    for nt in notes:
        f0 = float(midi_hz(nt['m']))
        n = int((nt['d'] + release) * SR)
        t = np.arange(n) / SR
        vibr = vib * np.sin(TWO_PI * 5.0 * t + rng.uniform(0, TWO_PI)) * np.clip((t - 0.4) / 1.0, 0, 1)
        fr = f0 * (1 + vibr)
        s = 0.6 * osc(table(kind, nharm_for(f0, 24)), fr, n, rng.uniform()) + 0.4 * osc(table('sine', 1), fr, n, rng.uniform())
        br = filt(rng.standard_normal(n), 'bp', min(f0 * 3, 9000), 1.2) * 0.04
        env = env_ar(n, attack, release)
        y = (s + br) * env * nt['v'] * 0.4
        _add(out, nt['t'], y, nt.get('pan', 0.0))
    return out


def sub(notes, n_total, attack=4.0, release=5.0, h2=0.18):
    """Deep sub drone: sine + a little second harmonic, very slow envelopes."""
    out = np.zeros((2, n_total))
    for nt in notes:
        f0 = float(midi_hz(nt['m']))
        n = int((nt['d'] + release) * SR)
        t = np.arange(n) / SR
        s = np.sin(TWO_PI * f0 * t) + h2 * np.sin(TWO_PI * 2 * f0 * t + 0.3)
        s *= env_ar(n, nt.get('a', attack), release) * nt['v'] * 0.5
        _add(out, nt['t'], s, 0.0)
    return out


def bass(notes, n_total, seed=0, cut=420.0, env_amt=900.0, decay=0.35, glide=0.0):
    """Analogue mono bass for ostinatos: saw through a low-pass with a short envelope."""
    rng = np.random.default_rng(seed)
    out = np.zeros((2, n_total))
    for nt in notes:
        f0 = float(midi_hz(nt['m']))
        n = int((nt['d'] + 0.25) * SR)
        t = np.arange(n) / SR
        s = osc(table('saw', nharm_for(f0, 48)), f0, n, rng.uniform()) * 0.7 + np.sin(TWO_PI * f0 * t) * 0.5
        cutoff = np.minimum(cut + env_amt * nt['v'] * np.exp(-t / decay), 0.42 * SR)
        y = sweep(s, cutoff, q=0.9, block=128)
        env = env_ar(n, 0.006, 0.2)
        y *= env * nt['v'] * 0.45
        _add(out, nt['t'], y, 0.0)
    return out


def kick(times, n_total, vel=None, f_hi=110.0, f_lo=44.0, decay=0.42):
    """Soft cinematic kick: pitched sine drop + tiny click (no hard transient)."""
    out = np.zeros((2, n_total))
    n = int(decay * 1.6 * SR)
    t = np.arange(n) / SR
    f = f_lo + (f_hi - f_lo) * np.exp(-t / 0.035)
    ph = np.cumsum(f) / SR
    s = np.sin(TWO_PI * ph) * np.exp(-t / (decay * 0.45))
    a = int(0.002 * SR)
    s[:a] *= np.arange(a) / a
    for i, tm in enumerate(times):
        v = vel[i] if vel is not None else 1.0
        _add(out, tm, s * v * 0.6, 0.0)
    return out


def hat(times, n_total, vel=None, seed=0, hp=7000.0, decay=0.03):
    rng = np.random.default_rng(seed)
    out = np.zeros((2, n_total))
    n = int(decay * 6 * SR)
    for i, tm in enumerate(times):
        v = vel[i] if vel is not None else 1.0
        s = rng.standard_normal(n) * np.exp(-np.arange(n) / (decay * SR))
        s = filt(filt(s, 'hp', hp, 0.7), 'lp', 14000, 0.7)
        _add(out, tm, s * v * 0.08, rng.uniform(-0.3, 0.3))
    return out


def timpani(notes, n_total, seed=0):
    """Soft orchestral boom: low membrane partials + mallet noise, long decay."""
    rng = np.random.default_rng(seed)
    out = np.zeros((2, n_total))
    for nt in notes:
        f0 = float(midi_hz(nt['m']))
        n = int(4.0 * SR)
        t = np.arange(n) / SR
        s = np.zeros(n)
        for ratio, amp, dk in [(1.0, 1.0, 1.0), (1.5, 0.5, 0.6), (1.99, 0.35, 0.45), (2.44, 0.2, 0.3)]:
            s += amp * np.exp(-t / (1.1 * dk)) * np.sin(TWO_PI * f0 * ratio * (1 + 0.02 * np.exp(-t / 0.05)) * t)
        nz = filt(rng.standard_normal(n), 'lp', 700, 0.7) * np.exp(-t / 0.06) * 0.4
        y = (s + nz)
        a = int(0.004 * SR)
        y[:a] *= np.arange(a) / a
        _add(out, nt['t'], y * nt['v'] * 0.35, nt.get('pan', 0.0))
    return out


def wind(n_total, seed=0, center=None, q=1.4, level=1.0, color='pink'):
    """Slowly moving band-passed noise ('solar wind' texture), stereo decorrelated. center: per-sample Hz."""
    rng = np.random.default_rng(seed)
    if center is None:
        center = 600 + 400 * np.sin(TWO_PI * np.arange(n_total) / SR / 41.0)
    out = np.zeros((2, n_total))
    for c in range(2):
        w = pink(n_total, rng) if color == 'pink' else brown(n_total, rng)
        out[c] = sweep(w, center * (1 + 0.08 * c), q=q, kind='bp', block=512, stages=1)
    return out * level * 0.1


def swell(n_total, start, dur, f_from=200.0, f_to=2400.0):
    """Cutoff curve helper for brass-like swells: rises over dur then falls back."""
    pts = [(0, f_from), (start, f_from), (start + dur * 0.7, f_to), (start + dur * 1.2, f_from)]
    return curve(pts, n_total)
