"""
mat_post_process.py — пост-процесс материалы «Rakis: Heretics». Шаг 2 сборки (после mat_master_materials).

Создаёт:
  /Game/Rakis/Materials/PostProcess/M_PP_HeatHaze    — марево (HeatHaze.ush), до тонмаппера
  /Game/Rakis/Materials/PostProcess/M_PP_ScreenDust  — пыль/песок по краям кадра (буря, червь)
  /Game/Rakis/Materials/Instances/MI_PP_HeatHaze, MI_PP_ScreenDust — их кладёт light_setup.py
  в blendables глобального PostProcessVolume (тег Rakis.PP.Global).

Оба материала читают MPC_RakisWeather (HeatHaze, WormThreat01, StormIntensity, DustDensity,
WindDirection, Interior01) — интенсивность управляется погодой, а не инстансом; инстанс задаёт
только «характер» (масштабы, пороги, максимум).
"""
from __future__ import annotations

import unreal

from mat_graph_lib import (INSTANCE_DIR, PP_DIR, begin_material, enum_value, finish_material, lin, make_instance,
                           srgb)
from rakis_common import ensure_dir, log, save_dir, set_prop, warn


def _pp_setup(mat) -> None:
    # «До тонмаппера»: в 5.x значение называется BL_SceneColorBeforeDOF (раньше BL_BeforeTonemapping).
    loc = enum_value("BlendableLocation", "BL_SCENE_COLOR_BEFORE_DOF", "BL_BEFORE_TONEMAPPING")
    if loc is not None:
        set_prop(mat, "blendable_location", loc)
    set_prop(mat, "blendable_priority", 0)


def _scene_texture(g, scene_id: str, uv=None):
    sid = enum_value("SceneTextureId", scene_id)
    e = g.node("MaterialExpressionSceneTexture")
    if e is not None and sid is not None:
        set_prop(e, "scene_texture_id", sid)
    if e is not None and uv is not None:
        g.connect(uv, e, "UVs")
    return e


def build_heat_haze():
    mat, g = begin_material(f"{PP_DIR}/M_PP_HeatHaze", domain="pp")
    _pp_setup(mat)
    uv = g.texcoord(0)
    depth = g.node("MaterialExpressionSceneDepth")
    camrel = g.world_pos(camera_relative=True)  # в PP-домене — реконструкция из глубины
    t = g.time()

    p_int = g.scalar("Intensity", 1.0, "01 Strength", 0, 3)
    p_worm = g.scalar("WormThreatInfluence", 0.5, "01 Strength", 0, 2)
    p_start = g.scalar("StartDistanceCm", 1500.0, "02 Mask", 0, 20000)
    p_full = g.scalar("FullDistanceCm", 25000.0, "02 Mask", 1000, 200000)
    p_hfall = g.scalar("HeightFalloffCm", 900.0, "02 Mask", 50, 10000)
    p_camh = g.scalar("CameraHeightCm", 180.0, "02 Mask", 0, 2000)
    p_maxoff = g.scalar("MaxOffsetUV", 0.0025, "03 Noise", 0, 0.02)
    p_nscale = g.scalar("NoiseScale", 120.0, "03 Noise", 10, 400)
    p_rise = g.scalar("RiseSpeed", 0.12, "03 Noise", 0, 1)
    p_band = g.scalar("SkyHorizonBand", 0.04, "02 Mask", 0.001, 0.3)

    intensity = g.mul(g.mpc_param("HeatHaze"), p_int)
    threat = g.mul(g.mpc_param("WormThreat01"), p_worm)
    wind = g.mask(g.mpc_param("WindDirection"), r=True, g=True)
    interior = g.mpc_param("Interior01")
    params0 = g.append4(p_start, p_full, p_hfall, p_camh)
    params1 = g.append4(p_maxoff, p_nscale, p_rise, p_band)

    hz = g.custom(
        "return RakisHeatHazeUV(UV, Depth, CamRelPos, Time, Intensity, WormThreat, WindDir, Interior, P0, P1);",
        [("UV", uv), ("Depth", depth), ("CamRelPos", camrel), ("Time", t), ("Intensity", intensity),
         ("WormThreat", threat), ("WindDir", wind), ("Interior", interior), ("P0", params0), ("P1", params1)],
        "float2", ["HeatHaze.ush"], "Heat haze UV")
    scene = _scene_texture(g, "PPI_POST_PROCESS_INPUT0", hz)
    g.out(g.mask((scene, "Color"), r=True, g=True, b=True), "Emissive")
    finish_material(mat, g)
    return mat


def build_screen_dust():
    mat, g = begin_material(f"{PP_DIR}/M_PP_ScreenDust", domain="pp")
    _pp_setup(mat)
    uv = g.texcoord(0)
    vs = g.node("MaterialExpressionViewSize")
    t = g.time()
    scene = _scene_texture(g, "PPI_POST_PROCESS_INPUT0")

    c_tint = g.vector("DustTint", srgb("#C8A77A"), "01 Look", 0)
    p_veil = g.scalar("MaxVeil", 0.55, "01 Look", 0, 1)
    p_bright = g.scalar("VeilBrightness", 1.05, "01 Look", 0, 3)
    p_inner = g.scalar("VignetteInner", 0.35, "02 Shape", 0, 1)
    p_outer = g.scalar("VignetteOuter", 0.85, "02 Shape", 0.1, 1.5)
    p_grit = g.scalar("GritScale", 6.0, "03 Grit", 1, 64)
    p_speed = g.scalar("GritSpeed", 0.35, "03 Grit", 0, 4)
    p_specks = g.scalar("SpeckAmount", 0.35, "03 Grit", 0, 1)
    p_ws = g.scalar("StormWeight", 1.0, "04 Drivers", 0, 2)
    p_wt = g.scalar("WormThreatWeight", 0.8, "04 Drivers", 0, 2)
    p_wd = g.scalar("DustDensityWeight", 0.25, "04 Drivers", 0, 2)

    weights = g.append(g.append(p_ws, p_wt), p_wd)
    drivers = g.append(g.append(g.mpc_param("StormIntensity"), g.mpc_param("WormThreat01")),
                       g.mpc_param("DustDensity"))
    shape = g.append4(p_inner, p_outer, p_grit, p_speed)
    look = g.append4(p_veil, p_bright, p_specks, g.mpc_param("Interior01"))
    out = g.custom(
        "float Aspect = ViewSize.x / max(ViewSize.y, 1.0);\n"
        "float2 c = UV - 0.5; c.x *= Aspect;\n"
        "float vig = RakisLinearStep(Shape.x, Shape.y, length(c));\n"
        "float2 w = normalize(WindDir + float2(1e-4, 0.0));\n"
        "float2 p = UV * float2(Aspect, 1.0) * Shape.z + float2(w.y, -w.x) * Time * Shape.w;\n"
        "float grit = RakisFbm2(p, 3) * 0.5 + 0.5;\n"
        "float specks = step(0.85, RakisValueNoise2(p * 7.0 + Time * 2.5));\n"
        "float amt = saturate(dot(Drivers, Weights)) * (1.0 - saturate(Look.w));\n"
        "float m = saturate(vig * lerp(0.6, 1.3, grit) * amt) * Look.x;\n"
        "float lum = dot(Scene, float3(0.2126, 0.7152, 0.0722));\n"
        "float3 veil = lum * Tint * Look.y;\n"
        "float3 col = lerp(Scene, veil, m);\n"
        "col *= 1.0 - specks * Look.z * amt * vig;\n"
        "return col;",
        [("UV", uv), ("ViewSize", vs), ("Time", t), ("Scene", g.mask((scene, "Color"), r=True, g=True, b=True)),
         ("Tint", c_tint), ("WindDir", g.mask(g.mpc_param("WindDirection"), r=True, g=True)),
         ("Drivers", drivers), ("Weights", weights), ("Shape", shape), ("Look", look)],
        "float3", ["RakisNoise.ush"], "Screen dust veil")
    g.out(out, "Emissive")
    finish_material(mat, g)
    return mat


def main() -> None:
    ensure_dir(PP_DIR)
    ensure_dir(INSTANCE_DIR)
    with unreal.ScopedEditorTransaction("Rakis: post process materials"):
        hh = sd = None
        try:
            hh = build_heat_haze()
        except Exception as ex:  # noqa: BLE001
            warn(f"M_PP_HeatHaze: {ex}")
        try:
            sd = build_screen_dust()
        except Exception as ex:  # noqa: BLE001
            warn(f"M_PP_ScreenDust: {ex}")
        make_instance(f"{INSTANCE_DIR}/MI_PP_HeatHaze", hh, scalars={"Intensity": 1.0, "MaxOffsetUV": 0.0025})
        make_instance(f"{INSTANCE_DIR}/MI_PP_ScreenDust", sd, scalars={"MaxVeil": 0.55},
                      vectors={"DustTint": lin(0.58, 0.40, 0.20)})
    save_dir("/Game/Rakis/Materials")
    log("mat_post_process: M_PP_HeatHaze, M_PP_ScreenDust, MI_PP_HeatHaze, MI_PP_ScreenDust")


if __name__ == "__main__":
    main()
