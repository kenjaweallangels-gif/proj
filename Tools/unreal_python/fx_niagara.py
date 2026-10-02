"""
fx_niagara.py — Niagara-системы «Rakis: Heretics» и расстановка постоянных эффектов. Задача T-009.
Шаг 7 сборки демо (docs/06_demo_contract.md §2.7), после light_setup.py.

ЧЕСТНО О ГРАНИЦАХ PYTHON-API NIAGARA (UE 5.6):
  * Создать систему можно (NiagaraSystemFactoryNew) или скопировать шаблон (duplicate_asset).
  * Редактировать стек эмиттера (модули Spawn Rate, Curl Noise, Collision, рендер) из Python НЕЛЬЗЯ —
    нет публичного скриптового API графа Niagara. Поэтому скрипт:
      1) создаёт ассет NS_* по контракту (§2.5), если его ещё нет — копией ближайшего шаблона
         из /Niagara/DefaultAssets/Templates (поиск по ключевым словам), иначе пустой системой;
      2) НИКОГДА не перезаписывает существующую систему (ручная доводка в редакторе сохраняется);
      3) пытается добавить User-параметры (User.WindDirection, User.WindSpeed, User.Intensity) через
         доступные в сборке API; если API нет — пишет в лог, что их добавить вручную;
      4) создаёт NPC_RakisWeather (Niagara Parameter Collection), зеркалящую MPC_RakisWeather;
      5) расставляет постоянные эффекты в картах (тег gen:fx_niagara) и задаёт им User-оверрайды.
  * Точный рецепт каждой системы (стек эмиттеров, числа, бюджеты) — docs/tech-art/fx.md.

Маркеры расстановки (ставит level-designer; если их нет — координаты из контракта/layout.md):
  Rakis.FX.SandDrift, Rakis.FX.DustDevil, Rakis.FX.StormWall, Rakis.FX.SpiceHaze, Rakis.FX.Motes
  + Rakis.GodRay (spot-луч B5 из light_setup.py), Rakis.Glowglobe, зоны ARakisZoneVolume B3.
Все расставленные акторы также получают тег Rakis.FX.Wind — по нему рантайм (WeatherSubsystem)
может обновлять User.WindDirection/User.WindSpeed (см. handoff T-009).
"""
from __future__ import annotations

import math

import unreal

from rakis_common import (GAME_ROOT, MAP_DESERT, MAP_PERSISTENT, MAP_SIETCH, actors_with_tag, delete_generated,
                          eal, ensure_dir, level_ss, load_or_none, log, set_prop, spawn, transaction, warn)

GEN = "gen:fx_niagara"
FX_DIR = f"{GAME_ROOT}/FX"
EMITTER_DIR = f"{FX_DIR}/Emitters"
NPC_PATH = f"{FX_DIR}/NPC_RakisWeather"
MPC_PATH = "/Game/Rakis/Materials/Functions/MPC_RakisWeather"
TEMPLATE_ROOTS = ["/Niagara/DefaultAssets/Templates", "/Niagara/DefaultAssets"]
FOLDER = "FX/Generated"

USER_PARAMS = [("WindDirection", "vec3", (0.5736, 0.8192, 0.0)),
               ("WindSpeed", "float", 6.0),
               ("Intensity", "float", 1.0)]

# Имя → ключевые слова шаблонов в порядке предпочтения (подстроки имени ассета шаблона).
SYSTEMS: dict[str, list[str]] = {
    "NS_Sand_Drift": ["BlowingParticles", "HangingParticulates", "Fountain"],
    "NS_Sand_DustDevil": ["Vortex", "BlowingParticles", "Fountain"],
    "NS_Sandstorm_Wall": ["HangingParticulates", "BlowingParticles"],
    "NS_Worm_SandWave": ["DirectionalBurst", "Fountain"],
    "NS_Worm_RingSandfall": ["Fountain", "DirectionalBurst"],
    "NS_Worm_Breach": ["OmnidirectionalBurst", "DirectionalBurst", "SimpleSpriteBurst"],
    "NS_Footstep_Sand": ["DirectionalBurst", "SimpleSpriteBurst"],
    "NS_Thumper_Pulse": ["OmnidirectionalBurst", "SimpleSpriteBurst"],
    "NS_Dust_LightShaft": ["HangingParticulates"],
    "NS_Spice_Haze": ["HangingParticulates"],
    "NS_Glowglobe_Motes": ["HangingParticulates"],
    "NS_SealDoor_Steam": ["Fountain", "DirectionalBurst"],
    "NS_Rock_Hop": ["UpwardMeshBurst", "DirectionalBurst"],
}

# Желаемые настройки системы (fixed bounds, warmup) — то, что реально выставляется через свойства.
SYSTEM_PROPS: dict[str, dict] = {
    "NS_Sand_Drift": {"warmup_time": 3.0, "fixed_bounds_cm": 3000.0},
    "NS_Sandstorm_Wall": {"warmup_time": 10.0, "fixed_bounds_cm": 200000.0},
    "NS_Sand_DustDevil": {"warmup_time": 4.0, "fixed_bounds_cm": 3000.0},
    "NS_Dust_LightShaft": {"warmup_time": 8.0, "fixed_bounds_cm": 1500.0},
    "NS_Spice_Haze": {"warmup_time": 8.0, "fixed_bounds_cm": 1500.0},
    "NS_Glowglobe_Motes": {"warmup_time": 4.0, "fixed_bounds_cm": 300.0},
}


# =====================================================================================
# Ассеты систем
# =====================================================================================
def _asset_class_name(ad) -> str:
    for attr in ("asset_class_path", "asset_class"):
        try:
            v = getattr(ad, attr)
            return str(getattr(v, "asset_name", v))
        except Exception:  # noqa: BLE001
            continue
    return ""


def list_templates() -> dict:
    """{'systems': {name: path}, 'emitters': {name: path}} из контента плагина Niagara."""
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    out = {"systems": {}, "emitters": {}}
    for root in TEMPLATE_ROOTS:
        try:
            assets = reg.get_assets_by_path(root, recursive=True)
        except Exception:  # noqa: BLE001
            continue
        for ad in assets:
            cls = _asset_class_name(ad)
            name = str(ad.asset_name)
            path = str(ad.package_name)
            if cls == "NiagaraSystem":
                out["systems"].setdefault(name, path)
            elif cls == "NiagaraEmitter":
                out["emitters"].setdefault(name, path)
    log(f"Шаблоны Niagara: систем {len(out['systems'])}, эмиттеров {len(out['emitters'])}")
    return out


def _pick(names: dict, keywords: list[str]) -> str | None:
    for kw in keywords:
        for n, p in names.items():
            if kw.lower() in n.lower():
                return p
    return None


def _try_add_user_params(system) -> bool:
    """Пытается добавить User.* через известные (в разных версиях) скриптовые API. Иначе — False."""
    candidates = [
        ("NiagaraSystemEditorLibrary", "add_user_parameter"),
        ("NiagaraEditorScriptingLibrary", "add_user_parameter"),
        ("NiagaraSystemScriptingLibrary", "add_user_parameter"),
    ]
    for lib_name, fn_name in candidates:
        lib = getattr(unreal, lib_name, None)
        fn = getattr(lib, fn_name, None) if lib else None
        if fn is None:
            continue
        ok = True
        for name, typ, default in USER_PARAMS:
            try:
                fn(system, f"User.{name}", typ, default)
            except Exception as ex:  # noqa: BLE001
                warn(f"{system.get_name()}: {lib_name}.{fn_name}({name}): {ex}")
                ok = False
        return ok
    return False


def _apply_system_props(system, name: str) -> None:
    props = SYSTEM_PROPS.get(name)
    if not props:
        return
    if "warmup_time" in props:
        set_prop(system, "warmup_time", props["warmup_time"])
    if "fixed_bounds_cm" in props:
        r = props["fixed_bounds_cm"]
        try:
            box = unreal.Box(min=unreal.Vector(-r, -r, -r * 0.25), max=unreal.Vector(r, r, r * 0.75), is_valid=True)
            if set_prop(system, "fixed_bounds", box):
                set_prop(system, "fixed_bounds_enabled", True)  # имя флага зависит от версии — не критично
        except Exception as ex:  # noqa: BLE001
            warn(f"{name}: fixed bounds: {ex}")


def ensure_system(name: str, templates: dict) -> tuple[object | None, str]:
    """Возвращает (system, как_получена)."""
    path = f"{FX_DIR}/{name}"
    existing = load_or_none(path)
    if existing is not None:
        return existing, "existing"
    keywords = SYSTEMS[name]

    src = _pick(templates["systems"], keywords)
    if src:
        try:
            dup = eal.duplicate_asset(src, path)
            if dup is not None:
                return dup, f"copy:{src}"
        except Exception as ex:  # noqa: BLE001
            warn(f"{name}: копия {src}: {ex}")

    # Пустая система + копия эмиттера-шаблона рядом (добавить вручную: + Emitter → From asset).
    fac_cls = getattr(unreal, "NiagaraSystemFactoryNew", None)
    sys_cls = getattr(unreal, "NiagaraSystem", None)
    if fac_cls is None or sys_cls is None:
        warn("Плагин Niagara недоступен в Python — системы не созданы")
        return None, "none"
    how = "empty"
    em_src = _pick(templates["emitters"], keywords)
    if em_src:
        ensure_dir(EMITTER_DIR)
        em_path = f"{EMITTER_DIR}/NE_{name[3:]}"
        if not eal.does_asset_exist(em_path):
            try:
                eal.duplicate_asset(em_src, em_path)
                how = f"empty+emitter:{em_path}"
            except Exception as ex:  # noqa: BLE001
                warn(f"{name}: копия эмиттера {em_src}: {ex}")
    pkg, short = path.rsplit("/", 1)
    try:
        sys_asset = unreal.AssetToolsHelpers.get_asset_tools().create_asset(short, pkg, sys_cls, fac_cls())
    except Exception as ex:  # noqa: BLE001
        warn(f"{name}: create_asset: {ex}")
        sys_asset = None
    return sys_asset, how


def ensure_npc() -> None:
    """NPC_RakisWeather — Niagara Parameter Collection с Source Material Collection = MPC_RakisWeather."""
    if load_or_none(NPC_PATH) is not None:
        return
    fac_cls = getattr(unreal, "NiagaraParameterCollectionFactoryNew", None)
    npc_cls = getattr(unreal, "NiagaraParameterCollection", None)
    mpc = load_or_none(MPC_PATH)
    if fac_cls is None or npc_cls is None:
        warn("NiagaraParameterCollectionFactoryNew недоступен — NPC_RakisWeather создать вручную (fx.md)")
        return
    try:
        pkg, short = NPC_PATH.rsplit("/", 1)
        npc = unreal.AssetToolsHelpers.get_asset_tools().create_asset(short, pkg, npc_cls, fac_cls())
        if npc is not None and mpc is not None:
            set_prop(npc, "source_material_collection", mpc)
            eal.save_loaded_asset(npc, only_if_is_dirty=False)
    except Exception as ex:  # noqa: BLE001
        warn(f"NPC_RakisWeather: {ex}")


def build_systems() -> dict:
    ensure_dir(FX_DIR)
    templates = list_templates()
    report = {}
    manual_params = []
    for name in SYSTEMS:
        system, how = ensure_system(name, templates)
        report[name] = how
        if system is None:
            continue
        if how != "existing":
            _apply_system_props(system, name)
            if not _try_add_user_params(system):
                manual_params.append(name)
            try:
                eal.save_loaded_asset(system, only_if_is_dirty=False)
            except Exception as ex:  # noqa: BLE001
                warn(f"save {name}: {ex}")
    for n, how in report.items():
        log(f"  {n}: {how}")
    if manual_params:
        warn("User-параметры (User.WindDirection/WindSpeed/Intensity) добавить вручную в: " + ", ".join(manual_params))
    ensure_npc()
    return report


# =====================================================================================
# Расстановка
# =====================================================================================
def _editor_world():
    try:
        return unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    except Exception:  # noqa: BLE001
        return None


def ground_z(x: float, y: float, default: float = 0.0) -> float:
    """Высота поверхности под точкой (трасса сверху вниз). Без коллизии — default."""
    world = _editor_world()
    if world is None:
        return default
    try:
        hit = unreal.SystemLibrary.line_trace_single(
            world, unreal.Vector(x, y, 500000.0), unreal.Vector(x, y, -500000.0),
            unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, False, [], unreal.DrawDebugTrace.NONE, True)
        if hit is None:
            return default
        parts = unreal.GameplayStatics.break_hit_result(hit)
        # (blocking_hit, initial_overlap, time, distance, location, impact_point, ...)
        if parts and parts[0]:
            return float(parts[5].z)
    except Exception:  # noqa: BLE001
        pass
    return default


def place(name: str, loc, yaw: float = 0.0, scale: float = 1.0, label: str | None = None,
          wind=(0.5736, 0.8192, 0.0), wind_speed: float = 6.0, intensity: float = 1.0):
    system = load_or_none(f"{FX_DIR}/{name}")
    if system is None:
        warn(f"{name} отсутствует — не размещён")
        return None
    a = spawn(system, loc, (0, 0, yaw), (scale, scale, scale), label=label or name,
              tags=[GEN, "Rakis.FX.Wind"], folder=FOLDER)
    if a is None:
        return None
    comp = None
    try:
        comp = a.get_component_by_class(unreal.NiagaraComponent)
    except Exception:  # noqa: BLE001
        pass
    if comp is not None:
        set_prop(comp, "auto_activate", True)
        for fn, args in (("set_variable_vec3", ("WindDirection", unreal.Vector(*wind))),
                         ("set_variable_float", ("WindSpeed", float(wind_speed))),
                         ("set_variable_float", ("Intensity", float(intensity)))):
            f = getattr(comp, fn, None)
            if f is None:
                continue
            try:
                f(*args)
            except Exception as ex:  # noqa: BLE001
                warn(f"{name}.{args[0]}: {ex}")
    return a


def _wind_from_yaw(yaw_deg: float):
    r = math.radians(yaw_deg)
    return (math.cos(r), math.sin(r), 0.0)


def _markers(tag: str) -> list:
    return [(a.get_actor_location(), a.get_actor_rotation().yaw) for a in actors_with_tag(tag)]


def place_desert(preset_wind_yaw: float = 50.0, wind_speed: float = 6.0) -> int:
    wind = _wind_from_yaw(preset_wind_yaw)
    n = 0
    # --- позёмка вдоль гребней
    drift = _markers("Rakis.FX.SandDrift")
    if not drift:
        # Фоллбек: эрг A2 (70000, 20000) — 3 гребня поперёк ветра × 3 точки вдоль гребня; + 2 у старта A1.
        cx, cy = 70000.0, 20000.0
        wx, wy = wind[0], wind[1]
        ax, ay = -wy, wx  # вдоль гребня (перпендикулярно ветру)
        pts = []
        for row in (-1, 0, 1):
            for col in (-1, 0, 1):
                pts.append((cx + wx * row * 14000 + ax * col * 16000, cy + wy * row * 14000 + ay * col * 16000))
        pts += [(8000.0, 6000.0), (-6000.0, 9000.0)]
        drift = [(unreal.Vector(x, y, ground_z(x, y)), math.degrees(math.atan2(ay, ax))) for x, y in pts]
    for i, (loc, yaw) in enumerate(drift):
        if place("NS_Sand_Drift", (loc.x, loc.y, loc.z + 20.0), yaw, label=f"FX_SandDrift_{i:02d}",
                 wind=wind, wind_speed=wind_speed):
            n += 1

    # --- пыльные вихри
    devils = _markers("Rakis.FX.DustDevil") or [
        (unreal.Vector(x, y, ground_z(x, y)), 0.0) for x, y in ((40000.0, 50000.0), (110000.0, -10000.0),
                                                                (190000.0, 20000.0))]
    for i, (loc, _yaw) in enumerate(devils):
        if place("NS_Sand_DustDevil", (loc.x, loc.y, loc.z), 0.0, label=f"FX_DustDevil_{i:02d}",
                 wind=wind, wind_speed=wind_speed, intensity=0.8):
            n += 1

    # --- стена бури на юго-западном горизонте (лицом к центру карты)
    walls = _markers("Rakis.FX.StormWall") or [(unreal.Vector(-250000.0, -300000.0, 0.0), None)]
    for i, (loc, yaw) in enumerate(walls):
        face = yaw if yaw is not None else math.degrees(math.atan2(-loc.y, -loc.x))
        if place("NS_Sandstorm_Wall", (loc.x, loc.y, loc.z), face, label=f"FX_StormWall_{i:02d}",
                 wind=wind, wind_speed=14.0, intensity=1.0):
            n += 1
    return n


def place_sietch(zones: list[dict]) -> int:
    n = 0
    # --- пыль в луче B5 (по spot-лучу light_setup)
    rays = actors_with_tag("Rakis.GodRay")
    for i, r in enumerate(rays):
        l = r.get_actor_location()
        if place("NS_Dust_LightShaft", (l.x, l.y, l.z - 1200.0), 0.0, label=f"FX_LightShaftDust_{i}",
                 wind=(0.0, 0.0, 0.0), wind_speed=0.3, intensity=1.0):
            n += 1
    if not rays:
        warn("Нет Rakis.GodRay (light_setup.py) — NS_Dust_LightShaft не размещён")

    # --- дымка пряности B3 (маркеры или сетка по объёму зоны B3; немного — в рынке B2)
    haze = _markers("Rakis.FX.SpiceHaze")
    if not haze:
        for z in zones:
            if not (z["zone"].startswith("B3") or z["zone"].startswith("B2")):
                continue
            ox, oy, oz = z["origin"]
            ex, ey, ez = z["extent"]
            per = 3 if z["zone"].startswith("B3") else 2
            for k in range(per):
                t = (k + 0.5) / per - 0.5
                long_x = ex >= ey
                x = ox + (t * 2 * ex * 0.8 if long_x else 0.0)
                y = oy + (0.0 if long_x else t * 2 * ey * 0.8)
                haze.append((unreal.Vector(x, y, oz - ez + 120.0), 0.0))
    for i, (loc, _yaw) in enumerate(haze):
        if place("NS_Spice_Haze", (loc.x, loc.y, loc.z), 0.0, label=f"FX_SpiceHaze_{i:02d}",
                 wind=(0.3, 0.0, 0.05), wind_speed=0.2, intensity=0.8):
            n += 1

    # --- пылинки у светошаров (не больше 40 систем)
    motes = _markers("Rakis.FX.Motes")
    if not motes:
        motes = [(a.get_actor_location(), 0.0) for a in actors_with_tag("Rakis.Glowglobe")
                 if unreal.Name("gen:light_setup") not in a.tags]
    for i, (loc, _yaw) in enumerate(motes[:40]):
        if place("NS_Glowglobe_Motes", (loc.x, loc.y, loc.z - 30.0), 0.0, label=f"FX_Motes_{i:03d}",
                 wind=(0.0, 0.0, 0.1), wind_speed=0.1, intensity=0.6):
            n += 1
    return n


def _zones_from_persistent() -> list[dict]:
    try:
        import light_setup
        return light_setup.interior_zones()
    except Exception as ex:  # noqa: BLE001
        warn(f"Зоны интерьера: {ex}")
        return []


def _wind_preset() -> tuple[float, float]:
    try:
        import light_setup
        p = light_setup.read_presets().get("Morning_Erg") or {}
        return float(p.get("WindDirectionYaw", 50.0)), float(p.get("WindSpeed", 6.0))
    except Exception:  # noqa: BLE001
        return 50.0, 6.0


def place_all() -> None:
    zones: list[dict] = []
    if eal.does_asset_exist(MAP_PERSISTENT):
        level_ss.load_level(MAP_PERSISTENT)
        delete_generated(GEN)
        zones = _zones_from_persistent()
        level_ss.save_current_level()
    yaw, speed = _wind_preset()

    if eal.does_asset_exist(MAP_DESERT):
        level_ss.load_level(MAP_DESERT)
        delete_generated(GEN)
    else:
        warn("L_Rakis_Desert нет — пустынные FX ставлю в текущую карту")
    with transaction("Rakis: FX desert"):
        nd = place_desert(yaw, speed)
    level_ss.save_current_level()

    if eal.does_asset_exist(MAP_SIETCH):
        level_ss.load_level(MAP_SIETCH)
        delete_generated(GEN)
    else:
        warn("L_Rakis_Sietch нет — FX сиетча ставлю в текущую карту")
    with transaction("Rakis: FX sietch"):
        ns = place_sietch(zones)
    level_ss.save_current_level()
    log(f"fx_niagara: размещено в пустыне {nd}, в сиетче {ns}")

    if eal.does_asset_exist(MAP_PERSISTENT):
        level_ss.load_level(MAP_PERSISTENT)


def main() -> None:
    build_systems()
    eal.save_directory(FX_DIR, only_if_is_dirty=True, recursive=True)
    place_all()


if __name__ == "__main__":
    main()
