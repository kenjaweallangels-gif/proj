"""
mat_sand_trails.py — ассеты деформации песка (следы, колея червя). Задача T-017.
Вызывается из mat_master_materials.main() ДО сборки M_Landscape_Sand (ландшафт ссылается на RT по умолчанию).

Создаёт в /Game/Rakis/Materials/RT/:
  RT_SandTrail       TextureRenderTarget2D 2048², RG16f — ближний каскад (40.96 м вокруг игрока, 2 см/тексель)
  RT_SandTrail_Far   TextureRenderTarget2D 1024², RG16f — дальний каскад (204.8 м, 20 см/тексель)
  M_SandTrail_Stamp  Unlit, Additive — штамп (процедурная форма из SandTrail.ush, без текстур)
  M_SandTrail_Fade   Unlit, Translucent — «заживление ветром»: dest *= (1 - FadeAlpha)
  M_SandTrail_Copy   Unlit, Opaque — копия RT со сдвигом UV (скролл окна при рецентровке)

Каналы RT: R — глубина вмятины, см; G — высота вала, см. Рисует URakisSandTrailSubsystem (C++),
читает M_Landscape_Sand (RakisSandTrail в SandTrail.ush). Имена параметров — контракт с C++:
  Stamp: StampType, StampDepthCm, StampRimCm;  Fade: FadeAlpha;  Copy: Source (Texture), UVOffset (Vector).
Размеры/разрешения — синхронно с RakisSandTrailSubsystem.h (NearResolution/FarResolution/…WorldSizeCm).
"""
from __future__ import annotations

import unreal

from mat_graph_lib import MAT_ROOT, begin_material, enum_value, finish_material, set_first
from rakis_common import create_or_load, eal, ensure_dir, load_or_none, log, set_prop, warn

RT_DIR = f"{MAT_ROOT}/RT"
RT_NEAR_PATH = f"{RT_DIR}/RT_SandTrail"
RT_FAR_PATH = f"{RT_DIR}/RT_SandTrail_Far"
M_STAMP_PATH = f"{RT_DIR}/M_SandTrail_Stamp"
M_FADE_PATH = f"{RT_DIR}/M_SandTrail_Fade"
M_COPY_PATH = f"{RT_DIR}/M_SandTrail_Copy"

NEAR_RES = 2048
FAR_RES = 1024
NEAR_WORLD_CM = 4096.0     # 2 см/тексель
FAR_WORLD_CM = 20480.0     # 20 см/тексель


# =====================================================================================
# Render Targets
# =====================================================================================
def ensure_render_target(path: str, size: int):
    """TextureRenderTarget2D size², RG16f, чёрный, clamp, без мипов. Идемпотентно (настройки перезаписываются)."""
    ensure_dir(RT_DIR)
    fac_cls = getattr(unreal, "TextureRenderTargetFactoryNew", None)
    rt = load_or_none(path)
    if rt is None:
        if fac_cls is None:
            warn("TextureRenderTargetFactoryNew недоступен — RT создать нельзя (C++ создаст транзиентный)")
            return None
        try:
            rt = create_or_load(path, unreal.TextureRenderTarget2D, fac_cls())
        except Exception as ex:  # noqa: BLE001
            warn(f"{path}: {ex}")
            return None
    if rt is None:
        warn(f"{path}: не создан")
        return None
    fmt = enum_value("TextureRenderTargetFormat", "RTF_RG16F", "RTF_RGBA16F")
    if fmt is not None:
        set_prop(rt, "render_target_format", fmt)
    set_prop(rt, "size_x", int(size))
    set_prop(rt, "size_y", int(size))
    set_prop(rt, "clear_color", unreal.LinearColor(0.0, 0.0, 0.0, 0.0))
    set_prop(rt, "auto_generate_mips", False)
    clamp = enum_value("TextureAddress", "TA_CLAMP")
    if clamp is not None:
        set_prop(rt, "address_x", clamp)
        set_prop(rt, "address_y", clamp)
    flt = enum_value("TextureFilter", "TF_BILINEAR")
    if flt is not None:
        set_prop(rt, "filter", flt)
    try:
        eal.save_loaded_asset(rt, only_if_is_dirty=False)
    except Exception as ex:  # noqa: BLE001
        warn(f"save {path}: {ex}")
    return rt


# =====================================================================================
# Материалы рисования в RT (Unlit: в Canvas/DrawMaterialToRenderTarget рисуется только Emissive)
# =====================================================================================
def _unlit(path: str, blend: str):
    mat, g = begin_material(path, domain="surface", blend=blend, shading="unlit")
    # Служебные материалы: не участвуют в сцене, не нужны никакие usage-флаги.
    set_first(mat, ["allow_negative_emissive_color"], True)  # копия/штамп пишут «сырые» сантиметры
    return mat, g


def build_stamp():
    """Штамп: Emissive = (StampDepthCm * w.x, StampRimCm * w.y, 0), Additive (суммируется с RT)."""
    mat, g = _unlit(M_STAMP_PATH, "additive")
    uv = g.texcoord(0)
    p_type = g.scalar("StampType", 0.0, "Stamp", 0, 4)
    p_depth = g.scalar("StampDepthCm", 3.0, "Stamp", 0, 400)
    p_rim = g.scalar("StampRimCm", 0.8, "Stamp", 0, 200)
    shape = g.custom("float2 W = RakisTrailStampShape(UV, Type);\nreturn float3(W.x * Depth, W.y * Rim, 0.0);",
                     [("UV", uv), ("Type", p_type), ("Depth", p_depth), ("Rim", p_rim)],
                     "float3", ["SandTrail.ush"], "Trail stamp shape")
    g.out(shape, "Emissive")
    finish_material(mat, g)
    return mat


def build_fade():
    """Затухание: Translucent, цвет 0, Opacity = FadeAlpha → dest = dest * (1 - FadeAlpha)."""
    mat, g = _unlit(M_FADE_PATH, "translucent")
    p_alpha = g.scalar("FadeAlpha", 0.01, "Fade", 0, 1)
    g.out(g.const3(0.0, 0.0, 0.0), "Emissive")
    g.out(p_alpha, "Opacity")
    finish_material(mat, g)
    return mat


def build_copy(default_rt):
    """Копия со сдвигом: Emissive = Source(UV + UVOffset.xy), вне [0,1] — 0. Opaque (перезапись)."""
    mat, g = _unlit(M_COPY_PATH, "opaque")
    uv = g.texcoord(0)
    src = g.texture_object("Source", default_rt, "Copy")
    p_off = g.vector("UVOffset", unreal.LinearColor(0.0, 0.0, 0.0, 0.0), "Copy")
    out = g.custom(
        "float2 S = UV + Offset.xy;\n"
        "float Inside = step(0.0, S.x) * step(0.0, S.y) * step(S.x, 1.0) * step(S.y, 1.0);\n"
        "return Source.SampleLevel(SourceSampler, saturate(S), 0).rgb * Inside;",
        [("UV", uv), ("Offset", p_off), ("Source", src)], "float3", desc="Trail RT scroll copy")
    g.out(out, "Emissive")
    finish_material(mat, g)
    return mat


def build_all() -> dict:
    """Создаёт RT и служебные материалы. Возвращает {'near': rt, 'far': rt, ...}."""
    out = {"near": ensure_render_target(RT_NEAR_PATH, NEAR_RES),
           "far": ensure_render_target(RT_FAR_PATH, FAR_RES)}
    for key, fn in (("stamp", build_stamp), ("fade", build_fade), ("copy", lambda: build_copy(out["near"]))):
        try:
            out[key] = fn()
        except Exception as ex:  # noqa: BLE001
            warn(f"{key}: {ex}")
            out[key] = None
    ok = [k for k, v in out.items() if v is not None]
    log(f"mat_sand_trails: {', '.join(ok)}")
    return out


def main() -> None:
    with unreal.ScopedEditorTransaction("Rakis: sand trails"):
        build_all()
    eal.save_directory(RT_DIR, only_if_is_dirty=True, recursive=True)


if __name__ == "__main__":
    main()
