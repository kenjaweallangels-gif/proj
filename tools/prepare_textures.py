#!/usr/bin/env python3
"""Resize/convert the Moon texture into public/textures/sky.

Usage: python3 -I tools/prepare_textures.py <source_dir>
Source: moon_1k.jpg  NASA SVS LRO LROC color mosaic 1024x512 (public domain, see public/textures/CREDITS.md).
The Earth textures are built by tools/prepare_earth_textures.py (sources: tools/fetch_earth_sources.sh).
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

moon = Image.open(os.path.join(src, 'moon_1k.jpg'))
save(moon, 'sky/moon_1024.jpg', q=88)
