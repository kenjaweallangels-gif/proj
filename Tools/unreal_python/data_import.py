"""
data_import.py — импорт CSV из Content/Rakis/Data в DataTable и создание DataAsset-ов настроек.
Шаг 1 сборки демо (docs/06_demo_contract.md §2.7). Идемпотентен: повторный запуск перезаливает
строки в существующие DT_*, не создавая дубликатов; DA_* создаются один раз, дефолты §2.6
дописываются только в свойства, которые есть у C++ класса.

Запуск: Tools → Execute Python Script → Tools/unreal_python/data_import.py
        или из build_demo.py (вызывается main()).
Вне редактора: `python3 data_import.py --dry-run` печатает план без unreal.
"""
from __future__ import annotations

import os
import sys

try:
    import unreal  # noqa: F401
    IN_UE = True
except ImportError:  # запуск вне редактора — только план
    unreal = None
    IN_UE = False

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

DEST = "/Game/Rakis/Data"

# CSV-имя → (имя DataTable, row struct)
TABLES = {
    "Dialogue_S1": ("DT_Dialogue_S1", "/Script/Rakis.RakisDialogueRow"),
    "Barks": ("DT_Barks", "/Script/Rakis.RakisBarkRow"),
    "CrowdArchetypes": ("DT_CrowdArchetypes", "/Script/Rakis.RakisCrowdArchetypeRow"),
    "AudioEvents": ("DT_AudioEvents", "/Script/Rakis.RakisAudioEventRow"),
    "StoryBeats": ("DT_StoryBeats", "/Script/Rakis.RakisStoryBeatRow"),
    "WeatherPresets": ("DT_WeatherPresets", "/Script/Rakis.RakisWeatherPresetRow"),  # зона tech-artist
}

# DataAsset-ы настроек: (имя, класс, дефолты из контракта §2.6 — источник docs/design/mechanics.md)
TUNING = [
    ("DA_NoiseTuning", "/Script/Rakis.RakisNoiseTuning", {
        "WalkLoudness": 0.35, "RunLoudness": 0.80, "SandWalkLoudness": 0.12,
        "RhythmPenalty": 0.6, "DecayPerSecond": 0.15, "RegularityWindow": 6,
        "ThumperLoudness": 1.0, "ThumperInterval": 1.6,
        # SurfaceMultiplier (Sand/PackedSand/Rock/SietchStone = 1.0/1.4/0.0/0.0) — тип задаёт C++
        # (TMap<ERakisSurface,float> или отдельные поля); выставляется дефолтом класса.
    }),
    ("DA_WormTuning", "/Script/Rakis.RakisWormTuning", {
        "HearingRadius": 120000.0, "ListenThreshold": 0.25, "ApproachThreshold": 0.55,
        "ListenTime": 6.0, "PassTime": 14.0, "DormantCooldown": 45.0,
        "ApproachSpeed": 2500.0, "SurfaceSpeed": 1800.0,
        "Length": 36000.0, "Diameter": 4000.0, "SegmentCount": 90,
        "SurfaceHeight": 5000.0, "BurrowDepth": 6000.0,
        "RockIsSafe": True, "ThumperWeight": 2.0,
    }),
    ("DA_HydrationTuning", "/Script/Rakis.RakisHydrationTuning", {
        "SunDrainPerMinute": 0.06, "ShadeRecoverPerMinute": 0.02,
        "RunMultiplier": 2.0, "MaskSealedFactor": 0.35, "InteriorRecoverPerMinute": 0.05,
    }),
]


def _csv_dir() -> str:
    if IN_UE:
        proj = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
    else:
        proj = os.path.abspath(os.path.join(HERE, "..", ".."))
    return os.path.join(proj, "Content", "Rakis", "Data")


def _snake(name: str) -> str:
    """CamelCase → snake_case для set_editor_property (RockIsSafe → rock_is_safe)."""
    out = []
    for i, ch in enumerate(name):
        if ch.isupper() and i and (not name[i - 1].isupper() or (i + 1 < len(name) and name[i + 1].islower())):
            out.append("_")
        out.append(ch.lower())
    return "".join(out)


# ---------------------------------------------------------------- DataTable
def _load_struct(path: str):
    st = unreal.load_object(None, path)
    if st is None:
        unreal.log_warning(f"[Rakis] data_import: row struct {path} не найден — модуль Rakis не собран?")
    return st


def _import_via_task(csv_path: str, dt_name: str, struct):
    """Первичный импорт: AssetImportTask + CSVImportFactory с автоматическими настройками."""
    factory = unreal.CSVImportFactory()
    settings = factory.get_editor_property("automated_import_settings")
    settings.set_editor_property("import_row_struct", struct)
    settings.set_editor_property("import_type", unreal.CSVImportType.ECSV_DATA_TABLE)
    factory.set_editor_property("automated_import_settings", settings)
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", csv_path)
    task.set_editor_property("destination_path", DEST)
    task.set_editor_property("destination_name", dt_name)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("automated", True)
    task.set_editor_property("save", True)
    task.set_editor_property("factory", factory)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    return unreal.EditorAssetLibrary.load_asset(f"{DEST}/{dt_name}")


def _create_empty_dt(dt_name: str, struct):
    factory = unreal.DataTableFactory()
    factory.set_editor_property("struct", struct)
    return unreal.AssetToolsHelpers.get_asset_tools().create_asset(dt_name, DEST, unreal.DataTable, factory)


def _fill(dt, csv_path: str, struct) -> bool:
    lib = unreal.DataTableFunctionLibrary
    try:
        return bool(lib.fill_data_table_from_csv_file(dt, csv_path, struct))
    except TypeError:  # старые сигнатуры без row struct
        return bool(lib.fill_data_table_from_csv_file(dt, csv_path))


def import_table(csv_name: str, csv_path: str) -> str:
    dt_name, struct_path = TABLES[csv_name]
    asset_path = f"{DEST}/{dt_name}"
    struct = _load_struct(struct_path)
    if struct is None:
        return "SKIP (нет struct)"
    eal = unreal.EditorAssetLibrary
    if not eal.does_directory_exist(DEST):
        eal.make_directory(DEST)
    dt = eal.load_asset(asset_path) if eal.does_asset_exist(asset_path) else None
    if dt is not None and dt.get_editor_property("row_struct") != struct:
        unreal.log_warning(f"[Rakis] {dt_name}: другая row struct — пересоздаю")
        eal.delete_asset(asset_path)
        dt = None
    if dt is None:
        dt = _create_empty_dt(dt_name, struct)
        if dt is None:  # фоллбек на классический импорт
            dt = _import_via_task(csv_path, dt_name, struct)
            if dt is None:
                return "FAIL (создание)"
            eal.save_loaded_asset(dt)
            return f"imported ({len(unreal.DataTableFunctionLibrary.get_data_table_row_names(dt))} rows)"
    if not _fill(dt, csv_path, struct):
        return "FAIL (fill_data_table_from_csv_file)"
    eal.save_loaded_asset(dt)
    rows = unreal.DataTableFunctionLibrary.get_data_table_row_names(dt)
    return f"ok ({len(rows)} rows)"


# ---------------------------------------------------------------- DataAsset
def ensure_tuning(name: str, class_path: str, defaults: dict) -> str:
    eal = unreal.EditorAssetLibrary
    asset_path = f"{DEST}/{name}"
    cls = unreal.load_class(None, class_path)
    if cls is None:
        return f"SKIP (нет класса {class_path})"
    da = eal.load_asset(asset_path) if eal.does_asset_exist(asset_path) else None
    created = False
    if da is None:
        factory = unreal.DataAssetFactory()
        factory.set_editor_property("data_asset_class", cls)
        da = unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, DEST, cls, factory)
        created = True
        if da is None:
            return "FAIL (create_asset)"
    # Дефолты пишем только во вновь созданный ассет: ручной тюнинг в редакторе не затирается.
    applied = 0
    if created:
        for key, value in defaults.items():
            for prop in (_snake(key), key):
                try:
                    da.set_editor_property(prop, value)
                    applied += 1
                    break
                except Exception:  # noqa: BLE001 — свойства может не быть в текущей версии C++
                    continue
    eal.save_loaded_asset(da)
    return ("created" if created else "exists") + (f", defaults {applied}/{len(defaults)}" if created else "")


# ---------------------------------------------------------------- main
def main(dry_run: bool = False) -> None:
    src = _csv_dir()
    plan = []
    for csv_name in TABLES:
        p = os.path.join(src, f"{csv_name}.csv")
        plan.append((csv_name, p, os.path.exists(p)))
    if dry_run or not IN_UE:
        for n, p, ok in plan:
            print(f"{'IMPORT' if ok else 'skip  '} {p} → {DEST}/{TABLES[n][0]} [{TABLES[n][1]}]")
        for n, c, d in TUNING:
            print(f"ASSET  {DEST}/{n} [{c}] ({len(d)} дефолтов)")
        return
    results = []
    with unreal.ScopedEditorTransaction("Rakis: data_import"):
        for n, p, ok in plan:
            if not ok:
                results.append(f"{n}: нет CSV — пропуск")
                continue
            try:
                results.append(f"{n}: {import_table(n, p)}")
            except Exception as e:  # noqa: BLE001
                results.append(f"{n}: FAIL {e}")
        for n, c, d in TUNING:
            try:
                results.append(f"{n}: {ensure_tuning(n, c, d)}")
            except Exception as e:  # noqa: BLE001
                results.append(f"{n}: FAIL {e}")
    for r in results:
        unreal.log(f"[Rakis] data_import — {r}")


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
