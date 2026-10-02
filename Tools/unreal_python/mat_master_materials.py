"""
mat_master_materials.py — MPC_RakisWeather, мастер-материалы и инстансы «Rakis: Heretics».
Шаг 2 сборки демо (docs/06_demo_contract.md §2.7). Задача T-008.

Создаёт (пути по контракту §2.5):
  /Game/Rakis/Materials/Functions/MPC_RakisWeather
  /Game/Rakis/Materials/Master/   M_Landscape_Sand, M_Rock_Master, M_Sietch_Stone, M_Cloth_Worn,
                                  M_Worm_Chitin, M_Worm_Teeth, M_Glowglobe, M_Water_Still,
                                  M_Decal_Carving, M_Decal_Paint, M_Spice_Fabric,
                                  + служебные M_Blockout, M_LF_GlowglobeFlicker, M_FX_Dust
  /Game/Rakis/Materials/Instances/ MI_* (см. INSTANCES ниже)

Идемпотентность:
  * MPC: существующие параметры сохраняют свои GUID (иначе отвалятся ссылки в материалах/C++);
    лишние параметры удаляются, недостающие добавляются, дефолты перезаписываются.
  * Материалы: граф полностью пересобирается в том же ассете (ссылки инстансов и мешей живы).
  * Инстансы: родитель и все параметры перезаписываются.

Custom-ноды подключают HLSL из Source/Rakis/Shaders через виртуальный путь /Project/Rakis
(регистрирует FRakisModule на PostConfigInit). Если модуль не собран — материалы с Custom-нодами
не скомпилируются (будет WorldGridMaterial), M_Blockout и MI_Blockout_* работают всегда.

Запуск: Tools → Execute Python Script, либо build_demo.py (вызывает main()).
"""
from __future__ import annotations

import unreal

from mat_graph_lib import (ENGINE_TEX, FUNCTIONS_DIR, INSTANCE_DIR, MASTER_DIR, MPC_PATH, MEL, Graph,
                           begin_material, enum_value, find_texture, finish_material, lin, make_instance,
                           set_first, set_usage, srgb)
from rakis_common import create_or_load, eal, ensure_dir, load_or_none, log, save_dir, set_prop, warn

# =====================================================================================
# MPC_RakisWeather — ровно параметры контракта §2.5. Пишет URakisWeatherSubsystem (и червь — WormThreat01).
# Соглашения (совпадают с RakisWeatherSubsystem.h):
#   WindDirection — единичный вектор КУДА дует ветер (XY, Z=0);   WindSpeed — м/с
#   SunDirection  — единичный вектор НА солнце (мировые координаты, +X север, +Y восток)
#   SandTint      — множитель цвета песка (рассвет — розоватый, буря — желтее), A не используется
#   PlayerPosition— мировая позиция игрока, см (следы/RVT-деформация рядом с игроком)
# =====================================================================================
MPC_SCALARS = [
    ("WindSpeed", 3.5),
    ("StormIntensity", 0.0),
    ("DustDensity", 0.10),
    ("HeatHaze", 0.10),
    ("TimeOfDay01", 6.6667 / 24.0),
    ("WormThreat01", 0.0),
    ("Interior01", 0.0),
]


def _dawn_sun_dir() -> unreal.LinearColor:
    try:
        from light_setup import sun_direction  # единая формула солнца
        x, y, z = sun_direction(6.6667)
        return lin(x, y, z, 0.0)
    except Exception:  # noqa: BLE001
        return lin(0.125, 0.963, 0.2375, 0.0)


def mpc_vectors() -> list:
    return [
        ("WindDirection", lin(0.5736, 0.8192, 0.0, 0.0)),  # yaw 55° — с юго-запада на северо-восток
        ("SunDirection", _dawn_sun_dir()),
        ("SandTint", lin(1.0, 0.97, 0.95, 1.0)),
        ("PlayerPosition", lin(0.0, 0.0, 0.0, 0.0)),
    ]


def build_mpc() -> unreal.MaterialParameterCollection | None:
    ensure_dir(FUNCTIONS_DIR)
    factory_cls = getattr(unreal, "MaterialParameterCollectionFactoryNew", None)
    if factory_cls is None:
        warn("MaterialParameterCollectionFactoryNew недоступен — MPC создать нельзя")
        return None
    mpc = create_or_load(MPC_PATH, unreal.MaterialParameterCollection, factory_cls())
    if mpc is None:
        warn("MPC_RakisWeather не создан")
        return None

    def merge(prop: str, struct_cls, wanted: list):
        try:
            existing = {str(p.get_editor_property("parameter_name")): p for p in mpc.get_editor_property(prop)}
        except Exception as ex:  # noqa: BLE001
            warn(f"MPC.{prop}: {ex}")
            existing = {}
        out = []
        for name, default in wanted:
            p = existing.get(name)
            if p is None:
                p = struct_cls()  # конструктор FCollectionParameterBase генерирует новый GUID
            p.set_editor_property("parameter_name", name)
            p.set_editor_property("default_value", default)
            out.append(p)
        extra = sorted(set(existing) - {n for n, _ in wanted})
        if extra:
            warn(f"MPC: удаляю параметры вне контракта: {extra}")
        set_prop(mpc, prop, out)

    merge("scalar_parameters", unreal.CollectionScalarParameter, MPC_SCALARS)
    merge("vector_parameters", unreal.CollectionVectorParameter, mpc_vectors())
    eal.save_loaded_asset(mpc, only_if_is_dirty=False)
    log("MPC_RakisWeather: 7 скаляров, 4 вектора")
    return mpc


# =====================================================================================
# Общие куски графов
# =====================================================================================
def _orm_switch(g: Graph, orm, channel: str, fallback, param: str = "UseTextures"):
    return g.switch(param, False, (orm, channel), fallback, "Textures")


def _world_uv(g: Graph, wp, tiling_param):
    return g.div(g.mask(wp, r=True, g=True), tiling_param)


def _sand_tint_rgb(g: Graph):
    return g.mask(g.mpc_param("SandTint"), r=True, g=True, b=True)


# =====================================================================================
# M_Landscape_Sand
# =====================================================================================
def build_landscape_sand():
    mat, g = begin_material(f"{MASTER_DIR}/M_Landscape_Sand")
    set_usage(mat, "nanite")
    # Nanite-тесселяция (UE 5.4+): displacement из ряби. Требует r.Nanite.Tessellation=1 (Config уже).
    set_first(mat, ["enable_tessellation"], True)
    ds = getattr(unreal, "DisplacementScaling", None)
    if ds is not None:
        try:
            d = ds()
            d.set_editor_property("magnitude", 1.5)   # см: высота гребня ряби
            d.set_editor_property("center", 0.0)
            set_prop(mat, "displacement_scaling", d)
        except Exception as ex:  # noqa: BLE001
            warn(f"DisplacementScaling: {ex}")

    wp = g.world_pos()
    depth = g.node("MaterialExpressionPixelDepth")
    vn = g.node("MaterialExpressionVertexNormalWS")
    camv = g.node("MaterialExpressionCameraVectorWS")
    t = g.time()
    wind_dir = g.mask(g.mpc_param("WindDirection"), r=True, g=True, b=True)
    wind_speed = g.mpc_param("WindSpeed")
    sun_dir = g.mask(g.mpc_param("SunDirection"), r=True, g=True, b=True)

    # --- параметры: цвет
    c_dry = g.vector("SandColor_Loose", srgb("#C9A878"), "01 Color", 0)
    c_packed = g.vector("SandColor_Packed", srgb("#B8936A"), "01 Color", 1)
    c_bleach = g.vector("SandColor_Distance", srgb("#DCC7A3"), "01 Color", 2)
    p_macro_scale = g.scalar("MacroScale", 40000.0, "02 Variation", 2000, 200000)
    p_micro_scale = g.scalar("MicroScale", 600.0, "02 Variation", 50, 5000)
    p_macro_str = g.scalar("MacroStrength", 0.10, "02 Variation", 0, 0.5)
    p_micro_str = g.scalar("MicroStrength", 0.05, "02 Variation", 0, 0.3)
    # --- склон: рыхлый (крутые подветренные склоны ~30°+) vs плотный (пологие, межгрядья)
    p_packed_nz = g.scalar("LooseSlopeNormalZ", 0.90, "03 Slope", 0.5, 1.0)
    p_slope_sharp = g.scalar("LooseSlopeSharpness", 8.0, "03 Slope", 1, 40)
    p_rough_loose = g.scalar("Roughness_Loose", 0.93, "03 Slope", 0, 1)
    p_rough_packed = g.scalar("Roughness_Packed", 0.82, "03 Slope", 0, 1)
    p_spec = g.scalar("Specular", 0.35, "03 Slope", 0, 1)
    # --- рябь
    p_wl = g.scalar("RippleWavelength", 9.0, "04 Ripples", 3, 30)
    p_breakup = g.scalar("RippleBreakup", 0.45, "04 Ripples", 0, 1)
    p_migr = g.scalar("RippleMigration", 1.0, "04 Ripples", 0, 10)
    p_asym = g.scalar("RippleAsymmetry", 0.72, "04 Ripples", 0.5, 0.95)
    p_rip_str = g.scalar("RippleStrength", 0.65, "04 Ripples", 0, 1)
    p_rip_fade = g.scalar("RippleFadeDistance", 6000.0, "04 Ripples", 500, 30000)
    # --- искры
    p_sp_cell = g.scalar("SparkleCellSize", 1.2, "05 Sparkle", 0.2, 5)
    p_sp_den = g.scalar("SparkleDensity", 0.035, "05 Sparkle", 0, 0.3)
    p_sp_sharp = g.scalar("SparkleSharpness", 180.0, "05 Sparkle", 20, 600)
    p_sp_fade = g.scalar("SparkleFadeDistance", 2500.0, "05 Sparkle", 200, 10000)
    p_sp_int = g.scalar("SparkleIntensity", 1.0, "05 Sparkle", 0, 2)
    p_sp_rough = g.scalar("SparkleRoughness", 0.10, "05 Sparkle", 0, 0.5)
    # --- дистанция
    p_ds_start = g.scalar("DistanceBleachStart", 5000.0, "06 Distance", 0, 50000)
    p_ds_range = g.scalar("DistanceBleachRange", 120000.0, "06 Distance", 1000, 400000)
    p_ds_amt = g.scalar("DistanceBleachAmount", 0.35, "06 Distance", 0, 1)
    # --- текстуры Megascans (опционально, статический свитч UseTextures)
    p_tiling = g.scalar("TextureTilingCm", 200.0, "Textures", 20, 2000)
    p_tex_tint = g.vector("TextureTint", lin(1, 1, 1), "Textures")
    p_disp = g.scalar("DisplacementIntensity", 1.0, "07 Nanite", 0, 4)

    # --- вариация
    var = g.custom("return RakisMacroVariation(WorldPos, MacroScale, MicroScale);",
                   [("WorldPos", wp), ("MacroScale", p_macro_scale), ("MicroScale", p_micro_scale)],
                   "float2", ["RakisSurface.ush"], "Macro/Micro variation")
    v_macro = g.mask(var, r=True)
    v_micro = g.mask(var, g=True)

    nz = g.mask(vn, b=True)
    loose = g.saturate(g.mul(g.sub(p_packed_nz, nz), p_slope_sharp))  # 1 = рыхлый склон

    uv = _world_uv(g, wp, p_tiling)
    t_bc = g.texture("T_Sand_BC", ENGINE_TEX["grey"], "color", uv=uv)
    t_n = g.texture("T_Sand_N", ENGINE_TEX["normal"], "normal", uv=uv)
    t_orm = g.texture("T_Sand_ORM", ENGINE_TEX["orm"], "masks", uv=uv)

    proc_col = g.lerp(c_packed, c_dry, loose)
    base_col = g.switch("UseTextures", False, g.mul((t_bc, "RGB"), p_tex_tint), proc_col, "Textures")
    variation = g.add(1.0, g.add(g.mul(v_macro, p_macro_str), g.mul(v_micro, p_micro_str)))
    col = g.mul(g.mul(base_col, variation), _sand_tint_rgb(g))

    # Следы/колея червя: маска из Render Target вокруг игрока (см. docs/tech-art/sand.md §Следы).
    p_trail_ext = g.scalar("TrailExtentCm", 4096.0, "08 Trails", 512, 16384)
    pp_xy = g.mask(g.mpc_param("PlayerPosition"), r=True, g=True)
    trail_uv = g.add(g.div(g.sub(g.mask(wp, r=True, g=True), pp_xy), p_trail_ext), 0.5)
    t_trail = g.texture("T_TrailMask", ENGINE_TEX["black"], "color", "08 Trails", uv=trail_uv)
    trail = g.switch("UseTrails", False, (t_trail, "R"), 0.0, "08 Trails")
    col = g.lerp(col, g.mul(col, 0.82), trail)  # вскопанный песок темнее (влажнее изнутри)

    bleach = g.mul(g.saturate(g.div(g.sub(depth, p_ds_start), p_ds_range)), p_ds_amt)
    col_final = g.lerp(col, g.mul(c_bleach, _sand_tint_rgb(g)), bleach)
    g.out(col_final, "BaseColor")

    # --- рябь
    rp = g.append4(p_wl, p_breakup, p_migr, p_asym)
    ripple = g.custom("return RakisSandRipples(WorldPos, WindDir, Time, WindSpeed, Params);",
                      [("WorldPos", wp), ("WindDir", wind_dir), ("Time", t), ("WindSpeed", wind_speed),
                       ("Params", rp)], "float4", ["SandRipples.ush"], "Wind ripples")
    rip_n = g.mask(ripple, r=True, g=True, b=True)
    rip_h = g.mask(ripple, al=True)
    rip_fade = g.one_minus(g.saturate(g.div(depth, p_rip_fade)))
    rip_amt = g.mul(g.mul(p_rip_str, g.one_minus(loose)), g.mul(rip_fade, g.one_minus(trail)))
    flat = g.const3(0.0, 0.0, 1.0)
    n_rip = g.lerp(flat, rip_n, rip_amt)
    n_base = g.switch("UseTextures", False, (t_n, "RGB"), flat, "Textures")
    n_final = g.custom("return normalize(float3(A.xy + B.xy, A.z * B.z));",
                       [("A", n_base), ("B", n_rip)], "float3", desc="Whiteout normal blend")
    g.out(n_final, "Normal")

    # --- искры
    sp = g.append4(p_sp_cell, p_sp_den, p_sp_sharp, p_sp_fade)
    sparkle = g.custom("return RakisSandSparkle(WorldPos, CameraVector, SunDir, Normal, Depth, Params) * Intensity;",
                       [("WorldPos", wp), ("CameraVector", camv), ("SunDir", sun_dir), ("Normal", vn),
                        ("Depth", depth), ("Params", sp), ("Intensity", p_sp_int)],
                       "float1", ["SandSparkle.ush"], "Sand sparkle")
    sparkle = g.saturate(sparkle)

    rough_proc = g.lerp(p_rough_packed, p_rough_loose, loose)
    rough_base = _orm_switch(g, t_orm, "G", rough_proc)
    rough = g.lerp(rough_base, p_sp_rough, sparkle)
    g.out(rough, "Roughness")
    g.out(g.lerp(p_spec, 1.0, sparkle), "Specular")
    g.out(_orm_switch(g, t_orm, "R", 1.0), "AO")

    # --- displacement (Nanite tessellation): 0..1, center=0, magnitude=1.5 см
    g.out(g.saturate(g.mul(g.mul(rip_h, rip_amt), p_disp)), "Displacement")

    # --- RVT: статические данные (без анимации ряби) для смешивания мешей с ландшафтом
    rvt = g.node("MaterialExpressionRuntimeVirtualTextureOutput")
    if rvt is not None:
        g.connect(col, rvt, "BaseColor")
        g.connect(p_spec, rvt, "Specular")
        g.connect(rough_proc, rvt, "Roughness")
        g.connect(n_base, rvt, "Normal")
        g.connect(g.mask(wp, b=True), rvt, "WorldHeight")
    finish_material(mat, g)
    return mat


# =====================================================================================
# M_Rock_Master
# =====================================================================================
WAT_FN = "/Engine/Functions/Engine_MaterialFunctions01/Texturing/WorldAlignedTexture.WorldAlignedTexture"


def build_rock():
    mat, g = begin_material(f"{MASTER_DIR}/M_Rock_Master")
    set_usage(mat, "nanite", "ism")
    wp = g.world_pos()
    vn = g.node("MaterialExpressionVertexNormalWS")
    wind_dir = g.mask(g.mpc_param("WindDirection"), r=True, g=True, b=True)

    c_a = g.vector("RockColorA", srgb("#8A6A50"), "01 Color", 0)
    c_b = g.vector("RockColorB", srgb("#6B5241"), "01 Color", 1)
    c_vein = g.vector("VeinColor", srgb("#B59C7E"), "01 Color", 2)
    c_sand = g.vector("SandColor", srgb("#C9A878"), "01 Color", 3)
    p_macro_scale = g.scalar("MacroScale", 6000.0, "02 Macro", 500, 50000)
    p_micro_scale = g.scalar("MicroScale", 150.0, "02 Macro", 10, 2000)
    p_macro_str = g.scalar("MacroStrength", 0.35, "02 Macro", 0, 1)
    p_strata_scale = g.scalar("StrataScale", 180.0, "03 Strata", 20, 2000)
    p_strata_warp = g.scalar("StrataWarp", 2.5, "03 Strata", 0, 10)
    p_strata_str = g.scalar("StrataStrength", 0.35, "03 Strata", 0, 1)
    p_vein_str = g.scalar("VeinStrength", 0.25, "03 Strata", 0, 1)
    p_sand_amt = g.scalar("SandAccumulation", 0.55, "04 Sand", 0, 1)
    p_sand_sharp = g.scalar("SandSharpness", 5.0, "04 Sand", 1, 20)
    p_polish = g.scalar("WindPolish", 0.35, "05 Surface", 0, 1)
    p_rough = g.scalar("Roughness", 0.86, "05 Surface", 0, 1)
    p_tex_size = g.scalar("TextureSizeCm", 400.0, "Textures", 50, 4000)
    p_detail = g.scalar("DetailNormalTiling", 4.0, "Textures", 0.25, 32)
    p_tex_tint = g.vector("TextureTint", lin(1, 1, 1), "Textures")

    var = g.custom("return RakisMacroVariation(WorldPos, MacroScale, MicroScale);",
                   [("WorldPos", wp), ("MacroScale", p_macro_scale), ("MicroScale", p_micro_scale)],
                   "float2", ["RakisSurface.ush"], "Macro mask")
    strata = g.custom("return RakisRockStrata(WorldPos, StrataScale, Warp);",
                      [("WorldPos", wp), ("StrataScale", p_strata_scale), ("Warp", p_strata_warp)],
                      "float2", ["RakisSurface.ush"], "Strata bands (Z)")
    alpha = g.saturate(g.add(g.mul(g.mask(strata, r=True), p_strata_str), g.mul(g.mask(var, r=True), p_macro_str)))
    proc = g.lerp(c_a, c_b, alpha)
    proc = g.lerp(proc, c_vein, g.mul(g.mask(strata, g=True), p_vein_str))

    # Трипланар (world-aligned) BC Megascans через движковую функцию WorldAlignedTexture.
    tex_col = None
    wat = g.function_call(WAT_FN)
    tobj = g.node("MaterialExpressionTextureObjectParameter", parameter_name="T_Rock_BC", group="Textures")
    if wat is not None and tobj is not None:
        grey = load_or_none(ENGINE_TEX["grey"])
        if grey:
            set_prop(tobj, "texture", grey)
        g.connect(tobj, wat, "TextureObject")
        g.connect(g.append(g.append(p_tex_size, p_tex_size), p_tex_size), wat, "TextureSize")
        tex_col = g.mul((wat, "XYZ Texture"), p_tex_tint)
    base = g.switch("UseTextures", False, tex_col if tex_col is not None else proc, proc, "Textures")
    micro = g.add(1.0, g.mul(g.mask(var, g=True), 0.08))
    base = g.mul(base, micro)

    # Песок на верхних гранях (мировая нормаль Z), разбитый микрошумом.
    nz = g.mask(vn, b=True)
    up = g.saturate(g.mul(g.sub(nz, g.one_minus(p_sand_amt)), p_sand_sharp))
    sand_mask = g.saturate(g.mul(up, g.add(1.0, g.mask(var, g=True))))
    sand_col = g.mul(c_sand, _sand_tint_rgb(g))
    g.out(g.lerp(base, sand_col, sand_mask), "BaseColor")

    # Полировка ветром: наветренные грани глаже.
    windward = g.saturate(g.mul(g.dot(vn, wind_dir), -1.0))
    rough = g.lerp(p_rough, g.mul(p_rough, 0.55), g.mul(windward, p_polish))
    uv = g.texcoord(0, 1.0, 1.0)
    uv_d = g.mul(uv, p_detail)
    t_n = g.texture("T_Rock_N", ENGINE_TEX["normal"], "normal", uv=uv_d)
    t_orm = g.texture("T_Rock_ORM", ENGINE_TEX["orm"], "masks", uv=uv_d)
    rough = _orm_switch(g, t_orm, "G", rough)
    g.out(g.lerp(rough, 0.93, sand_mask), "Roughness")
    g.out(0.5, "Specular")
    n = g.switch("UseTextures", False, (t_n, "RGB"), g.const3(0, 0, 1), "Textures")
    g.out(g.lerp(n, g.const3(0, 0, 1), g.mul(sand_mask, 0.8)), "Normal")
    g.out(_orm_switch(g, t_orm, "R", 1.0), "AO")
    finish_material(mat, g)
    return mat


# =====================================================================================
# M_Sietch_Stone
# =====================================================================================
def build_sietch_stone():
    mat, g = begin_material(f"{MASTER_DIR}/M_Sietch_Stone")
    set_usage(mat, "nanite", "ism")
    # Декали истории (M_Decal_*) — DBuffer: материал принимает декали по умолчанию.
    wp = g.world_pos()
    vc = g.node("MaterialExpressionVertexColor")
    lp = g.node("MaterialExpressionLocalPosition")
    local_z = g.mask(lp, b=True) if lp is not None else g.const(100.0)

    c_stone = g.vector("StoneColor", srgb("#9C8670"), "01 Color", 0)
    c_dark = g.vector("StoneColorDark", srgb("#7D6A57"), "01 Color", 1)
    c_polish = g.vector("PolishTint", lin(0.86, 0.80, 0.72), "02 Polish", 0)
    c_soot = g.vector("SootColor", srgb("#2A221C"), "04 Soot", 0)
    p_macro_scale = g.scalar("MacroScale", 900.0, "01 Color", 50, 10000)
    p_var = g.scalar("ColorVariation", 0.45, "01 Color", 0, 1)
    p_polish = g.scalar("Polish", 0.6, "02 Polish", 0, 1)
    p_polish_rough = g.scalar("PolishRoughness", 0.28, "02 Polish", 0, 1)
    p_band_min = g.scalar("HandBandMinCm", 70.0, "02 Polish", 0, 300)
    p_band_max = g.scalar("HandBandMaxCm", 170.0, "02 Polish", 0, 400)
    p_band_w = g.scalar("HandBandWeight", 0.5, "02 Polish", 0, 1)
    p_rough = g.scalar("Roughness", 0.78, "03 Surface", 0, 1)
    p_ao = g.scalar("AOStrength", 1.0, "03 Surface", 0, 2)
    p_grime = g.scalar("Grime", 0.25, "03 Surface", 0, 1)
    p_soot_h = g.scalar("SootHeightWS", -2300.0, "04 Soot", -10000, 5000)
    p_soot_fade = g.scalar("SootFadeCm", 400.0, "04 Soot", 10, 3000)
    p_soot = g.scalar("SootDensity", 0.6, "04 Soot", 0, 1)
    p_tiling = g.scalar("TextureTiling", 1.0, "Textures", 0.1, 16)

    var = g.custom("return RakisMacroVariation(WorldPos, MacroScale, MacroScale * 0.08);",
                   [("WorldPos", wp), ("MacroScale", p_macro_scale)], "float2", ["RakisSurface.ush"], "Stone variation")
    col = g.lerp(c_stone, c_dark, g.saturate(g.mul(g.add(g.mask(var, r=True), 0.5), p_var)))

    uv = g.mul(g.texcoord(0), p_tiling)
    t_bc = g.texture("T_Stone_BC", ENGINE_TEX["grey"], "color", uv=uv)
    t_n = g.texture("T_Stone_N", ENGINE_TEX["normal"], "normal", uv=uv)
    t_orm = g.texture("T_Stone_ORM", ENGINE_TEX["orm"], "masks", uv=uv)
    t_pol = g.texture("T_Polish_Mask", ENGINE_TEX["black"], "color", uv=g.texcoord(0))
    col = g.switch("UseTextures", False, g.mul((t_bc, "RGB"), col), col, "Textures")

    # Полировка руками: выпуклые рёбра (кривизна, запечённая в Vertex Color R или маску) + полоса высоты рук.
    edge = g.switch("UseVertexPolish", False, (vc, "R"), (t_pol, "R"), "02 Polish")
    band = g.mul(g.saturate(g.div(g.sub(local_z, p_band_min), 30.0)),
                 g.saturate(g.div(g.sub(p_band_max, local_z), 30.0)))
    polish = g.saturate(g.mul(g.add(edge, g.mul(band, p_band_w)), p_polish))
    col = g.lerp(col, g.mul(col, c_polish), polish)

    # Копоть у потолка (светошары раньше были масляными лампами).
    soot = g.mul(g.saturate(g.div(g.sub(g.mask(wp, b=True), p_soot_h), p_soot_fade)), p_soot)
    soot = g.mul(soot, g.add(0.75, g.mul(g.mask(var, g=True), 0.25)))
    col = g.lerp(col, c_soot, soot)
    # Грязь в углублениях (AO) — тёмная бурая.
    ao_src = _orm_switch(g, t_orm, "R", (vc, "A"))
    ao = g.lerp(1.0, ao_src, p_ao)
    col = g.lerp(col, g.mul(col, 0.7), g.mul(g.one_minus(ao), p_grime))
    g.out(col, "BaseColor")

    rough = _orm_switch(g, t_orm, "G", p_rough)
    rough = g.lerp(rough, p_polish_rough, polish)
    g.out(g.lerp(rough, 0.95, g.mul(soot, 0.7)), "Roughness")
    g.out(0.5, "Specular")
    g.out(ao, "AO")
    n = g.switch("UseTextures", False, (t_n, "RGB"), g.const3(0, 0, 1), "Textures")
    # Отполированное — более гладкое: ослабляем детальную нормаль.
    g.out(g.lerp(n, g.const3(0, 0, 1), g.mul(polish, 0.6)), "Normal")
    finish_material(mat, g)
    return mat


# =====================================================================================
# M_Cloth_Worn / M_Spice_Fabric (Cloth shading model)
# =====================================================================================
def build_cloth(path: str, default_tint: str, spice: bool = False):
    mat, g = begin_material(path, shading="cloth", two_sided=True)
    set_usage(mat, "skeletal", "ism")
    wp = g.world_pos()
    vn = g.node("MaterialExpressionVertexNormalWS")
    vc = g.node("MaterialExpressionVertexColor")
    lp = g.node("MaterialExpressionLocalPosition")
    local_z = g.mask(lp, b=True) if lp is not None else g.const(100.0)

    # ClothTint — имя фиксировано: ARakisCitizen задаёт его в MID по палитре архетипа.
    c_tint = g.vector("ClothTint", srgb(default_tint), "01 Color", 0)
    c_sheen = g.vector("SheenColor", srgb("#E8D8C0"), "01 Color", 1)
    c_dust = g.vector("DustColor", srgb("#BFA07A"), "03 Dust", 0)
    p_sheen = g.scalar("SheenAmount", 0.6, "01 Color", 0, 1)
    p_rough = g.scalar("Roughness", 0.82, "02 Surface", 0, 1)
    p_wear = g.scalar("WearAmount", 0.5, "02 Surface", 0, 1)
    p_wear_const = g.scalar("WearBase", 0.25, "02 Surface", 0, 1)
    p_dust = g.scalar("DustAmount", 0.5, "03 Dust", 0, 1)
    p_hem = g.scalar("HemHeightCm", 45.0, "03 Dust", 1, 200)
    p_tiling = g.scalar("WeaveTiling", 8.0, "Textures", 0.5, 64)

    uv = g.texcoord(0)
    uv_w = g.mul(uv, p_tiling)
    t_bc = g.texture("T_Cloth_BC", ENGINE_TEX["grey"], "color", uv=uv)
    t_n = g.texture("T_Cloth_Weave_N", ENGINE_TEX["normal"], "normal", uv=uv_w)

    col = g.switch("UseTextures", False, g.mul((t_bc, "RGB"), c_tint), c_tint, "Textures")
    if spice:
        c_pat = g.vector("PatternColor", srgb("#2C4A7A"), "04 Pattern", 0)
        p_ps = g.scalar("PatternScale", 12.0, "04 Pattern", 1, 64)
        p_pw = g.scalar("PatternWidth", 0.12, "04 Pattern", 0.01, 0.45)
        pat = g.custom(
            "float s = abs(frac(UV.y * Scale) - 0.5);\n"
            "float d = abs(frac((UV.x + UV.y) * Scale * 0.5) - 0.5);\n"
            "float stripe = saturate((Width - s) * 40.0);\n"
            "float diamond = saturate((Width * 0.6 - abs(s - d)) * 40.0) * step(s, 0.3);\n"
            "return max(stripe, diamond);",
            [("UV", uv), ("Scale", p_ps), ("Width", p_pw)], "float1", desc="Spice weave pattern")
        col = g.lerp(col, c_pat, pat)

    wear_src = g.switch("UseVertexWear", False, (vc, "G"), p_wear_const, "02 Surface")
    wear = g.custom("return RakisClothWear(WorldPos, Normal, LocalZ, VertexWear, WearAmount, DustAmount, HemHeight);",
                    [("WorldPos", wp), ("Normal", vn), ("LocalZ", local_z), ("VertexWear", wear_src),
                     ("WearAmount", p_wear), ("DustAmount", p_dust), ("HemHeight", p_hem)],
                    "float2", ["RakisSurface.ush"], "Wear + dust")
    w = g.mask(wear, r=True)
    d = g.mul(g.mask(wear, g=True), g.add(1.0, g.mpc_param("DustDensity")))
    d = g.saturate(d)
    # Выгорание и потёртость: светлее и менее насыщенно.
    col = g.lerp(col, g.desaturate(g.mul(col, 1.25), 0.45), w)
    col = g.lerp(col, g.mul(c_dust, _sand_tint_rgb(g)), d)
    g.out(col, "BaseColor")
    g.out(g.lerp(g.lerp(p_rough, 0.9, w), 0.95, d), "Roughness")
    g.out(g.mul(c_sheen, g.lerp(1.0, 0.6, d)), "Subsurface")   # Fuzz Color в Cloth-модели
    g.out(g.lerp(p_sheen, 0.2, d), "CustomData0")               # Cloth (сила ворса)
    g.out((t_n, "RGB"), "Normal")
    finish_material(mat, g)
    return mat


# =====================================================================================
# Червь: хитин и зубы
# =====================================================================================
def build_worm_chitin():
    mat, g = begin_material(f"{MASTER_DIR}/M_Worm_Chitin", shading="subsurface")
    set_usage(mat, "nanite", "ism", "spline", "skeletal")
    vn = g.node("MaterialExpressionVertexNormalWS")
    uv = g.texcoord(0)

    c_chitin = g.vector("ChitinColor", srgb("#5E4E40"), "01 Color", 0)
    c_plate = g.vector("PlateColor", srgb("#7C6A55"), "01 Color", 1)
    c_sand = g.vector("GrooveSandColor", srgb("#C9A878"), "01 Color", 2)
    c_wet = g.vector("MouthWetColor", srgb("#4A1E18"), "04 Mouth", 0)
    c_sss = g.vector("SubsurfaceTint", srgb("#6E2E1E"), "05 Subsurface", 0)
    p_rings = g.scalar("RingsPerSegment", 3.0, "02 Rings", 1, 12)
    p_plates = g.scalar("PlatesAround", 14.0, "02 Rings", 2, 64)
    p_crack = g.scalar("CrackWidth", 0.06, "02 Rings", 0.005, 0.3)
    p_crack_dark = g.scalar("CrackDarkening", 0.5, "02 Rings", 0, 1)
    p_sand = g.scalar("SandInGrooves", 0.8, "03 Sand", 0, 1)
    p_sand_up = g.scalar("SandOnTop", 0.35, "03 Sand", 0, 1)
    p_wet = g.scalar("MouthWetness", 0.0, "04 Mouth", 0, 1)
    p_rough = g.scalar("Roughness", 0.62, "05 Surface", 0, 1)
    p_sss = g.scalar("SubsurfaceOpacity", 0.3, "05 Subsurface", 0, 1)
    p_tiling = g.scalar("DetailTiling", 6.0, "Textures", 0.5, 64)

    ch = g.custom("return RakisChitin(UV, Rings, Plates, CrackWidth);",
                  [("UV", uv), ("Rings", p_rings), ("Plates", p_plates), ("CrackWidth", p_crack)],
                  "float4", ["RakisSurface.ush"], "Chitin rings/plates")
    groove = g.mask(ch, r=True)
    crack = g.mask(ch, g=True)
    plate_id = g.mask(ch, b=True)
    crest = g.mask(ch, al=True)

    col = g.lerp(c_chitin, c_plate, g.mul(plate_id, 0.6))
    col = g.lerp(col, g.mul(col, 0.5), g.mul(crack, p_crack_dark))
    col = g.lerp(col, g.mul(col, 1.3), g.mul(crest, 0.5))
    up = g.saturate(g.sub(g.mul(g.mask(vn, b=True), 1.5), 0.6))
    sand = g.saturate(g.add(g.mul(groove, p_sand), g.mul(up, p_sand_up)))
    col = g.lerp(col, g.mul(c_sand, _sand_tint_rgb(g)), sand)
    col = g.lerp(col, c_wet, p_wet)
    g.out(col, "BaseColor")

    rough = g.lerp(p_rough, 0.4, crest)
    rough = g.lerp(rough, 0.95, sand)
    g.out(g.lerp(rough, 0.22, p_wet), "Roughness")
    g.out(g.lerp(0.45, 0.6, p_wet), "Specular")
    g.out(g.lerp(c_sss, g.mul(c_sss, 1.6), p_wet), "Subsurface")
    g.out(g.lerp(p_sss, 0.6, p_wet), "Opacity")  # для Subsurface — сила рассеяния

    t_n = g.texture("T_Chitin_N", ENGINE_TEX["normal"], "normal", uv=g.mul(uv, p_tiling))
    g.out((t_n, "RGB"), "Normal")
    finish_material(mat, g)
    return mat


def build_worm_teeth():
    mat, g = begin_material(f"{MASTER_DIR}/M_Worm_Teeth", shading="subsurface")
    set_usage(mat, "nanite", "ism", "skeletal")
    wp = g.world_pos()
    c_teeth = g.vector("TeethColor", srgb("#E6DFD2"), "01 Color", 0)
    c_milk = g.vector("MilkColor", srgb("#F4F1EA"), "01 Color", 1)
    c_root = g.vector("RootColor", srgb("#A89478"), "01 Color", 2)
    c_sss = g.vector("SubsurfaceColor", srgb("#D8C4A0"), "02 Subsurface", 0)
    p_sss = g.scalar("SubsurfaceOpacity", 0.65, "02 Subsurface", 0, 1)
    p_rough = g.scalar("Roughness", 0.22, "03 Surface", 0, 1)
    p_spec = g.scalar("Specular", 0.6, "03 Surface", 0, 1)
    p_streak = g.scalar("StreakScale", 25.0, "03 Surface", 1, 500)

    fres = g.fresnel(3.0, 0.1)
    var = g.custom("return RakisMacroVariation(WorldPos, Scale, Scale * 0.15);",
                   [("WorldPos", wp), ("Scale", p_streak)], "float2", ["RakisSurface.ush"], "Crystal streaks")
    uv = g.texcoord(0)
    root = g.saturate(g.mul(g.mask(uv, g=True), 1.0))  # V: 0 — кончик, 1 — корень зуба
    col = g.lerp(c_teeth, c_milk, g.mul(fres, 0.6))
    col = g.lerp(col, c_root, g.power(root, 3.0))
    col = g.mul(col, g.add(1.0, g.mul(g.mask(var, g=True), 0.06)))
    g.out(col, "BaseColor")
    g.out(g.add(p_rough, g.mul(g.mask(var, r=True), 0.08)), "Roughness")
    g.out(p_spec, "Specular")
    g.out(c_sss, "Subsurface")
    g.out(p_sss, "Opacity")
    finish_material(mat, g)
    return mat


# =====================================================================================
# Светошары
# =====================================================================================
def build_glowglobe():
    mat, g = begin_material(f"{MASTER_DIR}/M_Glowglobe")
    set_usage(mat, "ism", "nanite")
    obj = g.node("MaterialExpressionObjectPositionWS")
    t = g.time()
    c_glass = g.vector("GlassColor", srgb("#1A140C"), "01 Surface", 0)
    p_temp = g.scalar("TemperatureK", 2700.0, "02 Glow", 1500, 6500)
    p_int = g.scalar("EmissiveIntensity", 30.0, "02 Glow", 0, 500)
    p_speed = g.scalar("FlickerSpeed", 1.0, "03 Flicker", 0, 5)
    p_amt = g.scalar("FlickerAmount", 0.15, "03 Flicker", 0, 1)
    p_core = g.scalar("CoreFalloff", 2.0, "02 Glow", 0.5, 8)

    bb = g.node("MaterialExpressionBlackBody")
    if bb is not None:
        g.connect(p_temp, bb, ["Temp", ""])
    flick = g.custom(
        "float Seed = frac(dot(ObjPos, float3(0.0137, 0.0291, 0.0071)));\n"
        "return RakisGlowFlicker(Time, Seed, Speed, Amount);",
        [("ObjPos", obj), ("Time", t), ("Speed", p_speed), ("Amount", p_amt)],
        "float1", ["RakisSurface.ush"], "Glowglobe flicker")
    # Центр шара ярче краёв (обратный френель) — читается объём «светящегося газа».
    core = g.power(g.one_minus(g.fresnel(1.0, 0.0)), p_core)
    glow = g.mul(g.mul(bb if bb is not None else g.const3(1.0, 0.4, 0.1), p_int), g.mul(flick, g.lerp(0.45, 1.0, core)))
    g.out(glow, "Emissive")
    g.out(c_glass, "BaseColor")
    g.out(0.08, "Roughness")
    g.out(0.5, "Specular")
    finish_material(mat, g)
    return mat


def build_lf_glowglobe():
    """Light Function мерцания (Point Light светошара). Значение 0..1 умножает свет."""
    mat, g = begin_material(f"{MASTER_DIR}/M_LF_GlowglobeFlicker", domain="light_function")
    t = g.time()
    p_seed = g.scalar("PhaseSeed", 0.37, "Flicker", 0, 1)
    p_speed = g.scalar("FlickerSpeed", 1.0, "Flicker", 0, 5)
    p_amt = g.scalar("FlickerAmount", 0.12, "Flicker", 0, 1)
    flick = g.custom("return RakisGlowFlicker(Time, Seed, Speed, Amount);",
                     [("Time", t), ("Seed", p_seed), ("Speed", p_speed), ("Amount", p_amt)],
                     "float1", ["RakisSurface.ush"], "Light function flicker")
    g.out(flick, "Emissive")
    finish_material(mat, g)
    return mat


# =====================================================================================
# Вода цистерны
# =====================================================================================
def build_water_still():
    mat, g = begin_material(f"{MASTER_DIR}/M_Water_Still")
    wp = g.world_pos()
    t = g.time()
    c_deep = g.vector("DeepColor", srgb("#06090B"), "01 Color", 0)
    c_edge = g.vector("EdgeTint", srgb("#1B2A2E"), "01 Color", 1)
    p_rough = g.scalar("Roughness", 0.03, "02 Surface", 0, 0.3)
    p_spec = g.scalar("Specular", 0.255, "02 Surface", 0, 1)  # F0 воды ≈ 0.02
    p_drops = g.scalar("DropsPerCell", 0.3, "03 Drips", 0, 3)
    p_cell = g.scalar("DropCellSizeCm", 120.0, "03 Drips", 10, 1000)
    p_str = g.scalar("RippleStrength", 0.4, "03 Drips", 0, 2)
    drip = g.custom("return RakisDripRipples(WorldPos, Time, Drops, CellSize, Strength);",
                    [("WorldPos", wp), ("Time", t), ("Drops", p_drops), ("CellSize", p_cell), ("Strength", p_str)],
                    "float4", ["RakisSurface.ush"], "Cistern drips")
    g.out(g.lerp(c_deep, c_edge, g.mul(g.fresnel(4.0, 0.0), 0.5)), "BaseColor")
    g.out(g.mask(drip, r=True, g=True, b=True), "Normal")
    g.out(p_rough, "Roughness")
    g.out(p_spec, "Specular")
    finish_material(mat, g)
    return mat


# =====================================================================================
# Декали истории сиетча (DBuffer, Deferred Decal)
#   Слой 1: фрименская резьба (M_Decal_Carving, Weathering высокий)
#   Слой 2: символы Квизарата (M_Decal_Carving, резкие, с копотью)
#   Слой 3: наивные росписи возрожденцев (M_Decal_Paint)
# =====================================================================================
def _decal_common(mat):
    v = enum_value("BlendMode", "BLEND_TRANSLUCENT")
    if v is not None:
        set_prop(mat, "blend_mode", v)


def build_decal_carving():
    mat, g = begin_material(f"{MASTER_DIR}/M_Decal_Carving", domain="decal")
    _decal_common(mat)
    uv = g.texcoord(0)
    c_tint = g.vector("CarvingTint", srgb("#5A4A3C"), "01 Color", 0)
    p_op = g.scalar("Opacity", 1.0, "01 Color", 0, 1)
    p_weather = g.scalar("Weathering", 0.4, "02 Age", 0, 1)
    p_wscale = g.scalar("WeatheringScale", 6.0, "02 Age", 1, 64)
    p_rough = g.scalar("Roughness", 0.88, "01 Color", 0, 1)
    p_soot = g.scalar("SootInGrooves", 0.0, "02 Age", 0, 1)
    t_mask = g.texture("T_Carving_Mask", ENGINE_TEX["white"], "color", uv=uv)
    t_n = g.texture("T_Carving_N", ENGINE_TEX["normal"], "normal", uv=uv)
    noise = g.custom("return RakisFbm2(UV * Scale, 4) * 0.5 + 0.5;", [("UV", uv), ("Scale", p_wscale)],
                     "float1", ["RakisNoise.ush"], "Weathering noise")
    erosion = g.lerp(1.0, g.saturate(g.mul(noise, 1.6)), p_weather)
    g.out(g.lerp(c_tint, g.const3(0.05, 0.04, 0.035), p_soot), "BaseColor")
    g.out((t_n, "RGB"), "Normal")
    g.out(p_rough, "Roughness")
    g.out(g.mul(g.mul((t_mask, "R"), erosion), p_op), "Opacity")
    finish_material(mat, g)
    return mat


def build_decal_paint():
    mat, g = begin_material(f"{MASTER_DIR}/M_Decal_Paint", domain="decal")
    _decal_common(mat)
    uv = g.texcoord(0)
    c_paint = g.vector("PaintColor", srgb("#9E3B22"), "01 Color", 0)
    p_op = g.scalar("Opacity", 0.9, "01 Color", 0, 1)
    p_flake = g.scalar("Flaking", 0.35, "02 Age", 0, 1)
    p_fscale = g.scalar("FlakeScale", 14.0, "02 Age", 1, 128)
    p_fade = g.scalar("ColorFade", 0.3, "02 Age", 0, 1)
    p_rough = g.scalar("Roughness", 0.92, "01 Color", 0, 1)
    t_mask = g.texture("T_Paint_Mask", ENGINE_TEX["white"], "color", uv=uv)
    noise = g.custom("return RakisFbm2(UV * Scale, 5) * 0.5 + 0.5;", [("UV", uv), ("Scale", p_fscale)],
                     "float1", ["RakisNoise.ush"], "Paint flaking noise")
    keep = g.saturate(g.mul(g.sub(noise, p_flake), 8.0))
    col = g.lerp(g.mul(c_paint, (t_mask, "RGB")), g.desaturate(c_paint, 1.0), p_fade)
    g.out(col, "BaseColor")
    g.out(p_rough, "Roughness")
    g.out(g.mul(g.mul((t_mask, "A"), keep), p_op), "Opacity")
    finish_material(mat, g)
    return mat


# =====================================================================================
# M_FX_Dust — общий материал спрайтов Niagara (песок, пыль, пряность, пылинки).
# Lit translucency (объёмная, per-vertex — дёшево), мягкая круглая маска с шумовым разрывом,
# Depth Fade против «срезов» о геометрию. Цвет/альфа — из Particle Color.
# =====================================================================================
def build_fx_dust():
    mat, g = begin_material(f"{MASTER_DIR}/M_FX_Dust", blend="translucent")
    set_usage(mat, "niagara_sprites", "niagara_mesh", "niagara_ribbons")
    tlm = enum_value("TranslucencyLightingMode", "TLM_VOLUMETRIC_PER_VERTEX_NON_DIRECTIONAL",
                     "TLM_VOLUMETRIC_NON_DIRECTIONAL")
    if tlm is not None:
        set_prop(mat, "translucency_lighting_mode", tlm)
    uv = g.texcoord(0)
    pc = g.node("MaterialExpressionParticleColor")
    pr = g.node("MaterialExpressionParticleRandom")
    p_soft = g.scalar("Softness", 1.6, "01 Shape", 0.2, 8)
    p_break = g.scalar("Breakup", 0.6, "01 Shape", 0, 1)
    p_scale = g.scalar("NoiseScale", 3.0, "01 Shape", 0.5, 16)
    p_op = g.scalar("Opacity", 0.5, "02 Look", 0, 1)
    p_fade = g.scalar("DepthFadeCm", 150.0, "02 Look", 1, 2000)
    p_emis = g.scalar("EmissiveBoost", 0.0, "02 Look", 0, 50)
    c_tint = g.vector("Tint", srgb("#C9A878"), "02 Look")
    shape = g.custom(
        "float2 c = UV * 2.0 - 1.0;\n"
        "float r = saturate(1.0 - dot(c, c));\n"
        "float n = RakisFbm2(UV * Scale + Seed * 17.0, 3) * 0.5 + 0.5;\n"
        "return pow(r, Softness) * lerp(1.0, n, Breakup);",
        [("UV", uv), ("Scale", p_scale), ("Seed", pr if pr is not None else 0.0), ("Softness", p_soft),
         ("Breakup", p_break)], "float1", ["RakisNoise.ush"], "Soft dust puff")
    rgb = g.mul(g.mask(pc, r=True, g=True, b=True), c_tint)
    alpha = g.mul(g.mul(shape, g.mask(pc, al=True)), p_op)
    df = g.node("MaterialExpressionDepthFade")
    if df is not None:
        g.connect(alpha, df, ["Opacity", "InOpacity"])
        g.connect(p_fade, df, ["FadeDistance", "DistanceToNearSurface"])
        alpha = df
    g.out(rgb, "BaseColor")
    g.out(g.mul(rgb, p_emis), "Emissive")
    g.out(alpha, "Opacity")
    g.out(1.0, "Roughness")
    finish_material(mat, g)
    return mat


# =====================================================================================
# M_Blockout — простейший мастер без Custom/include (работает даже без модуля Rakis).
# =====================================================================================
def build_blockout():
    mat, g = begin_material(f"{MASTER_DIR}/M_Blockout")
    set_usage(mat, "nanite", "ism")
    wp = g.world_pos()
    vn = g.node("MaterialExpressionVertexNormalWS")
    c = g.vector("Color", srgb("#9C8670"), "Blockout", 0)
    p_rough = g.scalar("Roughness", 0.9, "Blockout", 0, 1)
    p_grid = g.scalar("GridStrength", 0.12, "Blockout", 0, 1)
    p_size = g.scalar("GridSizeCm", 100.0, "Blockout", 10, 1000)
    grid = g.custom(
        "float3 d = (0.5 - abs(frac(P / Size) - 0.5)) * Size;\n"
        "float3 l = 1.0 - saturate(d / 1.5);\n"
        "float3 w = step(abs(N), 0.7);\n"
        "return max(max(l.x * w.x, l.y * w.y), l.z * w.z);",
        [("P", wp), ("N", vn), ("Size", p_size)], "float1", desc="1 m grid")
    g.out(g.lerp(c, g.mul(c, 0.6), g.mul(grid, p_grid)), "BaseColor")
    g.out(p_rough, "Roughness")
    finish_material(mat, g)
    return mat


# =====================================================================================
# Инстансы
# =====================================================================================
def _tex_set(prefix_names: dict) -> tuple[dict, bool]:
    """{param: [asset names...]} → (textures dict, найдено ли всё)."""
    found = {}
    for param, names in prefix_names.items():
        p = find_texture(*names)
        if p:
            found[param] = p
    return found, len(found) == len(prefix_names)


def build_instances(masters: dict) -> list:
    I = INSTANCE_DIR
    ensure_dir(I)
    made = []

    sand_tex, sand_ok = _tex_set({
        "T_Sand_BC": ["T_Sand_BC", "T_Desert_Sand_BC", "T_Sand_Dune_BC"],
        "T_Sand_N": ["T_Sand_N", "T_Desert_Sand_N", "T_Sand_Dune_N"],
        "T_Sand_ORM": ["T_Sand_ORM", "T_Desert_Sand_ORM", "T_Sand_Dune_ORM"],
    })
    rock_tex, rock_ok = _tex_set({
        "T_Rock_BC": ["T_Rock_Claw_BC", "T_Rock_BC", "T_Sandstone_BC"],
        "T_Rock_N": ["T_Rock_Claw_N", "T_Rock_N", "T_Sandstone_N"],
        "T_Rock_ORM": ["T_Rock_Claw_ORM", "T_Rock_ORM", "T_Sandstone_ORM"],
    })
    stone_tex, stone_ok = _tex_set({
        "T_Stone_BC": ["T_Sietch_Stone_BC", "T_Stone_BC"],
        "T_Stone_N": ["T_Sietch_Stone_N", "T_Stone_N"],
        "T_Stone_ORM": ["T_Sietch_Stone_ORM", "T_Stone_ORM"],
    })
    if not sand_ok:
        log("Текстуры песка (Megascans) не найдены — песок полностью процедурный (UseTextures=false)")

    sand, rock, stone = masters.get("sand"), masters.get("rock"), masters.get("stone")
    cloth, chitin, glow = masters.get("cloth"), masters.get("chitin"), masters.get("glow")

    made.append(make_instance(f"{I}/MI_Sand_Erg_Dry", sand,
                              scalars={"RippleStrength": 0.7, "SparkleDensity": 0.04, "LooseSlopeNormalZ": 0.92},
                              textures=sand_tex if sand_ok else None,
                              switches={"UseTextures": sand_ok}))
    made.append(make_instance(f"{I}/MI_Sand_Packed", sand,
                              scalars={"RippleStrength": 0.35, "SparkleDensity": 0.02, "LooseSlopeNormalZ": 0.6,
                                       "Roughness_Packed": 0.74, "MicroStrength": 0.08},
                              vectors={"SandColor_Packed": srgb("#AD8A63")},
                              textures=sand_tex if sand_ok else None,
                              switches={"UseTextures": sand_ok}))
    made.append(make_instance(f"{I}/MI_Rock_Claw", rock,
                              scalars={"StrataStrength": 0.45, "StrataScale": 240.0, "MacroScale": 12000.0,
                                       "SandAccumulation": 0.55, "WindPolish": 0.4},
                              textures=rock_tex if rock_ok else None, switches={"UseTextures": rock_ok}))
    made.append(make_instance(f"{I}/MI_Rock_Scatter", rock,
                              scalars={"StrataStrength": 0.2, "MacroScale": 1500.0, "SandAccumulation": 0.75,
                                       "SandSharpness": 3.0},
                              textures=rock_tex if rock_ok else None, switches={"UseTextures": rock_ok}))
    made.append(make_instance(f"{I}/MI_Sietch_Stone_Floor", stone,
                              scalars={"Polish": 0.8, "HandBandWeight": 0.0, "SootDensity": 0.0, "Roughness": 0.7},
                              vectors={"StoneColor": srgb("#93806B")},
                              textures=stone_tex if stone_ok else None, switches={"UseTextures": stone_ok}))
    made.append(make_instance(f"{I}/MI_Sietch_Stone_Wall", stone,
                              scalars={"Polish": 0.5, "HandBandWeight": 0.6, "SootDensity": 0.6},
                              textures=stone_tex if stone_ok else None, switches={"UseTextures": stone_ok}))
    made.append(make_instance(f"{I}/MI_Cloth_Stillsuit", cloth,
                              scalars={"SheenAmount": 0.25, "Roughness": 0.62, "DustAmount": 0.7, "WearAmount": 0.6},
                              vectors={"ClothTint": srgb("#4A4038"), "SheenColor": srgb("#9C9080")}))
    made.append(make_instance(f"{I}/MI_Cloth_Robe_Ochre", cloth,
                              vectors={"ClothTint": srgb("#A07A4A")}, scalars={"DustAmount": 0.55}))
    made.append(make_instance(f"{I}/MI_Cloth_Robe_Indigo", cloth,
                              vectors={"ClothTint": srgb("#2E3A5C"), "SheenColor": srgb("#B8C0D8")},
                              scalars={"DustAmount": 0.45, "WearAmount": 0.6}))
    made.append(make_instance(f"{I}/MI_Worm_Chitin", chitin, scalars={"RingsPerSegment": 3.0}))
    made.append(make_instance(f"{I}/MI_Glowglobe", glow, scalars={"EmissiveIntensity": 30.0}))

    lf = masters.get("lf")
    for suffix, seed in (("A", 0.13), ("B", 0.51), ("C", 0.87)):
        made.append(make_instance(f"{I}/MI_LF_GlowglobeFlicker_{suffix}", lf, scalars={"PhaseSeed": seed}))

    fxd = masters.get("fx_dust")
    made.append(make_instance(f"{I}/MI_FX_Dust_Sand", fxd, vectors={"Tint": srgb("#C9A878")},
                              scalars={"Opacity": 0.45, "Breakup": 0.7}))
    made.append(make_instance(f"{I}/MI_FX_Dust_Storm", fxd, vectors={"Tint": srgb("#B8925E")},
                              scalars={"Opacity": 0.6, "Softness": 1.0, "DepthFadeCm": 2000.0, "NoiseScale": 1.5}))
    made.append(make_instance(f"{I}/MI_FX_Dust_Spice", fxd, vectors={"Tint": srgb("#C27A45")},
                              scalars={"Opacity": 0.25, "Softness": 2.2, "DepthFadeCm": 300.0}))
    made.append(make_instance(f"{I}/MI_FX_Motes", fxd, vectors={"Tint": srgb("#FFD9A0")},
                              scalars={"Opacity": 0.9, "Softness": 3.0, "Breakup": 0.0, "EmissiveBoost": 2.0}))

    blk = masters.get("blockout")
    made.append(make_instance(f"{I}/MI_Blockout_Sand", blk, vectors={"Color": srgb("#C9A878")},
                              scalars={"Roughness": 0.92, "GridStrength": 0.08}))
    made.append(make_instance(f"{I}/MI_Blockout_Rock", blk, vectors={"Color": srgb("#8A6A50")},
                              scalars={"Roughness": 0.85, "GridStrength": 0.12}))
    made.append(make_instance(f"{I}/MI_Blockout_Stone", blk, vectors={"Color": srgb("#9C8670")},
                              scalars={"Roughness": 0.8, "GridStrength": 0.12}))
    return [m for m in made if m is not None]


# =====================================================================================
def build_all_masters() -> dict:
    ensure_dir(MASTER_DIR)
    builders = {
        "blockout": build_blockout,
        "sand": build_landscape_sand,
        "rock": build_rock,
        "stone": build_sietch_stone,
        "cloth": lambda: build_cloth(f"{MASTER_DIR}/M_Cloth_Worn", "#8A6A4A"),
        "spice": lambda: build_cloth(f"{MASTER_DIR}/M_Spice_Fabric", "#A04A22", spice=True),
        "chitin": build_worm_chitin,
        "teeth": build_worm_teeth,
        "glow": build_glowglobe,
        "lf": build_lf_glowglobe,
        "water": build_water_still,
        "carving": build_decal_carving,
        "paint": build_decal_paint,
        "fx_dust": build_fx_dust,
    }
    out = {}
    for key, fn in builders.items():
        try:
            out[key] = fn()
        except Exception as ex:  # noqa: BLE001
            warn(f"Мастер {key}: {ex}")
            out[key] = None
    return out


def main() -> None:
    with unreal.ScopedEditorTransaction("Rakis: master materials"):
        build_mpc()
        masters = build_all_masters()
        made = build_instances(masters)
    save_dir("/Game/Rakis/Materials")
    ok = [k for k, v in masters.items() if v is not None]
    log(f"mat_master_materials: мастеров {len(ok)}/{len(masters)}, инстансов {len(made)}")


if __name__ == "__main__":
    main()
