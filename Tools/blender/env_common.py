"""
env_common.py — общие помощники Blender-генераторов окружения (environment-artist).

Не генератор: при запуске ничего не создаёт. Используется env_rock.py, env_worm.py, env_sietch_kit.py
(и частично env_dunes.py — только чтение аргументов и раскладки, без bpy).

* parse_args(parser) — аргументы после `--` (blender -b -P script.py -- --out Export/...);
* layout() — модуль Tools/unreal_python/level_layout.py (единые координаты, чистый Python);
* reset_scene(), new_mesh_object(), apply_modifiers(), export_fbx() — только внутри Blender.

Соглашение об осях: модели строятся в метрах в системе UE с переворотом Y
(Blender Y = −UE Y), потому что импорт FBX в UE зеркалит Y. Экспорт: Z вверх, X вперёд
(правило .cursor/rules/30-blender.mdc), apply_scale_options='FBX_SCALE_UNITS' → 1 м = 100 uu.
Проверка ориентации при первом импорте — см. docs/art/environment/rock_and_dunes.md («Проверка осей»).
"""
from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.getcwd(), "Tools", "blender")
PROJECT_DIR = os.path.abspath(os.path.join(HERE, "..", ".."))
UE_PY_DIR = os.path.join(PROJECT_DIR, "Tools", "unreal_python")
EXPORT_DIR = os.path.join(PROJECT_DIR, "Export")


def script_argv() -> list[str]:
    """Аргументы после `--` (Blender) или все аргументы (plain python3)."""
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1:]
    if "bpy" in sys.modules:
        return []
    return sys.argv[1:]


def parse_args(parser: argparse.ArgumentParser):
    return parser.parse_args(script_argv())


def layout():
    """Импорт level_layout (координаты уровня, см, оси UE)."""
    if UE_PY_DIR not in sys.path:
        sys.path.insert(0, UE_PY_DIR)
    import level_layout  # noqa: WPS433
    return level_layout


def out_path(path: str) -> str:
    p = path if os.path.isabs(path) else os.path.join(PROJECT_DIR, path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


# ------------------------------------------------------------------ только Blender
def reset_scene():
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    return scene


def new_mesh_object(name: str, bm=None, verts=None, faces=None, collection=None):
    """Создаёт объект из bmesh (или списков verts/faces) и линкует в сцену."""
    import bpy
    me = bpy.data.meshes.new(name)
    if bm is not None:
        bm.to_mesh(me)
        bm.free()
    else:
        me.from_pydata(verts or [], [], faces or [])
    me.validate(clean_customdata=False)
    me.update()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def select_only(objs):
    import bpy
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def apply_modifiers(ob):
    """Применяет все модификаторы объекта (через evaluated mesh — работает в фоне без контекста UI)."""
    import bpy
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def shade_smooth(ob, angle_deg: float = 40.0):
    import math
    me = ob.data
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    try:  # Blender 4.1+: auto smooth удалён, используем атрибут sharp_edge по углу
        import bpy
        select_only([ob])
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    except Exception:  # noqa: BLE001
        if hasattr(me, "use_auto_smooth"):
            me.use_auto_smooth = True
            me.auto_smooth_angle = math.radians(angle_deg)


def add_material_slot(ob, name: str):
    """Добавляет (или переиспользует) материал-заглушку: имя слота → MI в UE (env_import.py)."""
    import bpy
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    ob.data.materials.append(mat)
    return len(ob.data.materials) - 1


def box_uv(ob, tile_m: float = 2.0):
    """UV блочной проекцией по доминантной оси нормали грани (tile_m метров на 0..1 UV)."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            c = lp.vert.co
            if ax == 2:
                lp[uv].uv = (c.x / tile_m, c.y / tile_m)
            elif ax == 1:
                lp[uv].uv = (c.x / tile_m, c.z / tile_m)
            else:
                lp[uv].uv = (c.y / tile_m, c.z / tile_m)
    bm.to_mesh(ob.data)
    bm.free()


def triangle_count(ob) -> int:
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def export_fbx(path: str, objs, axis_forward: str = "X", axis_up: str = "Z"):
    """FBX для UE: только выбранные объекты, без анимации, сглаживание FACE, единицы FBX_SCALE_UNITS."""
    import bpy
    select_only(objs)
    bpy.ops.export_scene.fbx(
        filepath=out_path(path),
        use_selection=True,
        object_types={"MESH", "EMPTY"},
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_UNITS",
        axis_forward=axis_forward,
        axis_up=axis_up,
        use_mesh_modifiers=True,
        mesh_smooth_type="FACE",
        use_tspace=False,
        add_leaf_bones=False,
        bake_anim=False,
        path_mode="STRIP",
    )
    print(f"[Rakis] FBX → {path}  ({sum(triangle_count(o) for o in objs if o.type == 'MESH')} tris)")


def fbx_axis_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--axis-forward", default="X", help="ось вперёд FBX (по правилу проекта X)")
    parser.add_argument("--axis-up", default="Z", help="ось вверх FBX (по правилу проекта Z)")


if __name__ == "__main__":
    print("env_common: модуль помощников; запускайте env_dunes.py / env_rock.py / env_worm.py / env_sietch_kit.py")
