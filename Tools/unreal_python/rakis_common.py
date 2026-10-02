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

import contextlib
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
# LevelEditorSubsystem (UE 5.6): new_level(asset_path, is_partitioned_world=False) -> bool,
# load_level(asset_path) -> bool, save_current_level() -> bool, save_all_dirty_levels() -> bool,
# set_current_level_by_name(level_name: Name) -> bool.
# load_level/new_level НЕ спрашивают о сохранении — несохранённые правки текущей карты теряются,
# поэтому перед сменой карты сохраняем грязные уровни, если текущая карта — наша (/Game/Rakis/...).
def current_world_package() -> str:
    """Пакет открытой в редакторе карты ('/Game/Rakis/Maps/L_Rakis_Persistent') или ''."""
    try:
        world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
        return str(world.get_path_name()).split(".")[0] if world else ""
    except Exception:  # noqa: BLE001
        return ""


def save_dirty_maps_if_ours() -> None:
    """Сохраняет грязные уровни перед load_level/new_level (только если открыта карта проекта —
    у безымянной Untitled-карты save вызвал бы диалог «Save As»)."""
    if current_world_package().startswith(GAME_ROOT + "/"):
        try:
            level_ss.save_all_dirty_levels()
        except Exception as e:  # noqa: BLE001
            warn(f"save_all_dirty_levels: {e}")


def open_map(map_path: str) -> bool:
    """Открывает карту, если она ещё не открыта (повторная загрузка сбрасывает стриминг/выделение)."""
    if current_world_package() == map_path:
        return True
    save_dirty_maps_if_ours()
    return bool(level_ss.load_level(map_path))


def open_or_create_level(map_path: str) -> None:
    if eal.does_asset_exist(map_path):
        open_map(map_path)
    else:
        save_dirty_maps_if_ours()
        level_ss.new_level(map_path, False)   # не World Partition: стриминг подуровнями (§2.3)


def all_actors() -> list:
    return list(actor_ss.get_all_level_actors())


def actor_tags(actor) -> list:
    """Actor.tags (Array[Name], Read-Write) — читаем через get_editor_property, атрибут — фолбэк."""
    try:
        return list(actor.get_editor_property("tags"))
    except Exception:  # noqa: BLE001
        return list(getattr(actor, "tags", []) or [])


def add_tags(actor, tags: Iterable[str]) -> None:
    """Дописывает теги без дублей. set_editor_property вызывает Modify/PostEditChange (undo, dirty)."""
    cur = actor_tags(actor)
    have = {str(t) for t in cur}
    new = cur + [unreal.Name(t) for t in tags if t not in have]
    try:
        actor.set_editor_property("tags", new)
    except Exception:  # noqa: BLE001
        actor.tags = new


def has_tag(actor, tag: str) -> bool:
    return tag in {str(t) for t in actor_tags(actor)}


def actors_with_tag(tag: str) -> list:
    return [a for a in all_actors() if has_tag(a, tag)]


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
        add_tags(actor, tags)
    if folder:
        actor.set_folder_path(folder)   # Actor.set_folder_path(new_folder_path: Name)
    return actor


def fit_box_volume(actor, size_cm, base_cm: float = 200.0) -> bool:
    """Подгоняет AVolume (Trigger/Blocking/NavMeshBounds/Audio/PCG/ARakisZoneVolume) под размер size_cm=(X,Y,Z).

    В Python UE 5.6 нет API перестроения кисти (BrushBuilder.build не экспонирован, CubeBuilder в Python
    отсутствует). EditorActorSubsystem.spawn_actor_from_class идёт через actor factory; для подклассов AVolume
    это UActorFactoryBoxVolume — кисть-куб 200 см. Размер задаём масштабом, но базу меряем по фактическим
    границам (get_actor_bounds), а не верим 200 см на слово. Возвращает False, если кисти нет."""
    sx, sy, sz = (float(v) for v in size_cm)
    actor.set_actor_scale3d(unreal.Vector(1.0, 1.0, 1.0))
    bx = by = bz = 0.0
    try:
        _origin, ext = actor.get_actor_bounds(False)
        bx, by, bz = ext.x * 2.0, ext.y * 2.0, ext.z * 2.0
    except Exception:  # noqa: BLE001
        pass
    ok = min(bx, by, bz) >= 1.0
    if not ok:
        warn(f"{actor.get_actor_label()}: у объёма нет кисти (bounds={bx:.0f}×{by:.0f}×{bz:.0f}) — "
             f"масштаб от базы {base_cm:.0f} см; если объём не работает: Details ▸ Brush Settings ▸ Box {base_cm:.0f}")
        bx = by = bz = base_cm
    actor.set_actor_scale3d(unreal.Vector(sx / bx, sy / by, sz / bz))
    return ok


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
    """with transaction("Rakis: blockout desert"): ...  (обёртка над ScopedEditorTransaction(desc)).
    ВАЖНО: открывать/создавать карты (load_level/new_level) — ДО транзакции: загрузка карты сбрасывает
    буфер undo (UTransBuffer::Reset → ensure(ActiveCount == 0))."""
    return unreal.ScopedEditorTransaction(title)


# ---------------------------------------------------------------- импорт FBX
FBX_INTERCHANGE_CVAR = "Interchange.FeatureFlags.Import.FBX"


@contextlib.contextmanager
def legacy_fbx_import():
    """В UE 5.5+ FBX по умолчанию импортирует Interchange: опции AssetImportTask.options = FbxImportUI
    (build_nanite, mesh_type_to_import, skeleton, …) и destination_name им не гарантированно учитываются.
    На время импорта выключаем CVar Interchange.FeatureFlags.Import.FBX → классический UFbxFactory,
    затем восстанавливаем прежнее значение. Если CVar нет (другая версия) — ничего не меняется."""
    sl = unreal.SystemLibrary
    prev = False
    try:
        prev = bool(sl.get_console_variable_bool_value(FBX_INTERCHANGE_CVAR))
    except Exception:  # noqa: BLE001
        prev = False
    if prev:
        sl.execute_console_command(None, f"{FBX_INTERCHANGE_CVAR} 0")
    try:
        yield prev
    finally:
        if prev:
            sl.execute_console_command(None, f"{FBX_INTERCHANGE_CVAR} 1")
