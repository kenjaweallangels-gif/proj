#!/usr/bin/env python3
"""
Programmatic listening: loudness / peak / DC / spectrum / click / loop-seam analysis of a stereo signal.

  python3 tools/audio/music/analyze.py file.ogg|file.wav [--loop]
"""
import json
import subprocess
import sys

import numpy as np
from scipy import signal as sps
from scipy.ndimage import maximum_filter1d, median_filter

from dsp import SR, lufs, short_term_lufs, true_peak_db

BANDS = [(20, 60), (60, 250), (250, 2000), (2000, 6000), (6000, 20000)]


def spectrum_balance(st):
    mono = st.mean(axis=0)
    f, p = sps.welch(mono, SR, nperseg=8192)
    tot = np.sum(p[(f >= 20) & (f <= 20000)]) + 1e-20
    bands = {f'{a}-{b}': round(100 * float(np.sum(p[(f >= a) & (f < b)]) / tot), 1) for a, b in BANDS}
    cen = float(np.sum(f * p) / (np.sum(p) + 1e-20))
    return bands, round(cen, 0)


def click_scan(x, thr=10.0):
    """High-passed spike detector: 1 ms peak vs the 60 ms median of the HP envelope. Returns (count, worst ratio)."""
    sos = sps.butter(4, 7000, 'high', fs=SR, output='sos')
    hp = np.abs(sps.sosfilt(sos, x))
    blk = int(0.001 * SR)
    n = len(hp) // blk
    if n < 10:
        return 0, 0.0
    m = hp[:n * blk].reshape(n, blk).max(axis=1)
    bg = median_filter(m, size=61, mode='nearest') + 1e-6
    r = m / bg
    loud = m > 10 ** (-60 / 20)
    hits = (r > thr) & loud
    # merge adjacent ms
    cnt = int(np.sum(hits & ~np.roll(hits, 1)))
    return cnt, round(float(np.max(r[loud])) if np.any(loud) else 0.0, 1)


def analyse(st, loop=False):
    st = np.asarray(st, dtype=np.float64)
    out = {}
    out['lufs'] = round(lufs(st), 2)
    out['true_peak_db'] = round(true_peak_db(st), 2)
    out['sample_peak_db'] = round(float(20 * np.log10(np.max(np.abs(st)) + 1e-12)), 2)
    out['rms_db'] = round(float(10 * np.log10(np.mean(st ** 2) + 1e-20)), 2)
    out['dc'] = [round(float(np.mean(st[c])), 6) for c in range(2)]
    stl = short_term_lufs(st)
    stl = stl[stl > -70]
    if len(stl):
        out['lra_lu'] = round(float(np.percentile(stl, 95) - np.percentile(stl, 10)), 1)
        out['short_term_max'] = round(float(np.max(stl)), 1)
    out['bands_pct'], out['centroid_hz'] = spectrum_balance(st)
    corr = np.corrcoef(st[0], st[1])[0, 1]
    out['lr_corr'] = round(float(corr), 3)
    out['clicks'], out['click_worst'] = click_scan(st.mean(axis=0))
    out['clipped_samples'] = int(np.sum(np.abs(st) >= 0.999))
    if loop:
        k = int(0.5 * SR)
        seam = np.concatenate([st[:, -k:], st[:, :k]], axis=1)
        d = np.abs(np.diff(st, axis=1))
        med = np.median(d) + 1e-9
        jump = float(np.max(np.abs(st[:, 0] - st[:, -1])))
        out['seam_jump_vs_median_step'] = round(jump / med, 2)
        out['seam_step_percentile'] = round(float(np.mean(d < jump) * 100), 1)
        c, w = click_scan(seam.mean(axis=0))
        out['seam_clicks'] = c
        a = st[:, -int(0.05 * SR):]; b = st[:, :int(0.05 * SR)]
        out['seam_rms_db_end_start'] = [round(float(10 * np.log10(np.mean(a ** 2) + 1e-20)), 1), round(float(10 * np.log10(np.mean(b ** 2) + 1e-20)), 1)]
    return out


def load(path):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path, '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32).reshape(-1, 2).T.astype(np.float64)


if __name__ == '__main__':
    st = load(sys.argv[1])
    print(json.dumps(analyse(st, loop='--loop' in sys.argv), indent=1))
