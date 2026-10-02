"""
Сборка играбельного демо «Rakis: Heretics» одной командой (docs/06_demo_contract.md §2.7).

Запуск в редакторе:   Tools → Execute Python Script → build_demo.py
Из командной строки:
  UnrealEditor-Cmd Rakis.uproject -run=pythonscript -script="Tools/unreal_python/build_demo.py" -unattended -nosplash
Выборочно:            ... -script="Tools/unreal_python/build_demo.py --only light_setup,fx_niagara"
                      ... -script="Tools/unreal_python/build_demo.py --skip env_import"

Каждый шаг — отдельный идемпотентный скрипт. Ошибка шага не останавливает сборку:
в конце печатается сводка, и демо остаётся играбельным на блокауте.
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

from rakis_common import MAP_PERSISTENT, level_ss, log, warn  # noqa: E402

# Порядок важен: данные → материалы → меши → карты → разметка → свет → FX → декор → толпа/звук.
STEPS: list[str] = [
    "data_import",
    "mat_master_materials",
    "mat_post_process",
    "env_import",
    "level_blockout_desert",
    "level_blockout_sietch",
    "level_markup",
    "light_setup",
    "fx_niagara",
    "env_scatter_desert",
    "env_dress_sietch",
    "char_crowd_variants",
    "audio_setup",
]


def run_step(name: str) -> tuple[bool, float, str]:
    t0 = time.time()
    path = os.path.join(HERE, f"{name}.py")
    if not os.path.exists(path):
        return False, 0.0, "нет файла"
    try:
        mod = importlib.import_module(name)
        mod = importlib.reload(mod)  # повторный запуск в той же сессии редактора
        entry = getattr(mod, "main", None)
        if callable(entry):
            entry()
        return True, time.time() - t0, ""
    except SystemExit:
        return True, time.time() - t0, ""
    except Exception:  # noqa: BLE001
        return False, time.time() - t0, traceback.format_exc(limit=4)


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(prog="build_demo")
    ap.add_argument("--only", default="", help="через запятую")
    ap.add_argument("--skip", default="", help="через запятую")
    args = ap.parse_args(argv)
    only = [s for s in args.only.split(",") if s]
    skip = {s for s in args.skip.split(",") if s}
    steps = [s for s in (only or STEPS) if s not in skip]

    log(f"build_demo: {', '.join(steps)}")
    report = []
    with unreal.ScopedSlowTask(len(steps), "Rakis: сборка демо") as task:
        task.make_dialog(True)
        for s in steps:
            if task.should_cancel():
                warn("Сборка отменена пользователем")
                break
            task.enter_progress_frame(1, f"Rakis: {s}")
            ok, dt, err = run_step(s)
            report.append((s, ok, dt, err))
            (log if ok else warn)(f"{'OK  ' if ok else 'FAIL'} {s} ({dt:.1f} c) {err.splitlines()[-1] if err else ''}")

    # Финал: открыть persistent-карту и сохранить всё изменённое.
    try:
        level_ss.load_level(MAP_PERSISTENT)
        unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
    except Exception as e:  # noqa: BLE001
        warn(f"Сохранение: {e}")

    log("==== Сводка build_demo ====")
    for s, ok, dt, err in report:
        log(f"  {'✔' if ok else '✘'} {s:24s} {dt:6.1f} c")
        if err:
            for line in err.strip().splitlines()[-3:]:
                warn(f"      {line}")
    failed = [s for s, ok, *_ in report if not ok]
    log("Готово. Play (Alt+P) в L_Rakis_Persistent." if not failed
        else f"Есть ошибки в шагах: {', '.join(failed)} — демо играбельно на блокауте, см. лог.")


# В UE аргументы скрипта приходят в sys.argv после имени файла.
if __name__ == "__main__":
    main(sys.argv[1:])
