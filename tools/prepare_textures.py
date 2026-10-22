#!/usr/bin/env python3
"""Resize/convert source planet textures into public/textures.

Usage: python3 -I tools/prepare_textures.py <source_dir>
Sources (all public domain NASA imagery unless noted, see public/textures/CREDITS.md):
  day_5400.jpg   NASA Blue Marble NG w/ topography+bathymetry, Dec 2004, 5400x2700
  night_3km.jpg  NASA Black Marble 2016, 13500x6750
  clouds_8192.tif NASA Visible Earth cloud_combined 8192x4096
  moon_1k.jpg    NASA SVS LRO LROC color mosaic 1024x512
  earth_specular_2048.jpg / earth_normal_2048.jpg  three.js examples (MIT)
"""
import sys, os
from PIL import Image
Image.MAX_IMAGE_PIXELS = None

src = sys.argv[1]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'textures')

def save(img, name, q=88, mode='RGB'):
    path = os.path.join(out, name)
    img.convert(mode).save(path, quality=q, optimize=True, progressive=True)
    print(f"{name}: {img.size} -> {os.path.getsize(path)//1024} KB")

day = Image.open(os.path.join(src, 'day_5400.jpg'))
save(day, 'earth/earth_day_5400.jpg', q=90)

night = Image.open(os.path.join(src, 'night_3km.jpg'))
save(night.resize((4096, 2048), Image.LANCZOS), 'earth/earth_night_4096.jpg', q=85)

clouds = Image.open(os.path.join(src, 'clouds_8192.tif'))
save(clouds.resize((4096, 2048), Image.LANCZOS), 'earth/earth_clouds_4096.jpg', q=85, mode='L')

spec = Image.open(os.path.join(src, 'earth_specular_2048.jpg'))
save(spec, 'earth/earth_specular_2048.jpg', q=85, mode='L')

nrm = Image.open(os.path.join(src, 'earth_normal_2048.jpg'))
save(nrm, 'earth/earth_normal_2048.jpg', q=88)

moon = Image.open(os.path.join(src, 'moon_1k.jpg'))
save(moon, 'sky/moon_1024.jpg', q=88)
