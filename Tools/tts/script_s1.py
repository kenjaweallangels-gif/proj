# -*- coding: utf-8 -*-
"""
Авторский источник диалогов среза (Ред. 2). Из него Tools/tts/gen_dialogue.py строит Content/Rakis/Data/Dialogue_S1.csv.

Формат сцены:  S(<ID первой реплики>, <Condition первой реплики>, [(Speaker, Emotion, native, RU, EN), ...])
  * ID следующих реплик = ID первой с увеличенным хвостовым числом (DLG_A2_B01 -> DLG_A2_B02 ...), NextID выставляется по цепочке;
  * native — СТАНДАРТНАЯ форма хашшаны (латиница). Диалектный выговор спикера накладывает генератор:
      Kair  — кинский выговор (q -> ʾ), см. language.md §13.3;
      Rayn  — акцент инопланетника (ṭ ḍ ṣ -> t d s, q -> k, ḥ -> h, ʿ ʾ выпадают, kh ġ -> k);
  * '[Galach]' — реплика на галахе (озвучивается переводом, строки хашшаны нет);
  * словарь: каждое слово должно быть в docs/lore/language.md (проверка: Tools/tts/lexicon_check.py).
Реплики в игре: субтитр — RU/EN; озвучка — Piper по арабице, построенной из Line_Native (native2ar.py).
"""
SCENES = []


def S(first_id, cond, lines):
    SCENES.append((first_id, cond, lines))


G = "[Galach]"

# =====================================================================================================================
# A1. Гребень. Начало: Илва поправляет шаг Рэйна; разговор о миссии
# =====================================================================================================================
S("DLG_A1_001", "", [
    ("Ilva", "Calm", "Bā-Rayn, tūm taḍbuṭū. An-tirb yaṣnut an-ḍabṭ.",
     "Мастер Рэйн, вы шагаете в такт. А песок слышит такт.", "Master Rayn, you're stepping in rhythm. The sand hears rhythm."),
    ("Rayn", "Wry", "Ānu yasrub ġīr. Kufa ġayr yasrub?",
     "Я просто иду. А как ещё ходят?", "I'm simply walking. How else does one walk?"),
    ("Kair", "Calm", "Maš ka-ʿarḍ. Madd, qiṭ, iṭmun — fa ka-ʿātir. Iḥdaq.",
     "Не как на параде. Шаг длинный, шаг короткий, замри — и будто споткнулся. Смотри.", "Not like a parade. Long step, short step, freeze — then stumble as if by accident. Watch."),
    ("Rayn", "Wry", "Hād sarb? Bi-hākā maš ġad natūl ʿad an-ġurb.",
     "Это у вас называется «идти»? Так мы и к закату не дойдём.", "That's what you call walking? We won't arrive by sundown like that."),
    ("Kair", "Wry", "Natūl. An-ṣaḥr maš tabġī an-mustaʿjil, wa-ānu maš abġī adfin nazīl.",
     "Дойдём. Пустыня не любит торопливых, а я не люблю хоронить гостей.", "We'll get there. The desert doesn't like the hasty, and I don't like burying guests."),
])

S("DLG_A1_020", "ZoneEnter:A1_Ridge", [
    ("Rayn", "Wry", "Yā Kayr, fu-Kīn yalqut: an-ṣaḥr khāw — maš ḍumm, maš nuṭf.",
     "Кайр, в Кине говорят: пустыня пуста — ни людей, ни воды.", "Kair, in Keen they say the desert is empty — no people, no water."),
    ("Kair", "Calm", "Fu-Kīn yalqut jamm. Wa-kull-mā hun — duḥ adwāsak.",
     "В Кине много чего говорят. А всё, что здесь есть, лежит у тебя под ногами.", "Keen says a lot of things. Everything that's out here lies under your feet."),
])

S("DLG_A1_010", "", [
    ("Ilva", "Calm", "Yā Kayr, kurr li-Bā-Rayn: tayn naḥ nasrub? Hū ṣanat bi-nuṣf fumm.",
     "Кайр, повторите мастеру Рэйну, куда мы идём. Он слушал вполуха.", "Kair, tell Master Rayn again where we're headed. He only half listened."),
    ("Kair", "Neutral", "ʿAd Tabr an-Nūr. Hād tabr an-nahḍiyyīn — dī yataqalū bi-Šay-Ḥulūd ʿurr ḥanābin.",
     "В Табр-ан-Нур. Это сиетч возрожденцев — тех, кто верит в Шай-Хулуда без жрецов.", "To Tabr-an-Nur. The revivalists' sietch — people who believe in Shai-Hulud without priests."),
    ("Kair", "Neutral", "Kīn yabġī ʿušr an-nuṭf mun hum. Wa-ānu ʿātil luqt an-ḥanābin li-an-Nāʾib.",
     "Кин хочет с них водяную десятину. А я несу наибу слово жрецов.", "Keen wants the water tithe from them. And I carry the priests' word to the naib."),
    ("Rayn", "Neutral", "Wa-lin an-Nāʾib maš yanfil?",
     "А если наиб не даст?", "And if the naib doesn't give?"),
    ("Kair", "Wry", "Fa Kīn yašḥan jund. Wa-an-jund, yā Rayn, yamṣuṣ ajamm mun yaḥluṣ.",
     "Тогда Кин пришлёт солдат. А солдаты, Рэйн, пьют больше, чем платят.", "Then Keen sends soldiers. And soldiers, Rayn, drink more than they pay."),
    ("Ilva", "Calm", "Wa-tū, yā Kayr? Sāb mūn tū?",
     "А вы, Кайр? На чьей вы стороне?", "And you, Kair? Whose side are you on?"),
    ("Kair", "Neutral", "Ānu sāb an-nuṭf. Dulā hī fu-qullī.",
     "Я на стороне воды. Пока что она у меня во фляге.", "I'm on the side of water. For the moment it's in my flask."),
])

# ---- обучающие реплики (реакции на походку) ----
S("DLG_TUT_001", "SandWalk:Regular", [("Kair", "Tense", "Sawī jamm. Ka-miḍbaṭ, maš ka-nafr.",
    "Слишком ровно. Так стучит тампер, а не человек.", "Too even. That's how a thumper knocks, not a person.")])
S("DLG_TUT_002", "NoiseAbove:0.7", [("Kair", "Tense", "Ḥā tafšul! Fašl hun — jahr.",
    "Не беги! Здесь бег — это крик.", "Don't run! Out here, running is shouting.")])
S("DLG_TUT_003", "SandWalk:Irregular", [("Kair", "Calm", "Hākā. Isrub hākā.",
    "Вот так. Так и иди.", "Like that. Keep walking like that.")])
S("DLG_TUT_004", "Surface:Rock", [("Kair", "Calm", "Ṣalt. Hun ṭāq taḥūf — wa-ṭāq tasrub kufa tabġī.",
    "Камень. Тут можно выдохнуть и ступать как угодно.", "Rock. Here you can breathe out and step however you like.")])
S("DLG_TUT_005", "SandWalk:Regular", [("Ilva", "Calm", "An-ḍabṭ yanummak qubay naġmak.",
    "Ритм выдаёт вас раньше, чем голос.", "Your rhythm gives you away before your voice does.")])
S("DLG_TUT_006", "Surface:PackedSand", [("Kair", "Tense", "Tirb šahb yaṭbul ka-ṭabl. Dūr.",
    "Светлый песок гудит, как барабан. Обходи.", "Pale sand booms like a drum. Go around.")])

# =====================================================================================================================
# A2. Эрг. «Долго ещё?», бантер: религия, политика, семья, шутки
# =====================================================================================================================
S("DLG_A2_001", "", [
    ("Rayn", "Neutral", "Qaddi ʿad an-Ḍafr? Adwāsī maš dīlī.",
     "Сколько ещё до Когтя? Мои ноги уже не мои.", "How far to the Claw? My feet aren't mine anymore."),
    ("Kair", "Calm", "ʿAd an-Ḍafr nuṣf ḍaww, lin an-tirb yaḥill.",
     "До Когтя полдня — если песок позволит.", "Half a day to the Claw — if the sand allows."),
])

# религия: спит ли Бог в каждом черве
S("DLG_A2_B01", "ZoneEnter:A2_Erg", [
    ("Rayn", "Neutral", "Yā Kayr, kay wakīd: Il yašān fu-kull ḥūl? Aw fu-an-aḍkham ġīr?",
     "Кайр, правда, что Бог спит в каждом черве? Или только в самом большом?", "Kair, is it true God sleeps in every worm? Or only in the biggest?"),
    ("Kair", "Wry", "Ḥanābin Kīn yalqutū: fu-kull ḥūl. Wa-fu-an-aḍkham — li-dī yaḥluṣ ajamm.",
     "Жрецы Кина говорят: в каждом. А в самом большом — это для тех, кто платит больше.", "Keen's priests say: in every one. And in the biggest — that's for those who pay more."),
    ("Ilva", "Calm", "Bayd Il an-Mašṭūr maš dašn. Šaṭar ʿaynuh li-an-ṣaḥr, maš li-an-khazn.",
     "Но Разделённый Бог — не товар. Он разделил Себя ради пустыни, а не ради казны.", "But the Divided God is not merchandise. He divided Himself for the desert, not for the treasury."),
    ("Kair", "Neutral", "Tū taqrā khuṭūṭhum ajamm mun an-ḥanābin. Hād muqšiʿ, yā ḥalīt.",
     "Вы читаете их книги лучше самих жрецов. Это опасно, сестра.", "You read their scriptures better than the priests do. That's dangerous, sister."),
    ("Ilva", "Calm", "Maš muqšiʿ an-qirā. Muqšiʿ an-ḥašn bād an-qirā.",
     "Опасно не чтение. Опасно молчание после чтения.", "Reading isn't dangerous. Silence after reading is."),
    ("Rayn", "Wry", "Tūm taḥšunū ka-ānu maš hun. Ānu ḥalaṣku li-hād an-sarb!",
     "Вы разговариваете так, будто меня здесь нет. Между прочим, этот поход оплатил я!", "You two talk as if I weren't here. I paid for this trip, by the way!"),
])

# политика: десятина водой
S("DLG_A2_B20", "ZoneEnter:A3_Approach", [
    ("Rayn", "Neutral", "Yā Kayr, qaddi ʿušr an-nuṭf? Qaddi yaḥluṣ an-tabr?",
     "Кайр, сколько составляет водяная десятина? И сколько платит сиетч?", "Kair, how much is the water tithe? And how much does a sietch pay?"),
    ("Kair", "Neutral", "Kull nuṭfat ʿaš. Mun kull ḥalq, mun kull qull, wa-ayḍ mun dumʿ an-khufūt.",
     "Каждая десятая капля. С каждого кольца, с каждого кувшина — и даже со слёз на похоронах.", "Every tenth drop. From every ring, every jar — even from tears at a funeral."),
    ("Rayn", "Afraid", "Mun dumʿ?! Maš ṭāq ḥaṣr!",
     "Со слёз?! Это невозможно сосчитать!", "Tears?! That can't be counted!"),
    ("Kair", "Wry", "Kīn yaḥṣur kull. Li-hād ladayh ḥanābin ḥāṣirīn.",
     "Кин считает всё. Для этого у него и жрецы-счетоводы.", "Keen counts everything. That's what its bookkeeper-priests are for."),
    ("Ilva", "Calm", "Li-hād an-nahḍiyyīn ġabarū. Hum yaḥluṣū, bayd maš li-an-ḥanābin.",
     "Поэтому возрожденцы и ушли. Они платят — но не жрецам.", "That's why the revivalists left. They pay — just not to the priests."),
])

# семья и шутки: «свадьба или мешок»
S("DLG_A2_B30", "ZoneEnter:A2_Erg", [
    ("Rayn", "Neutral", "Yā Kayr, kay ladak ʾahl? Zawjat, ṣiġāġ? Aw tū zawaj an-ṣaḥr?",
     "Кайр, у вас есть семья? Жена, дети? Или вы женаты на пустыне?", "Kair, do you have a family? A wife, children? Or are you married to the desert?"),
    ("Kair", "Calm", "Ladī umm fu-Kīn, tadšin ġazl. Kull-mā ġabarku, talqut: ġad takurr bi-ʿurs aw fu-kīs.",
     "Есть мать. В Кине, торгует нитками. Каждый раз, как я ухожу, говорит: вернёшься либо со свадьбой, либо в мешке.", "I have a mother, in Keen, selling thread. Every time I leave she says: you'll come back with a wedding or in a sack."),
    ("Ilva", "Amused", "Wa-ayy tabġī, yā Kayr?",
     "И что вы предпочитаете, Кайр?", "And which do you prefer, Kair?"),
    ("Kair", "Wry", "An-kīs aqrab. An-ʿurs yabġī nuṭf li-kull tabr, wa-an-kīs — li-ḥad.",
     "Мешок ближе. Свадьбе нужна вода на весь сиетч, а мешку — на одного.", "The sack is closer. A wedding needs water for a whole sietch; a sack, for one."),
    ("Rayn", "Amused", "Ānu abġī an-ʿurs. An-nuzul yazūdū hibāt, wa-ānu aḥṣur.",
     "Я бы выбрал свадьбу. Гости приносят подарки, а я бы их пересчитал.", "I'd pick the wedding. Guests bring gifts, and I'd count them."),
    ("Kair", "Wry", "Iḥdaq, yā ḥalīt: yaḥṣur an-hibāt, wa-bād an-nuzul, wa-bād nuṭf jildhum.",
     "Видите, сестра: сначала считает подарки, потом гостей, потом воду в их костюмах.", "See, sister: first he counts the gifts, then the guests, then the water in their suits."),
])

# костюм пьёт
S("DLG_A2_B40", "MoistureBelow:0.5", [
    ("Rayn", "Afraid", "Jildī yamṣuṣnī ḥafz. Kay ḥaṭṭkuh ġalaṭ?",
     "Мой костюм вытягивает из меня воду слишком быстро. Я неправильно его надел?", "My suit drains me far too fast. Did I put it on wrong?"),
    ("Kair", "Neutral", "Izumm raqbatak. Iṣukk fummak. Ḥūf bi-anfak. Kull luqt nuṭf, yā Rayn.",
     "Затяни горловину. Закрой рот. Дыши носом. Каждое слово — это вода, Рэйн.", "Tighten the collar. Shut your mouth. Breathe through your nose. Every word is water, Rayn."),
])

S("DLG_A2_B42", "Surface:Rock", [
    ("Ilva", "Calm", "Tū taṣbun an-ṣalt ʿurr ḥadq. Kufa?",
     "Вы находите камень, не глядя. Как?", "You find rock without looking. How?"),
    ("Kair", "Wry", "Adwāsī ʿalašū. Ānu aradaf hum, wa-abayyin ka-ānu musarrib.",
     "Ноги знают. Я иду за ними и делаю вид, что веду.", "My feet know. I follow them and pretend I'm the one leading."),
    ("Ilva", "Warm", "Hād an-musarrib.",
     "Вот это и есть проводник.", "That's exactly what a guide is."),
])

S("DLG_A2_B45", "MoistureBelow:0.35", [
    ("Ilva", "Calm", "An-ṭull nuṭf ayḍ, Bā-Rayn. Iṭmun fu-ṭull ʿaš ḥawfāt.",
     "Тень — тоже вода, мастер Рэйн. Постойте в ней десять вдохов.", "Shade is water too, Master Rayn. Stand in it for ten breaths."),
    ("Rayn", "Afraid", "ʿAš? Ānu maš ṭāq… bayd ṣāf. Ṣāf.",
     "Десять? Я не смогу… Ладно. Хорошо, хорошо.", "Ten? I can't… Fine. All right, all right."),
])

# похороны, вода мёртвых; шутка про привычку считать
S("DLG_A2_B50", "ZoneEnter:A3_Approach", [
    ("Rayn", "Neutral", "Yā Kayr, kay wakīd: an-tabr yakurr nuṭf an-khufūt li-an-ḍumm? Hum khufūt!",
     "Кайр, правда, что в сиетчах воду умерших возвращают общине? Это же покойники!", "Kair, is it true the sietches return the water of the dead to the community? They're corpses!"),
    ("Kair", "Calm", "Maš nuṭf khufūt. Nuṭf jaddunā. Yamṣuṣūhā bi-ḥamd, bayd maš bi-jahr.",
     "Не «вода покойников». Вода нашего деда. Её пьют с благодарностью, только вслух об этом не говорят.", "Not 'the water of corpses'. Our grandfather's water. It's drunk with gratitude — just never aloud."),
    ("Ilva", "Wry", "Bā-Rayn yanšad ka-ḥāṣir.",
     "Мастер Рэйн спрашивает, как составитель описи.", "Master Rayn asks questions like a man drawing up an inventory."),
    ("Rayn", "Wry", "Daʾb. Naqš ṣāf — sawm ṣāf.",
     "Привычка. Хорошая память — хорошая цена.", "Habit. Good memory, good price."),
])

# --- встреча с червём ---
S("DLG_A2_ARR_01", "", [
    ("Kair", "Tense", "Iṭmunū. Kay taṣnutū? An-tirb yaḍbuṭ ka-fuʾd.",
     "Стойте. Слышите? Песок бьётся, как сердце.", "Hold. Hear that? The sand is beating like a heart."),
    ("Ilva", "Whisper", "Yatūl ʿadnā sawī. An-ḥūl an-ṭalīq yadūr — hād sawī.",
     "Идёт прямо на нас. Дикий червь петляет, а этот идёт по прямой.", "It's coming straight at us. A wild worm wanders; this one goes straight."),
    ("Kair", "Tense", "An-ṭalīq maš yasrub hākā… Iṭmunū kull. Ḥā tafšulū, ḥā taḍbuṭū.",
     "Дикие так не ходят… Все — стоять. Не бежать, не стучать.", "Wild ones don't move like that… Everyone, stand still. Don't run, don't knock."),
])
S("DLG_A2_RIDER_01", "", [
    ("Ossana", "Wry", "Ṭull fūqkum. Ḥall kaffak mun an-sikk, yā musarrib. Lin baġayku — ḥaṭam qad.",
     "Тень над вами. Убери руку с ножа, проводник. Захоти я вас съесть — он бы уже поел.", "Shade on you. Hand off the knife, guide. Had I wanted you eaten, he'd have eaten by now."),
    ("Kair", "Tense", "Qātibat. Wa-fu-Kīn yaʿhadū: hum maš tamm.",
     "Наездница. А в Кине клянутся, что вас нет.", "A rider. And in Keen they swear you don't exist."),
    ("Ossana", "Neutral", "Kīn yaʿhad jamm. An-Nāʾib ʿalaš inn tūm tasrubū — mun an-Ḥarf.",
     "Кин многим клянётся. Наиб знает, что вы идёте. Знает с самого Гребня.", "Keen swears to a great deal. The naib knows you're coming. He has known since the Ridge."),
    ("Rayn", "Afraid", "Yaḥdaqnī… Maš ladayh aḥdāq — wa-yaḥdaq!",
     "Он смотрит на меня… У него нет глаз — а он смотрит!", "It's looking at me… It has no eyes — and it looks!"),
    ("Ossana", "Neutral", "Yaḥdaq nuṭfak, yā daššān. Ḥā tarʿaš. Qubay-kum šaḥan an-ʿaššārīn tinā, fu-zahr. Maš nākhū.",
     "Он смотрит на твою воду, купец. Не дрожи. До вас десятинщики посылали двоих — весной. Они не дошли.", "It looks at your water, merchant. Stop shaking. Before you, the tithe-men sent two — in spring. They never arrived."),
    ("Kair", "Tense", "Tinā? Naḥ maš ʿalašnu—",
     "Двоих? Мы не зна—", "Two? We didn't kn—"),
    ("Ossana", "Neutral", "—nu. ʿAlašku. Mun an-Ḥarr yaṭliʿ ʿajj, ʿad ḥalk yatūl. Jūfū mun an-Ḍafr, b-an-falq. Irdifū an-ʿuqūf.",
     "—ли. Знаю. С юга поднимается буря, к ночи она здесь. Входите через Коготь, по трещине. Идите по крючьям.", "—ow. I know. A storm is rising from the south; by nightfall it's here. Enter through the Claw, by the crack. Follow the hooks."),
    ("Ilva", "Calm", "Tūm maš tulkun li-an-ʿajj. Tulkun li-taḥduqū ʿadnā.",
     "Вы приехали не из-за бури. Вы приехали на нас посмотреть.", "You didn't come because of the storm. You came to look at us."),
    ("Rider1", "Tense", "Yā Ossāna! An-Ḥūl maš yaṭmun!",
     "Оссана! Червь не стоит на месте!", "Ossana! The worm won't hold still!"),
    ("Ossana", "Wry", "Wa-tū taḥdaq ʿūd, yā qāṣidat. Ġad alqut li-an-Nāʾib. — Irdifū an-ʿuqūf. Maš ġad anqub tūm kurr tinā.",
     "А ты смотришь в ответ, паломница. Я скажу об этом наибу. — Идите по крючьям. Второй раз искать вас мы не станем.", "And you look back, pilgrim. I'll tell the naib that. — Follow the hooks. We won't search for you a second time."),
])

# --- состояния червя (реакции) ---
S("DLG_WRM_L01", "WormState:Listening", [("Kair", "Tense", "Iṭmun. Ḥā tafšul. An-Ḥūl yaṣnut an-tirb.",
    "Замри. Не беги. Червь слушает песок.", "Freeze. Don't run. The worm is listening to the sand.")])
S("DLG_WRM_L02", "WormState:Listening", [("Ilva", "Whisper", "An-ṣalt yarʿaš duḥ adwāsukum. Kay taḥussū?",
    "Камень дрожит под ногами. Чувствуете?", "The rock is trembling under your feet. Do you feel it?")])
S("DLG_WRM_L03", "WormState:Listening", [("Rayn", "Afraid", "Ilqut inn hād hubb. Bi-ṭullak, ilqut.",
    "Скажите, что это ветер. Пожалуйста, скажите.", "Tell me that's the wind. Please, tell me.")])
S("DLG_WRM_A01", "WormState:Approach", [("Kair", "Tense", "ʿAd an-ṣalt. Bi-hawn. Sarb — wa-iṭmun.",
    "К камню. Медленно. Шаг — и замри.", "To the rock. Slowly. A step — and freeze.")])
S("DLG_WRM_A02", "WormState:Approach", [("Rayn", "Afraid", "Ānu ġad aḥluṣ! Li-mūn? Li-mūn hun yaḥluṣū?!",
    "Я заплачу! Кому? Кому тут вообще платят?!", "I'll pay! To whom? Who even gets paid out here?!")])
S("DLG_WRM_A03", "WormState:Approach", [("Ilva", "Calm", "An-qušʿ yaṭbul ayḍ, Bā-Rayn. Ḥūf.",
    "Страх тоже шумит, мастер Рэйн. Дышите.", "Fear makes noise too, Master Rayn. Breathe.")])
S("DLG_WRM_S01", "WormState:Surface", [("Kair", "Reverent", "Šay-Ḥulūd…",
    "Шай-Хулуд…", "Shai-Hulud…")])
S("DLG_WRM_S02", "WormState:Surface", [("Rayn", "Whisper", "Hū aḍkham mun ṭayr. Ānu taqal inn hād qiṣṣ ġīr.",
    "Он больше корабля. А я думал, это просто байка.", "It's bigger than a ship. And I thought it was only a tale.")])
S("DLG_WRM_P01", "", [
    ("Kair", "Calm", "Ḥūfū. Hum ḥallū sāb an-Ḥūl, wa-naḥ nasrub.",
     "Дышите. Они остались с червём, а мы идём дальше.", "Breathe. They stayed with the worm, and we walk on."),
    ("Rayn", "Whisper", "Hū ṭaman bi-luqtahā. Maš ḥawḍ — maš fu-ḥawḍ—",
     "Он замер по её слову. Ни один чан… ни в одном чане такого не—", "It stopped at her word. No vat… no vat could ever—"),
    ("Ilva", "Calm", G, "Чан, мастер Рэйн? Какой чан?", "Vat, Master Rayn? What vat?"),
    ("Rayn", "Afraid", G, "Для воды. Чаны для воды. Торговое словечко.", "For water. Water vats. Trade talk."),
])
S("DLG_THM_001", "Interact:Rakis.Thumper", [("Kair", "Tense", "An-miḍbaṭ yanfilnā ḥawfāt nazr. Iḥfuzū.",
    "Тампер даст нам несколько вдохов. Не больше. Идём.", "The thumper buys us a few breaths. No more. Move.")])

# =====================================================================================================================
# A3. Коготь: обсуждение вестей Оссаны, религия, шутки
# =====================================================================================================================
S("DLG_A3_001", "", [
    ("Rayn", "Neutral", "Tinā. Laqatat: tinā. Šāl jarā lahum?",
     "Двоих. Она сказала: двоих. Что с ними случилось?", "Two. She said: two. What happened to them?"),
    ("Kair", "Neutral", "Laqatat: maš nākhū. Maš laqatat: māt.",
     "Она сказала «не дошли». Она не сказала «умерли».", "She said they didn't arrive. She didn't say they died."),
    ("Ilva", "Calm", "Kay ʿalaška hum, yā Kayr?",
     "Вы их знали, Кайр?", "Did you know them, Kair?"),
    ("Kair", "Neutral", "…Ḥad. Ladayh ġurm lī: nuṭf, maš jamm. Bayd ānu naqašku.",
     "…Одного. Он мне должен воды. Немного. Но я помню.", "…One. He owes me water. Not much. But I remember."),
    ("Rayn", "Wry", "ʿAsā hū yadiss mun an-ġurm.",
     "Может, он просто прячется от долга.", "Maybe he's just hiding from the debt."),
    ("Ilva", "Tense", "Bā-Rayn.", "Мастер Рэйн.", "Master Rayn."),
    ("Kair", "Wry", "Ḥallūh yahzul. Mā yahzul — yasrub.",
     "Пусть шутит. Пока шутит — идёт.", "Let him joke. As long as he jokes, he walks."),
])
S("DLG_A3_010", "", [
    ("Rayn", "Neutral", "Ḥadarat fūqah ka-darj. Darj ḥayy.",
     "Она спустилась по нему, как по лестнице. Живой лестнице.", "She came down it like a staircase. A living staircase."),
    ("Kair", "Wry", "An-darj maš yaṭraḥak.",
     "Лестница не пытается тебя сбросить.", "A staircase doesn't try to throw you off."),
    ("Rayn", "Wry", "Wa-ḥadaqatak amadd mun kull, yā ḥalīt.",
     "А на вас она смотрела дольше всех, сестра.", "And she looked at you longest of all, sister."),
    ("Ilva", "Calm", "Ḥadaqat kullhum. Ġīr ḥallatnī anbah.",
     "Она смотрела на всех. Просто мне позволила это заметить.", "She looked at everyone. She only let me notice it."),
])
S("DLG_A3_020", "", [
    ("Kair", "Tense", "Mun an-Ḥarr — iḥdaq. Yaṣfarr. Ossāna maš māhat.",
     "На юге — смотрите. Желтеет. Оссана не соврала.", "To the south — look. It's turning yellow. Ossana didn't lie."),
    ("Ilva", "Calm", "Wa-kay ḥadanta inn tamūh?",
     "А вы ждали, что она соврёт?", "Did you expect her to lie?"),
    ("Kair", "Wry", "Ānu Kīnī, yā ḥalīt. Ḥadanku hād mun kull.",
     "Я из Кина, сестра. Я жду этого от всех.", "I'm from Keen, sister. I expect it of everyone."),
])
S("DLG_A3_030", "ZoneEnter:A3_Approach", [
    ("Rayn", "Neutral", "Lin an-Nāʾib ʿalaš inn naḥ tasrub… kay ʿalaš lišāl?",
     "Если наиб знает, что мы идём… знает ли он зачем?", "If the naib knows we're coming… does he know why?"),
    ("Kair", "Tense", "Lišāl — ʿalaš ġīr ānu, wa-šāl ānu ʿātil.",
     "Зачем — знаю только я. Я и то, что я несу.", "Why — only I know. Me, and what I carry."),
    ("Ilva", "Wry", "Wa-mun ašḥanak. Wa-ʿasā an-Nāʾib ayḍ.",
     "И тот, кто вас послал. И, похоже, наиб.", "And whoever sent you. And, it seems, the naib."),
])
S("DLG_A3_040", "ZoneEnter:A3_Approach", [
    ("Kair", "Whisper", "Ḥanābin Kīn laqatū: fu-an-ṣaḥr maš tamm ḍumm — Il ġīr.",
     "Жрецы Кина говорили: в пустыне нет людей, только Бог.", "Keen's priests said: there are no people in the desert, only God."),
    ("Ilva", "Wry", "Wa-Il, ʿasā, yaʿtil an-ḍumm fūq ḍahruh.",
     "А Бог, выходит, возит людей у себя на спине.", "And God, it seems, carries people on His back."),
    ("Rayn", "Neutral", "Wa-yaṭmun ḥīn yuqāl. Hād… hād yaqlib an-sawm.",
     "И замирает по приказу. Это… это меняет цены.", "And stands still when told. That… that changes prices."),
])
# шутки про песок
S("DLG_A3_050", "ZoneEnter:A3_Approach", [
    ("Rayn", "Wry", "An-tirb fu-jildī, fu-aḥdāqī, wa-ʿasā fu-luqtī.",
     "Песок у меня в костюме, в глазах и, кажется, даже в словах.", "There's sand in my suit, in my eyes, and I think even in my words."),
    ("Kair", "Amused", "Fu-luqtak qadīm, yā Rayn. Ġīr maš nadayka tirb.",
     "В твоих словах он давно. Просто ты не называл это песком.", "It's been in your words for ages, Rayn. You just never called it sand."),
    ("Ilva", "Wry", "Yā Kayr, hād ʿakir.",
     "Кайр, это было жестоко.", "Kair, that was cruel."),
    ("Kair", "Wry", "Hād rakīṣ. ʿAkir — ḥīn alḥaf nuṭfah.",
     "Это было дёшево. Жестоко — это когда я заберу у него воду.", "That was cheap. Cruel is when I take his water."),
])

# =====================================================================================================================
# A4–A6. Крючья, тропа, щель
# =====================================================================================================================
S("DLG_A4_001", "", [
    ("Kair", "Calm", "Iḥdaqū: ʿuqūf. Šalt ḥuzūz, ṭarī. Hun yabdaʾ an-masrab.",
     "Смотрите: крючья. Три свежие насечки. Здесь начинается тропа.", "Look: hooks. Three fresh notches. The path starts here."),
    ("Rayn", "Afraid", "Masrab? Hād jāl!",
     "Тропа? Это стена!", "A path? That's a wall!"),
    ("Kair", "Wry", "An-jāl — li-an-mustaʿjil. Naḥ nasrub bi-darj.",
     "Стена — для торопливых. Мы идём по ступеням.", "A wall is for the hasty. We take the steps."),
])
S("DLG_A5_001", "", [
    ("Kair", "Calm", "Iḥdaqū an-ʿuqūf? Aqdam mun Kīn — wa-ḥattā dulā yaʿqudū.",
     "Видите крючья? Они старше Кина — и до сих пор держат.", "See the hooks? Older than Keen — and they still hold."),
    ("Rayn", "Afraid", "Ānu… yaqšaʿ. Hun ʿālī. ʿĀlī jamm.",
     "Мне… страшно. Тут высоко. Очень высоко.", "I'm… afraid. It's high here. Very high."),
    ("Ilva", "Calm", "Ḥā taḥdaq ʿad ḥadr, Bā-Rayn. Iḥdaq kaff Kayr.",
     "Не смотрите вниз, мастер Рэйн. Смотрите на руки Кайра.", "Don't look down, Master Rayn. Watch Kair's hands."),
])
S("DLG_A5_005", "", [
    ("Ilva", "Calm", "Mun ḥadr an-masrab maš yabān. Dassūh — bi-ṣalt wa-bi-ṭull.",
     "Снизу тропу не видно. Её прятали — камнем и тенью.", "From below the path can't be seen. They hid it — with stone and with shade."),
])
S("DLG_A5_010", "", [
    ("Rayn", "Afraid", "Lin ānu aṭraḥ… ilqut li-ummī: ānu bāt daššān ṣādiq.",
     "Если я упаду… передайте моей матери: я был честным купцом.", "If I fall… tell my mother: I was an honest merchant."),
    ("Kair", "Wry", "Ṣādiq? Hī maš ġad taqal.",
     "Честным? Она не поверит.", "Honest? She won't believe it."),
    ("Rayn", "Wry", "Ānu maš ġad aṭraḥ. Ānu ġad aʿlaq ʿalā ḍahrak.",
     "Я не упаду. Я повисну на вашей спине.", "I won't fall. I'll hang on your back."),
    ("Kair", "Amused", "Fa ḥatm ḥalaṣ. Sawm an-ḍahr — ʿušr.",
     "Тогда плати. Цена спины — десятина.", "Then pay. The price of a back is a tithe."),
])
S("DLG_A6_001", "", [
    ("Kair", "Whisper", "Hādī an-falq. Maš ḥad yaṣbunhā.",
     "Вот щель. Её никто не находит.", "There's the cleft. Nobody finds it."),
    ("Ilva", "Calm", "An-ṭull sadd. Fa — ṭulnā.",
     "Тень — дверь. Значит, мы пришли.", "Shade is a door. So — we have arrived."),
    ("Rayn", "Wry", "Ṭull… ṣāf.",
     "Тень… хорошо.", "Shade… good."),
])

# =====================================================================================================================
# B1. Шлюз
# =====================================================================================================================
S("DLG_B1_001", "", [
    ("Guard", "Neutral", "Iṭmunū. Aqnāʿ. Raqbāt — bayyinū. Hun nuṭf maš yunfal.",
     "Стоять. Маски. Горловины покажите. Воду здесь не дарят.", "Halt. Masks. Show me your collars. Water isn't given away here."),
    ("Guard", "Neutral", "Dī yanzif — yarbaḍ ʿad an-sadd ʿad bakr. Hākā an-ḥukm.",
     "Кто течёт — сидит у двери до утра. Таков закон.", "Anyone who leaks sits by the door till morning. That's the law."),
    ("Rayn", "Afraid", "Jildī ṭarī. Kīnī — ṣāf jamm!",
     "У меня костюм новый. Кинский — очень хороший!", "My suit is new. Keen-made — a very good one!"),
    ("Guard", "Wry", "Kīnī? Fa ʿakir. Izumm ʿalā unmul. Wa-ḥā taḍḥak: asnān taḥill an-nuṭf.",
     "Кинский? Значит, плохой. Подтяни на палец. И не улыбайся: зубы влагу теряют.", "Keen-made? Then it's bad. A finger tighter. And don't smile — teeth lose moisture."),
    ("Guard", "Neutral", "Tū Kayr, an-musarrib? An-Nāʾib ʿalaš. Mun hun masrab ḥad — ʿad an-qāʿ. Bi-ḥašn.",
     "Ты — Кайр, проводник? Наиб предупреждён. Отсюда одна дорога — в зал. Тихо.", "You're Kair, the guide? The naib is warned. From here there's one road — to the hall. Quietly."),
])

# =====================================================================================================================
# B2. Галерея. Разговоры толпы (сцены 3–6 реплик) и бантер спутников
# =====================================================================================================================
# Шиана и Шайтан (шёпот, религия)
S("DLG_B2_C01", "ZoneEnter:B2_Gallery", [
    ("Crowd", "Whisper", "Yalqutū: Šiyāna taḥšun sāb Šayṭān.",
     "Говорят, Шиана беседует с Шайтаном.", "They say Sheeana talks with Shaitan."),
    ("Crowd", "Whisper", "Taḥšun. Wa-hū yaṣnut. Hād an-muqšiʿ.",
     "Беседует. А он слушает. Вот что страшно.", "She talks. And he listens. That's the frightening part."),
    ("Crowd", "Whisper", "Maš muqšiʿ — hād ṣāf. Dulā Il yaṣnut ḥad.",
     "Не страшно, а хорошо. Бог наконец слушает хоть кого-то.", "Not frightening — good. God is finally listening to someone."),
    ("Crowd", "Whisper", "Ḥašš. Barriyyīn qurb.",
     "Тише. Чужие рядом.", "Hush. Strangers nearby."),
])
# спор о десятине
S("DLG_B2_C10", "ZoneEnter:B2_Gallery", [
    ("Crowd", "Angry", "Kīn laḥaf ʿušr an-nuṭf ʿūd!",
     "Кин опять забрал водяную десятину!", "Keen has taken the water tithe again!"),
    ("Crowd", "Angry", "Ḥallū yalḥafū. Mun naḥ nuṭfat — wa-mun hum ḥiṣr.",
     "Пусть берут. С нас капля — с них потом спросится.", "Let them take it. A drop from us — a reckoning from them."),
    ("Crowd", "Angry", "Nuṭfatak hī qull ṣiġāġī, yā ḥādiq!",
     "Твоя «капля» — это кувшин моих детей, умник!", "Your 'drop' is my children's jar, clever one!"),
    ("Crowd", "Whisper", "Ḥašš. Hum yaṣnutū.",
     "Тише. Нас слушают.", "Hush. They're listening."),
])
# корабли, Досточтимые
S("DLG_B2_C20", "ZoneEnter:B2_Gallery", [
    ("Elder", "Whisper", "Fūq Kīn ṭayr ʿūd. Yalqutū: fu-ḥad — nisā bi-sawād.",
     "Над Кином опять корабли. Говорят, на одном — женщины в чёрном.", "Ships over Keen again. They say there are women in black aboard one."),
    ("Weaver", "Whisper", "An-Sawādiyyāt? Dī yaḥdaqū Šiyāna?",
     "Сёстры в чёрном? Те, что следят за Шианой?", "The Black Sisters? The ones who watch Sheeana?"),
    ("Elder", "Whisper", "Hum fu-kull. Dī yalqut ṣaḥḥ jamm — ṣaqal fu-an-dayr.",
     "Они везде. Кто говорит слишком правильно — учился в обители.", "They're everywhere. Whoever speaks too correctly studied in the convent."),
    ("Weaver", "Whisper", "Wa-tamm ḥawḍiyyīn ayḍ. Hum ʿakir ajamm: yaḍḥakū ḥīn yaḥṣurū ʿaḍmak.",
     "А ещё есть люди из чанов — тлейлаксу. Те хуже: улыбаются, пока считают твои кости.", "And then there are the vat-people — the Tleilaxu. Worse: they smile while they count your bones."),
    ("Elder", "Afraid", "Ḥā talqut hum bi-jahr duḥ an-ṣalt. An-ṣalt yaṣnut.",
     "Не называй их вслух под камнем. Камень слышит.", "Don't name them aloud under the stone. The stone listens."),
])
# торг: вода и нитки (политика, шутка)
S("DLG_B2_M10", "", [
    ("Trader", "Wry", "Šalt anāmil nuṭf li-ḥad ġazl? Tū taḍḥak ʿalay, yā Nūra?",
     "Три пальца воды за один моток нити? Ты смеёшься надо мной, Нура?", "Three fingers of water for one skein of thread? Are you laughing at me, Nura?"),
    ("Carrier", "Calm", "Šalt anāmil, wa-maš nuṭfat nazr. Kīn rafaʿ an-ʿušr, wa-qullī maš ṣāra aḍkham.",
     "Три пальца — и ни каплей меньше. Кин поднял десятину, а мой кувшин больше не стал.", "Three fingers, not a drop less. Keen raised the tithe, and my jar didn't get any bigger."),
    ("Trader", "Wry", "Kīn, Kīn… Kull-mā Kīn. An-ġazl bārī, maš yaḥubb an-ḥanābin.",
     "Кин, Кин… Всё у вас Кин. Нитка не виновата, что жрецы любят воду.", "Keen, Keen… always Keen. The thread isn't to blame that priests love water."),
    ("Carrier", "Amused", "Fa tinā anāmil wa-ḍiḥkatak. Fu-Kīn an-ḍiḥk ajamm sawm mun an-nuṭf.",
     "Тогда два пальца и твоя улыбка. В Кине улыбка дороже воды.", "Then two fingers and your smile. In Keen a smile costs more than water."),
    ("Trader", "Amused", "Sarq! Ṣāf. Iluḥaf an-ġazl qubay ānu aqlib.",
     "Грабёж! Ладно. Бери нитку, пока я не передумал.", "Robbery! Fine. Take the thread before I change my mind."),
])
# ленты Шианы (религия)
S("DLG_B2_M20", "", [
    ("Pilgrim", "Calm", "Hād an-ʿiṣb — kay wakīd mun jildhā?",
     "Эта лента правда от Её платья?", "Is this ribbon really from Her dress?"),
    ("Weaver", "Wry", "An-wakd — dī taqal. Wa-an-ġazl an-nīl dīlī; ānu ṣabaġkuh.",
     "Правда — это то, во что веришь. А синяя нитка моя: я её сама красила.", "Truth is what you believe. And the blue thread is mine — I dyed it myself."),
    ("Pilgrim", "Calm", "Bayd Il maš fu-an-ġazl.",
     "Но Бог ведь не в нитке.", "But God is not in the thread."),
    ("Weaver", "Warm", "Il fu-kull. Wa-an-ʿiṣb li-kaff maliy ḥīn taṣnut Il.",
     "Бог во всём. А лента — чтобы руки были заняты, пока слушаешь Бога.", "God is in everything. The ribbon is so your hands stay busy while you listen to God."),
    ("Pilgrim", "Amused", "Fa nafilī dirʿān. Kaffī khāw ayḍ.",
     "Тогда отмерь мне два локтя. У меня руки тоже пустуют.", "Then measure me two cubits. My hands are empty too."),
])
# мать и ребёнок (семья, религия)
S("DLG_B2_M30", "", [
    ("Child", "Neutral", "Yā Ummī, lišāl maš ṭāq fašl hun? Ānu ḥašīn!",
     "Мам, почему здесь нельзя бегать? Я же тихо!", "Mama, why can't I run here? I'm being quiet!"),
    ("Mother", "Calm", "Ḥašīn — ḥīn tū maš taṣnut adwāsak. Wa-ānu aṣnutak mun an-ṣihr.",
     "Тихо — это когда сам не слышишь своих ног. А я тебя слышу от самой цистерны.", "Quiet is when you can't hear your own feet. And I hear you all the way from the cistern."),
    ("Child", "Neutral", "Wa-an-Ḥūl yaṣnut? Hun, duḥ an-ṣalt?",
     "А червь услышит? Здесь, под камнем?", "And will the worm hear? Here, under the rock?"),
    ("Mother", "Calm", "An-Ḥūl yaṣnut kull, yā nuṭfatī. Li-hād naṣqal nasrub ġayr.",
     "Червь слышит всех, моя капелька. Поэтому мы и учимся ходить иначе.", "The worm hears everyone, my little drop. That's why we learn to walk differently."),
    ("Child", "Wry", "Wa-laqatka inn Il ṣāf.",
     "А ты говорила, что Бог добрый.", "But you said God is good."),
    ("Mother", "Amused", "Ṣāf. Bayd ḍakhm. Wa-an-aḍkham maš yasrub ḥašīn.",
     "Добрый. Просто большой. А большие не умеют ходить тихо.", "He is. He's just big. And the big ones can't walk quietly."),
])
# свадьба, калым, свекровь
S("DLG_B2_M40", "", [
    ("Carrier", "Warm", "Bint Jabr ladhā ʿarīs! Wa-hū ʿatal rabaʿ ḥulūq mahr.",
     "У дочери Джабра жених! И он принёс в калым четыре кольца воды.", "Jabr's daughter has a groom! And he brought four water rings as the bride-price."),
    ("Weaver", "Wry", "Rabaʿ ḥulūq? Li-bint Jabr — karīm. Hī tawill ʿakir ajamm mun miḍbaṭ.",
     "Четыре кольца? За дочь Джабра — щедро. Она поёт хуже тампера.", "Four rings? For Jabr's daughter, that's generous. She sings worse than a thumper."),
    ("Carrier", "Wry", "Bayd hī taṭbukh. Wa-ḥamāthā Umm-Qāsim.",
     "Зато она готовит. А свекровь у неё — Умм-Касим.", "But she cooks. And her mother-in-law is Umm Qasim."),
    ("Weaver", "Afraid", "Umm-Qāsim?! Yā ṭull! An-Ḥūl ajamm ṣāf.",
     "Умм-Касим?! Ох, тень моя! Лучше уж червь.", "Umm Qasim?! Oh, my shade! A worm would be better."),
    ("Carrier", "Whisper", "Ḥašš! Hī wara an-sitr.",
     "Тише! Она за занавеской.", "Hush! She's behind the curtain."),
    ("Weaver", "Amused", "Ḥallahā taṣnut. Ānu ṭalabku ġazl li-ḥizām an-ʿurs — aqwā ġazl, li-an-ḥamāt.",
     "Пусть слушает. Я уже заказала нить на свадебный пояс — самую прочную, на свекровь.", "Let her listen. I've already ordered thread for the wedding sash — the strongest kind, in case of the mother-in-law."),
])
# политика: возрожденцы против жрецов
S("DLG_B2_P10", "", [
    ("Youth", "Neutral", "Yā Jadd, ḥanābin Kīn yalqutū: naḥ sāriqīn an-nuṭf. Wa-naḥ namṣuṣ dīlnā ġīr.",
     "Дед, жрецы Кина говорят, что мы воры воды. А мы пьём только своё.", "Grandfather, Keen's priests say we're water thieves. But we only drink our own."),
    ("Elder", "Wry", "Hum yalqutū: kull nuṭf Rākis li-Il, wa-Il lahum. Ḥiṣr sahl.",
     "Они говорят: вся вода Ракиса принадлежит Богу, а Бог — им. Простая арифметика.", "They say: all the water on Rakis belongs to God, and God belongs to them. Simple arithmetic."),
    ("Youth", "Neutral", "Wa-naḥ šāl nalqut?",
     "А мы что говорим?", "And what do we say?"),
    ("Elder", "Calm", "An-nuṭf li-dī ʿatalhā. Hād laqat jaddī, ḥīn maš tamm ḥanābin.",
     "Вода принадлежит тому, кто её донёс. Так говорил мой дед, когда жрецов ещё не было.", "Water belongs to whoever carried it. My grandfather said so, when there were no priests yet."),
    ("Youth", "Neutral", "Wa-mūn ladah wakd?",
     "И чья правда?", "And whose truth is it?"),
    ("Elder", "Wry", "Dī qullah maliy. Wa-ġayrhum — ḥādiqīn.",
     "Того, у кого кувшин полон. Остальные — умники.", "Whoever's jar is full. The rest are clever ones."),
])
# религия: Шиана — не икона
S("DLG_B2_R10", "", [
    ("Youth", "Neutral", "Yā ḥalīt, kay taqalka inn Il yaʿīš fu-ḥūl?",
     "Сестра, ты правда веришь, что Бог живёт в черве?", "Sister, do you really believe God lives in a worm?"),
    ("Pilgrim", "Calm", "Taqalku inn hū šaṭar ʿaynuh. Wa-fu-ayy qiṭʿ — maš ʿalašku. ʿAsā fu-ḥad ḥašīn jamm.",
     "Я верю, что Он разделил Себя. А в каком куске Он сидит — не знаю. Может, в самом тихом.", "I believe He divided Himself. In which piece He sits — I don't know. Maybe the quietest."),
    ("Youth", "Neutral", "Fa fu-Šiyāna? Hī ḥašīn jamm.",
     "Значит, в Шиане? Она очень тихая.", "So in Sheeana? She is very quiet."),
    ("Pilgrim", "Calm", "Šiyāna ṣuġat, maš qiṭʿ Il. Ḥā tuqallibhā ṣanam. Hī maš tabġī.",
     "Шиана — девочка, а не кусок Бога. Не делай из неё идола. Ей это не нравится.", "Sheeana is a girl, not a piece of God. Don't make an idol of her. She doesn't like it."),
    ("Youth", "Wry", "Ṣāf. Fa an-Ḥūl yaḥnab lahā?",
     "Ладно. А червь тогда молится ей?", "All right. So does the worm pray to her?"),
    ("Pilgrim", "Amused", "Inšad an-Ḥūl. Bi-ḥašn.",
     "Спроси у червя. Только тихо.", "Ask the worm. But quietly."),
])
# старость, еда, дети уходят в Кин
S("DLG_B2_F10", "", [
    ("Elder", "Calm", "Ṣiġāġī mun ġabarū ʿad Kīn. Ladī nafr ʿajūz fu-bayt khāw.",
     "Мои дети ушли в Кин. А я остался стариком в пустом доме.", "My children went off to Keen. And I'm left an old man in an empty house."),
    ("Weaver", "Warm", "Iḥṭam fu-baytī dulā. Ṭabakhku ʿaṣīd wa-tamr.",
     "Приходи есть ко мне. Я сварила кашу с финиками.", "Come and eat at my place. I cooked porridge with dates."),
    ("Elder", "Wry", "ʿAṣīd bi-tamr? Hād ṭaʿām ṣuġāġ. Ānu aqdam mun hād.",
     "Каша с финиками? Это еда для детей. Я староват для такого.", "Porridge with dates? That's a children's meal. I'm too old for it."),
    ("Weaver", "Amused", "Wa-ḥīn ṣiġāġak yatūlū li-ʿurs, yaḥṭamū hād ayḍ.",
     "А когда твои дети приедут на свадьбу, они это тоже съедят.", "And when your children come home for a wedding, they'll eat it too."),
    ("Elder", "Warm", "…Ṣāf. Ġad atūl.",
     "…Хорошо. Приду.", "…All right. I'll come."),
])
# стража
S("DLG_B2_G10", "", [
    ("Guard", "Wry", "An-layla tū tabqā. Ānu baqayku amis.",
     "Сегодня ночью стоишь ты. Я стоял вчера.", "Tonight you stand watch. I stood yesterday."),
    ("Youth", "Wry", "Amis tū šānka wa-tū wāqif. Hād maš yuḥṣar.",
     "Вчера ты спал стоя. Это не считается.", "Yesterday you slept standing up. That doesn't count."),
    ("Guard", "Amused", "Šān wāqif — fann. Kīn maš yuʿallim hād.",
     "Спать стоя — искусство. Кин такому не учит.", "Sleeping on your feet is an art. Keen doesn't teach it."),
    ("Youth", "Wry", "Kīn maš yuʿallim jamm. Bayd yakhuṭṭ an-ʿušr bi-ḥusn.",
     "Кин вообще мало чему учит. Зато красиво выписывает налоги.", "Keen teaches little. But it writes its taxes beautifully."),
])
# дети играют
S("DLG_B2_K10", "", [
    ("Child", "Joy", "Ānu ḥūl! Ānu ḥūl! Tū qātib — iʿlaq fūq ḍahrī!",
     "Я червь! Я червь! А ты наездник — залезай мне на спину!", "I'm the worm! I'm the worm! You're the rider — climb on my back!"),
    ("Girl", "Joy", "An-Ḥūl maš yalqut! An-Ḥūl yaḥšin. Tū khasirka!",
     "Червь не болтает! Червь молчит. Ты проиграл!", "Worms don't chatter! Worms stay quiet. You lose!"),
    ("Child", "Neutral", "Wa-kufa taʿlaš inn ānu ḥūl?",
     "А как тогда ты узнаешь, что я червь?", "Then how will you know I'm the worm?"),
    ("Girl", "Joy", "Mun an-tirb. Tū taḍbuṭ bi-kaʿbak ka-Kīn!",
     "По песку! Ты топаешь пятками, как в Кине!", "By the sand! You stomp your heels like they do in Keen!"),
])

# companions в галерее
S("DLG_B2_B01", "ZoneEnter:B2_Gallery", [
    ("Rayn", "Neutral", "Qaddi ḍumm hun? Mīt? Mītān? Wa-kull mun ṣihr ḥad?",
     "Сколько их здесь? Сотня? Две? И все из одной цистерны?", "How many live here? A hundred? Two hundred? And all from one cistern?"),
    ("Kair", "Tense", "An-nuṭf ġayr ḥaṣr bi-jahr, yā Rayn. Hād ʿayb.",
     "Чужую воду вслух не считают, Рэйн. Это стыдно.", "You don't count other people's water aloud, Rayn. It's shameful."),
])
S("DLG_B2_B03", "ZoneEnter:B2_Gallery", [
    ("Ilva", "Calm", "Iḥdaq an-ṣiġāġ. Yazrafū bi-mā ḥadaqnā ʿad bakr.",
     "Посмотрите на детей. Они играют в то, что мы видели утром.", "Look at the children. They're playing at what we saw this morning."),
    ("Kair", "Neutral", "Fu-Kīn an-ṣiġāġ yazrafū ḥanābin.",
     "В Кине дети играют в жрецов.", "In Keen, children play at priests."),
    ("Ilva", "Calm", "Wa-ayy yašubbū?",
     "И кем вырастают?", "And what do they grow into?"),
])
S("DLG_B2_B06", "ZoneEnter:B2_Gallery", [
    ("Rayn", "Wry", "Hād an-nisj… ānu fu-Kīn adšin hād bi-šalt sawm!",
     "Эти ткани… в Кине я продал бы втрое дороже!", "These fabrics… in Keen I'd sell them for three times the price!"),
    ("Kair", "Wry", "Fu-Kīn tū tadšin ayḍ an-nasm. Hun an-nasm ʿāmm.",
     "В Кине ты и воздух продашь. Здесь воздух общий.", "In Keen you'd sell the very air. Here the air is shared."),
])
S("DLG_B2_B08", "ZoneEnter:B2_Gallery", [
    ("Kair", "Whisper", "ʿAyn an-Ḥūl mā fu-Kīn. Fa lišāl ānu ataqal hum ajamm?",
     "Тот же червь, что и в Кине. Так почему я верю им больше?", "The same worm as in Keen. So why do I believe them more?"),
])
S("DLG_B2_B09", "ZoneEnter:B2_Gallery", [
    ("Rayn", "Neutral", "Aḥdāqhum nīl, kull. Ayḍ an-ṣiġāġ. Qaddi mālanj fu-hād an-nasm?",
     "У всех глаза синие. Даже у детей. Сколько же пряности в этом воздухе?", "Everyone's eyes are blue. Even the children's. How much spice is in this air?"),
    ("Ilva", "Wry", "Qaddi li-taḥill an-ḥiṣr.",
     "Достаточно, чтобы вы бросили считать.", "Enough that you might stop counting."),
])

# B3. Проходы, занавеси, цистерна
S("DLG_B3_C01", "", [
    ("Rayn", "Whisper", "Kull sitr — bayt ḥad?",
     "Каждая занавеска — чей-то дом?", "Is every curtain someone's home?"),
    ("Crowd", "Whisper", "Ḥašš. Hum yašānū.",
     "Тише. Они спят.", "Hush. They're sleeping."),
    ("Kair", "Neutral", "An-sitr sadd. Maš yuzamm — maš tajūf.",
     "Занавеска — дверь. Задёрнута — значит, не входи.", "A curtain is a door. Drawn shut — you don't enter."),
    ("Ilva", "Calm", "Khaṣ ʾahl fu-našš. Yaqsimū kull — wa-an-ḥašn ayḍ.",
     "Пять семей в одной нише. Они делят всё — и тишину тоже.", "Five families to a niche. They share everything — silence too."),
])
S("DLG_B3_S01", "", [
    ("Mother", "Whisper", "Ḥašš. An-ṣuġ šān qad.",
     "Тише. Малыш только уснул.", "Hush. The baby's just fallen asleep."),
    ("Youth", "Whisper", "Ġurmunā li-Umm-Qāsim šalt ḥulūq. ʿad zahr.",
     "Мы должны Умм-Касим три кольца. До весны.", "We owe Umm Qasim three rings. By spring."),
    ("Mother", "Whisper", "ʿAlašku. Ġad aṭraḥ ġazlī mun an-nisj. Wa-adšin.",
     "Знаю. Я сниму свою пряжу со станка. И продам.", "I know. I'll take my yarn off the loom. And sell it."),
    ("Youth", "Whisper", "Maš. Ġad asrub ʿad an-Ḍafr fu-ḥalk. Hnāy yaḥluṣū nuṭfat.",
     "Не надо. Я пойду в ночной дозор на Коготь. Там платят каплей.", "Don't. I'll take the night watch on the Claw. They pay in drops there."),
])
S("DLG_B3_001", "", [
    ("Ilva", "Whisper", "Ḥā taḥdaq an-nuṭf amadd. Hun hād ʿayb.",
     "Не смотрите на воду так долго. Здесь это неприлично.", "Don't stare at the water so long. Here it's improper."),
    ("Rayn", "Afraid", "Ānu… ḥaṣarku ġīr.",
     "Я только… считал.", "I was only… counting."),
    ("Ilva", "Calm", "ʿAlašku. Hād yabān.",
     "Знаю. Это и видно.", "I know. That's what shows."),
])
S("DLG_B4_001", "Interact:Rakis.POI.LORE_Cistern_Grate", [
    ("Kair", "Whisper", "An-šabk aqdam mun Kīn. Aqdam mun an-Ḥanābin. ʿAsā aqdam mun Il fu-ḥūl.",
     "Решётка старше Кина. Старше Церкви. Может, старше Бога в черве.", "This grate is older than Keen. Older than the Church. Maybe older than the God in the worm."),
])
S("DLG_B4_C01", "", [
    ("Elder", "Calm", "Rabaʿān ḥawl aḥṣur an-ḥulūq fu-hād an-šabk. Kull ḥawl — ajamm ḥulūq, wa-nuṭf nazr.",
     "Сорок лет считаю кольца на этой решётке. Каждый год колец больше, а воды меньше.", "Forty years I've counted rings on this grate. Every year more rings, and less water."),
    ("Carrier", "Calm", "Maš nuṭf nazr. Ḍumm ajamm. Aw ʿaṭaš.",
     "Это не воды меньше. Это людей больше. Или жажды.", "It's not less water. It's more people. Or more thirst."),
    ("Elder", "Wry", "An-ʿaṭaš ajamm ʿad ḥanābin Kīn. Yamṣuṣū wa-maš yaḥissū maliy.",
     "Больше всего жажды у жрецов Кина. Пьют — и не чувствуют, что напились.", "The most thirst is among Keen's priests. They drink and never feel full."),
    ("Carrier", "Whisper", "Ḥašš, yā Jadd. Barriyyīn qurb — wa-hum yaḥṣurū.",
     "Тише, дед. Рядом чужие — и они считают.", "Hush, grandfather. Strangers nearby — and they're counting."),
])

# =====================================================================================================================
# B5. Зал. Хор, жрица, наиб. После — жизнь продолжается
# =====================================================================================================================
S("DLG_B5_001", "", [("Crowd", "Reverent", "Rū… rū… rū…", "Ру… ру… ру…", "Ru… ru… ru…")])
S("DLG_B5_P01", "", [
    ("Priestess", "Reverent", "Ō Šāʾin duḥ, ō Šāʾin duḥ — naʿqud ḥašnak… rū.",
     "Спящий внизу, Спящий внизу — мы храним твою тишину.", "Sleeper below, Sleeper below — we keep your silence."),
    ("Priestess", "Reverent", "Yanquš an-tirb dawsan, dawsan maš ḍabaṭ… rū.",
     "Песок помнит ступню, ступню, что не стучала.", "The sand remembers the foot, the foot that did not knock."),
    ("Priestess", "Reverent", "Išṭurnā, išṭurnā — ka-mā šaṭarka ʿaynak… rū.",
     "Раздели нас, раздели нас, как Ты разделил Себя.", "Divide us, divide us, as You divided Yourself."),
    ("Priestess", "Reverent", "Tawill an-ṣuġat, tawill — wa-yaʿqub an-ṣaḥr… rū.",
     "Дитя поёт, поёт — и пустыня отвечает.", "The child sings, sings — and the desert answers."),
    ("Priestess", "Reverent", "Ḥašn… rū.", "Тишина… тише.", "Silence… hush."),
])
S("DLG_B5_010", "", [
    ("Ilva", "Whisper", "Iḥduqū adwāsahā. Maš karrat sarb ḥad.",
     "Смотрите на её ноги. Ни один шаг не повторился.", "Watch her feet. Not one step has repeated."),
    ("Rayn", "Whisper", "Kufa maš takhfut an-ḍabṭ?",
     "Как она не сбивается с такта?", "How does she never lose the beat?"),
    ("Kair", "Reverent", "Maš tamm šāl takhfut. Ḍabṭ — maš bāt ladayhā.",
     "Сбиваться не с чего. Такта у неё никогда не было.", "There's nothing to lose. She never had a beat."),
])
S("DLG_B5_020", "", [
    ("Ossana", "Neutral", "Rāʿim. An-Kīniyyīn. Tālū b-an-ʿuqūf — wa-maš fašalū.",
     "Досточтимый. Кинские. Пришли по крючьям — и не побежали.", "Honored one. The Keen folk. They came by the hooks — and didn't run."),
    ("Harmat", "Reverent", "Mun Kīn, fa. Mun dī dašanū Il bi-nuṭf. …Ḥasb. Bayyin dī zudka, yā musarrib.",
     "Из Кина, значит. От тех, кто сменял Бога на воду. …Ну. Показывай, что принёс, проводник.", "From Keen, then. From those who traded God for water. …Well. Show me what you've brought, guide."),
    ("Kair", "Neutral", "Luqt an-ḥanābin, yā Rāʿim. Yabġū ʿušr an-nuṭf, wa-wasm ʿalā kull ḥalq. Ānu ʿatalku an-khaṭṭ. Maš ġad aqrāh.",
     "Слово жрецов, досточтимый. Они хотят водяную десятину и печать на каждом кольце. Я принёс письмо. Читать его я не стану.", "The priests' word, honored one. They want the water tithe, and a seal on every ring. I've brought the letter. I won't read it aloud."),
    ("Harmat", "Neutral", "Ḥaṭṭuh fūq an-ṣalt. Aqrāh bād an-ṭaʿām. Ḥašn an-nuṭf maš yabdaʾ bi-baṭn khāw.",
     "Положи на камень. Прочту после еды. Разговор о воде не начинают на пустой желудок.", "Put it on the stone. I'll read it after the meal. Talk of water isn't begun on an empty belly."),
    ("Rayn", "Afraid", "Ṭaʿām? Hun yaḥṭamū sāb dī yuḥkam?",
     "Еда? У вас принято есть с теми, кого собираются судить?", "A meal? Here you dine with the person you're about to judge?"),
    ("Harmat", "Wry", "Hākā an-ḥākim maš yaḥfiz, wa-an-nazīl maš jāʾiʿ. Irbaḍ, yā daššān. An-tamr ḥilw.",
     "Так судья не торопится, а гость не голоден. Садись, купец. Финики сегодня сладкие.", "That way the judge isn't hasty and the guest isn't hungry. Sit, merchant. The dates are sweet today."),
    ("Ossana", "Wry", "An-Nāʾib maš yahzul. An-hazl nuṭf, wa-hū maš yaṭraḥ nuṭf.",
     "Наиб не шутит. Шутка — это вода, а он водой не разбрасывается.", "The naib doesn't joke. A joke is water, and he doesn't waste water."),
])
# после зала: жизнь продолжается
S("DLG_PH_001", "Beat:SB_B5_08_Ossana", [
    ("Rayn", "Wry", "Ānu maš jāʾiʿ. Ānu qušʿ.",
     "Я не голоден. Я в ужасе.", "I'm not hungry. I'm terrified."),
    ("Kair", "Wry", "Fu-an-ṣaḥr hād ʿayn ḥad. Iḥṭam ġīr.",
     "В пустыне это одно и то же. Ешь.", "In the desert that's the same thing. Eat."),
    ("Ilva", "Calm", "Ṣaqalnā hun jamm qubay an-ṭaʿām. Ṣuġat tawill — wa-an-ṣaḥr yaʿqub.",
     "Мы узнали здесь много до еды. Девочка пела — и пустыня ответила.", "We learned a great deal here before the meal. A girl sang — and the desert answered."),
    ("Kair", "Neutral", "Wa-ġad nalqut li-Kīn šāl? Ānu ʿalaš maš.",
     "И что мы скажем Кину? Я пока не знаю.", "And what will we tell Keen? I don't know yet."),
])

# =====================================================================================================================
# C1. Тайный сад
# =====================================================================================================================
S("DLG_C1_001", "", [
    ("Ilva", "Calm", "Ḥayy yašubb hun, bayn an-ṣulūt. Maš tamm ḥayy ʿurr nuṭf.",
     "Живое растёт здесь между камней. А без воды живого не бывает.", "Something alive grows here between the stones. And nothing lives without water."),
    ("Rayn", "Wry", "Nuṭf… yaṭišš. Wakīd nuṭf? Ḍāhir? ʿurr qubw?!",
     "Вода… плещется. Настоящая? Открытая? Без крышки?!", "Water… splashing. Real water? In the open? Without a lid?!"),
])
S("DLG_C1_003", "", [
    ("Kair", "Wry", "Ṭuyūr. Ḥayy. Ḥā taḍbuṭ, yā Rayn. Wa-ḥā taḥṣur an-nuṭf bi-jahr.",
     "Птицы. Живые. Не топай, Рэйн. И не считай воду вслух.", "Birds. Living ones. Don't stomp, Rayn. And don't count the water aloud."),
    ("Ilva", "Calm", "Hād tabr ayḍ — ġīr ʿurr ṣalt fūqah.",
     "Это тоже укрытие. Только без камня над головой.", "This is a refuge too — only with no rock above it."),
])
S("DLG_C1_010", "", [
    ("Kair", "Wry", "Kay ʿalaška šāl yalqut an-ḥanābin li-hād?",
     "Знаете, как бы жрецы назвали этот сад?", "Do you know what the priests would call this garden?"),
    ("Ilva", "Calm", "Ḍalāl.",
     "Ересью.", "Heresy."),
    ("Kair", "Wry", "Maš. Isrāf an-nuṭf. Hād ʿakir ajamm.",
     "Нет. Расточением воды. Для них это хуже.", "No. Wasting water. To them that's worse."),
])
S("DLG_C1_020", "", [
    ("Rayn", "Neutral", "Kay ṭāq aḥṭam tamra? Ḥadat.",
     "Можно мне финик? Один.", "May I have a date? Just one."),
    ("Kair", "Neutral", "Maš. Hādī maš tamrak. Hādī ʿašāʾ ḥad.",
     "Нет. Это не твой финик. Это чей-то ужин.", "No. That's not your date. That's someone's supper."),
    ("Rayn", "Wry", "Ānu ġad aḥluṣ!",
     "Я заплачу!", "I'll pay!"),
    ("Kair", "Amused", "Li-hād maš. Hun maš kull šāl yuštarā.",
     "Именно поэтому — нет. Здесь не всё покупается.", "That's exactly why not. Not everything here can be bought."),
])
# Сад: слова местных
S("DLG_C1_G01", "", [
    ("Elder", "Calm", "Ḥā tanzil fūq an-naʿnaʿ, yā ṣuġ. Hād an-ḥawš li-qahw an-ʿurs.",
     "Не наступай на мяту, сорванец. Эта грядка — для свадебного кофе.", "Don't tread on the mint, little one. This bed is for the wedding coffee."),
    ("Child", "Neutral", "Wa-lišāl an-naʿnaʿ yašubb, wa-Kīn yalqut: an-ṣaḥr yašubb tirb ġīr?",
     "А почему мята растёт, если Кин говорит, что в пустыне растёт только песок?", "Then why does the mint grow, if Keen says only sand grows in the desert?"),
    ("Elder", "Wry", "Kīn yalqut dī yaḥluṣ. Lin an-ṣaḥr akhḍar — li-mūn yaḥluṣ an-nuṭf li-an-ḥanābin?",
     "Кин говорит то, что выгодно. Будь пустыня зелёной — зачем платить жрецам за воду?", "Keen says whatever pays. If the desert were green — why pay the priests for water?"),
    ("Child", "Neutral", "Wa-an-Ḥūl maš yatūl hun?",
     "А червь сюда не придёт?", "And the worm won't come here?"),
    ("Elder", "Warm", "Lin yatūl — yanqaš an-naʿnaʿ li-mūn. Zūd an-nuṭf.",
     "Если придёт — запомнит, чья тут мята. Иди, неси воду.", "If he comes — he'll note whose mint it is. Go on, fetch the water."),
])
