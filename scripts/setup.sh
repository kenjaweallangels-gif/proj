#!/usr/bin/env bash
# Установка проекта на Linux, macOS или WSL. Запуск из корня репозитория:  bash scripts/setup.sh [--full] [--skip-tests]
# Проверяет Git, Node.js 22+, Python 3.11+; ставит зависимости веб-демо (pkg2) и Python-части (pkg1); прогоняет тесты.
# --full — полный набор pkg1 (сервер, CAD, голос). Godot и модели Vosk — скрипты pkg1-sim-vm/setup/ubuntu/.
set -euo pipefail
cd "$(dirname "$0")/.."
FULL=0; TESTS=1
for a in "$@"; do case "$a" in --full) FULL=1 ;; --skip-tests) TESTS=0 ;; esac; done

need() { command -v "$1" >/dev/null 2>&1 || { echo "Нет $1. $2" >&2; exit 1; }; }
need git "Установите git."
need node "Установите Node.js 22 LTS (nvm install 22, brew install node@22 или nodesource)."
need python3 "Установите Python 3.11+."
node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' || { echo "Нужен Node.js 22+ (сейчас $(node --version))" >&2; exit 1; }
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' || { echo "Нужен Python 3.11+" >&2; exit 1; }
echo "git $(git --version | cut -d' ' -f3) · node $(node --version) · $(python3 --version)"

echo "== Веб-демо и симулятор (pkg2-demo-web) =="
( cd pkg2-demo-web && npm ci && { [ $TESTS = 0 ] || npm test; } )

echo "== Python: стенд очков и ядро (pkg1-sim-vm) =="
cd pkg1-sim-vm
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -U pip wheel
if [ $FULL = 1 ]; then .venv/bin/pip install -r requirements.txt
else .venv/bin/pip install -q numpy opencv-contrib-python-headless scipy pyyaml jsonschema websockets pytest fastapi uvicorn httpx sqlalchemy python-multipart
fi
if [ $TESTS = 1 ]; then
  if [ $FULL = 1 ]; then make test; else PYTHONPATH=core:.:tools .venv/bin/python -m pytest -q tests/test_glasses_lab.py; fi
fi

cat <<'EOF'

== Готово ==
Симулятор и стенд:      cd pkg2-demo-web && npm run dev
  симулятор участка     http://localhost:5173/galley.html      (обучение: #train, очки: ?pose=1)
  стенд очков           http://localhost:5173/lab.html
Стенд очков (Python):   cd pkg1-sim-vm && make lab-detect | lab-pose-demo | lab-pose SRC=viture | lab-record | lab-analyze DEVICE=… | lab-camera CAM=…
Порядок работы с очками — docs/12_glasses_lab.md
EOF
