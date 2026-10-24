#!/usr/bin/env python3
"""Build the compact star catalogue (stars v2) from HYG v4.4 + a Gaia DR3 extract + d3-celestial names.

Sources
  HYG v4.4  (hyg_v44.csv.gz, CC BY-SA 4.0, D. Nash / astronexus): Hipparcos/Yale/Gliese stars, J2000 positions
            at epoch 2000, Johnson V, B-V, proper motion, IAU proper names, Bayer/Flamsteed, constellation.
  Gaia DR3  (ESA/Gaia/DPAC, CC BY-SA 3.0 IGO) fetched by fetch_gaia.sh:
            g12_*.csv   all sources with G < 12 (+ Tycho-2 TDSC-merge best-neighbour id)
            tycf_*.csv  Tycho-2 best neighbours with G >= 12
            hip_xm.csv  Hipparcos-2 best neighbours (those sources are taken from HYG instead)
  d3-celestial starnames.json (BSD-3, O. Frohn): Russian (and other) names keyed by HIP.

Groups (each sorted by V, brightest first, so any prefix is a magnitude-limited sample):
  H "hyg":    HYG stars only (stars_hyg.bin), no Gaia-derived data -> CC BY-SA 4.0 only.
  A "hiptyc": HYG stars (V <= 12.5) + Gaia sources matched to Tycho-2. This is the same star set that NASA SVS
     removed from milkyway_2020 (Hipparcos-2 + Tycho-2), so A + the milkyway texture do not double-draw.
  B "extra":  Gaia sources with G < 12 that have no Hipparcos/Tycho-2 counterpart. These ARE also present
     (blurred) in the milkyway texture: draw them only when zoomed in (telescope), fading the texture out.

Positions are ICRS, epoch J2000.0 (Gaia DR3 epoch 2016.0 propagated back with its proper motion).
Gaia G, BP-RP are converted to Johnson V and B-V with polynomials fitted here on the HIP-matched stars.

Binary format: 32-byte header + 12-byte records, documented in assets2/README.md (section stars).
Usage: python3 -I build_stars.py <hyg_v44.csv.gz> <gaia dir> <d3-celestial dir> <outdir>
"""
import sys, os, gzip, csv, json, glob, struct, math
import numpy as np

hyg_path, gaia_dir, d3c_dir, out = sys.argv[1:5]
os.makedirs(out, exist_ok=True)
D2R = math.pi / 180
MAS2DEG = 1 / 3.6e6

# ---------------------------------------------------------------- HYG
hyg = []
with gzip.open(hyg_path, 'rt', newline='') as fh:
    for r in csv.DictReader(fh):
        if r['id'] == '0':
            continue  # Sol
        mag = float(r['mag'])
        if mag > 12.5:
            continue
        hyg.append(r)
print('HYG stars <= 12.5:', len(hyg))
h_ra = np.array([float(r['ra']) * 15.0 for r in hyg])
h_dec = np.array([float(r['dec']) for r in hyg])
h_v = np.array([float(r['mag']) for r in hyg])
h_bv = np.array([float(r['ci']) if r['ci'] not in ('', None) else np.nan for r in hyg])
h_pmra = np.array([float(r['pmra'] or 0) for r in hyg])     # HYG pmra is mu_alpha* (includes cos dec), mas/yr
h_pmdec = np.array([float(r['pmdec'] or 0) for r in hyg])
h_hip = np.array([int(r['hip']) if r['hip'] else 0 for r in hyg])

# ---------------------------------------------------------------- Gaia
cols = None
parts = []
for f in sorted(glob.glob(os.path.join(gaia_dir, 'g12_*.csv'))) + sorted(glob.glob(os.path.join(gaia_dir, 'tycf_*.csv'))):
    with open(f, newline='') as fh:
        rd = csv.reader(fh)
        hdr = next(rd)
        assert hdr == ['source_id', 'ra', 'dec', 'pmra', 'pmdec', 'g', 'bp_rp', 'tyc'], hdr
        rows = list(rd)
    parts.append(rows)
    print(os.path.basename(f), len(rows))
rows = [r for p in parts for r in p]
del parts
def fcol(i):
    return np.array([float(r[i]) if r[i] != '' else np.nan for r in rows])
g_sid = np.array([int(r[0]) for r in rows], dtype=np.int64)
g_ra, g_dec, g_pmra, g_pmdec, g_g, g_bprp = (fcol(i) for i in range(1, 7))
g_tyc = np.array([r[7] != '' for r in rows])
del rows
# de-duplicate source ids (bands are disjoint, but tycf and g12 could overlap if G is null)
_, first = np.unique(g_sid, return_index=True)
keep = np.zeros(len(g_sid), bool); keep[first] = True
print('Gaia rows', len(g_sid), 'unique', keep.sum())

hip_xm = {}
with open(os.path.join(gaia_dir, 'hip_xm.csv'), newline='') as fh:
    rd = csv.reader(fh); next(rd)
    for sid, hip, _d in rd:
        hip_xm[int(sid)] = int(hip)
xm_sids = np.array(list(hip_xm.keys()), dtype=np.int64)
in_hip = np.isin(g_sid, xm_sids)
print('Gaia sources with a Hipparcos-2 best neighbour:', int(in_hip.sum()))

# ---- photometric transformation fitted on HIP-matched stars ----------------------------------
hip_index = {h: i for i, h in enumerate(h_hip) if h}
pairs = [(gi, hip_index.get(hip_xm[s])) for gi, s in enumerate(g_sid) if in_hip[gi]]
pairs = [(a, b) for a, b in pairs if b is not None]
ga = np.array([a for a, b in pairs]); hb = np.array([b for a, b in pairs])
x = g_bprp[ga]; bv = h_bv[hb]; v = h_v[hb]; G = g_g[ga]
ok = np.isfinite(x) & np.isfinite(bv) & np.isfinite(G) & (h_v[hb] > 6) & (h_v[hb] < 10.5) & (x > -0.4) & (x < 4.5)
def robust_poly(xx, yy, deg):
    m = np.ones(len(xx), bool)
    for _ in range(4):
        c = np.polyfit(xx[m], yy[m], deg)
        res = yy - np.polyval(c, xx)
        s = 1.4826 * np.median(np.abs(res[m]))
        m = np.abs(res) < 3 * s
    return c, s
c_bv, s_bv = robust_poly(x[ok], bv[ok], 3)
c_gv, s_gv = robust_poly(x[ok], (G - v)[ok], 3)
print('fit B-V(BP-RP) coeffs (highest first)', c_bv.round(5).tolist(), 'scatter', round(s_bv, 3), 'N', int(ok.sum()))
print('fit G-V(BP-RP) coeffs (highest first)', c_gv.round(5).tolist(), 'scatter', round(s_gv, 3))
riello = lambda x: -0.02704 + 0.01424 * x - 0.2156 * x**2 + 0.01426 * x**3
print('Riello+2021 G-V at BP-RP 0,1,2:', [round(riello(t), 3) for t in (0, 1, 2)], ' fit:', [round(float(np.polyval(c_gv, t)), 3) for t in (0, 1, 2)])

xb = np.clip(g_bprp, -0.4, 4.5)
g_bv = np.where(np.isfinite(g_bprp), np.polyval(c_bv, xb), 0.65)
g_v = np.where(np.isfinite(g_bprp), g_g - np.polyval(c_gv, xb), g_g)

# ---- epoch 2016.0 -> 2000.0 ----
def propagate(ra, dec, pmra, pmdec, dt):
    a, d = ra * D2R, dec * D2R
    p = np.stack([np.cos(d) * np.cos(a), np.cos(d) * np.sin(a), np.sin(d)], -1)
    ea = np.stack([-np.sin(a), np.cos(a), np.zeros_like(a)], -1)
    ed = np.stack([-np.sin(d) * np.cos(a), -np.sin(d) * np.sin(a), np.cos(d)], -1)
    pa = np.nan_to_num(pmra) * MAS2DEG * D2R * dt; pd = np.nan_to_num(pmdec) * MAS2DEG * D2R * dt
    q = p + ea * pa[:, None] + ed * pd[:, None]
    q /= np.linalg.norm(q, axis=1)[:, None]
    return (np.degrees(np.arctan2(q[:, 1], q[:, 0])) % 360.0), np.degrees(np.arcsin(np.clip(q[:, 2], -1, 1)))
g_ra, g_dec = propagate(g_ra, g_dec, g_pmra, g_pmdec, -16.0)

# ---- positional de-duplication against HYG (catches HIP stars without a best-neighbour entry) ----
sel = keep & ~in_hip
def unit(ra, dec):
    a, d = ra * D2R, dec * D2R
    return np.stack([np.cos(d) * np.cos(a), np.cos(d) * np.sin(a), np.sin(d)], -1)
CELL = 1.0e-4  # rad (~20"); search radius 3" for faint stars, up to 20" for bright ones (saturated Gaia astrometry)
def keys(u):
    k = np.floor(u / CELL).astype(np.int64) + (1 << 20)
    return (k[:, 0] << 42) | (k[:, 1] << 21) | k[:, 2]
gi_all = np.nonzero(sel)[0]
ug = unit(g_ra[gi_all], g_dec[gi_all]); kg = keys(ug)
order = np.argsort(kg); kg_s = kg[order]
uh = unit(h_ra, h_dec)
kh = np.floor(uh / CELL).astype(np.int64) + (1 << 20)
dup = np.zeros(len(gi_all), bool)
for dx in (-1, 0, 1):
    for dy in (-1, 0, 1):
        for dz in (-1, 0, 1):
            kk = ((kh[:, 0] + dx) << 42) | ((kh[:, 1] + dy) << 21) | (kh[:, 2] + dz)
            lo = np.searchsorted(kg_s, kk, 'left'); hi = np.searchsorted(kg_s, kk, 'right')
            for hi_idx in np.nonzero(hi > lo)[0]:
                for j in order[lo[hi_idx]:hi[hi_idx]]:
                    sep = np.degrees(np.arccos(min(1.0, float(ug[j] @ uh[hi_idx])))) * 3600
                    vg = g_v[gi_all[j]]
                    rmax = 3.0 if vg > 9 else (20.0 if vg < 6 else 3.0 + (9 - vg) / 3 * 17.0)
                    if sep < rmax and abs(vg - h_v[hi_idx]) < 1.5:
                        dup[j] = True
print('positional duplicates of HYG stars removed:', int(dup.sum()))
sel[gi_all[dup]] = False

A_g = np.nonzero(sel & g_tyc & (g_v < 13.5))[0]   # V >= 13.5 here are Tycho-2 cross-match failures
B_g = np.nonzero(sel & ~g_tyc & (g_g < 12.0))[0]

# ---------------------------------------------------------------- assemble
h_bv_f = np.where(np.isfinite(h_bv), h_bv, 0.65)
A = dict(ra=np.concatenate([h_ra, g_ra[A_g]]), dec=np.concatenate([h_dec, g_dec[A_g]]),
         v=np.concatenate([h_v, g_v[A_g]]), bv=np.concatenate([h_bv_f, g_bv[A_g]]),
         pmra=np.concatenate([h_pmra, np.nan_to_num(g_pmra[A_g])]), pmdec=np.concatenate([h_pmdec, np.nan_to_num(g_pmdec[A_g])]),
         src=np.concatenate([np.arange(len(hyg)), -1 - A_g]))
B = dict(ra=g_ra[B_g], dec=g_dec[B_g], v=g_v[B_g], bv=g_bv[B_g], pmra=np.nan_to_num(g_pmra[B_g]),
         pmdec=np.nan_to_num(g_pmdec[B_g]), src=-1 - B_g)

def pack(S):
    o = np.argsort(S['v'], kind='stable')
    n = len(o)
    ra24 = np.round(S['ra'][o] / 360.0 * (1 << 24)).astype(np.int64) % (1 << 24)
    de24 = np.clip(np.round((S['dec'][o] + 90.0) / 180.0 * ((1 << 24) - 1)), 0, (1 << 24) - 1).astype(np.int64)
    mag = np.clip(np.round((S['v'][o] + 2.0) * 16), 0, 255).astype(np.uint8)
    bv = np.clip(np.round((S['bv'][o] + 0.5) * 64), 0, 255).astype(np.uint8)
    pa = np.clip(np.round(S['pmra'][o]), -32767, 32767).astype('<i2')
    pd = np.clip(np.round(S['pmdec'][o]), -32767, 32767).astype('<i2')
    rec = np.zeros((n, 12), np.uint8)
    for k in range(3):
        rec[:, k] = (ra24 >> (8 * k)) & 255
        rec[:, 3 + k] = (de24 >> (8 * k)) & 255
    rec[:, 6] = mag; rec[:, 7] = bv
    rec[:, 8:10] = pa.view(np.uint8).reshape(n, 2)
    rec[:, 10:12] = pd.view(np.uint8).reshape(n, 2)
    return rec, o

def header(n, group, vmax):
    # 32 bytes: magic 'STR2', u32 version, u32 count, u32 record size, f32 epoch, f32 faintest V, u32 group id, u32 0
    return b'STR2' + struct.pack('<IIIffII', 1, n, 12, 2000.0, vmax, group, 0)

recA, oA = pack(A)
recB, oB = pack(B)
def write(name, rec, group, vv):
    p = os.path.join(out, name)
    with open(p, 'wb') as fh:
        fh.write(header(len(rec), group, float(vv.max()) if len(vv) else 0.0))
        fh.write(rec.tobytes())
    print(name, len(rec), 'stars', os.path.getsize(p) // 1024, 'KB')
vA = A['v'][oA]; vB = B['v'][oB]
write('stars_hiptyc.bin', recA, 0, vA)
write('stars_gaia_extra.bin', recB, 1, vB)
# HYG-only file (CC BY-SA 4.0 only, no Gaia data): licence-clean fallback, complete to V ~ 8
H = {k: v[:len(hyg)] for k, v in A.items()}
recH, oH = pack(H)
write('stars_hyg.bin', recH, 2, H['v'][oH])
nq = int(len(recH))
pos_in_H = np.empty(len(oH), np.int64); pos_in_H[oH] = np.arange(len(oH))
hist = {f'{m:.1f}': int(np.searchsorted(vA, m, 'right')) for m in np.arange(0, 13.01, 0.5)}
print('cumulative counts group A by V:', hist)

# ---------------------------------------------------------------- names / designations
d3names = json.load(open(os.path.join(d3c_dir, 'starnames.json'), encoding='utf8'))
GREEK = {'Alp': 'α', 'Bet': 'β', 'Gam': 'γ', 'Del': 'δ', 'Eps': 'ε', 'Zet': 'ζ', 'Eta': 'η', 'The': 'θ', 'Iot': 'ι',
         'Kap': 'κ', 'Lam': 'λ', 'Mu': 'μ', 'Nu': 'ν', 'Xi': 'ξ', 'Omi': 'ο', 'Pi': 'π', 'Rho': 'ρ', 'Sig': 'σ',
         'Tau': 'τ', 'Ups': 'υ', 'Phi': 'φ', 'Chi': 'χ', 'Psi': 'ψ', 'Ome': 'ω'}
pos_in_A = np.empty(len(oA), np.int64); pos_in_A[oA] = np.arange(len(oA))
names = []
for hi, r in enumerate(hyg):
    hip = r['hip']
    d3 = d3names.get(hip, {}) if hip else {}
    proper = r['proper'] or ''
    bayer = r['bayer'] or ''
    if not (proper or bayer or r['flam'] or d3.get('ru')):
        continue
    if bayer:
        m = bayer.rstrip('0123456789').rstrip('-'); sup = bayer[len(m):].lstrip('-')
        bayer = GREEK.get(m, m) + sup.translate(str.maketrans('0123456789', '⁰¹²³⁴⁵⁶⁷⁸⁹'))
    e = {'i': int(pos_in_A[hi]), 'ih': int(pos_in_H[hi]), 'hip': int(hip) if hip else None, 'hr': int(r['hr']) if r['hr'] else None,
         'name': proper or None, 'ru': d3.get('ru') or None, 'bayer': bayer or None,
         'flam': int(r['flam']) if r['flam'] else None, 'con': r['con'] or None, 'v': round(h_v[hi], 2),
         'bv': None if not np.isfinite(h_bv[hi]) else round(float(h_bv[hi]), 3),
         'spect': r['spect'] or None, 'dist_pc': None if float(r['dist'] or 1e5) >= 1e5 else round(float(r['dist']), 2)}
    names.append({k: v for k, v in e.items() if v is not None})
names.sort(key=lambda e: e['v'])
p = os.path.join(out, 'star_names.json')
json.dump(names, open(p, 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
print('star_names.json', len(names), 'entries,', sum(1 for e in names if 'name' in e), 'IAU names,',
      sum(1 for e in names if 'ru' in e), 'Russian names,', os.path.getsize(p) // 1024, 'KB')
json.dump({'bv_from_bprp_poly_highest_first': c_bv.tolist(), 'g_minus_v_from_bprp_poly_highest_first': c_gv.tolist(),
           'fit_scatter_bv': s_bv, 'fit_scatter_gv': s_gv, 'n_fit': int(ok.sum()),
           'counts': {'A_hiptyc': len(recA), 'A_from_hyg': len(hyg), 'A_from_gaia_tycho': int(len(A_g)),
                      'B_gaia_extra': len(recB), 'hyg_only': nq}, 'cumulative_A_by_V': hist},
          open(os.path.join(out, 'build_stats.json'), 'w'), indent=1)
