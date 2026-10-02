# Надписи и POI-инспектируемые объекты

`ARakisInspectable` с тегом `Rakis.POI.<LoreID>` при взаимодействии вызывает `PlayLine(<LoreID>)`; строки — в `Content/Rakis/Data/Dialogue_S1.csv` (Speaker `Lore`, Condition `Interact:Rakis.POI.<LoreID>`). Все тексты оригинальные.
Формат: где стоит → какой слой истории (`docs/lore/world_bible.md` §4) → глагол взаимодействия → текст RU/EN → заметки для арта/звука.

| LoreID | Зона | Слой | Глагол |
|---|---|---|---|
| `LORE_Carving_Fremen` | A4 (стена расщелины у фальшивого камня) | 1 | Осмотреть / Inspect |
| `LORE_Quizarate_Sigil` | B1 (портал за дверями-уплотнителями) | 2 (поверх 1) | Осмотреть / Inspect |
| `LORE_Revivalist_Mural` | B2 (стена верхнего яруса) | 3 | Рассмотреть / Study |
| `LORE_Cistern_Grate` | B4 (решётка цистерны) | 1–2 | Коснуться / Touch |
| `LORE_Thumper_Rack` | B1 (у шлюза) | 3 | Осмотреть / Inspect |
| `LORE_Shiana_Shrine` | B3 (ниша) | 3 | Склонить голову / Bow |
| `LORE_Water_Rings` | B2 (у торговки водой) | 3 | Посмотреть / Look |
| `LORE_Maker_Hooks` | B1/B2 (стойка наездников) | 3 | Осмотреть / Inspect |

---

### LORE_Carving_Fremen — фрименская резьба
**RU:** Фрименская резьба, древнейший слой. Червь и два крюка, линии стёрты ладонями до блеска. Под ними знаки: «Взяли у песка только тень — вернём её на закате».
**EN:** Fremen carving, the oldest layer. A worm and two hooks, the lines rubbed to a shine by palms. Beneath, the signs: "We took only shade from the sand — we will return it at sundown."
*Арт:* неглубокий рельеф, блеск в бороздах (roughness ниже на 0.2), рядом второй, более стёртый знак — капля. *Звук:* шорох ладони по камню.

### LORE_Quizarate_Sigil — печать Квизарата
**RU:** Печать Квизарата, врезанная прямо поверх старой резьбы: кулак, сжимающий кольцо червя. Надпись сбита наполовину: «…ВСЯ ВОДА — ЕМУ, И ЧЕРЕЗ НАС…». Рядом кто-то нацарапал крошечную каплю.
**EN:** A Qizarate seal, cut straight over the older carving: a fist closed around a worm's ring. The inscription is half chiselled away: "...ALL WATER IS HIS, AND THROUGH US..." Beside it someone has scratched a tiny drop.
*Арт:* глубокая врезка, сколы от зубила свежее остального камня, следы позолоты в углублениях. Резьба слоя 1 видна по краям печати.

### LORE_Revivalist_Mural — роспись возрожденцев
**RU:** Роспись возрожденцев, свежая и неумелая. Девочка в синем стоит перед червём; червь нарисован улыбающимся — художник явно не видел его вблизи. Подпись охрой: «Она не побоялась. Научимся и мы».
**EN:** A revivalist mural, fresh and clumsy. A girl in blue stands before a worm; the worm is painted smiling — the artist has plainly never seen one up close. Ochre letters: "She was not afraid. We will learn."
*Арт:* ультрамарин + охра, подтёки, кисть местами повторяет древнюю резьбу под краской. Лица у девочки нет (см. `LORE_Shiana_Shrine`): просто синее пятно-платок. Комический контраст с только что увиденным червём — намеренный.

### LORE_Cistern_Grate — решётка цистерны
**RU:** Кованая решётка цистерны, старше самого сиетча. На прутьях зарубки — каждая отмечает воду, отданную общине. Зарубок больше, чем сейчас людей в Табр-ан-Нуре.
**EN:** The cistern grate, wrought iron older than the sietch itself. The bars are notched — each notch marks water given to the community. There are more notches than there are people in Tabr-an-Nur today.
*Звук:* за решёткой — тихий плеск, капля раз в 6–9 с. Взаимодействие запускает `DLG_B4_001` Кайра (бит `SB_B4_01_Grate`). Долгий взгляд (> 4 с) — барк Guard Water.

### LORE_Thumper_Rack — стойка тамперов
**RU:** Стойка тамперов. Пружины смазаны, колотушки обмотаны кожей, чтобы не звенели раньше времени. На одном детские буквы: «МОЙ. НЕ ТРОГАТЬ. ОН ПРИДЁТ КО МНЕ».
**EN:** A thumper rack. Springs oiled, strikers bound in hide so they won't ring before their time. One bears a child's letters: "MINE. DON'T TOUCH. HE WILL COME TO ME."
*Арт:* 4 тампера, один маленький, раскрашенный.

### LORE_Shiana_Shrine — ниша Шианы
**RU:** Ниша Шианы. Обрывок синей ленты, горсть песка в чаше, сухой цветок из кинской оранжереи — судя по сорванной пломбе, украденный. Лица нет: возрожденцы говорят, что лицо живой — не для стены.
**EN:** Sheeana's niche. A scrap of blue ribbon, a handful of sand in a bowl, a dried flower from a Keen hothouse — stolen, judging by the torn seal. No face: the revivalists say a living face does not belong on a wall.
*Арт:* светошар опущен низко, тёплый; паломники (Smart Object `PrayerMat`) рядом.

### LORE_Water_Rings — водяные кольца
**RU:** Связка водяных колец на шнуре: каждое — счёт воды, отданной общине. Старейшие кольца стёрты до гладкости. Их владельцев никто не помнит, но их воду пьют до сих пор.
**EN:** A cord of water rings, each one a tally of water given to the community. The oldest are worn smooth. No one remembers their owners, yet their water is still being drunk.
*Звук:* лёгкий металлический перезвон при взаимодействии (мягко, без «колокольчика»).

### LORE_Maker_Hooks — крючья творца
**RU:** Крючья творца: новые древки, старые наконечники. Сталь на остриях тёмная и тонкая — её точили поколения. Три насечки Оссаны стоят на двух крюках из пяти.
**EN:** Maker hooks: new shafts, old heads. The steel at the points is dark and thin — generations have honed it. Ossana's mark, three notches, is cut into two hooks of the five.
*Арт:* те же крюки, что у Оссаны в `LS_WormReveal` (меш общий).

---

## Мелкие надписи-декали (без взаимодействия, для env-artist)
| Где | Текст RU / EN | Слой |
|---|---|---|
| A4, над фальшивым камнем | «Тень — дверь» / "Shade is a door" | 1 |
| B1, косяк шлюза | «Затяни — и войди» / "Seal, then enter" | 3 (краской поверх резьбы) |
| B2, лестница | детские рисунки червя мелом, 6–8 штук | 3 |
| B3, занавесь похоронной ниши | вышитая капля, перевёрнутая вниз | 3 |
| B5, свод | печать Квизарата, сбитая почти целиком; поверх — синяя лента краской | 2+3 |
| B5, край чаши | круг из 12 знаков-шагов разной длины | 1 |
