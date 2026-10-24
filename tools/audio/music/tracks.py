"""
Track definitions: harmonic plans, layers and mixes of the eight soundtrack pieces and three stingers.
All progressions, voicings and motifs are original (written for this project), in the general style of
slow orchestral-synth space ambient: evolving pads, warm analogue strings, sparse piano and bells, deep
sub drones, slow arpeggios and long reverb tails.

Each track function returns (stereo (2, n) float array, meta dict). Loop tracks are rendered circularly
(note tails and reverb fold back onto the start), so they repeat seamlessly.
"""
import numpy as np
from dsp import (SR, fold, convolve_circ, make_ir, circ_filter, filt, sweep, chorus, pingpong, compress, limiter,
                 normalize_lufs, lufs, curve, TWO_PI)
from compose import Plan, pad_layer, melody, arpeggio, ostinato, drone, tied
import instruments as ins

TAIL = 14.0
import os
REPORT_BANDS = os.environ.get('STEM_BANDS') == '1'

# shared reverbs (built lazily)
_IRS = {}


def ir(name):
    if name not in _IRS:
        if name == 'hall':      # huge "space" hall: long, dark tail
            _IRS[name] = make_ir(9.0, rt=(7.5, 6.8, 5.6, 3.8, 2.2), predelay=0.035, seed=11, er=16, width=1.0, damp_hf=8500)
        elif name == 'room':    # small warm room for piano body
            _IRS[name] = make_ir(2.2, rt=(1.6, 1.4, 1.1, 0.8, 0.5), predelay=0.008, seed=12, er=10, width=0.8, damp_hf=9000)
        elif name == 'plate':   # bright plate for bells / plucks
            _IRS[name] = make_ir(5.0, rt=(3.2, 3.4, 3.4, 3.0, 2.2), predelay=0.012, seed=13, er=6, width=1.0, damp_hf=12000)
    return _IRS[name]


def C(bass, pad, beats=8, **kw):
    d = dict(bass=bass, pad=list(pad), beats=beats)
    d.update(kw)
    return d


BRIGHT = float(os.environ.get('MUSIC_BRIGHT', '1.0'))   # global brightness knob (pad / pluck cutoffs)


def tone(x, cut, q=0.6):
    """Pad tone filter: 12 dB/oct low-pass; the score's cutoff values x 2.4 x BRIGHT."""
    return sweep(x, cut * 2.4 * BRIGHT, q=q, stages=1)


def sub_pitch(b):
    return b - 12 if b - 12 >= 28 else b


class Mix:
    """Collects stems: each stem is levelled to a target loudness (gated LUFS of the stem alone), then
    split into dry and reverb sends. loop=True folds tails onto the start (seamless repeat)."""

    def __init__(self, seconds, loop=True, name=''):
        self.n = int(round(seconds * SR))
        self.N = self.n + int(TAIL * SR) if loop else self.n
        self.loop = loop
        self.name = name
        self.dry = np.zeros((2, self.n), dtype=np.float32)
        self.sends = {k: np.zeros((2, self.n), dtype=np.float32) for k in ('hall', 'room', 'plate')}
        self.report = []

    def blank(self):
        return self.N

    def add(self, label, stem, level, dry=1.0, hall=0.0, room=0.0, plate=0.0):
        st = fold(stem, self.n) if self.loop else stem[:, :self.n]
        l = lufs(st)
        if l <= -69:
            self.report.append((label, None))
            return
        g = 10 ** ((level - l) / 20)
        st = st * g
        if REPORT_BANDS:
            from analyze import spectrum_balance
            b, cen = spectrum_balance(st)
            self.report.append((label, f"{round(l, 1)} [hi {b['2000-6000']}%/{b['6000-20000']}% c{int(cen)}]"))
        else:
            self.report.append((label, round(l, 1)))
        self.dry += (st * dry).astype(np.float32)
        for k, v in (('hall', hall), ('room', room), ('plate', plate)):
            if v:
                self.sends[k] += (st * v).astype(np.float32)

    def master(self, target=-18.0, hp=28.0, comp=True, fade_out=0.0):
        out = self.dry.astype(np.float64)
        for k, s in self.sends.items():
            if np.any(s):
                if self.loop:
                    out += convolve_circ(s.astype(np.float64), ir(k))
                else:
                    from scipy.signal import oaconvolve
                    for c in range(2):
                        out[c] += oaconvolve(s[c].astype(np.float64), ir(k)[c])[:self.n]
        f = (lambda x: filt(filt(x, 'hp', hp, 0.6), 'highshelf', 7000, 0.7, 1.0))
        out = circ_filter(out, f, 3.0) if self.loop else f(out)
        out -= np.mean(out, axis=1, keepdims=True)
        if comp:
            out = compress(out, thr_db=-25, ratio=1.5, attack=0.08, release=0.8, circular=self.loop)
        if fade_out > 0 and not self.loop:
            k = int(fade_out * SR)
            out[:, -k:] *= np.linspace(1, 0, k) ** 2
        out, l0 = normalize_lufs(out, target)
        out = limiter(out, -1.5, circular=self.loop)
        out, _ = normalize_lufs(out, target)
        out = limiter(out, -1.2, circular=self.loop)
        return out


def ramp(i, pts):
    """Piecewise-linear intensity over chord index: pts [(index, value), ...]."""
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return float(np.interp(i, xs, ys))


def sec_curve(plan, n, pts):
    """Automation from (beat, value) points over a loop of n samples (wraps smoothly)."""
    p = [(plan.t(b), v) for b, v in pts]
    return curve(p, n)


# ================================================================================================ 1
def station_calm():
    """«Тихий ход» — station life, calm: D major, warm strings, sparse piano, a gentle arpeggio in B."""
    A = [C(38, [50, 57, 61, 64, 66]), C(35, [50, 57, 61, 64, 66]), C(43, [50, 59, 61, 62, 66]), C(45, [57, 62, 64, 69]),
         C(42, [57, 61, 64, 66]), C(40, [55, 59, 62, 66]), C(43, [57, 59, 62, 66]), C(45, [55, 62, 64, 69])]
    B = [C(47, [57, 61, 62, 66]), C(43, [54, 59, 62, 67]), C(42, [57, 62, 64, 66]), C(37, [57, 61, 64, 71]),
         C(35, [57, 61, 64, 66]), C(40, [55, 57, 62, 66]), C(43, [54, 59, 61, 66]), C(45, [57, 59, 64, 69])]
    A2 = [C(38, [50, 57, 61, 64, 66]), C(35, [50, 54, 61, 64, 66]), C(43, [50, 59, 61, 62, 66]), C(45, [57, 62, 64, 69]),
          C(42, [57, 61, 64, 69]), C(40, [55, 59, 62, 66]), C(43, [57, 59, 62, 66]), C(45, [55, 62, 64, 67])]
    plan = Plan(66, A + B + A2)
    mix = Mix(plan.seconds, name='station_calm')
    N = mix.blank(); allc = list(range(24))
    I = lambda i: ramp(i, [(0, 0.45), (8, 0.55), (12, 0.68), (16, 0.55), (23, 0.45)])
    # strings
    s = ins.pad(pad_layer(plan, allc, I), N, voices=6, detune=9, kind='warm', attack=3.0, release=5.0, seed=1)
    cut = sec_curve(plan, N, [(0, 1300), (64, 1700), (100, 2600), (128, 1900), (192, 1300)])
    s = chorus(tone(s, cut, q=0.6), depth_ms=3.0, rate=0.2, mix=0.4, seed=2)
    mix.add('strings', s, -21, dry=0.75, hall=0.55)
    # low strings on the bass line
    lo = ins.pad(pad_layer(plan, allc, lambda i: 0.8 * I(i), which='bass'), N, voices=3, detune=6, kind='warm', attack=3.5, release=5.0, seed=3)
    mix.add('low strings', tone(lo, 700.0), -26, dry=0.8, hall=0.35)
    mix.add('sub', ins.sub([dict(n, m=sub_pitch(n['m'])) for n in drone(plan, allc, 0.6, octave=0)], N), -29, dry=1.0)
    # piano: sparse in A, fuller in B, motif in A'
    D = {2, 4, 6, 7, 9, 11, 1}
    cells = [[(0, 3), (3, 1), (4, 4)], [(0, 2), (2, 2), (4, 4)], [(1, 3), (4, 4)], [(0, 6)], [(0, 1.5), (1.5, 1.5), (3, 5)]]
    pn = melody(plan, list(range(2, 8)), D, 66, 83, cells, seed=4, vel=(0.32, 0.5), rest_prob=0.35)
    pn += melody(plan, list(range(8, 16)), D, 66, 86, cells, seed=5, vel=(0.4, 0.6))
    pn += melody(plan, list(range(16, 23)), D, 64, 83, cells, seed=4, vel=(0.35, 0.55), rest_prob=0.15)
    lh = [dict(t=plan.t(c['b0']) + 0.03, d=plan.t(6), m=c['bass'] + 12, v=0.3) for i, c in enumerate(plan.chords) if 8 <= i < 16]
    p = ins.piano(pn + lh, N, seed=6)
    p = filt(filt(p, 'lowshelf', 160, 0.7, -3), 'highshelf', 5000, 0.7, -2)
    mix.add('piano', p, -24, dry=0.7, hall=0.45, room=0.35)
    # gentle arpeggio in B
    ar = arpeggio(plan, list(range(8, 16)), 62, 81, step_beats=0.5, pattern='updown', vel=0.42, density=0.85, seed=7,
                  accent=(1.0, 0.6, 0.8, 0.6))
    a = ins.pluck(ar, N, seed=8, cut0=1900, cut1=320, fdecay=0.18, decay=0.8)
    a = pingpong(a, plan.t(0.75), fb=0.42, echoes=5, lp=2500, mix=0.4)
    mix.add('arp', a, -30, dry=0.6, hall=0.4)
    # glass bells at a few chord changes
    bl = [dict(t=plan.t(c['b0'] + 0.02), d=0.1, m=max(c['pad']) + 12, v=0.5) for i, c in enumerate(plan.chords) if i in (8, 10, 12, 14, 18, 21)]
    mix.add('bells', ins.bell(bl, N, decay=6.5, seed=9), -31, dry=0.4, hall=0.7, plate=0.3)
    mix.add('air', ins.wind(N, seed=10, center=sec_curve(plan, N, [(0, 500), (96, 900), (192, 500)]), q=1.2), -38, dry=0.8, hall=0.3)
    return mix, plan


# ================================================================================================ 2
def eva_earth():
    """«Над Землёй» — EVA awe: C lydian colours, big strings, choir, brass swells, octave piano."""
    ch = [C(36, [55, 59, 62, 64]), C(35, [55, 59, 62, 64]), C(33, [55, 59, 60, 64]), C(41, [57, 59, 60, 64]),
          C(40, [55, 60, 62, 67]), C(38, [57, 60, 64, 65]), C(41, [57, 60, 64, 67]), C(43, [60, 62, 64, 67]),
          C(33, [57, 59, 60, 64]), C(35, [55, 59, 62, 67]), C(36, [55, 59, 64, 67]), C(42, [57, 62, 66, 69]),
          C(40, [55, 59, 62, 66]), C(43, [55, 59, 62, 64]), C(38, [57, 62, 64, 66]), C(41, [57, 59, 64, 69]),
          C(33, [55, 59, 62, 64]), C(41, [57, 60, 64, 67]), C(43, [55, 57, 62, 67]), C(43, [55, 60, 62, 67])]
    plan = Plan(54, ch)
    mix = Mix(plan.seconds, name='eva_earth')
    N = mix.blank(); allc = list(range(len(ch)))
    I = lambda i: ramp(i, [(0, 0.42), (4, 0.55), (8, 0.7), (12, 0.85), (15, 0.8), (17, 0.55), (19, 0.42)])
    s = ins.pad(pad_layer(plan, allc, I, extra=lambda i, vs: [vs[-1] + 12] if 8 <= i <= 15 else []), N, voices=7, detune=10, kind='warm', attack=3.5, release=6.0, seed=21)
    cut = sec_curve(plan, N, [(0, 1500), (32, 1900), (64, 2600), (96, 3400), (128, 2800), (160, 1500)])
    s = chorus(tone(s, cut, q=0.6), depth_ms=3.5, rate=0.18, mix=0.45, seed=22)
    mix.add('strings', s, -20, dry=0.7, hall=0.6)
    lo = ins.pad(pad_layer(plan, allc, lambda i: 0.9 * I(i), which='bass'), N, voices=4, detune=6, kind='warm', attack=3.0, release=6.0, seed=23)
    mix.add('low strings', tone(lo, 650.0), -24, dry=0.8, hall=0.4)
    mix.add('sub', ins.sub([dict(n, m=sub_pitch(n['m'])) for n in drone(plan, allc, 0.6, octave=0)], N), -27, dry=1.0)
    chn = pad_layer(plan, list(range(4, 18)), lambda i: I(i) * 0.9, transpose=12, pan_spread=0.7)
    mix.add('choir', ins.choir(chn, N, seed=24, attack=4.0, release=6.0), -25, dry=0.45, hall=0.8)
    # brass swells: bass + fifth an octave up, filter opens with each swell
    br = [dict(t=plan.t(plan.chords[i]['b0']), d=plan.t(8), m=plan.chords[i]['bass'] + 12 + k, v=0.6) for i in (8, 11, 12, 15) for k in (0, 7)]
    b = ins.pad(br, N, voices=5, detune=7, kind='saw', attack=2.5, release=4.0, seed=25, spread=0.4)
    sw = np.full(N, 300.0)
    for i in (8, 11, 12, 15):
        sw = np.maximum(sw, ins.swell(N, plan.t(plan.chords[i]['b0']), plan.t(8), 300, 2200))
    mix.add('brass', sweep(b, sw, q=0.7), -27, dry=0.6, hall=0.6)
    tp = [dict(t=plan.t(plan.chords[i]['b0']), m=plan.chords[i]['bass'] + (12 if plan.chords[i]['bass'] < 38 else 0), v=v)
          for i, v in ((0, 0.45), (8, 0.8), (12, 0.9), (16, 0.5))]
    mix.add('timpani', ins.timpani(tp, N, seed=26), -27, dry=0.6, hall=0.7)
    # octave piano motif
    Cly = {0, 2, 4, 6, 7, 9, 11}
    cells = [[(0, 4), (4, 4)], [(0, 2), (2, 6)], [(0, 8)], [(0, 3), (3, 1), (4, 4)]]
    pn = melody(plan, list(range(4, 20)), Cly, 72, 88, cells, seed=27, vel=(0.45, 0.62), leap=0.25, motif_every=2)
    pn += [dict(n, m=n['m'] - 12, v=n['v'] * 0.55) for n in pn]
    p = ins.piano(pn, N, seed=28, bright=0.9)
    mix.add('piano', filt(p, 'lowshelf', 200, 0.7, -3), -25, dry=0.6, hall=0.6, room=0.2)
    sh = pad_layer(plan, list(range(12, 20)), 0.5, transpose=24)
    shs = ins.pad(sh, N, voices=4, detune=12, kind='tri', attack=4.0, release=6.0, seed=29, spread=1.0)
    mix.add('shimmer', chorus(shs, depth_ms=5, rate=0.3, mix=0.5), -33, dry=0.4, hall=0.9)
    bl = [dict(t=plan.t(plan.chords[i]['b0'] + 4), d=0.1, m=max(plan.chords[i]['pad']) + 12, v=0.5) for i in range(8, 20, 2)]
    mix.add('bells', ins.bell(bl, N, partials=ins.BELL_BOWL, decay=8.0, seed=30), -32, dry=0.4, hall=0.8)
    return mix, plan


# ================================================================================================ 3
def night_side():
    """«Ночная сторона» — eclipse melancholy: F# minor, piano over a pedal, glass, a cello line."""
    ch = [C(42, [57, 61, 64, 68]), C(38, [57, 61, 62, 66]), C(35, [54, 57, 61, 62]),
          C(37, [54, 56, 59, 61], split=[(4, [54, 56, 59, 61]), (4, [53, 56, 59, 61])]),
          C(42, [57, 61, 64, 68]), C(45, [56, 61, 64, 69]), C(44, [59, 64, 68, 71]), C(37, [56, 59, 64, 68]),
          C(38, [57, 61, 64, 66]), C(35, [57, 61, 64, 66]), C(45, [57, 61, 66, 69]), C(44, [56, 59, 62, 66]),
          C(37, [56, 59, 61, 65]), C(42, [57, 61, 64, 68]), C(38, [56, 57, 61, 66]), C(40, [54, 59, 64, 66]),
          C(38, [54, 59, 61, 62]), C(37, [54, 56, 59, 61], split=[(4, [54, 56, 59, 61]), (4, [53, 56, 59, 61])])]
    plan = Plan(50, ch)
    mix = Mix(plan.seconds, name='night_side')
    N = mix.blank(); allc = list(range(len(ch)))
    I = lambda i: ramp(i, [(0, 0.38), (6, 0.45), (10, 0.58), (14, 0.5), (17, 0.38)])
    s = ins.pad(pad_layer(plan, allc, I), N, voices=6, detune=8, kind='warm', attack=4.0, release=6.0, seed=31)
    s = chorus(tone(s, sec_curve(plan, N, [(0, 900), (80, 1500), (144, 900)]), q=0.6), depth_ms=3.0, rate=0.15, mix=0.4, seed=32)
    mix.add('strings', s, -23, dry=0.7, hall=0.6)
    # F# pedal under everything + soft roots
    ped = [dict(t=0.0, d=plan.seconds, m=30 + 12, v=0.5, a=6.0)]
    pd_ = ins.sub(ped, N, attack=6.0, release=6.0, h2=0.3)
    mix.add('pedal', pd_, -30, dry=1.0)
    mix.add('sub', ins.sub([dict(n, m=sub_pitch(n['m'])) for n in drone(plan, allc, 0.5, octave=0)], N), -30, dry=1.0)
    Fm = {6, 8, 9, 11, 1, 2, 4}
    cells = [[(0, 2), (2, 1), (3, 1), (4, 4)], [(0, 3), (3, 1), (4, 2), (6, 2)], [(0, 4), (4, 4)], [(1, 1), (2, 2), (4, 4)], [(0, 6), (6, 2)]]
    pn = melody(plan, allc, Fm, 61, 81, cells, seed=33, vel=(0.38, 0.58), leap=0.2, motif_every=2, rest_prob=0.12)
    lh = []
    for i, c in enumerate(plan.chords):
        lh.append(dict(t=plan.t(c['b0']) + 0.04, d=plan.t(7), m=c['bass'] + 12, v=0.28))
        lh.append(dict(t=plan.t(c['b0'] + 2) + 0.03, d=plan.t(5), m=c['bass'] + 19, v=0.2))
    p = ins.piano(pn + lh, N, seed=34, bright=0.8)
    p = filt(filt(p, 'lowshelf', 180, 0.7, -2), 'highshelf', 4500, 0.7, -3)
    mix.add('piano', p, -21, dry=0.72, hall=0.5, room=0.4)
    echo = [dict(n, t=n['t'] + plan.t(2), m=n['m'] + 12, v=n['v'] * 0.6, d=0.1) for n in pn if 9 * 8 * plan.spb <= n['t'] < 16 * 8 * plan.spb and n['v'] > 0.45]
    mix.add('glass', ins.bell(echo, N, decay=7.0, seed=35), -31, dry=0.35, hall=0.8, plate=0.3)
    # cello line in the middle section
    cl = []
    for i in range(8, 16):
        c = plan.chords[i]
        cl.append(dict(t=plan.t(c['b0']), d=plan.t(4), m=c['bass'] + 12, v=0.6))
        third = sorted(c['pad'])[0]
        cl.append(dict(t=plan.t(c['b0'] + 4), d=plan.t(4), m=third - 12 if third - 12 > c['bass'] + 2 else third, v=0.55))
    ce = ins.pad(cl, N, voices=2, detune=4, kind='saw', attack=0.9, release=2.5, vib=0.004, vib_rate=5.0, seed=36, spread=0.2)
    ce = filt(filt(sweep(ce, 1600.0, q=0.6), 'peak', 280, 1.0, 3), 'peak', 1100, 2.0, 2)
    mix.add('cello', ce, -27, dry=0.65, hall=0.55)
    mix.add('wind', ins.wind(N, seed=37, center=sec_curve(plan, N, [(0, 380), (72, 700), (144, 380)]), q=1.6, color='brown'), -36, dry=0.8, hall=0.3)
    return mix, plan


# ================================================================================================ 4
def sunrise():
    """«Терминатор» — sunrise swell: B-flat pedal, rising strings and choir, shimmering arpeggios."""
    ch = [C(34, [53, 58, 60, 65]), C(34, [57, 58, 62, 65]), C(34, [55, 57, 58, 62]), C(34, [53, 57, 60, 65]),
          C(34, [57, 60, 62, 65]), C(38, [57, 60, 62, 65]), C(39, [55, 58, 62, 65]), C(41, [58, 60, 65, 70], split=[(4, [58, 60, 65, 70]), (4, [57, 60, 65, 69])]),
          C(43, [57, 60, 62, 65]), C(39, [55, 58, 62, 67]), C(38, [58, 62, 65, 70]), C(36, [58, 62, 63, 67]),
          C(39, [58, 62, 65, 67, 70]), C(41, [57, 60, 67, 69]), C(43, [57, 58, 62, 67]), C(41, [58, 60, 65, 70])]
    plan = Plan(60, ch)
    mix = Mix(plan.seconds, name='sunrise')
    N = mix.blank(); allc = list(range(len(ch)))
    I = lambda i: ramp(i, [(0, 0.3), (4, 0.45), (8, 0.62), (12, 0.95), (13, 0.85), (15, 0.35)])
    s = ins.pad(pad_layer(plan, allc, I, extra=lambda i, vs: [vs[-1] + 12] if 9 <= i <= 14 else []), N, voices=7, detune=10, kind='warm', attack=3.0, release=5.5, seed=41)
    s = chorus(tone(s, sec_curve(plan, N, [(0, 1100), (64, 2000), (96, 4200), (112, 3200), (128, 1100)]), q=0.6), depth_ms=3.5, rate=0.2, mix=0.45, seed=42)
    mix.add('strings', s, -20, dry=0.7, hall=0.6)
    mix.add('sub', ins.sub([dict(n, m=sub_pitch(n['m'] + 12)) for n in drone(plan, allc, 0.6, octave=0)], N), -28, dry=1.0)
    chn = pad_layer(plan, list(range(6, 15)), lambda i: I(i), transpose=12, pan_spread=0.7)
    mix.add('choir', ins.choir(chn, N, seed=43), -24, dry=0.45, hall=0.8)
    ar = arpeggio(plan, list(range(4, 15)), 70, 94, step_beats=0.25, pattern='updown', seed=44,
                  vel_fn=lambda i, s: 0.25 + 0.4 * I(i), accent=(1.0, 0.55, 0.75, 0.55))
    a = ins.pluck(ar, N, seed=45, cut0=5200, cut1=900, fdecay=0.12, decay=0.5, kind_mix=0.2)
    a = pingpong(a, plan.t(0.75), fb=0.5, echoes=6, lp=4500, mix=0.45)
    mix.add('shimmer arp', a, -28, dry=0.5, hall=0.5, plate=0.3)
    Bb = {10, 0, 2, 3, 5, 7, 9}
    cells = [[(0, 4), (4, 4)], [(0, 6), (6, 2)], [(0, 2), (2, 6)]]
    pn = melody(plan, list(range(2, 13)), Bb, 72, 89, cells, seed=46, vel=(0.4, 0.6), motif_every=2)
    pn += [dict(n, m=n['m'] - 12, v=n['v'] * 0.5) for n in pn]
    mix.add('piano', filt(ins.piano(pn, N, seed=47), 'lowshelf', 200, 0.7, -3), -26, dry=0.6, hall=0.6, room=0.2)
    br = [dict(t=plan.t(plan.chords[i]['b0']), d=plan.t(8), m=plan.chords[i]['bass'] + 12 + k, v=0.6) for i in (10, 11, 12, 13) for k in (0, 7, 12)]
    sw = np.maximum.reduce([ins.swell(N, plan.t(plan.chords[i]['b0']), plan.t(8), 280, 2600) for i in (10, 12, 13)])
    mix.add('brass', sweep(ins.pad(br, N, voices=5, detune=7, kind='saw', attack=2.0, release=4.0, seed=48, spread=0.5), sw, q=0.7), -26, dry=0.6, hall=0.6)
    roll = []
    b0 = plan.chords[12]['b0']
    for k in range(32):
        roll.append(dict(t=plan.t(b0 - 8 + k * 0.25), m=46, v=0.08 + 0.5 * (k / 31) ** 2))
    roll.append(dict(t=plan.t(b0), m=46, v=0.95))
    mix.add('timpani', ins.timpani(roll, N, seed=49), -26, dry=0.6, hall=0.7)
    bl = [dict(t=plan.t(plan.chords[i]['b0'] + o), d=0.1, m=m, v=0.5) for i in (12, 13, 14) for o, m in ((0, 82), (2, 87), (4, 89))]
    mix.add('bells', ins.bell(bl, N, decay=6.0, seed=50), -30, dry=0.4, hall=0.8)
    return mix, plan


# ================================================================================================ 5
def docking():
    """«Сближение» — docking tension: A pedal ostinato, phrygian shadows, ticking, a heartbeat pulse."""
    cyc = [[57, 60, 64, 71], [58, 62, 64, 69], [57, 60, 64, 71], [53, 57, 60, 64],
           [55, 60, 62, 67], [55, 59, 62, 64], [58, 62, 64, 65], [56, 59, 62, 64]]
    ch = [C(33, cyc[k % 8]) for k in range(32)]
    plan = Plan(84, ch)
    mix = Mix(plan.seconds, name='docking')
    N = mix.blank(); allc = list(range(32))
    sec = lambda i: i // 8
    I = lambda i: (0.35, 0.48, 0.65, 0.38)[sec(i)]
    s = ins.pad(pad_layer(plan, allc, I), N, voices=6, detune=11, kind='saw', attack=2.5, release=4.0, seed=51)
    s = chorus(tone(s, sec_curve(plan, N, [(0, 800), (64, 1200), (128, 2200), (192, 1600), (256, 800)]), q=0.7), depth_ms=2.5, rate=0.3, mix=0.35, seed=52)
    mix.add('pad', s, -23, dry=0.75, hall=0.45)
    pat_a = [0, 0, 12, 0, 7, 0, 10, 0]
    pat_b = [0, 1, 12, 0, 7, 1, 10, 0]
    bn = []
    for i in allc:
        k = i % 8
        pat = pat_b if k in (1, 6) else pat_a
        v = (0.45, 0.6, 0.8, 0.5)[sec(i)]
        bn += ostinato(plan, [i], pat, step_beats=0.5, vel_fn=lambda ii, st, v=v: v * (1.0 if st % 4 == 0 else 0.72))
    bs = ins.bass([dict(n, m=n['m'] + 12) for n in bn], N, seed=53, cut=300, env_amt=1100, decay=0.18)
    mix.add('bass', bs, -23, dry=0.95, hall=0.1)
    mix.add('sub', ins.sub([dict(t=0.0, d=plan.seconds, m=33, v=0.5)], N, attack=5, release=5), -30, dry=1.0)
    ht, hv = [], []
    for i in range(8, 24):
        b0 = plan.chords[i]['b0']
        for s16 in range(32):
            if s16 % 2 == 1 or s16 % 8 == 0:
                ht.append(plan.t(b0 + s16 * 0.25)); hv.append((1.0 if s16 % 4 == 2 else 0.55) * (0.7 if i < 16 else 1.0))
    mix.add('ticks', ins.hat(ht, N, vel=hv, seed=54, hp=8000, decay=0.018), -34, dry=0.8, hall=0.2, plate=0.15)
    kt, kv = [], []
    for i in range(12, 24):
        b0 = plan.chords[i]['b0']
        for bar in range(2):
            if i < 16 and bar == 1:
                continue
            kt += [plan.t(b0 + bar * 4), plan.t(b0 + bar * 4 + 0.75)]
            kv += [0.9, 0.55]
    mix.add('pulse', ins.kick(kt, N, vel=kv, f_hi=90, f_lo=42, decay=0.35), -26, dry=0.9, hall=0.15)
    cl = [dict(t=plan.t(plan.chords[i]['b0']), d=plan.t(16), m=m, v=0.5, a=5.0) for i in (16, 20) for m in (69, 70, 76)]
    cs = ins.pad(cl, N, voices=5, detune=6, kind='warm', attack=5.0, release=5.0, seed=55, vib=0.002)
    mix.add('cluster', tone(cs, 2400.0), -29, dry=0.5, hall=0.7)
    ar = arpeggio(plan, list(range(8, 24)), 57, 81, step_beats=0.25, pattern='random', seed=56, density=0.6,
                  vel_fn=lambda i, s: 0.3 if i < 16 else 0.42)
    a = pingpong(ins.pluck(ar, N, seed=57, cut0=2400, cut1=300, fdecay=0.08, decay=0.35), plan.t(0.75), fb=0.4, echoes=4, lp=2400, mix=0.35)
    mix.add('arp', a, -30, dry=0.65, hall=0.35)
    pings = [dict(t=plan.t(b), d=0.1, m=81, v=0.6, decay=5.0) for b in range(0, 256, 16)]
    mix.add('ping', ins.bell(pings, N, partials=ins.BELL_TUBE, decay=5.0, seed=58), -33, dry=0.4, hall=0.6, plate=0.4)
    return mix, plan


# ================================================================================================ 6
def deep_space():
    """«Глубина» — telescope / deep-space wonder: E lydian, shimmer, harp-like plucks, glass melody."""
    ch = [C(40, [59, 63, 66, 68], 12), C(37, [56, 59, 63, 66], 12), C(45, [56, 61, 63, 64], 12), C(35, [56, 59, 64, 66], 12),
          C(44, [59, 63, 64, 71], 12), C(42, [57, 61, 64, 68], 12), C(45, [59, 61, 64, 68], 12), C(47, [59, 61, 66, 71], 12),
          C(40, [58, 63, 66, 68], 12), C(43, [59, 61, 62, 66], 12), C(37, [56, 59, 63, 64], 12), C(45, [56, 61, 63, 64], 12),
          C(42, [57, 59, 64, 66], 12), C(35, [59, 64, 66, 71], 12), C(47, [59, 61, 63, 66], 12)]
    plan = Plan(60, ch)
    mix = Mix(plan.seconds, name='deep_space')
    N = mix.blank(); allc = list(range(len(ch)))
    I = lambda i: ramp(i, [(0, 0.4), (5, 0.55), (9, 0.65), (12, 0.5), (14, 0.4)])
    s = ins.pad(pad_layer(plan, allc, I), N, voices=6, detune=8, kind='warm', attack=4.0, release=6.0, seed=61)
    s = chorus(tone(s, sec_curve(plan, N, [(0, 1400), (90, 2200), (180, 1400)]), q=0.6), depth_ms=3.5, rate=0.17, mix=0.45, seed=62)
    mix.add('pad', s, -22, dry=0.7, hall=0.6)
    sh = ins.pad(pad_layer(plan, allc, lambda i: 0.6 * I(i), transpose=12), N, voices=6, detune=13, kind='tri', attack=5.0, release=7.0, seed=63, spread=1.0)
    mix.add('shimmer', chorus(sh, depth_ms=6, rate=0.35, mix=0.5, seed=64), -27, dry=0.4, hall=0.9)
    mix.add('sub', ins.sub([dict(n, m=sub_pitch(n['m'])) for n in drone(plan, allc, 0.6, octave=0)], N), -29, dry=1.0)
    ar = arpeggio(plan, allc, 64, 88, step_beats=0.5, pattern='random', seed=65, density=0.5, vel_fn=lambda i, s: 0.28 + 0.2 * I(i))
    a = ins.pluck(ar, N, seed=66, cut0=4200, cut1=700, fdecay=0.25, decay=1.5, kind_mix=0.15, q=0.8)
    a = pingpong(a, plan.t(0.75), fb=0.5, echoes=6, lp=3500, mix=0.45)
    mix.add('harp', a, -27, dry=0.55, hall=0.6, plate=0.2)
    E = {4, 6, 8, 10, 11, 1, 3}
    cells = [[(0, 6), (6, 6)], [(0, 4), (4, 8)], [(2, 10)], [(0, 3), (3, 3), (6, 6)]]
    gl = melody(plan, allc, E, 76, 93, cells, seed=67, vel=(0.4, 0.6), rest_prob=0.3, leap=0.3)
    mix.add('glass', ins.bell([dict(n, d=0.1, decay=8.0) for n in gl], N, decay=8.0, seed=68), -27, dry=0.4, hall=0.8, plate=0.3)
    chn = pad_layer(plan, list(range(5, 12)), lambda i: I(i), transpose=0, pan_spread=0.8)
    mix.add('choir', ins.choir(chn, N, seed=69, attack=5.0, release=7.0), -28, dry=0.4, hall=0.9)
    mix.add('stars', ins.wind(N, seed=70, center=sec_curve(plan, N, [(0, 2500), (90, 4200), (180, 2500)]), q=2.5), -40, dry=0.6, hall=0.6)
    return mix, plan


# ================================================================================================ 7
def flight():
    """«Импульс» — launch / flight drive: D dorian, pulsing arpeggio, ostinato bass, steady kick."""
    cyc = [C(38, [57, 60, 64, 65]), C(38, [55, 58, 62, 65]), C(34, [57, 62, 64, 65]), C(33, [57, 60, 64, 67]),
           C(38, [57, 60, 64, 65]), C(41, [57, 60, 64, 69]), C(39, [55, 58, 62, 69]),
           C(33, [57, 62, 64, 69], split=[(4, [57, 62, 64, 69]), (4, [57, 61, 64, 69])])]
    ch = [dict(cyc[k % 8]) for k in range(36)]
    plan = Plan(96, ch)
    mix = Mix(plan.seconds, name='flight')
    N = mix.blank(); allc = list(range(36))
    part = lambda i: 0 if i < 8 else 1 if i < 16 else 2 if i < 28 else 3
    I = lambda i: (0.4, 0.55, 0.75, 0.42)[part(i)]
    s = ins.pad(pad_layer(plan, allc, I), N, voices=6, detune=10, kind='saw', attack=1.8, release=3.5, seed=71)
    cut = sec_curve(plan, N, [(0, 900), (64, 1500), (128, 3200), (224, 2800), (240, 1300), (288, 900)])
    s = tone(s, cut, q=0.65)
    # pump: gentle sidechain feel on quarters in the drive section
    t = np.arange(N) / SR
    beat = (t / plan.spb) % 1.0
    depth = sec_curve(plan, N, [(0, 0.0), (120, 0.0), (128, 0.35), (224, 0.35), (232, 0.0), (288, 0.0)])
    s = s * (1 - depth * np.exp(-beat * 6.0))
    s = chorus(s, depth_ms=3, rate=0.25, mix=0.35, seed=72)
    mix.add('pad', s, -22, dry=0.75, hall=0.45)
    acut = sec_curve(plan, N, [(0, 1200), (64, 1800), (128, 3600), (200, 4500), (224, 3000), (288, 1200)])
    ar = arpeggio(plan, allc, 57, 84, step_beats=0.25, pattern='updown', seed=73, vel_fn=lambda i, s: (0.38, 0.5, 0.62, 0.4)[part(i)],
                  accent=(1.0, 0.6, 0.8, 0.6))
    for n_ in ar:
        n_['cut'] = float(acut[min(N - 1, int(n_['t'] * SR))])
    a = ins.pluck(ar, N, seed=74, cut1=350, fdecay=0.14, decay=0.42)
    a = pingpong(a, plan.t(0.75), fb=0.42, echoes=5, lp=3200, mix=0.35)
    mix.add('arp', a, -25, dry=0.7, hall=0.35)
    bn = ostinato(plan, list(range(8, 28)), [0, 0, 12, 0, 0, 12, 0, 7], step_beats=0.5, vel_fn=lambda i, st: (0.6 if i < 16 else 0.8) * (1 if st % 2 == 0 else 0.7))
    mix.add('bass', ins.bass([dict(n, m=n['m'] + 12) for n in bn], N, seed=75, cut=260, env_amt=1300, decay=0.16), -23, dry=0.95, hall=0.08)
    kt, kv = [], []
    for i in range(8, 28):
        b0 = plan.chords[i]['b0']
        for q in range(8):
            if i < 16 and q % 2 == 1:
                continue
            kt.append(plan.t(b0 + q)); kv.append(0.9 if q % 4 == 0 else 0.75)
    mix.add('kick', ins.kick(kt, N, vel=kv, f_hi=120, f_lo=46, decay=0.38), -24, dry=0.95, hall=0.12)
    ht, hv = [], []
    for i in range(16, 28):
        b0 = plan.chords[i]['b0']
        for s16 in range(32):
            if s16 % 4 == 2:
                ht.append(plan.t(b0 + s16 * 0.25)); hv.append(1.0)
            elif s16 % 2 == 1:
                ht.append(plan.t(b0 + s16 * 0.25)); hv.append(0.35)
    mix.add('hats', ins.hat(ht, N, vel=hv, seed=76, hp=7500, decay=0.025), -32, dry=0.85, hall=0.15)
    st = ins.pad(pad_layer(plan, list(range(16, 28)), 0.65, transpose=12, pan_spread=0.8), N, voices=7, detune=10, kind='warm', attack=2.5, release=4.0, seed=77)
    mix.add('strings', chorus(tone(st, 3000.0), depth_ms=3.5, rate=0.2, mix=0.45, seed=78), -25, dry=0.65, hall=0.55)
    Dd = {2, 4, 5, 7, 9, 11, 0}
    cells = [[(0, 3), (3, 1), (4, 4)], [(0, 2), (2, 2), (4, 4)], [(0, 4), (4, 2), (6, 2)]]
    pn = melody(plan, list(range(0, 8)) + list(range(28, 36)), Dd, 69, 86, cells, seed=79, vel=(0.4, 0.6), rest_prob=0.2)
    mix.add('piano', filt(ins.piano(pn, N, seed=80), 'lowshelf', 200, 0.7, -3), -26, dry=0.65, hall=0.5, room=0.3)
    mix.add('sub', ins.sub([dict(n, m=sub_pitch(n['m'])) for n in drone(plan, allc, 0.6, octave=0)], N, attack=1.5, release=3.0), -28, dry=1.0)
    tp = [dict(t=plan.t(plan.chords[i]['b0']), m=38, v=0.85) for i in (16, 24)]
    mix.add('boom', ins.timpani(tp, N, seed=81), -27, dry=0.6, hall=0.7)
    return mix, plan


# ================================================================================================ 8
def lunar():
    """«Селена» — lunar orbit: C-sharp aeolian/phrygian, cold wide pads, a distant lead, glass."""
    ch = [C(37, [56, 63, 64, 68]), C(37, [57, 62, 66, 68]), C(37, [56, 61, 64, 68]), C(37, [54, 59, 61, 66]),
          C(33, [56, 61, 63, 64]), C(44, [54, 59, 63, 66]), C(42, [56, 57, 61, 64]),
          C(44, [56, 61, 63, 68], split=[(4, [56, 61, 63, 68]), (4, [56, 60, 63, 68])]),
          C(37, [56, 59, 63, 64]), C(33, [56, 59, 61, 64]), C(35, [56, 59, 63, 64]), C(42, [57, 59, 64, 66]),
          C(38, [56, 61, 62, 66]), C(37, [56, 63, 64, 68]), C(35, [54, 59, 61, 66]), C(33, [56, 61, 64, 68]),
          C(42, [57, 61, 64, 68]), C(44, [54, 56, 61, 63], split=[(4, [54, 56, 61, 63]), (4, [54, 56, 60, 63])])]
    plan = Plan(48, ch)
    mix = Mix(plan.seconds, name='lunar')
    N = mix.blank(); allc = list(range(len(ch)))
    I = lambda i: ramp(i, [(0, 0.38), (8, 0.52), (12, 0.6), (15, 0.45), (17, 0.38)])
    s = ins.pad(pad_layer(plan, allc, I), N, voices=6, detune=7, kind='tri', attack=5.0, release=7.0, seed=81, spread=0.9)
    s = chorus(tone(s, 2600.0, q=0.6), depth_ms=5, rate=0.12, mix=0.5, seed=82)
    mix.add('cold pad', s, -22, dry=0.65, hall=0.7)
    w = ins.pad(pad_layer(plan, allc, lambda i: 0.8 * I(i), transpose=-12), N, voices=4, detune=6, kind='warm', attack=4.0, release=6.0, seed=83)
    mix.add('low pad', tone(w, 800.0), -26, dry=0.8, hall=0.4)
    mix.add('sub', ins.sub([dict(n, m=sub_pitch(n['m'])) for n in drone(plan, allc, 0.6, octave=0)], N, attack=5.0, release=6.0), -29, dry=1.0)
    Cs = {1, 3, 4, 6, 8, 9, 11}
    cells = [[(0, 4), (4, 4)], [(0, 6), (6, 2)], [(2, 6)], [(0, 3), (3, 5)]]
    ld = melody(plan, list(range(2, 16)), Cs, 64, 81, cells, seed=84, vel=(0.5, 0.7), rest_prob=0.3, leap=0.22)
    l = ins.lead(ld, N, seed=85, vib=0.005, attack=0.6, release=2.0)
    l = pingpong(l, plan.t(0.75), fb=0.45, echoes=5, lp=2800, mix=0.4)
    mix.add('lead', l, -26, dry=0.5, hall=0.75)
    gl = arpeggio(plan, allc, 75, 96, step_beats=1.0, pattern='random', seed=86, density=0.25, vel_fn=lambda i, s: 0.45)
    mix.add('glass', ins.bell([dict(n, d=0.1) for n in gl], N, decay=7.0, seed=87), -30, dry=0.4, hall=0.8, plate=0.3)
    mix.add('wind', ins.wind(N, seed=88, center=sec_curve(plan, N, [(0, 320), (72, 650), (144, 320)]), q=1.3, color='brown'), -36, dry=0.8, hall=0.4)
    return mix, plan


# ================================================================================================ stingers
def sting_sunrise():
    plan = Plan(60, [C(34, [53, 58, 60, 65], 4), C(34, [55, 58, 62, 65, 70], 8), C(34, [58, 60, 62, 65, 69, 72], 10)])
    mix = Mix(plan.seconds + 8, loop=False, name='sting_sunrise'); N = mix.blank()
    s = ins.pad(pad_layer(plan, [0, 1, 2], lambda i: (0.4, 0.75, 0.6)[i]), N, voices=7, detune=10, kind='warm', attack=2.5, release=7.0, seed=91)
    s = chorus(tone(s, curve([(0, 900), (6, 3800), (14, 2600), (30, 1200)], N), q=0.6), mix=0.45, seed=92)
    mix.add('strings', s, -20, dry=0.7, hall=0.6)
    mix.add('choir', ins.choir(pad_layer(plan, [1, 2], 0.7, transpose=12), N, seed=93, attack=2.5, release=7.0), -25, dry=0.45, hall=0.8)
    mix.add('bells', ins.bell([dict(t=plan.t(4 + o), d=0.1, m=m, v=0.5) for o, m in ((0, 82), (1.5, 86), (3, 89), (6, 94))], N, decay=7.0, seed=94), -29, dry=0.4, hall=0.8)
    mix.add('timpani', ins.timpani([dict(t=plan.t(4), m=46, v=0.8)], N, seed=95), -27, dry=0.6, hall=0.7)
    mix.add('sub', ins.sub([dict(t=0.0, d=plan.seconds, m=34, v=0.5)], N, attack=2.0, release=6.0), -29)
    return mix, plan


def sting_capture():
    plan = Plan(60, [C(33, [57, 60, 64, 71], 4), C(41, [57, 60, 64, 71], 4), C(36, [55, 59, 62, 64, 67], 8)])
    mix = Mix(plan.seconds + 7, loop=False, name='sting_capture'); N = mix.blank()
    s = ins.pad(pad_layer(plan, [0, 1, 2], (0.5)), N, voices=6, detune=9, kind='warm', attack=1.5, release=6.0, seed=101)
    mix.add('pad', chorus(tone(s, curve([(0, 1200), (8, 2800), (20, 1400)], N), q=0.6), mix=0.4, seed=102), -21, dry=0.7, hall=0.6)
    mix.add('boom', ins.timpani([dict(t=0.05, m=45, v=0.7)], N, seed=103), -26, dry=0.6, hall=0.6)
    mix.add('bells', ins.bell([dict(t=plan.t(8 + o), d=0.1, m=m, v=0.55) for o, m in ((0, 79), (0.5, 84), (1.0, 88))], N, partials=ins.BELL_TUBE, decay=6.0, seed=104), -28, dry=0.4, hall=0.8, plate=0.3)
    mix.add('sub', ins.sub([dict(t=0.0, d=plan.seconds, m=36, v=0.5)], N, attack=1.0, release=5.0), -30)
    return mix, plan


def sting_wonder():
    plan = Plan(54, [C(40, [59, 63, 66, 68], 8), C(40, [59, 62, 66, 71], 8), C(40, [58, 63, 66, 68, 75], 12)])
    mix = Mix(plan.seconds + 9, loop=False, name='sting_wonder'); N = mix.blank()
    s = ins.pad(pad_layer(plan, [0, 1, 2], lambda i: (0.4, 0.6, 0.75)[i]), N, voices=6, detune=9, kind='warm', attack=4.0, release=8.0, seed=111)
    mix.add('pad', chorus(tone(s, curve([(0, 900), (20, 3200), (40, 1500)], N), q=0.6), mix=0.45, seed=112), -21, dry=0.7, hall=0.7)
    sh = ins.pad(pad_layer(plan, [1, 2], 0.6, transpose=24), N, voices=5, detune=14, kind='tri', attack=6.0, release=8.0, seed=113, spread=1.0)
    mix.add('shimmer', chorus(sh, depth_ms=6, rate=0.35, mix=0.5), -26, dry=0.4, hall=0.9)
    mix.add('choir', ins.choir(pad_layer(plan, [1, 2], 0.7, transpose=12), N, seed=114, attack=5.0, release=8.0), -25, dry=0.4, hall=0.9)
    gl = [dict(t=plan.t(8 + k * 1.5), d=0.1, m=m, v=0.45) for k, m in enumerate([83, 87, 90, 94, 92, 87, 95, 99])]
    mix.add('glass', ins.bell(gl, N, decay=8.0, seed=115), -28, dry=0.4, hall=0.8, plate=0.3)
    mix.add('sub', ins.sub([dict(t=0.0, d=plan.seconds, m=40, v=0.5)], N, attack=5.0, release=7.0), -29)
    return mix, plan


TRACKS = {
    'station_calm': (station_calm, dict(title='Тихий ход', mood='station', loop=True)),
    'eva_earth': (eva_earth, dict(title='Над Землёй', mood='eva', loop=True)),
    'night_side': (night_side, dict(title='Ночная сторона', mood='night', loop=True)),
    'sunrise': (sunrise, dict(title='Терминатор', mood='sunrise', loop=True)),
    'docking': (docking, dict(title='Сближение', mood='docking', loop=True)),
    'deep_space': (deep_space, dict(title='Глубина', mood='deep', loop=True)),
    'flight': (flight, dict(title='Импульс', mood='flight', loop=True)),
    'lunar': (lunar, dict(title='Селена', mood='lunar', loop=True)),
    'sting_sunrise': (sting_sunrise, dict(title='Восход', mood='sting', loop=False, fade=4.0)),
    'sting_capture': (sting_capture, dict(title='Захват', mood='sting', loop=False, fade=3.0)),
    'sting_wonder': (sting_wonder, dict(title='Чудо', mood='sting', loop=False, fade=4.0)),
}
