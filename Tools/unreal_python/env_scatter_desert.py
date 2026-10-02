"""
env_scatter_desert.py — декор пустыни (шаг 8 build_demo). Подуровень L_Rakis_Desert.

1. Если человек-художник собрал PCG-граф /Game/Rakis/Environment/Desert/PCG_DesertScatter — ставится
   PCGVolume на всё ядро 2×2 км с этим графом и генерируется (спецификация графа — docs/art/environment/
   rock_and_dunes.md §PCG). Тогда п.2 (мелкий щебень) пропускается.
2. Иначе — детерминированный Python-скаттер (seed фиксирован) в HISM:
     щебень у камней-островов A2, на плитах A3 и вдоль основания скалы; редкая галька по эргу;
3. Всегда (уникальные «сюжетные» объекты, не для PCG):
     выбеленный скелет мёртвого червя-подростка (LORE_Dead_Maker), полузанесённый спайс-комбайн
     (LORE_Harvester_Wreck, greybox), стойка тамперов у расщелины (LORE_Thumper_Rack), колья-тамперы,
     маркеры песчаной форели и пыльных вихрей для fx_niagara.py (предложение тегов Rakis.FX.*).
Идемпотентно: gen:env_scatter_desert + blockout:<zone>.
"""
from __future__ import annotations

import math
import random

import unreal

from rakis_common import MAP_DESERT, delete_generated, fit_box_volume, load_or_none, log, shape, spawn, transaction, warn
import level_common as LC
import level_layout as L

GEN = "gen:env_scatter_desert"
SEED = 1977
FOLDER = "Rakis/Desert/Scatter"
PCG_GRAPH = "/Game/Rakis/Environment/Desert/PCG_DesertScatter"
DEBRIS_MESHES = [   # Megascans/собственные (ставит человек), иначе сфера движка
    "/Game/Rakis/Environment/Props/SM_Rock_Debris_A",
    "/Game/Rakis/Environment/Props/SM_Rock_Debris_B",
]
BONE_MAT = ["/Game/Rakis/Materials/Instances/MI_Bone_Bleached", LC.MI_STONE]
METAL_MAT = ["/Game/Rakis/Materials/Instances/MI_Metal_Old", "/Game/Rakis/Materials/Instances/MI_Metal_Rust", LC.MI_ROCK]
KIT = "/Game/Rakis/Environment/Sietch/SM_Sietch_"


def T(zone):
    return [GEN, f"blockout:{zone}"]


def mat_path(chain):
    for p in chain:
        if load_or_none(p):
            return p
    return None


# ------------------------------------------------------------------ PCG
def try_pcg() -> bool:
    graph = load_or_none(PCG_GRAPH)
    if not graph:
        return False
    try:
        vol = spawn(unreal.PCGVolume, (L.CORE_CENTER[0], L.CORE_CENTER[1], 0.0), label="PCG_DesertScatter",
                    tags=T("A2"), folder=FOLDER)
        size = (L.CORE_MAX[0] - L.CORE_MIN[0], L.CORE_MAX[1] - L.CORE_MIN[1], 60000.0)
        fit_box_volume(vol, size)
        comp = vol.get_editor_property("pcg_component") or vol.get_component_by_class(unreal.PCGComponent)
        comp.set_graph(graph)
        comp.generate(True)
        log("PCG_DesertScatter: сгенерирован")
        return True
    except Exception as e:  # noqa: BLE001
        warn(f"PCG: {e} — используем Python-скаттер")
        return False


# ------------------------------------------------------------------ щебень
def debris_transforms(rnd):
    out = []

    def rock_at(x, y, smin, smax, sink=0.3):
        s = rnd.uniform(smin, smax)
        z = LC.ground_z(x, y, 0.0)
        out.append(LC.make_transform((x, y, z - s * 100.0 * sink),
                                     (rnd.uniform(-15, 15), rnd.uniform(-15, 15), rnd.uniform(0, 360)),
                                     (s * rnd.uniform(0.8, 1.4), s * rnd.uniform(0.7, 1.2), s * rnd.uniform(0.4, 0.8))))

    for _n, x, y, ln, wd, _h, _yaw in L.SAFE_ISLANDS:          # «острова»: шлейф щебня по ветру
        for _ in range(rnd.randint(10, 16)):
            d = rnd.uniform(0.4, 1.6)
            a = math.radians(L.WIND_YAW_DEG + rnd.uniform(-35, 35))
            rock_at(x + math.cos(a) * ln * d * 0.7, y + math.sin(a) * wd * d, 0.3, 1.6)
    for (x, y, ln, wd, _top, yaw) in L.A3_PLATES:               # плиты A3: обломки по краям
        for _ in range(rnd.randint(8, 14)):
            a = rnd.uniform(0, math.tau)
            rock_at(x + math.cos(a) * ln * 0.6, y + math.sin(a) * wd * 0.6, 0.4, 2.2)
    for _ in range(260):                                         # вдоль основания скалы
        t = rnd.uniform(-0.95, 0.95)
        cx, cy = L.claw_center(t)
        hw = L.claw_half_width(t)
        side = rnd.choice((-1, 1))
        x = cx + side * (hw + rnd.uniform(1500, 6000))
        y = cy + rnd.uniform(-1000, 1000)
        if math.dist((x, y), L.CREVICE_MOUTH[:2]) < 4000:
            continue
        rock_at(x, y, 0.5, 3.0)
    for _ in range(140):                                         # редкая галька по эргу (кроме тропы)
        x = rnd.uniform(L.CORE_MIN[0], L.CORE_MAX[0] - 30000)
        y = rnd.uniform(L.CORE_MIN[1], L.CORE_MAX[1])
        rock_at(x, y, 0.15, 0.5, 0.5)
    return out


# ------------------------------------------------------------------ скелет
def dead_maker():
    """Рёбра мёртвого червя-подростка: хребет 36 м, 14 пар рёбер-дуг, полузанесены (LORE_Dead_Maker)."""
    x0, y0 = 40000.0, 35000.0
    yaw = L.WIND_YAW_DEG + 90.0
    mat = mat_path(BONE_MAT)
    ux, uy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    vx, vy = -uy, ux
    base = LC.ground_z(x0, y0, 0.0)
    n = 14
    for i in range(n):
        k = i / (n - 1)
        x, y = x0 + ux * (k - 0.5) * 3600, y0 + uy * (k - 0.5) * 3600
        r = 450.0 * math.sin(math.pi * (0.15 + 0.7 * k)) + 120.0          # рёбра выше в середине
        shape("cylinder", (x, y, base + 40), (90, 90, 160), rotation=(0, 90, yaw), material=mat,
              label=f"DeadMaker_Vert_{i:02d}", tags=T("A2"), folder=f"{FOLDER}/DeadMaker")
        for side in (-1, 1):
            segs = 5
            for s_ in range(segs):
                a0 = math.pi * 0.5 * s_ / segs
                a1 = math.pi * 0.5 * (s_ + 1) / segs
                if s_ == segs - 1 and (i * 7 + side) % 3 == 0:
                    continue                                                    # обломанные концы
                p0 = (r * math.sin(a0), r * math.cos(a0))
                p1 = (r * math.sin(a1), r * math.cos(a1))
                mx, mz = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
                ln = math.dist(p0, p1) + 10
                # ось цилиндра (локальная Z) → вдоль сегмента дуги в плоскости (поперёк, вверх):
                # roll R даёт Z = (0, sin R, cos R) → R = atan2(d_поперёк, d_вверх)
                roll = math.degrees(math.atan2(side * (p1[0] - p0[0]), p1[1] - p0[1]))
                cx, cy = x + vx * side * mx, y + vy * side * mx
                shape("cylinder", (cx, cy, base + mz - 60), (40, 40, ln),
                      rotation=(roll, 0, yaw), material=mat,
                      label=f"DeadMaker_Rib_{i:02d}_{'L' if side < 0 else 'R'}{s_}", tags=T("A2"),
                      folder=f"{FOLDER}/DeadMaker")
    # кольцо зубов-кристаллов на песке у «головы» (северо-восточный конец)
    hx, hy = x0 + ux * 2100, y0 + uy * 2100
    for j in range(16):
        a = math.tau * j / 16
        shape("cone", (hx + math.cos(a) * 260, hy + math.sin(a) * 260, base + 30), (25, 25, 90),
              rotation=(0, 70, math.degrees(a) + 180), material=mat, label=f"DeadMaker_Tooth_{j:02d}",
              tags=T("A2"), folder=f"{FOLDER}/DeadMaker")


# ------------------------------------------------------------------ комбайн
def harvester_wreck():
    """Полузанесённый спайс-комбайн (greybox ~45×18×14 м), крен 8°, утоплен на 4 м; LORE_Harvester_Wreck."""
    x0, y0 = 70000.0, -15000.0
    yaw = 35.0
    mat = mat_path(METAL_MAT)
    base = LC.ground_z(x0, y0, 0.0)
    ux, uy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    vx, vy = -uy, ux
    parts = [  # (вдоль, поперёк, z, sx, sy, sz, roll, pitch, label)
        (0, 0, 300, 4500, 1800, 1400, 8, -4, "Hull"),
        (1900, 0, 1100, 900, 1200, 700, 8, -4, "Cab"),
        (-300, -1050, -150, 4600, 500, 500, 8, -4, "TrackL"),
        (-300, 1050, -350, 4600, 500, 500, 8, -4, "TrackR"),
        (-1500, 0, 1200, 1500, 1400, 400, 8, -4, "Intake"),
        (-2600, 300, 300, 600, 800, 900, 20, 10, "TailPanel"),
    ]
    for (a, b, z, sx, sy, sz, roll, pitch, label) in parts:
        LC.obox(x0 + ux * a + vx * b, y0 + uy * a + vy * b, base + z - 400, sx, sy, sz, yaw, T("A2"),
                f"Harvester_{label}", mat or LC.MI_ROCK, f"{FOLDER}/Harvester", pitch=pitch, roll=roll)
    # стрела крана, торчащая из песка — читаемый силуэт издалека
    shape("cylinder", (x0 - ux * 800 + vx * 300, y0 - uy * 800 + vy * 300, base + 1500), (120, 120, 2600),
          rotation=(25, -30, yaw), material=mat or LC.MI_ROCK, label="Harvester_Boom", tags=T("A2"),
          folder=f"{FOLDER}/Harvester")
    # оторванные панели обшивки
    rnd = random.Random(SEED + 5)
    for i in range(7):
        d = rnd.uniform(2500, 5000)
        a = math.radians(L.WIND_YAW_DEG + rnd.uniform(-40, 40))
        px, py = x0 + math.cos(a) * d, y0 + math.sin(a) * d
        LC.obox(px, py, LC.ground_z(px, py, 0.0) + 20, rnd.uniform(200, 500), rnd.uniform(150, 300), 12,
                rnd.uniform(0, 360), T("A2"), f"Harvester_Panel_{i}", mat or LC.MI_ROCK, f"{FOLDER}/Harvester",
                pitch=rnd.uniform(-10, 10), roll=rnd.uniform(-20, 20))


# ------------------------------------------------------------------ тамперы
def thumpers():
    kit_thumper, is_kit = LC.mesh_or_shape([f"{KIT}Thumper_Prop"], "cylinder")
    mat = None if is_kit else (mat_path(METAL_MAT) or LC.MI_ROCK)
    stakes = []
    # у комбайна — старые вбитые колья (кто-то отвлекал червя)
    for i, (dx, dy) in enumerate(((-3200, 1500), (-2600, -2100), (3500, 2600))):
        stakes.append((70000 + dx, -15000 + dy, 12, 5 + i * 7))
    # вехи наездников у островов R2, R4
    for name, x, y, *_ in L.SAFE_ISLANDS:
        if name in ("R2", "R4"):
            stakes.append((x + 700, y - 500, 4, 25))
    tr = []
    for (x, y, tilt, yaw) in stakes:
        z = LC.ground_z(x, y, 0.0) - 40
        sc = (1, 1, 1) if is_kit else (0.14, 0.14, 1.6)
        loc_z = z if is_kit else z + 80
        tr.append(LC.make_transform((x, y, loc_z), (tilt, 0, yaw), sc))
    LC.ism_actor("Thumper_Stakes", kit_thumper, tr, T("A2"), FOLDER, mat)
    # стойка тамперов у расщелины (LORE_Thumper_Rack): рама + 4 тампера + 2 крюка
    rx, ry = L.THUMPER_RACK
    base = LC.ground_z(rx, ry, 0.0)
    rack, rk = LC.mesh_or_shape([f"{KIT}MakerHooks_Rack"], "cube")
    if rk:
        spawn(rack, (rx, ry, base), (0, 0, 300.0), label="ThumperRack", tags=T("A3"), folder=f"{FOLDER}/Rack")
    else:
        LC.obox(rx, ry, base + 90, 300, 40, 180, 300.0, T("A3"), "ThumperRack", LC.MI_ROCK, f"{FOLDER}/Rack")
    yaw = math.radians(300.0)
    tr = []
    for i in range(4):
        off = -110 + i * 70
        tr.append(LC.make_transform((rx + math.cos(yaw) * off, ry + math.sin(yaw) * off, base + (0 if is_kit else 80)),
                                    (0, -12, 300.0), (1, 1, 1) if is_kit else (0.14, 0.14, 1.6)))
    LC.ism_actor("ThumperRack_Thumpers", kit_thumper, tr, T("A3"), f"{FOLDER}/Rack", mat)
    hooks, hk = LC.mesh_or_shape([f"{KIT}MakerHooks"], "cylinder")
    tr = [LC.make_transform((rx + 60 * i, ry - 120, base + (0 if hk else 120)), (8, -10, 300.0),
                            (1, 1, 1) if hk else (0.08, 0.08, 2.4)) for i in range(2)]
    LC.ism_actor("ThumperRack_Hooks", hooks, tr, T("A3"), f"{FOLDER}/Rack", None if hk else LC.MI_STONE)


# ------------------------------------------------------------------ маркеры FX (предложение тегов)
def fx_markers(rnd):
    path = [(p[1], p[2]) for p in L.GOLDEN_PATH if p[4] in ("A1", "A2", "A3")]

    def path_dist(x, y):
        best = 1e12
        for (ax, ay), (bx, by) in zip(path, path[1:]):
            vx, vy = bx - ax, by - ay
            t = max(0.0, min(1.0, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)))
            best = min(best, math.hypot(x - ax - vx * t, y - ay - vy * t))
        return best

    n = 0
    while n < 12:
        x, y = rnd.uniform(30000, 100000), rnd.uniform(-30000, 70000)
        if path_dist(x, y) < 4000:
            continue
        LC.marker((x, y, LC.ground_z(x, y, 0.0)), [GEN, "blockout:A2", "Rakis.FX.SandTrout"], f"FX_SandTrout_{n:02d}",
                  rnd.uniform(0, 360), f"{FOLDER}/FX")
        n += 1
    for i, (x, y) in enumerate(((55000, -20000), (90000, 70000), (112000, 30000), (125000, 90000))):
        LC.marker((x, y, LC.ground_z(x, y, 0.0)), [GEN, "blockout:A3", "Rakis.FX.DustDevil"], f"FX_DustDevil_{i}",
                  0.0, f"{FOLDER}/FX")
    # стена бури на юго-западном горизонте (Storm_Horizon), за пределами ядра
    LC.marker((-60000.0, 220000.0, 0.0), [GEN, "blockout:far", "Rakis.FX.StormWall"], "FX_StormWall", 45.0, f"{FOLDER}/FX")


def main():
    LC.ensure_persistent_with_sublevels()   # до транзакции: загрузка карты сбрасывает буфер undo
    LC.make_current(MAP_DESERT)
    with transaction("Rakis: scatter desert"):
        n = delete_generated(GEN)
        log(f"{GEN}: удалено {n}")
        rnd = random.Random(SEED)
        if not try_pcg():
            mesh, is_kit = LC.mesh_or_shape(DEBRIS_MESHES, "sphere")
            tr = debris_transforms(rnd)          # сфера Ø100 см → масштаб в метрах
            LC.ism_actor("Debris_Desert", mesh, tr, T("A2"), FOLDER, None if is_kit else LC.MI_ROCK)
            log(f"щебень: {len(tr)} инстансов")
        for fn in (dead_maker, harvester_wreck, thumpers):
            try:
                fn()
            except Exception as e:  # noqa: BLE001
                warn(f"{fn.__name__}: {e}")
        fx_markers(rnd)
    LC.save_all()
    log("env_scatter_desert: готово")


if __name__ == "__main__":
    main()
