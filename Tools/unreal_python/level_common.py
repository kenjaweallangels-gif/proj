"""
level_common.py — общие помощники level-designer/environment-artist для редактора UE 5.6.

Не генератор: при запуске как скрипта ничего не создаёт. Используется скриптами
level_blockout_desert.py, level_blockout_sietch.py, level_markup.py, env_import.py,
env_scatter_desert.py, env_dress_sietch.py.

Что здесь:
  * ensure_persistent_with_sublevels() — L_Rakis_Persistent + подуровни Desert/Sietch (LevelStreamingDynamic);
  * make_current(name) — сделать уровень текущим для спавна;
  * box()/slab() — прямоугольный примитив по min/max (см), с тегами gen:/blockout:;
  * ground_z(x, y) — трасса вниз по ландшафту/блокауту (иначе расчётная высота из level_layout);
  * marker() — TargetPoint с тегами; set_enum() — значения UENUM по имени с фолбэками.
"""
from __future__ import annotations

import math

import unreal

from rakis_common import (MAP_DESERT, MAP_PERSISTENT, MAP_SIETCH, actor_ss, eal, level_ss, load_or_none,
                          log, set_prop, shape, spawn, warn)

MI_SAND = "/Game/Rakis/Materials/Instances/MI_Blockout_Sand"
MI_ROCK = "/Game/Rakis/Materials/Instances/MI_Blockout_Rock"
MI_STONE = "/Game/Rakis/Materials/Instances/MI_Blockout_Stone"

LEVEL_NAMES = {
    MAP_PERSISTENT: "L_Rakis_Persistent",
    MAP_DESERT: "L_Rakis_Desert",
    MAP_SIETCH: "L_Rakis_Sietch",
}

# начальная загрузка подуровней: Desert грузится сразу, Sietch — по ZoneVolume A3/A4
INITIAL_STATE = {
    MAP_DESERT: (True, True),     # (initially_loaded, initially_visible)
    MAP_SIETCH: (False, False),
}


# ---------------------------------------------------------------- мир/уровни
def editor_world():
    try:
        return unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    except Exception:  # noqa: BLE001
        return unreal.EditorLevelLibrary.get_editor_world()


def _save_current() -> None:
    try:
        level_ss.save_current_level()
    except Exception as e:  # noqa: BLE001
        warn(f"save_current_level: {e}")


def _create_empty_level(map_path: str) -> None:
    """Создаёт пустой (не World Partition) уровень и сохраняет его."""
    try:
        level_ss.new_level(map_path, False)          # UE 5.1+: (asset_path, is_partitioned_world)
    except TypeError:
        level_ss.new_level(map_path)
    _save_current()
    log(f"создан уровень {map_path}")


def streaming_levels(world=None) -> list:
    world = world or editor_world()
    try:
        return list(world.get_editor_property("streaming_levels"))
    except Exception:  # noqa: BLE001
        return []


def _streaming_package(ls) -> str:
    try:
        return str(ls.get_editor_property("world_asset").get_path_name()).split(".")[0]
    except Exception:  # noqa: BLE001
        try:
            return str(ls.get_world_asset_package_name())
        except Exception:  # noqa: BLE001
            return ""


def _find_streaming(world, map_path: str):
    """LevelStreaming подуровня или None (UGameplayStatics::GetStreamingLevel, длинное и короткое имя)."""
    for name in (map_path, map_path.rsplit("/", 1)[-1]):
        try:
            ls = unreal.GameplayStatics.get_streaming_level(world, name)
            if ls:
                return ls
        except Exception:  # noqa: BLE001
            pass
    return None


def ensure_persistent_with_sublevels(sublevels=(MAP_DESERT, MAP_SIETCH)) -> None:
    """Гарантирует существование Persistent и подуровней, открывает Persistent и добавляет стриминг."""
    for sub in sublevels:
        if not eal.does_asset_exist(sub):
            _create_empty_level(sub)
    if eal.does_asset_exist(MAP_PERSISTENT):
        level_ss.load_level(MAP_PERSISTENT)
    else:
        _create_empty_level(MAP_PERSISTENT)
    world = editor_world()
    present = {_streaming_package(ls) for ls in streaming_levels(world)}
    for sub in sublevels:
        if sub in present or _find_streaming(world, sub) is not None:
            continue
        try:
            ls = unreal.EditorLevelUtils.add_level_to_world(world, sub, unreal.LevelStreamingDynamic)
            if ls:
                loaded, visible = INITIAL_STATE.get(sub, (True, True))
                set_prop(ls, "initially_loaded", loaded)
                set_prop(ls, "initially_visible", visible)
                log(f"подуровень {sub} добавлен в {MAP_PERSISTENT}")
        except Exception as e:  # noqa: BLE001
            warn(f"add_level_to_world({sub}): {e} — добавьте подуровень вручную (Window ▸ Levels)")
    _save_current()


def make_current(map_path: str) -> bool:
    """Делает уровень текущим (спавн идёт в него)."""
    name = LEVEL_NAMES.get(map_path, map_path.rsplit("/", 1)[-1])
    try:
        if level_ss.set_current_level_by_name(name):
            return True
    except Exception as e:  # noqa: BLE001
        warn(f"set_current_level_by_name({name}): {e}")
    try:  # фолбэк: найти ULevel по имени пакета
        for lvl in unreal.EditorLevelUtils.get_levels(editor_world()):
            if name in lvl.get_path_name():
                unreal.EditorLevelUtils.make_level_current(lvl)
                return True
    except Exception as e:  # noqa: BLE001
        warn(f"make_level_current({name}): {e}")
    warn(f"не удалось сделать текущим {name} — акторы попадут в текущий уровень")
    return False


def save_all() -> None:
    try:
        level_ss.save_all_dirty_levels()
    except Exception as e:  # noqa: BLE001
        warn(f"save_all_dirty_levels: {e}")


def actors_in_level_with_tag(tag: str) -> list:
    t = unreal.Name(tag)
    return [a for a in actor_ss.get_all_level_actors() if t in a.tags]


# ---------------------------------------------------------------- примитивы
def box(x0, x1, y0, y1, z0, z1, tags, label=None, material=MI_STONE, folder=None, yaw=0.0):
    """Куб по AABB (см). Возвращает актор или None, если объём вырожден."""
    if x1 - x0 < 1 or y1 - y0 < 1 or z1 - z0 < 1:
        return None
    c = ((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5)
    return shape("cube", c, (x1 - x0, y1 - y0, z1 - z0), rotation=(0, 0, yaw), material=material,
                 label=label, tags=tags, folder=folder)


def obox(cx, cy, cz, sx, sy, sz, yaw, tags, label=None, material=MI_STONE, folder=None, pitch=0.0, roll=0.0):
    """Ориентированный куб: центр, размеры, yaw/pitch/roll (градусы)."""
    return shape("cube", (cx, cy, cz), (sx, sy, sz), rotation=(roll, pitch, yaw), material=material,
                 label=label, tags=tags, folder=folder)


def stairs(x0, x1, y0, y1, z0, z1, tags, step_rise=20.0, material=MI_STONE, folder=None, label="Stairs"):
    """Лестница вдоль X: от (x0, z0) к (x1, z1). Ступени — сплошные блоки до min(z0, z1)."""
    drop = z1 - z0
    n = max(1, int(abs(drop) / step_rise + 0.5))
    run = (x1 - x0) / n
    base = min(z0, z1) - 50.0
    out = []
    for i in range(n):
        top = z0 + drop * (i + 1) / n if drop > 0 else z0 + drop * i / n
        a = box(x0 + run * i, x0 + run * (i + 1), y0, y1, base, top, tags, f"{label}_{i:02d}", material, folder)
        out.append(a)
    return out


def subtract_rect(r, hole):
    """Прямоугольник r=(x0,x1,y0,y1) минус hole → список прямоугольников."""
    x0, x1, y0, y1 = r
    hx0, hx1, hy0, hy1 = hole
    if hx1 <= x0 or hx0 >= x1 or hy1 <= y0 or hy0 >= y1:
        return [r]
    out = []
    if hy0 > y0:
        out.append((x0, x1, y0, hy0))
    if hy1 < y1:
        out.append((x0, x1, hy1, y1))
    my0, my1 = max(y0, hy0), min(y1, hy1)
    if hx0 > x0:
        out.append((x0, hx0, my0, my1))
    if hx1 < x1:
        out.append((hx1, x1, my0, my1))
    return out


# ---------------------------------------------------------------- маркеры
def marker(location, tags, label=None, yaw=0.0, folder=None, cls=None):
    """TargetPoint (или указанный класс) с тегами; ориентация yaw — «куда смотреть/использовать»."""
    return spawn(cls or unreal.TargetPoint, location, (0, 0, yaw), label=label, tags=tags, folder=folder)


def enum_value(enum_name: str, value_name: str):
    """unreal.<EnumName>.<VALUE>: пробует UPPER_SNAKE и исходное имя. None, если нет."""
    enum_cls = getattr(unreal, enum_name, None)
    if enum_cls is None:
        warn(f"enum {enum_name} недоступен в Python (модуль Rakis не собран?)")
        return None
    snake = []
    for i, ch in enumerate(value_name):
        if ch.isupper() and i > 0 and value_name[i - 1].islower():
            snake.append("_")
        snake.append(ch)
    candidates = ["".join(snake).upper(), value_name.upper(), value_name]
    for c in candidates:
        v = getattr(enum_cls, c, None)
        if v is not None:
            return v
    warn(f"{enum_name}.{value_name} не найден (пробовали {candidates})")
    return None


# ---------------------------------------------------------------- высота земли
def _hit_location(hit):
    try:
        return hit.get_editor_property("impact_point")
    except Exception:  # noqa: BLE001
        pass
    try:
        for v in hit.to_tuple():
            if isinstance(v, unreal.Vector):
                return v
    except Exception:  # noqa: BLE001
        pass
    return None


def ground_z(x: float, y: float, default: float, ignore=()) -> float:
    """Высота поверхности (ландшафт/блокаут) трассой вниз; при неудаче — default."""
    try:
        hit = unreal.SystemLibrary.line_trace_single(
            editor_world(), unreal.Vector(x, y, 60000.0), unreal.Vector(x, y, -20000.0),
            unreal.TraceTypeQuery.TRACE_TYPE_QUERY1, True, list(ignore),
            unreal.DrawDebugTrace.NONE, True)
        if hit:
            loc = _hit_location(hit)
            if loc is not None:
                return float(loc.z)
    except Exception:  # noqa: BLE001
        pass
    return default


def yaw_to(a, b) -> float:
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))


def try_load(*paths):
    """Первый существующий ассет из списка путей."""
    for p in paths:
        a = load_or_none(p)
        if a:
            return a
    return None


# ---------------------------------------------------------------- инстансы (HISM)
def make_transform(loc, rot=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)):
    """rot = (roll, pitch, yaw) в градусах, как у rakis_common.spawn."""
    return unreal.Transform(unreal.Vector(*loc), unreal.Rotator(roll=rot[0], pitch=rot[1], yaw=rot[2]),
                            unreal.Vector(*scale))


def ism_actor(label, mesh, transforms, tags, folder=None, material=None, max_fallback=400):
    """Один актор с HierarchicalInstancedStaticMeshComponent (через SubobjectDataSubsystem, UE 5.1+).
    Если API недоступно — отдельные StaticMeshActor (не больше max_fallback)."""
    if not transforms or mesh is None:
        return None
    mat = load_or_none(material) if isinstance(material, str) else material
    actor = None
    try:
        actor = spawn(unreal.Actor, (0.0, 0.0, 0.0), label=label, tags=tags, folder=folder)
        sds = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
        handles = sds.k2_gather_subobject_data_for_instance(actor)
        params = unreal.AddNewSubobjectParams(parent_handle=handles[0],
                                              new_class=unreal.HierarchicalInstancedStaticMeshComponent,
                                              blueprint_context=None)
        res = sds.add_new_subobject(params)
        handle = res[0] if isinstance(res, tuple) else res
        data = unreal.SubobjectDataBlueprintFunctionLibrary.get_data(handle)
        comp = unreal.SubobjectDataBlueprintFunctionLibrary.get_object(data)
        comp.set_static_mesh(mesh)
        if mat:
            comp.set_material(0, mat)
        comp.add_instances(transforms, False, True)
        return actor
    except Exception as e:  # noqa: BLE001
        warn(f"{label}: HISM недоступен ({e}) — фолбэк на отдельные акторы")
        try:
            if actor:
                actor_ss.destroy_actor(actor)
        except Exception:  # noqa: BLE001
            pass
    for i, t in enumerate(transforms[:max_fallback]):
        a = actor_ss.spawn_actor_from_object(mesh, t.translation, t.rotation.rotator())
        if not a:
            continue
        a.set_actor_scale3d(t.scale3d)
        a.set_actor_label(f"{label}_{i:03d}")
        a.tags = [unreal.Name(x) for x in tags]
        if folder:
            a.set_folder_path(folder)
        if mat:
            a.static_mesh_component.set_material(0, mat)
    return None


ENGINE_MESH = {
    "cube": "/Engine/BasicShapes/Cube.Cube",
    "sphere": "/Engine/BasicShapes/Sphere.Sphere",
    "cylinder": "/Engine/BasicShapes/Cylinder.Cylinder",
    "cone": "/Engine/BasicShapes/Cone.Cone",
    "plane": "/Engine/BasicShapes/Plane.Plane",
}


def mesh_or_shape(asset_paths, fallback_kind="cube"):
    """(mesh, is_kit): первый найденный ассет, иначе движковый примитив (100 см)."""
    for p in asset_paths:
        m = load_or_none(p)
        if m:
            return m, True
    return unreal.EditorAssetLibrary.load_asset(ENGINE_MESH[fallback_kind]), False


# ---------------------------------------------------------------- фолбэк-земля и дюны (без Landscape)
def _dunes_module():
    """env_dunes.py (чистый Python) — та же функция высот, что и у heightmap."""
    import os
    import sys
    from rakis_common import PROJECT_DIR
    bl = os.path.join(PROJECT_DIR, "Tools", "blender")
    if bl not in sys.path:
        sys.path.insert(0, bl)
    import env_dunes  # noqa: WPS433
    return env_dunes


def ground_rects():
    """Плиты земли 200 м: ядро + 300 м поля, минус окно под сиетчем (B1-лестница уходит ниже Z=0)."""
    import level_layout as LL
    x0, y0 = LL.CORE_MIN[0] - 30000.0, LL.CORE_MIN[1] - 30000.0
    x1, y1 = LL.CORE_MAX[0] + 30000.0, LL.CORE_MAX[1] + 30000.0
    hole = (LL.B1["x0"], 169000.0, 67000.0, 78000.0)
    tile = 20000.0
    out = []
    x = x0
    while x < x1:
        y = y0
        while y < y1:
            out += subtract_rect((x, min(x + tile, x1), y, min(y + tile, y1)), hole)
            y += tile
        x += tile
    return out


def build_fallback_ground(tags) -> int:
    n = 0
    for (x0, x1, y0, y1) in ground_rects():
        if box(x0, x1, y0, y1, -100.0, 0.0, tags, f"Ground_{n:03d}", MI_SAND, "Rakis/Desert/Ground"):
            n += 1
    return n


def dune_blobs(max_count: int = 420):
    """Гребни дюн из процедурной функции env_dunes: [(x, y, h_cm, yaw, длина, ширина)] (см)."""
    import level_layout as LL
    E = _dunes_module()
    B = E.PyBackend()
    step = 2500.0
    x0, y0 = LL.CORE_MIN[0] - 25000.0, LL.CORE_MIN[1] - 25000.0
    nx = int((LL.CORE_MAX[0] + 25000.0 - x0) / step)
    ny = int((LL.CORE_MAX[1] + 25000.0 - y0) / step)
    H = [[E.height_m(B, x0 + i * step, y0 + j * step) for j in range(ny + 1)] for i in range(nx + 1)]
    peaks = []
    for i in range(1, nx):
        for j in range(1, ny):
            h = H[i][j]
            if h < 4.0:
                continue
            if any(H[i + di][j + dj] > h for di in (-1, 0, 1) for dj in (-1, 0, 1) if di or dj):
                continue
            x, y = x0 + i * step, y0 + j * step
            if LL.rock_signed_distance(x, y) < 3000.0:
                continue
            if E.ridge_a1(B, x / 100.0, y / 100.0)[0] > 0.5:   # гребень A1 строится отдельно (ridge_blobs)
                continue
            outside = x < LL.CORE_MIN[0] or x > LL.CORE_MAX[0] or y < LL.CORE_MIN[1] or y > LL.CORE_MAX[1]
            vis = (h - 2.0) * 100.0
            if outside:   # сейф — вытянут по ветру
                peaks.append((x, y, vis, LL.WIND_YAW_DEG, 25000.0, max(3000.0, vis * 6.0)))
            else:         # бархан/поперечная гряда — гребень поперёк ветра
                peaks.append((x, y, vis, LL.WIND_YAW_DEG + 90.0, 7000.0 + vis * 3.0, max(2000.0, vis * 7.0)))
    peaks.sort(key=lambda p: -p[2])
    return peaks[:max_count]


def ridge_blobs():
    """Стартовый гребень A1: цепочка эллипсоидов по линии гребня (вершина 35 м в (0,0))."""
    import level_layout as LL
    E = _dunes_module()
    B = E.PyBackend()
    ax, ay = LL.A1_RIDGE_A
    bx, by = LL.A1_RIDGE_B
    yaw = math.degrees(math.atan2(by - ay, bx - ax))
    out = []
    for k in range(-2, 12):
        s = k / 10.0
        x, y = ax + (bx - ax) * s, ay + (by - ay) * s
        r, _, _ = E.ridge_a1(B, x / 100.0, y / 100.0)
        if r > 1.0:
            out.append((x, y, r * 100.0, yaw, 9000.0, max(3000.0, r * 100.0 * 6.0)))
    out.append((0.0, 0.0, LL.START[2], yaw, 9000.0, LL.START[2] * 6.0))   # точно под стартом
    return out


def build_fallback_dunes(tags) -> int:
    n = 0
    try:
        blobs = ridge_blobs() + dune_blobs()
    except Exception as e:  # noqa: BLE001
        warn(f"env_dunes недоступен ({e}) — дюны блокаута не построены")
        return 0
    for (x, y, h, yaw, ln, wd) in blobs:
        if shape("sphere", (x, y, 0.0), (ln, wd, 2.0 * h), rotation=(0, 0, yaw), material=MI_SAND,
                 label=f"Dune_{n:03d}", tags=tags, folder="Rakis/Desert/Dunes"):
            n += 1
    return n


if __name__ == "__main__":
    log("level_common: модуль помощников, сам по себе ничего не делает")
