# 12. Стенд очков: замеры реальных очков и подключение к симулятору

Контекст: `docs/12_glasses_lab.md` (порядок работы), `tools/glasses_lab/` (detect, pose_bridge, imu_analyze, camera_check,
measurement), `pkg2-demo-web/lab.html` и `src/lab/`, `pkg2-demo-web/src/galley/{measured,pose_link,software}.js`.
Выполнять, когда очки подключены к ПК. Без очков — только шаги 1 и 6 на синтетике (`--source demo`).

Правила: имена функций SDK — только из заголовков `vendor/viture/` (AGENTS.md, п. 2). XRLinuxDriver — GPL: запускать
отдельной программой и читать её вывод, не линковать (п. 9). Кадры камеры не сохранять (п. 8).

Задача:
1. Запустить `make lab-detect` и `lab.html` на экране очков; если VID XREAL не совпал — поправить `KNOWN_VIDS` и тест.
2. VITURE: после prompts/11 реализовать `VitureSource.read()` в `pose_bridge.py` (кватернион головы, Y вверх, −Z вперёд;
   перевести из СК SDK по документации SDK — с тестом на известный поворот).
3. Запись в покое 5 мин → `imu_analyze --still --save viture-luma-ultra`; проверить, что симулятор показывает «Измерено …».
4. XREAL на Linux: установить XRLinuxDriver, найти в его документации формат вывода IMU, реализовать `XrLinuxSource.read()`
   (отдельный процесс/файл/сокет — как описано в документации драйвера), тест на записанном образце вывода.
5. Камера VITURE: `make lab-camera CAM=…` с метками стапеля; частоту и найденные метки записать в `docs/09_hardware_glasses.md`.
6. Заполнить `pkg2-demo-web/measurements/<id>.json` для обеих моделей (форма M на стенде), закоммитить.

Критерии приёмки:
- `make test` и `npm test` зелёные;
- для обеих моделей есть `measurements/<id>.json` минимум с `nits`, `fovDiag`, `transmit`, `refresh`, `weightG`;
- для VITURE в замерах есть `driftDegMin`, `poseNoiseDeg`, `imuHz` из записи;
- `galley.html?pose=1` поворачивает взгляд в симуляторе вслед за головой в очках, `lab.html` → «Поза головы» показывает
  неподвижную сетку при поворотах (видимое отставание записано как задержка).
