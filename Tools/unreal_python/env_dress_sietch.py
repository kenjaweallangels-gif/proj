"""
env_dress_sietch.py — декор сиетча (шаг 8 build_demo). Подуровень L_Rakis_Sietch.

Опирается на разметку level_markup.py (те же функции позиций — smart_objects(), glowglobe_points()),
поэтому реквизит стоит ровно там, где NPC ожидают Smart Object-слоты:
  * B2: прилавки, станки, кувшины, ковры, свисающие с балюстрад полотнища, детская площадка
    («червь и наездник» — песчаный круг, игрушечный червь), торговка водой с водяными кольцами,
    стойка крючьев творца, верстаки починки дистикомбов;
  * B3: занавеси и штанги на всех нишах, подстилки, домашний алтарь Шианы, кувшины;
  * B4: «смертные дистилляторы» (баки) и бортики, кувшины водоносов;
  * B5: молитвенные коврики, курильницы пряности вокруг чаши;
  * резные панели с ТРЕМЯ слоями истории (B1, B2, B3, B5): геометрия резьбы (слой 1 — фрименская
    резьба) + декаль символа Квизарата (слой 2, M_Decal_Carving) + декаль наивной росписи
    возрожденцев (слой 3, M_Decal_Paint);
  * кронштейны светошаров у маркеров Rakis.Glowglobe (сами светошары и свет — light_setup.py).
Кит (/Game/Rakis/Environment/Sietch/SM_Sietch_*) если импортирован, иначе примитивы.
Идемпотентно: gen:env_dress_sietch + blockout:<zone>.
"""
from __future__ import annotations

import math
import random

import unreal

from rakis_common import MAP_SIETCH, delete_generated, load_or_none, log, shape, spawn, transaction, warn
import level_common as LC
import level_layout as L
import level_markup as M
import level_blockout_sietch as S

GEN = "gen:env_dress_sietch"
KIT = "/Game/Rakis/Environment/Sietch/SM_Sietch_"
MI = "/Game/Rakis/Materials/Instances/"
FOLDER = "Rakis/Sietch/Dressing"
SEED = 1500
CLOTH = [f"{MI}MI_Cloth_Worn", f"{MI}MI_Spice_Fabric", LC.MI_STONE]
CLOTH_BLUE = [f"{MI}MI_Cloth_Blue", f"{MI}MI_Cloth_Worn", LC.MI_STONE]
DECALS = {   # слой истории → цепочка материалов
    "Quizarate": [f"{MI}MI_Decal_Quizarate", f"{MI}MI_Decal_Carving", "/Game/Rakis/Materials/Master/M_Decal_Carving"],
    "Revivalist": [f"{MI}MI_Decal_Revivalist", f"{MI}MI_Decal_Paint", "/Game/Rakis/Materials/Master/M_Decal_Paint"],
    "Wear": [f"{MI}MI_Decal_HandPolish", f"{MI}MI_Decal_Carving", "/Game/Rakis/Materials/Master/M_Decal_Carving"],
}


def zone_of(x, y, z):
    for zid, _e, _w, _m, _i, _l, _u, boxes in L.ZONES:
        if zid.startswith("B"):
            for (x0, x1, y0, y1, z0, z1) in boxes:
                if x0 <= x <= x1 and y0 <= y <= y1 and z0 <= z <= z1:
                    return zid
    return "B2"


def T(zone):
    return [GEN, f"blockout:{zone}"]


def mat(chain):
    return LC.try_load(*chain)


def prop(kit_name, loc, yaw=0.0, fallback=None, label=None, scale=(1, 1, 1)):
    """Кит-меш или примитив fallback=(kind, size_cm, z_offset, material_chain)."""
    zone = zone_of(*loc)
    m = load_or_none(f"{KIT}{kit_name}")
    label = label or kit_name
    if m:
        return spawn(m, loc, (0, 0, yaw), scale, label=label, tags=T(zone), folder=f"{FOLDER}/{zone}")
    if fallback is None:
        return None
    kind, size, zoff, mchain = fallback
    a = shape(kind, (loc[0], loc[1], loc[2] + zoff), size, rotation=(0, 0, yaw), label=label, tags=T(zone),
              folder=f"{FOLDER}/{zone}")
    m2 = mat(mchain) if mchain else None
    if a and m2:
        a.static_mesh_component.set_material(0, m2)
    return a


def fwd(yaw, d):
    return math.cos(math.radians(yaw)) * d, math.sin(math.radians(yaw)) * d


# ------------------------------------------------------------------ по слотам Smart Object
def dress_smart_objects(rnd):
    for i, (typ, x, y, z, yaw) in enumerate(M.smart_objects()):
        if typ == "Stall":
            dx, dy = fwd(yaw, -60)
            prop("Stall_Counter", (x + dx, y + dy, z), yaw + 90, ("cube", (250, 80, 100), 50, None), f"Stall_{i:02d}")
            for k in range(rnd.randint(2, 4)):     # товар: кувшины, свёртки ткани
                ox = rnd.uniform(-100, 100)
                prop("WaterJar_A" if k % 2 else "Carpet_2x3", (x + dx + ox * math.sin(math.radians(yaw)),
                     y + dy - ox * math.cos(math.radians(yaw)), z + 105), rnd.uniform(0, 360),
                     ("cylinder", (40, 40, 60), 30, None), f"Stall_{i:02d}_Goods{k}", (0.6, 0.6, 0.6))
        elif typ == "Loom":
            dx, dy = fwd(yaw, -80)
            prop("Loom_Frame", (x + dx, y + dy, z), yaw + 90, ("cube", (212, 40, 220), 110, CLOTH), f"Loom_{i:02d}")
        elif typ == "WaterJar":
            for k in range(3):
                ox, oy = rnd.uniform(-60, 60), rnd.uniform(-60, 60)
                prop("WaterJar_B" if k == 0 else "WaterJar_A", (x + ox, y + oy, z), rnd.uniform(0, 360),
                     ("cylinder", (55, 55, 80), 40, None), f"Jar_{i:02d}_{k}")
        elif typ == "PrayerMat":
            prop("PrayerMat", (x, y, z + 1), yaw + 90, ("cube", (80, 170, 2), 1, CLOTH), f"PrayerMat_{i:02d}")
        elif typ == "Bench":
            dx, dy = fwd(yaw, -40)
            prop("Bench_2m", (x + dx, y + dy, z), yaw + 90, ("cube", (200, 50, 45), 22, None), f"Bench_{i:02d}")
        elif typ == "StillsuitRepair":
            dx, dy = fwd(yaw, -70)
            prop("StillsuitBench", (x + dx, y + dy, z), yaw + 90, ("cube", (210, 100, 90), 45, None), f"StillsuitBench_{i:02d}")
        elif typ == "Niche":
            prop("Carpet_2x3", (x, y, z + 46), yaw, ("cube", (200, 230, 3), 1, CLOTH), f"NicheBedding_{i:02d}", (1.0, 0.75, 1.0))


# ------------------------------------------------------------------ занавеси на нишах B3
def dress_curtains():
    fl = L.B3A["floor"]
    for spec, (west, east), tag in ((L.B3A, S.B3A_NICHES, "a"), (L.B3C, S.B3C_NICHES, "c")):
        for side, ys in ((-1, west), (1, east)):
            # проём ниши — в стене коридора; занавесь на внутренней грани стены, сдвинута в коридор на 5 см
            x = spec["x"] + side * (spec["width"] / 2 - 5)
            for j, yc in enumerate(ys):
                yaw = 90.0 if side < 0 else 270.0
                y0 = yc - 150 if side < 0 else yc + 150
                prop("CurtainRod_2m", (x, y0, fl + 255), yaw, ("cylinder", (5, 5, 300), 0, None),
                     f"NicheRod_{tag}{side:+d}_{j}", (1.5, 1, 1))
                prop("Curtain_2m", (x, y0, fl + 250), yaw, ("cube", (4, 300, 240), -120, CLOTH_BLUE if j % 2 else CLOTH),
                     f"NicheCurtain_{tag}{side:+d}_{j}", (1.5, 1, 1.0))


# ------------------------------------------------------------------ B2 особые места
def dress_gallery(rnd):
    g = L.B2
    fl, bal = g["floor"], g["balcony"]
    # ковры по центру нижнего яруса
    for i, x in enumerate((151200, 152300, 153900)):
        prop("Carpet_2x3", (x, 72500, fl + 1), 90 + rnd.uniform(-8, 8), ("cube", (200, 300, 2), 1, CLOTH), f"Carpet_{i}")
    # полотнища, свисающие с балюстрад (синие/охристые) — вертикальные акценты
    for i, x in enumerate(range(150000, 154500, 900)):
        for side, y in ((0, g["y0"] + g["balcony_depth"] + 15), (1, g["y1"] - g["balcony_depth"] - 15)):
            if (i + side) % 2:
                continue
            a = shape("cube", (x + 200, y, bal - 250), (110, 2, 480), label=f"Banner_{i}_{side}",
                      tags=T("B2"), folder=f"{FOLDER}/B2")
            m = mat(CLOTH_BLUE if (i // 2) % 2 else CLOTH)
            if a and m:
                a.static_mesh_component.set_material(0, m)
    # детская площадка: песчаный круг + игрушечный «червь» из 6 сфер + палка-«крюк»
    cx, cy = 153200.0, 72500.0
    a = shape("cylinder", (cx, cy, fl + 2), (520, 520, 4), label="Kids_SandCircle", tags=T("B2"), folder=f"{FOLDER}/B2")
    if a:
        sm = LC.try_load(LC.MI_SAND)
        if sm:
            a.static_mesh_component.set_material(0, sm)
    for k in range(6):
        r = 30 - k * 3
        shape("sphere", (cx - 150 + k * 45, cy + 40 * math.sin(k), fl + r), (r * 2, r * 2, r * 2),
              label=f"Kids_ToyWorm_{k}", tags=T("B2"), folder=f"{FOLDER}/B2")
    shape("cylinder", (cx + 120, cy - 80, fl + 60), (4, 4, 120), rotation=(0, 30, 20), label="Kids_ToyHook",
          tags=T("B2"), folder=f"{FOLDER}/B2")
    # торговка водой: водяные кольца на шнурах над прилавком
    for k in range(4):
        prop("WaterRings", (151000 + k * 25 - 40, 72880, fl + 210), 0.0, ("cylinder", (12, 12, 2), 0, None),
             f"WaterSeller_Rings_{k}")
    # стойка крючьев творца (LORE_Maker_Hooks) + 4 крюка
    hx, hy = 153900.0, 71900.0
    prop("MakerHooks_Rack", (hx, hy, fl), 0.0, ("cube", (300, 50, 180), 90, None), "MakerHooks_Rack")
    for k in range(4):
        prop("MakerHooks", (hx - 120 + k * 80, hy + 10, fl + 10), 0.0, ("cylinder", (8, 8, 250), 125, None),
             f"MakerHook_{k}", (1, 1, 1))
    # световые колодцы: кольцо у потолка
    for i, x in enumerate((150500, 153000)):
        prop("LightShaft_Ring", (x, 72500, g["ceiling"] - 60), 0.0, None, f"Well_Ring_{i}", (0.4, 0.4, 0.6))


# ------------------------------------------------------------------ B4, B5
def dress_cistern_and_hall(rnd):
    b4 = L.B4
    # «смертные дистилляторы» — баки с воронкой, у западной стены цистерны
    for i, y in enumerate((73500, 74400)):
        shape("cylinder", (156350, y, b4["floor"] + 180), (180, 180, 360), label=f"Deathstill_{i}", tags=T("B4"),
              folder=f"{FOLDER}/B4", material=LC.MI_ROCK)
        shape("cone", (156350, y, b4["floor"] + 420), (180, 180, 120), label=f"Deathstill_{i}_Funnel", tags=T("B4"),
              folder=f"{FOLDER}/B4", material=LC.MI_ROCK)
    pool = (156600.0, 158400.0, 73500.0, 74600.0)
    if load_or_none(f"{KIT}Cistern_Edge_4m"):
        for i, x in enumerate((156600.0, 157000.0)):
            prop("Cistern_Edge_4m", (x + i * 400, pool[2] - 40, b4["floor"]), 0.0, None, f"PoolEdge_N{i}")
    h = L.B5
    cx, cy = h["bowl_center"]
    # курильницы пряности (дымка — NS_Spice_Haze ставит fx_niagara) по 4 углам чаши
    for i, (dx, dy) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1))):
        x, y = cx + dx * (h["bowl_half"] + 80), cy + dy * (h["bowl_half"] + 80)
        shape("cylinder", (x, y, L.b5_tier_top(0) + 40), (50, 50, 80), label=f"Censer_{i}", tags=T("B5"),
              folder=f"{FOLDER}/B5", material=LC.MI_ROCK)
    # помост наиба: ковёр
    prop("Carpet_2x3", (h["x1"] - 250, cy, h["terrace"] + 61), 0.0, ("cube", (200, 300, 2), 1, CLOTH_BLUE), "Dais_Carpet")


# ------------------------------------------------------------------ резьба: три слоя истории
PANELS = [
    # (x, y, z пола, yaw «лицом в комнату», зона-пояснение)
    (145450, 72300, 0.0, 90.0, "B1 шлюз"),
    (146900, 72700, L.B1["floor_top"] + (L.B1["floor_bottom"] - L.B1["floor_top"]) * 0.5, 270.0, "B1 лестница"),
    (149050, 71750, -1400.0, 90.0, "B2 площадка"),
    (150300, 73250, -2000.0, 270.0, "B2 юг"),
    (152000, 73250, -2000.0, 270.0, "B2 юг (роспись LORE_Revivalist_Mural)"),
    (152800, 71750, -2000.0, 90.0, "B2 север"),
    (154500, 72000, -2000.0, 180.0, "B2 восток"),
    (153350, 70300, -2000.0, 0.0, "B3a"),
    (153650, 74700, -2000.0, 180.0, "B3c"),
    (156200, 72350, L.b3b_floor_z(156200), 90.0, "B3b"),
    (159500, 71400, -4200.0, 0.0, "B5 запад"),
    (164500, 71600, -4200.0, 180.0, "B5 помост"),
    (164500, 73400, -4200.0, 180.0, "B5 помост"),
]


def dress_carvings():
    quiz = mat(DECALS["Quizarate"])
    paint = mat(DECALS["Revivalist"])
    wear = mat(DECALS["Wear"])
    if not (quiz and paint):
        warn("декали слоёв 2/3 не найдены (M_Decal_Carving / M_Decal_Paint) — ставлю DecalActor без материала")
    for i, (x, y, z, yaw, _note) in enumerate(PANELS):
        # слой 1 — фрименская резьба (геометрия панели), стоит вплотную к стене, лицом в комнату
        rx, ry = fwd(yaw + 90, -100)                    # панель 2 м: pivot у левого края
        # кит-панель: рельеф смотрит в −Y модуля → поворот yaw+90 разворачивает −Y «в комнату»
        prop("Carved_Panel_2m", (x + rx, y + ry, z + 60), yaw + 90,
             ("cube", (200, 15, 200), 100, None), f"Carving_{i:02d}")
        # слой 2 — символ Квизарата поверх резьбы (выше и чуть сбоку: «имперская правка»)
        for layer, m, dz, dside, size in (("L2_Quizarate", quiz, 210, 40, (60, 90, 90)),
                                          ("L3_Revivalist", paint, 120, -60, (60, 140, 110)),
                                          ("Wear", wear, 60, 0, (40, 220, 60))):
            ox, oy = fwd(yaw + 90, dside)
            d = spawn(unreal.DecalActor, (x + ox, y + oy, z + 60 + dz), (0, 0, yaw + 180), label=f"Carving_{i:02d}_{layer}",
                      tags=T(zone_of(x, y, z + 100)), folder=f"{FOLDER}/Carvings")
            if not d:
                continue
            try:
                if m:
                    d.set_decal_material(m)
                d.decal.set_editor_property("decal_size", unreal.Vector(*size))
            except Exception as e:  # noqa: BLE001
                warn(f"декаль {layer}: {e}")


def dress_glowglobe_brackets():
    br = load_or_none(f"{KIT}Glowglobe_Bracket")
    for i, (x, y, z, yaw) in enumerate(M.glowglobe_points()):
        if br:
            # у кронштейна стена — +Y модуля → поворачиваем так, чтобы +Y смотрел в стену (yaw маркера — в комнату)
            spawn(br, (x, y, z), (0, 0, yaw + 90), label=f"GlowBracket_{i:02d}", tags=T(zone_of(x, y, z)),
                  folder=f"{FOLDER}/Glowglobes")
        else:
            bx, by = fwd(yaw, -20)
            shape("cube", (x + bx, y + by, z), (20, 20, 30), rotation=(0, 0, yaw), material=LC.MI_ROCK,
                  label=f"GlowBracket_{i:02d}", tags=T(zone_of(x, y, z)), folder=f"{FOLDER}/Glowglobes")


def main():
    with transaction("Rakis: dress sietch"):
        LC.ensure_persistent_with_sublevels()
        LC.make_current(MAP_SIETCH)
        n = delete_generated(GEN)
        log(f"{GEN}: удалено {n}")
        rnd = random.Random(SEED)
        for fn, args in ((dress_smart_objects, (rnd,)), (dress_curtains, ()), (dress_gallery, (rnd,)),
                         (dress_cistern_and_hall, (rnd,)), (dress_carvings, ()), (dress_glowglobe_brackets, ())):
            try:
                fn(*args)
            except Exception as e:  # noqa: BLE001
                warn(f"{fn.__name__}: {e}")
        LC.save_all()
        log("env_dress_sietch: готово")


if __name__ == "__main__":
    main()
