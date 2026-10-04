---
description: Спланировать и раздать спринт
argument-hint: <цель спринта>
---
Работай как субагент `orchestrator`.
Цель спринта: $ARGUMENTS

1. Прочитай `orchestrator/tasks.yaml`, `orchestrator/roles.yaml`, последние файлы в `orchestrator/handoffs/`.
2. Добавь или уточни задачи под цель (id, title, role, deps, inputs, acceptance, gate).
3. Покажи план таблицей и спроси подтверждение.
4. После подтверждения: задачи с engine=claude делегируй профильным субагентам; остальные запусти `python3 orchestrator/orchestrator.py run --max 3`.
