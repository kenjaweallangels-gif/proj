# 11. VitureRig: реальные очки VITURE Luma Ultra

Контекст: `core/arcore/rigs/viture.py` (заглушка), `docs/02_hal_contracts.md` (раздел «Реальные очки»),
`docs/09_hardware_glasses.md`. **Нужен VITURE XR Glasses SDK** (https://www.viture.com/developer) — положить заголовки
и библиотеку в `vendor/viture/` (не коммитить, если лицензия запрещает).

Правило: имена функций, структур и констант SDK брать ТОЛЬКО из заголовков в `vendor/viture/`. Если чего-то нет —
остановиться и спросить, приложив путь к заголовку. Сторонний пример для сверки: github.com/brianhasquestions/Viture_AR_Playground.

Задача:
1. `rigs/viture_sdk.py`: обёртка cffi/ctypes над функциями инициализации, 6DoF-позы и IMU из SDK → PoseSource, ImuSource.
2. Камера: UvcCamera уже есть (MJPEG); калибровка — `calib/viture_cam.yaml` из промпта 05.
3. Калибровка «камера ↔ дисплей»: стенд с меткой на 0,6 м, сборщик совмещает перекрестие (клавиши) по 5 точкам →
   смещение и поворот дисплея относительно камеры, `calib/viture_display.yaml`. Godot-клиент рисует с этой поправкой.
4. Вывод в очки: окно Godot на втором мониторе (очки как DisplayPort Alt Mode), стерео side-by-side 3840×1200 при
   включённом SBS-режиме; IPD из конфига.
5. Запись сеанса с очков: `tools/record_euroc.py --rig viture` (кадры + поза SDK + IMU) — для ReplayRig.

Критерии приёмки: на реальном изделии с 4 метками измерено видимое смещение голограммы линейкой в 5 точках,
≤ 10 мм на 0,6 м (порог 06_testing.md); запись сеанса проигрывается `make replay-test` с тем же результатом.
