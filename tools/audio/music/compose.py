"""
Composition helpers: a chord timeline (harmonic plan) and generators for pad voicings, melodies,
arpeggios and drones. All material is original; progressions are written per track in tracks.py.
"""
import numpy as np


class Plan:
    """Chord timeline. chords: list of dicts {bass: midi, pad: [midi...], beats: n, name: str}.
    A chord may carry `split`: [(beats, pad), ...] to change the upper structure inside the chord."""

    def __init__(self, bpm, chords, beats_per_bar=4):
        self.bpm = bpm
        self.spb = 60.0 / bpm
        self.bpb = beats_per_bar
        self.chords = chords
        b = 0.0
        for c in chords:
            c.setdefault('beats', 8)
            c['b0'] = b
            b += c['beats']
        self.beats = b
        self.seconds = b * self.spb

    def t(self, beat):
        return beat * self.spb

    def at(self, beat):
        """Chord index sounding at a beat (wraps)."""
        beat = beat % self.beats
        for i, c in enumerate(self.chords):
            if c['b0'] <= beat < c['b0'] + c['beats']:
                return i
        return len(self.chords) - 1

    def pcs(self, i, bass=True):
        c = self.chords[i % len(self.chords)]
        s = set(int(round(m)) % 12 for m in c['pad'])
        if bass:
            s.add(int(round(c['bass'])) % 12)
        return s


def tied(notes):
    """Merge consecutive notes of equal pitch that touch (common tones held across chord changes)."""
    by_pitch = {}
    for n in sorted(notes, key=lambda x: (x['m'], x['t'])):
        lst = by_pitch.setdefault(n['m'], [])
        if lst and abs(lst[-1]['t'] + lst[-1]['d'] - n['t']) < 1e-6:
            lst[-1]['d'] += n['d']
            lst[-1]['v'] = max(lst[-1]['v'], n['v'])
        else:
            lst.append(dict(n))
    out = [n for lst in by_pitch.values() for n in lst]
    return sorted(out, key=lambda x: x['t'])


def pad_layer(plan, idx, vel, transpose=0, which='pad', tie=True, pan_spread=0.5, extra=None):
    """Notes for the pad voicings of the chords in idx (list of chord indices). vel: f(chord index) or float."""
    notes = []
    for i in idx:
        c = plan.chords[i]
        v = vel(i) if callable(vel) else vel
        if v <= 0:
            continue
        parts = c.get('split') if which == 'pad' and c.get('split') else [(c['beats'], c[which] if which != 'bass' else [c['bass']])]
        b = c['b0']
        for beats, voicing in parts:
            vs = list(voicing) if isinstance(voicing, (list, tuple)) else [voicing]
            if extra:
                vs = vs + extra(i, vs)
            for k, m in enumerate(vs):
                p = (k / max(1, len(vs) - 1) * 2 - 1) * pan_spread if len(vs) > 1 else 0.0
                notes.append(dict(t=plan.t(b), d=plan.t(beats), m=m + transpose, v=v, pan=p))
            b += beats
    return tied(notes) if tie else notes


def scale_notes(pcs, lo, hi):
    return [m for m in range(lo, hi + 1) if m % 12 in pcs]


def melody(plan, idx, scale_pcs, lo, hi, cells, seed=0, vel=(0.45, 0.7), start=None, leap=0.18,
           motif_every=2, rest_prob=0.0, swing=0.0, humanize=0.012):
    """Stepwise melody over chords idx. cells: list of rhythm cells [(beat_offset, dur_beats), ...] per chord.
    The first `motif_every` chords define a motif (intervals + cells) that is re-used (re-harmonised)
    on later chords, so phrases repeat and vary instead of wandering."""
    rng = np.random.default_rng(seed)
    sc0 = scale_notes(scale_pcs, lo, hi)
    cur = start if start is not None else sc0[len(sc0) // 2]
    notes = []
    motif = []
    for j, i in enumerate(idx):
        c = plan.chords[i]
        chord_pcs = plan.pcs(i)
        # chord tones outside the scale (e.g. a raised leading tone) replace the scale tones a semitone away
        foreign = {q for q in chord_pcs if q not in scale_pcs}
        bad = {p for p in scale_pcs if any((p - q) % 12 in (1, 11) for q in foreign)}
        sc = scale_notes((set(scale_pcs) - bad) | foreign, lo, hi)
        if rest_prob and rng.random() < rest_prob:
            continue
        reuse = motif and j >= motif_every and (j % (motif_every * 2) >= motif_every)
        if reuse:
            src = motif[j % len(motif)]
            cell, steps = src
        else:
            cell = cells[rng.integers(len(cells))]
            steps = []
            for _ in cell:
                r = rng.random()
                if r < leap:
                    s = int(rng.choice([-4, -3, 3, 4, 5]))
                else:
                    s = int(rng.choice([-2, -1, -1, 1, 1, 2]))
                steps.append(s)
            if j < motif_every:
                motif.append((cell, steps))
        for k, ((off, dur), s) in enumerate(zip(cell, steps)):
            if off >= c['beats']:
                continue
            # move s scale steps from cur
            pos = min(range(len(sc)), key=lambda q: abs(sc[q] - cur))
            pos = pos + s
            if pos < 0 or pos >= len(sc):
                pos = pos - 2 * s
            pos = int(np.clip(pos, 0, len(sc) - 1))
            m = sc[pos]
            # strong beats land on chord tones
            if off % 4 == 0 or k == 0:
                cands = [x for x in sc if x % 12 in chord_pcs]
                if cands:
                    m = min(cands, key=lambda x: (abs(x - m), x))
            cur = m
            v = rng.uniform(*vel) * (1.0 if k == 0 else 0.85)
            t = plan.t(c['b0'] + off + (swing if (off * 2) % 2 == 1 else 0)) + rng.normal(0, humanize)
            notes.append(dict(t=max(0.0, t), d=plan.t(min(dur, c['beats'] - off)), m=m, v=v))
    return notes


def arpeggio(plan, idx, lo, hi, step_beats=0.25, pattern='updown', vel=0.6, accent=(1.0, 0.7, 0.85, 0.7),
             gate=0.8, seed=0, octaves=2, density=1.0, vel_fn=None):
    """Arpeggio over chord tones of each chord (pad voicing pcs) in the register lo..hi."""
    rng = np.random.default_rng(seed)
    notes = []
    for i in idx:
        c = plan.chords[i]
        pcs = sorted(set(int(round(m)) % 12 for m in c['pad']))
        tones = [m for m in range(lo, hi + 1) if m % 12 in pcs]
        if not tones:
            continue
        if pattern == 'up':
            seq = tones
        elif pattern == 'down':
            seq = tones[::-1]
        elif pattern == 'updown':
            seq = tones + tones[-2:0:-1]
        else:
            seq = None
        steps = int(round(c['beats'] / step_beats))
        for s in range(steps):
            if density < 1 and rng.random() > density:
                continue
            m = seq[s % len(seq)] if seq else tones[rng.integers(len(tones))]
            v = (vel_fn(i, s) if vel_fn else vel) * accent[s % len(accent)]
            if v <= 0:
                continue
            notes.append(dict(t=plan.t(c['b0'] + s * step_beats), d=plan.t(step_beats * gate), m=m, v=v,
                              pan=float(np.clip((m - (lo + hi) / 2) / ((hi - lo) / 2 + 1e-9), -1, 1) * 0.6)))
    return notes


def ostinato(plan, idx, pattern, step_beats=0.5, vel=0.7, seed=0, vel_fn=None):
    """Bass ostinato: pattern is a list of semitone offsets from the chord bass (None = rest)."""
    notes = []
    for i in idx:
        c = plan.chords[i]
        steps = int(round(c['beats'] / step_beats))
        for s in range(steps):
            off = pattern[s % len(pattern)]
            if off is None:
                continue
            v = vel_fn(i, s) if vel_fn else vel
            if v <= 0:
                continue
            notes.append(dict(t=plan.t(c['b0'] + s * step_beats), d=plan.t(step_beats * 0.8), m=c['bass'] + off, v=v))
    return notes


def drone(plan, idx, vel, octave=-12, hold_same=True):
    """Bass drone on chord roots (tied when the bass repeats)."""
    notes = []
    for i in idx:
        c = plan.chords[i]
        v = vel(i) if callable(vel) else vel
        if v <= 0:
            continue
        notes.append(dict(t=plan.t(c['b0']), d=plan.t(c['beats']), m=c['bass'] + octave, v=v))
    return tied(notes) if hold_same else notes
