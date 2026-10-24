#!/usr/bin/env python3
"""
Procedural spacesuit textures (tileable, PBR) for src/player/suit/*.

    python3 tools/prepare_suit_textures.py [--out public/textures/suit] [--size 2048]

Writes, for every set, <name>_albedo.jpg (sRGB), <name>_normal.png (OpenGL convention, +Y up) and
<name>_orm.jpg (R ambient occlusion, G roughness, B metalness — three.js aoMap / roughnessMap /
metalnessMap channel layout), at full size and at 1024 for the cheaper presets:

  fabric  outer layer of the Orlan: plain-weave canvas (round threads, over/under alternation, fibre
          noise), doubled ripstop threads every 16 threads, low-frequency puckering, faint grime
  rubber  glove palm / fingertip grip and boot sole: pebbled elastomer with tiny dimples
  metal   anodised / bare aluminium: fine brushing along U, rare scratches
  seam    stitched seam tape (strip, U along the seam): raised piping, two rows of lock stitches
  visor   polycarbonate / gold coating: almost flat, faint wiping marks and scratches (roughness only)
  knit    pique knit of the crew polo shirt; twill: cargo trousers; rib: socks, cuffs, collar
  skin    pores, fine crossing wrinkles, redness / melanin variation; hair: short strands with clumping

Everything is deterministic (fixed seeds) and generated from noise: no external images, no licence
constraints. Requires numpy and Pillow.
"""
import argparse
import os

import numpy as np
from PIL import Image

RNG = np.random.default_rng(1961)


# ------------------------------------------------------------------------------------------ helpers
def periodic_noise(n, scale, seed, aniso=(1.0, 1.0)):
    """Tileable band-limited noise (n x n), feature size ~ n/scale pixels; returns ~N(0,1)."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal((n, n))
    f = np.fft.fftfreq(n) * n
    fx, fy = np.meshgrid(f / aniso[0], f / aniso[1])
    r = np.sqrt(fx * fx + fy * fy)
    filt = np.exp(-(r / scale) ** 2)
    filt[0, 0] = 0
    out = np.real(np.fft.ifft2(np.fft.fft2(white) * filt))
    return out / (out.std() + 1e-9)


def fbm(n, base, octaves, seed, gain=0.5, aniso=(1.0, 1.0)):
    v = np.zeros((n, n))
    a, s = 1.0, base
    for i in range(octaves):
        v += a * periodic_noise(n, s, seed + i * 17, aniso)
        a *= gain
        s *= 2
    return v / (v.std() + 1e-9)


def normal_from_height(h, strength):
    """OpenGL normal map from a periodic height field (pixels)."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5
    nx, ny, nz = -dx * strength, dy * strength, np.ones_like(h)   # image rows go down: +V is up in GL
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln, ny / ln, nz / ln], axis=-1)


def cavity(h, radius_px):
    """Ambient-occlusion-like cavity: how far below its blurred neighbourhood each texel is."""
    k = max(1, int(radius_px))
    acc = np.zeros_like(h)
    cnt = 0
    for dy in range(-k, k + 1, max(1, k // 3)):
        for dx in range(-k, k + 1, max(1, k // 3)):
            acc += np.roll(np.roll(h, dy, axis=0), dx, axis=1)
            cnt += 1
    return h - acc / cnt


def to_srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def save_rgb(path, rgb01, quality=None):
    img = Image.fromarray((np.clip(rgb01, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB')
    if path.endswith('.jpg'):
        img.save(path, quality=quality or 92, subsampling=0)
    else:
        img.save(path, optimize=True)


def save_set(out, name, albedo_lin, nrm, ao, rough, metal, sizes):
    for s in sizes:
        suffix = '' if s == sizes[0] else f'_{s}'
        def rs(a, mode=Image.LANCZOS):
            if a.shape[0] == s:
                return a
            if a.ndim == 2:
                return np.asarray(Image.fromarray(a.astype(np.float32), 'F').resize((s, s), mode))
            return np.stack([np.asarray(Image.fromarray(a[..., i].astype(np.float32), 'F').resize((s, s), mode)) for i in range(a.shape[-1])], -1)
        alb = rs(albedo_lin)
        n = rs(nrm)
        n = n / np.linalg.norm(n, axis=-1, keepdims=True)
        save_rgb(os.path.join(out, f'{name}_albedo{suffix}.jpg'), to_srgb(alb), 93)
        save_rgb(os.path.join(out, f'{name}_normal{suffix}.png'), n * 0.5 + 0.5)
        orm = np.stack([rs(ao), rs(rough), rs(metal)], -1)
        save_rgb(os.path.join(out, f'{name}_orm{suffix}.jpg'), orm, 93)
        print(f'  {name}{suffix}: {s}x{s}')


# ------------------------------------------------------------------------------------------ fabric
def fabric(n):
    """Plain weave, 256 threads per tile (the material maps one tile to ~0.16 m: ~0.6 mm threads)."""
    threads = 256
    p = n / threads
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    u, v = x / p, y / p
    iu, iv = np.floor(u), np.floor(v)
    fu, fv = u - iu, v - iv
    # per-thread thickness / tone jitter (periodic: index modulo the thread count)
    jt = RNG.uniform(0.85, 1.15, threads)
    tone = RNG.normal(0, 1, threads)
    warp_w = jt[iu.astype(int) % threads]
    weft_w = jt[iv.astype(int) % threads]
    # ripstop: every 16th thread doubled and thicker
    rip_u = (iu.astype(int) % 16 == 0) | (iu.astype(int) % 16 == 1)
    rip_v = (iv.astype(int) % 16 == 0) | (iv.astype(int) % 16 == 1)
    sec_u = np.sqrt(np.clip(1 - (2 * fu - 1) ** 2 / np.clip(warp_w, 0.5, 2) ** 2, 0, 1))
    sec_v = np.sqrt(np.clip(1 - (2 * fv - 1) ** 2 / np.clip(weft_w, 0.5, 2) ** 2, 0, 1))
    warp = sec_u * (0.55 + 0.45 * np.sin(np.pi * v + np.pi * iu))
    weft = sec_v * (0.55 + 0.45 * np.sin(np.pi * u + np.pi * iv + np.pi))
    warp = warp * (1 + 0.45 * rip_u)
    weft = weft * (1 + 0.45 * rip_v)
    # fibres: fine noise stretched along each thread
    fib_w = periodic_noise(n, n / 3, 5, aniso=(1.0, 6.0))
    fib_f = periodic_noise(n, n / 3, 6, aniso=(6.0, 1.0))
    warp_top = warp >= weft
    h = np.where(warp_top, warp + 0.05 * fib_w, weft + 0.05 * fib_f)
    # puckering of the cloth and a soft quilting undulation
    puck = fbm(n, 6, 4, 21)
    h_low = 0.9 * puck
    height = h + h_low
    nrm = normal_from_height(height, 1.4)
    cav = cavity(h, p * 0.8)
    ao = np.clip(0.82 + 0.9 * cav, 0.45, 1.0)
    # albedo: off-white cloth, thread tone jitter, ripstop slightly brighter, cavities darker, faint grime
    thread_tone = np.where(warp_top, tone[iu.astype(int) % threads], tone[iv.astype(int) % threads])
    grime = fbm(n, 4, 5, 33)
    base = np.array([0.80, 0.79, 0.75])
    k = 1 + 0.025 * thread_tone + 0.05 * (rip_u | rip_v) + 0.35 * np.clip(cav, -0.4, 0.2) - 0.025 * np.clip(grime, 0, 3)
    alb = base[None, None, :] * k[..., None]
    alb[..., 2] *= 1 - 0.01 * np.clip(grime, 0, 3)
    rough = np.clip(0.80 - 0.10 * (h - 0.5) + 0.03 * grime, 0.55, 0.95)
    metal = np.zeros_like(h)
    return alb, nrm, ao, rough, metal


# ------------------------------------------------------------------------------------------ rubber
def rubber(n):
    rng = np.random.default_rng(77)
    h = np.zeros((n, n))
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    # pebbles on a jittered grid (periodic)
    cells = 96
    c = n / cells
    for j in range(cells):
        for i in range(cells):
            cx = (i + 0.5 + rng.uniform(-0.3, 0.3)) * c
            cy = (j + 0.5 + rng.uniform(-0.3, 0.3)) * c
            r = c * rng.uniform(0.32, 0.45)
            x0, x1 = int(cx - 2 * r), int(cx + 2 * r) + 1
            y0, y1 = int(cy - 2 * r), int(cy + 2 * r) + 1
            xs = np.arange(x0, x1) % n
            ys = np.arange(y0, y1) % n
            gx, gy = np.meshgrid(np.arange(x0, x1) - cx, np.arange(y0, y1) - cy)
            bump = np.exp(-(gx * gx + gy * gy) / (r * r))
            h[np.ix_(ys, xs)] = np.maximum(h[np.ix_(ys, xs)], bump)
    h += 0.08 * periodic_noise(n, n / 4, 91)
    nrm = normal_from_height(h * 6, 1.0)
    ao = np.clip(0.75 + 0.5 * cavity(h, c * 0.6), 0.4, 1.0)
    alb = np.ones((n, n, 3)) * np.array([0.045, 0.045, 0.048])[None, None, :] * (1 + 0.25 * periodic_noise(n, 12, 92))[..., None]
    rough = np.clip(0.78 - 0.18 * h + 0.04 * periodic_noise(n, 20, 93), 0.5, 0.95)
    return alb, nrm, ao, rough, np.zeros_like(h)


# ------------------------------------------------------------------------------------------ metal
def metal(n):
    brush = periodic_noise(n, n / 2, 101, aniso=(40.0, 1.0)) + 0.5 * periodic_noise(n, n / 6, 102, aniso=(20.0, 1.0))
    h = 0.02 * brush
    rng = np.random.default_rng(103)
    scr = np.zeros((n, n))
    for _ in range(60):
        x0, y0 = rng.uniform(0, n, 2)
        a = rng.uniform(0, np.pi)
        L = rng.uniform(n * 0.02, n * 0.15)
        t = np.linspace(0, 1, int(L))
        xs = ((x0 + np.cos(a) * L * t) % n).astype(int)
        ys = ((y0 + np.sin(a) * L * t) % n).astype(int)
        scr[ys, xs] = rng.uniform(0.3, 1.0)
    h -= 0.4 * scr
    nrm = normal_from_height(h, 2.0)
    rough = np.clip(0.30 + 0.06 * brush + 0.25 * scr, 0.12, 0.7)
    alb = np.ones((n, n, 3)) * (0.92 + 0.02 * brush)[..., None]
    return alb, nrm, np.ones((n, n)), rough, np.ones((n, n))


# ------------------------------------------------------------------------------------------ seam
def seam(n):
    """Square tile; the seam runs along U (x). V: 0..1 across the tape (piping in the middle)."""
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    v = y / n
    u = x / n
    piping = np.exp(-((v - 0.5) / 0.12) ** 2)
    edge = 0.25 * (np.exp(-((v - 0.16) / 0.05) ** 2) + np.exp(-((v - 0.84) / 0.05) ** 2))
    # lock stitches: 24 per tile on each row, slanted dashes
    stitches = np.zeros_like(u)
    for row, slant in ((0.28, 0.3), (0.72, -0.3)):
        k = 24
        su = (u * k + slant * (v - row) * 4) % 1.0
        dash = np.clip(1 - np.abs(su - 0.5) / 0.36, 0, 1) ** 0.5
        across = np.exp(-((v - row) / 0.035) ** 2)
        stitches = np.maximum(stitches, dash * across)
    fib = periodic_noise(n, n / 4, 111, aniso=(8.0, 1.0))
    h = 0.6 * piping + edge + 0.35 * stitches + 0.03 * fib
    nrm = normal_from_height(h * (n / 64), 1.0)
    cav = cavity(h, n / 40)
    ao = np.clip(0.85 + 1.2 * cav, 0.5, 1.0)
    base = np.array([0.80, 0.79, 0.75])
    k = 1 + 0.3 * np.clip(cav, -0.3, 0.1) - 0.10 * stitches + 0.02 * fib
    alb = base[None, None, :] * k[..., None]
    rough = np.clip(0.78 - 0.12 * stitches, 0.5, 0.95)
    return alb, nrm, ao, rough, np.zeros_like(h)


# ------------------------------------------------------------------------------------------ visor
def visor(n):
    wipe = periodic_noise(n, 3, 121) * 0.5 + periodic_noise(n, 24, 122, aniso=(1.0, 3.0)) * 0.3
    rng = np.random.default_rng(123)
    scr = np.zeros((n, n))
    for _ in range(140):
        x0, y0 = rng.uniform(0, n, 2)
        a = rng.uniform(0, np.pi)
        L = rng.uniform(n * 0.01, n * 0.08)
        t = np.linspace(0, 1, int(L))
        xs = ((x0 + np.cos(a) * L * t) % n).astype(int)
        ys = ((y0 + np.sin(a) * L * t) % n).astype(int)
        scr[ys, xs] = 1.0
    rough = np.clip(0.03 + 0.03 * np.clip(wipe, 0, 3) + 0.25 * scr, 0.02, 0.4)
    nrm = normal_from_height(-0.2 * scr, 1.0)
    return np.ones((n, n, 3)), nrm, np.ones((n, n)), rough, np.ones((n, n))



# ------------------------------------------------------------------------------------------ crew clothing / skin
def knit(n):
    """Pique knit (polo shirt): staggered loops (~1.2 mm with the material's 0.12 m tile)."""
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    cols = 96
    p = n / cols
    u, v = x / p, y / (p * 0.8)
    row = np.floor(v)
    uu = u + 0.5 * (row % 2)
    fu, fv = uu - np.floor(uu), v - row
    loop = np.sqrt(np.clip(1 - ((fu - 0.5) / 0.48) ** 2 - ((fv - 0.5) / 0.6) ** 2, 0, 1))
    # pique: every other loop row is a raised tuck
    tuck = 0.35 * ((row % 4) < 2) * loop
    fib = periodic_noise(n, n / 4, 131, aniso=(1.0, 3.0))
    h = loop + tuck + 0.06 * fib + 0.4 * fbm(n, 5, 3, 132)
    nrm = normal_from_height(h, 1.6)
    cav = cavity(loop, p * 0.5)
    ao = np.clip(0.8 + cav, 0.45, 1.0)
    alb = np.ones((n, n, 3)) * (0.8 + 0.25 * np.clip(cav, -0.4, 0.2) + 0.015 * fib)[..., None]
    rough = np.clip(0.88 - 0.06 * loop, 0.6, 0.97)
    return alb, nrm, ao, rough, np.zeros_like(h)


def twill(n):
    """2/1 twill (cargo trousers): diagonal wales, ~0.7 mm yarns with a 0.14 m tile."""
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    threads = 192
    p = n / threads
    u, v = x / p, y / p
    iu, iv = np.floor(u), np.floor(v)
    fu, fv = u - iu, v - iv
    over = ((iu - iv) % 3) != 0          # warp floats over two wefts, under one: diagonal wales
    sec_u = np.sqrt(np.clip(1 - (2 * fu - 1) ** 2, 0, 1))
    sec_v = np.sqrt(np.clip(1 - (2 * fv - 1) ** 2, 0, 1))
    fib = periodic_noise(n, n / 3, 141, aniso=(1.0, 6.0))
    h = np.where(over, sec_u * (0.8 + 0.08 * fib), sec_v * 0.6)
    h = h + 0.5 * fbm(n, 6, 3, 142)
    nrm = normal_from_height(h, 1.3)
    cav = cavity(np.where(over, sec_u, sec_v * 0.6), p * 0.7)
    ao = np.clip(0.82 + cav, 0.5, 1.0)
    tone = 1 + 0.06 * (over - 0.5) + 0.3 * np.clip(cav, -0.3, 0.2) + 0.02 * fib
    alb = np.ones((n, n, 3)) * tone[..., None] * 0.8
    rough = np.clip(0.86 - 0.05 * h, 0.6, 0.97)
    return alb, nrm, ao, rough, np.zeros_like(h)


def rib(n):
    """1x1 rib knit (socks, shirt cuffs and collar): vertical wales of stacked V loops."""
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    cols = 64
    p = n / cols
    u, v = x / p, y / (p * 0.7)
    iu = np.floor(u)
    fu = u - iu
    fv = v - np.floor(v)
    wale = np.sqrt(np.clip(1 - (2 * fu - 1) ** 2, 0, 1)) * (0.75 + 0.25 * np.abs(np.sin(np.pi * (fv + (fu - 0.5) * 0.6))))
    front = (iu % 2) == 0
    h = np.where(front, wale, 0.45 * wale) + 0.05 * periodic_noise(n, n / 4, 151, aniso=(1.0, 4.0))
    nrm = normal_from_height(h, 2.0)
    ao = np.clip(0.75 + 0.6 * cavity(h, p * 0.6), 0.4, 1.0)
    alb = np.ones((n, n, 3)) * (0.78 + 0.08 * h)[..., None]
    rough = np.clip(0.9 - 0.05 * h, 0.7, 0.98)
    return alb, nrm, ao, rough, np.zeros_like(h)


def skin(n):
    """Skin: pores, fine crossing wrinkles, blotchy redness / melanin variation (0.08 m tile)."""
    rng = np.random.default_rng(161)
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    # pores: sparse small dimples (jittered grid, periodic)
    cells = 128
    c = n / cells
    jx = rng.uniform(-0.35, 0.35, (cells, cells))
    jy = rng.uniform(-0.35, 0.35, (cells, cells))
    gi, gj = (x / c).astype(int) % cells, (y / c).astype(int) % cells
    px = (gi + 0.5 + jx[gj, gi]) * c
    py = (gj + 0.5 + jy[gj, gi]) * c
    dx = (x - px + n / 2) % n - n / 2
    dy = (y - py + n / 2) % n - n / 2
    size = c * (0.16 + 0.1 * rng.uniform(0, 1, (cells, cells))[gj, gi])
    pores = np.exp(-(dx * dx + dy * dy) / (size * size))
    # wrinkles: two crossing families of fine grooves, broken up by noise
    w1 = np.abs(np.sin((x * 0.92 + y * 0.38) / n * 2 * np.pi * 38 + 3 * fbm(n, 6, 2, 162)))
    w2 = np.abs(np.sin((x * -0.4 + y * 0.92) / n * 2 * np.pi * 31 + 3 * fbm(n, 6, 2, 163)))
    wr = (np.clip(1 - w1 / 0.12, 0, 1) + np.clip(1 - w2 / 0.12, 0, 1)) * np.clip(0.5 + 0.5 * fbm(n, 8, 3, 164), 0, 1)
    micro = periodic_noise(n, n / 5, 165)
    h = -0.6 * pores - 0.35 * wr + 0.05 * micro + 0.3 * fbm(n, 10, 3, 166)
    nrm = normal_from_height(h, 1.1)
    ao = np.clip(1 - 0.25 * pores - 0.12 * wr, 0.6, 1.0)
    # albedo (linear): light skin, redness blotches, melanin spots, pores slightly darker
    red = np.clip(fbm(n, 4, 4, 167), -2, 3)
    mel = np.clip(fbm(n, 40, 2, 168) - 2.0, 0, 1)
    base = np.array([0.60, 0.40, 0.31])
    alb = base[None, None, :] * (1 + 0.04 * micro)[..., None]
    alb[..., 0] *= 1 + 0.035 * red
    alb[..., 1] *= 1 - 0.04 * red
    alb[..., 2] *= 1 - 0.03 * red
    alb *= (1 - 0.12 * mel - 0.12 * pores - 0.05 * wr)[..., None]
    rough = np.clip(0.52 + 0.12 * pores + 0.06 * wr + 0.05 * micro, 0.35, 0.8)
    return alb, nrm, ao, rough, np.zeros_like(h)


def hair(n):
    """Short hair: strands along V with clumping; albedo dark brown, roughness for a soft sheen."""
    strands = periodic_noise(n, n / 2, 171, aniso=(1.0, 30.0)) + 0.6 * periodic_noise(n, n / 8, 172, aniso=(1.0, 12.0))
    clump = fbm(n, 10, 3, 173)
    h = 0.5 * strands + 0.3 * clump
    nrm = normal_from_height(h, 3.0)
    ao = np.clip(0.75 + 0.12 * strands, 0.4, 1.0)
    alb = np.ones((n, n, 3)) * np.array([0.055, 0.035, 0.022])[None, None, :] * (1 + 0.35 * strands + 0.2 * clump)[..., None]
    rough = np.clip(0.55 + 0.08 * strands, 0.35, 0.8)
    return alb, nrm, ao, rough, np.zeros_like(h)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'public', 'textures', 'suit'))
    ap.add_argument('--size', type=int, default=2048)
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    N = a.size
    sets = {
        'fabric': (fabric, N),
        'rubber': (rubber, N // 2),
        'metal': (metal, N // 2),
        'seam': (seam, N // 4),
        'visor': (visor, N // 2),
        'knit': (knit, N // 2),
        'twill': (twill, N // 2),
        'rib': (rib, N // 4),
        'skin': (skin, N // 2),
        'hair': (hair, N // 4),
    }
    for name, (fn, n) in sets.items():
        if a.only and name not in a.only.split(','):
            continue
        print(name)
        alb, nrm, ao, rough, met = fn(n)
        sizes = [n] + ([1024] if n > 1024 else []) + ([512] if n > 512 and name in ('fabric', 'rubber', 'skin', 'knit', 'twill') else [])
        save_set(a.out, name, alb, nrm, ao, rough, met, sizes)


if __name__ == '__main__':
    main()
