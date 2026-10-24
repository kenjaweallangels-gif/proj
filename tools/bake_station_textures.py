#!/usr/bin/env python3
"""
Bake the station / ship PBR texture sets (public/textures/station/) from CC0 material scans (ambientCG, fetched by
tools/fetch_station_textures.py) plus procedural layout (panel seams, rivet rows, stencils, wear, grime).

    python3 tools/fetch_station_textures.py --dest SRC
    python3 tools/bake_station_textures.py --src SRC [--size 4096] [--only hull,mli]

Every set is written at `--size` (default 4096, used by 'ultra') and at half size (suffix _2k, used by
'high' / 'medium' / 'low'). Maps per set (all tile seamlessly):
  <set>_albedo.jpg   sRGB base colour (white paint ~0.72-0.78 albedo, never pure white)
  <set>_normal.jpg   OpenGL tangent-space normal (+Y up)
  <set>_orm.jpg      R ambient occlusion (seams / rivet rings), G roughness, B metalness (three.js packing)
Tile sizes in metres are listed in SETS (the app scales UVs to match: Builder TEX_M = 6.5 m per hull tile).
"""
import argparse, os, sys
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'textures', 'station')

# ----------------------------------------------------------------------------------------------- helpers

def load(src, aid, mp, size, mode='L'):
    """Load one ambientCG map as float32 [0,1] (H, W[, 3]) resized to size×size (tileable sources stay tileable)."""
    d = os.path.join(src, aid)
    for ext in ('.jpg', '.png'):
        p = os.path.join(d, f'{aid}_{mp}{ext}')
        if os.path.exists(p):
            im = Image.open(p).convert(mode)
            if im.size != (size, size): im = im.resize((size, size), Image.LANCZOS)
            return np.asarray(im, dtype=np.float32) / 255.0
    raise FileNotFoundError(f'{aid} {mp} in {d}')


def mask(src, aid, size):
    """A grey-scale mask from a scan (Opacity, else Roughness, else Color luminance), normalised to [0,1]."""
    for mp in ('Opacity', 'Roughness', 'Color'):
        try:
            m = load(src, aid, mp, size)
            lo, hi = np.percentile(m, 1), np.percentile(m, 99.5)
            return np.clip((m - lo) / max(hi - lo, 1e-3), 0, 1)
        except FileNotFoundError:
            continue
    return np.zeros((size, size), np.float32)


def tile_to(a, size, reps):
    """Repeat a (tileable) map `reps` times across size×size (reps must divide size)."""
    assert size % reps == 0, (size, reps)
    sub = size // reps
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    im = im.resize((sub, sub), Image.LANCZOS)
    b = np.asarray(im, dtype=np.float32) / 255.0
    return np.tile(b, (reps, reps) + ((1,) if b.ndim == 3 else ()))[:size, :size]


def noise(size, scale, seed, octaves=4, persistence=0.5):
    """Periodic fbm noise in [0,1] (FFT band-limited white noise per octave)."""
    rng = np.random.default_rng(seed)
    out = np.zeros((size, size), np.float32); amp = 1.0; tot = 0.0
    fy = np.fft.fftfreq(size)[:, None] * size; fx = np.fft.rfftfreq(size)[None, :] * size
    f = np.sqrt(fx * fx + fy * fy)
    for o in range(octaves):
        s = scale * (2 ** o)
        w = rng.standard_normal((size, size)).astype(np.float32)
        F = np.fft.rfft2(w) * np.exp(-(f / max(s, 0.5)) ** 2)
        n = np.fft.irfft2(F, s=(size, size)).astype(np.float32)
        n /= (np.abs(n).max() + 1e-6)
        out += amp * n; tot += amp; amp *= persistence
    out = out / tot
    return np.clip(out * 0.5 + 0.5, 0, 1)


def blur(a, r):
    """Periodic Gaussian blur (FFT), radius r pixels."""
    if r <= 0: return a
    size = a.shape[0]
    fy = np.fft.fftfreq(size)[:, None]; fx = np.fft.rfftfreq(a.shape[1])[None, :]
    g = np.exp(-2 * (np.pi * r) ** 2 * (fx * fx + fy * fy))
    return np.fft.irfft2(np.fft.rfft2(a) * g, s=a.shape).astype(np.float32)


def height_to_normal(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-dx, dy, np.ones_like(h)], -1)   # OpenGL: +Y up (image rows go down)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def decode_normal(rgb):
    n = rgb * 2 - 1
    return n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)


def blend_normals(a, b, wb=1.0):
    """Whiteout blend of two unit normal maps (b weighted)."""
    bx, by = b[..., 0] * wb, b[..., 1] * wb
    n = np.stack([a[..., 0] + bx, a[..., 1] + by, a[..., 2] * (b[..., 2] * wb + (1 - wb))], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def save(name, a, size, srgb=True, q=92):
    os.makedirs(OUT, exist_ok=True)
    img = np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)
    im = Image.fromarray(img)
    im.save(os.path.join(OUT, f'{name}.jpg'), quality=q, subsampling=0 if not srgb else 2, optimize=True)
    im.resize((size // 2, size // 2), Image.LANCZOS).save(os.path.join(OUT, f'{name}_2k.jpg'), quality=q, subsampling=0 if not srgb else 2, optimize=True)


def save_set(name, albedo, normal, ao, rough, metal, size):
    save(f'{name}_albedo', albedo, size, True)
    save(f'{name}_normal', normal * 0.5 + 0.5, size, False, 95)
    save(f'{name}_orm', np.stack([ao, rough, metal], -1), size, False, 94)
    print('  wrote', name, flush=True)


def to_lin(c):
    c = np.asarray(c, np.float32) / 255.0
    return c


# ----------------------------------------------------------------------------------------------- hull paint

def bake_hull(src, size, name, base, seam, seed, cells=6, aged=0.0, rivets=True, scuffs=1.0):
    """
    White / grey painted aluminium hull panels on one 6.5 m tile: per-panel tint, recessed seams, rivet rows,
    inspection sub-panels with screws, stencil marks, paint wear (scratches reveal bare metal), grime and UV
    yellowing (aged), orange-peel micro normal, gentle oil-canning.
    """
    rng = np.random.default_rng(seed)
    S = size
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    cs = S / cells
    # ---- per-panel tint and oil-canning
    pi = np.floor(xx / cs).astype(int) % cells; pj = np.floor(yy / cs).astype(int) % cells
    tint = rng.normal(0, 1, (cells, cells)).astype(np.float32)[pj, pi]
    fx = (xx % cs) / cs; fy = (yy % cs) / cs
    oil = np.sin(np.pi * fx) * np.sin(np.pi * fy)
    # ---- seams (distance to the panel grid), rivet rows 2.5 cm inside each edge
    dx = np.minimum(xx % cs, cs - (xx % cs)); dy = np.minimum(yy % cs, cs - (yy % cs))
    dmin = np.minimum(dx, dy)
    px_m = 6.5 / S                       # metres per pixel
    gw = 0.0022 / px_m                   # 2.2 mm seam half width
    seamMask = np.clip(1 - dmin / max(gw, 0.7), 0, 1)
    seamAO = np.clip(1 - dmin / (gw * 4), 0, 1)
    h = -0.9 * seamMask - 0.15 * seamAO + 0.25 * oil * (0.6 + 0.4 * np.abs(tint).clip(0, 1))
    ao = 1 - 0.35 * seamAO
    riv = np.zeros((S, S), np.float32)
    if rivets:
        inset = 0.025 / px_m; pitch = 0.045 / px_m; rr = 0.0032 / px_m
        for axis in (0, 1):
            a = xx if axis == 0 else yy; b = yy if axis == 0 else xx
            da = np.minimum(np.abs((a % cs) - inset), np.abs((a % cs) - (cs - inset)))
            db = np.abs(((b + pitch / 2) % pitch) - pitch / 2)
            dd = np.sqrt(da * da + db * db)
            inside = ((b % cs) > inset * 1.5) & ((b % cs) < cs - inset * 1.5)
            riv = np.maximum(riv, np.where(inside, np.clip(1 - (dd / rr) ** 2, 0, 1), 0))
        h += 0.55 * np.sqrt(riv)
        ring = np.clip(1 - np.abs(np.sqrt(np.maximum(0, 1 - riv)) - 0.85) * 6, 0, 1) * (riv > 0)
        ao -= 0.12 * ring
    # ---- inspection sub-panels with corner screws on some panels
    sub = np.zeros((S, S), np.float32)
    for j in range(cells):
        for i in range(cells):
            if rng.random() < 0.42:
                w = rng.uniform(0.25, 0.6) * cs; hh = rng.uniform(0.2, 0.5) * cs
                x0 = i * cs + rng.uniform(0.1 * cs, cs - w - 0.1 * cs); y0 = j * cs + rng.uniform(0.1 * cs, cs - hh - 0.1 * cs)
                x0i, y0i, x1i, y1i = int(x0), int(y0), int(x0 + w), int(y0 + hh)
                g = max(1, int(0.0012 / px_m))
                sub[y0i:y1i, x0i:x0i + g] = 1; sub[y0i:y1i, x1i - g:x1i] = 1
                sub[y0i:y0i + g, x0i:x1i] = 1; sub[y1i - g:y1i, x0i:x1i] = 1
                sr = 0.004 / px_m; m = 0.012 / px_m
                for (cx, cy) in ((x0 + m, y0 + m), (x1i - m, y0 + m), (x0 + m, y1i - m), (x1i - m, y1i - m)):
                    ys, xs = slice(int(cy - sr - 2), int(cy + sr + 3)), slice(int(cx - sr - 2), int(cx + sr + 3))
                    d = np.sqrt((xx[ys, xs] - cx) ** 2 + (yy[ys, xs] - cy) ** 2)
                    sub[ys, xs] = np.maximum(sub[ys, xs], np.clip(1 - d / sr, 0, 1) * 0.8)
    h -= 0.5 * blur(sub, 0.8)
    ao -= 0.18 * blur(sub, 1.5)
    # ---- wear: scratches / scuffs (scans), concentrated near panel edges and in random patches
    scr = np.zeros((S, S), np.float32)
    for k, aid in enumerate(('Scratches001', 'Scratches002', 'Scratches003', 'Scratches004')):
        m = mask(src, aid, 2048)
        m = np.roll(np.roll(m, rng.integers(0, 2048), 0), rng.integers(0, 2048), 1)
        scr = np.maximum(scr, tile_to(m, S, 8 if k % 2 else 4))
    patches = noise(S, 3, seed + 1, 3)
    edge = np.clip(1 - dmin / (0.06 / px_m), 0, 1)
    wear = np.clip((scr - 0.35) * 2.2, 0, 1) * np.clip((patches - 0.55) * 4 + edge * 0.8, 0, 1) * scuffs
    chip = np.clip((noise(S, 60, seed + 2, 2) - 0.78) * 9, 0, 1) * np.clip((patches - 0.6) * 5, 0, 1) * scuffs
    bare = np.clip(wear * 0.75 + chip, 0, 1)
    h -= 0.12 * bare
    # ---- grime / discolouration: low-frequency, darker in seams and around rivets, AO streaks along one axis
    g1 = noise(S, 4, seed + 3, 4)
    g2 = noise(S, 24, seed + 4, 3)
    streak = blur(np.clip((noise(S, 10, seed + 5, 3) - 0.5) * 3, 0, 1), 2.0)
    streak = np.asarray(Image.fromarray((streak * 255).astype(np.uint8)).resize((S // 8, S), Image.BILINEAR).resize((S, S), Image.BILINEAR), np.float32) / 255
    grime = np.clip(0.55 * g1 + 0.25 * g2 + 0.35 * seamAO + 0.25 * streak * aged - 0.45, 0, 1)
    # ---- micro normal: orange peel from the plastic scan, fine at 4 repeats
    try:
        op = decode_normal(tile_to(load(src, 'Plastic013A', 'NormalGL', 2048, 'RGB'), S, 8))
    except FileNotFoundError:
        op = height_to_normal(noise(S, 220, seed + 6, 2), 0.6)
    # ---- stencils: part numbers / handling marks near panel corners (DejaVu Sans Bold, dark grey or red)
    sten = np.zeros((S, S), np.float32); stenRed = np.zeros((S, S), np.float32)
    try:
        from PIL import ImageDraw, ImageFont
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', max(8, int(0.022 / px_m)))
        small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', max(6, int(0.013 / px_m)))
        im = Image.new('L', (S, S), 0); imr = Image.new('L', (S, S), 0)
        d = ImageDraw.Draw(im); dr = ImageDraw.Draw(imr)
        words = ['SEG', 'P/N', 'S/N', 'GRD', 'LIFT', 'NO STEP', 'ОСТОРОЖНО', 'НЕ НАСТУПАТЬ', 'ЗАЗЕМЛ.', 'КРЕПЁЖ']
        for j in range(cells):
            for i in range(cells):
                if rng.random() < 0.55:
                    x = int(i * cs + 0.05 / px_m + rng.random() * cs * 0.4); y = int(j * cs + 0.05 / px_m + rng.random() * cs * 0.5)
                    txt = f"{rng.choice(words[:3])} {rng.integers(100, 999)}-{rng.integers(10, 99)}"
                    d.text((x, y), txt, fill=200, font=font)
                    d.text((x, y + int(0.03 / px_m)), f"{rng.integers(1000, 9999)}-{rng.integers(1, 9)}", fill=160, font=small)
                if rng.random() < 0.12:
                    x = int(i * cs + cs * 0.55); y = int(j * cs + cs * 0.8)
                    dr.text((x, y), str(rng.choice(words[5:])), fill=210, font=font)
        sten = np.asarray(im, np.float32) / 255; stenRed = np.asarray(imr, np.float32) / 255
    except Exception as e:
        print('  (no stencils:', e, ')')
    # ---- per-panel tint: most panels within ±2.5 %, a few replaced (brighter, cooler) or weathered (warmer)
    kind = rng.random((cells, cells))
    pan = np.where(kind < 0.12, 0.05, np.where(kind > 0.9, -0.05, 0.0)).astype(np.float32)[pj, pi]
    warm = np.where(kind > 0.9, 1.0, 0.0).astype(np.float32)[pj, pi]
    # ---- compose albedo (linear-ish sRGB values; paint never pure white)
    base = to_lin(base); seamc = to_lin(seam)
    col = np.ones((S, S, 3), np.float32) * base
    col *= (1 + 0.025 * np.clip(tint, -2, 2) + pan)[..., None]
    col *= (1 - 0.03 * warm[..., None] * np.array([0.0, 0.3, 1.0], np.float32))
    col *= (1 - 0.06 * (g1 - 0.5))[..., None]
    yel = np.array([1.0, 0.975, 0.92], np.float32)
    col *= (1 - aged * 0.5 * grime[..., None] * (1 - yel)) * (1 - 0.18 * grime[..., None] * (0.4 + aged))
    col = col * (1 - seamMask[..., None]) + seamc * seamMask[..., None]
    col *= (1 - 0.25 * blur(sub, 0.6))[..., None]
    metalc = np.array([0.62, 0.63, 0.64], np.float32)
    col = col * (1 - bare[..., None]) + metalc * bare[..., None]
    if rivets: col *= (1 - 0.08 * riv)[..., None]
    # grime streaks running from fastener rows / seams along the tile's v axis (thermal cycling, outgassing)
    st = blur(np.clip(noise(S, 30, seed + 9, 2) - 0.55, 0, 1) * 4 * (riv > 0.1), 1.0)
    st = np.asarray(Image.fromarray(np.clip(st * 255, 0, 255).astype(np.uint8)).resize((S, S // 24), Image.BILINEAR).resize((S, S), Image.BICUBIC), np.float32) / 255
    col *= (1 - (0.06 + 0.08 * aged) * np.clip(st * 3, 0, 1))[..., None] * np.array([1.0, 0.99, 0.97], np.float32)
    col = col * (1 - 0.75 * sten[..., None]) + np.array([0.16, 0.17, 0.18], np.float32) * 0.75 * sten[..., None]
    col = col * (1 - 0.8 * stenRed[..., None]) + np.array([0.55, 0.08, 0.06], np.float32) * 0.8 * stenRed[..., None]
    rough = 0.48 + 0.12 * grime + 0.05 * (g2 - 0.5) + 0.1 * seamMask - 0.18 * bare + 0.06 * blur(scr, 1) * (1 - bare)
    metal = 0.75 * bare
    n = blend_normals(height_to_normal(h, 2.2 * S / 4096), op, 0.35)
    save_set(name, np.clip(col, 0, 1), n, np.clip(ao, 0, 1), np.clip(rough, 0.05, 1), np.clip(metal, 0, 1), S)


# ----------------------------------------------------------------------------------------------- MLI foil

def bake_mli(src, size, name, seed, foil='Foil002', quilt=4):
    """
    Crinkled MLI blanket (gold kapton / silver aluminised): scanned foil crinkle (normal, roughness) + quilting
    seams with stitch dashes and tie-down buttons; albedo = brightness / stain variation (multiplied with the
    material colour). One tile = 1.625 m (TEX_M / 4) so the crinkle scale reads correctly.
    """
    rng = np.random.default_rng(seed)
    S = size
    fn = decode_normal(load(src, foil, 'NormalGL', S, 'RGB'))
    fr = load(src, foil, 'Roughness', S)
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    cs = S / quilt
    fx = (xx % cs) / cs; fy = (yy % cs) / cs
    sx = np.abs(fx - 0.5); sy = np.abs(fy - 0.5)
    seam = np.clip((np.maximum(sx, sy) - 0.488) / 0.012, 0, 1)
    dash = (((yy / S * 96 * quilt / 4) % 1) < 0.62) & (sx > 0.474) & (sx < 0.482) | (((xx / S * 96 * quilt / 4) % 1) < 0.62) & (sy > 0.474) & (sy < 0.482)
    puff = np.sin(np.pi * fx) * np.sin(np.pi * fy)
    cu = np.minimum(fx, 1 - fx); cv = np.minimum(fy, 1 - fy); bd = np.sqrt(cu * cu + cv * cv)
    button = np.clip(1 - (bd / 0.03) ** 2, 0, 1)
    h = -0.8 * seam + 0.25 * dash + 0.35 * puff + 0.8 * button
    n = blend_normals(height_to_normal(blur(h, 1.2), 3.0 * S / 2048), fn, 1.0)
    v = noise(S, 3, seed, 3)
    alb = 0.86 + 0.14 * (v - 0.5) * 2 * 0.5 - 0.1 * seam - 0.06 * blur(dash.astype(np.float32), 1)
    stain = np.clip((noise(S, 6, seed + 1, 3) - 0.62) * 3, 0, 1)
    alb *= 1 - 0.25 * stain
    alb = np.stack([alb, alb, alb * (1 - 0.04 * stain)], -1)
    rough = np.clip(0.18 + 0.55 * (fr - fr.mean()) + 0.22 * seam + 0.15 * stain, 0.06, 0.9)
    ao = np.clip(1 - 0.35 * seam - 0.15 * (1 - puff) * 0.3, 0, 1)
    metal = np.ones((S, S), np.float32) * (1 - 0.6 * seam)
    save_set(name, np.clip(alb, 0, 1), n, ao, rough, metal, S)


# ----------------------------------------------------------------------------------------------- beta cloth

def bake_beta(src, size, name, seed):
    """Teflon-coated glass-fibre (beta) cloth: fine twill weave, matte off-white, handling smudges (tile 1.625 m)."""
    S = size
    n = decode_normal(tile_to(load(src, 'Fabric060', 'NormalGL', 2048, 'RGB'), S, 4))
    r = tile_to(load(src, 'Fabric060', 'Roughness', 2048), S, 4)
    c = tile_to(load(src, 'Fabric060', 'Color', 2048, 'RGB'), S, 4)
    lum = c.mean(-1, keepdims=True); lum = (lum - lum.mean()) * 0.5
    base = np.array([0.79, 0.78, 0.75], np.float32)
    sm = np.clip((noise(S, 5, seed, 4) - 0.55) * 2.5, 0, 1)
    sm2 = np.clip((noise(S, 40, seed + 1, 3) - 0.6) * 3, 0, 1)
    alb = base * (1 + lum) * (1 - 0.12 * sm[..., None]) * (1 - 0.06 * sm2[..., None])
    rough = np.clip(0.8 + 0.25 * (r - r.mean()) - 0.06 * sm2, 0.4, 1)
    save_set(name, np.clip(alb, 0, 1), n, np.ones((S, S), np.float32), rough, np.zeros((S, S), np.float32), S)


# ----------------------------------------------------------------------------------------------- bare metal

def bake_metal(src, size, name, aid, seed, tint=(0.70, 0.71, 0.73), rough_base=0.32):
    """Brushed / machined aluminium with smudges and fine scratches (tile 1.625 m)."""
    S = size
    c = load(src, aid, 'Color', S, 'RGB')
    n = decode_normal(load(src, aid, 'NormalGL', S, 'RGB'))
    r = load(src, aid, 'Roughness', S)
    lum = c.mean(-1, keepdims=True); lum = (lum - lum.mean()) * 0.5
    sm = np.clip((noise(S, 8, seed, 4) - 0.55) * 2.5, 0, 1)
    scr = tile_to(mask(src, 'Scratches002', 2048), S, 4)
    alb = np.array(tint, np.float32) * (1 + lum) * (1 - 0.05 * sm[..., None]) * (1 + 0.05 * scr[..., None])
    rough = np.clip(rough_base + 0.5 * (r - r.mean()) + 0.12 * sm - 0.08 * scr, 0.08, 0.9)
    save_set(name, np.clip(alb, 0, 1), n, np.ones((S, S), np.float32), rough, np.ones((S, S), np.float32), S)


def bake_int_plastic(src, size, name, seed):
    """
    Interior micro detail (tri-planar, ~0.45 m tiles): orange-peel moulded / painted panel normal (Plastic013A) with
    faint hairline scratches; roughness variation from handling smudges and wipes (G channel ~0.5 = no change).
    """
    S = size
    n = decode_normal(tile_to(load(src, 'Plastic013A', 'NormalGL', 2048, 'RGB'), S, 2))
    scr = tile_to(mask(src, 'Scratches003', 2048), S, 2)
    h = -0.6 * blur(scr, 0.6)
    n = blend_normals(n, height_to_normal(h, 1.5), 1.0)
    sm = np.clip((noise(S, 6, seed, 4) - 0.5) * 2.0, -1, 1)
    sm2 = np.clip((noise(S, 30, seed + 1, 3) - 0.62) * 4, 0, 1)
    rough = np.clip(0.5 + 0.12 * sm - 0.1 * sm2 + 0.12 * scr, 0.2, 0.85)
    alb = np.ones((S, S, 3), np.float32) * 0.8
    save_set(name, alb, n, np.ones((S, S), np.float32), rough, np.zeros((S, S), np.float32), S)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=os.path.expanduser('~/.cache/station-texture-sources'))
    ap.add_argument('--size', type=int, default=4096)
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    only = set(filter(None, a.only.split(',')))
    S = a.size
    want = lambda k: not only or k in only
    if want('hull'):
        bake_hull(a.src, S, 'hull_white', (192, 193, 190), (120, 124, 128), 1)                 # ~0.73 albedo paint
        bake_hull(a.src, S, 'hull_aged', (184, 182, 174), (112, 114, 116), 4, aged=0.8, scuffs=1.4)
        bake_hull(a.src, S, 'hull_gray', (140, 145, 150), (84, 88, 94), 9, cells=5, scuffs=0.8)
    if want('mli'):
        bake_mli(a.src, S // 2, 'mli_gold', 11, 'Foil002', 4)
        bake_mli(a.src, S // 2, 'mli_silver', 23, 'Foil001', 4)
    if want('beta'): bake_beta(a.src, S // 2, 'beta_cloth', 5)
    if want('metal'):
        bake_metal(a.src, S // 2, 'metal_brushed', 'Metal009', 3)
        bake_metal(a.src, S // 2, 'metal_machined', 'Metal032', 7, (0.62, 0.63, 0.65), 0.38)
    if want('interior'): bake_int_plastic(a.src, S // 2, 'int_plastic', 13)
    return 0


if __name__ == '__main__':
    sys.exit(main())
