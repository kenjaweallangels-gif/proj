#!/usr/bin/env bash
# Builds every component: C++ core (native + WASM), web client. Gateway and eval run from sources (Node type stripping).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== npm dependencies"
[ -d node_modules ] || npm ci
[ -f gateway/package.json ] && npm ci --prefix gateway

echo "== core: native"
bash core/build_native.sh

echo "== core: wasm"
if [ -f /opt/tools/emsdk/emsdk_env.sh ] && ! command -v emcc >/dev/null; then
  # shellcheck disable=SC1091
  source /opt/tools/emsdk/emsdk_env.sh >/dev/null 2>&1
fi
if command -v emcc >/dev/null; then bash core/build_wasm.sh; else echo "emcc not found: WASM core skipped (blocked)"; fi

echo "== web"
node web/build.mjs
echo "== done"
