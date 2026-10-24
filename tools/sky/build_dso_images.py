#!/usr/bin/env python3
"""Showcase deep-sky images for the telescope view.

For each selected object: download the archive image (ESO / ESA-Hubble / NOIRLab publication JPEG, or the
full-size 'large' JPEG when the publication JPEG is too coarse for the requested crop), then resample it with
the archive's astrometric metadata (centre RA/Dec, field of view, "North is X deg left/right of vertical") into a
square, NORTH-UP / EAST-LEFT gnomonic tile centred exactly on the object's catalogue position, subtract the
sky background, fade the outer border to black and save as JPEG (black background -> additive blending).

Every output tile therefore has position angle 0 (north up, east left, as seen on the sky) and is centred on
(ra, dec) given in dso_images.json; its side spans `size_arcmin` (scale = size_arcmin*60/px arcsec per pixel).

Usage: python3 -I build_dso_images.py <meta.json> <download dir> <outdir>
"""
import sys, os, json, math, re, urllib.request
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

meta_p, dl, out = sys.argv[1:4]
os.makedirs(dl, exist_ok=True); os.makedirs(out, exist_ok=True)
META = json.load(open(meta_p))
D2R = math.pi / 180

# object id, archive key, crop side (arcmin), centre (ra deg, dec deg) = catalogue position (OpenNGC J2000)
SEL = [
    ('M1',   'hub:heic0515a', 7.0,   83.63321, 22.01447),
    ('M8',   'eso:eso0936a', 75.0,  270.90417, -24.38667),
    ('M13',  'noir:noao-m13kpno4m', 20.0, 250.42346, 36.46131),
    ('M16',  'eso:eso0926a', 30.0,  274.70004, -13.80694),
    ('M17',  'eso:eso1119a', 45.0,  275.19629, -16.17167),
    ('M20',  'eso:eso0930b', 24.0,  270.62521, -22.97167),
    ('M27',  'noir:noao-m27-kpno-mayall-4-m', 15.0, 299.90158, 22.72117),
    ('M31',  'hub:heic1502b', 220.0, 10.68471, 41.26875),
    ('M33',  'eso:eso1424a', 62.0,   23.46204, 30.66017),
    ('M42',  'eso:eso1723a', 50.0,   83.81867, -5.38967),
    ('M45',  'noir:noao-m45', 70.0,  56.60100, 24.11367),
    ('M51',  'noir:noao1309a', 16.0, 202.48417, 47.23056),
    ('M57',  'hub:heic1310a', 2.6,  283.39613, 33.02914),
    ('M64',  'noir:noao-02330', 12.0, 194.18183, 21.68308),
    ('M77',  'eso:eso1720a', 7.2,   40.66963, -0.01328),
    ('M78',  'eso:eso1105a', 30.0,  86.69088, 0.07917),
    ('M81',  'noir:noao-m81m82', 30.0, 148.88821, 69.06529),
    ('M82',  'noir:noao-m81m82', 13.0, 148.96846, 69.67970),
    ('M83',  'eso:eso0825a', 17.5,  204.25383, -29.86542),
    ('M101', 'noir:noao-m101ubviha', 31.0, 210.80225, 54.34893),
    ('M104', 'hub:heic2506a', 10.0, 189.99763, -11.62305),
    ('M7',   'eso:eso1406a', 33.0,  268.46250, -34.79250),
    ('M15',  'hub:heic1321b', 22.0, 322.49304, 12.16700),
    ('M44',  'noir:noao-m44bash', 95.0, 130.10000, 19.98333),
    ('NGC 5139', 'eso:eso1119b', 50.0, 201.69121, -47.47686),
    ('NGC 104',  'eso:eso1302a', 46.0,  6.02233, -72.08144),
    ('LMC',      'noir:noirlab2030a', 600.0, 80.89375, -69.75611),
    ('SMC',      'noir:noirlab2030b', 320.0, 13.18658, -72.82861),
    ('NGC 3372', 'eso:eso1250a', 64.0, 161.26458, -59.86667),
    ('NGC 7293', 'noir:noao0307a', 26.0, 337.41071, -20.83733),
    ('NGC 2070', 'eso:eso1816a', 59.0,  84.67650, -69.10089),
    ('NGC 5128', 'eso:eso1221a', 33.0, 201.36508, -43.01911),
    ('NGC 253',  'eso:eso9903a', 31.0,  11.88800, -25.28822),
    ('NGC 4755', 'eso:eso0940b', 20.0, 193.40450, -60.35631),
    ('Horsehead Nebula', 'eso:eso0202a', 6.5, 85.24583, -2.45833),
    ('NGC 2237', 'noir:noirlab2424a', 90.0, 97.98333, 4.96667),   # Rosette, centred on NGC 2244
    ('NGC 6543', 'hub:heic0414a', 1.15, 269.63912, 66.63319),
]
LICENCE = {'eso': 'CC BY 4.0 (ESO)', 'hub': 'CC BY 4.0 (ESA/Hubble)', 'noir': 'CC BY 4.0 (NOIRLab)', 'webb': 'CC BY 4.0 (ESA/Webb)'}

def parse_ra(s):
    h, m, x = s.split(); return (int(h) + int(m) / 60 + float(x) / 3600) * 15
def parse_dec(s):
    s = s.replace('−', '-'); sg = -1 if s.strip().startswith('-') else 1
    d, m, x = re.findall(r'[\d\.]+', s); return sg * (int(d) + int(m) / 60 + float(x) / 3600)
def parse_fov(s):
    a, b, u = re.match(r'([\d\.]+) x ([\d\.]+) (\w+)', s).groups()
    k = {'arcminutes': 1, 'degrees': 60, 'arcseconds': 1 / 60}[u]; return float(a) * k, float(b) * k
def parse_rot(s):
    a, side = re.match(r'North is ([\d\.]+)° (left|right)', s).groups(); a = float(a)
    return a if side == 'left' else -a      # CCW (screen, y up) rotation of north from vertical

def fetch(url, path):
    if not os.path.exists(path):
        print('  download', url, flush=True)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=600) as r, open(path + '.part', 'wb') as fh:
            while True:
                b = r.read(1 << 20)
                if not b: break
                fh.write(b)
        os.rename(path + '.part', path)
    return path

def pick(links, kind):
    for l in links:
        if f'/{kind}/' in l and l.startswith('https://') and l.count('http') == 1:
            return l

res = []
for oid, key, side_am, ra, dec in SEL:
    m = META[key]
    W0, H0 = map(int, re.findall(r'\d+', m['size']))
    fw, fh_ = parse_fov(m['fov'])
    s_orig = fw / W0                                   # arcmin per original pixel
    if abs(fh_ / H0 - s_orig) / s_orig > 0.03:
        print('WARNING anisotropic scale', oid, fw / W0, fh_ / H0)
    pub = pick(m['links'], 'publicationjpg') or pick(m['links'], 'large')
    path = fetch(pub, os.path.join(dl, f"{m['id']}_pub.jpg"))
    im = Image.open(path)
    need = side_am / s_orig * im.width / W0            # source pixels across the crop
    if need < 900 and W0 > im.width:
        lg = pick(m['links'], 'large')
        if lg:
            path = fetch(lg, os.path.join(dl, f"{m['id']}_large.jpg")); im = Image.open(path)
            need = side_am / s_orig * im.width / W0
    im = im.convert('RGB')
    W, H = im.size
    s = s_orig * W0 / W                                # arcmin per pixel of the image we use
    # Astrometry: the WorldWide Telescope parameters of the archive page (AVM Spatial.* metadata):
    # reference RA/Dec at reference pixel (x, y) of the 'screen' rendition (pixels from the top-left),
    # scale in arcsec per screen pixel, rotation 180 = north up (north is (180-rotation) deg left of vertical).
    w = m['wwt']
    ra0, dec0 = w['ra'], w['dec']
    screen_w = fw * 60 / w['scale']; screen_h = screen_w * H0 / W0
    rx, ry = w['x'] * W / screen_w, H - w['y'] * H / screen_h     # WWT y is measured from the BOTTOM edge
    rot = (180.0 - w['rotation']) * D2R
    N = np.array([-math.sin(rot), math.cos(rot)]); E = np.array([-math.cos(rot), -math.sin(rot)])  # (x right, y up)
    OUTPX = 1024 if need >= 700 else 512
    # output pixel (u,v) -> tangent-plane offset about the OBJECT (north up, east left) -> sky -> source pixel.
    # For tiles of a few degrees the difference between the two tangent planes is negligible except for LMC/SMC/M31,
    # so map exactly through the sphere.
    a, b, c_ = ra * D2R, dec * D2R, None
    us = (np.arange(OUTPX) + 0.5) / OUTPX - 0.5
    xi = -us[None, :] * side_am * np.ones((OUTPX, 1))            # east to the left
    eta = -us[:, None] * side_am * np.ones((1, OUTPX))           # north up
    X, Y = np.radians(xi / 60), np.radians(eta / 60)
    rho = np.hypot(X, Y); cang = np.arctan(rho)
    with np.errstate(invalid='ignore', divide='ignore'):
        dd = np.arcsin(np.cos(cang) * math.sin(b) + np.where(rho > 0, Y * np.sin(cang) * math.cos(b) / rho, 0))
        rr = a + np.arctan2(X * np.sin(cang), rho * math.cos(b) * np.cos(cang) - Y * math.sin(b) * np.sin(cang))
    # sky -> source pixels (vectorised version of sky_to_px)
    r0, d0 = ra0 * D2R, dec0 * D2R
    cc = np.sin(d0) * np.sin(dd) + np.cos(d0) * np.cos(dd) * np.cos(rr - r0)
    xs = np.degrees(np.cos(dd) * np.sin(rr - r0) / cc) * 60
    ys = np.degrees((np.cos(d0) * np.sin(dd) - np.sin(d0) * np.cos(dd) * np.cos(rr - r0)) / cc) * 60
    px = rx + (xs * E[0] + ys * N[0]) / s - 0.5
    py = ry - (xs * E[1] + ys * N[1]) / s - 0.5
    src = np.asarray(im, dtype=np.float32)
    # area-average the source first when downsampling a lot (avoid aliasing), then bilinear sample
    step = (side_am / s) / OUTPX
    if step > 1.5:
        k = int(step)
        src = np.asarray(im.resize((W // k, H // k), Image.BOX), dtype=np.float32)
        px = (px + 0.5) / k - 0.5; py = (py + 0.5) / k - 0.5
    Hs, Ws = src.shape[:2]
    inside = (px >= 0) & (py >= 0) & (px <= Ws - 1) & (py <= Hs - 1)
    x0 = np.clip(np.floor(px).astype(int), 0, Ws - 2); y0 = np.clip(np.floor(py).astype(int), 0, Hs - 2)
    fx = np.clip(px - x0, 0, 1)[..., None]; fy = np.clip(py - y0, 0, 1)[..., None]
    o = (src[y0, x0] * (1 - fx) * (1 - fy) + src[y0, x0 + 1] * fx * (1 - fy) +
         src[y0 + 1, x0] * (1 - fx) * fy + src[y0 + 1, x0 + 1] * fx * fy)
    # background: per-channel 3rd percentile of the valid area, subtracted (keeps faint nebulosity mostly)
    bg = np.percentile(o[inside], 3, axis=0)
    o = np.clip((o - bg) / np.maximum(1, 255 - bg) * 255, 0, 255)
    # soft edges: fade to black over 6% of the side at the tile border and over ~1.5% inside the source edge
    e = 0.06 * OUTPX
    uu = np.arange(OUTPX) + 0.5
    edge = np.minimum(np.minimum(uu, OUTPX - uu)[None, :], np.minimum(uu, OUTPX - uu)[:, None])
    fade = np.clip(edge / e, 0, 1)
    s_eff = s * (k if step > 1.5 else 1)               # arcmin per pixel of the array we sampled
    dsrc = np.minimum(np.minimum(px, Ws - 1 - px), np.minimum(py, Hs - 1 - py)) * OUTPX / (side_am / s_eff)
    fade = fade * np.clip(dsrc / (0.015 * OUTPX), 0, 1) * inside
    fade = fade * fade * (3 - 2 * fade)
    o = (o * fade[..., None]).round().astype(np.uint8)
    fn = 'dso_' + re.sub(r'[^A-Za-z0-9]+', '', oid.replace('NGC ', 'ngc').replace('Horsehead Nebula', 'b33')).lower() + '.jpg'
    Image.fromarray(o, 'RGB').save(os.path.join(out, fn), quality=90, optimize=True, progressive=True)
    cover = float(inside.mean())
    res.append({'id': oid, 'file': fn, 'ra': ra, 'dec': dec, 'size_arcmin': side_am, 'px': OUTPX,
                'arcsec_per_px': round(side_am * 60 / OUTPX, 4), 'pa_deg': 0.0,
                'orientation': 'north up, east left (as seen on the sky), gnomonic about (ra,dec)',
                'coverage': round(cover, 3), 'source_px_across': int(need),
                'credit': m['credit'], 'licence': LICENCE[m['site']], 'source': m['page'], 'source_title': m['title'],
                'source_wcs': {'ref_ra': ra0, 'ref_dec': dec0, 'wwt': w, 'fov': m['fov'], 'orientation': m['orientation'], 'size': m['size']}})
    print(f"{oid:18s} {fn:24s} {OUTPX}px {side_am}' cover {cover:.2f} src px {int(need)} {os.path.getsize(os.path.join(out, fn)) // 1024} KB", flush=True)
json.dump(res, open(os.path.join(out, 'dso_images.json'), 'w'), indent=1, ensure_ascii=False)
