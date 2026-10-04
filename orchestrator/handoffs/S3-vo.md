## Итог
Озвучка переведена на голос на персонажа (Piper: ar_JO-kareem, fa_IR-amir/ganji/reza_ibrahim, ur_PK-aegis_female, hi_IN-priyamvada) с движком просодии `Tools/tts/vo_engine.py` (синтагмы, паузы, вдохи, смешки, мелодика, без крупного pitch-shift). Клипы сухие, комнату по `game.space` добавляет `voice.js`. Из игры удалены `speechSynthesis` и формантный синтезатор как запасной путь; реплика без записи — только субтитры или бормотание. Озвучены 337 из 337 строк (247 диалогов + 90 лая из нового `Barks_Native.csv`).
## Изменённые файлы
- Tools/tts/vo_engine.py, piper_build.py, native2ipa.py, barks_native.py, gen_barks_native.py, vo_verify.py, script_s1.py — движок, сборка, текст
- Content/Rakis/Data/Barks_Native.csv, Dialogue_S1.csv — лай на хашшане; 6 новых строк (DLG_WRM_H01-04, DLG_A2_CALL_01-02) вместо зашитых в код
- Web/src/audio/voice.js, vo_bank.js, story/dialogue.js (say(), темп беседы, перебивки), worm/encounter.js, ui/settings.js, menus.js, tools/vo_coverage.mjs, build_data.mjs
## Как проверить
python3 Tools/validate_data.py; cd Web && node tools/build_data.mjs && node tools/vo_coverage.mjs && node tools/build.mjs
Пересборка VO: piper_build.py --shard K/N (параллельно), затем --merge или --from-wav <каталог>.
## Открытые вопросы / риски
Слуховая оценка не проводилась. ASR-CER на 12 репликах 0.46 (язык выдуманный). Диалоговый текст (RU/EN/Native) не переписывался в этом проходе; `native2ipa.py` написан, но в сборке не используется (espeak-фонемы с заменой по профилю).
## Следующему агенту
Модели в Tools/tts/models (в git нет). vo.js ~10.5 МБ (Opus 56/48/40 кбит/с).
