#!/usr/bin/env python3
"""16K Moon colour + normal map as 4x2 tiles of 4096x4096 (for low lunar orbit: load only the tiles under the camera).

A single 16384x8192 RGB texture needs ~0.75 GB of GPU memory (1 GB with mipmaps), so the 16K level is tiled.
Tile (row r, col c): r = 0 north (lat +90..0), r = 1 south (0..-90); c = 0..3 covers longitude
-180 + 90c .. -180 + 90(c+1) deg (east-positive, same plate carree as the full maps). Each tile is 90 x 90 deg,
4096 px -> 45.5 px/deg (0.67 km/px at the equator).
Normals: computed from LOLA 64 px/deg heights area-resampled to 16384x8192, true (1x) relief, same encoding as
moon_normal_8192.jpg (R=+east, G=+north, B=up, OpenGL convention).
Usage: python3 -I build_moon_tiles.py <srcdir with ldem_64_uint.tif and lroc_color_16bit_srgb_16k.tif> <outdir>
"""
import sys, os
sys.path.append(os.path.expanduser('~/.local/lib/python3.13/site-packages'))
import numpy as np, tifffile
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src, out = sys.argv[1:3]
os.makedirs(out, exist_ok=True)
W, H, T = 16384, 8192, 4096
R = 1737400.0

def tiles(arr, name, q, sub):
    for r in range(2):
        for c in range(4):
            p = os.path.join(out, f'{name}_r{r}c{c}.jpg')
            Image.fromarray(np.ascontiguousarray(arr[r * T:(r + 1) * T, c * T:(c + 1) * T]), 'RGB').save(
                p, quality=q, subsampling=sub, optimize=True, progressive=True)
            print(os.path.basename(p), os.path.getsize(p) // 1024, 'KB', flush=True)

# normals
h = tifffile.imread(os.path.join(src, 'ldem_64_uint.tif'))
him = Image.fromarray(((h.astype(np.float32) - 20000.0) * 0.5), 'F'); del h
z = np.asarray(him.resize((W, H), Image.BOX), dtype=np.float32); del him
lat = (90.0 - (np.arange(H) + 0.5) * 180.0 / H) * np.pi / 180.0
dx = (R * np.cos(lat) * (2 * np.pi / W)).astype(np.float32)[:, None]
dy = np.float32(R * np.pi / H)
nx = -(np.roll(z, -1, axis=1) - np.roll(z, 1, axis=1)) / (2 * dx)
ny = np.empty_like(z)
ny[1:-1] = -(z[:-2] - z[2:]) / (2 * dy); ny[0] = ny[1]; ny[-1] = ny[-2]
del z
l = np.sqrt(nx * nx + ny * ny + 1.0)
enc = np.empty((H, W, 3), np.uint8)
enc[..., 0] = np.clip(np.round((nx / l + 1) * 127.5), 0, 255)
enc[..., 1] = np.clip(np.round((ny / l + 1) * 127.5), 0, 255)
enc[..., 2] = np.clip(np.round((1 / l + 1) * 127.5), 0, 255)
del nx, ny, l
tiles(enc, 'moon_normal16k', 95, 0); del enc
# colour
c = tifffile.imread(os.path.join(src, 'lroc_color_16bit_srgb_16k.tif'))
c8 = ((c.astype(np.uint32) * 255 + 32767) // 65535).astype(np.uint8); del c
tiles(c8, 'moon_color16k', 90, 2)
