#!/usr/bin/env bash
# Виртуальное окружение Python и зависимости ядра/сервера/инструментов.
set -euo pipefail
cd "$(dirname "$0")/../.."          # pkg1-sim-vm
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip wheel
pip install -r requirements.txt
python - <<'PY'
import cv2, numpy, fastapi
print("OpenCV", cv2.__version__, "aruco:", hasattr(cv2, "aruco"))
PY
echo "OK: окружение .venv готово. Активация: source pkg1-sim-vm/.venv/bin/activate"
