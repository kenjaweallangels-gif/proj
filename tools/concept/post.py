"""Post-processing for concept frames: downsample, bloom, paint texture, grain, grade.

Usage: python3 post.py <raw_dir> <out_dir> [scene ...]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

GRADES = {
    # lift (shadow tint), gain (highlight tint), bloom strength, grain
    'default': dict(lift=(0.010, 0.012, 0.022), gain=(1.0, 1.0, 1.0), bloom=0.45, grain=0.022),
    'K1': dict(lift=(0.010, 0.012, 0.026), gain=(1.02, 1.0, 0.97), bloom=0.40, grain=0.024),
    'K2': dict(lift=(0.008, 0.012, 0.028), gain=(1.0, 1.0, 1.0), bloom=0.40, grain=0.024),
    'K3': dict(lift=(0.008, 0.010, 0.022), gain=(1.0, 1.0, 1.0), bloom=0.35, grain=0.026),
    'K4': dict(lift=(0.014, 0.012, 0.016), gain=(1.03, 1.0, 0.95), bloom=0.40, grain=0.024),
    'K5': dict(lift=(0.008, 0.012, 0.028), gain=(1.0, 1.0, 1.02), bloom=0.55, grain=0.020),
    'K6': dict(lift=(0.006, 0.010, 0.026), gain=(1.0, 1.0, 1.03), bloom=0.65, grain=0.020),
    'K7': dict(lift=(0.008, 0.010, 0.024), gain=(1.02, 1.0, 0.98), bloom=0.55, grain=0.022),
    'K8': dict(lift=(0.016, 0.011, 0.008), gain=(1.04, 1.0, 0.93), bloom=0.55, grain=0.024),
    'K0': dict(lift=(0.0, 0.0, 0.0), gain=(1.0, 1.0, 1.0), bloom=0.15, grain=0.012, paint=0.3),
}


def fbm(shape, seed, base=12, octaves=4):
    rng = np.random.default_rng(seed)
    h, w = shape
    acc = np.zeros(shape, np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        gw, gh = max(2, int(base * 2 ** o * w / h)), max(2, base * 2 ** o)
        small = Image.fromarray((rng.random((gh, gw)) * 255).astype(np.uint8))
        acc += amp * np.asarray(small.resize((w, h), Image.BICUBIC), np.float32) / 255
        tot += amp
        amp *= 0.5
    return acc / tot


def box_mean(x, r):
    """Mean over the (r+1)x(r+1) window whose top-left corner is each pixel (x is padded by r)."""
    c = np.cumsum(np.cumsum(np.pad(x, ((1, 0), (1, 0))), 0), 1)
    k = r + 1
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def kuwahara(a, r=3):
    """Vectorised Kuwahara filter: flattens strokes, keeps edges (oil-paint look)."""
    h, w = a.shape[:2]
    pad = lambda x: np.pad(x, ((r, r), (r, r)) + ((0, 0),) * (x.ndim - 2), mode='edge')
    lum = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    L, L2 = pad(lum), pad(lum * lum)
    A = pad(a)
    mL, mL2 = box_mean(L, r), box_mean(L2, r)
    mA = np.stack([box_mean(A[..., c], r) for c in range(3)], -1)
    # quadrant windows anchored so that the pixel is a corner; offsets into the padded grid
    offs = [(0, 0), (0, r), (r, 0), (r, r)]
    var = np.stack([(mL2 - mL ** 2)[oy:oy + h, ox:ox + w] for oy, ox in offs], 0)
    means = np.stack([mA[oy:oy + h, ox:ox + w] for oy, ox in offs], 0)
    idx = np.argmin(var, 0)
    return np.take_along_axis(means, idx[None, ..., None].repeat(3, -1), 0)[0]


def blur(arr, r):
    out = np.empty_like(arr)
    for c in range(3):
        im = Image.fromarray(np.clip(arr[..., c] * 255, 0, 255).astype(np.uint8))
        out[..., c] = np.asarray(im.filter(ImageFilter.GaussianBlur(r)), np.float32) / 255
    return out


def process(src: Path, dst: Path, name: str):
    g = GRADES.get(name, GRADES['default'])
    im = Image.open(src).convert('RGB').resize((1920, 1080), Image.LANCZOS)
    a = np.asarray(im, np.float32) / 255
    h, w = a.shape[:2]
    if g['bloom'] > 0:
        lum = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        mask = np.clip((lum - 0.55) / 0.45, 0, 1)[..., None] ** 1.5 * a
        a = a + g['bloom'] * (0.6 * blur(mask, 10) + 0.5 * blur(mask, 42))
    # oil-paint flattening, blended so fine detail survives
    if g.get('paint', 0.75) > 0:
        a = (1 - g.get('paint', 0.75)) * a + g.get('paint', 0.75) * kuwahara(a, g.get('kr', 3))
    # brush-stroke direction texture
    strokes = np.asarray(Image.fromarray((np.random.default_rng(5).random((h // 2, w // 2)) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC).rotate(28, resample=Image.BICUBIC, expand=False).filter(ImageFilter.BoxBlur(1)), np.float32) / 255
    streak = np.asarray(Image.fromarray((strokes * 255).astype(np.uint8)).resize((w // 6, h), Image.BICUBIC).resize((w, h), Image.BICUBIC), np.float32) / 255
    a = a * (1 + 0.035 * (streak[..., None] - 0.5))
    # painterly mottling and canvas tooth
    mott = fbm((h, w), 7, base=6)
    a = a * (1 + 0.07 * (mott[..., None] - 0.5))
    tooth = np.asarray(Image.fromarray((np.random.default_rng(3).random((h, w)) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255
    a = a + 0.025 * (tooth[..., None] - 0.5)
    # grade
    lift, gain = np.array(g['lift'], np.float32), np.array(g['gain'], np.float32)
    a = lift + a * (1 - lift) * gain
    a = np.clip(a, 0, None)
    a = a / (1 + 0.18 * a)  # soft shoulder
    a = a * 1.12
    # vignette
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    a = a * (1 - 0.22 * np.clip(r - 0.35, 0, None) ** 1.6)[..., None]
    # chromatic fringe: red channel scaled up a hair around the centre
    ch = Image.fromarray(np.clip(a[..., 0] * 255, 0, 255).astype(np.uint8))
    cw, chh = int(w * 1.0014), int(h * 1.0014)
    res = ch.resize((cw, chh), Image.BICUBIC)
    l, t = (cw - w) // 2, (chh - h) // 2
    a[..., 0] = np.asarray(res.crop((l, t, l + w, t + h)), np.float32) / 255
    # film grain (monochrome)
    grain = np.random.default_rng(11).normal(0, g['grain'], (h, w)).astype(np.float32)
    a = a + grain[..., None] * (0.6 + 0.4 * (1 - np.clip(a.mean(-1, keepdims=True), 0, 1)))
    a = np.clip(a, 0, 1)
    out_im = Image.fromarray((a * 255 + 0.5).astype(np.uint8))
    ui = src.with_name(src.stem + '_ui.png')
    if ui.exists():
        u = Image.open(ui).convert('RGBA').resize((1920, 1080), Image.LANCZOS)
        out_im = Image.alpha_composite(out_im.convert('RGBA'), u).convert('RGB')
    out_im.save(dst, quality=92, optimize=True, progressive=True)


if __name__ == '__main__':
    raw, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    names = sys.argv[3:] or [p.stem for p in sorted(raw.glob('K*.png')) if not p.stem.endswith('_ui')]
    for n in names:
        process(raw / f'{n}.png', out / f'{n}.jpg', n)
        print(n)
