"""
env_dunes.py — процедурная карта высот пустыни Ракиса (T-010).

Запуск (оба варианта дают одинаковый результат; с numpy — в десятки раз быстрее):
    blender -b -P Tools/blender/env_dunes.py -- --out Export/heightmap_desert_r16.png
    python3 Tools/blender/env_dunes.py --out Export/heightmap_desert_r16.png [--res 1009]

Результат:
    Export/heightmap_desert_r16.png — 16-bit grayscale PNG, res×res (по умолчанию 4033² = 4.03×4.03 км, 1 м/px)
    Export/heightmap_desert.json    — масштаб/смещение для импорта Landscape в UE (читает env_import.py)

Что моделируется (метры, оси UE, ветер дует в сторону yaw 60°):
  * барханы-полумесяцы (рога по ветру) в ядре эрга A2, поперечные гряды с наветренным склоном ~10°
    и подветренным склоном осыпания ~32°, ровные межбарханные «такыры»;
  * сейфы (продольные гряды) и драа на внешнем кольце (фон до 2 км от ядра);
  * стартовый гребень A1 (35 м, гребень через (0,0), направлен на скалу);
  * каменистые плиты-ступени подхода A3, осыпь у основания, выдувная котловина у наветренной грани;
  * коридор золотого пути (дюны ниже, чтобы скала читалась), расщелина A4 с ровным дном Z=0;
  * под скалой ландшафт опущен до −80 м, чтобы не пересекать сиетч (меш скалы закрывает перепад).
Без numpy работает чистый Python (медленно: ~40–60 мин на 4033², для превью используйте --res 1009).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys
import time
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.getcwd(), "Tools", "blender"))
import env_common  # noqa: E402

L = env_common.layout()

try:
    import numpy as np  # внутри Blender numpy есть всегда
except Exception:  # noqa: BLE001
    np = None

MASK32 = 0xFFFFFFFF


# =============================================================== бэкенды математики
class PyBackend:
    """Скалярный бэкенд (чистый Python)."""
    floor = staticmethod(math.floor)
    sin = staticmethod(math.sin)
    cos = staticmethod(math.cos)
    exp = staticmethod(math.exp)
    sqrt = staticmethod(math.sqrt)
    abs = staticmethod(abs)

    @staticmethod
    def maximum(a, b):
        return a if a > b else b

    @staticmethod
    def minimum(a, b):
        return a if a < b else b

    @staticmethod
    def clip(x, lo, hi):
        return lo if x < lo else (hi if x > hi else x)

    @staticmethod
    def where(c, a, b):
        return a if c else b

    @staticmethod
    def pow(x, p):
        return x ** p

    @staticmethod
    def to_int(x):
        return int(math.floor(x))

    @staticmethod
    def hash01(ix, iy, seed):
        h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) & MASK32
        h = ((h ^ (h >> 13)) * 1274126177) & MASK32
        h = h ^ (h >> 16)
        return h / 4294967296.0


class NpBackend:
    """Векторный бэкенд (numpy, float64)."""

    def __init__(self):
        self.floor = np.floor
        self.sin = np.sin
        self.cos = np.cos
        self.exp = np.exp
        self.sqrt = np.sqrt
        self.abs = np.abs
        self.maximum = np.maximum
        self.minimum = np.minimum
        self.clip = np.clip
        self.where = np.where
        self.pow = np.power

    @staticmethod
    def to_int(x):
        return np.floor(x).astype(np.int64)

    @staticmethod
    def hash01(ix, iy, seed):
        h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) & MASK32
        h = ((h ^ (h >> 13)) * 1274126177) & MASK32
        h = h ^ (h >> 16)
        return h.astype(np.float64) / 4294967296.0


# =============================================================== шум
def smoothstep(B, e0, e1, x):
    t = B.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def value_noise(B, x, y, seed):
    """Value noise [-1, 1] с квинтической интерполяцией."""
    ix = B.to_int(x)
    iy = B.to_int(y)
    fx = x - B.floor(x)
    fy = y - B.floor(y)
    ux = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0)
    uy = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0)
    a = B.hash01(ix, iy, seed)
    b = B.hash01(ix + 1, iy, seed)
    c = B.hash01(ix, iy + 1, seed)
    d = B.hash01(ix + 1, iy + 1, seed)
    v = a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
    return v * 2.0 - 1.0


def fbm(B, x, y, seed, octaves=4, lac=2.03, gain=0.5):
    s = 0.0
    amp = 1.0
    norm = 0.0
    for o in range(octaves):
        s = s + value_noise(B, x, y, seed + o * 101) * amp
        norm += amp
        x = x * lac + 17.3
        y = y * lac - 9.1
        amp *= gain
    return s / norm


# =============================================================== форма скалы (векторная версия level_layout)
def rock_sd(B, xc, yc):
    """Знаковая дистанция (см) до основания «Когтя»; <0 внутри; плюс нормаль-X (−1 запад, +1 восток)."""
    t = B.clip((yc - L.ROCK_PIVOT[1]) / L.ROCK_HALF_LEN, -1.0, 1.0)
    cx = 144000.0 + 12000.0 * (1.0 - t * t)
    hook = B.maximum(0.0, (-t - 0.6) / 0.4)
    cx = cx - 9000.0 * hook * hook
    u = B.clip((t + 1.0) * 0.5, 0.0, 1.0)
    hw = 3000.0 + 17000.0 * B.pow(u + 1e-9, 0.8)
    t0 = B.where(t > 0.0, 0.8, 0.9)                       # скругление торцов (= level_layout.claw_end_round)
    k = B.clip((B.abs(t) - t0) / (1.0 - t0), 0.0, 1.0)
    hw = hw * B.sqrt(B.clip(1.0 - k * k, 0.0, 1.0))
    dx = B.abs(xc - cx) - hw
    dy = B.maximum(0.0, B.abs(yc - L.ROCK_PIVOT[1]) - L.ROCK_HALF_LEN)
    sd = B.where(dy > 0.0, B.sqrt(B.maximum(dx, 0.0) ** 2 + dy * dy), dx)
    side = B.where(xc < cx, -1.0, 1.0)
    return sd, side


def seg_dist(B, px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    ll = vx * vx + vy * vy
    t = B.clip(((px - ax) * vx + (py - ay) * vy) / ll, 0.0, 1.0)
    dx = px - (ax + vx * t)
    dy = py - (ay + vy * t)
    return B.sqrt(dx * dx + dy * dy)


DESERT_PATH = [(p[1], p[2]) for p in L.GOLDEN_PATH if p[4] in ("A1", "A2", "A3", "A4")]


# =============================================================== поле высот (метры)
TAN10 = math.tan(math.radians(10.0))
TAN12 = math.tan(math.radians(12.0))
TAN30 = math.tan(math.radians(30.0))
TAN32 = math.tan(math.radians(32.0))
WIND_X, WIND_Y = L.WIND_DIR


def transverse_profile(B, d, H):
    """Асимметричный профиль гряды по ветру: d — координата в пределах длины волны (м),
    наветренный склон ~10° (выпуклый у гребня), подветренный ~32°. Вне подошвы — 0 (такыр)."""
    Hs = B.maximum(H, 0.05)          # защита от деления на 0 в пустых клетках
    lw = Hs / TAN10 * 0.9
    ll = Hs / TAN32
    crest = -ll                      # гребень (относительно конца волны 0)
    s = B.clip((d - (crest - lw)) / lw, 0.0, 1.0)  # 0..1 на наветренном склоне
    wind_side = H * s * (1.6 - 0.6 * s)
    lee = H * B.clip(1.0 - (d - crest) / ll, 0.0, 1.0)
    return B.where(d < crest, wind_side, lee)


def barchan_field(B, u, v, seed, lam=180.0, mu=160.0, hmax=14.0):
    """Поле барханов: по клетке (λ вдоль ветра × μ поперёк) — один полумесяц со случайной высотой/сдвигом."""
    cu = B.floor(u / lam)
    cv = B.floor(v / mu)
    iu = B.to_int(cu)
    iv = B.to_int(cv)
    r1 = B.hash01(iu, iv, seed)
    r2 = B.hash01(iu, iv, seed + 7)
    r3 = B.hash01(iu, iv, seed + 13)
    H = hmax * B.clip((r1 - 0.25) / 0.75, 0.0, 1.0) * (0.55 + 0.45 * r2)  # ~25% клеток пусты
    lv = (v - cv * mu) / mu - 0.5 + (r3 - 0.5) * 0.25                     # −0.5..0.5 поперёк
    flank = B.clip(1.0 - (2.0 * lv) ** 2, 0.0, 1.0)
    horn = 0.32 * lam * (2.0 * lv) ** 2                                    # рога вытянуты по ветру
    lu = (u - cu * lam) - lam * (0.95 - 0.15 * r2)                         # конец подошвы у края клетки
    d = lu - horn
    return transverse_profile(B, d, H * B.sqrt(flank))


def transverse_field(B, u, v, seed, lam=140.0, hmax=9.0):
    """Поперечные гряды с извилистым гребнем; высота модулируется шумом."""
    uw = u + 45.0 * fbm(B, v / 170.0, u / 700.0, seed, 3) + 18.0 * B.sin(v / 95.0)
    # гряды рвутся на отрезки (высота уходит в 0 по шуму) — нет бесконечных прямых линий
    H = hmax * B.clip(0.15 + 1.1 * fbm(B, u / 380.0, v / 240.0, seed + 3, 3), 0.0, 1.0)
    d = uw - B.floor(uw / lam) * lam - lam
    return transverse_profile(B, d, H)


def seif_field(B, u, v, seed, sigma=380.0, hmax=42.0):
    """Сейфы — продольные гряды по ветру; одна сторона круче (30°), другая полога (12°)."""
    vw = v + 30.0 * B.sin(u / 230.0 + 2.0 * fbm(B, u / 1500.0, v / 900.0, seed, 2)) + 40.0 * fbm(B, u / 600.0, v / 600.0, seed + 5, 3)
    dv = vw - (B.floor(vw / sigma) + 0.5) * sigma
    Hs = hmax * B.clip(0.5 + 0.55 * fbm(B, u / 900.0, v / 1400.0, seed + 9, 3), 0.15, 1.0)
    r = 10.0  # скругление гребня
    side = B.where(dv < 0.0, TAN12, TAN30)
    h = Hs - side * (B.sqrt(dv * dv + r * r) - r)
    return B.maximum(h, 0.0)


def ridge_a1(B, xm, ym):
    """Стартовый гребень A1 (м). Гребень через (0,0) на высоте 35 м, наветренная сторона — север."""
    ax, ay = L.A1_RIDGE_A[0] / 100.0, L.A1_RIDGE_A[1] / 100.0
    bx, by = L.A1_RIDGE_B[0] / 100.0, L.A1_RIDGE_B[1] / 100.0
    vx, vy = bx - ax, by - ay
    ln = math.hypot(vx, vy)
    tx, ty = vx / ln, vy / ln
    nx, ny = -ty, tx                                       # +n — подветренная (южная) сторона
    s = ((xm - ax) * tx + (ym - ay) * ty) / ln             # 0..1 вдоль гребня
    d = (xm - ax) * nx + (ym - ay) * ny                    # поперёк
    s0 = math.hypot(ax, ay) / ln                           # параметр точки старта (0,0)
    crest_h = L.A1_RIDGE_CREST_CM / 100.0
    # высота гребня: 28 м на западном конце, 35 м на старте, 5 м у подножия (P2)
    hr = B.where(s < s0, 28.0 + (crest_h - 28.0) * smoothstep(B, 0.0, s0, s),
                 crest_h + (5.0 - crest_h) * smoothstep(B, s0, 1.0, s))
    hr = hr * smoothstep(B, -0.35, 0.0, s) * (1.0 - smoothstep(B, 1.0, 1.15, s))
    hr = B.where(s < -0.35, 0.0, hr)
    r = 8.0
    slope = B.where(d > 0.0, TAN30, TAN12)
    h = hr - slope * (B.sqrt(d * d + r * r) - r)
    return B.maximum(h, 0.0), s, d


def height_m(B, xc, yc, seed=1977):
    """Высота (м) в мировой точке (xc, yc) в см (оси UE)."""
    xm = xc / 100.0
    ym = yc / 100.0
    u = xm * WIND_X + ym * WIND_Y
    v = -xm * WIND_Y + ym * WIND_X

    # --- маски областей
    cx0, cy0 = L.CORE_MIN[0] / 100.0, L.CORE_MIN[1] / 100.0
    cx1, cy1 = L.CORE_MAX[0] / 100.0, L.CORE_MAX[1] / 100.0
    out_x = B.maximum(cx0 - xm, xm - cx1)
    out_y = B.maximum(cy0 - ym, ym - cy1)
    outside = B.maximum(out_x, out_y)                       # >0 за пределами ядра (м)
    outer = smoothstep(B, -150.0, 600.0, outside)           # 0 в ядре → 1 в фоне

    pd = 1e9
    for a, b in zip(DESERT_PATH, DESERT_PATH[1:]):
        pd = B.minimum(pd, seg_dist(B, xm, ym, a[0] / 100.0, a[1] / 100.0, b[0] / 100.0, b[1] / 100.0))
    corridor = 0.25 + 0.75 * smoothstep(B, 50.0, 220.0, pd)  # дюны ниже вдоль тропы

    # --- регион и база
    base = 4.0 * fbm(B, xm / 1600.0, ym / 1600.0, seed + 1, 3) + 2.0

    erg = barchan_field(B, u, v, seed + 20) * 0.9 + transverse_field(B, u, v, seed + 40) * 0.55
    seif = seif_field(B, u, v, seed + 60)
    dunes = (erg * (1.0 - outer) + seif * (0.35 + 0.65 * outer)) * corridor
    # мелкая рябь ветра (крупная, ~25 м; песчаная рябь 10 см — в материале)
    dunes = dunes + 0.35 * fbm(B, u / 25.0, v / 9.0, seed + 80, 2) * (1.0 - outer * 0.5)

    h = base + dunes

    # --- A1: стартовый гребень (дюны вокруг гребня подавлены)
    ridge, s, d = ridge_a1(B, xm, ym)
    near_ridge = (1.0 - smoothstep(B, 30.0, 160.0, B.abs(d))) * smoothstep(B, -0.4, -0.1, s) * (1.0 - smoothstep(B, 1.0, 1.2, s))
    h = B.maximum(h * (1.0 - 0.8 * near_ridge), ridge + base * 0.3)

    # --- скала: осыпь, котловина, плиты A3, расщелина, провал под скалой
    sd, side = rock_sd(B, xc, yc)
    sdm = sd / 100.0                                          # м
    talus = 6.0 * (1.0 - smoothstep(B, 0.0, 45.0, sdm))
    windward = B.clip(0.5 - 0.5 * side * WIND_X * 2.0, 0.0, 1.0)  # запад/север — наветренные
    scour = -7.0 * B.exp(-((sdm - 55.0) / 28.0) ** 2) * (0.4 + 0.6 * windward)
    # A3 — плиты подхода: ступенчатая «терраса» вдоль тропы
    a3 = smoothstep(B, 960.0, 1050.0, xm) * (1.0 - smoothstep(B, 60.0, 260.0, pd))
    plates = 1.5 + 3.0 * B.floor(B.clip(0.5 + 0.5 * fbm(B, xm / 70.0, ym / 70.0, seed + 90, 2), 0.0, 0.999) * 4.0) / 4.0
    near_rock = 1.0 - smoothstep(B, 0.0, 400.0, sdm)
    scour = scour * (1.0 - a3)                               # тропа A3 идёт по «мосту» из плит
    h = h * (1.0 - near_rock * 0.85 * (1.0 - outer)) + near_rock * (1.0 - outer) * 1.5
    h = h + (talus + scour) * B.where(sdm > -20.0, 1.0, 0.0)
    h = h * (1.0 - a3) + (h * 0.3 + plates) * a3

    # расщелина A4: ровное дно Z=0 от устья до фальшивого камня; устье — без осыпи
    cy = L.CREVICE_MOUTH[1] / 100.0
    in_crev_y = 1.0 - smoothstep(B, L.CREVICE_WIDTH / 200.0 + 1.0, L.CREVICE_WIDTH / 200.0 + 6.0, B.abs(ym - cy))
    in_crev_x = smoothstep(B, L.CREVICE_MOUTH[0] / 100.0 - 60.0, L.CREVICE_MOUTH[0] / 100.0 - 5.0, xm) * \
        (1.0 - smoothstep(B, L.FALSE_ROCK[0] / 100.0, L.FALSE_ROCK[0] / 100.0 + 2.0, xm))
    crev = in_crev_y * in_crev_x
    h = h * (1.0 - crev)

    # провал под скалой (≥15 м вглубь от грани): ландшафт уходит на −80 м, кроме дна расщелины
    under = smoothstep(B, -15.0, -30.0, sdm) * (1.0 - crev * B.where(xm < L.FALSE_ROCK[0] / 100.0, 1.0, 0.0))
    h = h * (1.0 - under) + (L.UNDER_ROCK_Z / 100.0) * under

    # точка старта и тропа у старта — гарантированная высота гребня
    return h


# =============================================================== эрозия (только numpy)
def thermal_erosion(h, cell_m, iterations=12, repose_deg=33.0, rate=0.45):
    talus = math.tan(math.radians(repose_deg)) * cell_m
    for _ in range(iterations):
        moved = np.zeros_like(h)
        for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
            nb = np.roll(np.roll(h, dy, axis=0), dx, axis=1)
            diff = h - nb - talus
            m = np.where(diff > 0.0, diff * rate * 0.25, 0.0)
            moved -= m
            moved += np.roll(np.roll(m, -dy, axis=0), -dx, axis=1)
        h += moved
    return h


# =============================================================== PNG 16-bit
def write_png16(path, width, height, row_iter):
    """Минимальный писатель PNG: grayscale 16 bit, без интерлейса, фильтр 0. row_iter → bytes (big-endian)."""
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & MASK32)

    comp = zlib.compressobj(6)
    idat = bytearray()
    for row in row_iter:
        idat += comp.compress(b"\x00" + row)
    idat += comp.flush()
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 16, 0, 0, 0, 0)))
        f.write(chunk(b"IDAT", bytes(idat)))
        f.write(chunk(b"IEND", b""))


def to_u16(h_m, z_scale):
    """метры → значение 16 bit (UE: Z = (v−32768)/128·ZScale см)."""
    return 32768.0 + h_m * 100.0 * 128.0 / z_scale


def landscape_layout(res):
    q = res - 1
    if q % 126 == 0:
        return {"quads_per_section": 63, "sections_per_component": 2, "components": [q // 126, q // 126]}
    if q % 63 == 0:
        return {"quads_per_section": 63, "sections_per_component": 1, "components": [q // 63, q // 63]}
    return {"note": "нестандартное разрешение — UE предложит подогнать; рекомендуются 1009/2017/4033"}


# =============================================================== main
def main():
    ap = argparse.ArgumentParser(description="Rakis desert heightmap (16-bit PNG)")
    ap.add_argument("--out", default="Export/heightmap_desert_r16.png")
    ap.add_argument("--json", default=None, help="по умолчанию — рядом: heightmap_desert.json")
    ap.add_argument("--res", type=int, default=L.HEIGHTMAP_RES, help="сторона, px (4033 / 2017 / 1009)")
    ap.add_argument("--seed", type=int, default=1977)
    ap.add_argument("--erosion", type=int, default=12, help="итераций термоэрозии (только numpy)")
    ap.add_argument("--pure", action="store_true", help="принудительно чистый Python")
    ap.add_argument("--chunk", type=int, default=256, help="строк за проход (numpy)")
    args = env_common.parse_args(ap)

    res = args.res
    size_cm = L.LANDSCAPE_SIZE_CM
    step = size_cm / (res - 1)
    ox, oy, oz = L.LANDSCAPE_ORIGIN
    z_scale = L.LANDSCAPE_Z_SCALE
    out = env_common.out_path(args.out)
    js = env_common.out_path(args.json or os.path.join(os.path.dirname(args.out), "heightmap_desert.json"))
    t0 = time.time()
    use_np = np is not None and not args.pure
    print(f"[Rakis] heightmap {res}² шаг {step:.1f} см, backend={'numpy' if use_np else 'pure-python'}")
    if not use_np and res > 1100:
        print("[Rakis] ВНИМАНИЕ: чистый Python на 4033² займёт ~40–60 мин. Для превью: --res 1009")

    hmin, hmax = 1e9, -1e9
    if use_np:
        B = NpBackend()
        xs = ox + np.arange(res, dtype=np.float64) * step
        hm = np.empty((res, res), dtype=np.float64)
        for r0 in range(0, res, args.chunk):
            r1 = min(res, r0 + args.chunk)
            ys = oy + np.arange(r0, r1, dtype=np.float64) * step
            X, Y = np.meshgrid(xs, ys)
            hm[r0:r1] = height_m(B, X, Y, args.seed)
            print(f"  строки {r1}/{res}  {time.time() - t0:.0f} с")
        if args.erosion > 0:
            # эрозия не трогает расщелину/провал под скалой: восстанавливаем их после
            keep = hm < -1.0
            saved = hm.copy()
            hm = thermal_erosion(hm, step / 100.0, args.erosion)
            hm[keep] = saved[keep]
        hmin, hmax = float(hm.min()), float(hm.max())
        u16 = np.clip(np.rint(to_u16(hm, z_scale)), 0, 65535).astype(">u2")
        rows = (u16[j].tobytes() for j in range(res))
        write_png16(out, res, res, rows)
    else:
        from array import array
        B = PyBackend()
        swap = sys.byteorder == "little"

        def rows():
            nonlocal hmin, hmax
            for j in range(res):
                y = oy + j * step
                row = array("H")
                for i in range(res):
                    h = height_m(B, ox + i * step, y, args.seed)
                    hmin = min(hmin, h)
                    hmax = max(hmax, h)
                    v = int(round(to_u16(h, z_scale)))
                    row.append(0 if v < 0 else (65535 if v > 65535 else v))
                if swap:
                    row.byteswap()
                if j % max(1, res // 20) == 0:
                    print(f"  строка {j}/{res}  {time.time() - t0:.0f} с")
                yield row.tobytes()
        write_png16(out, res, res, rows())

    meta = {
        "file": os.path.relpath(out, env_common.PROJECT_DIR).replace("\\", "/"),
        "resolution": res,
        "bit_depth": 16,
        "landscape": {
            "location_cm": [ox, oy, oz],
            "scale": [step, step, z_scale],
            "size_cm": [size_cm, size_cm],
            "z_formula": "Z_cm = (value - 32768) / 128 * scale_z",
            **landscape_layout(res),
        },
        "height_range_m": [round(hmin, 2), round(hmax, 2)],
        "playable_core_cm": {"min": list(L.CORE_MIN), "max": list(L.CORE_MAX)},
        "wind_yaw_deg": L.WIND_YAW_DEG,
        "under_rock_z_cm": L.UNDER_ROCK_Z,
        "rock_pivot_cm": list(L.ROCK_PIVOT),
        "start_cm": list(L.START),
        "seed": args.seed,
        "generator": "Tools/blender/env_dunes.py",
    }
    with open(js, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"[Rakis] {out}  высоты {hmin:.1f}…{hmax:.1f} м  ({time.time() - t0:.0f} с)")
    print(f"[Rakis] {js}")


if __name__ == "__main__":
    main()
