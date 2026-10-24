#!/usr/bin/env python3
"""Moon textures from the NASA SVS CGI Moon Kit (ID 4720).

Inputs:
  lroc_color_16bit_srgb_16k.tif  16384x8192 RGB uint16 sRGB (2025 LROC WAC Hapke-normalised colour mosaic)
  ldem_64_uint.tif               23040x11520 uint16, LOLA 64 px/deg, half-metres, +20000 offset
                                 (height_m = (v - 20000) * 0.5 relative to the 1737.4 km reference sphere)
All maps: simple cylindrical, centred on 0 deg longitude: column 0 = 180 W, longitude increases eastward
to the right; row 0 = +90 (north). Pixel j covers lon [-180 + j*360/W, -180 + (j+1)*360/W].

Outputs (outdir):
  moon_color_{16384,8192,4096,2048}.jpg   sRGB colour (16384 optional, see --no16k)
  moon_height_4096x2048.u16               raw little-endian uint16, same encoding as LOLA:
                                          height_m = (v - 20000) * 0.5 above R = 1737400 m
  moon_height_4096x2048.png               the same values as a 16-bit greyscale PNG (lossless archive copy;
                                          browsers decode PNG to 8 bit, so load the .u16 in the app)
  moon_normal_8192.png / .jpg             tangent-space normal map at true (1x) relief, OpenGL convention:
                                          R = +east (+u), G = +north (+v when the texture is loaded with
                                          flipY = true, three.js default), B = up; n = (c+1)/2*255
Usage: python3 -I build_moon.py <srcdir> <outdir>
"""
import sys, os
sys.path.append(os.path.expanduser('~/.local/lib/python3.13/site-packages'))
import numpy as np
import tifffile
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
R_MOON = 1737400.0

def save_jpg(img, name, q=90):
    p = os.path.join(out, name)
    img.save(p, quality=q, subsampling=0 if q >= 92 else 2, optimize=True, progressive=True)
    print(p, img.size, os.path.getsize(p) // 1024, 'KB', flush=True)

# ---------------- elevation ----------------
h = tifffile.imread(os.path.join(src, 'ldem_64_uint.tif'))
print('ldem', h.shape, h.dtype, h.min(), h.max(), flush=True)
hm = (h.astype(np.float32) - 20000.0) * 0.5          # metres above 1737.4 km
del h
print('height range m', float(hm.min()), float(hm.max()), flush=True)
him = Image.fromarray(hm, 'F')
del hm

def area_resize(im, w, hgt):
    return np.asarray(im.resize((w, hgt), Image.BOX), dtype=np.float32)

# displacement 4096x2048
d = area_resize(him, 4096, 2048)
u = np.clip(np.round(d / 0.5 + 20000.0), 0, 65535).astype('<u2')
u.tofile(os.path.join(out, 'moon_height_4096x2048.u16'))
Image.fromarray(u.astype(np.uint16)).save(os.path.join(out, 'moon_height_4096x2048.png'), optimize=True)
for n in ('moon_height_4096x2048.u16', 'moon_height_4096x2048.png'):
    print(n, os.path.getsize(os.path.join(out, n)) // 1024, 'KB', flush=True)
del d, u

# normal map 8192x4096 from the 64 ppd heights (area-averaged to the output grid first)
W, H = 8192, 4096
z = area_resize(him, W, H).astype(np.float64)
del him
lat = (90.0 - (np.arange(H) + 0.5) * 180.0 / H) * np.pi / 180.0
dx = R_MOON * np.cos(lat)[:, None] * (2 * np.pi / W)   # metres per pixel eastward
dy = R_MOON * np.pi / H                                 # metres per pixel northward
dzdx = (np.roll(z, -1, axis=1) - np.roll(z, 1, axis=1)) / (2 * dx)          # east (wraps in longitude)
zn = np.vstack([z[:1], z, z[-1:]])
dzdy = (zn[:-2] - zn[2:]) / (2 * dy)                    # row-1 is north
del z, zn
nx, ny, nz = -dzdx, -dzdy, np.ones_like(dzdx)
l = np.sqrt(nx * nx + ny * ny + 1.0)
rgb = np.stack([nx / l, ny / l, nz / l], axis=-1)
del nx, ny, nz, l, dzdx, dzdy
enc = np.clip(np.round((rgb + 1.0) * 127.5), 0, 255).astype(np.uint8)
del rgb
nim = Image.fromarray(enc, 'RGB')
p = os.path.join(out, 'moon_normal_8192.png'); nim.save(p, optimize=True)
print(p, os.path.getsize(p) // 1024, 'KB', flush=True)
save_jpg(nim, 'moon_normal_8192.jpg', q=95)
del nim, enc

# ---------------- colour ----------------
c = tifffile.imread(os.path.join(src, 'lroc_color_16bit_srgb_16k.tif'))
print('colour', c.shape, c.dtype, flush=True)
c8 = ((c.astype(np.uint32) * 255 + 32767) // 65535).astype(np.uint8)
del c
cim = Image.fromarray(c8, 'RGB'); del c8
if '--no16k' not in sys.argv:
    save_jpg(cim, 'moon_color_16384.jpg', q=88)
for w in (8192, 4096, 2048):
    cim = cim.resize((w, w // 2), Image.LANCZOS)
    save_jpg(cim, f'moon_color_{w}.jpg', q=90)
