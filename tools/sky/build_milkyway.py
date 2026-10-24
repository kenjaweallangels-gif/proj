#!/usr/bin/env python3
"""Milky Way background from NASA SVS "Deep Star Maps 2020" (ID 4851), milkyway_2020_8k.exr.

That map is the Gaia DR2 star field WITHOUT the Hipparcos-2 and Tycho-2 stars (all stars brighter than
about V 11.5 are omitted), i.e. the complement of a HIP+TYC catalogue.

Input (SVS): plate carree, ICRF/J2000 RA/Dec, linear half-float RGB, image centre = RA 0h, RA increasing
to the LEFT, top row = Dec +90.
Output: re-projected to the project convention used by public/textures/sky/milkyway_2048.png and the
Milky Way shader:  u = RA/360 (column 0 starts at RA 0h, RA increases to the RIGHT), v = (90-Dec)/180
(row 0 = north), pixel j covers RA [j, j+1]*360/W.  Pixel values are encoded with the standard sRGB transfer
function, so a texture loaded with colorSpace = SRGBColorSpace returns the SVS linear value directly
(SVS linear range 0..1, median ~0.014).

Usage: python3 -I build_milkyway.py <milkyway_2020_8k.exr> <outdir>
"""
import sys, os
sys.path.append(os.path.expanduser('~/.local/lib/python3.13/site-packages'))
import numpy as np
import OpenEXR
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
f = OpenEXR.File(src, separate_channels=True)
ch = f.channels()
img = np.stack([ch[c].pixels.astype(np.float32) for c in 'RGB'], axis=-1)
H, W, _ = img.shape
assert W == 2 * H
# SVS column i has centre RA = (W/2 - i - 0.5)*360/W  ->  project column j = (W/2 - 1 - i) mod W
idx = (W // 2 - 1 - np.arange(W)) % W
img = img[:, idx, :]
np.clip(img, 0.0, None, out=img)

def srgb_encode(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)

def save(a, w):
    e = (srgb_encode(a) * 255.0 + 0.5).astype(np.uint8)
    p = os.path.join(out, f'milkyway_{w}.jpg')
    Image.fromarray(e, 'RGB').save(p, quality=90, subsampling=0, optimize=True, progressive=True)
    print(p, e.shape, os.path.getsize(p) // 1024, 'KB')

a = img
while a.shape[1] >= 2048:
    save(a, a.shape[1])
    a = a.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2, 3).mean(axis=(1, 3))  # box filter in linear light
