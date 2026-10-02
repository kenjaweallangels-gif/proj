"""
level_blockout_sietch.py — блокаут сиетча «Табр-ан-Нур» (T-004, шаг 4 build_demo).

Подуровень L_Rakis_Sietch (стримится ZoneVolume A3/A4, см. level_markup.py). Комнаты — замкнутые
серые коробки (пол/стены/потолок), т.к. в B2–B5 подуровень Desert выгружен и небо видно через любые щели.
  B1  шлюз 40 м: наземная камера с двумя ARakisSealDoor (влагошлюз), лестница вниз на −14 м, площадка;
  B2  галерея 60×15 м, 2 яруса: нижний пол −20 м, U-образный балкон −14 м (вход из B1 сверху — обзорный
      кадр рынка), парадная лестница, колонны, 2 световых колодца;
  B3  три ветки: B3a север 40 м и B3c юг 30 м — жилые ниши за занавесями; B3b восток 50 м — главный
      спуск к залу, площадка с альковом и решёткой цистерны;
  B4  зал цистерны 30×20 м за решёткой (бассейн, вода), без доступа игрока (задел на сюжет);
  B5  религиозный зал 35×50×25 м: балкон входа −37 м, лестница на террасу −42 м, 5 ярусов к песчаной
      чаше (Ø14 м), помост наиба на востоке, рёбра свода «глотка червя» сужаются к востоку, световая шахта.
Кит-меши (/Game/Rakis/Environment/Sietch/SM_Sietch_*) используются, если импортированы: рамы дверей,
решётка, балюстрады, колонны, кольцо шахты, бортик чаши. Иначе — примитивы.
Идемпотентно: gen:level_blockout_sietch + blockout:B1..B5. Координаты — level_layout.py.
"""
from __future__ import annotations

import math

import unreal

from rakis_common import (MAP_SIETCH, delete_generated, load_or_none, log, rakis_class, shape, spawn,
                          transaction, warn)
import level_common as LC
import level_layout as L

GEN = "gen:level_blockout_sietch"
KIT = "/Game/Rakis/Environment/Sietch/SM_Sietch_"
WT = 100.0          # толщина стен блокаута (см) — толще кита, чтобы Lumen не «протекал»
SLAB = 50.0
CEIL = 100.0
STONE = LC.MI_STONE
FOLDER = "Rakis/Sietch"


def T(zone: str) -> list[str]:
    return [GEN, f"blockout:{zone}"]


def kit(name: str):
    return load_or_none(f"{KIT}{name}")


def B(x0, x1, y0, y1, z0, z1, zone, label, mat=STONE):
    return LC.box(x0, x1, y0, y1, z0, z1, T(zone), label, mat, f"{FOLDER}/{zone}")


def wall(x0, x1, y0, y1, z0, z1, zone, label, openings=()):
    """Стена-ящик с проёмами [(a0, a1, za, zb)] вдоль длинной оси."""
    along_x = (x1 - x0) >= (y1 - y0)
    a_lo, a_hi = (x0, x1) if along_x else (y0, y1)
    cur = a_lo
    n = 0

    def piece(a, b, za, zb):
        nonlocal n
        n += 1
        if along_x:
            B(a, b, y0, y1, za, zb, zone, f"{label}_{n}")
        else:
            B(x0, x1, a, b, za, zb, zone, f"{label}_{n}")

    for (o0, o1, oz0, oz1) in sorted(openings):
        if o0 > cur:
            piece(cur, o0, z0, z1)
        if oz0 > z0:
            piece(o0, o1, z0, oz0)
        if oz1 < z1:
            piece(o0, o1, oz1, z1)
        cur = o1
    if cur < a_hi:
        piece(cur, a_hi, z0, z1)


def slab_with_holes(x0, x1, y0, y1, z0, z1, zone, label, holes=(), mat=STONE):
    rects = [(x0, x1, y0, y1)]
    for h in holes:
        rects = [r for rr in rects for r in LC.subtract_rect(rr, h)]
    for i, (a, b, c, d) in enumerate(rects):
        B(a, b, c, d, z0, z1, zone, f"{label}_{i}", mat)


def mesh_at(name, loc, yaw=0.0, scale=(1, 1, 1), zone="B2", label=None):
    m = kit(name)
    if not m:
        return None
    return spawn(m, loc, (0, 0, yaw), scale, label=label or name, tags=T(zone), folder=f"{FOLDER}/{zone}")


# ================================================================== B1
def build_b1():
    b = L.B1
    x0, x1, y0, y1 = b["x0"], b["x1"], b["y0"], b["y1"]
    h = b["height"]
    top, bot = b["floor_top"], b["floor_bottom"]
    cx1, sx1 = b["chamber_x1"], b["stair_x1"]
    # пол камеры начинается под фальшивым камнем (плита опускается в паз; без провала ландшафта под скалой)
    B(L.FALSE_ROCK[0] - 150.0, cx1, y0 - WT, y1 + WT, top - SLAB, top, "B1", "B1_ChamberFloor")
    LC.stairs(cx1, sx1, y0, y1, top, bot, T("B1"), 25.0, STONE, f"{FOLDER}/B1", "B1_Stairs")
    B(sx1, x1, y0, y1, bot - SLAB, bot, "B1", "B1_Landing")
    # стены по всей высоте спуска
    alcove = [(b["door1_x"] + 100.0, b["door2_x"] - 100.0, top, top + 260.0)]
    wall(x0, x1, y0 - WT, y0, bot - SLAB, top + h + CEIL, "B1", "B1_WallN", alcove)
    wall(x0, x1, y1, y1 + WT, bot - SLAB, top + h + CEIL, "B1", "B1_WallS", alcove)
    # потолок: камера, ступенчатый над лестницей, площадка
    B(x0, cx1, y0 - WT, y1 + WT, top + h, top + h + CEIL, "B1", "B1_Ceil_Chamber")
    n = 6
    for i in range(n):
        xa = cx1 + (sx1 - cx1) * i / n
        xb = cx1 + (sx1 - cx1) * (i + 1) / n
        zt = top + (bot - top) * i / n + h
        B(xa, xb, y0 - WT, y1 + WT, zt, zt + CEIL, "B1", f"B1_Ceil_Stair_{i}")
    B(sx1, x1, y0 - WT, y1 + WT, bot + h, bot + h + CEIL, "B1", "B1_Ceil_Landing")
    # двери-уплотнители (влагошлюз между ними) + альковы стражи
    door_cls = rakis_class("RakisSealDoor")
    for i, dx in enumerate((b["door1_x"], b["door2_x"])):
        label = ("SealDoor_Outer", "SealDoor_Inner")[i]
        if door_cls:
            spawn(door_cls, (dx, (y0 + y1) / 2, top), (0, 0, 0), label=label, tags=T("B1"), folder=f"{FOLDER}/B1")
        else:
            warn("ARakisSealDoor не найден — дверь заменена рамой кита/плашкой")
        if not mesh_at("SealDoor_Frame", (dx, y0, top), 90.0, zone="B1", label=f"{label}_Frame"):
            B(dx - 30, dx + 30, y0, y0 + 50, top, top + h, "B1", f"{label}_JambN")
            B(dx - 30, dx + 30, y1 - 50, y1, top, top + h, "B1", f"{label}_JambS")
    # альковы стражи в камере влагошлюза (между дверями), 1.2 м вглубь стены
    ax0, ax1 = b["door1_x"] + 100.0, b["door2_x"] - 100.0
    for i, (ya, yb) in enumerate(((y0 - WT - 120.0, y0 - WT), (y1 + WT, y1 + WT + 120.0))):
        B(ax0, ax1, ya, yb, top - SLAB, top, "B1", f"B1_GuardAlcove{i}_Floor")
        B(ax0, ax1, ya, yb, top + 260.0, top + 260.0 + CEIL, "B1", f"B1_GuardAlcove{i}_Ceil")
        back = (ya - WT, ya) if i == 0 else (yb, yb + WT)
        B(ax0 - WT, ax1 + WT, back[0], back[1], top - SLAB, top + 260.0 + CEIL, "B1", f"B1_GuardAlcove{i}_Back")
        B(ax0 - WT, ax0, ya, yb, top - SLAB, top + 260.0 + CEIL, "B1", f"B1_GuardAlcove{i}_SideW")
        B(ax1, ax1 + WT, ya, yb, top - SLAB, top + 260.0 + CEIL, "B1", f"B1_GuardAlcove{i}_SideE")


# ================================================================== B2
def build_b2():
    g = L.B2
    x0, x1, y0, y1 = g["x0"], g["x1"], g["y0"], g["y1"]
    fl, bal, ce = g["floor"], g["balcony"], g["ceiling"]
    dep = g["balcony_depth"]
    lx1, sx1 = g["landing_x1"], g["stair_x1"]
    b1 = L.B1
    a, c = L.B3A, L.B3C
    w3 = L.B3B
    B(x0, x1, y0, y1, fl - SLAB, fl, "B2", "B2_Floor")
    door_h = a["height"]
    wall(x0 - WT, x1 + WT, y0 - WT, y0, fl - SLAB, ce + CEIL, "B2", "B2_WallN",
         [(a["x"] - a["width"] / 2, a["x"] + a["width"] / 2, fl, fl + door_h)])
    wall(x0 - WT, x1 + WT, y1, y1 + WT, fl - SLAB, ce + CEIL, "B2", "B2_WallS",
         [(c["x"] - c["width"] / 2, c["x"] + c["width"] / 2, fl, fl + door_h)])
    wall(x0 - WT, x0, y0, y1, fl - SLAB, ce + CEIL, "B2", "B2_WallW",
         [(b1["y0"], b1["y1"], bal, bal + b1["height"])])
    wall(x1, x1 + WT, y0, y1, fl - SLAB, ce + CEIL, "B2", "B2_WallE",
         [(w3["y0"], w3["y1"], fl, fl + w3["height"])])
    # потолок со световыми колодцами (свет есть, когда Desert выгружен — небо видно через трубы)
    wells = [(150500.0, 72500.0), (153000.0, 72500.0)]
    holes = [(wx - 75, wx + 75, wy - 75, wy + 75) for wx, wy in wells]
    slab_with_holes(x0 - WT, x1 + WT, y0 - WT, y1 + WT, ce, ce + CEIL, "B2", "B2_Ceiling", holes)
    for i, (wx, wy) in enumerate(wells):
        z0, z1 = ce, 300.0
        B(wx - 125, wx + 125, wy - 125, wy - 75, z0, z1, "B2", f"B2_Well{i}_N")
        B(wx - 125, wx + 125, wy + 75, wy + 125, z0, z1, "B2", f"B2_Well{i}_S")
        B(wx - 125, wx - 75, wy - 75, wy + 75, z0, z1, "B2", f"B2_Well{i}_W")
        B(wx + 75, wx + 125, wy - 75, wy + 75, z0, z1, "B2", f"B2_Well{i}_E")
    # верхний ярус: U-балкон (площадка у входа + две галереи)
    B(x0, lx1, y0, y1, bal - 50, bal, "B2", "B2_Landing")
    B(lx1, x1, y0, y0 + dep, bal - 50, bal, "B2", "B2_BalconyN")
    B(lx1, x1, y1 - dep, y1, bal - 50, bal, "B2", "B2_BalconyS")
    # парадная лестница с площадки вниз (4 м шириной)
    sy0, sy1 = 72300.0, 72700.0
    LC.stairs(lx1, sx1, sy0, sy1, bal, fl, T("B2"), 20.0, STONE, f"{FOLDER}/B2", "B2_GrandStair")
    # балюстрады: кит Balcony_Rail_4m (4 м) или ящики
    rails = [((lx1, x1), y0 + dep, 0.0), ((lx1, x1), y1 - dep, 0.0)]
    for i, ((ra, rb), ry, _) in enumerate(rails):
        if kit("Balcony_Rail_4m"):
            x = ra
            k = 0
            while x + 400 <= rb + 1:
                mesh_at("Balcony_Rail_4m", (x, ry, bal), 0.0, zone="B2", label=f"B2_Rail{i}_{k}")
                x += 400
                k += 1
        else:
            B(ra, rb, ry - 10, ry + 10, bal, bal + 105, "B2", f"B2_Rail{i}")
    B(lx1 - 20, lx1, y0 + dep, sy0, bal, bal + 105, "B2", "B2_RailLandingN")
    B(lx1 - 20, lx1, sy1, y1 - dep, bal, bal + 105, "B2", "B2_RailLandingS")
    # колонны под кромкой балконов (каждые 4 м)
    col_h = bal - 50 - fl
    for i, x in enumerate(range(int(lx1 + 400), int(x1), 400)):
        for j, y in enumerate((y0 + dep - 40, y1 - dep + 40)):
            if not mesh_at("Column_Carved_6m", (x, y, fl), 0.0, (1, 1, col_h / 600.0), "B2", f"B2_Col_{i}_{j}"):
                shape("cylinder", (x, y, fl + col_h / 2), (70, 70, col_h), material=STONE, label=f"B2_Col_{i}_{j}",
                      tags=T("B2"), folder=f"{FOLDER}/B2")


# ================================================================== B3
def niche_room(side, xw, yc, fl, zone, label, depth=250.0, width=300.0, height=250.0):
    """Ниша за стеной коридора: side=-1 — к −X (запад), +1 — к +X (восток). xw — наружная грань стены."""
    xa, xb = (xw - depth, xw) if side < 0 else (xw, xw + depth)
    B(xa, xb, yc - width / 2, yc + width / 2, fl - SLAB, fl, zone, f"{label}_Floor")
    B(xa, xb, yc - width / 2 - WT, yc - width / 2, fl - SLAB, fl + height + CEIL, zone, f"{label}_WallA")
    B(xa, xb, yc + width / 2, yc + width / 2 + WT, fl - SLAB, fl + height + CEIL, zone, f"{label}_WallB")
    back = (xa - WT, xa) if side < 0 else (xb, xb + WT)
    B(back[0], back[1], yc - width / 2 - WT, yc + width / 2 + WT, fl - SLAB, fl + height + CEIL, zone, f"{label}_Back")
    B(xa, xb, yc - width / 2, yc + width / 2, fl + height, fl + height + CEIL, zone, f"{label}_Ceil")


def residential_branch(spec, niches_w, niches_e, zone, label, north: bool):
    x, w, fl, h = spec["x"], spec["width"], spec["floor"], spec["height"]
    ya, yb = spec["y0"], spec["y1"]
    gal = L.B2
    if north:
        ya_c, yb_c = ya, gal["y0"] - WT        # от тупика до наружной грани стены галереи
    else:
        ya_c, yb_c = gal["y1"] + WT, yb
    xi0, xi1 = x - w / 2, x + w / 2
    B(xi0, xi1, ya_c, yb_c, fl - SLAB, fl, zone, f"{label}_Floor")
    nh = 250.0
    wall(xi0 - WT, xi0, ya_c, yb_c, fl - SLAB, fl + h + CEIL, zone, f"{label}_WallW",
         [(yc - 150, yc + 150, fl, fl + nh) for yc in niches_w])
    wall(xi1, xi1 + WT, ya_c, yb_c, fl - SLAB, fl + h + CEIL, zone, f"{label}_WallE",
         [(yc - 150, yc + 150, fl, fl + nh) for yc in niches_e])
    B(xi0 - WT, xi1 + WT, ya_c, yb_c, fl + h, fl + h + CEIL, zone, f"{label}_Ceil")
    end_y = (ya_c - WT, ya_c) if north else (yb_c, yb_c + WT)
    B(xi0 - WT, xi1 + WT, end_y[0], end_y[1], fl - SLAB, fl + h + CEIL, zone, f"{label}_End")
    for i, yc in enumerate(niches_w):
        niche_room(-1, xi0 - WT, yc, fl, zone, f"{label}_NicheW{i}")
    for i, yc in enumerate(niches_e):
        niche_room(+1, xi1 + WT, yc, fl, zone, f"{label}_NicheE{i}")


B3A_NICHES = ([70700.0, 69500.0, 68300.0], [71000.0, 69900.0, 68800.0])
B3C_NICHES = ([74300.0, 75500.0], [74000.0, 75200.0])


def build_b3():
    residential_branch(L.B3A, *B3A_NICHES, "B3", "B3a", north=True)
    residential_branch(L.B3C, *B3C_NICHES, "B3", "B3c", north=False)
    # B3b — главный спуск
    s = L.B3B
    y0, y1, h = s["y0"], s["y1"], s["height"]
    for i, (xa, xb, za, zb) in enumerate(s["segs"]):
        xa2 = max(xa, L.B2["x1"] + WT)
        if za == zb:
            B(xa2, xb, y0, y1, za - SLAB, za, "B3", f"B3b_Floor_{i}")
        else:
            LC.stairs(xa2, xb, y0, y1, za, zb, T("B3"), 20.0, STONE, f"{FOLDER}/B3", f"B3b_Stairs_{i}")
    zlow = s["segs"][-1][3]
    ztop = s["segs"][0][2] + h + CEIL
    landing = s["segs"][2]
    lz = landing[2]
    x_start = L.B2["x1"] + WT
    wall(x_start, s["x1"], y0 - WT, y0, zlow - SLAB, ztop, "B3", "B3b_WallN")
    wall(x_start, s["x1"], y1, y1 + WT, zlow - SLAB, ztop, "B3", "B3b_WallS",
         [(landing[0], landing[1], lz, lz + 300.0)])
    # ступенчатый потолок
    x = x_start
    k = 0
    while x < s["x1"]:
        xb = min(s["x1"], x + 500.0)
        zc = max(L.b3b_floor_z(x), L.b3b_floor_z(xb)) + h
        B(x, xb, y0 - WT, y1 + WT, zc, zc + CEIL, "B3", f"B3b_Ceil_{k}")
        x = xb
        k += 1
    # альков к решётке цистерны (от южной стены коридора до северной стены цистерны)
    c = L.B4
    ay0, ay1 = y1 + WT, c["y0"] - WT
    B(landing[0], landing[1], y1, ay1, lz - SLAB, lz, "B3", "B3b_AlcoveFloor")
    B(landing[0] - WT, landing[0], ay0, ay1, lz - SLAB, lz + 300 + CEIL, "B3", "B3b_AlcoveW")
    B(landing[1], landing[1] + WT, ay0, ay1, lz - SLAB, lz + 300 + CEIL, "B3", "B3b_AlcoveE")
    B(landing[0] - WT, landing[1] + WT, y1, ay1, lz + 300, lz + 300 + CEIL, "B3", "B3b_AlcoveCeil")


# ================================================================== B4
def build_b4():
    c = L.B4
    x0, x1, y0, y1 = c["x0"], c["x1"], c["y0"], c["y1"]
    fl, basin, water, ce = c["floor"], c["basin"], c["water"], c["ceiling"]
    gx = L.B3B["grate_x"]
    lz = L.B3B["segs"][2][2]
    pool = (156600.0, 158400.0, 73500.0, 74600.0)
    slab_with_holes(x0, x1, y0, y1, fl - SLAB, fl, "B4", "B4_Walkway", [pool])
    B(pool[0], pool[1], pool[2], pool[3], basin - SLAB, basin, "B4", "B4_PoolFloor")
    for i, (a, b2, c0, d) in enumerate(((pool[0], pool[1], pool[2] - 20, pool[2]), (pool[0], pool[1], pool[3], pool[3] + 20),
                                        (pool[0] - 20, pool[0], pool[2], pool[3]), (pool[1], pool[1] + 20, pool[2], pool[3]))):
        B(a, b2, c0, d, basin, fl + 60, "B4", f"B4_PoolCurb_{i}")
    # вода: плоскость с MI_Water_Still (если есть)
    water_mat = LC.try_load("/Game/Rakis/Materials/Instances/MI_Water_Still", "/Game/Rakis/Materials/Master/M_Water_Still")
    wp = shape("plane", ((pool[0] + pool[1]) / 2, (pool[2] + pool[3]) / 2, water), (pool[1] - pool[0], pool[3] - pool[2], 1),
               label="B4_Water", tags=T("B4"), folder=f"{FOLDER}/B4")
    if wp and water_mat:
        wp.static_mesh_component.set_material(0, water_mat)
    grate_open = (gx - 150, gx + 150, lz + 50, lz + 300)
    wall(x0 - WT, x1 + WT, y0 - WT, y0, basin - SLAB, ce + CEIL, "B4", "B4_WallN", [grate_open])
    wall(x0 - WT, x1 + WT, y1, y1 + WT, basin - SLAB, ce + CEIL, "B4", "B4_WallS")
    wall(x0 - WT, x0, y0, y1, basin - SLAB, ce + CEIL, "B4", "B4_WallW")
    wall(x1, x1 + WT, y0, y1, basin - SLAB, ce + CEIL, "B4", "B4_WallE")
    B(x0 - WT, x1 + WT, y0 - WT, y1 + WT, ce, ce + CEIL, "B4", "B4_Ceiling")
    # решётка в проёме
    if not mesh_at("Cistern_Grate", (gx - 150, y0 - WT / 2, lz + 50), 0.0, zone="B4", label="B4_Grate"):
        for i in range(7):
            xx = gx - 150 + 300 * (i + 0.5) / 7
            B(xx - 3, xx + 3, y0 - WT / 2 - 3, y0 - WT / 2 + 3, lz + 50, lz + 300, "B4", f"B4_GrateBar_{i}", LC.MI_ROCK)


# ================================================================== B5
def build_b5():
    h = L.B5
    x0, x1, y0, y1 = h["x0"], h["x1"], h["y0"], h["y1"]
    fl, bowl, apex, spring = h["floor"], h["bowl"], h["apex"], h["springing"]
    bal, bx1, sx1 = h["balcony"], h["balcony_x1"], h["stair_x1"]
    by0, by1 = h["balcony_y0"], h["balcony_y1"]
    ter = h["terrace"]
    cx, cy = h["bowl_center"]
    bh = h["bowl_half"]
    s3 = L.B3B
    # пол с углублением-чашей
    slab_with_holes(x0, x1, y0, y1, fl - SLAB, fl, "B5", "B5_Floor", [(cx - bh, cx + bh, cy - bh, cy + bh)])
    sand = LC.MI_SAND
    B(cx - bh, cx + bh, cy - bh, cy + bh, bowl - SLAB, bowl, "B5", "B5_SandBowl", sand)
    if kit("SandBowl_Rim_45"):
        for k in range(8):
            mesh_at("SandBowl_Rim_45", (cx, cy, fl), 45.0 * k, zone="B5", label=f"B5_BowlRim_{k}")
    # ярусы-кольца (k=0 у чаши)
    for k in range(h["tier_count"]):
        r_in = bh + k * h["tier_width"]
        r_out = r_in + h["tier_width"]
        zt = L.b5_tier_top(k)
        B(cx - r_out, cx + r_out, cy - r_out, cy - r_in, fl, zt, "B5", f"B5_Tier{k}_N")
        B(cx - r_out, cx + r_out, cy + r_in, cy + r_out, fl, zt, "B5", f"B5_Tier{k}_S")
        B(cx - r_out, cx - r_in, cy - r_in, cy + r_in, fl, zt, "B5", f"B5_Tier{k}_W")
        B(cx + r_in, cx + r_out, cy - r_in, cy + r_in, fl, zt, "B5", f"B5_Tier{k}_E")
    r_max = bh + h["tier_count"] * h["tier_width"]
    # терраса по периметру (уровень внешнего яруса) + помост наиба на востоке
    B(x0, x1, y0, cy - r_max, fl, ter, "B5", "B5_Terrace_N")
    B(x0, x1, cy + r_max, y1, fl, ter, "B5", "B5_Terrace_S")
    B(sx1, cx - r_max, cy - r_max, cy + r_max, fl, ter, "B5", "B5_Terrace_W")
    B(cx + r_max, x1, cy - r_max, cy + r_max, fl, ter, "B5", "B5_Dais")
    B(x1 - 300, x1, cy - 400, cy + 400, ter, ter + 60, "B5", "B5_DaisStep")
    # западная полоса под балконом и лестница с балкона на террасу
    B(x0, sx1, y0, by0, fl, ter, "B5", "B5_WestFill_N")
    B(x0, sx1, by1, y1, fl, ter, "B5", "B5_WestFill_S")
    B(x0, bx1, by0, by1, fl, bal, "B5", "B5_Balcony")
    LC.stairs(bx1, sx1, by0, by1, bal, ter, T("B5"), 20.0, STONE, f"{FOLDER}/B5", "B5_Stair")
    # стены (до потолочной плиты), проём из B3b
    ztop = apex + CEIL
    wall(x0 - WT, x1 + WT, y0 - WT, y0, bowl - SLAB, ztop, "B5", "B5_WallN")
    wall(x0 - WT, x1 + WT, y1, y1 + WT, bowl - SLAB, ztop, "B5", "B5_WallS")
    wall(x0 - WT, x0, y0, y1, bowl - SLAB, ztop, "B5", "B5_WallW", [(s3["y0"], s3["y1"], bal, bal + s3["height"])])
    wall(x1, x1 + WT, y0, y1, bowl - SLAB, ztop, "B5", "B5_WallE")
    # потолочная плита с отверстием шахты + труба шахты до поверхности
    sr = h["shaft_radius"]
    slab_with_holes(x0 - WT, x1 + WT, y0 - WT, y1 + WT, apex, apex + CEIL, "B5", "B5_Ceiling",
                    [(cx - sr, cx + sr, cy - sr, cy + sr)])
    for i, (a, b2, c0, d) in enumerate(((cx - sr - 100, cx + sr + 100, cy - sr - 100, cy - sr),
                                        (cx - sr - 100, cx + sr + 100, cy + sr, cy + sr + 100),
                                        (cx - sr - 100, cx - sr, cy - sr, cy + sr),
                                        (cx + sr, cx + sr + 100, cy - sr, cy + sr))):
        B(a, b2, c0, d, apex + CEIL, 500.0, "B5", f"B5_Shaft_{i}")
    mesh_at("LightShaft_Ring", (cx, cy, apex - 100.0), 0.0, zone="B5", label="B5_ShaftRing")
    build_vault()


def build_vault():
    """Рёбра «глотки червя»: эллиптические арки поперёк зала, сужаются и опускаются к востоку."""
    h = L.B5
    x0, x1, y0, y1 = h["x0"], h["x1"], h["y0"], h["y1"]
    cy = h["bowl_center"][1]
    spring, apex = h["springing"], h["apex"]
    step = h["rib_step"]
    n_seg = 14
    x = x0 + 300.0
    r = 0
    while x < x1 - 150.0:
        k = (x - x0) / (x1 - x0)
        a = (y1 - y0) * 0.5 - 50.0 - 250.0 * k              # полуширина (сужение глотки)
        b = (apex - spring) - 200.0 * k                     # подъём
        pts = [(cy + a * math.cos(math.pi * i / n_seg), spring + b * math.sin(math.pi * i / n_seg)) for i in range(n_seg + 1)]
        for i in range(n_seg):
            (ya, za), (yb, zb) = pts[i], pts[i + 1]
            ln = math.hypot(yb - ya, zb - za) + 20.0
            phi = math.degrees(math.atan2(zb - za, yb - ya))
            LC.obox(x, (ya + yb) / 2, (za + zb) / 2, 60.0, ln, 90.0, 0.0, T("B5"), f"B5_Rib{r:02d}_{i:02d}",
                    STONE, f"{FOLDER}/B5/Vault", roll=-phi)      # roll=−φ: локальная Y вдоль дуги (см. layout.md)
        # пилястры — продолжение ребра по стенам до пола (горло червя «кольцами»)
        for side, yy in ((0, y0 + 40.0), (1, y1 - 40.0)):
            B(x - 30, x + 30, yy - 40, yy + 40, h["terrace"], spring, "B5", f"B5_Pilaster{r:02d}_{side}")
        x += step
        r += 1
    # «хребет» по коньку
    B(x0, x1, cy - 60, cy + 60, apex - 80, apex, "B5", "B5_Spine")


def main():
    with transaction("Rakis: blockout sietch"):
        LC.ensure_persistent_with_sublevels()
        LC.make_current(MAP_SIETCH)
        n = delete_generated(GEN)
        log(f"{GEN}: удалено {n}")
        for fn in (build_b1, build_b2, build_b3, build_b4, build_b5):
            try:
                fn()
            except Exception as e:  # noqa: BLE001
                warn(f"{fn.__name__}: {e}")
        LC.save_all()
        log("level_blockout_sietch: готово")


if __name__ == "__main__":
    main()
