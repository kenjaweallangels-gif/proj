"""
Общие помощники для редакторных скриптов Rakis (UE 5.6, Python Editor Script Plugin).

Все генераторы (level_*, env_*, mat_*, fx_*, char_*, audio_*, data_*) обязаны:
  * быть идемпотентными — перед созданием удалять своих акторов по тегу `gen:<script>`;
  * работать в сантиметрах;
  * оборачивать изменения в unreal.ScopedEditorTransaction.

Импорт в скриптах:  from rakis_common import *
(Config/DefaultEditor.ini добавляет Tools/unreal_python в sys.path.)
"""
from __future__ import annotations

import os
from typing import Iterable

import unreal

# ---------------------------------------------------------------- пути
PROJECT_DIR = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
DATA_SRC_DIR = os.path.join(PROJECT_DIR, "Content", "Rakis", "Data")  # CSV-исходники
EXPORT_DIR = os.path.join(PROJECT_DIR, "Export")                    # результаты Blender-скриптов

GAME_ROOT = "/Game/Rakis"
MAPS = f"{GAME_ROOT}/Maps"
MAP_PERSISTENT = f"{MAPS}/L_Rakis_Persistent"
MAP_DESERT = f"{MAPS}/L_Rakis_Desert"
MAP_SIETCH = f"{MAPS}/L_Rakis_Sietch"

# ---------------------------------------------------------------- подсистемы
actor_ss = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
level_ss = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
eal = unreal.EditorAssetLibrary


def log(msg: str) -> None:
    unreal.log(f"[Rakis] {msg}")


def warn(msg: str) -> None:
    unreal.log_warning(f"[Rakis] {msg}")


# ---------------------------------------------------------------- ассеты
def ensure_dir(path: str) -> None:
    if not eal.does_directory_exist(path):
        eal.make_directory(path)


def load_or_none(path: str):
    """Загружает ассет, если он есть; иначе None (без ошибок в логе)."""
    return eal.load_asset(path) if eal.does_asset_exist(path) else None


def create_or_load(asset_path: str, asset_class, factory):
    """Идемпотентное создание ассета: существующий возвращается как есть."""
    existing = load_or_none(asset_path)
    if existing:
        return existing
    pkg, name = asset_path.rsplit("/", 1)
    ensure_dir(pkg)
    return asset_tools.create_asset(name, pkg, asset_class, factory)


def save_dir(path: str) -> None:
    eal.save_directory(path, only_if_is_dirty=True, recursive=True)


def rakis_class(name: str):
    """Класс из C++ модуля Rakis по имени без префикса: rakis_class('RakisZoneVolume')."""
    cls = unreal.load_class(None, f"/Script/Rakis.{name}")
    if cls is None:
        warn(f"C++ класс {name} не найден — модуль Rakis не собран? Используется заглушка.")
    return cls


# ---------------------------------------------------------------- уровни
def open_or_create_level(map_path: str) -> None:
    if eal.does_asset_exist(map_path):
        level_ss.load_level(map_path)
    else:
        level_ss.new_level(map_path)


def all_actors() -> list:
    return list(actor_ss.get_all_level_actors())


def actors_with_tag(tag: str) -> list:
    t = unreal.Name(tag)
    return [a for a in all_actors() if t in a.tags]


def delete_generated(gen_tag: str) -> int:
    """Удаляет всех акторов, помеченных тегом gen:<script>. Возвращает количество."""
    victims = actors_with_tag(gen_tag)
    for a in victims:
        actor_ss.destroy_actor(a)
    return len(victims)


def spawn(cls_or_asset, location, rotation=(0, 0, 0), scale=(1, 1, 1),
          label: str | None = None, tags: Iterable[str] = (), folder: str | None = None):
    """Спавн актора класса или ассета (StaticMesh → StaticMeshActor) с тегами и папкой Outliner."""
    loc = unreal.Vector(*location)
    rot = unreal.Rotator(roll=rotation[0], pitch=rotation[1], yaw=rotation[2])
    if isinstance(cls_or_asset, unreal.Object) and not isinstance(cls_or_asset, unreal.Class):
        actor = actor_ss.spawn_actor_from_object(cls_or_asset, loc, rot)
    else:
        actor = actor_ss.spawn_actor_from_class(cls_or_asset, loc, rot)
    if actor is None:
        warn(f"Не удалось заспавнить {cls_or_asset} @ {location}")
        return None
    actor.set_actor_scale3d(unreal.Vector(*scale))
    if label:
        actor.set_actor_label(label)
    if tags:
        actor.tags = list(actor.tags) + [unreal.Name(t) for t in tags]
    if folder:
        actor.set_folder_path(folder)
    return actor


ENGINE_SHAPES = {
    "cube": "/Engine/BasicShapes/Cube.Cube",        # 100 см
    "sphere": "/Engine/BasicShapes/Sphere.Sphere",  # Ø100 см
    "cylinder": "/Engine/BasicShapes/Cylinder.Cylinder",
    "cone": "/Engine/BasicShapes/Cone.Cone",
    "plane": "/Engine/BasicShapes/Plane.Plane",
}


def shape(kind: str, center, size_cm, rotation=(0, 0, 0), material: str | None = None, **kw):
    """Серый примитив блокаута: size_cm=(X,Y,Z) в сантиметрах, center — центр объёма."""
    mesh = eal.load_asset(ENGINE_SHAPES[kind])
    sx, sy, sz = (s / 100.0 for s in size_cm)
    actor = spawn(mesh, center, rotation, (sx, sy, sz), **kw)
    if actor and material:
        mat = load_or_none(material)
        if mat:
            actor.static_mesh_component.set_material(0, mat)
    return actor


def set_prop(obj, name: str, value) -> bool:
    """set_editor_property без падения скрипта, если свойства нет (другая версия C++)."""
    try:
        obj.set_editor_property(name, value)
        return True
    except Exception as e:  # noqa: BLE001
        warn(f"{obj.get_name()}.{name}: {e}")
        return False


def transaction(title: str):
    """with transaction("Rakis: blockout desert"): ...  (обёртка над ScopedEditorTransaction)"""
    return unreal.ScopedEditorTransaction(title)
