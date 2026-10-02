"""
light_setup.py — свет, атмосфера, туман, облака, пост и светошары «Rakis: Heretics».
Шаг 6 сборки демо (docs/06_demo_contract.md §2.7). Владелец — tech-artist.

L_Rakis_Persistent:
  * Directional Light «солнце» (тег Rakis.Sun): Atmosphere Sun Light, 0.53°, VSM, contact shadows;
    стартовые значения — пресет Dawn_Ridge из Content/Rakis/Data/WeatherPresets.csv.
  * Sky Atmosphere — «пыльный» Ракис: Rayleigh −15 %, Mie ×2.3 с поглощением в синем (охристый горизонт).
  * SkyLight (Rakis.SkyLight, real-time capture), Exponential Height Fog (+ volumetric fog),
    Volumetric Cloud (редкие высокие), Wind Directional Source.
  * PostProcessVolume unbound (Rakis.PP.Global): Lumen GI/отражения, auto exposure (histogram),
    тонмаппер, bloom, vignette 0.25, grain, blendables MI_PP_HeatHaze + MI_PP_ScreenDust.
  * Локальные PPV интерьера (Rakis.PP.Interior) и Local Fog Volume по зонам B* (ARakisZoneVolume).
L_Rakis_Sietch (или Persistent, если сиетч не отдельной картой):
  * Каждый актор с тегом Rakis.Glowglobe → Point Light 2700 K (800–1500 лм) + Light Function
    мерцания (MI_LF_GlowglobeFlicker_A/B/C) + эмиссивная сфера MI_Glowglobe.
  * «Божественный» луч B5: Spot Light вниз по шахте (тег Rakis.GodRay) с сильным volumetric scattering.
    Пыль в луче (NS_Dust_LightShaft) ставит fx_niagara.py — по тегу Rakis.GodRay.

Идемпотентность: всё созданное помечено gen:light_setup и удаляется перед повторной сборкой.
Чужие акторы с тегом Rakis.Glowglobe не удаляются — только настраиваются.
"""
from __future__ import annotations

import csv
import math
import os
import re

import unreal

from rakis_common import (DATA_SRC_DIR, MAP_PERSISTENT, MAP_SIETCH, actor_ss, actors_with_tag, all_actors,
                          delete_generated, eal, level_ss, load_or_none, log, open_or_create_level, rakis_class,
                          set_prop, spawn, transaction, warn)

GEN = "gen:light_setup"
FOLDER = "Lighting/Generated"

MI_PP_HEAT = "/Game/Rakis/Materials/Instances/MI_PP_HeatHaze"
MI_PP_DUST = "/Game/Rakis/Materials/Instances/MI_PP_ScreenDust"
MI_GLOW = "/Game/Rakis/Materials/Instances/MI_Glowglobe"
MI_LF = ["/Game/Rakis/Materials/Instances/MI_LF_GlowglobeFlicker_A",
         "/Game/Rakis/Materials/Instances/MI_LF_GlowglobeFlicker_B",
         "/Game/Rakis/Materials/Instances/MI_LF_GlowglobeFlicker_C"]
M_LF = "/Game/Rakis/Materials/Master/M_LF_GlowglobeFlicker"
CLOUD_MAT = "/Engine/EngineSky/VolumetricClouds/m_SimpleVolumetricCloud_Inst"

# Астрономия — те же константы, что в URakisWeatherSubsystem (LatitudeDeg, SolarDeclinationDeg, NorthYaw).
LATITUDE_DEG = 23.0
DECLINATION_DEG = 12.0
NORTH_YAW_DEG = 0.0  # +X — север, +Y — восток


# =====================================================================================
# Солнце
# =====================================================================================
def sun_direction(hours: float) -> tuple[float, float, float]:
    """Единичный вектор НА солнце в мировых координатах UE (+X север, +Y восток, +Z вверх)."""
    h = math.radians(15.0 * (hours - 12.0))
    phi = math.radians(LATITUDE_DEG)
    dec = math.radians(DECLINATION_DEG)
    east = -math.cos(dec) * math.sin(h)
    north = math.sin(dec) * math.cos(phi) - math.cos(dec) * math.cos(h) * math.sin(phi)
    up = math.sin(dec) * math.sin(phi) + math.cos(dec) * math.cos(h) * math.cos(phi)
    yaw = math.radians(NORTH_YAW_DEG)
    x = north * math.cos(yaw) - east * math.sin(yaw)
    y = north * math.sin(yaw) + east * math.cos(yaw)
    n = math.sqrt(x * x + y * y + up * up) or 1.0
    return x / n, y / n, up / n


def sun_rotation(hours: float) -> tuple[float, float, float]:
    """(roll, pitch, yaw) Directional Light: forward = −направление на солнце."""
    x, y, z = sun_direction(hours)
    fx, fy, fz = -x, -y, -z
    pitch = math.degrees(math.asin(max(-1.0, min(1.0, fz))))
    yaw = math.degrees(math.atan2(fy, fx))
    return 0.0, pitch, yaw


# =====================================================================================
# Пресеты из CSV (тот же файл, что импортирует data_import.py в DT_WeatherPresets)
# =====================================================================================
_COLOR_RE = re.compile(r"R=([-\d.]+),G=([-\d.]+),B=([-\d.]+)(?:,A=([-\d.]+))?")

DEFAULT_DAWN = {
    "TimeOfDayHours": 6.6667, "SunIntensityLux": 75000.0, "SunColor": (1.0, 0.86, 0.72),
    "SkyLightIntensity": 1.2, "FogDensity": 0.012, "FogHeightFalloff": 0.15,
    "FogInscatterColor": (0.55, 0.45, 0.42), "VolumetricFogScattering": 0.6, "DustDensity": 0.10,
    "WindSpeed": 3.5, "WindDirectionYaw": 55.0, "StormIntensity": 0.0, "HeatHaze": 0.1,
    "ExposureBias": 1.0, "CloudCoverage": 0.08,
}


def _parse(v: str):
    v = v.strip()
    m = _COLOR_RE.search(v)
    if m:
        return float(m.group(1)), float(m.group(2)), float(m.group(3))
    try:
        return float(v)
    except ValueError:
        return v


def read_presets() -> dict:
    path = os.path.join(DATA_SRC_DIR, "WeatherPresets.csv")
    out: dict = {}
    if not os.path.exists(path):
        warn(f"{path} не найден — встроенный Dawn_Ridge")
        return {"Dawn_Ridge": dict(DEFAULT_DAWN)}
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pid = row.pop("PresetID", None) or row.pop("---", None)
            if pid:
                out[pid] = {k: _parse(v) for k, v in row.items() if k}
    return out


# =====================================================================================
# Утилиты
# =====================================================================================
def _comp(actor, cls_name: str):
    cls = getattr(unreal, cls_name, None)
    if actor is None or cls is None:
        return None
    try:
        return actor.get_component_by_class(cls)
    except Exception:  # noqa: BLE001
        return None


def _set_first(obj, names, value) -> bool:
    for n in names:
        try:
            obj.set_editor_property(n, value)
            return True
        except Exception:  # noqa: BLE001
            continue
    warn(f"{obj.get_name() if obj else obj}: нет свойств {names}")
    return False


def _movable(actor) -> None:
    try:
        actor.root_component.set_mobility(unreal.ComponentMobility.MOVABLE)
    except Exception as ex:  # noqa: BLE001
        warn(f"mobility {actor.get_name()}: {ex}")


def _lc(rgb, a: float = 1.0) -> unreal.LinearColor:
    r, g, b = rgb
    return unreal.LinearColor(r, g, b, a)


def _fcolor(rgb) -> unreal.Color:
    r, g, b = (max(0, min(255, int(round(c * 255)))) for c in rgb)
    return unreal.Color(r=r, g=g, b=b, a=255)


def _set_light_color(comp, rgb) -> None:
    try:
        comp.set_light_color(_lc(rgb))
    except Exception:  # noqa: BLE001
        set_prop(comp, "light_color", _fcolor(rgb))


def _remove_untagged(cls_name: str) -> None:
    """Удаляет «шаблонные» акторы атмосферы без тегов (из new_level), чтобы не было двух солнц."""
    cls = getattr(unreal, cls_name, None)
    if cls is None:
        return
    for a in all_actors():
        if isinstance(a, cls) and not list(a.tags):
            log(f"Удаляю шаблонный {cls_name} без тегов: {a.get_actor_label()}")
            actor_ss.destroy_actor(a)


def _has_foreign(cls_name: str) -> bool:
    cls = getattr(unreal, cls_name, None)
    if cls is None:
        return False
    g = unreal.Name(GEN)
    return any(isinstance(a, cls) and g not in a.tags for a in all_actors())


# =====================================================================================
# Атмосфера и солнце (Persistent)
# =====================================================================================
def setup_sun(p: dict):
    rot = sun_rotation(float(p["TimeOfDayHours"]))
    a = spawn(unreal.DirectionalLight, (0, 0, 2000), rot, label="Rakis_Sun",
              tags=[GEN, "Rakis.Sun"], folder=FOLDER)
    if a is None:
        return None
    _movable(a)
    c = _comp(a, "DirectionalLightComponent")
    if c is None:
        return a
    try:
        c.set_intensity(float(p["SunIntensityLux"]))
    except Exception:  # noqa: BLE001
        set_prop(c, "intensity", float(p["SunIntensityLux"]))
    _set_light_color(c, p["SunColor"])
    set_prop(c, "use_temperature", False)
    set_prop(c, "atmosphere_sun_light", True)
    set_prop(c, "atmosphere_sun_light_index", 0)
    set_prop(c, "light_source_angle", 0.53)      # угловой диаметр Солнца
    set_prop(c, "light_source_soft_angle", 0.0)
    set_prop(c, "cast_shadows", True)
    set_prop(c, "cast_cloud_shadows", True)
    set_prop(c, "cloud_shadow_strength", 0.6)
    set_prop(c, "cast_shadows_on_clouds", True)
    set_prop(c, "per_pixel_atmosphere_transmittance", True)
    # VSM включён проектно (r.Shadow.Virtual.Enable=1); каскады — только фоллбек для не-VSM платформ.
    set_prop(c, "dynamic_shadow_distance_movable_light", 30000.0)
    set_prop(c, "dynamic_shadow_cascades", 4)
    set_prop(c, "cascade_distribution_exponent", 3.0)
    set_prop(c, "far_shadow_cascade_count", 0)
    # Контактные тени: мелкие детали (рябь, камешки, складки ткани) при скользящем солнце.
    set_prop(c, "contact_shadow_length", 0.04)
    set_prop(c, "contact_shadow_length_in_ws", False)
    set_prop(c, "shadow_source_angle_factor", 1.0)
    set_prop(c, "volumetric_scattering_intensity", 1.0)
    # god rays дают объёмный туман, не screen-space. UE 5.6: bEnableLightShaftOcclusion → enable_light_shaft_occlusion.
    _set_first(c, ["enable_light_shaft_occlusion", "light_shaft_occlusion"], False)
    return a


def setup_sky_atmosphere():
    a = spawn(unreal.SkyAtmosphere, (0, 0, 0), label="Rakis_SkyAtmosphere", tags=[GEN], folder=FOLDER)
    c = _comp(a, "SkyAtmosphereComponent")
    if c is None:
        return a
    # Земные значения UE: Rayleigh scale 0.0331, Mie scat 0.003996, Mie abs 0.000444, Mie exp 1.2 км.
    set_prop(c, "rayleigh_scattering_scale", 0.0281)                    # −15 %: небо чуть менее синее
    set_prop(c, "rayleigh_scattering", unreal.LinearColor(0.175287, 0.409607, 1.0, 1.0))
    set_prop(c, "rayleigh_exponential_distribution", 8.0)
    set_prop(c, "mie_scattering_scale", 0.0092)                         # ×2.3: пылевая дымка
    set_prop(c, "mie_scattering", unreal.LinearColor(1.0, 0.93, 0.82, 1.0))  # тёплое рассеяние
    set_prop(c, "mie_absorption_scale", 0.0014)
    set_prop(c, "mie_absorption", unreal.LinearColor(0.32, 0.50, 1.0, 1.0))  # пыль ест синий → охра у горизонта
    set_prop(c, "mie_anisotropy", 0.76)
    set_prop(c, "mie_exponential_distribution", 1.8)                    # пыль поднята выше, чем земной аэрозоль
    set_prop(c, "other_absorption_scale", 0.0006)                       # озон слабее → меньше «пурпура» в сумерках
    set_prop(c, "ground_albedo", unreal.Color(r=170, g=135, b=95, a=255))  # песок подсвечивает низ неба
    set_prop(c, "multi_scattering_factor", 1.0)
    # Имя свойства в C++ с опечаткой Epic: AerialPespectiveViewDistanceScale (UE 5.6).
    _set_first(c, ["aerial_pespective_view_distance_scale", "aerial_perspective_view_distance_scale"], 1.2)
    set_prop(c, "height_fog_contribution", 1.0)
    set_prop(c, "transmittance_min_light_elevation_angle", -90.0)
    return a


def setup_skylight(p: dict):
    a = spawn(unreal.SkyLight, (0, 0, 500), label="Rakis_SkyLight", tags=[GEN, "Rakis.SkyLight"], folder=FOLDER)
    _movable(a)
    c = _comp(a, "SkyLightComponent")
    if c is None:
        return a
    set_prop(c, "real_time_capture", True)
    st = getattr(unreal.SkyLightSourceType, "SLS_CAPTURED_SCENE", None)
    if st is not None:
        set_prop(c, "source_type", st)
    set_prop(c, "intensity", float(p["SkyLightIntensity"]))
    set_prop(c, "lower_hemisphere_is_black", False)
    set_prop(c, "lower_hemisphere_color", unreal.LinearColor(0.20, 0.15, 0.10, 1.0))
    set_prop(c, "cast_shadows", True)
    set_prop(c, "volumetric_scattering_intensity", 1.0)
    return a


def setup_height_fog(p: dict):
    a = spawn(unreal.ExponentialHeightFog, (0, 0, 0), label="Rakis_HeightFog", tags=[GEN], folder=FOLDER)
    c = _comp(a, "ExponentialHeightFogComponent")
    if c is None:
        return a
    set_prop(c, "fog_density", float(p["FogDensity"]))
    set_prop(c, "fog_height_falloff", float(p["FogHeightFalloff"]))
    _set_first(c, ["fog_inscattering_luminance", "fog_inscattering_color"], _lc(p["FogInscatterColor"]))
    set_prop(c, "fog_max_opacity", 1.0)
    set_prop(c, "start_distance", 0.0)
    _set_first(c, ["enable_volumetric_fog", "volumetric_fog"], True)  # UE 5.6: bEnableVolumetricFog
    set_prop(c, "volumetric_fog_scattering_distribution", float(p["VolumetricFogScattering"]))
    set_prop(c, "volumetric_fog_albedo", unreal.Color(r=235, g=215, b=185, a=255))
    set_prop(c, "volumetric_fog_extinction_scale", 1.0 + float(p["DustDensity"]) * 4.0)
    set_prop(c, "volumetric_fog_start_distance", 0.0)
    set_prop(c, "volumetric_fog_distance", 8000.0)
    set_prop(c, "volumetric_fog_static_lighting_scattering_intensity", 1.0)
    return a


def setup_clouds(p: dict):
    a = spawn(unreal.VolumetricCloud, (0, 0, 0), label="Rakis_VolumetricCloud", tags=[GEN], folder=FOLDER)
    c = _comp(a, "VolumetricCloudComponent")
    if c is None:
        return a
    set_prop(c, "layer_bottom_altitude", 7.0)   # км — высокие редкие облака (перистые/высокослоистые)
    set_prop(c, "layer_height", 3.0)
    set_prop(c, "tracing_start_max_distance", 350.0)
    set_prop(c, "tracing_max_distance", 50.0)
    mat = load_or_none(CLOUD_MAT)
    if mat is not None:
        set_prop(c, "material", mat)
    else:
        warn("Материал облаков движка не найден — назначьте вручную (docs/tech-art/lighting_weather.md)")
    return a


def setup_wind(p: dict):
    yaw = float(p["WindDirectionYaw"])
    a = spawn(unreal.WindDirectionalSource, (0, 0, 1000), (0, 0, yaw), label="Rakis_Wind", tags=[GEN],
              folder=FOLDER)
    c = _comp(a, "WindDirectionalSourceComponent")
    if c is None:
        return a
    ws = float(p["WindSpeed"])
    set_prop(c, "strength", min(1.0, ws / 14.0))
    set_prop(c, "speed", max(0.1, ws / 6.0))
    set_prop(c, "min_gust_amount", 0.1)
    set_prop(c, "max_gust_amount", 0.4)
    return a


def _pp(settings, name: str, value) -> None:
    """Ставит поле PostProcessSettings и его флаг override_<name> (если флаг существует)."""
    try:
        settings.set_editor_property(f"override_{name}", True)
    except Exception:  # noqa: BLE001
        pass
    try:
        settings.set_editor_property(name, value)
    except Exception as ex:  # noqa: BLE001
        warn(f"PostProcessSettings.{name}: {ex}")


def _enum(enum_name: str, *vals):
    e = getattr(unreal, enum_name, None)
    for v in vals:
        if e is not None and hasattr(e, v):
            return getattr(e, v)
    return None


def setup_global_pp(p: dict):
    a = spawn(unreal.PostProcessVolume, (0, 0, 0), label="Rakis_PP_Global",
              tags=[GEN, "Rakis.PP.Global"], folder=FOLDER)
    if a is None:
        return None
    set_prop(a, "unbound", True)
    set_prop(a, "priority", 0.0)
    set_prop(a, "blend_weight", 1.0)
    s = a.get_editor_property("settings")

    # --- Lumen
    gi = _enum("DynamicGlobalIlluminationMethod", "LUMEN")
    rf = _enum("ReflectionMethod", "LUMEN")
    if gi is not None:
        _pp(s, "dynamic_global_illumination_method", gi)
    if rf is not None:
        _pp(s, "reflection_method", rf)
    _pp(s, "lumen_scene_lighting_quality", 1.0)
    _pp(s, "lumen_scene_detail", 1.0)
    _pp(s, "lumen_scene_view_distance", 20000.0)
    _pp(s, "lumen_final_gather_quality", 1.0)       # 2.0 — для фоторежима/кинематики
    _pp(s, "lumen_final_gather_lighting_update_speed", 1.0)
    _pp(s, "lumen_reflection_quality", 1.0)
    _pp(s, "lumen_max_trace_distance", 20000.0)
    _pp(s, "lumen_skylight_leaking", 0.05)            # чуть-чуть, чтобы глубокие расщелины не были чёрными
    _pp(s, "lumen_full_skylight_leaking_distance", 1000.0)

    # --- экспозиция (EV100, при ExtendDefaultLuminanceRange=True)
    hist = _enum("AutoExposureMethod", "AEM_HISTOGRAM")
    if hist is not None:
        _pp(s, "auto_exposure_method", hist)
    _pp(s, "auto_exposure_bias", float(p["ExposureBias"]))
    _pp(s, "auto_exposure_min_brightness", 4.0)       # самый тёмный угол сиетча
    _pp(s, "auto_exposure_max_brightness", 15.5)      # полуденный песок
    _pp(s, "auto_exposure_speed_up", 3.0)             # из темноты на свет — быстро (зрачок)
    _pp(s, "auto_exposure_speed_down", 0.8)           # со света в темноту — медленно (темновая адаптация)
    _pp(s, "auto_exposure_low_percent", 60.0)
    _pp(s, "auto_exposure_high_percent", 95.0)
    _pp(s, "auto_exposure_apply_physical_camera_exposure", False)
    _pp(s, "local_exposure_highlight_contrast_scale", 0.8)
    _pp(s, "local_exposure_shadow_contrast_scale", 0.85)

    # --- тонмаппер (Filmic ACES-подобный), чуть мягче плечо для пересвеченного песка
    _pp(s, "film_slope", 0.88)
    _pp(s, "film_toe", 0.55)
    _pp(s, "film_shoulder", 0.30)
    _pp(s, "film_black_clip", 0.0)
    _pp(s, "film_white_clip", 0.04)
    _pp(s, "color_saturation", unreal.Vector4(1.0, 1.0, 1.0, 0.96))
    _pp(s, "color_contrast", unreal.Vector4(1.0, 1.0, 1.0, 1.03))
    _pp(s, "white_temp", 6500.0)

    # --- линза
    bm = _enum("BloomMethod", "BM_SOG")
    if bm is not None:
        _pp(s, "bloom_method", bm)
    _pp(s, "bloom_intensity", 0.35)
    _pp(s, "bloom_threshold", -1.0)
    _pp(s, "scene_fringe_intensity", 0.0)             # хроматическая аберрация — 0
    _pp(s, "vignette_intensity", 0.25)
    _pp(s, "film_grain_intensity", 0.08)
    _pp(s, "film_grain_intensity_highlights", 0.4)
    _pp(s, "lens_flare_intensity", 0.0)
    _pp(s, "motion_blur_amount", 0.35)
    _pp(s, "motion_blur_max", 3.0)

    # --- blendables
    blend = []
    for path in (MI_PP_HEAT, MI_PP_DUST):
        mi = load_or_none(path)
        if mi is None:
            warn(f"{path} не найден — запустите mat_post_process.py")
            continue
        blend.append(unreal.WeightedBlendable(weight=1.0, object=mi))
    try:
        s.set_editor_property("weighted_blendables", unreal.WeightedBlendables(array=blend))
    except Exception as ex:  # noqa: BLE001
        warn(f"weighted_blendables: {ex}")
    set_prop(a, "settings", s)
    return a


# =====================================================================================
# Зоны интерьера (ARakisZoneVolume, bInterior / B*)
# =====================================================================================
def interior_zones() -> list[dict]:
    cls = rakis_class("RakisZoneVolume")
    out = []
    for a in all_actors():
        is_zone = (cls is not None and isinstance(a, cls)) or "RakisZoneVolume" in a.get_class().get_name()
        if not is_zone:
            continue
        zone_name = ""
        try:
            z = a.get_editor_property("zone")
            zone_name = getattr(z, "name", str(z))
        except Exception:  # noqa: BLE001
            pass
        interior = False
        for prop in ("interior", "b_interior"):
            try:
                interior = bool(a.get_editor_property(prop))
                break
            except Exception:  # noqa: BLE001
                continue
        if not interior and not zone_name.upper().startswith("B"):
            continue
        origin, extent = a.get_actor_bounds(False)
        out.append({"zone": zone_name.upper(), "origin": (origin.x, origin.y, origin.z),
                    "extent": (extent.x, extent.y, extent.z), "label": a.get_actor_label()})
    return out


def setup_interior_pp(zones: list[dict]) -> int:
    """Локальные PPV сиетча: зажатый диапазон экспозиции EV100 5..9 (зал B5 — 5..8)."""
    n = 0
    for z in zones:
        ex = z["extent"]
        a = spawn(unreal.PostProcessVolume, z["origin"], scale=(ex[0] / 100.0, ex[1] / 100.0, ex[2] / 100.0),
                  label=f"Rakis_PP_Interior_{z['zone'] or n}", tags=[GEN, "Rakis.PP.Interior"], folder=FOLDER)
        if a is None:
            continue
        set_prop(a, "unbound", False)
        set_prop(a, "priority", 1.0)
        set_prop(a, "blend_radius", 400.0)
        s = a.get_editor_property("settings")
        hall = "B5" in z["zone"]
        _pp(s, "auto_exposure_min_brightness", 5.0)
        _pp(s, "auto_exposure_max_brightness", 8.0 if hall else 9.0)
        _pp(s, "bloom_intensity", 0.5)
        _pp(s, "vignette_intensity", 0.3)
        set_prop(a, "settings", s)
        n += 1
    return n


def setup_local_fog(zones: list[dict]) -> int:
    cls = getattr(unreal, "LocalFogVolume", None)
    if cls is None:
        warn("LocalFogVolume недоступен (UE < 5.3?) — дымку сиетча даёт только height fog")
        return 0
    n = 0
    for z in zones:
        ex = z["extent"]
        # Local Fog Volume — сфера радиусом 100 см при scale 1 (единичный объём движка).
        a = spawn(cls, z["origin"], scale=(ex[0] / 100.0, ex[1] / 100.0, ex[2] / 100.0),
                  label=f"Rakis_LocalFog_{z['zone'] or n}", tags=[GEN], folder=FOLDER)
        c = _comp(a, "LocalFogVolumeComponent")
        if c is None:
            continue
        hall = "B5" in z["zone"]
        cistern = "B4" in z["zone"]
        set_prop(c, "radial_fog_extinction", 0.25 if hall else 0.15)
        set_prop(c, "height_fog_extinction", 0.45 if (hall or cistern) else 0.3)
        set_prop(c, "height_fog_falloff", 600.0)
        set_prop(c, "height_fog_offset", 0.0)
        set_prop(c, "fog_phase_g", 0.5)
        set_prop(c, "fog_albedo", unreal.LinearColor(0.85, 0.72, 0.55, 1.0))   # тёплая пряная дымка
        set_prop(c, "fog_emissive", unreal.LinearColor(0.004, 0.0025, 0.001, 1.0))
        n += 1
    return n


# =====================================================================================
# Светошары и луч (Sietch)
# =====================================================================================
def _glow_lumens(i: int, loc) -> float:
    # 800..1500 лм, детерминированно по позиции (разные шары — разная яркость).
    h = math.sin(loc.x * 0.0123 + loc.y * 0.0457 + loc.z * 0.0789 + i) * 43758.5453
    return 800.0 + (h - math.floor(h)) * 700.0


def _configure_glow_light(c, lumens: float, lf) -> None:
    units = _enum("LightUnits", "LUMENS")
    if units is not None:
        set_prop(c, "intensity_units", units)
    set_prop(c, "intensity", lumens)
    set_prop(c, "use_temperature", True)
    set_prop(c, "temperature", 2700.0)
    set_prop(c, "light_color", unreal.Color(r=255, g=255, b=255, a=255))
    set_prop(c, "attenuation_radius", 1600.0)
    set_prop(c, "source_radius", 9.0)             # Ø светошара ~20–25 см
    set_prop(c, "soft_source_radius", 25.0)
    set_prop(c, "use_inverse_squared_falloff", True)
    set_prop(c, "ies_texture", None)
    set_prop(c, "cast_shadows", True)
    set_prop(c, "volumetric_scattering_intensity", 1.5)
    set_prop(c, "max_draw_distance", 6000.0)
    set_prop(c, "max_distance_fade_range", 1500.0)
    if lf is not None:
        set_prop(c, "light_function_material", lf)
        set_prop(c, "light_function_fade_distance", 4000.0)
        set_prop(c, "disabled_brightness", 1.0)


def _ensure_lf_materials() -> list:
    lfs = [load_or_none(p) for p in MI_LF]
    if not any(lfs):
        if load_or_none(M_LF) is None:
            try:
                import mat_master_materials as mm  # создаём M_LF_GlowglobeFlicker + инстансы
                lf = mm.build_lf_glowglobe()
                from mat_graph_lib import make_instance
                for path, seed in zip(MI_LF, (0.13, 0.51, 0.87)):
                    make_instance(path, lf, scalars={"PhaseSeed": seed})
            except Exception as ex:  # noqa: BLE001
                warn(f"M_LF_GlowglobeFlicker: {ex}")
        lfs = [load_or_none(p) for p in MI_LF]
        if not any(lfs):
            lfs = [load_or_none(M_LF)]
    return [x for x in lfs if x is not None]


def setup_glowglobes() -> int:
    globes = actors_with_tag("Rakis.Glowglobe")
    if not globes:
        warn("Нет акторов с тегом Rakis.Glowglobe — светошары не созданы")
        return 0
    lfs = _ensure_lf_materials()
    mi = load_or_none(MI_GLOW)
    sphere = load_or_none("/Engine/BasicShapes/Sphere.Sphere")
    gen = unreal.Name(GEN)
    n = 0
    for i, a in enumerate(globes):
        if gen in a.tags:
            continue
        loc = a.get_actor_location()
        lf = lfs[i % len(lfs)] if lfs else None
        lumens = _glow_lumens(i, loc)
        if isinstance(a, unreal.PointLight):
            c = _comp(a, "PointLightComponent")
            _movable(a)
        else:
            light = spawn(unreal.PointLight, (loc.x, loc.y, loc.z), label=f"GG_Light_{i:03d}",
                          tags=[GEN], folder=f"{FOLDER}/Glowglobes")
            if light is None:
                continue
            _movable(light)
            c = _comp(light, "PointLightComponent")
        if c is not None:
            _configure_glow_light(c, lumens, lf)

        # Эмиссивная сфера: если маркер — StaticMeshActor, красим его меш; иначе — Ø22 см сфера.
        if isinstance(a, unreal.StaticMeshActor):
            smc = a.static_mesh_component
            if mi is not None:
                smc.set_material(0, mi)
            set_prop(smc, "cast_shadow", False)
        elif sphere is not None:
            s = spawn(sphere, (loc.x, loc.y, loc.z), scale=(0.22, 0.22, 0.22), label=f"GG_Globe_{i:03d}",
                      tags=[GEN], folder=f"{FOLDER}/Glowglobes")
            if s is not None:
                smc = s.static_mesh_component
                if mi is not None:
                    smc.set_material(0, mi)
                set_prop(smc, "cast_shadow", False)          # не перекрывать собственный свет
                set_prop(smc, "affect_distance_field_lighting", False)
                try:
                    smc.set_collision_enabled(unreal.CollisionEnabled.NO_COLLISION)
                except Exception:  # noqa: BLE001
                    pass
        n += 1
    return n


def _hall_anchor():
    """Точка «дна» луча: маркер Rakis.LightShaft (если есть) или центр точек Rakis.HallGather."""
    shaft = actors_with_tag("Rakis.LightShaft")
    if shaft:
        l = shaft[0].get_actor_location()
        return (l.x, l.y, l.z), True
    pts = actors_with_tag("Rakis.HallGather")
    if not pts:
        return None, False
    xs = [p.get_actor_location() for p in pts]
    return (sum(v.x for v in xs) / len(xs), sum(v.y for v in xs) / len(xs), min(v.z for v in xs)), False


def setup_god_ray():
    anchor, is_top = _hall_anchor()
    if anchor is None:
        warn("B5: нет маркеров Rakis.LightShaft / Rakis.HallGather — луч не создан")
        return None
    x, y, z = anchor
    top_z = z if is_top else z + 2400.0  # зал 25 м: луч из свода
    a = spawn(unreal.SpotLight, (x, y, top_z), (0, -90, 0), label="Rakis_B5_GodRay",
              tags=[GEN, "Rakis.GodRay"], folder=FOLDER)
    if a is None:
        return None
    _movable(a)
    c = _comp(a, "SpotLightComponent")
    if c is None:
        return a
    units = _enum("LightUnits", "CANDELAS")
    if units is not None:
        set_prop(c, "intensity_units", units)
    # ~3000 лк в пятне на дне чаши при 24 м: I = E·d² ≈ 3000·576 ≈ 1.7e6 кд.
    set_prop(c, "intensity", 1.7e6)
    set_prop(c, "use_temperature", True)
    set_prop(c, "temperature", 4800.0)        # вечернее солнце через шахту
    set_prop(c, "inner_cone_angle", 4.0)
    set_prop(c, "outer_cone_angle", 9.0)
    set_prop(c, "attenuation_radius", 4000.0)
    set_prop(c, "source_radius", 60.0)        # раскрыв шахты ~1.2 м
    set_prop(c, "soft_source_radius", 0.0)
    set_prop(c, "cast_shadows", True)
    set_prop(c, "volumetric_scattering_intensity", 8.0)   # видимый столб в volumetric fog
    set_prop(c, "cast_volumetric_shadow", True)
    set_prop(c, "use_inverse_squared_falloff", True)
    return a


# =====================================================================================
def _process_persistent(preset: dict) -> list[dict]:
    open_or_create_level(MAP_PERSISTENT)
    removed = delete_generated(GEN)
    for cls in ("DirectionalLight", "SkyAtmosphere", "SkyLight", "ExponentialHeightFog", "VolumetricCloud"):
        _remove_untagged(cls)
        if _has_foreign(cls):
            warn(f"В Persistent уже есть чужой {cls} с тегами — проверьте дубли (солнце ищется по Rakis.Sun)")
    with transaction("Rakis: light setup (persistent)"):
        setup_sun(preset)
        setup_sky_atmosphere()
        setup_skylight(preset)
        setup_height_fog(preset)
        setup_clouds(preset)
        setup_wind(preset)
        setup_global_pp(preset)
        zones = interior_zones()
        npp = setup_interior_pp(zones)
        nfog = setup_local_fog(zones)
    level_ss.save_current_level()
    log(f"light_setup Persistent: удалено {removed}, зон интерьера {len(zones)}, PPV {npp}, fog {nfog}")
    return zones


def _process_sietch() -> None:
    if eal.does_asset_exist(MAP_SIETCH):
        level_ss.load_level(MAP_SIETCH)
        delete_generated(GEN)
    else:
        warn("L_Rakis_Sietch нет — светошары/луч ищутся в Persistent")
    with transaction("Rakis: light setup (sietch)"):
        n = setup_glowglobes()
        ray = setup_god_ray()
    level_ss.save_current_level()
    log(f"light_setup Sietch: светошаров {n}, луч B5: {'да' if ray else 'нет'}")


def main() -> None:
    presets = read_presets()
    dawn = presets.get("Dawn_Ridge") or DEFAULT_DAWN
    _process_persistent(dawn)
    _process_sietch()
    # Вернуться в Persistent — build_demo ожидает его открытым для следующих шагов.
    if eal.does_asset_exist(MAP_PERSISTENT):
        level_ss.load_level(MAP_PERSISTENT)


if __name__ == "__main__":
    main()
