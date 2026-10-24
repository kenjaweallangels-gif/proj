#!/usr/bin/env python3
"""Planet textures.

Primary: Solar System Scope texture pack (https://www.solarsystemscope.com/textures/, CC BY 4.0, INOVE):
equirectangular (plate carree) maps, 2:1, north up. 2K maps are copied unchanged (no re-encode); 4K maps for
Mars and Mercury are downsampled from the 8K maps; Jupiter's "8k" file is really 4096x2048.
Bonus: NASA/JPL/SSI Cassini cylindrical map of Jupiter (PIA07782, public domain) resampled to 3600x1800
(planetocentric latitude, equal-angle cylindrical).

Saturn ring (SSS 8k_saturn_ring_alpha.png, 8192x500 RGBA strip, radial direction along x, inner edge left):
measured edges in the alpha profile give the radius mapping used in planets.json:
B-ring outer edge (117 580 km) at x = 5505, A-ring outer edge (136 775 km) at x = 7712 of 8192
-> r(u) = 69 700 km + u * 71 250 km (u = 0..1 across the texture); F ring falls at 140 320 km (true 140 180).
Output ring: 2048x64 RGBA PNG (radial profile repeated in v), plus the original 2048x125 copy.

Usage: python3 -I build_planets.py <sss dir> <nasa dir> <outdir>
"""
import sys, os, shutil
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
sss, nasa, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)

def cp(src, dst):
    shutil.copyfile(os.path.join(sss, src), os.path.join(out, dst))
    print(dst, Image.open(os.path.join(out, dst)).size, os.path.getsize(os.path.join(out, dst)) // 1024, 'KB')

def down(src, dst, w, base=sss, q=90):
    im = Image.open(os.path.join(base, src)).convert('RGB')
    if im.width != w:
        im = im.resize((w, w // 2), Image.LANCZOS)
    im.save(os.path.join(out, dst), quality=q, optimize=True, progressive=True)
    print(dst, im.size, os.path.getsize(os.path.join(out, dst)) // 1024, 'KB')

cp('2k_mercury.jpg', 'mercury_2048.jpg')
down('8k_mercury.jpg', 'mercury_4096.jpg', 4096)
cp('2k_venus_surface.jpg', 'venus_surface_2048.jpg')
cp('2k_venus_atmosphere.jpg', 'venus_clouds_2048.jpg')
cp('4k_venus_atmosphere.jpg', 'venus_clouds_4096.jpg')
cp('2k_mars.jpg', 'mars_2048.jpg')
down('8k_mars.jpg', 'mars_4096.jpg', 4096)
cp('2k_jupiter.jpg', 'jupiter_2048.jpg')
cp('8k_jupiter.jpg', 'jupiter_4096.jpg')          # SSS "8k" Jupiter is 4096x2048
cp('2k_saturn.jpg', 'saturn_2048.jpg')
cp('2k_uranus.jpg', 'uranus_2048.jpg')
cp('2k_neptune.jpg', 'neptune_2048.jpg')
cp('2k_saturn_ring_alpha.png', 'saturn_ring_2048x125.png')
# compact ring strip: average the 8K strip vertically, resample radially to 2048, repeat 64 rows
r = np.asarray(Image.open(os.path.join(sss, '8k_saturn_ring_alpha.png')).convert('RGBA'), dtype=np.float32)
prof = r.mean(axis=0)                                  # 8192 x 4 (straight alpha)
rgb = prof[:, :3] * prof[:, 3:4]; a = prof[:, 3]
rgb4 = rgb.reshape(2048, 4, 3).sum(1); a4 = a.reshape(2048, 4).sum(1)
col = np.where(a4[:, None] > 0, rgb4 / np.maximum(a4[:, None], 1e-6), 0)
ring = np.concatenate([col, (a4 / 4)[:, None]], axis=1)
ring = np.clip(np.round(np.repeat(ring[None], 64, axis=0)), 0, 255).astype(np.uint8)
Image.fromarray(ring, 'RGBA').save(os.path.join(out, 'saturn_ring_2048x64.png'), optimize=True)
print('saturn_ring_2048x64.png', os.path.getsize(os.path.join(out, 'saturn_ring_2048x64.png')) // 1024, 'KB')
# Cassini map is 3601x1801 with both +-180 deg edge columns/rows: resample to 3600x1800 (pixel = 0.1 deg)
im = Image.open(os.path.join(nasa, 'PIA07782.jpg')).convert('RGB').resize((3600, 1800), Image.LANCZOS)
im.save(os.path.join(out, 'jupiter_cassini_3600.jpg'), quality=92, optimize=True, progressive=True)
print('jupiter_cassini_3600.jpg', im.size, os.path.getsize(os.path.join(out, 'jupiter_cassini_3600.jpg')) // 1024, 'KB')
