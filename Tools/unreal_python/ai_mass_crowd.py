"""
ai_mass_crowd.py — разметка фоновой Mass-массовки (силуэты) на балконах B2 и террасе B5 (T-015 S2, crowd.md §6).

Статус: ЭКСПЕРИМЕНТ / «клей». C++ модуля Rakis Mass не использует; массовка собирается штатными ассетами
MassGameplay в редакторе. Скрипт делает только то, что надёжно делается из Python:
  1. TargetPoint-маркеры Rakis.MassCrowd.Silhouette (+ .Gallery / .Hall) — точки силуэтов (yaw — к центру
     зала / к оси галереи), вне 2.5 м от точек толпы и Smart Objects, чтобы не стоять внутри живых горожан;
  2. если есть /Game/Rakis/AI/Mass/MEC_CrowdSilhouette (UMassEntityConfigAsset) — AMassSpawner на группу
     (Count = число точек, EntityTypes = MEC); генератор точек спавна (EQS по маркерам) настраивается вручную —
     см. docs/tech/crowd.md §6;
  3. по флагу CREATE_CONFIG — пытается создать MEC_CrowdSilhouette с трейтом стационарной ISM-визуализации
     (best effort, при неудаче — предупреждение и ручные шаги).
Идемпотентно: свои акторы помечены gen:ai_mass_crowd и пересоздаются.
"""
from __future__ import annotations

import math

import unreal

from rakis_common import (MAP_PERSISTENT, actor_tags, all_actors, create_or_load, delete_generated, ensure_dir,
                          load_or_none, log, spawn, transaction, warn)
import level_common as LC
import level_layout as L

GEN = "gen:ai_mass_crowd"
FOLDER = "Rakis/Markup/MassCrowd"
MASS_DIR = "/Game/Rakis/AI/Mass"
MEC_PATH = f"{MASS_DIR}/MEC_CrowdSilhouette"
CREATE_CONFIG = True
KEEP_OUT = 250.0          # не ближе к живым точкам толпы/SO, см
CAPSULE_HALF = 90.0


def _occupied_points():
    pts = []
    for a in all_actors():
        tags = [str(t) for t in actor_tags(a)]
        if any(t in ("Rakis.CrowdSpawn", "Rakis.HallGather") or t.startswith("Rakis.SmartObject.") for t in tags):
            pts.append(a.get_actor_location())
    return pts


def _free(x, y, z, occupied):
    for p in occupied:
        if abs(p.z - z) < 400.0 and math.hypot(p.x - x, p.y - y) < KEEP_OUT:
            return False
    return True


def gallery_points():
    """Балконы B2 (−14 м) вдоль северной и южной стен, шаг 2.4 м; лицом к оси галереи."""
    g = L.B2
    out = []
    x = g["landing_x1"] + 200.0
    while x < g["x1"] - 200.0:
        out.append((x, g["y0"] + 110.0, g["balcony"], 90.0))
        out.append((x + 120.0, g["y1"] - 110.0, g["balcony"], 270.0))
        x += 240.0
    return out


def hall_points():
    """Терраса B5 (−42 м) по кольцу за внешним ярусом, без восточной стороны (помост)."""
    h = L.B5
    cx, cy = h["bowl_center"]
    r = L.b5_tier_half(h["tier_count"] - 1) + 110.0
    out = []
    n = 36
    for i in range(n):
        a = math.tau * i / n
        x, y = cx + r * math.cos(a), cy + r * math.sin(a)
        if x > cx + r * 0.55:          # восток — помост наиба
            continue
        if not (h["x0"] + 80.0 < x < h["x1"] - 80.0 and h["y0"] + 80.0 < y < h["y1"] - 80.0):
            continue
        out.append((x, y, h["terrace"], LC.yaw_to((x, y), (cx, cy))))
    return out


def _try_create_config():
    """Best effort: MEC с трейтом стационарной визуализации (имена классов MassGameplay 5.6 проверяются getattr)."""
    existing = load_or_none(MEC_PATH)
    if existing:
        return existing
    if not CREATE_CONFIG:
        return None
    ensure_dir(MASS_DIR)
    cfg_cls = getattr(unreal, "MassEntityConfigAsset", None)
    if cfg_cls is None:
        warn("unreal.MassEntityConfigAsset нет — включите плагины MassEntity/MassGameplay")
        return None
    factory = unreal.DataAssetFactory()
    try:
        factory.set_editor_property("data_asset_class", cfg_cls)
    except Exception as e:  # noqa: BLE001
        warn(f"DataAssetFactory.data_asset_class — {e}")
    asset = create_or_load(MEC_PATH, cfg_cls, factory)
    if asset is None:
        warn(f"{MEC_PATH}: не создан — создайте вручную (crowd.md §6)")
        return None
    trait_cls = getattr(unreal, "MassStationaryVisualizationTrait", None) or getattr(unreal, "MassVisualizationTrait", None)
    try:
        config = asset.get_editor_property("config")
        traits = list(config.get_editor_property("traits"))
        if trait_cls is not None and not any(isinstance(t, trait_cls) for t in traits):
            traits.append(unreal.new_object(trait_cls, outer=asset))
            config.set_editor_property("traits", traits)
            asset.set_editor_property("config", config)
        unreal.EditorAssetLibrary.save_loaded_asset(asset, only_if_is_dirty=False)
        log(f"{MEC_PATH}: создан (трейт {trait_cls.__name__ if trait_cls else '—'}); "
            "меш силуэта и LOD задаются вручную (crowd.md §6)")
    except Exception as e:  # noqa: BLE001
        warn(f"{MEC_PATH}: трейты из Python недоступны ({e}) — добавьте вручную (crowd.md §6)")
    return asset


def _place_spawner(label, location, count, config):
    spawner_cls = getattr(unreal, "MassSpawner", None)
    if spawner_cls is None or config is None:
        return None
    sp = spawn(spawner_cls, location, (0, 0, 0), label=label, tags=[GEN], folder=FOLDER)
    if sp is None:
        return None
    try:
        sp.set_editor_property("count", count)
        et = unreal.MassSpawnedEntityType()
        try:
            et.set_editor_property("entity_config", config)
        except Exception:  # noqa: BLE001 — в некоторых версиях поле — мягкая ссылка
            et.set_editor_property("entity_config", unreal.SoftObjectPath(config.get_path_name()))
        et.set_editor_property("proportion", 1.0)
        sp.set_editor_property("entity_types", [et])
        sp.set_editor_property("auto_spawn_on_begin_play", False)  # включить после настройки генератора
    except Exception as e:  # noqa: BLE001
        warn(f"{label}: свойства MassSpawner — {e} (настройте вручную)")
    return sp


def main():
    # карты — до транзакции (загрузка уровня сбрасывает буфер undo)
    LC.ensure_persistent_with_sublevels()
    LC.make_current(MAP_PERSISTENT)
    with transaction("Rakis: mass crowd markup"):
        n = delete_generated(GEN)
        log(f"{GEN}: удалено {n}")
        occupied = _occupied_points()
        groups = {"Gallery": gallery_points(), "Hall": hall_points()}
        placed = {}
        for group, pts in groups.items():
            k = 0
            for (x, y, z, yaw) in pts:
                if not _free(x, y, z, occupied):
                    continue
                LC.marker((x, y, z + CAPSULE_HALF), [GEN, "Rakis.MassCrowd.Silhouette", f"Rakis.MassCrowd.{group}"],
                          f"MassSil_{group}_{k:02d}", yaw, f"{FOLDER}/{group}")
                k += 1
            placed[group] = k
        config = _try_create_config()
        g, h = L.B2, L.B5
        centres = {"Gallery": ((g["x0"] + g["x1"]) / 2, L.SIETCH_AXIS_Y, g["balcony"] + 400.0),
                   "Hall": (h["bowl_center"][0], h["bowl_center"][1], h["terrace"] + 600.0)}
        for group, count in placed.items():
            if count and _place_spawner(f"MassSpawner_{group}", centres[group], count, config) is None:
                warn(f"MassSpawner_{group}: не поставлен (нет класса/MEC) — только маркеры")
        LC.save_all()
        log(f"ai_mass_crowd: маркеров {placed}; генератор точек и меш силуэта — вручную (crowd.md §6)")


if __name__ == "__main__":
    main()
