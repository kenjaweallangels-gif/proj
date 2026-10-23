#!/usr/bin/env python3
"""High-detail Earth textures for the 'ultra' / 'high' presets.

Usage: python3 -I tools/prepare_textures_8k.py <dir with day_21600.jpg, elev_21600.png> <dir with night_3km.jpg, clouds_8192.tif>
Sources (NASA, public domain):
  day_21600.jpg   Blue Marble Next Generation w/ topography & bathymetry, Dec 2004, 21600x10800
  elev_21600.png  GEBCO_08 relief (land elevation, ocean = 0), 21600x10800
  night_3km.jpg   Black Marble 2016, 13500x6750
  clouds_8192.tif Visible Earth cloud_combined, 8192x4096
Outputs public/textures/earth/:
  earth_day_8192.jpg      8192x4096 colour
  earth_clouds_8192.jpg   8192x4096 grey (loaded as a single-channel texture)
  earth_night_4096_hq.jpg 4096x2048 (Black Marble, sharper resample)
  earth_ocean_4096.png    4096x2048 ocean mask (1 = water) from GEBCO
  earth_normal_4096.jpg   4096x2048 tangent-space normal map from GEBCO relief (+X east, +Y north)
"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter
Image.MAX_IMAGE_PIXELS = None

a, b = sys.argv[1], sys.argv[2]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'textures', 'earth')

def save(img, name, **kw):
    p = os.path.join(out, name); img.save(p, **kw); print(f'{name}: {img.size} {img.mode} {os.path.getsize(p) // 1024} KB')

day = Image.open(os.path.join(a, 'day_21600.jpg')).convert('RGB')
save(day.resize((8192, 4096), Image.LANCZOS), 'earth_day_8192.jpg', quality=90, optimize=True, progressive=True)
del day

clouds = Image.open(os.path.join(b, 'clouds_8192.tif')).convert('L')
save(clouds, 'earth_clouds_8192.jpg', quality=88, optimize=True, progressive=True)

night = Image.open(os.path.join(b, 'night_3km.jpg')).convert('RGB')
save(night.resize((4096, 2048), Image.LANCZOS), 'earth_night_4096_hq.jpg', quality=88, optimize=True, progressive=True)

elev = Image.open(os.path.join(a, 'elev_21600.png')).convert('L')
e4 = elev.resize((4096, 2048), Image.BOX)
ocean = (np.array(elev.resize((4096, 2048), Image.BOX), dtype=np.float32) <= 0.5).astype(np.float32)
# soften the coastline a little (bilinear-friendly mask)
ocean_img = Image.fromarray((ocean * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(0.8))
save(ocean_img, 'earth_ocean_4096.png', optimize=True)

# normal map from relief: GEBCO_08 'rev_elev' maps 0..6400 m (approx.) to 0..255
h = np.array(e4, dtype=np.float32) * (6400.0 / 255.0)          # metres
H, W = h.shape
R = 6371000.0
lat = (0.5 - (np.arange(H) + 0.5) / H) * np.pi
dx = (2 * np.pi * R / W) * np.maximum(np.cos(lat), 0.02)[:, None]   # metres per pixel east-west
dy = np.pi * R / H                                                  # metres per pixel north-south
gx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * dx)
gy = (np.roll(h, 1, axis=0) - np.roll(h, -1, axis=0)) / (2 * dy)    # +north
exaggeration = 18.0                                                  # relief is tiny vs the pixel size; exaggerate for readable shading
nx, ny, nz = -gx * exaggeration, -gy * exaggeration, np.ones_like(h)
l = np.sqrt(nx * nx + ny * ny + nz * nz)
nrm = np.stack([nx / l, ny / l, nz / l], axis=-1) * 0.5 + 0.5
save(Image.fromarray((nrm * 255).clip(0, 255).astype(np.uint8), 'RGB'), 'earth_normal_4096.jpg', quality=92, optimize=True)
