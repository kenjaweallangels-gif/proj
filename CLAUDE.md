# CLAUDE.md

@AGENTS.md

## Специфика Claude Code
- Ролевые субагенты лежат в `.claude/agents/`. Главная сессия по умолчанию работает как `orchestrator`: декомпозирует, делегирует субагентам, собирает handoff.
- Для задач, закреплённых в `orchestrator/roles.yaml` за Codex или Kimi, не выполняй их сам — поставь их через `python3 orchestrator/orchestrator.py run --task <ID>` или оставь в очереди.
- Слэш-команды: `/sprint` — спланировать и раздать спринт, `/handoff <ID>` — оформить передачу, `/review <ID>` — провести кросс-ревью.
- Перед правкой C++ читай соседние заголовки и `docs/04_standards.md`.
