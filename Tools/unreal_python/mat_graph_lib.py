"""
mat_graph_lib — общий помощник построения графов материалов для mat_*.py и light_setup.py.

Зачем: unreal.MaterialEditingLibrary низкоуровневая (create_material_expression / connect_*),
имена входов у нод не всегда очевидны ("A"/"B", "Alpha", "Exponent"/"Exp", ""/"Input").
Здесь — тонкая обёртка, которая:
  * никогда не роняет сборку: любая ошибка API → warn() и продолжение;
  * перебирает варианты имён входов, пока connect не вернёт True;
  * умеет подставлять числа вместо нод (const_a / const_b / const_alpha);
  * идемпотентно пересобирает граф: delete_all_material_expressions → новый граф.

Использование:
    from mat_graph_lib import *
    mat, g = begin_material("/Game/Rakis/Materials/Master/M_X", domain="surface")
    c = g.vector("BaseTint", srgb("#C9A878"), group="Color")
    g.out(c, "BaseColor")
    finish_material(mat)

Комментарии — на русском, идентификаторы — на английском (AGENTS.md).
"""
from __future__ import annotations

from typing import Any, Iterable, Sequence

import unreal

from rakis_common import create_or_load, eal, ensure_dir, load_or_none, log, set_prop, warn

MEL = unreal.MaterialEditingLibrary

MAT_ROOT = "/Game/Rakis/Materials"
MASTER_DIR = f"{MAT_ROOT}/Master"
INSTANCE_DIR = f"{MAT_ROOT}/Instances"
FUNCTIONS_DIR = f"{MAT_ROOT}/Functions"
PP_DIR = f"{MAT_ROOT}/PostProcess"
MPC_PATH = f"{FUNCTIONS_DIR}/MPC_RakisWeather"

SHADER_INC = "/Project/Rakis"  # виртуальный путь (FRakisModule::StartupModule)

# Текстуры движка-заглушки для TextureSampleParameter2D (всегда существуют).
ENGINE_TEX = {
    "white": "/Engine/EngineResources/WhiteSquareTexture",
    "black": "/Engine/EngineResources/Black",
    "grey": "/Engine/EngineMaterials/DefaultDiffuse",
    "normal": "/Engine/EngineMaterials/DefaultNormal",
    "orm": "/Engine/EngineMaterials/DefaultWhiteGrid",  # заменяется на T_*_ORM при наличии
}


# ------------------------------------------------------------------ утилиты цвета
def srgb(hex_str: str, a: float = 1.0) -> unreal.LinearColor:
    """'#C9A878' (sRGB) → LinearColor в линейном пространстве (как ждут VectorParameter)."""
    h = hex_str.lstrip("#")
    vals = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]

    def to_lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (to_lin(c) for c in vals)
    return unreal.LinearColor(r, g, b, a)


def lin(r: float, g: float, b: float, a: float = 1.0) -> unreal.LinearColor:
    return unreal.LinearColor(r, g, b, a)


def enum_value(enum_cls_name: str, *candidates: str):
    """Первое существующее значение enum'а: версии UE переименовывают значения."""
    enum_cls = getattr(unreal, enum_cls_name, None)
    if enum_cls is None:
        warn(f"enum {enum_cls_name} не найден")
        return None
    for c in candidates:
        v = getattr(enum_cls, c, None)
        if v is not None:
            return v
    warn(f"{enum_cls_name}: нет ни одного из {candidates}")
    return None


def set_first(obj, names: Sequence[str], value) -> bool:
    """Ставит первое существующее свойство из списка (переименования между версиями UE)."""
    for n in names:
        try:
            obj.set_editor_property(n, value)
            return True
        except Exception:  # noqa: BLE001
            continue
    warn(f"{_name(obj)}: ни одно из свойств {list(names)} не принято")
    return False


def _name(obj) -> str:
    try:
        return obj.get_name()
    except Exception:  # noqa: BLE001
        return str(type(obj).__name__)


# ------------------------------------------------------------------ свойства материала
MATERIAL_PROPERTY = {
    "BaseColor": "MP_BASE_COLOR",
    "Metallic": "MP_METALLIC",
    "Specular": "MP_SPECULAR",
    "Roughness": "MP_ROUGHNESS",
    "Anisotropy": "MP_ANISOTROPY",
    "Emissive": "MP_EMISSIVE_COLOR",
    "Opacity": "MP_OPACITY",
    "OpacityMask": "MP_OPACITY_MASK",
    "Normal": "MP_NORMAL",
    "WPO": "MP_WORLD_POSITION_OFFSET",
    "Subsurface": "MP_SUBSURFACE_COLOR",
    "CustomData0": "MP_CUSTOM_DATA0",
    "CustomData1": "MP_CUSTOM_DATA1",
    "AO": "MP_AMBIENT_OCCLUSION",
    "Refraction": "MP_REFRACTION",
    "PixelDepthOffset": "MP_PIXEL_DEPTH_OFFSET",
    "Displacement": "MP_DISPLACEMENT",
}

Src = Any  # MaterialExpression | (MaterialExpression, "OutputName") | float | tuple чисел


class Graph:
    """Строитель графа одного материала (или функции)."""

    def __init__(self, material: unreal.Material, mpc: unreal.MaterialParameterCollection | None = None):
        self.m = material
        self.mpc = mpc
        self._y = 0
        self._consts: dict = {}
        self._mpc_nodes: dict = {}
        self.errors = 0

    # ---------------------------------------------------------- создание нод
    def node(self, cls_name: str, **props):
        cls = getattr(unreal, cls_name, None)
        if cls is None:
            warn(f"{_name(self.m)}: класс {cls_name} отсутствует в этой версии UE")
            self.errors += 1
            return None
        self._y += 40
        try:
            e = MEL.create_material_expression(self.m, cls, -900, self._y)
        except Exception as ex:  # noqa: BLE001
            warn(f"{_name(self.m)}: create {cls_name}: {ex}")
            self.errors += 1
            return None
        for k, v in props.items():
            if v is not None:
                set_prop(e, k, v)
        return e

    def const(self, v: float):
        key = ("c1", float(v))
        if key not in self._consts:
            self._consts[key] = self.node("MaterialExpressionConstant", r=float(v))
        return self._consts[key]

    def const3(self, r: float, g: float, b: float):
        key = ("c3", r, g, b)
        if key not in self._consts:
            self._consts[key] = self.node("MaterialExpressionConstant3Vector", constant=lin(r, g, b))
        return self._consts[key]

    # ---------------------------------------------------------- параметры
    def scalar(self, name: str, default: float, group: str = "Rakis", lo: float | None = None,
               hi: float | None = None, priority: int = 0):
        e = self.node("MaterialExpressionScalarParameter", parameter_name=name, default_value=float(default),
                      group=group, sort_priority=priority)
        if e is not None and lo is not None and hi is not None:
            set_prop(e, "slider_min", float(lo))
            set_prop(e, "slider_max", float(hi))
        return e

    def vector(self, name: str, default: unreal.LinearColor, group: str = "Rakis", priority: int = 0):
        return self.node("MaterialExpressionVectorParameter", parameter_name=name, default_value=default,
                         group=group, sort_priority=priority)

    def static_switch(self, name: str, default: bool, group: str = "Rakis"):
        return self.node("MaterialExpressionStaticSwitchParameter", parameter_name=name,
                         default_value=bool(default), group=group)

    def texture(self, name: str, tex_path: str, sampler: str = "color", group: str = "Textures", uv: Src = None):
        """TextureSampleParameter2D с движковой заглушкой. sampler: color|normal|linear|masks."""
        tex = load_or_none(tex_path) or load_or_none(ENGINE_TEX["grey"])
        st = {
            "color": "SAMPLERTYPE_COLOR",
            "normal": "SAMPLERTYPE_NORMAL",
            "linear": "SAMPLERTYPE_LINEAR_COLOR",
            "masks": "SAMPLERTYPE_MASKS",
        }[sampler]
        e = self.node("MaterialExpressionTextureSampleParameter2D", parameter_name=name, group=group)
        if e is None:
            return None
        if tex is not None:
            set_prop(e, "texture", tex)
        stv = enum_value("MaterialSamplerType", st)
        if stv is not None:
            set_prop(e, "sampler_type", stv)
        if uv is not None:
            self.connect(uv, e, "UVs")
        return e

    def mpc_param(self, name: str):
        """Нода CollectionParameter для MPC_RakisWeather (кэшируется на граф)."""
        if self.mpc is None:
            warn(f"{_name(self.m)}: MPC не загружен — {name} заменён константой 0")
            return self.const(0.0)
        if name not in self._mpc_nodes:
            e = self.node("MaterialExpressionCollectionParameter")
            if e is not None:
                set_prop(e, "collection", self.mpc)
                set_prop(e, "parameter_name", name)
            self._mpc_nodes[name] = e
        return self._mpc_nodes[name]

    # ---------------------------------------------------------- соединения
    def _src(self, s: Src):
        """Нормализует источник в (expression, output_name)."""
        if isinstance(s, tuple) and len(s) == 2 and isinstance(s[1], str):
            return s[0], s[1]
        if isinstance(s, (int, float)):
            return self.const(float(s)), ""
        if isinstance(s, tuple) and len(s) == 3 and all(isinstance(v, (int, float)) for v in s):
            return self.const3(*s), ""
        return s, ""

    def connect(self, src: Src, dst, inputs: str | Iterable[str]) -> bool:
        if dst is None or src is None:
            self.errors += 1
            return False
        expr, out = self._src(src)
        if expr is None:
            self.errors += 1
            return False
        names = [inputs] if isinstance(inputs, str) else list(inputs)
        # Типичные синонимы имён входов в разных нодах/версиях.
        alias = {"": ["", "Input"], "Input": ["Input", ""], "Exponent": ["Exponent", "Exp"],
                 "True": ["True", "A"], "False": ["False", "B"], "UVs": ["UVs", "Coordinates", "UV"],
                 "Coordinate": ["Coordinate", "Coordinates", "UV"]}
        tried = []
        for n in names:
            for cand in alias.get(n, [n]):
                if cand in tried:
                    continue
                tried.append(cand)
                try:
                    if MEL.connect_material_expressions(expr, out, dst, cand):
                        return True
                except Exception:  # noqa: BLE001
                    pass
        warn(f"{_name(self.m)}: не удалось соединить {_name(expr)}[{out}] → {_name(dst)}{tried}")
        self.errors += 1
        return False

    def out(self, src: Src, prop: str) -> bool:
        expr, outname = self._src(src)
        mp_name = MATERIAL_PROPERTY.get(prop, prop)
        mp = getattr(unreal.MaterialProperty, mp_name, None)
        if mp is None or expr is None:
            warn(f"{_name(self.m)}: выход {prop} недоступен в этой версии UE")
            self.errors += 1
            return False
        try:
            ok = MEL.connect_material_property(expr, outname, mp)
        except Exception as ex:  # noqa: BLE001
            warn(f"{_name(self.m)}: connect_material_property({prop}): {ex}")
            ok = False
        if not ok:
            self.errors += 1
        return bool(ok)

    # ---------------------------------------------------------- математика
    def _bin(self, cls: str, a: Src, b: Src, in_a: str = "A", in_b: str = "B"):
        e = self.node(cls)
        if e is None:
            return None
        # Числа ставим как константы ноды (меньше нод), выражения — соединяем.
        if isinstance(a, (int, float)) and not isinstance(a, bool):
            set_prop(e, "const_a", float(a))
        else:
            self.connect(a, e, in_a)
        if isinstance(b, (int, float)) and not isinstance(b, bool):
            set_prop(e, "const_b", float(b))
        else:
            self.connect(b, e, in_b)
        return e

    def add(self, a, b):
        return self._bin("MaterialExpressionAdd", a, b)

    def sub(self, a, b):
        return self._bin("MaterialExpressionSubtract", a, b)

    def mul(self, a, b):
        return self._bin("MaterialExpressionMultiply", a, b)

    def div(self, a, b):
        return self._bin("MaterialExpressionDivide", a, b)

    def vmin(self, a, b):
        return self._bin("MaterialExpressionMin", a, b)

    def vmax(self, a, b):
        return self._bin("MaterialExpressionMax", a, b)

    def lerp(self, a, b, alpha):
        e = self.node("MaterialExpressionLinearInterpolate")
        if e is None:
            return None
        for val, pin, const in ((a, "A", "const_a"), (b, "B", "const_b"), (alpha, "Alpha", "const_alpha")):
            if isinstance(val, (int, float)) and not isinstance(val, bool):
                set_prop(e, const, float(val))
            else:
                self.connect(val, e, pin)
        return e

    def unary(self, cls: str, a):
        e = self.node(cls)
        if e is not None:
            self.connect(a, e, "")
        return e

    def saturate(self, a):
        return self.unary("MaterialExpressionSaturate", a)

    def one_minus(self, a):
        return self.unary("MaterialExpressionOneMinus", a)

    def sine(self, a):
        return self.unary("MaterialExpressionSine", a)

    def normalize(self, a):
        return self.unary("MaterialExpressionNormalize", a)

    def frac(self, a):
        return self.unary("MaterialExpressionFrac", a)

    def absv(self, a):
        return self.unary("MaterialExpressionAbs", a)

    def power(self, base, exp):
        e = self.node("MaterialExpressionPower")
        if e is None:
            return None
        self.connect(base, e, "Base")
        if isinstance(exp, (int, float)):
            set_prop(e, "const_exponent", float(exp))
        else:
            self.connect(exp, e, "Exponent")
        return e

    def dot(self, a, b):
        return self._bin("MaterialExpressionDotProduct", a, b)

    def mask(self, a, r=False, g=False, b=False, al=False):
        e = self.node("MaterialExpressionComponentMask", r=r, g=g, b=b, a=al)
        if e is not None:
            self.connect(a, e, "")
        return e

    def append(self, a, b):
        return self._bin("MaterialExpressionAppendVector", a, b)

    def append4(self, x, y, z, w):
        return self.append(self.append(self.append(x, y), z), w)

    def desaturate(self, a, fraction):
        e = self.node("MaterialExpressionDesaturation")
        if e is None:
            return None
        self.connect(a, e, "")
        self.connect(fraction, e, "Fraction")
        return e

    def switch(self, param_name: str, default: bool, when_true, when_false, group: str = "Rakis"):
        sw = self.static_switch(param_name, default, group)
        if sw is not None:
            self.connect(when_true, sw, "True")
            self.connect(when_false, sw, "False")
        return sw

    def fresnel(self, exponent: float = 5.0, base_reflect: float = 0.04):
        return self.node("MaterialExpressionFresnel", exponent=exponent, base_reflect_fraction=base_reflect)

    # ---------------------------------------------------------- координаты
    def world_pos(self, camera_relative: bool = False):
        e = self.node("MaterialExpressionWorldPosition")
        if e is not None and camera_relative:
            v = enum_value("WorldPositionIncludedOffsets", "WPT_CAMERA_RELATIVE_WORLD_POSITION")
            if v is not None:
                set_prop(e, "world_position_shader_offset", v)
        return e

    def texcoord(self, index: int = 0, u: float = 1.0, v: float = 1.0):
        return self.node("MaterialExpressionTextureCoordinate", coordinate_index=index, u_tiling=u, v_tiling=v)

    def time(self):
        return self.node("MaterialExpressionTime")

    # ---------------------------------------------------------- HLSL
    def custom(self, code: str, inputs: Sequence[tuple[str, Src]], out_type: str = "float1",
               includes: Sequence[str] = (), desc: str = "Rakis Custom"):
        """Custom-нода. inputs: [(имя_переменной, источник), ...]. out_type: float1..float4."""
        e = self.node("MaterialExpressionCustom", code=code, description=desc)
        if e is None:
            return None
        ot = enum_value("CustomMaterialOutputType", {
            "float1": "CMOT_FLOAT1", "float2": "CMOT_FLOAT2", "float3": "CMOT_FLOAT3", "float4": "CMOT_FLOAT4",
        }[out_type])
        if ot is not None:
            set_prop(e, "output_type", ot)
        if includes:
            # Свойство "Include File Paths" — обязательно, иначе #include в Code не найдётся.
            set_first(e, ["include_file_paths"], [f"{SHADER_INC}/{i}" if not i.startswith("/") else i
                                                  for i in includes])
        cin = []
        for name, _ in inputs:
            ci = unreal.CustomInput()
            ci.set_editor_property("input_name", name)
            cin.append(ci)
        set_prop(e, "inputs", cin)
        for name, src in inputs:
            self.connect(src, e, name)
        return e

    def function_call(self, fn_path: str):
        fn = load_or_none(fn_path)
        if fn is None:
            warn(f"Материальная функция {fn_path} не найдена")
            return None
        e = self.node("MaterialExpressionMaterialFunctionCall")
        if e is not None:
            try:
                e.set_editor_property("material_function", fn)
            except Exception as ex:  # noqa: BLE001
                warn(f"MaterialFunctionCall({fn_path}): {ex}")
        return e


# ------------------------------------------------------------------ жизненный цикл материала
def load_mpc():
    mpc = load_or_none(MPC_PATH)
    if mpc is None:
        warn("MPC_RakisWeather отсутствует — сначала mat_master_materials.build_mpc()")
    return mpc


def begin_material(path: str, domain: str = "surface", blend: str = "opaque",
                   shading: str = "default", two_sided: bool = False) -> tuple[unreal.Material, Graph]:
    """Создаёт или очищает материал и возвращает (material, Graph). Ассет-ссылки сохраняются."""
    mat = create_or_load(path, unreal.Material, unreal.MaterialFactoryNew())
    if mat is None:
        raise RuntimeError(f"Не удалось создать {path}")
    try:
        MEL.delete_all_material_expressions(mat)
    except Exception as ex:  # noqa: BLE001
        warn(f"{path}: очистка графа: {ex}")

    dom = {
        "surface": ("MD_SURFACE",),
        "decal": ("MD_DEFERRED_DECAL",),
        "pp": ("MD_POST_PROCESS",),
        "light_function": ("MD_LIGHT_FUNCTION",),
        "volume": ("MD_VOLUME",),
    }[domain]
    v = enum_value("MaterialDomain", *dom)
    if v is not None:
        set_prop(mat, "material_domain", v)

    bm = enum_value("BlendMode", {"opaque": "BLEND_OPAQUE", "masked": "BLEND_MASKED",
                                  "translucent": "BLEND_TRANSLUCENT", "additive": "BLEND_ADDITIVE"}[blend])
    if bm is not None:
        set_prop(mat, "blend_mode", bm)

    if domain == "surface":
        sm = enum_value("MaterialShadingModel", {
            "default": "MSM_DEFAULT_LIT", "unlit": "MSM_UNLIT", "subsurface": "MSM_SUBSURFACE",
            "cloth": "MSM_CLOTH", "preintegrated": "MSM_PREINTEGRATED_SKIN",
        }[shading])
        if sm is not None:
            set_prop(mat, "shading_model", sm)
        set_prop(mat, "two_sided", two_sided)
    return mat, Graph(mat, load_or_none(MPC_PATH))


def set_usage(mat: unreal.Material, *flags: str) -> None:
    """Флаги использования: nanite, skeletal, ism, spline, niagara_sprites, niagara_mesh, static_lighting."""
    names = {
        "nanite": "used_with_nanite",
        "skeletal": "used_with_skeletal_mesh",
        "ism": "used_with_instanced_static_meshes",
        "spline": "used_with_spline_meshes",
        "niagara_sprites": "used_with_niagara_sprites",
        "niagara_mesh": "used_with_niagara_mesh_particles",
        "niagara_ribbons": "used_with_niagara_ribbons",
        "geometry_cache": "used_with_geometry_cache",
    }
    for f in flags:
        set_prop(mat, names[f], True)


def finish_material(mat: unreal.Material, g: Graph | None = None) -> None:
    try:
        MEL.layout_material_expressions(mat)
    except Exception as ex:  # noqa: BLE001
        warn(f"layout: {ex}")
    try:
        MEL.recompile_material(mat)
    except Exception as ex:  # noqa: BLE001
        warn(f"recompile {_name(mat)}: {ex}")
    try:
        eal.save_loaded_asset(mat, only_if_is_dirty=False)
    except Exception as ex:  # noqa: BLE001
        warn(f"save {_name(mat)}: {ex}")
    errs = g.errors if g else 0
    log(f"Материал {_name(mat)} собран" + (f" (предупреждений графа: {errs})" if errs else ""))


# ------------------------------------------------------------------ инстансы
def make_instance(path: str, parent, scalars: dict | None = None, vectors: dict | None = None,
                  textures: dict | None = None, switches: dict | None = None):
    """Создаёт/обновляет MaterialInstanceConstant. Значения перезаписываются при каждом запуске."""
    if parent is None:
        warn(f"{path}: нет родителя — пропуск")
        return None
    factory = unreal.MaterialInstanceConstantFactoryNew()
    set_prop(factory, "initial_parent", parent)
    mi = create_or_load(path, unreal.MaterialInstanceConstant, factory)
    if mi is None:
        warn(f"{path}: не создан")
        return None
    try:
        MEL.set_material_instance_parent(mi, parent)
    except Exception as ex:  # noqa: BLE001
        warn(f"{path}: set parent: {ex}")
    try:
        MEL.clear_all_material_instance_parameters(mi)
    except Exception:  # noqa: BLE001
        pass  # старые версии API — не критично
    for k, v in (scalars or {}).items():
        try:
            MEL.set_material_instance_scalar_parameter_value(mi, k, float(v))
        except Exception as ex:  # noqa: BLE001
            warn(f"{path}.{k}: {ex}")
    for k, v in (vectors or {}).items():
        try:
            MEL.set_material_instance_vector_parameter_value(mi, k, v)
        except Exception as ex:  # noqa: BLE001
            warn(f"{path}.{k}: {ex}")
    for k, v in (textures or {}).items():
        tex = load_or_none(v) if isinstance(v, str) else v
        if tex is None:
            continue
        try:
            MEL.set_material_instance_texture_parameter_value(mi, k, tex)
        except Exception as ex:  # noqa: BLE001
            warn(f"{path}.{k}: {ex}")
    for k, v in (switches or {}).items():
        fn = getattr(MEL, "set_material_instance_static_switch_parameter_value", None)
        if fn is None:
            warn(f"{path}: API static switch недоступен — выставьте {k}={v} вручную")
            continue
        try:
            fn(mi, k, bool(v))
        except Exception as ex:  # noqa: BLE001
            warn(f"{path}.{k}: {ex}")
    try:
        MEL.update_material_instance(mi)
    except Exception:  # noqa: BLE001
        pass
    try:
        eal.save_loaded_asset(mi, only_if_is_dirty=False)
    except Exception as ex:  # noqa: BLE001
        warn(f"save {path}: {ex}")
    return mi


def find_texture(*names: str, roots: Sequence[str] = ("/Game/Rakis", "/Game/Megascans", "/Game/Fab",
                                                       "/Game/Quixel")) -> str | None:
    """Ищет текстуру по имени ассета (например, T_Sand_BC) в типичных папках импорта Megascans/Fab."""
    reg = unreal.AssetRegistryHelpers.get_asset_registry()
    for root in roots:
        if not eal.does_directory_exist(root):
            continue
        try:
            assets = reg.get_assets_by_path(root, recursive=True)
        except Exception:  # noqa: BLE001
            continue
        by_name = {}
        for ad in assets:
            try:
                by_name[str(ad.asset_name)] = str(ad.package_name)
            except Exception:  # noqa: BLE001
                continue
        for n in names:
            if n in by_name:
                return by_name[n]
    return None


__all__ = [
    "MEL", "MAT_ROOT", "MASTER_DIR", "INSTANCE_DIR", "FUNCTIONS_DIR", "PP_DIR", "MPC_PATH", "ENGINE_TEX",
    "srgb", "lin", "enum_value", "set_first", "Graph", "load_mpc", "begin_material", "set_usage",
    "finish_material", "make_instance", "find_texture", "ensure_dir",
]
