#!/usr/bin/env bash
# Regenerates every eval report in reports/eval/ and the cross-provider index (reports/eval/README.md).
# Takes ≈1–2 min on 4 CPUs (mock:slow waits 1.5 s per scene). Real providers are only preflighted: without
# keys/models they are written as not_run — nothing is called that costs money.
# Usage: bash eval/run_all.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT=reports/eval
mkdir -p "$OUT"
failures=0

run() { # run <out-name> <args...>
  local name="$1"; shift
  node eval/run.ts "$@" --out "$OUT/$name.json" --quiet
  local rc=$?
  printf '%-34s rc=%d\n' "$name" "$rc"
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 3 ]; then failures=$((failures + 1)); fi
}

NO_KEYS="В этой среде нет API-ключей (переменные ECHO_KEY_* не заданы), маршрут выключен в примере конфигурации; платные API не вызывались."
NO_MODEL="Веса модели в этой среде не скачаны (HuggingFace недоступен), llama-server не запущен; локальная модель не оценивалась."
NO_SERVER="Собственный сервер vLLM в этой среде отсутствует (endpoint-пример llm.example.invalid), ключа нет."

run rules                         --provider rules
run mock_good                     --provider mock:good
run mock_adversarial_unknown_field --provider mock:adversarial_unknown_field
run mock_adversarial_spoiler      --provider mock:adversarial_spoiler
run mock_adversarial_dup_keys     --provider mock:adversarial_dup_keys
run mock_adversarial_foreign_fact --provider mock:adversarial_foreign_fact
run mock_garbage                  --provider mock:garbage
run mock_refusal                  --provider mock:refusal
run mock_truncated                --provider mock:truncated
run mock_slow                     --provider mock:slow --concurrency 4
run mock_slow_deadline_1000       --provider mock:slow --deadline-ms 1000 --concurrency 4
run mock_timeout_deadline_800     --provider mock:timeout --deadline-ms 800 --concurrency 4
run route_local_llamacpp          --provider route:local_llamacpp --note "$NO_MODEL"
run route_openai                  --provider route:openai --note "$NO_KEYS"
run route_anthropic               --provider route:anthropic --note "$NO_KEYS"
run route_gemini                  --provider route:gemini --note "$NO_KEYS"
run route_vllm_selfhost           --provider route:vllm_selfhost --note "$NO_SERVER"

node eval/summarize.ts || failures=$((failures + 1))
if [ "$failures" -ne 0 ]; then echo "eval: $failures прогон(ов) с fail/ошибкой"; exit 1; fi
echo "eval: все прогоны pass или not_run"
