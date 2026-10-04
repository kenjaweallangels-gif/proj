## Итог
Горожане сиетча и спутники переписаны: навигационная сетка по всем помещениям (nav.js), рулёжка без дрожания и скольжения (agents.js), распорядок дня, разговоры, взгляд, шаг в сторону (social.js), спутники v2 (строй позади-сбоку, гуськом в узком, перенос только вне кадра). Диагностика: Web/tools/npc_diag.mjs, Web/tools/npc_nav_test.mjs.
## Изменённые файлы
- Web/src/sietch/{nav,agents,social}.js — новые; crowd.js — интеграция; index.js — экспорт plan; README.md
- Web/src/player/{companions,config}.js; Web/src/worm/encounter.js (плавный курс наездников)
- Web/tools/npc_diag.mjs, npc_nav_test.mjs
## Как проверить
node tools/build.mjs; node tools/npc_diag.mjs --sec=240; node tools/npc_nav_test.mjs
## Открытые вопросы / риски
Дрожание у детей (игры/догонялки) выше базы; npc_nav_test и route_free после слияния не прогонялись (перегрузка машины).
## Следующему агенту
Продавцы за прилавками в отдельной компоненте навигации: уходят только в ритуал (через exitPortal).
