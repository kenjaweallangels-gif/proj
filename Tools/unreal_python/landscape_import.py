"""
landscape_import.py — Landscape пустыни из heightmap env_dunes.py (T-018; шаг build_demo сразу после env_import).

Исходные данные: Export/heightmap_desert.json (пишет Tools/blender/env_dunes.py) + Export/heightmap_desert_r16.png
и Export/heightmap_desert.r16 (те же 16-bit высоты; UE принимает оба формата).
Раскладка (docs/level/layout.md §13): 4033² вершин, 63 quads/секция, 2×2 секции/компонент, 32×32 компонента,
угол (вершина 0,0) = (−131600, −151600, 0), Scale (100, 100, 100) → Z = (v − 32768)/128 м.

Что умеет Python UE 5.6 (проверено по https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/
?application_version=5.6): у unreal.Landscape / unreal.LandscapeProxy нет создания компонентов и импорта
heightmap из файла; LandscapeEditorSubsystem в Python отсутствует; есть только
LandscapeProxy.landscape_import_heightmap_from_render_target() — для УЖЕ существующего ландшафта и через
render target (8-bit RG-кодирование, ненадёжно на 4033²). Поэтому:
  1. Скрипт ищет возможность импорта в рантайме (hasattr-пробы: будущая версия/плагин может её дать) и,
     если находит метод с понятной сигнатурой, создаёт Landscape сам.
  2. Иначе печатает точную пошаговую инструкцию (Landscape Mode ▸ New ▸ Import from File) и выходит без ошибки —
     демо остаётся играбельным на фолбэк-земле env_import.py.
  3. Когда Landscape есть (создан вручную или скриптом) — идемпотентно доводит его: трансформ строго по JSON
     (поле Location окна New Landscape — ЦЕНТР, поэтому угол часто «уезжает»; скрипт ставит угол сам),
     материал MI_Sand_Erg_Dry (без LayerBlend — LayerInfo не нужны), метка/папка, тег gen:landscape_import,
     удаляет фолбэк-землю и дюны-примитивы (env_import / level_blockout_desert).
Тег gen:landscape_import здесь — «управляется скриптом», а НЕ «удалить при перезапуске»: ландшафт создаётся
вручную, повторный запуск его не пересоздаёт и не удаляет.

Запуск: из build_demo.py или Tools ▸ Execute Python Script. Без unreal (python3 landscape_import.py) — печатает
инструкцию по JSON.
"""
from __future__ import annotations

import json
import os
import re
import sys

try:
    import unreal
    IN_UE = True
except ImportError:  # вне редактора — только инструкция
    unreal = None
    IN_UE = False

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import level_layout as LL  # noqa: E402  (чистый Python)

GEN = "gen:landscape_import"
LABEL = "Landscape_Desert"
FOLDER = "Rakis/Desert/Landscape"
MI_DIR = "/Game/Rakis/Materials/Instances"
MATERIALS = [f"{MI_DIR}/MI_Sand_Erg_Dry", f"{MI_DIR}/MI_Landscape_Sand", "/Game/Rakis/Materials/Master/M_Landscape_Sand"]
TOL_CM = 1.0


# ------------------------------------------------------------------ параметры
def project_dir() -> str:
    if IN_UE:
        return unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
    return os.path.abspath(os.path.join(HERE, "..", ".."))


def read_meta() -> dict | None:
    p = os.path.join(project_dir(), "Export", "heightmap_desert.json")
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def layout(meta: dict | None) -> dict:
    """Ожидаемые параметры ландшафта: из JSON, иначе из level_layout.py (те же числа)."""
    ls = (meta or {}).get("landscape", {})
    res = int((meta or {}).get("resolution", LL.HEIGHTMAP_RES))
    q = res - 1
    step = LL.LANDSCAPE_SIZE_CM / q
    corner = list(ls.get("location_cm", LL.LANDSCAPE_ORIGIN))
    scale = list(ls.get("scale", [step, step, LL.LANDSCAPE_Z_SCALE]))
    size = list(ls.get("size_cm", [LL.LANDSCAPE_SIZE_CM, LL.LANDSCAPE_SIZE_CM]))
    qps = int(ls.get("quads_per_section", 63))
    spc = int(ls.get("sections_per_component", 2 if q % 126 == 0 else 1))
    comps = ls.get("components", [q // (qps * spc)] * 2)
    root = project_dir()
    png = os.path.join(root, (meta or {}).get("file", "Export/heightmap_desert_r16.png"))
    r16 = (meta or {}).get("file_r16")
    return {
        "resolution": res, "corner": corner, "scale": scale, "size": size,
        "center": [corner[0] + size[0] * 0.5, corner[1] + size[1] * 0.5, corner[2]],
        "quads_per_section": qps, "sections_per_component": spc, "components": list(comps),
        "png": png, "r16": os.path.join(root, r16) if r16 else None,
        "height_range_m": (meta or {}).get("height_range_m"),
    }


def instructions(meta: dict | None) -> list[str]:
    """Пошаговая инструкция (UE 5.6, Landscape Mode). Числа — из JSON."""
    if meta is None:
        return ["Нет Export/heightmap_desert.json — сначала: python3 Tools/blender/env_dunes.py "
                "(или blender -b -P Tools/blender/env_dunes.py), затем повторите landscape_import.py."]
    lt = layout(meta)
    f = lt["r16"] if lt["r16"] and os.path.isfile(lt["r16"]) else lt["png"]
    c, s = lt["center"], lt["scale"]
    return [
        "Landscape не найден, а Python UE 5.6 не умеет создавать его из файла. Сделайте вручную (≈2 мин):",
        "  1. Откройте L_Rakis_Persistent (Content Browser ▸ /Game/Rakis/Maps). Window ▸ Levels: двойной клик по "
        "L_Rakis_Desert — он станет текущим (синяя подсветка).",
        "  2. Режим Landscape: выпадающий список режимов на тулбаре (Selection Mode) ▸ Landscape (Shift+2). "
        "Вкладка Manage ▸ инструмент New.",
        "  3. Переключатель «Import from File». Heightmap File: … ▸ " + f,
        f"     (PNG и .r16 равноценны; .r16 = uint16 little-endian {lt['resolution']}×{lt['resolution']}, без заголовка).",
        f"  4. Location: X {c[0]:.0f}  Y {c[1]:.0f}  Z {c[2]:.0f}  (это ЦЕНТР; угол будет "
        f"{lt['corner'][0]:.0f}, {lt['corner'][1]:.0f}); Rotation 0 0 0.",
        f"  5. Scale: X {s[0]:.0f}  Y {s[1]:.0f}  Z {s[2]:.0f}.",
        f"  6. Section Size: {lt['quads_per_section']}x{lt['quads_per_section']} Quads; "
        f"Sections Per Component: {lt['sections_per_component']}x{lt['sections_per_component']} Section; "
        f"Number of Components: {lt['components'][0]} x {lt['components'][1]}; "
        f"Overall Resolution должна стать {lt['resolution']} x {lt['resolution']} (если UE предлагает «Fit To Data» — "
        "соглашайтесь только если числа совпали).",
        "  7. Material: MI_Sand_Erg_Dry (/Game/Rakis/Materials/Instances). Layers — оставить пустыми "
        "(материал без LandscapeLayerBlend). Enable Edit Layers — по умолчанию.",
        "  8. Import. Дождитесь сборки (4033² — до минуты). File ▸ Save All.",
        "  9. Снова запустите landscape_import.py (или build_demo.py --only landscape_import,level_blockout_desert): "
        "скрипт поставит точный угол/масштаб, материал и тег, уберёт фолбэк-землю.",
    ]


# ------------------------------------------------------------------ поиск/создание
def find_landscape():
    """Первый ALandscape (или LandscapeProxy) среди акторов загруженных уровней."""
    from rakis_common import all_actors
    proxy = None
    for a in all_actors():
        if isinstance(a, unreal.Landscape):
            return a
        if proxy is None and isinstance(a, unreal.LandscapeProxy):
            proxy = a
    return proxy.get_landscape_actor() if proxy is not None and hasattr(proxy, "get_landscape_actor") else proxy


_PROBE_CLASSES = ("LandscapeEditorSubsystem", "LandscapeEditorLibrary", "LandscapeBlueprintLibrary",
                  "LandscapeImportHelper", "EditorLandscapeLibrary")
_METHOD_RE = re.compile(r"(import|create).*(heightmap|landscape)|(heightmap|landscape).*(import|create)")


def probe_python_import():
    """[(объект, имя метода, сигнатура-строка)] — методы импорта/создания Landscape, если версия UE их даёт."""
    found = []
    for cname in _PROBE_CLASSES:
        cls = getattr(unreal, cname, None)
        if cls is None:
            continue
        obj = cls
        try:
            if issubclass(cls, unreal.EditorSubsystem):
                obj = unreal.get_editor_subsystem(cls)
        except Exception:  # noqa: BLE001
            pass
        for m in dir(obj):
            if m.startswith("_") or not _METHOD_RE.search(m) or "render_target" in m:
                continue
            fn = getattr(obj, m, None)
            if callable(fn):
                found.append((obj, m, (getattr(fn, "__doc__", "") or "").split("\n")[0]))
    return found


def _arg_value(name: str, lt: dict, path: str):
    n = name.lower()
    if any(k in n for k in ("file", "path", "filename")):
        return path
    if "location" in n:
        return unreal.Vector(*lt["corner"])
    if "rotation" in n:
        return unreal.Rotator(0.0, 0.0, 0.0)
    if "scale" in n:
        return unreal.Vector(*lt["scale"])
    if "quads" in n or "section_size" in n:
        return lt["quads_per_section"]
    if "sections_per_component" in n or "num_subsections" in n:
        return lt["sections_per_component"]
    if "component" in n and n.endswith("x"):
        return lt["components"][0]
    if "component" in n and n.endswith("y"):
        return lt["components"][1]
    if "material" in n:
        return _material()
    if n in ("world", "world_context_object", "world_context"):
        from level_common import editor_world
        return editor_world()
    raise KeyError(name)


def try_python_import(meta) -> bool:
    """Пытается создать Landscape найденным API. True — если после вызова Landscape появился."""
    cands = probe_python_import()
    if not cands:
        return False
    lt = layout(meta)
    path = lt["r16"] if lt["r16"] and os.path.isfile(lt["r16"]) else lt["png"]
    for obj, m, sig in cands:
        params = re.findall(r"\(([^)]*)\)", sig)
        names = [p.split(":")[0].split("=")[0].strip() for p in params[0].split(",")] if params else []
        names = [x for x in names if x and x != "self"]
        try:
            kwargs = {x: _arg_value(x, lt, path) for x in names}
        except KeyError as e:
            warn(f"найден {type(obj).__name__}.{m}{sig and ' — ' + sig}, но параметр {e} неизвестен — пропуск")
            continue
        try:
            log(f"импорт Landscape через {m}({', '.join(kwargs)})")
            getattr(obj, m)(**kwargs)
        except Exception as e:  # noqa: BLE001
            warn(f"{m}: {e}")
            continue
        if find_landscape() is not None:
            return True
    return False


# ------------------------------------------------------------------ доводка
def _material():
    from rakis_common import load_or_none
    for p in MATERIALS:
        m = load_or_none(p)
        if m:
            return m
    return None


def _near(a, b, tol) -> bool:
    return all(abs(float(x) - float(y)) <= tol for x, y in zip(a, b))


def configure(land, meta) -> None:
    from rakis_common import actor_ss, add_tags, has_tag, set_prop
    lt = layout(meta)
    # 1. уровень
    try:
        lvl = land.get_level()
        if lvl is not None and "L_Rakis_Desert" not in lvl.get_path_name():
            warn(f"Landscape лежит в {lvl.get_path_name()}, а должен в L_Rakis_Desert (стриминг §11.2): "
                 "Levels ▸ сделать L_Rakis_Desert текущим ▸ ПКМ по Landscape ▸ Level ▸ Move Selection to Current Level")
    except Exception:  # noqa: BLE001
        pass
    # 2. трансформ: угол и масштаб строго по JSON (поворот 0)
    loc, sc, rot = land.get_actor_location(), land.get_actor_scale3d(), land.get_actor_rotation()
    want_loc, want_sc = lt["corner"], lt["scale"]
    if not (_near((loc.x, loc.y, loc.z), want_loc, TOL_CM) and _near((sc.x, sc.y, sc.z), want_sc, 0.001)
            and _near((rot.roll, rot.pitch, rot.yaw), (0, 0, 0), 0.01)):
        t = unreal.Transform(unreal.Vector(*want_loc), unreal.Rotator(0.0, 0.0, 0.0), unreal.Vector(*want_sc))
        ok = actor_ss.set_actor_transform(land, t)   # editor-путь: Modify + PostEditMove
        log(f"Landscape: трансформ ({loc.x:.0f}, {loc.y:.0f}, {loc.z:.0f}) ×({sc.x:.1f}, {sc.y:.1f}, {sc.z:.1f}) → "
            f"{tuple(round(v) for v in want_loc)} ×{tuple(want_sc)} {'ok' if ok else 'НЕ УДАЛОСЬ'}")
    # 3. размер (= число компонентов × quads): по bounds
    try:
        origin, ext = land.get_actor_bounds(False)
        sx, sy = ext.x * 2.0, ext.y * 2.0
        if abs(sx - lt["size"][0]) > lt["scale"][0] * 2 or abs(sy - lt["size"][1]) > lt["scale"][1] * 2:
            warn(f"Landscape: размер {sx:.0f}×{sy:.0f} см ≠ {lt['size'][0]:.0f}×{lt['size'][1]:.0f} — "
                 f"проверьте Section Size/Components (ожидается {lt['resolution']}² вершин); пересоздайте по инструкции")
    except Exception:  # noqa: BLE001
        pass
    # 4. материал
    mat = _material()
    if mat:
        cur = None
        try:
            cur = land.get_editor_property("landscape_material")
        except Exception:  # noqa: BLE001
            pass
        if cur != mat:
            set_prop(land, "landscape_material", mat)
            log(f"Landscape: материал {mat.get_name()}")
    else:
        warn("нет MI_Sand_Erg_Dry/M_Landscape_Sand — запустите mat_master_materials.py (tech-artist), затем этот шаг")
    # 5. метка, папка, тег
    if land.get_actor_label() != LABEL:
        land.set_actor_label(LABEL)
    try:
        if str(land.get_folder_path()) != FOLDER:
            land.set_folder_path(FOLDER)
    except Exception:  # noqa: BLE001
        pass
    if not has_tag(land, GEN):
        add_tags(land, [GEN])


def remove_fallback_ground() -> int:
    """Фолбэк-земля и дюны-примитивы больше не нужны (их строят env_import и level_blockout_desert без Landscape)."""
    from rakis_common import actor_ss, all_actors, has_tag
    victims = []
    for a in all_actors():
        if has_tag(a, "gen:env_import"):
            victims.append(a)
        elif has_tag(a, "gen:level_blockout_desert") and (
                has_tag(a, "blockout:ground") or str(a.get_actor_label()).startswith(("Dune_", "Ground_"))):
            victims.append(a)
    for a in victims:
        actor_ss.destroy_actor(a)
    return len(victims)


# ------------------------------------------------------------------ main
def log(msg: str) -> None:
    (unreal.log if IN_UE else print)(f"[Rakis] landscape_import: {msg}")


def warn(msg: str) -> None:
    (unreal.log_warning if IN_UE else print)(f"[Rakis] landscape_import: {msg}")


def main() -> None:
    meta = read_meta()
    if not IN_UE:
        for line in instructions(meta):
            print(line)
        return
    import level_common as LC
    from rakis_common import MAP_DESERT, transaction
    LC.ensure_persistent_with_sublevels()   # до транзакции: загрузка карты сбрасывает буфер undo
    LC.make_current(MAP_DESERT)
    land = find_landscape()
    if land is None and meta is not None:
        cands = probe_python_import()
        if cands:
            log("найдено API импорта: " + ", ".join(f"{type(o).__name__}.{m}" for o, m, _ in cands))
            with transaction("Rakis: landscape_import (create)"):
                try_python_import(meta)
            land = find_landscape()
        else:
            log("Python API импорта heightmap нет (ожидаемо для UE 5.6) — нужен ручной шаг")
    if land is None:
        for line in instructions(meta):
            warn(line)
        return
    with transaction("Rakis: landscape_import"):
        configure(land, meta)
        n = remove_fallback_ground()
        if n:
            log(f"удалено фолбэк-акторов земли/дюн: {n}")
    LC.save_all()
    log(f"готово: {land.get_actor_label()}")


if __name__ == "__main__":
    main()
