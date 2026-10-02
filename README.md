# Rakis: Heretics — вертикальный срез с мультиагентной разработкой

Пакет для Cursor, в котором разработку ведут агенты трёх движков — **Claude Code**, **OpenAI Codex CLI** и **Kimi Code CLI** — под управлением оркестратора. Каждый агент играет одну роль из производственной команды (геймдизайнер, левел-дизайнер, художники, техарт, аниматор, программист, звук, QA).

## Что умеют и чего не умеют агенты

Агенты пишут код (C++, Blueprint-спецификации, Python для Unreal и Blender, HLSL), проектные документы, диалоги, таблицы данных, процедурные генераторы (PCG, Houdini/Blender-скрипты), расстановку объектов через MCP, промпты для генераторов концептов и 3D-болванок, проводят ревью и проверки бюджетов.
Агенты **не заменяют** художника в скульпте, ретопологии, финальной текстуре, мокапе и сведении музыки. Там они готовят ТЗ, чек-листы, автоматизируют рутину и проверяют результат. Человек-продюсер (вы) утверждает всё на «воротах» (gates).

## Состав пакета

| Путь | Назначение |
|---|---|
| `AGENTS.md` | Общие правила проекта. Читают Cursor, Codex, Kimi (и Claude через `CLAUDE.md`) |
| `CLAUDE.md` | Точка входа Claude Code, импортирует `AGENTS.md` |
| `.claude/agents/*.md` | **Единый источник** ролевых промптов (субагенты Claude Code; оркестратор передаёт их же в Codex и Kimi) |
| `.claude/commands/*.md` | Слэш-команды: `/sprint`, `/handoff`, `/review` |
| `.claude/settings.json` | Разрешения Claude Code |
| `.cursor/rules/*.mdc` | Правила Cursor по типам файлов и ролям |
| `.cursor/mcp.json` | MCP-серверы: Unreal, Blender |
| `.codex/config.toml` | Шаблон конфигурации Codex |
| `orchestrator/` | Оркестратор на Python: доска задач, маршрутизация по движкам, ревью, журнал передач |
| `docs/00_GDD.md` | Дизайн-документ среза (мир, сцена, персонажи, механики) |
| `docs/01_scenario.md` | Сценарий сцены 3:40 |
| `docs/02_agent_roster.md` | Роли, движки, зоны ответственности |
| `docs/03_orchestration.md` | Протокол взаимодействия агентов |
| `docs/04_standards.md` | Структура проекта UE, нейминг, бюджеты |
| `docs/05_install.md` | Установка всего ПО (bash) |
| `scripts/install_ubuntu.sh` | Автоустановка на Ubuntu 22.04/24.04 (и WSL2) |
| `scripts/install_windows.ps1` | Windows-часть (Unreal, Visual Studio, Cursor) |
| `scripts/bootstrap_project.sh` | Инициализация репозитория, Git LFS, папок |

## Быстрый старт

```bash
bash scripts/install_ubuntu.sh --all        # установить ПО (см. docs/05_install.md)
bash scripts/bootstrap_project.sh           # git, LFS, структура
claude    # /login    ; codex login ; kimi → /login
python3 orchestrator/orchestrator.py status               # доска задач
python3 orchestrator/orchestrator.py run --dry-run        # посмотреть, что будет запущено
python3 orchestrator/orchestrator.py run --max 2          # запустить 2 готовые задачи
python3 orchestrator/orchestrator.py approve T-003        # ваше решение на «воротах»
```

Альтернатива без скрипта: откройте проект в Cursor, в терминале запустите `claude` и скажите: «Работай как orchestrator, возьми следующий спринт из orchestrator/tasks.yaml».

## Правовое

Вселенная «Дюны» — лицензируемая IP. Пакет рассчитан на прототип и портфолио; для коммерческого релиза нужна лицензия или переработка в собственный сеттинг.
