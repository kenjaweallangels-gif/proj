## Итог
Адаптивная музыка веб-демо переписана: офлайн-стемы (numpy-синтез: женский вокализ с формантами/вибрато/глиссандо, горловое пение, мужской хор, перегруженная низкая медь, дудук, волынка, рамочные барабаны, скрежет, удары, саб-бум) плюс реалтайм-планировщик «волн» и щипковых (уд/канун), собственная реверберация и дакинг под шину vo. Добавлены состояния Night, Garden (разреженный скальный карман), Devour; сад/ночь подменяют DesertCalm/DesertDrone по зоне/времени суток. Причины «странности» прежней версии: постоянные пилообразные дроны и синусный саб, статичные «органные» голоса, непрерывный ритм, музыка громче эмбиента на 10–15 дБ.
## Изменённые файлы
- Web/src/audio/music.js — полностью переписан
- Web/src/audio/index.js — разрешение состояний (сад/ночь), Devour на фазе swallow, дакинг субтитров смягчён (0.6/0.85)
- Web/src/audio/engine.js — аддитивно: opts.ctx/opts.raw, экспорт makeIR, voLevel()
- Web/src/assets/music.js, Tools/tts/music_build.py, Tools/tts/music_analyze.py — стемы, генератор, замеры
- Web/tools/music_render.mjs, music_render_entry.js, music_ingame.mjs — офлайн-рендер и проверка в сборке
- Content/Rakis/Data/AudioEvents.csv (Night, Garden, Devour), Web/src/data/data.js, docs/audio/*
## Как проверить
cd Web && node tools/build_data.mjs && node tools/build.mjs; node tools/music_render.mjs --raw --out=/tmp/m; python3 ../Tools/tts/music_analyze.py /tmp/m; node tools/music_ingame.mjs
## Открытые вопросы / риски
На слух не проверялось. composer_brief запрещал имитацию «воплей/горловых лейтмотивов» — обновлён: тембры разрешены, мелодии оригинальные. Стемы пересобираются ~2.5 мин: python3 Tools/tts/music_build.py.
## Следующему агенту
Уровни калибруются через CAL в music.js. sfx/ambience не тронуты; правки engine.js/index.js аддитивные.
