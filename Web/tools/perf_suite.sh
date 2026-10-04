#!/bin/bash
# Цепочка проб: after(low) → baseline(med) → after(med) на урезанном наборе точек (SwiftShader медленный).
# Использование: bash tools/perf_suite.sh <outdir>   (baseline-сборка: dist/perf_baseline.html — старая сборка с профайлером, cur.html — текущая)
cd "$(dirname "$0")/.."
OUT=${1:-/tmp/perf_suite}
mkdir -p "$OUT"
PTS=start,worm,trail,cleft,market,garden
node tools/perf_probe.mjs --file=cur.html --q=low --warm=1 --points=$PTS --out=dist/perf/after_low2.json --label=after-low > "$OUT/after_low2.log" 2>&1
node tools/perf_probe.mjs --file=perf_baseline.html --q=med --points=start,worm,trail,market,garden --out=dist/perf/baseline_med.json --label=baseline-med > "$OUT/baseline_med.log" 2>&1
node tools/perf_probe.mjs --file=cur.html --q=med --warm=1 --points=start,worm,trail,market,garden --out=dist/perf/after_med.json --label=after-med > "$OUT/after_med.log" 2>&1
echo done > "$OUT/DONE"
