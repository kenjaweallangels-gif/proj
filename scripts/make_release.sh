#!/usr/bin/env bash
# Собрать единый архив проекта для локального развёртывания (исходники + готовая сборка + документация).
#   bash scripts/make_release.sh [имя]   → release/<имя>.zip (по умолчанию rakis_heretics_<дата>_<коммит>)
# В архив попадает всё, что под git (HEAD), включая готовый Web/dist/*.html. Рабочие деревья агентов, node_modules,
# модели TTS и кэши не попадают — они ставятся/скачиваются скриптами установки.
set -euo pipefail
cd "$(dirname "$0")/.."
REV=$(git rev-parse --short HEAD)
NAME=${1:-rakis_heretics_$(date +%Y%m%d)_$REV}
mkdir -p release
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ВНИМАНИЕ: есть незакоммиченные изменения — в архив попадёт только HEAD ($REV)."
fi
git -c core.autocrlf=false archive --format=zip --prefix="$NAME/" -o "release/$NAME.zip" HEAD
echo "release/$NAME.zip — $(du -h "release/$NAME.zip" | cut -f1)"
