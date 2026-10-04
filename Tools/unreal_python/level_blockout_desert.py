"""
level_blockout_desert.py — блокаут пустыни и «Когтя Шайтана» (T-003, шаг 4 build_demo).

Создаёт/открывает L_Rakis_Persistent, подуровни L_Rakis_Desert (initially loaded) и L_Rakis_Sietch,
и строит в L_Rakis_Desert серый блокаут:
  * земля: Landscape (если импортирован) → иначе плиты 200 м + дюны по гребням env_dunes (если их ещё
    не построил env_import.py);
  * скала: SM_Rock_ShaitanClaw (если импортирован) → иначе полосы-боксы по оси когтя (L-кривая,
    высоты 200–290 м, наклонный «коготь» на севере, разрыв под расщелину и световую шахту зала);
  * A2: камни-«острова»; A3: плиты подхода и плита-навес (тень); A4: стены расщелины, «плавник»,
    ARakisFalseRock; дальние столовые горы-силуэты (5–8 км); BlockingVolume по границе.
Идемпотентно: всё помечено gen:level_blockout_desert + blockout:<zone> и пересоздаётся.
Координаты — Tools/unreal_python/level_layout.py (= docs/level/layout.md).
"""
from __future__ import annotations

import math

import unreal

from rakis_common import (MAP_DESERT, delete_generated, fit_box_volume, load_or_none, log, rakis_class, set_prop,
                          shape, spawn, transaction, warn)
import level_common as LC
import level_layout as L

GEN = "gen:level_blockout_desert"
ROCK_MESH = "/Game/Rakis/Environment/Rock/SM_Rock_ShaitanClaw"
FALSE_ROCK_MESH = "/Game/Rakis/Environment/Rock/SM_Rock_FalseSlab"
ROCK_BANDS = 50                 # полос по 20 м вдоль оси
SLOT_HALF = 500.0               # полуширина разрыва под расщелину в примитивной скале (стены — отдельно)
FAR_MESAS = [                   # (x, y, длина, ширина, высота, yaw) — силуэты за пределами ландшафта
    (520000.0, -180000.0, 90000.0, 40000.0, 12000.0, 20.0),
    (600000.0, 260000.0, 140000.0, 50000.0, 16000.0, 75.0),
    (-380000.0, 300000.0, 120000.0, 45000.0, 9000.0, 130.0),
    (-300000.0, -420000.0, 80000.0, 30000.0, 14000.0, 40.0),
    (250000.0, -560000.0, 160000.0, 60000.0, 11000.0, 100.0),
]


def T(zone: str) -> list[str]:
    return [GEN, f"blockout:{zone}"]


# ------------------------------------------------------------------ земля
def build_ground() -> None:
    land = None
    for a in unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors():
        if isinstance(a, unreal.LandscapeProxy):
            land = a
            break
    if land is not None:
        log("ground: Landscape найден — плиты/дюны блокаута не нужны")
        return
    if LC.actors_in_level_with_tag("blockout:ground"):
        log("ground: фолбэк-земля уже построена env_import.py")
    else:
        n = LC.build_fallback_ground(T("ground"))
        log(f"ground: {n} плит")
    if not LC.actors_in_level_with_tag("gen:env_import"):
        n = LC.build_fallback_dunes(T("A2"))
        log(f"дюны блокаута: {n}")


# ------------------------------------------------------------------ скала
def rock_from_mesh() -> bool:
    mesh = load_or_none(ROCK_MESH)
    if not mesh:
        return False
    a = spawn(mesh, L.ROCK_PIVOT, (0, 0, 0), label="SM_Rock_ShaitanClaw", tags=T("rock"), folder="Rakis/Desert/Rock")
    return a is not None


def rock_from_primitives() -> int:
    """Полосы по Y; ось когтя почти вдоль Y, поэтому каждая полоса — AABB по X = cx ± hw."""
    y0 = L.ROCK_PIVOT[1] - L.ROCK_HALF_LEN
    y1 = L.ROCK_PIVOT[1] + L.ROCK_HALF_LEN
    cy = L.CREVICE_MOUTH[1]
    bounds = sorted({y0 + (y1 - y0) * i / ROCK_BANDS for i in range(ROCK_BANDS + 1)} | {cy - SLOT_HALF, cy + SLOT_HALF})
    bounds = [b for b in bounds if not (cy - SLOT_HALF < b < cy + SLOT_HALF)]
    n = 0
    shaft_x = L.B5["bowl_center"][0]
    for ya, yb in zip(bounds, bounds[1:]):
        t = L.claw_t_for_y((ya + yb) * 0.5)
        cx, _ = L.claw_center(t)
        hw = L.claw_half_width(t)
        h = L.claw_height(t)
        if hw < 200.0:
            continue
        if abs((ya + yb) * 0.5 - cy) < SLOT_HALF:       # полоса расщелины: только тыл за фальшивым камнем
            east = cx + hw
            z0 = L.B1["height"] + 150.0                 # над наземной камерой шлюза B1
            for xa, xb in ((L.CREVICE_END_X, shaft_x - 250.0), (shaft_x + 250.0, east)):  # окно световой шахты
                if LC.box(xa, xb, ya, yb, z0, h * 0.8, T("rock"), f"Rock_Band_{n:02d}", LC.MI_ROCK, "Rakis/Desert/Rock"):
                    n += 1
            continue
        lean = L.claw_lean(t)
        if lean > 500.0:                                # наклонный «коготь» на севере (pitch>0 → верх к западу)
            pitch = math.degrees(math.atan2(lean, h))
            LC.obox(cx - lean * 0.5, (ya + yb) * 0.5, h * 0.5, 2 * hw, yb - ya, h, 0.0, T("rock"),
                    f"Rock_Band_{n:02d}", LC.MI_ROCK, "Rakis/Desert/Rock", pitch=pitch)
        else:
            LC.box(cx - hw, cx + hw, ya, yb, 0.0, h, T("rock"), f"Rock_Band_{n:02d}", LC.MI_ROCK, "Rakis/Desert/Rock")
        # подножие-осыпь: низкий широкий ящик (кроме 25 м вокруг устья расщелины — там тропа)
        if abs((ya + yb) * 0.5 - cy) < 2500.0:
            n += 1
            continue
        LC.box(cx - hw - 900.0, cx + hw + 900.0, ya, yb, -50.0, 600.0, T("rock"), f"Rock_Talus_{n:02d}",
               LC.MI_ROCK, "Rakis/Desert/Rock")
        n += 1
    return n


# ------------------------------------------------------------------ A2 / A3 / A4
def build_islands() -> None:
    for name, x, y, ln, wd, h, yaw in L.SAFE_ISLANDS:
        gz = LC.ground_z(x, y, 0.0)
        LC.obox(x, y, gz + h * 0.5 - 60.0, ln, wd, h, yaw, T("A2"), f"SafeRock_{name}", LC.MI_ROCK, "Rakis/Desert/A2")
        # пара валунов сверху — читаемый силуэт «острова»
        for k, (dx, dy, s) in enumerate(((0.25, 0.1, 0.35), (-0.3, -0.15, 0.25))):
            shape("sphere", (x + dx * ln, y + dy * wd, gz + h - 40.0), (ln * s, wd * s * 1.2, h * 0.9),
                  rotation=(0, 0, yaw + 30 * k), material=LC.MI_ROCK, label=f"SafeRock_{name}_B{k}",
                  tags=T("A2"), folder="Rakis/Desert/A2")


def build_a3() -> None:
    for i, (x, y, ln, wd, top, yaw) in enumerate(L.A3_PLATES):
        LC.obox(x, y, top * 0.5 - 100.0, ln, wd, top + 200.0, yaw, T("A3"), f"Plate_{i:02d}", LC.MI_ROCK, "Rakis/Desert/A3")
    # плита-навес (тень S3): две опоры + наклонная плита
    ax, ay = L.PLATE_ARCH
    LC.obox(ax - 700.0, ay, 300.0, 400.0, 600.0, 600.0, 20.0, T("A3"), "PlateArch_L", LC.MI_ROCK, "Rakis/Desert/A3")
    LC.obox(ax + 700.0, ay, 250.0, 400.0, 600.0, 500.0, 20.0, T("A3"), "PlateArch_R", LC.MI_ROCK, "Rakis/Desert/A3")
    LC.obox(ax, ay, 640.0, 2200.0, 1100.0, 120.0, 20.0, T("A3"), "PlateArch_Top", LC.MI_ROCK, "Rakis/Desert/A3", pitch=-4.0)


def build_a4(have_rock_mesh: bool) -> None:
    mx, my, _ = L.CREVICE_MOUTH
    half = L.CREVICE_WIDTH * 0.5
    if not have_rock_mesh:
        # стены расщелины (зигзаг по 10 м), 60 м высотой; выше — разрыв полос скалы
        segs = 4
        for i in range(segs):
            xa = mx - 300.0 + (L.CREVICE_END_X - mx + 300.0) * i / segs
            xb = mx - 300.0 + (L.CREVICE_END_X - mx + 300.0) * (i + 1) / segs
            off = (60.0, -50.0, 40.0, -30.0)[i]
            LC.box(xa, xb, my - SLOT_HALF - 200.0, my - half + off, 0.0, 6000.0, T("A4"), f"CreviceWall_N{i}", LC.MI_ROCK, "Rakis/Desert/A4")
            LC.box(xa, xb, my + half + off, my + SLOT_HALF + 200.0, 0.0, 6000.0, T("A4"), f"CreviceWall_S{i}", LC.MI_ROCK, "Rakis/Desert/A4")
        # козырёк-«пробка» на 50 м (как в меше: выше — волосяная трещина)
        LC.box(mx, L.CREVICE_END_X, my - SLOT_HALF, my + SLOT_HALF, L.CREVICE_OPEN_H, L.CREVICE_OPEN_H + 800.0,
               T("A4"), "CreviceRoof", LC.MI_ROCK, "Rakis/Desert/A4")
    fx, fy, fl, fw, fh, fyaw = L.CREVICE_FIN
    LC.obox(fx, fy, fh * 0.5 - 100.0, fl, fw, fh, fyaw, T("A4"), "CreviceFin", LC.MI_ROCK, "Rakis/Desert/A4")
    # порог из вытертого камня перед устьем — «вход читается формой»
    LC.obox(mx - 600.0, my, -20.0, 1200.0, 900.0, 60.0, 0.0, T("A4"), "CreviceDoorstep", LC.MI_STONE, "Rakis/Desert/A4")
    build_false_rock()


FALSE_ROCK_SINK = -520.0        # плита уходит в пол (паз под порогом B1), а не вбок: сбоку — стены расщелины


def build_false_rock() -> None:
    """ARakisFalseRock в торце расщелины. Меш плиты C++ грузит сам (SlabMeshAsset = SM_Rock_FalseSlab, иначе куб
    FallbackSlabSize). Для этого экземпляра OpenOffset переопределён: плита опускается, т.к. по бокам — скала."""
    cls = rakis_class("RakisFalseRock")
    loc = L.FALSE_ROCK
    if cls:
        actor = spawn(cls, loc, (0, 0, 0), label="FalseRock_A4", tags=T("A4"), folder="Rakis/Desert/A4")
        if actor:
            set_prop(actor, "open_offset", unreal.Vector(0.0, 0.0, FALSE_ROCK_SINK))
            set_prop(actor, "open_rotation", unreal.Rotator(0.0, 0.0, 0.0))
        return
    mesh = load_or_none(FALSE_ROCK_MESH)
    if mesh:
        spawn(mesh, loc, (0, 0, 0), label="FalseRock_A4", tags=T("A4"), folder="Rakis/Desert/A4")
    else:
        LC.box(loc[0] - 80, loc[0] + 80, loc[1] - 220, loc[1] + 220, 0.0, 500.0, T("A4"), "FalseRock_A4",
               LC.MI_ROCK, "Rakis/Desert/A4")


def build_far_mesas() -> None:
    for i, (x, y, ln, wd, h, yaw) in enumerate(FAR_MESAS):
        LC.obox(x, y, h * 0.5 - 500.0, ln, wd, h, yaw, T("far"), f"FarMesa_{i}", LC.MI_ROCK, "Rakis/Desert/Far")


def build_bounds() -> None:
    """Невидимые стены за 300 м от ядра (мягкая граница — высокие сейфы и буря)."""
    m = 30000.0
    x0, y0 = L.CORE_MIN[0] - m, L.CORE_MIN[1] - m
    x1, y1 = L.CORE_MAX[0] + m, L.CORE_MAX[1] + m
    h = 60000.0
    walls = [((x0 + x1) / 2, y0, x1 - x0, 1000.0), ((x0 + x1) / 2, y1, x1 - x0, 1000.0),
             (x0, (y0 + y1) / 2, 1000.0, y1 - y0), (x1, (y0 + y1) / 2, 1000.0, y1 - y0)]
    for i, (cx, cy, sx, sy) in enumerate(walls):
        v = spawn(unreal.BlockingVolume, (cx, cy, h * 0.5 - 10000.0), label=f"Bounds_{i}", tags=T("bounds"),
                  folder="Rakis/Desert/Bounds")
        if v:
            fit_box_volume(v, (sx, sy, h))   # кисть-куб фабрики объёмов (200 см) → масштаб по фактическим bounds


def main():
    # карты открываем ДО транзакции (загрузка карты сбрасывает буфер undo)
    LC.ensure_persistent_with_sublevels()
    LC.make_current(MAP_DESERT)
    with transaction("Rakis: blockout desert"):
        n = delete_generated(GEN)
        log(f"{GEN}: удалено {n}")
        build_ground()
        have_mesh = rock_from_mesh()
        if not have_mesh:
            log(f"скала из примитивов: {rock_from_primitives()} полос")
        build_islands()
        build_a3()
        build_a4(have_mesh)
        build_far_mesas()
        build_bounds()
    LC.save_all()
    log("level_blockout_desert: готово")


if __name__ == "__main__":
    main()
