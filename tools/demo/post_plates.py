"""Painterly post for demo plates: alpha-aware Kuwahara, brush streaks, mottling, canvas tooth. Writes WebP.

Usage: python3 post_plates.py <raw_dir> <out_dir> [plate ...]
Grain, vignette and bloom are added live by the game, so they are not baked here.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'concept'))
from post import box_mean, fbm  # noqa: E402

LIFT = {
    'house': (0.010, 0.012, 0.022), 'street': (0.010, 0.014, 0.026), 'outside': (0.008, 0.010, 0.020),
    'obs_sky': (0.006, 0.010, 0.024), 'obs_dome': (0.0, 0.0, 0.0), 'obs_mid': (0.0, 0.0, 0.0), 'theatre': (0.016, 0.011, 0.008),
}


def kuwahara_rgba(p, r):
    """Kuwahara on premultiplied RGBA: picks the quadrant of least luminance variance, averages all four channels."""
    h, w = p.shape[:2]
    pad = lambda x: np.pad(x, ((r, r), (r, r)) + ((0, 0),) * (x.ndim - 2), mode='edge')
    lum = p[..., :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    L, L2, A = pad(lum), pad(lum * lum), pad(p)
    mL, mL2 = box_mean(L, r), box_mean(L2, r)
    mA = np.stack([box_mean(A[..., c], r) for c in range(4)], -1)
    offs = [(0, 0), (0, r), (r, 0), (r, r)]
    var = np.stack([(mL2 - mL ** 2)[oy:oy + h, ox:ox + w] for oy, ox in offs], 0)
    idx = np.argmin(var, 0)
    out = np.zeros_like(p)
    for q, (oy, ox) in enumerate(offs):
        m = (idx == q)[..., None]
        out += m * mA[oy:oy + h, ox:ox + w]
    return out


def tiled(fn, p, r, tile=640):
    h = p.shape[0]
    out = np.empty_like(p)
    for y0 in range(0, h, tile):
        a, b = max(0, y0 - 2 * r), min(h, y0 + tile + 2 * r)
        res = fn(p[a:b], r)
        out[y0:min(h, y0 + tile)] = res[y0 - a:y0 - a + min(tile, h - y0)]
    return out


def process(src: Path, dst: Path, name: str, meta: dict):
    im = Image.open(src).convert('RGBA')
    a = np.asarray(im, np.float32) / 255
    h, w = a.shape[:2]
    alpha = a[..., 3:4]
    prem = np.concatenate([a[..., :3] * alpha, alpha], -1)
    scale = meta.get('scale', 1)
    kr = max(2, int(round(3 * scale / 1.5 + 0.4)))
    painted = tiled(kuwahara_rgba, prem, kr)
    prem = 0.3 * prem + 0.7 * painted
    rgb, alpha = prem[..., :3], prem[..., 3:4]
    rgb = np.where(alpha > 1e-4, rgb / np.maximum(alpha, 1e-4), 0)
    rng = np.random.default_rng(5)
    strokes = Image.fromarray((rng.random((max(2, h // 2), max(2, w // 2))) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC).rotate(28, resample=Image.BICUBIC)
    streak = np.asarray(strokes.resize((max(2, w // 6), h), Image.BICUBIC).resize((w, h), Image.BICUBIC), np.float32) / 255
    rgb = rgb * (1 + 0.04 * (streak[..., None] - 0.5))
    rgb = rgb * (1 + 0.08 * (fbm((h, w), 7, base=max(3, int(6 * h / 1080)))[..., None] - 0.5))
    tooth = np.asarray(Image.fromarray((np.random.default_rng(3).random((h, w)) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255
    rgb = rgb + 0.02 * (tooth[..., None] - 0.5)
    lift = np.array(LIFT.get(name, (0, 0, 0)), np.float32)
    rgb = lift + rgb * (1 - lift)
    rgb = np.clip(rgb, 0, 1)
    if meta.get('alpha'):
        out = Image.fromarray((np.concatenate([rgb, np.clip(alpha, 0, 1)], -1) * 255 + 0.5).astype(np.uint8), 'RGBA')
        out.save(dst, 'WEBP', quality=86, method=6, alpha_quality=90)
    else:
        Image.fromarray((rgb * 255 + 0.5).astype(np.uint8)).save(dst, 'WEBP', quality=86, method=6)


if __name__ == '__main__':
    raw, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    meta = json.loads((raw / 'plates.json').read_text())
    names = sys.argv[3:] or list(meta)
    for n in names:
        process(raw / f'{n}.png', out / f'{n}.webp', n, meta[n])
        print(n, (out / f'{n}.webp').stat().st_size // 1024, 'KB')
    full = json.loads((out / 'plates.json').read_text()) if (out / 'plates.json').exists() else {}
    full.update({n: meta[n] for n in names})
    (out / 'plates.json').write_text(json.dumps(full, indent=1))
