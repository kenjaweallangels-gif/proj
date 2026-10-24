#!/usr/bin/env python3
"""Download the land tiles of the AWS Terrain Tiles (Mapzen "terrarium" PNG, 16-bit elevation encoded in RGB) at one
zoom level, for tools/prepare_earth_textures.py (steps 'dem', 'relief').

Usage: python3 -I tools/fetch_terrain_tiles.py <out dir> [zoom=7] [max |lat|=76]
Tiles with no land (from public/textures/earth/earth_aux_2048.png) are skipped. Zoom 7 = 128 x 128 Web-Mercator
tiles of 256 px (1.2 km/px at the equator, 0.8 km at 50 deg): about 4000 land tiles, ~350 MB.
Source: https://registry.opendata.aws/terrain-tiles/ (SRTM, GMTED2010, ETOPO1 and others; see CREDITS.md).
"""
import sys, os, math, subprocess
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image

out = sys.argv[1]
z = int(sys.argv[2]) if len(sys.argv) > 2 else 7
maxlat = float(sys.argv[3]) if len(sys.argv) > 3 else 76.0
n = 1 << z
os.makedirs(out, exist_ok=True)
aux = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'textures', 'earth', 'earth_aux_2048.png')
land = np.asarray(Image.open(aux).convert('RGB'))[..., 0].astype(np.float32) / 255.0
H, W = land.shape


def tile_lat(y):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))


jobs = []
for y in range(n):
    la0, la1 = tile_lat(y + 1), tile_lat(y)
    if la1 < -maxlat or la0 > maxlat:
        continue
    r0 = max(0, int((90 - la1) / 180 * H) - 1)
    r1 = min(H, int((90 - la0) / 180 * H) + 2)
    for x in range(n):
        c0 = max(0, int(x / n * W) - 1)
        c1 = min(W, int((x + 1) / n * W) + 2)
        if land[r0:r1, c0:c1].max() > 0.02:
            jobs.append((x, y))
print(len(jobs), 'land tiles', flush=True)


def get(job):
    x, y = job
    f = os.path.join(out, f'{z}_{x}_{y}.png')
    if os.path.exists(f) and os.path.getsize(f) > 0:
        return 0
    url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
    r = subprocess.run(['curl', '-sSL', '--fail', '--retry', '3', '--max-time', '120', url, '-o', f])
    return r.returncode


with ThreadPoolExecutor(16) as ex:
    fails = sum(1 for rc in ex.map(get, jobs) if rc)
print('failed', fails)
