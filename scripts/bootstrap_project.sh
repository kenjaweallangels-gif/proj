#!/usr/bin/env bash
# Инициализация репозитория проекта: git, LFS, структура папок, проверка инструментов.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[[ -d .git ]] || git init -b main
git lfs install --local

mkdir -p Content/Rakis/{Maps,Environment/{Desert,Rock,Sietch,Props},Characters/{Heroes,Riders,Crowd,Modular},Worm,Materials/{Master,Instances,Functions},FX,Animation,Audio/{Music,Ambience,SFX,VO,MetaSounds},Blueprints,Data,Cinematics} \
         Source/Rakis/Shaders Tools/{unreal_python,blender,houdini,tts} Export \
         docs/{design,lore,level,art/{environment,characters},tech-art,animation,audio,qa} \
         orchestrator/{handoffs,logs}
find Content Tools docs orchestrator/handoffs -type d -empty -exec touch {}/.gitkeep \;

echo "== Проверка инструментов =="
for t in git git-lfs uv node claude codex kimi cursor-agent blender UnrealEditor nvidia-smi; do
  if command -v "$t" >/dev/null 2>&1; then printf '  ✔ %-14s %s\n' "$t" "$(command -v "$t")"
  else printf '  ✘ %-14s не найден\n' "$t"; fi
done

[[ -f Rakis.uproject ]] || echo "⚠ Rakis.uproject не найден — создайте проект в UE (шаблон Third Person, C++, имя Rakis) и положите пакет в его корень."

python3 -c "import yaml" 2>/dev/null || echo "⚠ Нет PyYAML: source .venv/bin/activate или pip install pyyaml"

if ! git rev-parse HEAD >/dev/null 2>&1; then
  git add -A && git commit -m "chore: bootstrap Rakis agent workspace"
fi
echo "Готово. Далее: python3 orchestrator/orchestrator.py status"
