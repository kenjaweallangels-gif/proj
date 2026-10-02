"""
env_import.py — импорт результатов Blender-генераторов окружения в UE 5.6 (шаг 3 build_demo, §2.7).

Что делает (всё идемпотентно, при отсутствии файлов — пропускает с предупреждением):
  1. FBX из Export/ → пути контракта §2.5, Nanite включён, коллизия «complex as simple» для окружения:
       Export/SM_Rock_ShaitanClaw.fbx, SM_Rock_FalseSlab.fbx → /Game/Rakis/Environment/Rock/
       Export/SM_Worm_Segment|Head|MouthPetal|Teeth.fbx    → /Game/Rakis/Worm/
       Export/sietch/SM_Sietch_*.fbx                        → /Game/Rakis/Environment/Sietch/
  2. Назначает MI по имени слота (слот = имя MI из Blender) с цепочкой фолбэков.
  3. Ландшафт: если в L_Rakis_Desert уже есть Landscape — назначает материал и проверяет трансформ
     по Export/heightmap_desert.json. Создать Landscape из PNG через Python в UE 5.6 нельзя
     (нет API импорта heightmap) → лог с ручными шагами (docs/level/layout.md §11) и фолбэк:
     плиты-земля + блокаут-дюны, расставленные по гребням той же процедурной функции env_dunes.py.
Запуск: из build_demo.py или Tools ▸ Execute Python Script.
"""
from __future__ import annotations

import glob
import json
import os

import unreal

from rakis_common import (EXPORT_DIR, MAP_DESERT, delete_generated, eal, ensure_dir, load_or_none, log,
                          set_prop, transaction, warn)
import level_common as LC

GEN = "gen:env_import"
MI_DIR = "/Game/Rakis/Materials/Instances"

IMPORTS = [
    # (glob относительно Export/, папка назначения, nanite, коллизия complex-as-simple)
    ("SM_Rock_ShaitanClaw.fbx", "/Game/Rakis/Environment/Rock", True, True),
    ("SM_Rock_FalseSlab.fbx", "/Game/Rakis/Environment/Rock", True, True),
    ("SM_Worm_Segment.fbx", "/Game/Rakis/Worm", True, False),
    ("SM_Worm_Head.fbx", "/Game/Rakis/Worm", True, False),
    ("SM_Worm_MouthPetal.fbx", "/Game/Rakis/Worm", True, False),
    ("SM_Worm_Teeth.fbx", "/Game/Rakis/Worm", True, False),
    ("sietch/SM_Sietch_*.fbx", "/Game/Rakis/Environment/Sietch", True, True),
]
# Nanite не поддерживает полупрозрачность — эти модули остаются классическими мешами
NO_NANITE = {"SM_Sietch_Glowglobe", "SM_Sietch_WaterJar_A", "SM_Sietch_WaterJar_B"}

MI_FALLBACKS = {
    "MI_Rock_Claw": ["MI_Rock_Claw", "MI_Rock_ShaitanClaw", "MI_Rock_Master", "MI_Blockout_Rock"],
    "MI_Rock_Talus": ["MI_Rock_Talus", "MI_Rock_Claw", "MI_Blockout_Rock"],
    "MI_Worm_Chitin": ["MI_Worm_Chitin"],
    "MI_Worm_Flesh": ["MI_Worm_Flesh", "MI_Worm_Chitin"],
    "MI_Worm_Throat": ["MI_Worm_Throat", "MI_Worm_Flesh", "MI_Worm_Chitin"],
    "MI_Worm_Teeth": ["MI_Worm_Teeth"],
    "MI_Sietch_Stone": ["MI_Sietch_Stone", "MI_Blockout_Stone"],
    "MI_Sietch_StonePolished": ["MI_Sietch_StonePolished", "MI_Sietch_Stone", "MI_Blockout_Stone"],
    "MI_Metal_Old": ["MI_Metal_Old", "MI_Sietch_Metal", "MI_Blockout_Stone"],
    "MI_Cloth_Worn": ["MI_Cloth_Worn", "MI_Spice_Fabric", "MI_Blockout_Stone"],
    "MI_Glowglobe": ["MI_Glowglobe"],
    "MI_Sietch_Clay": ["MI_Sietch_Clay", "MI_Sietch_Stone", "MI_Blockout_Stone"],
    "MI_Sietch_Fiber": ["MI_Sietch_Fiber", "MI_Cloth_Worn", "MI_Blockout_Stone"],
    "MI_Water_Still": ["MI_Water_Still"],
}
MASTER_FALLBACK = {   # если инстансов нет — мастер-материал контракта
    "MI_Rock": "/Game/Rakis/Materials/Master/M_Rock_Master",
    "MI_Worm_Teeth": "/Game/Rakis/Materials/Master/M_Worm_Teeth",
    "MI_Worm": "/Game/Rakis/Materials/Master/M_Worm_Chitin",
    "MI_Glowglobe": "/Game/Rakis/Materials/Master/M_Glowglobe",
    "MI_Water": "/Game/Rakis/Materials/Master/M_Water_Still",
    "MI_Cloth": "/Game/Rakis/Materials/Master/M_Cloth_Worn",
    "MI_Sietch": "/Game/Rakis/Materials/Master/M_Sietch_Stone",
    "MI_Metal": "/Game/Rakis/Materials/Master/M_Sietch_Stone",
}
LANDSCAPE_MATERIALS = [f"{MI_DIR}/MI_Landscape_Sand", f"{MI_DIR}/MI_Sand_Erg_Dry",
                       "/Game/Rakis/Materials/Master/M_Landscape_Sand"]


# ------------------------------------------------------------------ FBX
def _fbx_options(nanite: bool):
    ui = unreal.FbxImportUI()
    ui.set_editor_property("import_mesh", True)
    ui.set_editor_property("import_as_skeletal", False)
    ui.set_editor_property("import_materials", False)
    ui.set_editor_property("import_textures", False)
    ui.set_editor_property("import_animations", False)
    try:
        ui.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_STATIC_MESH)
    except Exception as e:  # noqa: BLE001
        warn(f"FbxImportUI.mesh_type_to_import: {e}")
    sm = ui.get_editor_property("static_mesh_import_data")
    for prop, val in (("combine_meshes", True), ("generate_lightmap_u_vs", False),
                      ("auto_generate_collision", False), ("import_uniform_scale", 1.0),
                      ("convert_scene", True), ("force_front_x_axis", False),
                      ("remove_degenerates", True), ("build_nanite", nanite)):
        set_prop(sm, prop, val)
    return ui


def import_fbx(path: str, dest: str, nanite: bool):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", path)
    task.set_editor_property("destination_path", dest)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", False)
    task.set_editor_property("options", _fbx_options(nanite))
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    out = []
    for p in task.get_editor_property("imported_object_paths") or []:
        a = eal.load_asset(p)
        if isinstance(a, unreal.StaticMesh):
            out.append(a)
    if not out:  # Interchange иногда не заполняет imported_object_paths
        name = os.path.splitext(os.path.basename(path))[0]
        a = load_or_none(f"{dest}/{name}")
        if a:
            out.append(a)
    return out


def _resolve_material(slot_name: str):
    base = slot_name.split(".")[0]
    for key, chain in MI_FALLBACKS.items():
        if base.startswith(key):
            for mi in chain:
                m = load_or_none(f"{MI_DIR}/{mi}")
                if m:
                    return m
    for prefix, master in MASTER_FALLBACK.items():
        if base.startswith(prefix):
            m = load_or_none(master)
            if m:
                return m
    return None


def postprocess_mesh(mesh, nanite: bool, complex_collision: bool) -> None:
    name = mesh.get_name()
    # Nanite
    try:
        ns = mesh.get_editor_property("nanite_settings")
        ns.set_editor_property("enabled", bool(nanite and name not in NO_NANITE))
        mesh.set_editor_property("nanite_settings", ns)
    except Exception as e:  # noqa: BLE001
        warn(f"{name}: nanite_settings — {e}")
    # материалы по именам слотов
    try:
        slots = list(mesh.get_editor_property("static_materials"))
        for i, sm in enumerate(slots):
            slot = str(sm.get_editor_property("material_slot_name"))
            mat = _resolve_material(slot)
            if mat:
                mesh.set_material(i, mat)
            else:
                warn(f"{name}: нет MI для слота «{slot}» (создаст tech-artist: mat_master_materials.py)")
    except Exception as e:  # noqa: BLE001
        warn(f"{name}: назначение материалов — {e}")
    # коллизия
    if complex_collision:
        try:
            bs = mesh.get_editor_property("body_setup")
            if bs:
                bs.set_editor_property("collision_trace_flag", unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE)
        except Exception as e:  # noqa: BLE001
            warn(f"{name}: collision_trace_flag — {e}")
    try:
        eal.save_loaded_asset(mesh, only_if_is_dirty=False)
    except Exception as e:  # noqa: BLE001
        warn(f"{name}: save — {e}")


def import_meshes() -> int:
    count = 0
    if not os.path.isdir(EXPORT_DIR):
        warn(f"нет {EXPORT_DIR} — запустите Blender-генераторы (Tools/blender/env_*.py)")
        return 0
    for pattern, dest, nanite, coll in IMPORTS:
        files = sorted(glob.glob(os.path.join(EXPORT_DIR, pattern)))
        if not files:
            warn(f"Export/{pattern} не найден — пропуск (блокаут использует примитивы)")
            continue
        ensure_dir(dest)
        for f in files:
            try:
                meshes = import_fbx(f, dest, nanite)
                for m in meshes:
                    postprocess_mesh(m, nanite, coll)
                    count += 1
                log(f"импорт {os.path.basename(f)} → {dest} ({len(meshes)})")
            except Exception as e:  # noqa: BLE001
                warn(f"импорт {f}: {e}")
    return count


# ------------------------------------------------------------------ ландшафт
def find_landscape():
    for a in unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors():
        if isinstance(a, unreal.LandscapeProxy):
            return a
    return None


def read_heightmap_meta():
    path = os.path.join(EXPORT_DIR, "heightmap_desert.json")
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def manual_landscape_steps(meta) -> str:
    if not meta:
        return ("Нет Export/heightmap_desert.json — запустите: python3 Tools/blender/env_dunes.py "
                "(или blender -b -P Tools/blender/env_dunes.py), затем повторите env_import.py.")
    ls = meta["landscape"]
    return (
        "РУЧНОЙ ШАГ (UE 5.6 не импортирует heightmap из Python): уровень L_Rakis_Desert текущий → "
        "Landscape Mode ▸ Manage ▸ New ▸ Import from File: "
        f"{meta['file']} | Section Size {ls.get('quads_per_section', 63)}×{ls.get('quads_per_section', 63)} quads, "
        f"Sections/Component {ls.get('sections_per_component', 2)}×{ls.get('sections_per_component', 2)}, "
        f"Components {ls.get('components', '?')} | Location {ls['location_cm']} | Scale {ls['scale']} | "
        "Material MI_Landscape_Sand → Import. Затем снова env_import.py (уберёт фолбэк-землю, назначит материал), "
        "Landscape ▸ Add Tag gen:manual_landscape не нужен — скрипт находит Landscape сам.")


def setup_landscape(meta) -> bool:
    land = find_landscape()
    if land is None:
        return False
    mat = LC.try_load(*LANDSCAPE_MATERIALS)
    if mat:
        set_prop(land, "landscape_material", mat)
    if meta:
        want = meta["landscape"]["location_cm"]
        loc = land.get_actor_location()
        if abs(loc.x - want[0]) > 1 or abs(loc.y - want[1]) > 1 or abs(loc.z - want[2]) > 1:
            warn(f"Landscape location {loc} ≠ {want} из heightmap_desert.json — координаты layout.md не совпадут")
        sc = land.get_actor_scale3d()
        ws = meta["landscape"]["scale"]
        if abs(sc.x - ws[0]) > 0.01 or abs(sc.z - ws[2]) > 0.01:
            warn(f"Landscape scale {sc} ≠ {ws}")
    log(f"Landscape найден: {land.get_actor_label()} — материал назначен")
    return True


def main():
    with transaction("Rakis: env_import"):
        n = import_meshes()
        log(f"импортировано мешей: {n}")
        LC.ensure_persistent_with_sublevels()
        LC.make_current(MAP_DESERT)
        removed = delete_generated(GEN)
        if removed:
            log(f"удалено {removed} акторов {GEN}")
        meta = read_heightmap_meta()
        if not setup_landscape(meta):
            warn(manual_landscape_steps(meta))
            n_ground = LC.build_fallback_ground([GEN, "blockout:ground"])
            n_dunes = LC.build_fallback_dunes([GEN, "blockout:A2"])
            log(f"фолбэк-земля: {n_ground} плит, дюн: {n_dunes}")
        LC.save_all()


if __name__ == "__main__":
    main()
