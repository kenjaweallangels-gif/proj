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
    ("Ilva", "Calm", "Bā-Rayn, tūm taḍbuṭū ʿūd. An-tirb yaṣnut hād.",
     "Мастер Рэйн, вы опять шагаете в такт. Песок это слышит.", "Master Rayn, you're stepping in rhythm again. The sand hears it."),
    ("Rayn", "Wry", "Ānu yasrub ġīr. Kufa ġayr yasrub?",
     "Я просто иду! А как ещё ходят?", "I'm just walking! How else do people walk?"),
    ("Kair", "Calm", "Ka-ʿajūz dī khafat masrabuh. Madd, qiṭ, iṭmun. Iḥdaq.",
     "Как старик, который забыл, куда шёл. Длинный, короткий, замер. Смотри.", "Like an old man who forgot where he was going. Long, short, freeze. Watch."),
    ("Rayn", "Wry", "ʿAšān ḥawl ṣaqalku asrub sawī — wa-dulā ka-ʿajūz?",
     "Двадцать лет учился ходить прямо — а теперь как старик?", "Twenty years learning to walk straight — and now like an old man?"),
    ("Kair", "Wry", "Hun ġīr dī yasrub ka-ʿajūz yaʿīš madd.",
     "Здесь до старости доживает только тот, кто ходит как старик.", "Out here, only those who walk like old men live to be old."),
])

S("DLG_A1_020", "ZoneEnter:A1_Ridge", [
    ("Rayn", "Wry", "Yā Kayr, fu-Kīn yaʿhadū: an-ṣaḥr khāw — maš ḍumm, maš nuṭf.",
     "Кайр, в Кине клянутся, что пустыня пуста. Ни людей, ни воды.", "Kair, in Keen they swear the desert is empty. No people, no water."),
    ("Kair", "Calm", "Kīn yaʿhad li-an-ʿušr. Ḍumm hun tamm — bayd maš yabayyinū muḥayyahum.",
     "Кин клянётся ради десятины. Люди тут есть — просто лиц не показывают.", "Keen swears for the sake of the tithe. There are people here — they just don't show their faces."),
])

S("DLG_A1_010", "", [
    ("Ilva", "Wry", "Yā Kayr, Bā-Rayn yaḥluṣ li-an-masrab, bayd maš našad tayn yatūl hād an-masrab.",
     "Кайр, мастер Рэйн платит за дорогу, а куда она ведёт, так и не спросил.", "Kair, Master Rayn pays for the road but never asked where it leads."),
    ("Rayn", "Wry", "Našadku! Fu-Kīn. Laqatū: ʿad tabr, ʿad ḍumm an-ḍalāl.",
     "Спросил! Ещё в Кине. Сказали: в сиетч, к еретикам.", "I did! Back in Keen. They said: to a sietch, to the heretics."),
    ("Kair", "Neutral", "Maš ḍalāl — nahḍiyyīn. Yaḥnabū li-Šay-Ḥulūd ʿurr ḥanābin. Wa-an-ḥanābin maš yaḥillū hād.",
     "Не еретики — возрожденцы. Молятся Шай-Хулуду без жрецов. А жрецы такого не прощают.", "Not heretics — revivalists. They pray to Shai-Hulud without priests. And priests don't forgive that."),
    ("Rayn", "Neutral", "Wa-li-hād Kīn yašḥan ʿadhum… tū?",
     "И поэтому Кин посылает к ним… вас?", "And so Keen sends them… you?"),
    ("Kair", "Wry", "Ānu, wa-khaṭṭ ʿalā an-ʿušr. Wa-lin an-Nāʾib maš yanfil — bād ānu ġad yašḥanū jund.",
     "Меня. С письмом о десятине. А если наиб не даст — после меня пришлют солдат.", "Me. With a letter about the tithe. And if the naib won't pay, they send soldiers after me."),
    ("Ilva", "Calm", "Wa-tūm, yā Kayr? Sāb mūn tūm?",
     "А вы сами, Кайр? На чьей вы стороне?", "And you, Kair? Whose side are you on?"),
    ("Kair", "Wry", "Sāb qullī. Dulā hū maliy.",
     "На стороне своей фляги. Пока она полная.", "My flask's side. As long as it's full."),
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
    ("Kair", "Wry", "Qaddi an-tirb yanfil. Nuṣf ḍaww — lin maš tanšad kull mīt sarb.",
     "Сколько песок даст. Полдня — если не будешь спрашивать каждые сто шагов.", "As long as the sand allows. Half a day — if you don't ask every hundred steps."),
])

# религия: спит ли Бог в каждом черве
S("DLG_A2_B01", "ZoneEnter:A2_Erg", [
    ("Rayn", "Neutral", "Yā Kayr, kay wakīd: Il yašān fu-kull ḥūl? Aw fu-an-aḍkham ġīr?",
     "Кайр, а правда, что Бог спит в каждом черве? Или только в больших?", "Kair, is it true God sleeps in every worm? Or only the big ones?"),
    ("Kair", "Wry", "Inšad ḥanbān. Ġad yalqut: fu-kull ḥūl. Wa-fu-an-aḍkham — bi-sawm ġayr.",
     "Спроси жреца. Скажет: в каждом. А в больших — за отдельную плату.", "Ask a priest. He'll say: in every one. The big ones cost extra."),
    ("Ilva", "Calm", "Tūm taḍḥakū ʿalā an-ḥanābin. Bayd ṣanatku ʿad bakr — ḥanabkun li-an-masrab.",
     "Вы смеётесь над жрецами. А утром я слышала, как вы просили у Него дороги.", "You laugh at the priests. Yet this morning I heard you ask Him for the road."),
    ("Kair", "Neutral", "Li-an-Ḥūl aḥnab. Li-an-ḥanābin aḥluṣ. Ḥā taqlibū, yā ḥalīt.",
     "Червю я молюсь. Жрецам — плачу. Не путайте, сестра.", "To the worm I pray. To the priests I pay. Don't mix them up, sister."),
    ("Rayn", "Wry", "Wa-ānu aḥluṣ li-kull. ʿAsā li-hād maš ḥad yaʿqubnī.",
     "А я плачу всем сразу. Может, поэтому мне никто не отвечает.", "And I pay everyone at once. Maybe that's why nobody answers me."),
    ("Ilva", "Amused", "Yaʿqubūkum, Bā-Rayn. Bayd an-ḥiṣr yatūl bād.",
     "Вам отвечают, мастер Рэйн. Просто счёт приходит позже.", "You do get answers, Master Rayn. The bill just comes later."),
])

# политика: десятина водой
S("DLG_A2_B20", "ZoneEnter:A3_Approach", [
    ("Rayn", "Neutral", "Yā Kayr, hād an-ʿušr — qaddi ʿalā ʾahl ḥad?",
     "Кайр, а эта десятина — сколько выходит с одной семьи?", "Kair, this tithe — how much is it per family?"),
    ("Kair", "Neutral", "Kull nuṭfat ʿaš. Mun an-ḥulūq, mun an-qull, mun nuṭf an-khufūt.",
     "Каждая десятая капля. С колец, с кувшинов, даже с воды покойников.", "Every tenth drop. From rings, from jars, even from the water of the dead."),
    ("Rayn", "Afraid", "Mun an-khufūt ayḍ? Wa-mūn yaḥṣur hād?",
     "С покойников тоже? И кто же это считает?", "From the dead too? And who counts that?"),
    ("Kair", "Wry", "Ḥanbān sāb qays. An-khāfit maš yaʿqub.",
     "Жрец с меркой. Покойник обычно не спорит.", "A priest with a measure. The dead rarely argue."),
    ("Ilva", "Calm", "Li-hād an-nahḍiyyīn ġabarū duḥ an-ṣalt. Yaqsimū — bayd maš sāb Kīn.",
     "Поэтому возрожденцы и ушли под камень. Делятся — но не с Кином.", "That's why the revivalists went under the rock. They share — just not with Keen."),
])

# семья и шутки: «свадьба или мешок»
S("DLG_A2_B30", "ZoneEnter:A2_Erg", [
    ("Rayn", "Neutral", "Yā Kayr, kay ladak ʾahl? Zawjat, ṣiġāġ? Aw tū zawaj an-ṣaḥr?",
     "Кайр, у вас есть семья? Жена, дети? Или вы женаты на пустыне?", "Kair, do you have a family? A wife, children? Or are you married to the desert?"),
    ("Kair", "Calm", "Ladī umm fu-Kīn, tadšin ġazl. Kull-mā ġabarku, talqut: ġad takurr bi-ʿurs aw fu-kīs.",
     "Мать в Кине, торгует нитками. Провожает всегда одинаково: вернись со свадьбой — или в мешке.", "My mother, in Keen — she sells thread. She always sees me off the same way: come back with a wedding, or in a sack."),
    ("Ilva", "Amused", "Wa-ayy tabġī, yā Kayr?",
     "И что вы выбираете, Кайр?", "And which do you choose, Kair?"),
    ("Kair", "Wry", "An-kīs aqrab. An-ʿurs yabġī nuṭf li-kull tabr, wa-an-kīs — li-ḥad.",
     "Мешок ближе. Свадьбе нужна вода на весь сиетч, а мешку — на одного.", "The sack is closer. A wedding needs water for a whole sietch; a sack, for one."),
    ("Rayn", "Amused", "Wa-ānu abġī an-ʿurs. Hnāy ayḍ yanfilū ṭaʿām.",
     "А я бы выбрал свадьбу. Там хотя бы кормят.", "I'd pick the wedding. At least they feed you there."),
    ("Kair", "Wry", "Yanfilū. Wa-bād yaḥṣurū qaddi maṣaṣka. An-ʿurs fu-tabr — ḥiṣr sāb wallat.",
     "Кормят. А потом считают, сколько ты выпил. Свадьба в сиетче — это ревизия с песнями.", "They feed you. Then they count how much you drank. A sietch wedding is an audit with singing."),
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
    ("Rayn", "Neutral", "Yā Kayr, kay wakīd: fu-an-tabr yamṣuṣū nuṭf an-khufūt? Khufūthum?",
     "Кайр, а правда, что в сиетчах воду мёртвых… пьют? Своих же покойников?", "Kair, is it true that in the sietches they… drink the water of the dead? Their own dead?"),
    ("Kair", "Calm", "Maš khufūt. Jadd. Nuṭfuh funā — hākā yalqutū. Wa-yalqutū bi-ḥašn.",
     "Не покойников. Деда. «Его вода в нас» — так говорят. И говорят тихо.", "Not 'the dead'. Grandfather. 'His water is in us' — that's how they say it. And they say it quietly."),
    ("Ilva", "Wry", "Bā-Rayn yanšad ka-ḥāṣir.",
     "Мастер Рэйн спрашивает, будто составляет опись.", "Master Rayn asks questions like a man drawing up an inventory."),
    ("Rayn", "Wry", "Daʾb daššān: dī maš ḥaṣarku — maš bāt.",
     "Привычка купца: чего не пересчитал — того и не было.", "A merchant's habit: if I didn't count it, it never existed."),
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
    ("Ossana", "Wry", "Ṣanatku! — Ḥadaqku, yā qāṣidat. Wa-tū taḥdaq ʿūd; an-Nāʾib ġad yaʿlaš. Irdifū an-ʿuqūf — maš ġad nanqubkum tinā-kurr.",
     "Слышу! — Смотрела, паломница. А ты смотришь в ответ; наиб узнает. Идите по крючьям — второй раз искать не станем.", "I hear you! — I did look, pilgrim. And you look back; the naib will hear of it. Follow the hooks — we won't search for you twice."),
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
    ("Ilva", "Calm", "Ḥawḍ, Bā-Rayn? Ayy ḥawḍ?", "Чан, мастер Рэйн? Какой чан?", "Vat, Master Rayn? What vat?"),
    ("Rayn", "Afraid", "Li-an-nuṭf. Ḥawḍ an-nuṭf. Luqt sawm.", "Для воды. Чаны для воды. Торговое словечко.", "For water. Water vats. Trade talk."),
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
     "Она спустилась по нему, как по лестнице. По живой лестнице.", "She came down it like a staircase. A living staircase."),
    ("Kair", "Wry", "An-darj maš yaṭraḥak.",
     "Лестница не пытается тебя сбросить.", "A staircase doesn't try to throw you off."),
    ("Rayn", "Wry", "Wa-ḥadaqatak amadd mun an-Ḥūl, yā ḥalīt.",
     "А на вас, сестра, она смотрела дольше, чем на червя.", "And she looked at you longer than at the worm, sister."),
    ("Ilva", "Calm", "Ḥadaqat kullhum. Ġīr ḥallatnī anbah.",
     "Она смотрела на всех. Просто мне позволила это заметить.", "She looked at everyone. She just let me notice it."),
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
    ("Kair", "Whisper", "Fu-Kīn laqatū lī: an-ṣaḥr khāw — tamm Il ġīr.",
     "В Кине мне твердили: пустыня пуста, в ней только Бог.", "In Keen they kept telling me: the desert is empty, there's only God in it."),
    ("Ilva", "Wry", "Wa-Il, ʿasā, yaʿtil an-ḍumm fūq ḍahruh.",
     "А Бог, выходит, возит людей на спине.", "And God, it seems, carries people on His back."),
    ("Rayn", "Neutral", "Wa-yaṭmun ḥīn yuqāl. Bayn an-daššānīn hād ġad… Ḥasb. Maš šāl.",
     "И замирает, когда велят. Среди купцов за такое бы… Нет. Неважно.", "And holds still when told. Among merchants, that would… No. Never mind."),
])
# шутки про песок
S("DLG_A3_050", "ZoneEnter:A3_Approach", [
    ("Rayn", "Wry", "An-tirb fu-jildī, fu-aḥdāqī, wa-ʿasā fu-hāmī.",
     "Песок у меня в костюме, в глазах и, кажется, уже в голове.", "There's sand in my suit, in my eyes, and I think it's in my head by now."),
    ("Kair", "Amused", "Fu-hāmak — ṣāf. Hāmak ġad yasrub bi-hawn, wa-adwāsak ḥašīn.",
     "В голове — это хорошо. Голова пойдёт медленнее, а ноги — тише.", "In your head is good. Your head will slow down, and your feet will go quiet."),
    ("Ilva", "Wry", "Yā Kayr, tūm laqatkun inn hāmuh ʿakir.",
     "Кайр, вы только что назвали его тугодумом.", "Kair, you just called him slow-witted."),
    ("Kair", "Wry", "Laqatku: ḥayy. Fu-an-ṣaḥr hād ṣāf jamm.",
     "Я назвал его живым. В пустыне это комплимент.", "I called him alive. Out here that's a compliment."),
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
    ("Weaver", "Whisper", "Kay ṣanatkum? Šiyāna ġabarat ʿad an-ṣaḥr ʿūd — taḥšun sāb Šayṭān.",
     "Слыхали? Шиана опять ушла в пески — говорить с Шайтаном.", "Did you hear? Sheeana went out to the sands again — to talk with Shaitan."),
    ("Elder", "Whisper", "Taḥšun — maš muqšiʿ. Muqšiʿ inn hū yaṣnut.",
     "Что она говорит — полбеды. Беда, что Он слушает.", "Her talking is nothing. What's frightening is that He listens."),
    ("Carrier", "Wry", "Wa-ānu — ṣāf. Il yaṣnut ḥad. Wa-naḥ? Maš.",
     "А по мне — хорошо. Хоть кого-то Бог слушает. Нас-то — нет.", "I say it's good. God listens to somebody. Not to us, though."),
    ("Elder", "Whisper", "Ḥašš. Hnāy an-barriyyīn. Iḍḥak.",
     "Тсс. Вон чужие. Улыбайся.", "Shh. There, the strangers. Smile."),
])
# спор о десятине
S("DLG_B2_C10", "ZoneEnter:B2_Gallery", [
    ("Youth", "Angry", "Kīn rafaʿ an-ʿušr ʿūd! ʿŪd, yā Jadd!",
     "Кин опять поднял десятину! Опять, дед!", "Keen raised the tithe again! Again, grandfather!"),
    ("Elder", "Calm", "Ḥallūhum yalḥafū. Mun naḥ nuṭfat — wa-mun hum ḥiṣr. Il yaḥṣur ṣaḥḥ mun an-ḥanābin.",
     "Пусть берут. С нас капля — с них спрос. Бог считает вернее жрецов.", "Let them take it. A drop from us, a reckoning for them. God counts better than the priests."),
    ("Carrier", "Angry", "Nuṭfatak — qull ṣiġāġī, yā Jadd! Wa-Il maš yakurruh.",
     "Твоя «капля» — кувшин моих детей, дед! И Бог его не вернёт.", "Your 'drop' is my children's jar, grandfather! And God won't give it back."),
    ("Youth", "Whisper", "Ḥašš, tūm tinā. An-Kīniyyīn yaṣnutū.",
     "Тише вы оба. Кинские слушают.", "Quiet, both of you. The Keen folk are listening."),
])
# корабли, Досточтимые
S("DLG_B2_C20", "ZoneEnter:B2_Gallery", [
    ("Elder", "Whisper", "Fūq Kīn ṭayr ʿūd. Wa-ʿūd — nisā bi-sawād.",
     "Над Кином опять корабли. И опять — женщины в чёрном.", "Ships over Keen again. And again — women in black."),
    ("Weaver", "Whisper", "An-Sawādiyyāt? Šāl yabġū hun — ġīr Šiyāna?",
     "Чёрные сёстры? Что им тут нужно, кроме Шианы?", "The Black Sisters? What do they want here, besides Sheeana?"),
    ("Elder", "Whisper", "Iṣnut an-qāṣidīn. Dī yalqut ṣaḥḥ jamm — ṣaqal fu-an-dayr.",
     "А ты послушай паломников. Кто говорит слишком гладко — тот из обители.", "Listen to the pilgrims. Whoever speaks too smoothly was schooled in the convent."),
    ("Weaver", "Whisper", "Hād — ṣāf. Bayd an-ḥawḍiyyīn… yaḍḥakū ḥīn yaḥṣurū ʿaḍmak.",
     "Сёстры — ещё ладно. А люди из чанов улыбаются, пока считают твои кости.", "The sisters, fine. But the vat-people smile while they count your bones."),
    ("Elder", "Afraid", "Tamm ʿakir ajamm. Dī tālū mun… Maš. Duḥ an-ṣalt maš nalqut hum.",
     "Есть и похуже. Те, что пришли из… Нет. Под камнем о них не говорят.", "There are worse. The ones who came from… No. Under the stone we don't speak of them."),
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
    ("Ilva", "Calm", "Iḥdaqū an-ṣiġāġ. Yazrafū bi-mā ḥadaqnā ʿad bakr.",
     "Посмотрите на детей. Играют в то, что мы видели утром.", "Look at the children. They're playing at what we saw this morning."),
    ("Kair", "Wry", "Fu-Kīn an-ṣiġāġ yazrafū ḥanābin. Ḥad yaḥṣur, wa-kull yaḥluṣū.",
     "В Кине дети играют в жрецов. Один считает, остальные платят.", "In Keen, children play at priests. One counts, the rest pay."),
    ("Ilva", "Calm", "Wa-hun ḥad ḥūl — wa-kull yaṣnutū.",
     "А здесь один — червь, и все слушают.", "And here one is the worm, and everyone listens."),
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
    ("Ilva", "Calm", "Iḥṭamū, Bā-Rayn. An-Nāʾib yaḥdaq: mūn yaḥṭam — wa-mūn yaḥṣur.",
     "Ешьте, мастер Рэйн. Наиб смотрит, кто ест, а кто считает.", "Eat, Master Rayn. The naib is watching who eats and who counts."),
    ("Kair", "Neutral", "Wa-ġad nalqut li-Kīn šāl? Ānu ʿalaš maš.",
     "А что мы скажем Кину… я пока не знаю.", "And what we'll tell Keen… I don't know yet."),
])

# =====================================================================================================================
# C1. Тайный сад
# =====================================================================================================================
S("DLG_C1_001", "", [
    ("Ilva", "Calm", "Ḥayy yašubb hun, bayn an-ṣulūt — wa-maš nuṭfat ḥad.",
     "Здесь растёт живое, между камней. И ни одной капли воды.", "Something alive grows here, between the stones. And not one drop of water."),
    ("Rayn", "Wry", "Maš nuṭf, maš ḍumm, maš masrab ʿad an-ṣaḥr. Lišāl dassū hād?",
     "Ни воды, ни людей, ни дороги в пустыню. Зачем такое прятать?", "No water, no people, no way out to the desert. Why hide a place like this?"),
])
S("DLG_C1_003", "", [
    ("Kair", "Wry", "Būm fūq an-ḥarf, wa-ṣuqūr fūqah. Ḥā taḍbuṭ, yā Rayn — hun ḥattā an-firʾān yaṣnutū.",
     "Сова на уступе, ястребы над ней. Не топай, Рэйн, — тут даже мыши слушают.", "An owl on the ledge, hawks above it. Don't stomp, Rayn — even the mice listen here."),
    ("Ilva", "Calm", "Hād tabr ayḍ — ġīr ʿurr ṣalt fūqah.",
     "Это тоже укрытие. Только без камня над головой.", "This is a refuge too — only with no rock above it."),
])
S("DLG_C1_010", "", [
    ("Kair", "Wry", "Kay ʿalaška šāl ġad yalqut an-ḥanābin li-hād?",
     "Знаете, как жрецы назвали бы это место?", "Do you know what the priests would call this place?"),
    ("Ilva", "Calm", "Ḍalāl?",
     "Ересью?", "Heresy?"),
    ("Kair", "Wry", "ʿAkir ajamm. Ḥayy ʿurr nuṭf wa-ʿurr ʿušr. Fa an-ṣaḥr maš yabġī an-ḥanābin.",
     "Хуже. Живое без воды и без десятины. Значит, пустыне жрецы не нужны.", "Worse. Life without water and without a tithe. Meaning the desert doesn't need priests."),
])
S("DLG_C1_020", "", [
    ("Rayn", "Neutral", "Hād an-šajr yafūḥ jamm. Kay ṭāq adšinuh fu-Kīn?",
     "Этот куст так пахнет… Его можно продать в Кине?", "This bush smells so strong… Could I sell it in Keen?"),
    ("Kair", "Neutral", "Maš. Hād kurayz. Duḥ an-tirb hū aqdam mun Kīn.",
     "Нет. Это креозот. Его корень старше Кина.", "No. That's creosote. Its root is older than Keen."),
    ("Rayn", "Wry", "Fa ānu ġad aḥluṣ ajamm!",
     "Тогда заплачу больше!", "Then I'll pay more!"),
    ("Kair", "Amused", "Li-hād maš. Hun maš kull šāl yuštarā.",
     "Именно поэтому — нет. Здесь не всё покупается.", "That's exactly why not. Not everything here can be bought."),
])
# Сад: память о старых фрименах; место возрожденцев (людей в котловине нет — говорят спутники)
S("DLG_C1_G01", "", [
    ("Ilva", "Calm", "Iḥdaqū — ḥuzūz fu-an-jāl. Aqdam mun an-ʿuqūf fu-an-masrab.",
     "Смотрите — насечки на стене. Старше крючьев на тропе.", "Look — notches in the wall. Older than the hooks on the trail."),
    ("Kair", "Whisper", "Ajdād an-ṣaḥr. Ġarasū an-šajr hun — li-an-tirb maš yaḥṭam an-ṣalt.",
     "Старые фримены. Сажали здесь кусты, чтобы песок не съел скалу.", "The old Fremen. They planted bushes here so the sand wouldn't eat the rock."),
    ("Rayn", "Neutral", "Fu-Kīn yalqutū: hum ġabarū qadīm. Ġīr qiṣṣ wa-jild.",
     "В Кине говорят, их давно нет. Остались сказки да костюмы.", "In Keen they say they're long gone. Only tales and stillsuits left."),
    ("Ilva", "Calm", "Ġabarū. Bayd iḥdaqū: an-tirb ʿad an-šajr ṭarī. Ḥad yatūl hun.",
     "Их нет. Но посмотрите: у корней свежий песок. Сюда кто-то ходит.", "They're gone. But look: the sand at the roots is fresh. Someone comes here."),
    ("Kair", "Reverent", "An-nahḍiyyīn. Maš yaḥnabū hun bi-jahr. Hun yaṣnutū an-ajdād.",
     "Возрожденцы. Вслух здесь не молятся. Здесь слушают предков.", "The revivalists. They don't pray aloud here. Here they listen to the ancestors."),
])


# =====================================================================================================================
# Ред. 3: реплики, которые раньше были «зашиты» в код (worm/encounter.js) — теперь обычные строки с озвучкой.
# Играются через game.dialogue.say(id, pos) (одиночные, без цепочки и без условий).
# =====================================================================================================================
S("DLG_WRM_H01", "", [("Ilva", "Calm", "Kay taṣnutū? An-tirb yaṭbul duḥ adwāsukum.",
    "Слышите? Песок гудит под ногами.", "Do you hear it? The sand is humming.")])
S("DLG_WRM_H02", "", [("Rayn", "Afraid", "Hnāy, fūq an-ḥarf! An-ḥawl yatūl ʿadnā sawī!",
    "Там, на гребне! Вал идёт прямо на нас.", "There, on the crest! A swell, coming straight at us.")])
S("DLG_WRM_H03", "", [("Ilva", "Calm", "Sawī jamm li-an-ṭalīq. Ḥā tafšul.",
    "Слишком ровно для дикого. Не бегите.", "Too steady for a wild one. Do not run.")])
S("DLG_WRM_H04", "", [("Rayn", "Whisper", "Hū… yarbaḍ. Maš ṭāq ʿūd.",
    "Он… ложится. Он выдохся.", "He is... lying down. He is spent.")])
S("DLG_A2_CALL_01", "", [("Ossana", "Neutral", "Yā Rayn! Hun. Hū maš ġad yaṭmun kull zamn.",
    "Рэйн! Сюда. Он не будет ждать вечно.", "Rayn! Over here. He will not wait forever.")])
S("DLG_A2_CALL_02", "", [("Ossana", "Neutral", "Iqrab — an-luqt qiṭ.",
    "Подойдите ближе — разговор короткий.", "Come closer. This will be short.")])
