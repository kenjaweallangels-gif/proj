#!/usr/bin/env python3
"""Build compact sky data from d3-celestial GeoJSON (BSD-3, (c) Olaf Frohn).

Usage: python3 -I tools/build_sky_data.py <dir with stars.8.json and mw.json>
Outputs:
  public/data/stars.bin  little-endian Float32 records [ra_deg, dec_deg, mag, bv] x N
                         (ra in 0..360, dec in -90..90). Header: uint32 N.
  public/textures/sky/milkyway_2048.png  equirectangular (x=RA 0..360 left->right, y=dec +90 top)
                         grayscale Milky Way brightness rasterized from 5 contour levels and blurred.
"""
import sys, os, json, struct, math
from PIL import Image, ImageDraw, ImageFilter

src = sys.argv[1]
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

# ---- stars -------------------------------------------------------------
stars = json.load(open(os.path.join(src, 'stars.8.json')))['features']
recs = []
for f in stars:
    lon, lat = f['geometry']['coordinates']
    p = f['properties']
    mag = float(p.get('mag', 8.0))
    try:
        bv = float(p.get('bv', 0.6) or 0.6)
    except ValueError:
        bv = 0.6
    ra = lon % 360.0  # d3-celestial lon is RA in -180..180
    recs.append((ra, lat, mag, bv))
recs.sort(key=lambda r: r[2])
with open(os.path.join(root, 'public', 'data', 'stars.bin'), 'wb') as fh:
    fh.write(struct.pack('<I', len(recs)))
    for r in recs:
        fh.write(struct.pack('<4f', *r))
print('stars:', len(recs), 'brightest', recs[:3])

# ---- Milky Way ---------------------------------------------------------
# Each contour level is a MultiPolygon. The outer level(s) are *bands* around the
# whole sphere: their boundary consists of two closed curves that each wrap 360deg
# in RA (one per side of the band). In a flat equirectangular raster such a band
# must be filled *between* those two curves. Smaller rings are holes (dark clouds).
import numpy as np
W, H = 2048, 1024
SS = 2  # supersampling
mw = json.load(open(os.path.join(src, 'mw.json')))['features']
levels = {'ol1': 48, 'ol2': 96, 'ol3': 144, 'ol4': 196, 'ol5': 255}
acc_img = np.zeros((H * SS, W * SS), dtype=np.uint8)

def unwrap(ring):
    pts, prev, acc = [], None, 0.0
    for lon, lat in ring:
        if prev is not None:
            d = lon - prev
            if d > 180: acc -= 360
            elif d < -180: acc += 360
        prev = lon
        pts.append((lon + acc, lat))
    return pts

def span(pts):
    lons = [p[0] for p in pts]
    return max(lons) - min(lons)

def to_px(lon, lat, shift):
    x = ((lon % 360.0 if False else lon) / 360.0 + shift) * W * SS
    y = (90.0 - lat) / 180.0 * H * SS
    return (x, y)

def draw_poly(canvas, pts, val):
    d = ImageDraw.Draw(canvas)
    for shift in (-1, 0, 1, 2):
        d.polygon([to_px(lon, lat, shift) for lon, lat in pts], fill=val)

order = ['ol1', 'ol2', 'ol3', 'ol4', 'ol5']
prev_val = 0
for lid in order:
    feats = [f for f in mw if f['id'] == lid]
    layer = Image.new('L', (W * SS, H * SS), 0)
    holes = Image.new('L', (W * SS, H * SS), 0)
    val = levels[lid]
    for f in feats:
        for poly in f['geometry']['coordinates']:
            rings = [unwrap(r) for r in poly]
            wrapping = [r for r in rings if span(r) > 300]
            normal = [r for r in rings if span(r) <= 300]
            if len(wrapping) == 2:
                a, b = wrapping
                # align b to a's longitude range
                ca = sum(p[0] for p in a) / len(a); cb = sum(p[0] for p in b) / len(b)
                k = round((ca - cb) / 360.0)
                b = [(lon + 360.0 * k, lat) for lon, lat in b]
                # Build the band polygon: a (as is) then b reversed. Both curves are closed
                # loops that advance 360deg; remove the closing duplicate point.
                a2 = a[:-1] if a[0] == a[-1] else a
                b2 = b[:-1] if b[0] == b[-1] else b
                # ensure a2 advances in +lon direction overall and b2 in -lon direction
                if a2[-1][0] < a2[0][0]: a2 = a2[::-1]
                if b2[-1][0] > b2[0][0]: b2 = b2[::-1]
                # extend a2 by one period so the polygon closes cleanly: a2 then a2[0]+360, then b2 shifted
                a_ext = a2 + [(a2[0][0] + 360.0, a2[0][1])]
                b_ext = [(b2[0][0] + 360.0, b2[0][1])] + b2 if b2[0][0] < a_ext[-1][0] - 180 else b2
                band = a_ext + b_ext
                draw_poly(layer, band, 255)
                # which ring is which (outer/inner) does not matter for 'between' fill
                for r in normal:
                    draw_poly(holes, r, 255)
            elif len(wrapping) == 1:
                print('WARNING: single wrapping ring in', lid, '- filling as cap not supported; skipped')
                for r in normal:
                    draw_poly(holes, r, 255)
            else:
                # d3-celestial stores the inner contour levels as one polygon whose
                # rings are independent filled regions (not holes), so fill every ring.
                for r in rings:
                    draw_poly(layer, r, 255)
    lay = np.array(layer) > 0
    hol = np.array(holes) > 0
    region = lay & ~hol
    acc_img[region] = val
    # holes inside this level fall back to the previous level's value
    acc_img[lay & hol] = np.maximum(acc_img[lay & hol], prev_val)
    prev_val = val
    print(lid, 'filled px', int(region.sum()))

img = Image.fromarray(acc_img, 'L')
wide = Image.new('L', (W * SS * 3, H * SS))
for i in range(3):
    wide.paste(img, (i * W * SS, 0))
wide = wide.filter(ImageFilter.GaussianBlur(10 * SS))
mwimg = wide.crop((W * SS, 0, 2 * W * SS, H * SS)).resize((W, H), Image.LANCZOS)
outp = os.path.join(root, 'public', 'textures', 'sky', 'milkyway_2048.png')
mwimg.save(outp, optimize=True)
print('milkyway png written', mwimg.size, os.path.getsize(outp) // 1024, 'KB')
