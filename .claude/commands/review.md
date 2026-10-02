---
description: Кросс-ревью задачи
argument-hint: <TASK_ID>
---
Используй субагента `qa-reviewer` для задачи $ARGUMENTS: прочитай её критерии в `orchestrator/tasks.yaml`, handoff и diff ветки `task/$ARGUMENTS`. Запиши отчёт в `orchestrator/handoffs/$ARGUMENTS.review.md`.
