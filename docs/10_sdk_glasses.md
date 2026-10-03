# 10. Своё ПО для разных AR-очков: оценка

Данные на 03.10.2026. Профили очков симулятора — `pkg2-demo-web/src/galley/glasses.js`.
Характеристики и ссылки — `09_hardware_glasses.md`.

## Вывод

Своё ПО для всех рассмотренных очков сделать **можно, но не одной программой «как есть»**.
Единого SDK у VITURE и XREAL нет. Реальный путь: одно ядро и данные (как сейчас в `pkg1`), один клиент
отображения на открытом стандарте OpenXR и тонкий адаптер под каждое семейство очков в слое HAL
(`02_hal_contracts.md`).

Трудоёмкость — около 4–5 месяцев одного инженера с ИИ-ассистентом сверх текущей дорожной карты (`07_roadmap.md`).
Это для трёх семейств: VITURE на ПК, XREAL на Android/Unity и XREAL Aura на Android XR. Пилот на одной модели
(Luma Ultra + ПК) укладывается в уже запланированную фазу 6.

Главное ограничение не программное, а аппаратное:
- **на очках с 3DoF** (Luma Pro, Beast, Air 2 Pro, One и One Pro без камеры) нельзя привязать голограммы к изделию.
  Такие очки годятся только как экран инструкций «вокруг головы». Этот режим уже показан в симуляторе;
- **для привязки к стапелю нужны 6DoF и доступ к камере**: Luma Ultra, Air 2 Ultra, One и One Pro с камерой
  XREAL Eye, Aura.

## Что дают производители

| Очки | Где работает программа | SDK | Трекинг для разработчика | Камера для своих алгоритмов | Ввод |
|---|---|---|---|---|---|
| VITURE Luma Ultra | ПК Linux / Windows / macOS; Pro Neckband (Android); телефон Android | VITURE XR Glasses SDK (C, есть обёртки C++) и Unity XR SDK | 6DoF по VIO в очках. На Android-телефоне 6DoF и жесты не поддерживаются — нужен Neckband или ПК | RGB по UVC и две серые камеры трекинга 25 Гц | жесты рук, кнопки |
| VITURE Luma, Luma Pro, Beast | те же | тот же C SDK | 3DoF: IMU 60–1000 Гц. У Beast есть 3DoF внутри очков | RGB по UVC (Luma Pro, Beast) | кнопки |
| XREAL Air 2 Pro | телефон Android, Beam Pro; ПК (Linux — через Monado, сообщество) | XREAL SDK 3 (Unity) | 3DoF | нет | телефон как пульт |
| XREAL Air 2 Ultra | Android, Beam Pro | XREAL SDK 3 (Unity, AR Foundation) | 6DoF, плоскости, распознавание изображений, сетка глубины, якоря, руки | через SDK | руки, телефон |
| XREAL One, One Pro | Android, Beam Pro; как дисплей — любой хост | XREAL SDK 3.1 | 3DoF в очках (чип X1); 6DoF — с камерой XREAL Eye | XREAL Eye, 12 Мп | телефон |
| XREAL Aura | вычислительный блок Snapdragon (Android XR) | Android XR: Jetpack XR, Unity 6 (OpenXR: Android XR), Godot, Unreal, WebXR | 6DoF, руки, якоря | через Android XR, с разрешения пользователя | руки, тачпад на блоке |

Особенности VITURE C SDK, по документации:
- поддерживает 9 моделей, у всех один USB VID 0x35CA;
- управляет яркостью, режимом (1920×1080…3840×1200 при 60/90/120 Гц) и затемнением линз;
- в браузерной сборке (WebAssembly через WebHID) Luma Ultra не поддерживается.

Особенности XREAL SDK:
- версия 3 встроена в систему XR движка Unity (2021.3 и новее);
- на Android 16 у разработчиков есть известные проблемы совместимости.

## Архитектура

```
 Сервер цеха (FastAPI) — пакеты операций, GLB, КД, журнал, чат          без изменений
        │
 Ядро pkg1 (Python): метки → поза изделия, шаги, голос                    на ПК или поясном мини-ПК
        │  UDP JSON (02_hal_contracts.md)
 ┌──────┴──────────────── Клиент отображения ─────────────────────────────┐
 │ Godot 4 + OpenXR: окна КД и шага, голограммы, HUD, режимы 3DoF и 6DoF  │  один код сцены
 └──────┬───────────────┬──────────────────────┬──────────────────────────┘
   адаптер VITURE    адаптер XREAL          адаптер Android XR
   C SDK (ПК, Linux) Unity-плагин или       OpenXR (Aura): поза, руки,
   поза, IMU, UVC    Monado (Air, 3DoF)     якоря, камера
```

Решения:
1. **Клиент — Godot 4 с OpenXR.** Godot уже выбран для симулятора (`pkg1/godot`). Android XR официально
   поддерживает Godot. На ПК OpenXR даёт Monado. Unity нужна только там, где без неё нет функций, — для XREAL SDK 3.
2. **Адаптер — реализация HAL** (`FrameSource`, `PoseSource`, `ImuSource`, `DisplaySink`), как `VitureRig`
   в `pkg1/prompts/11`. Ядро и тесты не меняются, проверка — на записях EuRoC (ReplayRig).
3. **Профиль устройства** — тот же набор полей, что в симуляторе: окно дисплея, нит, затемнение, 3DoF/6DoF,
   задержка, расстояние экрана, коррекция зрения. Клиент читает его и сам включает режим 3DoF
   (окна вокруг головы) или 6DoF (привязка к меткам стапеля).
4. **Трекинг изделия остаётся нашим** (метки ArUco, `05_algorithms.md`). SLAM очков даёт позу головы между
   кадрами, метки — абсолютную привязку к стапелю. Встроенное распознавание изображений XREAL и Android XR
   можно использовать как запасной вариант.
5. **Где выполнять ядро:**
   - (А) ПК или мини-ПК на поясе, Linux — быстрее всего, Python-ядро работает как есть;
   - (Б) Android — ядро трекинга и шагов переносится на Kotlin/C++ (OpenCV Android).
     Это ~6–8 недель: перенос, проверка на записях;
   - (В) сервер цеха по Wi-Fi 6 — только для 3DoF-очков, где поток камеры не нужен.

## Трудоёмкость (1 инженер + ИИ-ассистент)

| Работа | Недели | Зависит от |
|---|---|---|
| Клиент Godot 4 + OpenXR, профили устройств, режимы 3DoF/6DoF (перенос из симулятора) | 4–6 | — |
| Адаптер VITURE (C SDK, ПК Linux): поза, IMU, камера, затемнение, яркость; калибровка камера ↔ дисплей | 2–3 | SDK по программе разработчиков |
| Адаптер XREAL Air/One на ПК через Monado (3DoF, только экран инструкций) | 1 | Monado |
| Клиент XREAL на Unity + XREAL SDK 3 (Air 2 Ultra, One Pro + Eye): 6DoF, распознавание меток, протокол UDP | 4–6 | Beam Pro или телефон |
| Android XR (Aura): сборка Godot или Unity, руки, якоря, доступ к камере | 3–4 | очки в продаже (осень 2026) |
| Перенос ядра на Android (если без поясного ПК) | 6–8 | вариант (Б) |
| Калибровка и приёмка на каждый тип очков (смещение ≤ 10 мм на 0,6 м, `06_testing.md`) | 1 на тип | стенд с метками |

## Риски

- **SDK закрытые и меняются.** VITURE выдаёт SDK через программу разработчиков, у XREAL каждый год ломается
  совместимость. Решение: тонкие адаптеры и записи сеансов для регрессии.
  Имена функций SDK брать только из заголовков (см. `pkg1/prompts/11`).
- **Камера и ИБ.** Своим алгоритмам нужен поток камеры. На Android XR и XREAL — через разрешения ОС.
  Это надо согласовать в ИБ до закупки.
- **3DoF не станет 6DoF программно.** Для привязки нужны очки с камерами или внешняя камера на стапеле
  (вариант на будущее: трекинг головы снаружи).
- **Поставки и лицензии.** Коммерческое использование SDK, санкции и сертификация. Нужен запасной поставщик
  (`09_hardware_glasses.md`: Rokid, Pico Enterprise).
- **Эргономика смены.** Вес 75–98 г и кабель, у Aura — вычислительный блок на кабеле. Нужна проверка
  на 2–3 сборщиках (фаза 7).

## Рекомендация

1. Пилот — VITURE Luma Ultra + мини-ПК Linux (как в дорожной карте), 6DoF и метки.
2. Сразу закладывать клиент на Godot 4 + OpenXR и профили устройств. Так Aura (Android XR) добавится
   адаптером, а не новым проектом.
3. XREAL One Pro + Eye или Air 2 Ultra — вторым устройством через Unity, если нужен автономный
   Android без ПК.
4. Очки с 3DoF — только для участков без привязки: инструкции, КД, чат.
5. Взять один комплект XREAL Aura после старта продаж и проверить яркость, затемнение, задержку и
   точность привязки. В симуляторе эти значения пока помечены как оценки.

## Источники

- VITURE XR Glasses SDK (платформы, модели, API): https://www.viture.com/developer/glasses-sdk/glasses
- VITURE Unity XR SDK (6DoF, руки): https://www.viture.com/developer/unity-sdk/unity, https://developer.viture.com/unity/viture_unity_xr_sdk_doc
- Luma Ultra (1500 нит, −4 D, камеры, $599): https://vrarwiki.com/wiki/Viture_Luma_Ultra
- XREAL SDK 3: https://docs.xreal.com/, выпуск 3.1.0 (6DoF для One с Eye): https://docs.xreal.com/Release%20Note/XREAL%20SDK%203.1.0,
  переход с NRSDK: https://docs.xreal.com/MigratingFromNRSDKToXREALSDK/intro
- XREAL One Pro (165 мм, 87 г, X-Prism, Eye 12 Мп): https://www.abt.com/XREAL-One-Pro-AR-Glasses-Medium-IPD-57-66mm-in-Black-X1112M/p/236852.html
- VITURE Beast (88 г, 9 ступеней затемнения): https://roadtovr.com/vitures-widest-field-of-view-ar-glasses-are-now-available-at-amazon-best-buy/
- Android XR SDK (Jetpack XR, Unity, Godot, Unreal, OpenXR, WebXR): https://developer.android.com/develop/xr,
  Unity для проводных XR-очков на Android: https://unity.com/blog/unity-android-xr-wired-glasses-support
- XREAL Aura (70°, X-Prism, 1920×1200, Snapdragon Reality Elite, $1500, осень 2026): https://gsmarena.com/xreal_aura_glasses_unveiled_with_android_xr_and_the_new_snapdragon_reality_elite-news-73315.php
- Monado (OpenXR, Linux, XREAL Air 3DoF): https://gitlab.freedesktop.org/monado/webpage/-/blob/master/index.md
