#!/usr/bin/env bash
# Runs every check and writes reports/validation.json (pass / fail / blocked / not_run per direction).
# Usage: tools/test_all.sh [--skip-browser]
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p reports/tmp
STEPS=reports/tmp/steps.jsonl
: > "$STEPS"
SKIP_BROWSER=0; [ "${1:-}" = "--skip-browser" ] && SKIP_BROWSER=1
if [ -f /opt/tools/emsdk/emsdk_env.sh ] && ! command -v emcc >/dev/null; then
  # shellcheck disable=SC1091
  source /opt/tools/emsdk/emsdk_env.sh >/dev/null 2>&1
fi

step() { # step <id> <command...>
  local id="$1"; shift
  local log="reports/tmp/$id.log" start end rc
  start=$(date +%s.%N)
  echo "== $id: $*"
  "$@" > "$log" 2>&1; rc=$?
  end=$(date +%s.%N)
  tail -n 5 "$log"
  printf '{"id":"%s","rc":%d,"seconds":%.1f,"log":"%s"}\n' "$id" "$rc" "$(echo "$end - $start" | bc)" "$log" >> "$STEPS"
}

step core_native     bash core/build_native.sh
if command -v emcc >/dev/null; then
  step core_wasm     bash core/build_wasm.sh
else
  printf '{"id":"core_wasm","rc":-1,"seconds":0,"log":"","blocked":"emcc not installed"}\n' >> "$STEPS"
fi
step gateway_deps    npm ci --prefix gateway
step typecheck       npx tsc -p tsconfig.json
step gateway_tests   node --test gateway/test/
step web_build       node web/build.mjs
if [ "$SKIP_BROWSER" = 0 ]; then
  step web_e2e       node web/test/e2e.mjs
  step web_csp       node web/test/csp_fallback.mjs
else
  printf '{"id":"web_e2e","rc":-2,"seconds":0,"log":"","not_run":"--skip-browser"}\n' >> "$STEPS"
  printf '{"id":"web_csp","rc":-2,"seconds":0,"log":"","not_run":"--skip-browser"}\n' >> "$STEPS"
fi
step eval_rules      node eval/run.ts --provider rules --out reports/eval/rules.json
step eval_adversarial node eval/run.ts --provider mock:adversarial_unknown_field --out reports/eval/mock_adversarial_unknown_field.json
step hw_manifest     python3 tools/hw_manifest.py

node tools/make_report.mjs "$STEPS"
