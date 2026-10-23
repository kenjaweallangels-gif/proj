#!/usr/bin/env bash
# Echo Runtime core — WebAssembly build (Emscripten) from the same sources, plus the same tests under Node.
# Produces core/build-wasm/echo_core.mjs (ES module, SINGLE_FILE, no filesystem) for web/ and eval/,
# and core/build-wasm/echo_tests.cjs / echo_cli.cjs (NODERAWFS) that run the native test suite in WASM.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"
if ! command -v emcmake >/dev/null 2>&1; then
  # shellcheck disable=SC1091
  source /opt/tools/emsdk/emsdk_env.sh >/dev/null 2>&1 || { echo "Emscripten not found (emsdk_env.sh)" >&2; exit 1; }
fi
emcmake cmake -S "$here" -B "$here/build-wasm" -G Ninja -DCMAKE_BUILD_TYPE=Release -DECHO_DATA_DIR="$repo/data"
cmake --build "$here/build-wasm"
# ctest runs the WASM binaries through node (CMAKE_CROSSCOMPILING_EMULATOR from the Emscripten toolchain).
ctest --test-dir "$here/build-wasm" --output-on-failure
node "$here/test_wasm_protocol.mjs"
# The plain-JS build (-sWASM=0, fallback when a page forbids WebAssembly) must behave identically.
node "$here/test_wasm_protocol.mjs" --module "$here/build-wasm/echo_core_js.mjs"
ls -l "$here/build-wasm/echo_core.mjs"
echo "wasm build OK: $here/build-wasm/echo_core.mjs"
