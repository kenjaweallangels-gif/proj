"""
Сборка играбельного демо «Rakis: Heretics» одной командой (docs/06_demo_contract.md §2.7).

Запуск в редакторе:   Tools → Execute Python Script → build_demo.py
Из командной строки:
  UnrealEditor-Cmd Rakis.uproject -run=pythonscript -script="Tools/unreal_python/build_demo.py" -unattended -nosplash
Выборочно:            ... -script="Tools/unreal_python/build_demo.py --only light_setup,fx_niagara"
                      ... -script="Tools/unreal_python/build_demo.py --skip env_import"

Каждый шаг — отдельный идемпотентный скрипт. Ошибка шага не останавливает сборку:
в конце печатается сводка, и демо остаётся играбельным на блокауте.
Шаг = модуль с функцией main(); при импорте модуль ничего не делает (работа только в main / под
`if __name__ == "__main__"`), build_demo вызывает main() ровно один раз за прогон.
Необязательные шаги (OPTIONAL_STEPS — файлы других ролей, которых может ещё не быть) при отсутствии файла
пропускаются молча.
"""
from __future__ import annotations

import argparse
import importlib
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import unreal  # noqa: E402

from rakis_common import GAME_ROOT, MAP_PERSISTENT, current_world_package, log, open_map, warn  # noqa: E402

# Порядок важен: данные → материалы → меши/ландшафт → карты → разметка → свет → FX → декор → толпа/звук.
STEPS: list[str] = [
    "data_import",
    "mat_master_materials",
    "mat_post_process",
    "env_import",
    "landscape_import",        # после env_import: доводит Landscape (или печатает ручной шаг), убирает фолбэк-землю
    "level_blockout_desert",
    "level_blockout_sietch",
    "level_markup",
    "light_setup",
    "fx_niagara",
    "env_scatter_desert",
    "env_dress_sietch",
    "ai_smart_objects",        # необязательный (gameplay world/AI): Smart Object-ы по слотам разметки и декора
    "char_crowd_variants",
    "ai_mass_crowd",           # необязательный (gameplay world/AI): Mass-толпа после вариантов одежды
    "audio_setup",
]
# Шаги, файла которых может не быть (пишут другие роли) — без файла пропускаются молча.
OPTIONAL_STEPS: set[str] = {"ai_smart_objects", "ai_mass_crowd"}
# Общие модули-помощники: перезагружаются один раз в начале прогона (правки подхватываются без рестарта UE).
HELPER_MODULES = ("level_layout", "rakis_common", "level_common")


def _fresh_module(name: str):
    """Импорт без двойного исполнения: первый раз — import_module, в той же сессии редактора — reload."""
    if name in sys.modules:
        return importlib.reload(sys.modules[name])
    return importlib.import_module(name)


def reload_helpers() -> None:
    for name in HELPER_MODULES:
        if name in sys.modules:
            try:
                importlib.reload(sys.modules[name])
            except Exception as e:  # noqa: BLE001
                warn(f"reload {name}: {e}")


def run_step(name: str) -> tuple[str, float, str]:
    """→ (статус 'ok'|'fail'|'skip', секунды, текст ошибки)."""
    t0 = time.time()
    path = os.path.join(HERE, f"{name}.py")
    if not os.path.exists(path):
        return ("skip", 0.0, "") if name in OPTIONAL_STEPS else ("fail", 0.0, "нет файла")
    try:
        mod = _fresh_module(name)
        entry = getattr(mod, "main", None)
        if not callable(entry):
            return "fail", time.time() - t0, "нет функции main()"
        entry()
        return "ok", time.time() - t0, ""
    except SystemExit:
        return "ok", time.time() - t0, ""
    except Exception:  # noqa: BLE001
        return "fail", time.time() - t0, traceback.format_exc(limit=4)


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(prog="build_demo")
    ap.add_argument("--only", default="", help="через запятую")
    ap.add_argument("--skip", default="", help="через запятую")
    args = ap.parse_args(argv)
    only = [s for s in args.only.split(",") if s]
    skip = {s for s in args.skip.split(",") if s}
    steps = [s for s in (only or STEPS) if s not in skip]
    unknown = [s for s in steps if s not in STEPS]
    if unknown:
        warn(f"шаги вне STEPS (будут запущены, если есть файл): {', '.join(unknown)}")

    reload_helpers()
    log(f"build_demo: {', '.join(steps)}")
    report = []
    # ScopedSlowTask(work, desc) — make_dialog(can_cancel), should_cancel(), enter_progress_frame(work, desc)
    with unreal.ScopedSlowTask(len(steps), "Rakis: сборка демо") as task:
        task.make_dialog(True)
        for s in steps:
            if task.should_cancel():
                warn("Сборка отменена пользователем")
                break
            task.enter_progress_frame(1, f"Rakis: {s}")
            st, dt, err = run_step(s)
            report.append((s, st, dt, err))
            if st == "skip":
                continue
            (log if st == "ok" else warn)(
                f"{'OK  ' if st == 'ok' else 'FAIL'} {s} ({dt:.1f} c) {err.splitlines()[-1] if err else ''}")

    # Финал: сохранить всё (до смены карты — load_level не спрашивает о несохранённом), открыть persistent,
    # сохранить ещё раз. EditorLoadingAndSavingUtils.save_dirty_packages(save_map_packages, save_content_packages).
    try:
        ours = current_world_package().startswith(GAME_ROOT + "/")   # Untitled-карту не сохраняем (диалог Save As)
        unreal.EditorLoadingAndSavingUtils.save_dirty_packages(ours, True)
        open_map(MAP_PERSISTENT)
        unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
    except Exception as e:  # noqa: BLE001
        warn(f"Сохранение: {e}")

    log("==== Сводка build_demo ====")
    for s, st, dt, err in report:
        mark = {"ok": "✔", "fail": "✘", "skip": "–"}[st]
        log(f"  {mark} {s:24s} {dt:6.1f} c{'  (нет файла, необязательный)' if st == 'skip' else ''}")
        if err:
            for line in err.strip().splitlines()[-3:]:
                warn(f"      {line}")
    failed = [s for s, st, *_ in report if st == "fail"]
    log("Готово. Play (Alt+P) в L_Rakis_Persistent." if not failed
        else f"Есть ошибки в шагах: {', '.join(failed)} — демо играбельно на блокауте, см. лог.")


# В UE аргументы скрипта приходят в sys.argv после имени файла.
if __name__ == "__main__":
    main(sys.argv[1:])
