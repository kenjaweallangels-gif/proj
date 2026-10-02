"""
level_markup.py — разметка L_Rakis_Persistent (T-003/T-004, шаг 5 build_demo).

Ставит в Persistent (контракт §2.3: зоны, точки игрока, StoryDirector):
  * APlayerStart (Rakis.PlayerStart), спутники ARakisCompanion (Rakis.Companion.Ilva/Rayn/Ossana, CompanionId);
  * ARakisWorm в точке покоя + TargetPoint Rakis.Worm.Spawn, TargetPoint Rakis.Worm.Reveal (80 м от тропы, против солнца);
  * ARakisZoneVolume на каждую зону (Zone, WeatherPreset, Music, bInterior, LevelsToLoad/Unload);
  * ARakisCinematicTrigger: LS_WormReveal (A2), LS_HallFinale (B5); ARakisStoryDirector (Rakis.Story);
  * ARakisCrowdSpawner + ≥60 точек Rakis.CrowdSpawn(.<Archetype>), ≥60 Rakis.HallGather на ярусах B5;
  * слоты Rakis.SmartObject.<Type>, ≥40 маркеров Rakis.Glowglobe, POI ARakisInspectable (LoreID, Rakis.POI.<LoreID>);
  * NavMeshBoundsVolume (сиетч + коридор тропы), AudioVolume с реверберацией для B1–B5;
  * предложение (не контракт): TargetPoint Rakis.Ellipsis.A2/A3 — перенос группы на «золотом пути».
Идемпотентно: gen:level_markup. Координаты — level_layout.py / docs/level/layout.md.
"""
from __future__ import annotations

import math

import unreal

from rakis_common import (MAP_DESERT, MAP_PERSISTENT, MAP_SIETCH, delete_generated, load_or_none, log,
                          rakis_class, set_prop, spawn, transaction, warn)
import level_common as LC
import level_layout as L

GEN = "gen:level_markup"
FOLDER = "Rakis/Markup"
PLACE_COMPANION_ACTORS = True   # False → только TargetPoint с тегами (если спутников спавнит StoryDirector)
CAPSULE_HALF = 96.0

_counts: dict[str, int] = {}


def tagged(tags, location, label, yaw=0.0, cls=None, folder=FOLDER):
    for t in tags:
        _counts[t] = _counts.get(t, 0) + 1
    return LC.marker(location, [GEN] + list(tags), label, yaw, folder, cls)


def gz(x, y, default):
    return LC.ground_z(x, y, default)


# ------------------------------------------------------------------ игрок, спутники, сюжет
def place_player_and_story():
    sx, sy, sz = L.START
    yaw = LC.yaw_to((sx, sy), (L.ROCK_PIVOT[0], L.ROCK_PIVOT[1]))
    z = gz(sx, sy, sz) + CAPSULE_HALF + 2.0
    tagged(["Rakis.PlayerStart"], (sx, sy, z), "PlayerStart_A1", yaw, unreal.PlayerStart)
    # спутники: цепочка по гребню за игроком (Илва −3 м, Рэйн −6 м); Оссана — у точки выхода червя
    dx, dy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    comps = [("Ilva", sx - dx * 300 + dy * 120, sy - dy * 300 - dx * 120),
             ("Rayn", sx - dx * 600 - dy * 80, sy - dy * 600 + dx * 80),
             ("Ossana", L.WORM_REVEAL[0] - 1500.0, L.WORM_REVEAL[1] - 400.0)]
    cls = rakis_class("RakisCompanion") if PLACE_COMPANION_ACTORS else None
    for cid, x, y in comps:
        z = gz(x, y, 300.0) + CAPSULE_HALF + 2.0
        a = tagged([f"Rakis.Companion.{cid}"], (x, y, z), f"Companion_{cid}", yaw, cls or unreal.TargetPoint)
        if a and cls:
            set_prop(a, "companion_id", unreal.Name(cid))
    story_cls = rakis_class("RakisStoryDirector")
    tagged(["Rakis.Story"], (sx - 1000.0, sy, sz + 500.0), "StoryDirector", 0.0, story_cls or unreal.TargetPoint)
    # предложение: точки эллипсисов золотого пути (см. layout.md §4)
    for name, p in (("A2", L.ELLIPSIS_A2), ("A3", L.ELLIPSIS_A3)):
        z = gz(p[0], p[1], p[2]) + CAPSULE_HALF + 2.0
        nxt = L.GOLDEN_PATH[4] if name == "A2" else L.GOLDEN_PATH[9]
        tagged([f"Rakis.Ellipsis.{name}"], (p[0], p[1], z), f"Ellipsis_{name}", LC.yaw_to(p, (nxt[1], nxt[2])))
    # финал: опорные точки для LS_HallFinale (без контрактных тегов — привязка в Sequencer)
    h = L.B5
    cx, cy = h["bowl_center"]
    for label, x, y, z, yaw in (("NPC_Harmat", h["x1"] - 250.0, cy, h["terrace"] + 60.0, 180.0),
                                ("NPC_Priestess", h["x1"] - 350.0, cy - 450.0, h["terrace"], 200.0),
                                ("NPC_Dancer", cx, cy, h["bowl"], 0.0)):
        LC.marker((x, y, z + CAPSULE_HALF), [GEN], label, yaw, f"{FOLDER}/Cine")


# ------------------------------------------------------------------ червь
def place_worm():
    rx, ry, _ = L.WORM_REVEAL
    sx, sy, sz = L.WORM_SPAWN
    face = LC.yaw_to((sx, sy), (rx, ry))
    tagged(["Rakis.Worm.Spawn"], (sx, sy, sz), "Worm_Spawn", face)
    tagged(["Rakis.Worm.Reveal"], (rx, ry, gz(rx, ry, 0.0)), "Worm_Reveal", L.WORM_REVEAL_YAW)
    cls = rakis_class("RakisWorm")
    if cls:
        spawn(cls, (sx, sy, sz), (0, 0, face), label="Worm_ShaiHulud", tags=[GEN], folder=f"{FOLDER}/Worm")
    else:
        warn("ARakisWorm не найден — червь не поставлен (только точки)")


# ------------------------------------------------------------------ зоны
def _world_refs(names):
    paths = {L.DESERT: MAP_DESERT, L.SIETCH: MAP_SIETCH}
    out = []
    for n in names:
        p = paths[n]
        w = load_or_none(p)
        if w is None:
            warn(f"нет уровня {p} для LevelsToLoad/Unload")
            continue
        out.append(w)
    return out


def _set_levels(vol, prop, names):
    if not names:
        return
    refs = _world_refs(names)
    if set_prop(vol, prop, refs):
        return
    try:  # фолбэк: мягкие пути
        vol.set_editor_property(prop, [unreal.SoftObjectPath(f"{p.get_path_name()}") for p in refs])
    except Exception as e:  # noqa: BLE001
        warn(f"{vol.get_actor_label()}.{prop}: {e} — задайте вручную")


def _set_bool(obj, names, value):
    for n in names:
        try:
            obj.set_editor_property(n, value)
            return True
        except Exception:  # noqa: BLE001
            continue
    warn(f"{obj.get_name()}: bool {names[0]} не найден")
    return False


def place_zones():
    cls = rakis_class("RakisZoneVolume")
    for zid, enum_name, weather, music, interior, load, unload, boxes in L.ZONES:
        for i, (x0, x1, y0, y1, z0, z1) in enumerate(boxes):
            c = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
            vol = spawn(cls or unreal.TriggerVolume, c, label=f"Zone_{zid}_{i}", tags=[GEN], folder=f"{FOLDER}/Zones")
            if not vol:
                continue
            vol.set_actor_scale3d(unreal.Vector((x1 - x0) / 200.0, (y1 - y0) / 200.0, (z1 - z0) / 200.0))
            if not cls:
                continue
            zv = LC.enum_value("RakisZone", enum_name)
            if zv is not None:
                set_prop(vol, "zone", zv)
            set_prop(vol, "weather_preset", unreal.Name(weather))
            mv = LC.enum_value("RakisMusicState", music)
            if mv is not None:
                set_prop(vol, "music", mv)
            _set_bool(vol, ("interior", "b_interior", "bInterior"), interior)
            _set_levels(vol, "levels_to_load", load)
            _set_levels(vol, "levels_to_unload", unload)
            if zid in REVERB:   # реверберацию включает URakisAudioDirector по ARakisZoneVolume.Reverb
                eff = LC.try_load(f"/Game/Rakis/Audio/Reverb/{REVERB[zid][0]}", f"/Game/Rakis/Audio/{REVERB[zid][0]}")
                if eff:
                    set_prop(vol, "reverb", eff)


# ------------------------------------------------------------------ кат-сцены
def place_cinematics():
    cls = rakis_class("RakisCinematicTrigger")
    for name, seq_path, (x, y, z), (sx, sy, sz) in L.CINEMATICS:
        if z > -1000.0:     # пустыня — на высоту земли
            z = gz(x, y, z) + sz * 0.5
        a = spawn(cls or unreal.TriggerBox, (x, y, z), label=name, tags=[GEN], folder=f"{FOLDER}/Cinematics")
        if not a:
            continue
        seq = load_or_none(seq_path)
        if cls and seq:
            if not (set_prop(a, "sequence", seq) or set_prop(a, "level_sequence", seq)):
                warn(f"{name}: свойство последовательности не найдено — назначьте {seq_path} вручную")
        elif cls:
            warn(f"{name}: {seq_path} ещё не создан — назначьте после создания")
        try:
            box = a.get_component_by_class(unreal.BoxComponent)
            if box:
                box.set_box_extent(unreal.Vector(sx / 2, sy / 2, sz / 2), True)
            elif not cls:
                a.set_actor_scale3d(unreal.Vector(sx / 64.0, sy / 64.0, sz / 64.0))  # TriggerBox 64 см
        except Exception as e:  # noqa: BLE001
            warn(f"{name}: размер триггера — {e}")


# ------------------------------------------------------------------ толпа, ритуал
def crowd_points():
    """[(archetype, x, y, z, yaw)] — ≥60 точек по архетипам и смыслу мест."""
    g, b4, h = L.B2, L.B4, L.B5
    fl, bal = g["floor"], g["balcony"]
    yN, yS = g["y0"] + 150.0, g["y1"] - 150.0          # аркады под балконами
    pts = []
    for x in (150800, 151600, 152400, 154100):           # торговцы за прилавками (север)
        pts.append(("Trader", x, yN - 60, fl, 90.0))
    for x, y in ((151000, 72050), (152600, 72050)):
        pts.append(("Trader", x, y - 200, bal, 90.0))
    for x, y in ((151800, 72950), (153400, 72950)):
        pts.append(("Trader", x, y + 200, bal, 270.0))
    pts += [("Trader", 151000, 72850, fl, 270.0), ("Trader", 151150, 72700, fl, 200.0)]   # торговка водой
    for x in (150700, 151500, 152300, 153100):           # ткачи у станков (юг)
        pts.append(("Weaver", x, yS + 60, fl, 270.0))
    for x in (150600, 152000):
        pts.append(("Weaver", x, 73120, bal, 270.0))
    pts += [("Weaver", 152800, 73120, bal, 250.0), ("Weaver", 153700, 72800, fl, 300.0)]
    pts += [("Artisan", 154050, 73000, fl, 270.0), ("Artisan", 149300, 73050, bal, 270.0),
            ("Artisan", 153800, 73050, fl, 240.0), ("Artisan", 152900, 73050, fl, 290.0),
            ("Artisan", 150300, 71950, fl, 80.0), ("Artisan", 153900, 71950, fl, 100.0),
            ("Artisan", 155000, 72500, fl, 0.0), ("Artisan", 156400, 72420, L.b3b_floor_z(156400), 0.0)]
    pts += [("WaterCarrier", 156500, 73300, b4["floor"], 90.0), ("WaterCarrier", 158500, 74700, b4["floor"], 200.0),
            ("WaterCarrier", 157400, 74800, b4["floor"], 270.0), ("WaterCarrier", 157150, 72420, -2850, 90.0),
            ("WaterCarrier", 151300, 72900, fl, 180.0), ("WaterCarrier", 150900, 72600, fl, 30.0),
            ("WaterCarrier", 153500, 75800, fl, 270.0)]
    cx, cy, r = 153200.0, 72500.0, 220.0                 # дети: «червь и наездник» по кругу
    for i in range(8):
        a = math.tau * i / 8
        pts.append(("Child", cx + r * math.cos(a), cy + r * math.sin(a) * 0.8, fl, math.degrees(a) + 90.0))
    b1 = L.B1
    pts += [("Guard", (b1["door1_x"] + b1["door2_x"]) / 2, b1["y0"] - 160, 0.0, 90.0),
            ("Guard", (b1["door1_x"] + b1["door2_x"]) / 2, b1["y1"] + 160, 0.0, 270.0),
            ("Guard", b1["x1"] - 150, 72400, b1["floor_bottom"], 180.0),
            ("Guard", 149300, 72000, bal, 90.0), ("Guard", 154300, 72300, fl, 180.0),
            ("Guard", h["x0"] + 200, 72200, h["balcony"], 0.0), ("Guard", h["x1"] - 150, 73200, h["terrace"], 180.0)]
    pts += [("Pilgrim", 150500, 71900, bal, 90.0), ("Pilgrim", 152500, 71900, bal, 120.0),
            ("Pilgrim", 151500, 73100, bal, 270.0), ("Pilgrim", 154200, 73100, bal, 230.0),
            ("Pilgrim", 153500, 70000, fl, 90.0), ("Pilgrim", 153500, 68900, fl, 270.0),
            ("Pilgrim", 160200, 70900, h["terrace"], 45.0), ("Pilgrim", 160300, 74100, h["terrace"], 315.0)]
    pts += [("Elder", 153100, 69500, fl, 0.0), ("Elder", 153900, 74000, fl, 180.0), ("Elder", 153100, 75500, fl, 0.0),
            ("Elder", 150000, 71900, bal, 90.0), ("Elder", 163000, 70900, h["terrace"], 90.0),
            ("Elder", 163000, 74100, h["terrace"], 270.0)]
    return pts


def hall_gather_points():
    h = L.B5
    cx, cy = h["bowl_center"]
    out = []
    per_tier = 13
    for k in range(h["tier_count"]):
        r = h["bowl_half"] + (k + 0.5) * h["tier_width"]
        z = L.b5_tier_top(k)
        # периметр кольца без восточной стороны (помост наиба): север → запад → юг
        path = [(cx + r, cy - r), (cx - r, cy - r), (cx - r, cy + r), (cx + r, cy + r)]
        segs = list(zip(path, path[1:]))
        total = sum(math.dist(a, b) for a, b in segs)
        for i in range(per_tier):
            d = total * (i + 0.5) / per_tier
            for a, b in segs:
                ln = math.dist(a, b)
                if d <= ln:
                    x = a[0] + (b[0] - a[0]) * d / ln
                    y = a[1] + (b[1] - a[1]) * d / ln
                    break
                d -= ln
            out.append((x, y, z, LC.yaw_to((x, y), (cx, cy))))
    return out


def place_crowd():
    for i, (arch, x, y, z, yaw) in enumerate(crowd_points()):
        tagged(["Rakis.CrowdSpawn", f"Rakis.CrowdSpawn.{arch}"], (x, y, z + CAPSULE_HALF), f"Crowd_{arch}_{i:02d}", yaw,
               folder=f"{FOLDER}/Crowd")
    for i, (x, y, z, yaw) in enumerate(hall_gather_points()):
        tagged(["Rakis.HallGather"], (x, y, z + CAPSULE_HALF), f"HallGather_{i:02d}", yaw, folder=f"{FOLDER}/HallGather")
    cls = rakis_class("RakisCrowdSpawner")
    g = L.B2
    if cls:
        spawn(cls, ((g["x0"] + g["x1"]) / 2, L.SIETCH_AXIS_Y, g["floor"] + 300.0), label="CrowdSpawner_Sietch",
              tags=[GEN], folder=f"{FOLDER}/Crowd")


# ------------------------------------------------------------------ smart objects
def smart_objects():
    g, h = L.B2, L.B5
    fl, bal = g["floor"], g["balcony"]
    so = []
    so += [("Stall", x, g["y0"] + 90, fl, 90.0) for x in (150800, 151600, 152400, 154100)]
    so += [("Stall", 151000, 71900, bal, 90.0), ("Stall", 152600, 71900, bal, 90.0),
           ("Stall", 151800, 73100, bal, 270.0), ("Stall", 153400, 73100, bal, 270.0)]
    so += [("Loom", x, g["y1"] - 90, fl, 270.0) for x in (150700, 151500, 152300, 153100)]
    so += [("Loom", 150600, 73100, bal, 270.0), ("Loom", 152000, 73100, bal, 270.0)]
    so += [("WaterJar", 151000, 72950, fl, 270.0), ("WaterJar", 151200, 72950, fl, 270.0),
           ("WaterJar", 157350, 72420, -2850, 90.0), ("WaterJar", 156400, 73150, L.B4["floor"], 90.0),
           ("WaterJar", 158700, 73150, L.B4["floor"], 90.0), ("WaterJar", 153050, 69500, fl, 0.0),
           ("WaterJar", 153900, 75200, fl, 180.0), ("WaterJar", 153800, 71850, bal, 90.0)]
    hg = hall_gather_points()                                   # 13 точек на ярус, ярус 4 — последние
    for (x, y, z, yaw) in hg[-13:][::2] + hg[-26:-13][1::4]:    # 7 + 3 коврика на двух внешних ярусах
        so.append(("PrayerMat", x, y, z, yaw))
    so += [("PrayerMat", 153050, 68300, fl, 0.0), ("PrayerMat", 153900, 69900, fl, 180.0),
           ("PrayerMat", 153050, 74300, fl, 0.0), ("PrayerMat", 153900, 75200, fl, 180.0)]
    so += [("Bench", 150000, 71850, bal, 90.0), ("Bench", 153000, 71850, bal, 90.0),
           ("Bench", 151000, 73150, bal, 270.0), ("Bench", 154000, 73150, bal, 270.0),
           ("Bench", 157400, 72400, -2850, 90.0), ("Bench", 153500, 67900, fl, 90.0),
           ("Bench", 162500, 70850, h["terrace"], 90.0), ("Bench", 162500, 74150, h["terrace"], 270.0)]
    import level_blockout_sietch as S  # позиции ниш — источник истины блокаута
    a, c = L.B3A, L.B3C
    for yc in S.B3A_NICHES[0]:
        so.append(("Niche", a["x"] - a["width"] / 2 - 100 - 125, yc, fl, 0.0))
    for yc in S.B3A_NICHES[1]:
        so.append(("Niche", a["x"] + a["width"] / 2 + 100 + 125, yc, fl, 180.0))
    for yc in S.B3C_NICHES[0]:
        so.append(("Niche", c["x"] - c["width"] / 2 - 100 - 125, yc, fl, 0.0))
    for yc in S.B3C_NICHES[1]:
        so.append(("Niche", c["x"] + c["width"] / 2 + 100 + 125, yc, fl, 180.0))
    so += [("StillsuitRepair", 154050, 73100, fl, 270.0), ("StillsuitRepair", 149200, 73050, bal, 270.0)]
    return so


def place_smart_objects():
    for i, (typ, x, y, z, yaw) in enumerate(smart_objects()):
        tagged([f"Rakis.SmartObject.{typ}"], (x, y, z), f"SO_{typ}_{i:02d}", yaw, folder=f"{FOLDER}/SmartObjects")


# ------------------------------------------------------------------ светошары
def glowglobe_points():
    """[(x, y, z, yaw)] — маркер у стены (30 см в комнату), высота 2.4 м над полом; yaw — в комнату."""
    pts = []
    b1 = L.B1
    for i, x in enumerate((144600, 145500, 146300, 147000, 147700, 148300)):
        y = b1["y0"] + 30 if i % 2 == 0 else b1["y1"] - 30
        floor = b1["floor_top"] if x <= b1["chamber_x1"] else (
            b1["floor_bottom"] if x >= b1["stair_x1"] else
            b1["floor_top"] + (b1["floor_bottom"] - b1["floor_top"]) * (x - b1["chamber_x1"]) / (b1["stair_x1"] - b1["chamber_x1"]))
        pts.append((x, y, floor + 240, 90.0 if i % 2 == 0 else 270.0))
    g = L.B2
    for x in range(149000, 154500, 800):
        pts.append((x, g["y0"] + 30, g["floor"] + 300, 90.0))
        pts.append((x + 400, g["y1"] - 30, g["floor"] + 300, 270.0))
    for x in (150000, 152000, 154000):
        pts.append((x, g["y0"] + 30, g["balcony"] + 240, 90.0))
        pts.append((x - 1000, g["y1"] - 30, g["balcony"] + 240, 270.0))
    a, c, s = L.B3A, L.B3C, L.B3B
    for y in (71200, 70100, 69000, 67950):
        pts.append((a["x"] - a["width"] / 2 + 30, y, a["floor"] + 240, 0.0))
    for y in (73800, 74800, 75900):
        pts.append((c["x"] + c["width"] / 2 - 30, y, c["floor"] + 240, 180.0))
    for x in (155000, 156000, 157250, 158200, 159200):
        pts.append((x, s["y0"] + 30, L.b3b_floor_z(x) + 240, 90.0))
    b4 = L.B4
    for x, y in ((156200, 73100), (158800, 73100), (156200, 74900), (158800, 74900)):
        pts.append((x, y, b4["floor"] + 300, 0.0))
    h = L.B5
    for x in (160500, 161800, 163100, 164200):
        pts.append((x, h["y0"] + 90, h["terrace"] + 260, 90.0))
        pts.append((x, h["y1"] - 90, h["terrace"] + 260, 270.0))
    pts += [(h["x0"] + 30, h["balcony_y0"] - 100, h["balcony"] + 240, 0.0),
            (h["x0"] + 30, h["balcony_y1"] + 100, h["balcony"] + 240, 0.0)]
    return pts


def place_glowglobes():
    for i, (x, y, z, yaw) in enumerate(glowglobe_points()):
        tagged(["Rakis.Glowglobe"], (x, y, z), f"Glowglobe_{i:02d}", yaw, folder=f"{FOLDER}/Glowglobes")


# ------------------------------------------------------------------ POI
def place_pois():
    cls = rakis_class("RakisInspectable")
    for lore, x, y, z, yaw, _desc in L.POIS:
        if x < L.CREVICE_MOUTH[0]:                               # пустыня — на землю
            z = gz(x, y, z) + 120.0
        a = tagged([f"Rakis.POI.{lore}"], (x, y, z), f"POI_{lore}", yaw, cls or unreal.TargetPoint, f"{FOLDER}/POI")
        if a and cls:
            if not set_prop(a, "lore_id", unreal.Name(lore)):
                set_prop(a, "LoreID", unreal.Name(lore))


# ------------------------------------------------------------------ навигация и звук
def place_nav():
    def nav(label, x0, x1, y0, y1, z0, z1):
        v = spawn(unreal.NavMeshBoundsVolume, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), label=label,
                  tags=[GEN], folder=f"{FOLDER}/Nav")
        if v:
            v.set_actor_scale3d(unreal.Vector((x1 - x0) / 200.0, (y1 - y0) / 200.0, (z1 - z0) / 200.0))
    nav("Nav_Sietch", 140000, 165000, 66500, 77000, -5500, 1200)
    path = [(p[1], p[2]) for p in L.GOLDEN_PATH if p[4] in ("A1", "A2", "A3", "A4")]
    pad = 6000.0
    for i, (a, b) in enumerate(zip(path, path[1:])):
        nav(f"Nav_Path_{i:02d}", min(a[0], b[0]) - pad, max(a[0], b[0]) + pad,
            min(a[1], b[1]) - pad, max(a[1], b[1]) + pad, -2000, 8000)


REVERB = {   # зона: (ReverbEffect, громкость, exterior volume, приоритет)
    "B1": ("RE_Sietch_Airlock", 0.45, 0.35, 2.0),
    "B2": ("RE_Sietch_Gallery", 0.5, 0.15, 1.0),
    "B3": ("RE_Sietch_Narrow", 0.4, 0.1, 1.5),
    "B4": ("RE_Sietch_Cistern", 0.7, 0.1, 2.0),
    "B5": ("RE_Sietch_Hall", 0.8, 0.05, 1.0),
}


_cls_cache: dict = {}


def rakis_class_cached(name):
    if name not in _cls_cache:
        _cls_cache[name] = rakis_class(name)
    return _cls_cache[name]


def place_audio():
    for zid, _e, _w, _m, _i, _l, _u, boxes in L.ZONES:
        if zid not in REVERB:
            continue
        re_name, vol, ext, prio = REVERB[zid]
        effect = LC.try_load(f"/Game/Rakis/Audio/Reverb/{re_name}", f"/Game/Rakis/Audio/{re_name}")
        for i, (x0, x1, y0, y1, z0, z1) in enumerate(boxes):
            av = spawn(unreal.AudioVolume, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), label=f"Audio_{zid}_{i}",
                       tags=[GEN], folder=f"{FOLDER}/Audio")
            if not av:
                continue
            av.set_actor_scale3d(unreal.Vector((x1 - x0) / 200.0, (y1 - y0) / 200.0, (z1 - z0) / 200.0))
            set_prop(av, "priority", prio)
            try:
                # Реверберация — одна: при наличии ARakisZoneVolume её включает AudioDirector (ZoneVolume.Reverb),
                # AudioVolume даёт только фильтр «снаружи/внутри»; без C++ — реверберация здесь.
                rs = unreal.ReverbSettings()
                use_here = rakis_class_cached("RakisZoneVolume") is None
                rs.set_editor_property("apply_reverb", bool(use_here and effect))
                if effect and use_here:
                    rs.set_editor_property("reverb_effect", effect)
                rs.set_editor_property("volume", vol)
                rs.set_editor_property("fade_time", 1.5)
                av.set_editor_property("settings", rs)
                ins = unreal.InteriorSettings()
                ins.set_editor_property("exterior_volume", ext)
                ins.set_editor_property("exterior_time", 1.0)
                ins.set_editor_property("exterior_lpf", 1800.0)
                ins.set_editor_property("interior_volume", 1.0)
                av.set_editor_property("ambient_zone_settings", ins)
            except Exception as e:  # noqa: BLE001
                warn(f"Audio_{zid}: reverb — {e}")
            if not effect:
                warn(f"Audio_{zid}: {re_name} не найден — audio-designer создаёт ReverbEffect в /Game/Rakis/Audio/Reverb/")


def main():
    with transaction("Rakis: markup"):
        LC.ensure_persistent_with_sublevels()
        LC.make_current(MAP_PERSISTENT)
        n = delete_generated(GEN)
        log(f"{GEN}: удалено {n}")
        _counts.clear()
        for fn in (place_player_and_story, place_worm, place_zones, place_cinematics, place_crowd,
                   place_smart_objects, place_glowglobes, place_pois, place_nav, place_audio):
            try:
                fn()
            except Exception as e:  # noqa: BLE001
                warn(f"{fn.__name__}: {e}")
        LC.save_all()
        for t in sorted(_counts):
            log(f"  {t}: {_counts[t]}")
        log("level_markup: готово")


if __name__ == "__main__":
    main()
