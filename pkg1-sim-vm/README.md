# Пакет 1. Имитация очков на ПК/ВМ Ubuntu и разработка ПО

Цель: разрабатывать и тестировать всё ПО AR-сборки **без очков** — на синтетической камере, записях и 3D-симуляторе,
а на пилоте подключить VITURE Luma Ultra заменой одного источника (`AR_RIG=viture`). Архитектура — `../docs/01_architecture.md`.

## Требования

| | Минимум (ядро, сервер, тесты) | Рекомендуется (+ 3D-симулятор) |
|---|---|---|
| ОС | Ubuntu 22.04/24.04 x86_64, ВМ подходит | Ubuntu 24.04 на железе или ВМ с пробросом GPU |
| CPU / RAM | 4 ядра / 8 ГБ | 8 ядер / 16–32 ГБ |
| GPU | не нужен (llvmpipe) | NVIDIA RTX 3060 и выше, драйвер `ubuntu-drivers` |
| Диск | 15 ГБ | 40 ГБ (модели, записи сеансов) |
| Сеть | для установки пакетов | + Wi-Fi 5 ГГц цеха для пилота |

Про ВМ, VMware/VirtualBox, VFIO, WSL2 и работу без GPU — `setup/ubuntu/vm_gpu_notes.md`.

## Установка на Ubuntu (по шагам)

```bash
git clone <ваш-репозиторий> ar-assembly && cd ar-assembly/pkg1-sim-vm
bash setup/ubuntu/00_check_system.sh        # что за машина: CPU, RAM, GPU, OpenGL/Vulkan
bash setup/ubuntu/01_install_base.sh        # apt: python3, ffmpeg, v4l-utils, mesa, poppler, portaudio, Node 24, gltf-transform, Docker
bash setup/ubuntu/02_install_godot.sh       # Godot 4.7-stable → ~/.local/bin/godot
bash setup/ubuntu/03_install_python.sh      # .venv + requirements.txt (OpenCV, FastAPI, SQLAlchemy, Vosk, cascadio…)
bash setup/ubuntu/04_install_models.sh      # Vosk small-ru-0.22 (45 МБ, офлайн-распознавание)
sudo bash setup/ubuntu/05_v4l2loopback.sh   # (необязательно) виртуальная камера /dev/video10 «AR-Glasses-Sim»
```
После `01_install_base.sh` перелогиньтесь (группа docker). Проверка: `make test`.

## Быстрый старт

```bash
make test             # 48 тестов: пакет, ТП CSV→JSON, трекинг на синтетике, шаги, голос, сервер, инструменты, UDP
make sim-cli          # ядро на синтетической камере: поза, ошибка в мм, шаги, проверка масштаба меток
make godot-assets     # текстуры меток и GLB-заглушки для Godot (один раз)
make sim              # ядро + окно Godot: вид «глазами сборщика» с окном дисплея 52°
make server           # сервер участка :8080, Swagger на /docs (SQLite; PostgreSQL — make db-up + DATABASE_URL)
make replay-test      # записать сеанс в формате EuRoC и прогнать ядро по записи — так же пойдут записи с очков
make markers          # листы меток ArUco A4 300 dpi для печати 1:1
make package-040      # собрать пакет операции из таблиц технолога (CSV) — пример data/examples/op040_csv
```

Пример вывода `make replay-test` (150 кадров с помехами; проверено 01.10.2026, OpenCV 5.0):
```
[  120] привязка 120/120  ошибка   0.98 мм  шаг 1/6 «Привязка к ложементу» [showing]
Итог: кадров 150, с привязкой 150, медиана ошибки 0.66 мм, p95 6.7 мм, масштаб ок: True (1.012)
```
p95 выше цели 4 мм из-за кадров с 1–2 метками — разбор и задача на улучшение в `../docs/06_testing.md`.

## Что внутри

```
core/arcore/
  hal.py                 контракты: FrameSource, PoseSource, ImuSource, AudioSource, DisplaySink, Rig, make_rig()
  rigs/sim_synthetic.py  синтетическая камера очков: метки с известной позой, помехи цеха, истинная поза
  rigs/replay.py         проигрывание записей EuRoC (cam0, imu0, pose_gt)
  rigs/viture.py         VITURE Luma Ultra: камера UVC работает, 6DoF — после получения SDK (prompts/11)
  tracking/aruco.py      метки → поза изделия (SQPnP + LM, одиночная метка — IPPE)
  tracking/registration.py  проверка масштаба (Umeyama, медиана за 15 кадров), сглаживание позы
  steps/engine.py        машина состояний шагов: привязка, норма времени, ввод значения, фото, журнал
  voice/commands.py      грамматика Vosk, слово-активатор «сборка», числа голосом («один и два» → 1,2)
  net/udp.py             UDP JSON к клиенту отображения (:47100) и от него (:47101)
  app.py                 главный цикл: Rig → трекер → фильтр → шаги → клиент
server/                  FastAPI + SQLAlchemy: пакеты, выполнения, журнал, фото по команде, чат (WebSocket)
tools/                   STEP→GLB, сверка BOM↔GLB, ТП CSV→JSON, метки для печати, КД PDF→PNG, запись сеансов, GLB-заглушки
godot/                   клиент и симулятор вида из очков (Godot 4.7), см. godot/README_GODOT.md
tests/                   pytest
prompts/                 11 промптов для ИИ-ассистента с критериями приёмки (порядок — prompts/00_how_to_use.md)
setup/ubuntu/            скрипты установки и заметки по ВМ/GPU
```

## Как переключить источник (имитация → очки)

| `AR_RIG` | Источник кадров | Поза для оценки | Когда |
|---|---|---|---|
| `sim` | синтетическая камера Python | истина | разработка трекинга и шагов, CI |
| `replay` | запись EuRoC (`--replay папка`) | `pose_gt.csv`, если есть | регрессия на реальных записях |
| `viture` | UVC-камера очков (`--camera /dev/videoN`) | SDK (после prompts/11) | стенд и пилот |

Остальной код не меняется — это и есть смысл HAL.

## Разработка с ИИ (Cursor / Claude Code)

Откройте корень репозитория. Ассистент читает `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/`. Дальше — по одному промпту
из `prompts/` за раз, с проверкой критериев приёмки командами. Советы и риски вайбкодинга — `../docs/08_risks_and_vibecoding.md`.
