"""
DSP building blocks for the offline music renderer (numpy / scipy, float32/float64 arrays at SR).

Everything that runs over a whole track is "circular": the tracks are seamless loops, so recursive
filters are primed with the wrapped end of the signal (`circ_filter`) and convolution tails are folded
back onto the start (`fold`).
"""
import numpy as np
from scipy import signal as sps
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 48000
TWO_PI = 2 * np.pi


def midi_hz(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=np.float64) - 69.0) / 12.0)


# ----------------------------------------------------------------------------------------------- tables
_TABLES = {}
TABLE_SIZE = 4096


def table(kind, nharm):
    """Single-cycle band-limited wavetable (peak ~1). kind: saw | square | tri | sine | warm."""
    nharm = int(max(1, min(nharm, TABLE_SIZE // 2 - 1)))
    key = (kind, nharm)
    if key in _TABLES:
        return _TABLES[key]
    k = np.arange(1, nharm + 1)
    amp = np.zeros(nharm)
    if kind == 'saw':
        amp = 1.0 / k
    elif kind == 'square':
        amp = np.where(k % 2 == 1, 1.0 / k, 0.0)
    elif kind == 'tri':
        amp = np.where(k % 2 == 1, ((-1.0) ** ((k - 1) // 2)) / (k * k), 0.0)
    elif kind == 'warm':
        # saw with a soft roll-off (string-machine like): 1/k^1.1
        amp = 1.0 / k ** 1.1
    elif kind == 'sine':
        amp = np.zeros(nharm); amp[0] = 1
    # Lanczos sigma factors against Gibbs ringing
    sigma = np.sinc(k / (nharm + 1))
    spec = np.zeros(TABLE_SIZE // 2 + 1, dtype=np.complex128)
    spec[1:nharm + 1] = -1j * amp * sigma * TABLE_SIZE / 2
    t = np.fft.irfft(spec, TABLE_SIZE)
    t /= np.max(np.abs(t)) + 1e-12
    t = np.append(t, t[0]).astype(np.float64)   # guard sample for interpolation
    _TABLES[key] = t
    return t


def nharm_for(f0, limit=64):
    return int(max(1, min(limit, 0.44 * SR / max(f0, 1.0))))


def osc(tab, freq, n, phase0=0.0):
    """Wavetable oscillator. freq: scalar or per-sample array (Hz). Returns n samples."""
    if np.isscalar(freq):
        ph = phase0 + np.arange(n) * (freq / SR)
    else:
        ph = phase0 + np.cumsum(freq) / SR
    ph = ph - np.floor(ph)
    idx = ph * TABLE_SIZE
    i0 = idx.astype(np.int64)
    fr = idx - i0
    return tab[i0] * (1 - fr) + tab[i0 + 1] * fr


def drift(n, rate=0.15, depth=1.0, seed=0):
    """Smooth random modulation in [-depth, depth] (sum of slow sines with random phases/rates)."""
    rng = np.random.default_rng(seed)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for _ in range(3):
        r = rate * rng.uniform(0.5, 1.6)
        out += np.sin(TWO_PI * r * t + rng.uniform(0, TWO_PI))
    return out * (depth / 3.0)


# ----------------------------------------------------------------------------------------------- envelopes
def env_ar(n, attack, release, total=None, curve=2.0):
    """Attack (raised sine) -> hold -> release (exponential-ish) envelope over n samples."""
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    e = np.ones(n)
    a = min(a, n)
    e[:a] = np.sin(0.5 * np.pi * np.arange(a) / a) ** curve
    if r < n:
        x = np.arange(r) / r
        rel = (1 - x) ** 2.2
        e[n - r:] *= rel
    else:
        e *= (1 - np.arange(n) / n) ** 2.2
    return e


def curve(points, n, beat_to_s=None, kind='smooth'):
    """Automation curve from breakpoints [(time_s, value), ...] over n samples; smooth (cosine) interpolation."""
    pts = sorted(points)
    ts = np.array([p[0] for p in pts], dtype=np.float64) * SR
    vs = np.array([p[1] for p in pts], dtype=np.float64)
    x = np.arange(n, dtype=np.float64)
    if kind == 'linear' or len(pts) < 2:
        return np.interp(x, ts, vs)
    # cosine interpolation between breakpoints
    j = np.clip(np.searchsorted(ts, x, side='right') - 1, 0, len(ts) - 2)
    t0, t1 = ts[j], ts[j + 1]
    u = np.clip((x - t0) / np.maximum(t1 - t0, 1), 0, 1)
    u = 0.5 - 0.5 * np.cos(np.pi * u)
    return vs[j] + (vs[j + 1] - vs[j]) * u


# ----------------------------------------------------------------------------------------------- filters
def biquad(kind, f, q=0.707, gain_db=0.0):
    """RBJ cookbook biquad -> (b, a)."""
    f = float(np.clip(f, 10, SR * 0.49))
    w = TWO_PI * f / SR
    cw, sw = np.cos(w), np.sin(w)
    alpha = sw / (2 * q)
    A = 10 ** (gain_db / 40)
    if kind == 'lp':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'hp':
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'bp':
        b = [alpha, 0, -alpha]; a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'peak':
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]; a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind == 'lowshelf':
        sa = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) - (A - 1) * cw + sa), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - sa)]
        a = [(A + 1) + (A - 1) * cw + sa, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - sa]
    elif kind == 'highshelf':
        sa = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * cw + sa), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - sa)]
        a = [(A + 1) - (A - 1) * cw + sa, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - sa]
    else:
        raise ValueError(kind)
    b = np.array(b) / a[0]; a = np.array(a) / a[0]
    return b, a


def filt(x, kind, f, q=0.707, gain_db=0.0):
    b, a = biquad(kind, f, q, gain_db)
    return sps.lfilter(b, a, x, axis=-1)


def circ_filter(x, fn, pad_s=3.0):
    """Apply a (recursive) filter function to a looping signal: prime with the wrapped end, crop."""
    n = x.shape[-1]
    p = min(n, int(pad_s * SR))
    xx = np.concatenate([x[..., n - p:], x], axis=-1)
    y = fn(xx)
    return y[..., p:]


def sweep(x, cutoff, q=0.75, kind='lp', block=256, stages=2):
    """Time-varying biquad filter: cutoff (Hz) per sample (array) or scalar; coefficients per block."""
    x = np.asarray(x, dtype=np.float64)
    n = x.shape[-1]
    if np.isscalar(cutoff):
        y = x
        for _ in range(stages):
            y = filt(y, kind, cutoff, q)
        return y
    y = np.empty_like(x)
    multi = x.ndim > 1
    zis = [np.zeros((x.shape[0], 2)) if multi else np.zeros(2) for _ in range(stages)]
    for s in range(0, n, block):
        e = min(n, s + block)
        fc = float(cutoff[min(n - 1, (s + e) // 2)])
        b, a = biquad(kind, fc, q)
        seg = x[..., s:e]
        for k in range(stages):
            seg, zis[k] = sps.lfilter(b, a, seg, axis=-1, zi=zis[k])
        y[..., s:e] = seg
    return y


def onepole_lp(x, fc):
    a = np.exp(-TWO_PI * fc / SR)
    return sps.lfilter([1 - a], [1, -a], x, axis=-1)


# ----------------------------------------------------------------------------------------------- noise
def pink(n, rng):
    """Pink noise (FFT shaped, unit RMS)."""
    w = rng.standard_normal(n)
    X = np.fft.rfft(w)
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    X /= np.sqrt(f)
    y = np.fft.irfft(X, n)
    return y / (np.std(y) + 1e-12)


def brown(n, rng):
    w = rng.standard_normal(n)
    X = np.fft.rfft(w)
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    X /= f
    y = np.fft.irfft(X, n)
    return y / (np.std(y) + 1e-12)


# ----------------------------------------------------------------------------------------------- effects
def pan_gains(p):
    """Constant-power pan, p in [-1, 1] -> (gl, gr)."""
    a = (np.clip(p, -1, 1) + 1) * np.pi / 4
    return np.cos(a), np.sin(a)


def frac_delay(x, d):
    """Read x at (i - d[i]) with linear interpolation (d in samples, array)."""
    n = x.shape[-1]
    idx = np.arange(n) - d
    idx = np.mod(idx, n)    # circular (looping material)
    i0 = np.floor(idx).astype(np.int64)
    fr = idx - i0
    i1 = (i0 + 1) % n
    return x[i0] * (1 - fr) + x[i1] * fr


def chorus(st, depth_ms=3.5, base_ms=9.0, rate=0.25, mix=0.45, seed=1, voices=2):
    """Stereo ensemble chorus (circular). st: (2, n)."""
    rng = np.random.default_rng(seed)
    n = st.shape[1]
    t = np.arange(n) / SR
    out = np.empty_like(st)
    for c in range(2):
        acc = np.zeros(n)
        for v in range(voices):
            r = rate * rng.uniform(0.7, 1.4)
            d = (base_ms + depth_ms * np.sin(TWO_PI * r * t + rng.uniform(0, TWO_PI))) * SR / 1000
            acc += frac_delay(st[c], d)
        out[c] = st[c] * (1 - mix) + acc * (mix / voices)
    return out


def pingpong(st, delay_s, fb=0.45, echoes=6, lp=3500, mix=0.35):
    """Ping-pong echo built from summed delayed copies (circular): each echo darker and quieter."""
    n = st.shape[1]
    d = int(delay_s * SR)
    mono = 0.5 * (st[0] + st[1])
    wet = np.zeros_like(st)
    cur = mono.copy()
    g = 1.0
    for k in range(1, echoes + 1):
        cur = circ_filter(cur, lambda v: onepole_lp(v, lp), 1.0)
        g *= fb
        ch = (k + 1) % 2
        wet[ch] += np.roll(cur, d * k) * g
    return st + wet * mix


def make_ir(seconds=7.0, rt=(7.0, 6.0, 5.0, 3.6, 2.2), predelay=0.03, seed=3, er=14, width=1.0, damp_hf=9000):
    """Stereo reverb impulse response: band-wise exponentially decaying noise + early reflections.
    rt: RT60 per band (<250, 250-1k, 1k-3k, 3k-7k, >7k Hz)."""
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    edges = [250, 1000, 3000, 7000]
    ir = np.zeros((2, n))
    for c in range(2):
        w = rng.standard_normal(n)
        bands = []
        sos_lo = sps.butter(4, edges[0], 'low', fs=SR, output='sos')
        bands.append(sps.sosfilt(sos_lo, w))
        for i in range(len(edges) - 1):
            sos = sps.butter(4, [edges[i], edges[i + 1]], 'band', fs=SR, output='sos')
            bands.append(sps.sosfilt(sos, w))
        sos_hi = sps.butter(4, edges[-1], 'high', fs=SR, output='sos')
        bands.append(sps.sosfilt(sos_hi, w))
        tail = np.zeros(n)
        for b, r in zip(bands, rt):
            tail += b * np.exp(-6.91 * t / r)
        # diffuse build-up
        tail *= 1 - np.exp(-t / 0.045)
        ir[c] = tail
    if damp_hf:
        ir = filt(ir, 'lp', damp_hf, 0.6)
    # early reflections
    for k in range(er):
        dt = rng.uniform(0.006, 0.085)
        g = 0.55 * np.exp(-dt / 0.05) * rng.choice([-1, 1])
        i = int(dt * SR)
        if i < n:
            c = k % 2
            ir[c, i] += g * 3.0
            ir[1 - c, min(n - 1, i + int(rng.uniform(0.0005, 0.003) * SR))] += g * 1.5 * width
    pd = int(predelay * SR)
    ir = np.concatenate([np.zeros((2, pd)), ir[:, : n - pd]], axis=1)
    # stereo width: mid/side
    m = 0.5 * (ir[0] + ir[1]); s = 0.5 * (ir[0] - ir[1]) * width
    ir = np.stack([m + s, m - s])
    ir /= np.sqrt(np.sum(ir ** 2) / 2) + 1e-12
    return ir


def convolve_circ(st, ir):
    """Circular stereo convolution (loop-safe reverb)."""
    n = st.shape[1]
    out = np.zeros_like(st)
    for c in range(2):
        y = sps.oaconvolve(st[c], ir[c])
        out[c] = y[:n]
        tail = y[n:]
        # fold the tail onto the start (it may be longer than n for very short material)
        k = 0
        while k < len(tail):
            seg = tail[k:k + n]
            out[c, :len(seg)] += seg
            k += n
    return out


def fold(st, n):
    """Fold a render longer than the loop length n back onto its start."""
    out = st[:, :n].copy()
    k = n
    while k < st.shape[1]:
        seg = st[:, k:k + n]
        out[:, :seg.shape[1]] += seg
        k += n
    return out


# ----------------------------------------------------------------------------------------------- dynamics
def compress(st, thr_db=-20.0, ratio=2.0, attack=0.05, release=0.4, knee_db=6.0, circular=True):
    """Gentle RMS bus compressor (linked stereo)."""
    p = np.mean(st ** 2, axis=0)
    def smooth(v):
        # attack/release one-pole on power (approximate: separate smoothers then max)
        a1 = np.exp(-1 / (attack * SR)); a2 = np.exp(-1 / (release * SR))
        f = sps.lfilter([1 - a1], [1, -a1], v)
        s = sps.lfilter([1 - a2], [1, -a2], v)
        return np.maximum(f * 0.6 + s * 0.4, 1e-12)
    env = circ_filter(p, smooth, 4.0) if circular else smooth(p)
    lvl = 10 * np.log10(env)
    over = lvl - thr_db
    gr = np.where(over <= -knee_db / 2, 0.0,
                  np.where(over >= knee_db / 2, over * (1 - 1 / ratio),
                           (1 - 1 / ratio) * (over + knee_db / 2) ** 2 / (2 * knee_db)))
    g = 10 ** (-gr / 20)
    return st * g


def limiter(st, ceiling_db=-1.5, look_ms=4.0, circular=True):
    """Look-ahead brickwall limiter (gain = moving average of a windowed minimum: never overshoots)."""
    c = 10 ** (ceiling_db / 20)
    peak = np.max(np.abs(st), axis=0)
    g = np.minimum(1.0, c / np.maximum(peak, 1e-12))
    w = max(3, int(look_ms * SR / 1000))
    mode = 'wrap' if circular else 'nearest'
    g2 = minimum_filter1d(g, size=2 * w + 1, mode=mode)
    g3 = uniform_filter1d(g2, size=w, mode=mode)
    return st * np.minimum(g3, g)


# ----------------------------------------------------------------------------------------------- loudness
_K_PRE = (np.array([1.53512485958697, -2.69169618940638, 1.19839281085285]), np.array([1.0, -1.69065929318241, 0.73248077421585]))
_K_RLB = (np.array([1.0, -2.0, 1.0]), np.array([1.0, -1.99004745483398, 0.99007225036621]))


def lufs(st):
    """Integrated loudness (ITU-R BS.1770-4, 48 kHz coefficients), stereo (2, n)."""
    y = sps.lfilter(*_K_PRE, st, axis=-1)
    y = sps.lfilter(*_K_RLB, y, axis=-1)
    blk = int(0.4 * SR); hop = int(0.1 * SR)
    n = y.shape[1]
    if n < blk:
        return -70.0
    p = (y ** 2).sum(axis=0)
    cs = np.concatenate([[0.0], np.cumsum(p)])
    starts = np.arange(0, n - blk + 1, hop)
    z = (cs[starts + blk] - cs[starts]) / blk
    l = -0.691 + 10 * np.log10(np.maximum(z, 1e-15))
    z1 = z[l > -70]
    if len(z1) == 0:
        return -70.0
    lr = -0.691 + 10 * np.log10(np.mean(z1)) - 10
    z2 = z[(l > -70) & (l > lr)]
    return float(-0.691 + 10 * np.log10(np.mean(z2)))


def short_term_lufs(st, win=3.0, hop=1.0):
    y = sps.lfilter(*_K_PRE, st, axis=-1)
    y = sps.lfilter(*_K_RLB, y, axis=-1)
    p = (y ** 2).sum(axis=0)
    blk = int(win * SR); h = int(hop * SR)
    cs = np.concatenate([[0.0], np.cumsum(p)])
    starts = np.arange(0, max(1, len(p) - blk + 1), h)
    z = (cs[np.minimum(starts + blk, len(p))] - cs[starts]) / blk
    return -0.691 + 10 * np.log10(np.maximum(z, 1e-15))


def true_peak_db(st):
    up = sps.resample_poly(st, 4, 1, axis=-1)
    return float(20 * np.log10(np.max(np.abs(up)) + 1e-12))


def normalize_lufs(st, target=-18.0):
    l = lufs(st)
    return st * 10 ** ((target - l) / 20), l
