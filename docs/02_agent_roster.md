# Состав агентов, движки и зоны ответственности

## Почему три движка
- **Claude Code** — длинное рассуждение, дизайн, архитектура, ревью, оркестрация, работа с субагентами.
- **Codex CLI** — плотная генерация и правка кода (C++, HLSL, Python для Blender/Unreal), автономный `exec` в песочнице.
- **Kimi Code** — большой контекст и низкая цена: пакетная обработка таблиц, спецификаций, анимационных списков, сканирование всей кодовой базы при ревью.
- **Cursor** — ваш рабочий стол: чтение и правка руками, правила `.cursor/rules`, MCP к Unreal и Blender; при желании — четвёртый движок через `cursor-agent`.

Главный принцип — **кросс-ревью**: автор и ревьюер всегда на разных движках, чтобы ошибки одной модели ловила другая.

## Матрица ролей
| Роль | Движок-автор | Ревьюер | Зона файлов | Основные артефакты |
|---|---|---|---|---|
| orchestrator | Claude (Opus) | — | `orchestrator/tasks.yaml`, `docs/00_GDD.md`, `AGENTS.md` | планы спринтов, сводки ворот |
| game-designer | Claude (Opus) | Kimi | `docs/design/**`, `docs/lore/**`, `Content/Rakis/Data/*.csv` | механики, диалоги, barks |
| level-designer | Claude (Sonnet) | Codex | `docs/level/**`, `Tools/unreal_python/level_*.py` | схема уровня, блокаут, триггеры |
| environment-artist | Codex | Claude | `Tools/blender/env_*`, `Tools/houdini/**`, `Tools/unreal_python/env_*` | процедурные дюны и скала, кит сиетча, PCG |
| character-artist | Kimi | Claude | `docs/art/characters/**`, `Tools/unreal_python/char_*` | карточки, модульная одежда, вариации толпы |
| tech-artist | Codex | Claude | `Source/Rakis/Shaders/**`, `Tools/unreal_python/mat_*`, `fx_*` | материалы, марево, Niagara, профилирование |
| animator | Kimi | Codex | `docs/animation/**`, `Tools/*/anim_*` | anim list, риг червя, ретаргет, ТЗ мокапа |
| gameplay-programmer | Codex | Claude | `Source/Rakis/**`, `Config/*.ini` | персонаж, шум, червь, вода, NPC, Mass |
| audio-designer | Kimi | Claude | `docs/audio/**`, `Tools/tts/**`, `Tools/unreal_python/audio_*` | звуковая карта, MetaSounds, ТЗ композитору |
| qa-reviewer | Claude (Opus) | — | `docs/qa/**`, `orchestrator/handoffs/*.review.md` | ревью, тест-планы, отчёты |

Переназначить движок роли — одна строка в `orchestrator/roles.yaml`.

## Человек в контуре (вы)
| Ворота | Что проверяете |
|---|---|
| `story` | канон, тон, диалоги, механики на бумаге |
| `build` | проект собирается, карта открывается, скрипт отработал в редакторе |
| `art` | визуал в редакторе: силуэт, материал, свет |
| `perf` | fps и бюджет кадра на целевом железе |

## Что делает человек-художник параллельно
Скульпт и ретопология «героев» (червь, скала-доминанта, лица), финальные текстуры в Substance, одежда в Marvelous Designer, мокап, запись музыки и голосов. Агенты готовят для этого ТЗ и автоматизируют импорт/проверку.
