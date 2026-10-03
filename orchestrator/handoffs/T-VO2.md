## Итог
Озвучка переведена с формантного синтезатора на записи нейросети Piper (`ar_JO-kareem-medium`) с обработкой под каждого персонажа; весь банк (239 реплик + 48 безсловесных «бормотаний» для лая толпы) встроен в `Web/src/assets/vo.js` (2.6 МБ, Opus 14 кбит/с). Язык хашшана приближён к левантийско-аравийскому звучанию (Ред. 2: частицы, кунйи, говорки, сукуны на концах слов для Piper; арабицу строит `native2ar.py` из латиницы). Диалоги переписаны целиком: связные сцены о религии, власти, семье и шутках (сцены спутников и подслушанные сцены жителей сиетча). Финал демо удалён (`FadeOut`/`EndDemo` убраны из данных, директора и валидатора), после зала игра продолжается. Постоянный гул («землетрясение») убран: рокот червя и двигатель харвестера звучат только при реальной близости.

## Изменённые файлы
- `Tools/tts/script_s1.py`, `gen_dialogue.py`, `native2ar.py`, `lexicon_check.py`, `piper_build.py`, `vo_durations.json` — авторский источник диалогов, генерация CSV, конвертер латиница→арабица, сборка озвучки
- `Content/Rakis/Data/Dialogue_S1.csv` — 252 строки (239 озвучиваемых, 11 лор-надписей, 2 галаха), Duration = длина записи + 0.4 с; `StoryBeats.csv` — удалены `SB_B5_09_Fade`/`SB_B5_10_End`, добавлены `SB_A1_06_Mission`, `SB_B5_09_Life`, `SB_B5_10_Free`, обновлены ссылки `DLG_A1_020`, `DLG_B2_C10`
- `docs/lore/language.md` — Ред. 2 (§13), правки §3/§4.7/§7.4/§12; `docs/audio/voice_pipeline.md` (новый), `docs/audio/soundmap.md` (гул)
- `Web/src/assets/vo.js` (новый, генерируется), `Web/src/audio/vo_bank.js` (новый), `voice.js` (запись → позиционный голос; синтезатор — запасной, ×0.6), `index.js`/`engine.js` (дакинг фона `ambDuck`), `sfx.js`/`ambience.js`/`music.js` (рокот)
- `Web/src/story/director.js` (нет FadeOut/EndDemo), `reactions.js` (расписание сцен-разговоров), `dialogue.js` (длительность по аудио, `chain`, новые спикеры), `debug.js`; `Web/src/ui/index.js` (`endCard` — заглушка), `ui/menus.js` (подписи режимов голоса)
- `Tools/validate_data.py` — новые спикеры/эмоции, запрет `FadeOut`/`EndDemo`, сверка `Line_NativeScript` с `native2ar`, проверка покрытия `vo.js`
- `Web/tools/vo_test.mjs`, `vo_scenes_test.mjs` (новые), `Web/dist/vo.html` (сборка)

## Как проверить
```
python3 Tools/validate_data.py --strict            # PASS
python3 Tools/tts/gen_dialogue.py --check          # CSV = источник
cd Web && node tools/build_data.mjs && node tools/build.mjs --out=vo.html
node tools/vo_test.mjs --file=vo.html              # декодирование, RMS, покрытие, синхронность субтитров, фон без гула
node tools/vo_scenes_test.mjs --file=vo.html --zone=market --secs=700 --min=10
node tools/vo_scenes_test.mjs --file=vo.html --zone=finale --secs=450 --min=2   # после зала жизнь продолжается
node tools/smoke.mjs --file=vo.html --shots=start,erg,sietch,hall,garden
```
Пересобрать озвучку: `pip install piper-tts numpy`, `python3 Tools/tts/piper_build.py` (модель скачается сама, ~63 МБ, в git не кладём).

## Открытые вопросы / риски
- Качество голосов оценено объективно (RMS −22…−25 дБFS, f0 по персонажам различается, пиков нет), но **на слух не проверялось**: нужна прослушка (`piper_build.py --only ID --keep-wav DIR`). Параметры `VOICE_FX` подбираются правкой одной таблицы.
- Opus в OGG: Safari < 18.4 может не декодировать — тогда включится запасной путь (TTS браузера / синтезатор).
- Галах (`DLG_WRM_P03/P04`) озвучивается TTS браузера по переводу; записи для него нет.
- Сборка `vo.html` +2.5 МБ к размеру HTML (13.6 МБ).
- `story_test.mjs` в этой среде упирается в таймаут (игровое время ползёт при медленном headless-рендере); сцены проверены ручным шагом времени (`vo_scenes_test.mjs`).
- Диалоги и язык ждут ревью носителя арабского: орфография хашшаны намеренно «арабско-подобна», но придумана.

## Следующему агенту
Правки текстов — только в `Tools/tts/script_s1.py` (затем `gen_dialogue.py` и `piper_build.py`; CSV руками не править). Новые слова — в `docs/lore/language.md` §13.7 (`lexicon_check.py` сверит). Реплики с новым спикером: добавить в `VOICE_FX` (piper_build.py), `SPEAKERS` (dialogue.js), `NPC_ARCH` (voice.js), `validate_data.py`. Для UE: `VO_File` в CSV по-прежнему `/Game/Rakis/Audio/VO/<ID>`; WAV можно получить `--keep-wav` и импортировать `Tools/unreal_python/audio_setup.py`.
