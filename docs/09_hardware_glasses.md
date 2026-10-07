# 09. Очки и параметры для симулятора

Данные на 25.09.2026. Полное сравнение 22 устройств — в таблице «Сравнение_AR_очков_для_сборки.xlsx».

## VITURE Luma Ultra (пилот)
| Параметр | Значение | Источник |
|---|---|---|
| Оптика | birdbath, Sony Micro-OLED | viture.com |
| Разрешение | 1920×1200 на глаз, 120 Гц | viture.com |
| Поле дисплея | 52° по диагонали (≈45° × 29°) | viture.com |
| Яркость | до 1500 нит | viture.com |
| Затемнение | электрохром, пропускание 0,5–40 % | viture.com |
| Трекинг | 6DoF (стерео VIO «Carina») | VITURE SDK |
| Камеры | RGB 1080p (MJPEG по UVC) + 2 серые для трекинга | VITURE SDK, сторонний пример |
| Вес | ≈83 г (данные магазинов) | Vizzion, Virtuality Club |
| Питание | без батареи: от хоста USB-C DP Alt Mode, Pro Neckband (4+ ч) | viture.com |
| SDK | VITURE XR Glasses SDK (C): Linux, Windows, Android, macOS; закрытый, через программу разработчиков | viture.com/developer |
| Цена в РФ | 62 900–79 900 ₽ | Vizzion, Virtuality Club, virtualnyeochki.ru |

## Параметры для SimRig (`pkg1-sim-vm/core/arcore/rigs/sim_synthetic.py`)
```yaml
camera:            # RGB-камера очков — до калибровки реальной камеры берём оценку
  width: 1920
  height: 1080
  hfov_deg: 80     # оценка; заменить значением из калибровки (cv2.calibrateCamera по ChArUco)
  dist: [0, 0, 0, 0, 0]
display:
  fov_diag_deg: 52
  aspect: 1.6      # 1920×1200
  center_offset_deg: [0, -2]   # окно чуть ниже линии взгляда (оценка)
  virtual_distance_m: 4        # оценка фокусного расстояния изображения
head:
  eye_height_m: 1.60
  rate_hz: 60
imu:
  gyro_noise: 0.002   # рад/с/√Гц — оценка, уточнить по записи
  accel_noise: 0.02
```

## Запасные варианты
- Rokid Max Pro + Station Pro: 6DoF, камера глубины, продаётся в РФ (rokid-glasses.ru), SDK не проверен.
- Pico 4 Ultra Enterprise: шлем с камерами, ≈105°, 154 900 ₽ (Vizzion), доступ к камере через Enterprise API.
- Лазерная проекция (класс LAP CAD-PRO) — для крупных узлов в фюзеляже, дистрибьюторы в РФ, цена по запросу.
- Планшет на штанге + камера — дешёвый старт на той же программе.
