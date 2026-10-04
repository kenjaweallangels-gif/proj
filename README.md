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

## Локальное развёртывание на ПК
Полная инструкция (требования, установка на Windows/macOS/Linux, пересборка голосов и музыки без ограничений размера, автотесты, разработка через Claude Code) — **`docs/07_local_deploy.md`**. Коротко: `bash scripts/setup_web.sh` или `powershell -ExecutionPolicy Bypass -File scripts\setup_web.ps1` → http://localhost:8080.

## Играть сразу, без установки
- **Ссылка:** https://claude.ai/artifact/VXyAbup6nN6HFRMLRjet96 (браузерная версия, открывается сразу).
- **Файл:** `Web/dist/rakis_demo.html` — скачайте и откройте двойным щелчком (Chrome/Edge/Firefox, работает офлайн).
- Исходники браузерной версии и сборка — `Web/` (см. `Web/README.md`). Проект UE5 остаётся основным; браузерная версия использует те же данные (`Content/Rakis/Data/*.csv`) и сценарий.

## Играбельное демо (UE 5.6)

Что сделано в спринте S1 (см. `docs/06_demo_contract.md` и `orchestrator/handoffs/`):
- **C++ модуль `Source/Rakis`** — персонаж 1/3 лица, шум шагов и неритмичная «походка по песку», жара и влага, червь 360 м (сплайн + кольца, состояния Dormant→Listening→Approach→Surface→Pass, пасть-лепестки, зубы), тампер, двери-уплотнители, фальшивый камень, точки интереса; погода и время суток (9 пресетов, буря на горизонте), зоны и стриминг, адаптивная музыка, толпа сиетча и спутники, кат-сцены, диалоги RU/EN, сюжетный директор, минималистичный Slate-HUD, меню паузы и фоторежим.
- **Генераторы:** Blender (`Tools/blender/env_*` — дюны-heightmap, скала «Коготь Шайтана», червь, кит сиетча из 46 модулей) и редакторные скрипты (`Tools/unreal_python/*` — материалы, MPC, пост-эффекты марева и пыли, Niagara, свет, блокаут, разметка, декор, данные).
- **Данные:** `Content/Rakis/Data/*.csv` — 110 реплик, 88 «лаев», 60 сюжетных битов, 9 погодных пресетов, 58 звуковых событий, 8 архетипов толпы (`python3 Tools/validate_data.py --strict`).

**Спринт S2:** весь C++ и Python сверен с документацией UE 5.6 (исправления — в разделах «S2» handoff-ов T-005, T-W01, T-U01, T-015, T-017, T-018); следы на песке (шаги, спутники, борозда и кратер червя, заметание ветром); толпа сиетча на Smart Objects + StateTree с LOD по дистанции; склейки золотого пути (`Ellipsis`); `landscape_import.py`.

### Как собрать и запустить
```bash
# 1. Генерация мешей и рельефа (вне UE)
python3 Tools/blender/env_dunes.py                       # Export/heightmap_desert_r16.png
blender -b -P Tools/blender/env_rock.py -- --preset default
blender -b -P Tools/blender/env_worm.py
blender -b -P Tools/blender/env_sietch_kit.py
# 2. Сборка C++ (Windows: Build.bat RakisEditor Win64 Development -Project=...; см. docs/05_install.md §4)
# 3. В редакторе: Tools → Execute Python Script → Tools/unreal_python/build_demo.py
#    (или UnrealEditor-Cmd Rakis.uproject -run=pythonscript -script=Tools/unreal_python/build_demo.py)
# 4. Ландшафт из heightmap — вручную (Landscape Mode → Import), параметры в docs/level/layout.md; затем повторить build_demo
# 5. Открыть L_Rakis_Persistent → Play
```
Управление (вид от первого лица): WASD/мышь, Shift — бег, C или Alt — шаг пустыни, Space — прыжок (в шаге пустыни — сбить ритм), E — действие, T — тампер, M — маска, F — свободная камера в сценах червя, P — фоторежим, F3 — профайлер, Esc — пауза. Геймпад поддерживается.

**Честно о статусе:** код не компилировался (в среде агентов нет UE) — первая сборка, вероятно, потребует мелких правок API (список рисков — в handoff T-005, T-U01, T-W01). Системы Niagara создаются из шаблонов, их стеки собираются вручную по `docs/tech-art/fx.md`. Фотореализм финального уровня требует ассетов Megascans/MetaHuman и работы художника — ТЗ лежат в `docs/art/**`. Без ассетов демо проходится целиком на блокауте.

## Правовое

Вселенная «Дюны» — лицензируемая IP. Пакет рассчитан на прототип и портфолио; для коммерческого релиза нужна лицензия или переработка в собственный сеттинг.
