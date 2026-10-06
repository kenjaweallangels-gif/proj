"""Стенд очков: проверка и замеры реальных AR-очков на ПК (VITURE, XREAL) до и после подключения SDK.

Модули:
  detect.py         — найти очки на USB и как монитор, перечислить камеры;
  pose_bridge.py    — поза головы → WebSocket (симулятор и lab.html), источники demo / replay / viture / xrlinux;
  imu_analyze.py    — анализ записи позы: частота, рывки, дрейф, шум → файл замеров для симулятора;
  camera_check.py   — камера очков (UVC): разрешение, частота кадров, метки ArUco в кадре;
  measurement.py    — файл замеров pkg2-demo-web/measurements/<модель>.json (общий с симулятором).
Порядок работы — docs/12_glasses_lab.md и prompts/12_glasses_lab.md.
"""
