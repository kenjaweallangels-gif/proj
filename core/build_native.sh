#!/usr/bin/env bash
# Echo Runtime core — native build (CMake + Ninja, Release) and tests.
#   core/build_native.sh                 # g++ (default) into core/build
#   core/build_native.sh --compiler clang++   # into core/build-clang
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
compiler=""
build="$here/build"
while [ $# -gt 0 ]; do
  case "$1" in
    --compiler) compiler="$2"; build="$here/build-$(basename "$2" | sed 's/[^a-z]//g')"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
args=(-S "$here" -B "$build" -G Ninja -DCMAKE_BUILD_TYPE=Release)
[ -n "$compiler" ] && args+=(-DCMAKE_CXX_COMPILER="$compiler")
cmake "${args[@]}"
cmake --build "$build"
ctest --test-dir "$build" --output-on-failure
echo "native build OK: $build"
