#!/usr/bin/env python3
"""Pack the stage-2 sky / solar-system data (outputs of the build_*.py scripts in this folder) into public/.

  python3 -I tools/sky/pack_sky.py <assets dir> <repo public dir>

<assets dir> holds the build outputs: stars/, constellations/, milkyway/, dso/, moon/, planets/ (see README.md of the
asset bundle; the build scripts are build_stars.py, build_constellations.py, build_milkyway.py, build_dso*.py,
build_moon.py, build_planets.py, sources via fetch_gaia.sh / fetch_svs.sh).

Writes
  data/sky/stars_{a,b,c}.bin   Hipparcos+Tycho-2 (HYG + Gaia DR3 counterparts) by magnitude: a V<=7, b 7<V<=9.5,
                               c 9.5<V<=10.5; each sorted by V (any prefix is a magnitude-limited sample). Indices of
                               a, b, c continue each other = indices of star_names.json (`i`).
  data/sky/stars_d.bin         10.5<V<=12.0, sorted by sky cell (telescope only, loaded lazily)
  data/sky/stars_gaia.bin      Gaia DR3 G<12 sources without HIP/Tycho-2 counterpart, V<=12.0, by sky cell (telescope)
  data/sky/star_names.json, constellations.json, dso.json, dso_images.json
  textures/sky/milkyway_{8192,4096,2048}.jpg
  textures/dso/*.jpg
  textures/moon/moon_color_{8192,4096,2048}.jpg, moon_normal_{8192,4096}.jpg (re-encoded), moon_height_2048.bin
  textures/planets/*.jpg|png

Star format "STR3" (little-endian): 32-byte header char[4] 'STR3', u32 version=1, u32 count, u32 recordSize=8,
f32 epoch (positions already propagated with the proper motion to this epoch), f32 faintest V, u32 cells (0 = sorted
by V; else the number of sky cells), u32 0; if cells > 0: (cells + 1) x u32 record offsets, cell k = dec band
k // 32 (16 bands equal in sin(dec), south to north) x RA column k % 32. Records (8 bytes): u24 RA = v / 2^24 x 360 deg,
u24 Dec = v / (2^24 - 1) x 180 - 90 deg (ICRS), u8 V = v / 16 - 2, u8 B-V = v / 64 - 0.5.

Moon height "MHT1": gzip of [char[4] 'MHT1', u32 width, u32 height, f32 metres per unit, f32 offset metres] + int16
row-wise deltas (first column absolute) of round(height_m / step); height_m above the 1737.4 km sphere, rows from north,
column 0 = 180 W.
"""
import sys, os, json, struct, shutil, gzip, math
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

src, pub = sys.argv[1], sys.argv[2]
EPOCH = 2026.8
NRA, NDEC = 32, 16


def read_str2(path):
    b = open(path, 'rb').read()
    assert b[:4] == b'STR2'
    n = struct.unpack_from('<I', b, 8)[0]
    r = np.frombuffer(b, dtype=np.uint8, offset=32, count=n * 12).reshape(n, 12).astype(np.int64)
    ra = (r[:, 0] | (r[:, 1] << 8) | (r[:, 2] << 16)) / 2 ** 24 * 360.0
    dec = (r[:, 3] | (r[:, 4] << 8) | (r[:, 5] << 16)) / (2 ** 24 - 1) * 180.0 - 90.0
    v = r[:, 6] / 16.0 - 2.0
    bv = r[:, 7] / 64.0 - 0.5
    pma = np.frombuffer(b, dtype='<i2', offset=32, count=n * 6).reshape(n, 6)[:, 4].astype(np.float64)
    pmd = np.frombuffer(b, dtype='<i2', offset=32, count=n * 6).reshape(n, 6)[:, 5].astype(np.float64)
    # propagate to EPOCH (mas/yr -> deg)
    dt = EPOCH - 2000.0
    cd = np.maximum(np.cos(np.radians(dec)), 1e-3)
    ra = (ra + pma / cd * dt / 3.6e6) % 360.0
    dec = np.clip(dec + pmd * dt / 3.6e6, -90, 90)
    return ra, dec, r[:, 6].astype(np.uint8), r[:, 7].astype(np.uint8), v


def cell_of(ra, dec):
    band = np.clip(((np.sin(np.radians(dec)) + 1) * 0.5 * NDEC).astype(int), 0, NDEC - 1)
    col = np.clip((ra / 360.0 * NRA).astype(int), 0, NRA - 1)
    return band * NRA + col


def write_str3(path, ra, dec, vb, bvb, v, cells=False):
    order = np.arange(len(ra))
    offsets = None
    if cells:
        c = cell_of(ra, dec)
        order = np.lexsort((v, c))
        cs = c[order]
        offsets = np.searchsorted(cs, np.arange(NRA * NDEC + 1)).astype('<u4')
    ra, dec, vb, bvb = ra[order], dec[order], vb[order], bvb[order]
    rau = np.minimum(np.round(ra / 360.0 * 2 ** 24).astype(np.int64), 2 ** 24 - 1)
    decu = np.round((dec + 90.0) / 180.0 * (2 ** 24 - 1)).astype(np.int64)
    rec = np.zeros((len(ra), 8), dtype=np.uint8)
    rec[:, 0] = rau & 255; rec[:, 1] = (rau >> 8) & 255; rec[:, 2] = (rau >> 16) & 255
    rec[:, 3] = decu & 255; rec[:, 4] = (decu >> 8) & 255; rec[:, 5] = (decu >> 16) & 255
    rec[:, 6] = vb; rec[:, 7] = bvb
    hdr = b'STR3' + struct.pack('<IIIffII', 1, len(ra), 8, EPOCH, float(v.max()) if len(v) else 0.0, NRA * NDEC if cells else 0, 0)
    with open(path, 'wb') as f:
        f.write(hdr)
        if cells: f.write(offsets.tobytes())
        f.write(rec.tobytes())
    print(path, len(ra), os.path.getsize(path))


def stars():
    out = os.path.join(pub, 'data/sky'); os.makedirs(out, exist_ok=True)
    ra, dec, vb, bvb, v = read_str2(os.path.join(src, 'stars/stars_hiptyc.bin'))
    cuts = [(-9, 7.0, 'a'), (7.0, 9.5, 'b'), (9.5, 10.5, 'c')]
    for lo, hi, name in cuts:
        m = (v > lo) & (v <= hi)
        idx = np.nonzero(m)[0]
        assert idx.size == 0 or (idx[-1] - idx[0] + 1 == idx.size), 'magnitude chunks must be contiguous'
        write_str3(os.path.join(out, f'stars_{name}.bin'), ra[m], dec[m], vb[m], bvb[m], v[m])
    m = (v > 10.5) & (v <= 12.0)
    write_str3(os.path.join(out, 'stars_d.bin'), ra[m], dec[m], vb[m], bvb[m], v[m], cells=True)
    ra, dec, vb, bvb, v = read_str2(os.path.join(src, 'stars/stars_gaia_extra.bin'))
    m = v <= 12.0
    write_str3(os.path.join(out, 'stars_gaia.bin'), ra[m], dec[m], vb[m], bvb[m], v[m], cells=True)
    # names: keep the fields the app uses
    names = json.load(open(os.path.join(src, 'stars/star_names.json')))
    keep = ('i', 'hip', 'name', 'ru', 'bayer', 'flam', 'con', 'v', 'bv', 'spect', 'dist_pc')
    slim = [{k: s[k] for k in keep if k in s} for s in names if s.get('i') is not None and s.get('v', 99) <= 10.5]
    json.dump(slim, open(os.path.join(out, 'star_names.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print('names', len(slim))


def copy(a, b):
    os.makedirs(os.path.dirname(b), exist_ok=True)
    shutil.copyfile(a, b)


def jpeg(a, b, q):
    os.makedirs(os.path.dirname(b), exist_ok=True)
    Image.open(a).save(b, 'JPEG', quality=q, optimize=True)
    print(b, os.path.getsize(b))


def sky_maps():
    for s in (8192, 4096, 2048):
        copy(os.path.join(src, f'milkyway/milkyway_{s}.jpg'), os.path.join(pub, f'textures/sky/milkyway_{s}.jpg'))
    for f in ('constellations/constellations.json', 'dso/dso.json', 'dso/images/dso_images.json'):
        d = json.load(open(os.path.join(src, f)))
        json.dump(d, open(os.path.join(pub, 'data/sky', os.path.basename(f)), 'w'), ensure_ascii=False, separators=(',', ':'))
    imgs = json.load(open(os.path.join(src, 'dso/images/dso_images.json')))
    for im in imgs:
        copy(os.path.join(src, 'dso/images', im['file']), os.path.join(pub, 'textures/dso', im['file']))


def moon():
    M = os.path.join(pub, 'textures/moon')
    for s in (8192, 4096, 2048):
        copy(os.path.join(src, f'moon/moon_color_{s}.jpg'), os.path.join(M, f'moon_color_{s}.jpg'))
    jpeg(os.path.join(src, 'moon/moon_normal_8192.jpg'), os.path.join(M, 'moon_normal_8192.jpg'), 85)
    jpeg(os.path.join(src, 'moon/moon_normal_4096.jpg'), os.path.join(M, 'moon_normal_4096.jpg'), 90)
    h = np.fromfile(os.path.join(src, 'moon/moon_height_4096x2048.u16'), dtype='<u2').reshape(2048, 4096).astype(np.float64)
    hm = (h - 20000.0) * 0.5
    h2 = hm.reshape(1024, 2, 2048, 2).mean(axis=(1, 3))
    step = 0.5
    q = np.round(h2 / step).astype(np.int32)
    dlt = np.diff(q, axis=1, prepend=0).astype(np.int16)
    payload = b'MHT1' + struct.pack('<IIff', 2048, 1024, step, 0.0) + dlt.tobytes()
    p = os.path.join(M, 'moon_height_2048.bin')
    open(p, 'wb').write(gzip.compress(payload, 9))
    print(p, os.path.getsize(p), 'range', h2.min(), h2.max())


def planets():
    P = os.path.join(pub, 'textures/planets')
    for f in ('mercury_2048.jpg', 'venus_clouds_2048.jpg', 'mars_2048.jpg', 'jupiter_cassini_3600.jpg', 'saturn_2048.jpg',
              'saturn_ring_2048x64.png', 'uranus_2048.jpg', 'neptune_2048.jpg'):
        copy(os.path.join(src, 'planets', f), os.path.join(P, f))


if __name__ == '__main__':
    what = sys.argv[3:] or ['stars', 'sky', 'moon', 'planets']
    if 'stars' in what: stars()
    if 'sky' in what: sky_maps()
    if 'moon' in what: moon()
    if 'planets' in what: planets()
