# Передача проекта: продолжение работы на ПК (Ubuntu, RTX 3060 6 ГБ, Codex CLI)

Этот каталог — всё, что нужно, чтобы продолжить разработку локально силами агентов (Codex CLI, а также
Claude Code или Kimi Code), не потеряв логику проекта и уровень качества.

| Файл | Что внутри |
|---|---|
| `../../AGENTS.md` | Правила для агентов. Codex читает его автоматически |
| `VISION.md` | Все ваши требования из переписки — главный ориентир |
| `SIMULATOR-DESIGN.md` | Концепция гиперреалистичного симулятора космонавта: физика, тело, системы станции, восприятие, графика, оптимизация |
| `STATUS.md` | Что готово, что лежит в WIP-ветках и в каком состоянии |
| `ROADMAP.md` | Пакеты работ по порядку, зависимости, что можно делать параллельно |
| `BUDGETS.md` | Бюджеты производительности и видеопамяти под RTX 3060 6 ГБ |
| `DIAGRAMS.md` | Схемы: модули, кадр рендера, системы координат, состояния игрока, шлюз, челнок, сценарии |
| `MOCKUPS.md` | Макеты интерфейса: панель времени, телескоп, кабина челнока, HUD скафандра и т. д. |
| `QA-CHECKLIST.md` | Как проверять качество и производительность перед слиянием |
| `prompts/` | Готовые промпты на каждый пакет работ, вставляются в Codex как есть |
| `../agent-tasks/` | Подробные техзадания, которые агенты писали по ходу работы (проверки на GPU и др.) |

## 1. Подготовка ПК (один раз)

```bash
# драйвер NVIDIA (проприетарный) и Vulkan
nvidia-smi                       # должна показаться RTX 3060
sudo apt install vulkan-tools && vulkaninfo --summary | head -20
# Node.js 20+ LTS (например через nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install --lts
# проект
git clone https://github.com/kenjaweallangels-gif/proj.git aurora && cd aurora
git checkout ccr-34534372-jyhirs
npm ci
npx playwright install chromium   # браузер для инструментов проверки
npm run dev                       # http://127.0.0.1:5173/ — откройте в Chrome
```

В Chrome откройте `chrome://gpu`: WebGL2 должен быть «Hardware accelerated», а в строке GL_RENDERER должна быть
NVIDIA. Если стоит llvmpipe или SwiftShader, запустите Chrome с флагами
`--ignore-gpu-blocklist --use-angle=vulkan --enable-features=Vulkan`. На ноутбуке с двумя видеокартами добавьте
перед командой `__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia`.

## 2. Codex CLI

```bash
npm i -g @openai/codex            # или по инструкции на github.com/openai/codex
codex --version && codex --help   # флаги меняются между версиями: сверяйтесь с --help
cd aurora && codex                # интерактивно; AGENTS.md подхватится сам
```

Рекомендуемые настройки, в `~/.codex/config.toml` или флагами:
- самая сильная доступная модель и высокий уровень рассуждений (reasoning effort high);
- песочница с правом записи в рабочую папку (`--sandbox workspace-write`) и подтверждения по запросу. Для
  длинных пакетов подойдёт режим `--full-auto`: агент сам запускает сборку и тесты в пределах проекта.

Неинтерактивный запуск пакета: `codex exec "$(cat docs/handoff/prompts/03-player-body.md)"`.
Лучше запускать интерактивно и проверять результат по `QA-CHECKLIST.md`.

## 3. Как вести несколько агентов параллельно

Каждый пакет работ ведите в своей ветке и отдельной рабочей копии, чтобы агенты не мешали друг другу:

```bash
git worktree add ../aurora-earth -b feat/earth wip/earth
cd ../aurora-earth && npm ci && codex   # промпт prompts/01-earth.md
```

- Параллельно можно вести пакеты, которые в `ROADMAP.md` помечены как независимые; конфликтующие — по очереди.
- Сливайте в основную линию по одному: `git merge`, затем `npx vite build`, `npm run smoke`, скриншоты.
- В промптах указано, какие файлы пакет вправе менять. Это главный способ избежать конфликтов.

## 4. Порядок работ

Сначала пакет 00 — свести WIP-ветки (см. `STATUS.md`). Потом пакеты по `ROADMAP.md`. После каждого пакета
обновляйте `STATUS.md`. Промпты для Claude Code и Kimi Code те же самые: они тоже читают AGENTS.md, если
попросить, а Claude Code — ещё и CLAUDE.md, если вы его создадите со ссылкой на AGENTS.md.

## 5. Если что-то пошло не так

- Сборка сломалась после слияния: `git log --oneline -5`, затем `git revert <коммит>` и разбор по пакету.
- Агент «улучшил» что-то вне своего пакета: откатите эти файлы `git checkout main -- <файлы>` и напомните ему о
  границах из промпта.
- Мало fps: запустите регулятор качества с HUD-индикатором и `GPU=1 node tools/cpuframe.mjs`, чтобы найти,
  что дорого — CPU или GPU. См. `BUDGETS.md`.
