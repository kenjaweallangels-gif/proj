#!/usr/bin/env bash
# Локальная установка и запуск браузерного демо «Rakis: Heretics» (Linux / macOS / WSL2).
#   bash scripts/setup_web.sh            — установить зависимости, собрать, запустить на http://localhost:8080
#   bash scripts/setup_web.sh --no-run   — только установить и собрать
#   bash scripts/setup_web.sh --tools    — дополнительно Python-инструменты (озвучка/музыка) и Chromium для тестов
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
RUN=1; TOOLS=0
for a in "$@"; do case "$a" in --no-run) RUN=0 ;; --tools) TOOLS=1 ;; esac; done

need() { command -v "$1" >/dev/null 2>&1 || { echo "Не найдено: $1. $2"; exit 1; }; }
need node "Установите Node.js 20+ (https://nodejs.org) или через nvm."
need npm  "npm идёт вместе с Node.js."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || { echo "Нужен Node.js 20+, сейчас $(node -v)"; exit 1; }

if command -v git >/dev/null 2>&1 && [ -d .git ] && command -v git-lfs >/dev/null 2>&1; then
  git lfs install --local >/dev/null 2>&1 || true
  git lfs pull || echo "(LFS: пропущено — для веб-версии не обязательно)"
fi

echo "== npm-зависимости (Web/) =="
cd "$ROOT/Web"
if [ -f package-lock.json ]; then npm ci; else npm install; fi

echo "== сборка =="
npm run build

if [ "$TOOLS" = 1 ]; then
  echo "== Python-инструменты =="
  need python3 "Установите Python 3.10+."
  python3 -m venv "$ROOT/.venv"
  "$ROOT/.venv/bin/python" -m pip install -U pip
  "$ROOT/.venv/bin/python" -m pip install -r "$ROOT/Tools/requirements.txt"
  command -v ffmpeg >/dev/null 2>&1 || echo "ВНИМАНИЕ: ffmpeg (с libopus и rubberband) нужен для пересборки голосов и музыки."
  echo "== Chromium для автотестов =="
  npx playwright install chromium
fi

echo
echo "Готово. Файл игры: $ROOT/Web/dist/rakis_demo.html (можно открыть двойным щелчком)."
if [ "$RUN" = 1 ]; then
  echo "Запуск локального сервера: http://localhost:8080  (Ctrl+C — остановить)"
  npm run serve
fi
