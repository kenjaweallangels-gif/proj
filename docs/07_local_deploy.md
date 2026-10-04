# Локальное развёртывание «Rakis: Heretics» на ПК

Документ описывает, как развернуть проект из архива у себя на компьютере: запустить играбельное браузерное демо,
пересобирать его, перегенерировать голоса и музыку, гонять автотесты и продолжать разработку через Claude Code
(и других агентов) — без ограничений облачной среды (размер сборки, CPU-рендер, общий сервер).

Два продукта в одном репозитории:

| Часть | Где | Что нужно, чтобы запустить |
|---|---|---|
| **Браузерное демо** (Three.js/WebGL, играбельно) | `Web/` | Node.js 20+ и браузер. Готовая сборка уже лежит в `Web/dist/rakis_demo.html` |
| **Проект Unreal Engine 5.6** (C++ модуль, скрипты, данные) | `Source/`, `Content/`, `Tools/`, `Config/`, `Rakis.uproject` | UE 5.6 + Visual Studio 2022 (см. `docs/05_install.md`) |

Данные (`Content/Rakis/Data/*.csv`: диалоги, сюжет, погода, звук) общие для обеих частей.

---

## 1. Требования

### 1.1 Железо

| | Минимум (демо играбельно) | Рекомендуется (high, 60 fps 1440p) | Для UE-проекта |
|---|---|---|---|
| Видеокарта | дискретная с WebGL2: GTX 1060 / RX 580 / Apple M1, 4 ГБ | RTX 3060 Ti / RX 6700 XT / Apple M2 Pro и выше, 8 ГБ+ | RTX 3060 12 ГБ+, комфортно 16 ГБ |
| Процессор | 4 ядра, 2018+ | 6–8 ядер | 8+ ядер |
| ОЗУ | 8 ГБ | 16 ГБ | 32–64 ГБ |
| Диск | 2 ГБ (с node_modules) | 5 ГБ (+ модели TTS ~0.5 ГБ) | 300+ ГБ NVMe (движок + DDC) |

Встроенная графика Intel HD/UHD работает только на `?q=low`. Программный рендер (без GPU) — только для автотестов.

### 1.2 Программы

**Обязательно для демо**
- **Браузер:** Chrome/Edge 120+ (рекомендуется), Firefox 120+, Safari 17+. Включено аппаратное ускорение
  (Chrome: `chrome://settings/system` → «Использовать аппаратное ускорение»; проверка — `chrome://gpu`, строка WebGL2: *Hardware accelerated*).
- **Node.js 20 LTS или 22 LTS** (с npm) — для сборки и локального сервера. https://nodejs.org или `nvm`.
- **Git** (+ Git LFS для UE-ассетов; веб-демо LFS не требует).

**Для пересборки голосов и музыки** (не нужно, если играете готовой сборкой)
- **Python 3.10–3.12** и пакеты из `Tools/requirements.txt` (`numpy`, `piper-tts`, `onnxruntime`).
- **ffmpeg** с `libopus` и `rubberband` (Windows: `winget install Gyan.FFmpeg`; macOS: `brew install ffmpeg rubberband`;
  Ubuntu: `sudo apt install ffmpeg rubberband-cli`).
- Интернет при первом запуске: модели голосов Piper скачиваются с huggingface.co (~60 МБ на голос) в `Tools/tts/models/` (в git не кладутся).

**Для автотестов**
- Chromium из Playwright: `cd Web && npx playwright install chromium` (~150 МБ).

**Для разработки агентами**
- **Claude Code**: `npm install -g @anthropic-ai/claude-code`, затем `claude` → `/login` (подписка Pro/Max или API-ключ Anthropic).
- По желанию: Codex CLI, Kimi Code CLI, Cursor — см. `docs/05_install.md` и `docs/03_orchestration.md`.

**Для UE-проекта:** Unreal Engine 5.6, Visual Studio 2022 (workload «Game development with C++»), Blender 4.5 LTS — подробно в `docs/05_install.md`.

### 1.3 Сеть
Игре сеть не нужна (всё вшито в HTML). Сеть нужна только для `npm install`, моделей TTS, текстур
(`node tools/fetch_textures.mjs`, CC0 с Poly Haven) и агентов.

---

## 2. Быстрый старт (5 минут)

1. Распакуйте архив, например в `C:\Projects\rakis_heretics` или `~/projects/rakis_heretics`.
2. **Просто поиграть:** откройте `Web/dist/rakis_demo.html` двойным щелчком (Chrome/Edge). Всё работает офлайн.
3. **Через локальный сервер (рекомендуется):**
   - Windows (PowerShell):
     ```powershell
     cd C:\Projects\rakis_heretics
     powershell -ExecutionPolicy Bypass -File scripts\setup_web.ps1
     ```
   - Linux / macOS / WSL2:
     ```bash
     cd ~/projects/rakis_heretics
     bash scripts/setup_web.sh
     ```
   Скрипт проверит Node, поставит зависимости (`npm ci`), соберёт демо и откроет http://localhost:8080.
   Флаги: `--no-run` / `-NoRun` (только собрать), `--tools` / `-Tools` (ещё Python-инструменты и Chromium для тестов).

### Вручную
```bash
cd Web
npm ci                 # зависимости (three, esbuild, playwright, sharp)
npm run build          # данные CSV → src/data, запекание пещер сиетча (если устарело), сборка → dist/rakis_demo.html
npm run serve          # раздать готовую сборку: http://localhost:8080
npm run dev            # режим разработки: пересборка при каждом изменении src/ (обновите вкладку)
```

---

## 3. Управление и параметры запуска

**Управление (клавиатура/мышь), вид только от первого лица:** WASD — ходьба, мышь — обзор (клик по окну захватывает курсор), Shift — бег,
C (или удерживать Alt) — «шаг пустыни» (неритмичная походка, не привлекает червя), Space — прыжок
(в шаге пустыни — сбить ритм), ПКМ — сбить ритм, E — взаимодействие (занавеси, двери, управление харвестером),
T — тампер, M — маска дистикомба, Esc — пауза/меню (погода, время суток, сценарии, качество),
F — свободная камера в сценах червя, P — фоторежим, F3 — профайлер. Геймпад поддерживается. Покачивание головы при ходьбе отключается в меню паузы («Покачивание головы»).

**URL-параметры** (дописываются к адресу, например `http://localhost:8080/?q=high&lang=EN`):

| Параметр | Значения | Что делает |
|---|---|---|
| `q` | `low` / `med` / `high` | качество; без параметра выбирается автоматически по видеокарте |
| `lang` | `RU` / `EN` | язык субтитров и интерфейса |
| `skip=1` | | без титульного экрана |
| `at` | `start, erg, P4, worm, A3, trail, cleft, sietch, market, hall, garden, finale` | старт с точки |
| `drs=0` | | выключить динамическое разрешение |
| `fps=N` | | ограничить частоту кадров |
| `warm=0` | | без прогрева шейдеров на загрузке (быстрее старт, возможны подтормаживания в начале) |
| `perf=1` | | профайлер сразу включён |

Сценарии из меню паузы: «Червь пожирает харвестер», быстрые переходы по точкам.

---

## 4. Пересборка контента без ограничений размера

В облачной среде сборку держали ≤16 МБ (лимит публикации). Локально лимита нет — можно поднять качество.

### 4.1 Голоса (Piper TTS → Opus)
```bash
python -m venv .venv && . .venv/bin/activate         # Windows: .venv\Scripts\activate
pip install -r Tools/requirements.txt
python Tools/tts/piper_build.py                       # все реплики → Web/src/assets/vo.js
python Tools/tts/piper_build.py --bitrate 64          # выше качество (больше размер)
python Tools/tts/piper_build.py --only DLG_A1_001 --keep-wav ./vo_wav   # прослушать отдельные реплики
cd Web && npm run build
```
Тексты реплик — `Content/Rakis/Data/*Dialogue*.csv` (колонки RU/EN/`Line_Native`), язык — `docs/lore/language.md`.
После правки CSV: `python Tools/validate_data.py --strict`.

### 4.2 Музыка (синтез стемов → Opus)
```bash
python Tools/tts/music_build.py                       # → Web/src/assets/music.js
python Tools/tts/music_analyze.py --help              # анализ громкости/спектра отрендеренных фрагментов
cd Web && node tools/music_render.mjs                 # офлайн-рендер состояний музыки в WAV для прослушивания
```
Уровни состояний — таблица `CAL` в `Web/src/audio/music.js`.

### 4.3 Текстуры
`node Web/tools/fetch_textures.mjs` — скачивает CC0-текстуры Poly Haven и вшивает в `Web/src/assets/textures.js`
(разрешение задаётся в скрипте; локально можно 2K).

### 4.4 Пещеры сиетча
`cd Web && npm run bake` — перезапекает SDF-меш пещер (`src/assets/sietch_cave.js`), если менялась раскладка в `src/sietch/`.

---

## 5. Автотесты (на своей видеокарте — в разы быстрее облака)

```bash
cd Web
npx playwright install chromium        # один раз
npm test                               # smoke: ключевые точки + скриншоты в dist/shots/
npm run check                          # свободное движение: плавность, прыжок, тропа ↔ сиетч, спрыгнуть с уступа
node tools/sietch_route.mjs --file=rakis_demo.html --leg=both   # сиетч ↔ сад
node tools/worm_freecam_scenes.mjs --scene=devour --file=rakis_demo.html   # сцена поедания, кадры
node tools/gait_probe.mjs              # высота таза в ходьбе (нет «приседа»)
node tools/perf_cpu.mjs                # CPU по модулям в ключевых точках → dist/perf/report.json
```
Тесты по умолчанию запускают Chromium с программным рендером (SwiftShader). На своей машине можно использовать GPU:
в `tools/lib/harness.mjs` набор `GL.default`, или `CHROMIUM=/путь/к/chrome node tools/...`.

---

## 6. Разработка через Claude Code локально

```bash
npm install -g @anthropic-ai/claude-code
cd rakis_heretics
git init && git add -A && git commit -m "import"   # если распаковано из архива без .git (агентам нужен git: worktree, ветки)
claude                                              # /login при первом запуске
```
- `CLAUDE.md` → `AGENTS.md`: правила проекта (зоны файлов, формат handoff, стиль коммитов, канон).
- `.claude/agents/*.md` — ролевые субагенты (оркестратор, геймдизайнер, левел-, окружение-, персонажи, техарт, аниматор,
  программист, звук, QA). Главная сессия работает оркестратором: декомпозирует и раздаёт задачи субагентам.
- `.claude/commands/`: `/sprint`, `/handoff <ID>`, `/review <ID>`.
- `.claude/settings.json` — разрешения (запрещены `rm -rf`, `git push --force`, `git lfs prune`).
- Параллельные агенты работают в git worktree (`.claude/worktrees/`, в git не попадают) и сливаются в основную ветку.
- История задач и передачи — `orchestrator/tasks.yaml`, `orchestrator/handoffs/*.md`; мультидвижковый режим
  (Codex, Kimi) — `python3 orchestrator/orchestrator.py status|run|approve` (см. `docs/03_orchestration.md`).

Практика: просите агента проверять изменения тестами из раздела 5 и скриншотами; при работе на своей видеокарте
профилируйте в браузере (F3, Chrome DevTools → Performance).

---

## 7. Публикация и раздача
- `Web/dist/rakis_demo.html` — один самодостаточный файл: можно положить на любой статический хостинг
  (GitHub Pages, Netlify, itch.io как HTML5-игру) или передать файлом.
- `bash scripts/make_release.sh` — собрать архив проекта (`release/*.zip`) из текущего коммита.

---

## 8. Частые проблемы

| Симптом | Причина / решение |
|---|---|
| Чёрный экран, «WebGL2 not supported» | аппаратное ускорение выключено или драйвер в чёрном списке: обновите драйвер, включите ускорение, `chrome://gpu` |
| Низкий FPS | `?q=low`, закройте вкладки; на ноутбуке — дискретная видеокарта для браузера (Windows: Параметры → Дисплей → Графика) |
| Нет звука | браузер требует действия пользователя: кликните по окну; проверьте громкость в меню паузы |
| Долгая первая загрузка | прогрев шейдеров (до ~10–20 с на слабых GPU); `?warm=0` — быстрее старт ценой подтормаживаний |
| Курсор не захватывается | кликните по игре; Esc освобождает курсор и открывает паузу |
| `npm ci` ругается на версию | нужен Node 20+ (`node -v`) |
| `sharp` не ставится (Windows/ARM) | `npm install --include=optional sharp` или удалите `sharp` из devDependencies (нужен только для текстур) |
| `piper` не находит модель | нет интернета при первом запуске; положите `.onnx` и `.onnx.json` в `Tools/tts/models/` вручную |
| ffmpeg: Unknown encoder 'libopus' | сборка ffmpeg без opus — поставьте полную (gyan.dev full / brew / apt) |
| Тесты Playwright: «Executable doesn't exist» | `npx playwright install chromium` |

---

## 9. Состав архива

```
AGENTS.md, CLAUDE.md, README.md      правила и обзор
.claude/                             субагенты, команды, разрешения Claude Code
.cursor/, .codex/                    конфигурации Cursor и Codex
docs/                                GDD, сценарий, стандарты, лор, арт/звук/тех-спеки, этот документ
orchestrator/                        доска задач, маршрутизация агентов, handoff-ы
Web/                                 браузерное демо: src/, tools/ (сборка, тесты), dist/ (готовая сборка)
Content/Rakis/Data/                  общие данные (CSV)
Source/Rakis/, Config/, Rakis.uproject   проект UE 5.6 (C++)
Tools/                               Blender, Unreal Python, TTS/музыка, валидатор, requirements.txt
scripts/                             установка (setup_web.*, install_*), архив (make_release.sh)
```
