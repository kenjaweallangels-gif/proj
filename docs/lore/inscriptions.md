# Надписи и POI-инспектируемые объекты

`ARakisInspectable` с тегом `Rakis.POI.<LoreID>` при взаимодействии вызывает `PlayLine(<LoreID>)`; строки лежат в `Content/Rakis/Data/Dialogue_S1.csv` (Speaker `Lore`, Condition `Interact:Rakis.POI.<LoreID>`). Все тексты оригинальные.
Формат: где стоит → какой слой истории (`docs/lore/world_bible.md` §4) → глагол взаимодействия → текст RU/EN → **надпись на хашшане** (`Line_Native` / `Line_NativeScript`, см. `docs/lore/language.md`) → заметки для арта/звука.
Надпись на хашшане показывается стилизованной строкой над описанием и **не озвучивается**.

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
| `LORE_Harvester_Wreck` | A2 (эрг) | — | Осмотреть / Inspect |
| `LORE_Dead_Maker` | A2 (эрг) | — | Осмотреть / Inspect |
| `LORE_Worm_Throat` | B5 (рельеф за помостом наиба) | 1 | Осмотреть / Inspect |

---

### LORE_Carving_Fremen — фрименская резьба
**RU:** Фрименская резьба, древнейший слой. Червь и два крюка, линии стёрты ладонями до блеска. Под ними знаки: «Взяли у песка только тень — вернём её на закате».
**EN:** Fremen carving, the oldest layer. A worm and two hooks, the lines rubbed to a shine by palms. Beneath, the signs: "We took only shade from the sand — we will return it at sundown."
**Хашшана:** *Laḥafnu mun an-tirb ġīr ṭull — f-an-ġurb ġad nakurruh.* — لَحَفْنُو مُن أَنْ تِرْب غِير طُلّ — فَنْ غُرْب غَدْ نَكُرُّه.
*Арт:* неглубокий рельеф, блеск в бороздах (roughness ниже на 0.2), рядом второй, более стёртый знак — капля. *Звук:* шорох ладони по камню.

### LORE_Quizarate_Sigil — печать Квизарата
**RU:** Печать Квизарата, врезанная прямо поверх старой резьбы: кулак, сжимающий кольцо червя. Надпись сбита наполовину: «…ВСЯ ВОДА — ЕМУ, И ЧЕРЕЗ НАС…». Рядом кто-то нацарапал крошечную каплю.
**EN:** A Qizarate seal, cut straight over the older carving: a fist closed around a worm's ring. The inscription is half chiselled away: "...ALL WATER IS HIS, AND THROUGH US..." Beside it someone has scratched a tiny drop.
**Хашшана:** *…kull an-nuṭf lah, wa-binā…* — …كُلّ أَنْ نُطْف لَه، وَبِنَا…
*Арт:* глубокая врезка, сколы от зубила свежее остального камня, следы позолоты в углублениях. Резьба слоя 1 видна по краям печати.

### LORE_Revivalist_Mural — роспись возрожденцев
**RU:** Роспись возрожденцев, свежая и неумелая. Девочка в синем стоит перед червём; червь нарисован улыбающимся — художник явно не видел его вблизи. Подпись охрой: «Она не побоялась. Научимся и мы».
**EN:** A revivalist mural, fresh and clumsy. A girl in blue stands before a worm; the worm is painted smiling — the artist has plainly never seen one up close. Ochre letters: "She was not afraid. We will learn."
**Хашшана:** *Maš qašaʿat. Ġad naṣqul.* — مَشْ قَشَعَت. غَدْ نَصْقُل.
*Арт:* ультрамарин + охра, подтёки, кисть местами повторяет древнюю резьбу под краской. Лица у девочки нет (см. `LORE_Shiana_Shrine`): просто синее пятно-платок. Комический контраст с только что увиденным червём — намеренный.

### LORE_Cistern_Grate — решётка цистерны
**RU:** Кованая решётка цистерны, старше самого сиетча. На прутьях зарубки — каждая отмечает воду, отданную общине. Зарубок больше, чем сейчас людей в Табр-ан-Нуре. На перекладине одно слово: «Помни».
**EN:** The cistern grate, wrought iron older than the sietch itself. The bars are notched — each notch marks water given to the community. There are more notches than there are people in Tabr-an-Nur today. On the crossbar, a single word: "Remember."
**Хашшана:** *Inquš.* — إِنْقُش. (букв. «вырежи»: «помнить» и «вырезать» на хашшане — один корень)
*Звук:* за решёткой — тихий плеск, капля раз в 6–9 с. Взаимодействие запускает `DLG_B4_001` Кайра (бит `SB_B4_01_Grate`). Долгий взгляд (> 4 с) — барк Guard Water.

### LORE_Thumper_Rack — стойка тамперов
**RU:** Стойка тамперов. Пружины смазаны, колотушки обмотаны кожей, чтобы не звенели раньше времени. На одном детские буквы: «МОЙ. НЕ ТРОГАТЬ. ОН ПРИДЁТ КО МНЕ».
**EN:** A thumper rack. Springs oiled, strikers bound in hide so they won't ring before their time. One bears a child's letters: "MINE. DON'T TOUCH. HE WILL COME TO ME."
**Хашшана:** *Dīlī. Ḥā tankuf. Ġad yatūl ʿadī.* — دِيلِي. حَا تَنْكُف. غَدْ يَتُول عَدِي.
*Арт:* 4 тампера, один маленький, раскрашенный.

### LORE_Shiana_Shrine — ниша Шианы
**RU:** Ниша Шианы. Обрывок синей ленты, горсть песка в чаше, сухой цветок из кинской оранжереи — судя по сорванной пломбе, украденный. Лица нет. Рядом нацарапано: «Живому лицу не место на стене».
**EN:** Sheeana's niche. A scrap of blue ribbon, a handful of sand in a bowl, a dried flower from a Keen hothouse — stolen, judging by the torn seal. No face. Scratched beside it: "A living face has no place on a wall."
**Хашшана:** *Muḥayy ḥayy maš l-an-jāl.* — مُحَيّ حَيّ مَشْ لَنْ جَال.
*Арт:* светошар опущен низко, тёплый; паломники (Smart Object `PrayerMat`) рядом.

### LORE_Water_Rings — водяные кольца
**RU:** Связка водяных колец на шнуре: каждое — счёт воды, отданной общине. Старейшие кольца стёрты до гладкости. Их владельцев никто не помнит, но их воду пьют до сих пор. На узле бирка: «Их вода — в нас».
**EN:** A cord of water rings, each one a tally of water given to the community. The oldest are worn smooth. No one remembers their owners, yet their water is still being drunk. A tag on the knot: "Their water is in us."
**Хашшана:** *Nuṭfuhum funā.* — نُطْفُهُم فُنَا. (поминальная формула, `language.md` §6)
*Звук:* лёгкий металлический перезвон при взаимодействии (мягко, без «колокольчика»).

### LORE_Maker_Hooks — крючья творца
**RU:** Крючья творца: новые древки, старые наконечники. Сталь на остриях тёмная и тонкая — её точили поколения. Три насечки Оссаны стоят на двух крюках из пяти; под ними процарапано: «Идите следом».
**EN:** Maker hooks: new shafts, old heads. The steel at the points is dark and thin — generations have honed it. Ossana's mark, three notches, is cut into two hooks of the five; beneath it, scratched: "Follow."
**Хашшана:** *Irdifū.* — إِرْدِفُو.
*Арт:* те же крюки, что у Оссаны в `LS_WormReveal` (меш общий). **Та же метка — три насечки — ведёт группу по стене расщелины к фальшивому камню (A4, `DLG_A4_001`).** Игрок, который осмотрел крюки в B1, узнаёт метку задним числом.

### LORE_Harvester_Wreck — остов комбайна
**RU:** Остов старого комбайна пряности, наполовину съеденный песком. Краска сошла до металла, гусеницы — как рёбра. На кабине процарапано: «Шайтан забрал машину и оставил нам тень». Под остовом и правда прохладно.
**EN:** The hulk of an old spice harvester, half eaten by sand. Paint scoured down to metal, the treads like ribs. Scratched into the cab: "Shaitan took the machine and left us its shade." It is, in fact, cool underneath.
**Хашшана:** *Laḥaf Šayṭān an-ḥadīd — wa-ḥall lanā ṭulluh.* — لَحَف شَيْطَان أَنْ حَدِيد — وَحَلّ لَنَا طُلُّه.

### LORE_Dead_Maker — кольца мёртвого червя
**RU:** Кольца мёртвого червя, выбеленные солнцем, торчат из дюны, как арки забытого храма. Каждое кольцо выше человека втрое. Паломники оставили у ближнего кольца горсть сухих фиников — подношение или память. На кольце нацарапано: «Спящий — тише».
**EN:** The rings of a dead worm, bleached by the sun, rise from the dune like the arches of a forgotten temple. Each ring stands three times a man's height. Pilgrims have left a handful of dry dates by the nearest one — an offering, or a memory. Scratched on the ring: "Sleeper — hush."
**Хашшана:** *Šāʾin — rū.* — شَائِن — رُو.

### LORE_Worm_Throat — свод зала
**RU:** Свод зала вырезан рёбрами, сходящимися к световой шахте, — как глотка червя, если смотреть изнутри. Под рёбрами, над помостом наиба, вырезано: «Кого проглотил Бог, тот не боится».
**EN:** The hall's vault is cut in ribs that converge on the light shaft — a worm's throat, seen from within. Carved beneath the ribs, above the naib's dais: "Whom God has swallowed does not fear."
**Хашшана:** *Dī ḥaṭamuh Il — maš yaqšaʿ.* — دِي حَطَمُه إِل — مَشْ يَقْشَع.

---

## Мелкие надписи-декали (без взаимодействия, для env-artist)
| Где | Текст RU / EN | Хашшана | Слой |
|---|---|---|---|
| A4, над фальшивым камнем | «Тень — дверь» / "Shade is a door" | *An-ṭull sadd.* — أَنْ طُلّ سَدّ. | 1 |
| A4, стена расщелины, через каждые 10–15 м | три насечки — метка Оссаны (без текста) | — | 3 (свежие, светлые сколы) |
| B1, косяк шлюза | «Затяни — и войди» / "Seal, then enter" | *Zumm — wa-jūf.* — زُمّ — وَجُوف. | 3 (краской поверх резьбы) |
| B2, лестница | детские рисунки червя мелом, 6–8 штук; на одном — человечек на спине червя | — | 3 |
| B3, занавесь похоронной ниши | вышитая капля, перевёрнутая вниз | — | 3 |
| B5, свод | печать Квизарата, сбитая почти целиком; поверх — синяя лента краской | — | 2+3 |
| B5, край чаши | круг из 12 знаков-шагов разной длины | — | 1 |
