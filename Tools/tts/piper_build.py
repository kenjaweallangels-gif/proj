#!/usr/bin/env python3
"""
piper_build.py — офлайн-озвучка реплик среза нейросетью Piper на этапе сборки (Ред. 3).

    pip install piper-tts numpy                      # ffmpeg (libopus, rubberband) в PATH
    python3 Tools/tts/gen_dialogue.py && python3 Tools/tts/gen_barks_native.py   # CSV из script_s1.py / barks_native.py
    python3 Tools/tts/piper_build.py                 # → Web/src/assets/vo.js + Tools/tts/vo_durations.json
    python3 Tools/tts/piper_build.py --only DLG_A1_001,BRK_TRD_Idle_01 --keep-wav /tmp/vo_wav   # проверка на слух / замер

Движок голосов, просодии, пауз, дыхания и смеха — vo_engine.py (там же диагноз «роботизированной» Ред. 2 и каст голосов).
Озвучивается ТОЛЬКО Line_Native (хашшана): русский/английский текст не синтезируется никогда.
Что озвучивается: все строки Dialogue_S1.csv кроме Lore (надписи — только текст) и все строки лая из Barks_Native.csv (ключ = BarkID);
плюс небольшой запас безсловесных «бормотаний» по архетипам (BARKS) — запасной путь для реплик без записи.
Битрейт Opus по роли: главные персонажи — выше, толпа/лай — ниже (бюджет vo.js <= 3.4 МБ).
Идемпотентность: синтез Piper кэшируется в Tools/tts/.cache/ по (модель, фонемы, параметры).
Модели: Tools/tts/models/ (скачиваются с huggingface.co/rhasspy/piper-voices, ~63 МБ каждая, в репозиторий не кладём).
"""
from __future__ import annotations

import argparse
import base64
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from vo_engine import BARK_VOICE, Voices, encode_opus, read_wav, say, write_wav  # noqa: E402

DATA = os.path.join(ROOT, "Content", "Rakis", "Data")
OUT_JS = os.path.join(ROOT, "Web", "src", "assets", "vo.js")
DUR_JSON = os.path.join(HERE, "vo_durations.json")

MAIN = {"Kair", "Rayn", "Ilva", "Ossana", "Harmat", "Priestess", "Rider1", "Rider2", "Rider"}
KBPS_MAIN, KBPS_MINOR, KBPS_BARK = 56, 48, 40   # локальный запуск: бюджета 16 МБ нет, качество важнее (весь VO < ~40 МБ)
MURMUR_PER_ARCH = 3   # запасных бормотаний на архетип

BARKS_MURMUR = [
    ("Trader", "Trader", "Ṣāf, ṣāf — iḥdaq hād!"), ("Trader", "Trader", "Wa-nuṭfī, sawm ṣāf!"), ("Trader", "Trader", "Yā ṭull, sawm ʿālī jamm."),
    ("Trader", "Trader", "Ilḥaf, ilḥaf — nazr ġīr."), ("Trader", "Trader", "Sarq! Ṣāf… ṣāf."), ("Trader", "Trader", "Tūl, iḥdaq!"),
    ("Artisan", "Youth", "Ḥmm… ṣāf ġazl."), ("Artisan", "Youth", "Iḥdaq an-nisj — ḥusn."), ("Artisan", "Youth", "Ḥašš… ḥad sarb."),
    ("Artisan", "Youth", "Šalt ḥuzūz… tinā…"), ("Artisan", "Youth", "Ṣāf, ṣāf."), ("Artisan", "Youth", "Yā ṭull, an-ġazl khāw."),
    ("WaterCarrier", "Carrier", "Nuṭf! Nuṭf li-an-tabr!"), ("WaterCarrier", "Carrier", "Šalt anāmil — ṣāf."), ("WaterCarrier", "Carrier", "Ḥadr, ḥadr — qull maliy!"),
    ("WaterCarrier", "Carrier", "Ḥašš… ḥūf bi-hawn."), ("WaterCarrier", "Carrier", "Ṭull fūqak."), ("WaterCarrier", "Carrier", "Nuṭfuh funā."),
    ("Child", "Child", "Ḥayyā, ḥayyā!"), ("Child", "Girl", "Yā Ummī!"), ("Child", "Child", "Iḥdaq, iḥdaq!"),
    ("Child", "Girl", "Ḥā, ḥā, ḥā!"), ("Child", "Child", "Wa-nuṭfī!"), ("Child", "Girl", "Maš ṣāf!"),
    ("Guard", "Guard", "Iṭmunū."), ("Guard", "Guard", "Aqnāʿ."), ("Guard", "Guard", "Ḥašn."), ("Guard", "Guard", "Sarb, sarb — maš fašl."),
    ("Guard", "Guard", "Ṭull fūqkum."), ("Guard", "Guard", "ʿAd an-qāʿ."),
    ("Pilgrim", "Pilgrim", "Yā Šiyāna…"), ("Pilgrim", "Pilgrim", "Ṭull-Il ʿalayk."), ("Pilgrim", "Pilgrim", "Ḥašš… ḥašš."),
    ("Pilgrim", "Pilgrim", "Ṣāf… ṣāf."), ("Pilgrim", "Pilgrim", "Yā Il…"), ("Pilgrim", "Pilgrim", "Rū… rū."),
    ("Elder", "Elder", "Ḥmm… aqdam."), ("Elder", "Elder", "Yā ṭull…"), ("Elder", "Elder", "Ḥūf… ḥūf bi-hawn."),
    ("Elder", "Elder", "Ṣāf, yā ṣuġ."), ("Elder", "Elder", "Nuṭfuh funā."), ("Elder", "Elder", "Hay, hay…"),
    ("Weaver", "Weaver", "Ḥmm… ṣāf ġazl."), ("Weaver", "Weaver", "Iḥdaq an-nisj — ḥusn."), ("Weaver", "Weaver", "Ḥašš, ḥašš…"),
    ("Weaver", "Weaver", "Yā ṭull, hādī ṣāf."), ("Weaver", "Weaver", "Šalt… rabaʿ… khaṣ…"), ("Weaver", "Weaver", "Ṣāf, ṣāf."),
]


def data_uri(b: bytes) -> str:
    return "data:audio/ogg;codecs=opus;base64," + base64.b64encode(b).decode("ascii")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="ID через запятую (быстрый прогон; vo.js не перезаписывается без --write)")
    ap.add_argument("--no-barks", action="store_true")
    ap.add_argument("--kbps-main", type=int, default=KBPS_MAIN)
    ap.add_argument("--kbps-minor", type=int, default=KBPS_MINOR)
    ap.add_argument("--kbps-bark", type=int, default=KBPS_BARK)
    ap.add_argument("--keep-wav", help="каталог: сохранить финальные WAV для прослушивания и замеров")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--shard", help="K/N — обработать K-ю из N долей заданий (параллельный запуск); результат в .cache/parts/")
    ap.add_argument("--from-wav", help="каталог WAV (--keep-wav прошлых прогонов): перекодировать в Opus с текущими битрейтами и собрать vo.js, без синтеза")
    ap.add_argument("--merge", action="store_true", help="собрать vo.js из .cache/parts/part_*.json")
    ap.add_argument("--out", default=OUT_JS)
    a = ap.parse_args(argv)

    jobs = []   # (id, speaker, emotion, native, kbps)
    with open(os.path.join(DATA, "Dialogue_S1.csv"), encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            if r["Speaker"] == "Lore" or not r["Line_Native"].strip() or r["Line_Native"].strip().lower() == "[galach]":
                continue
            jobs.append((r["DialogueID"], r["Speaker"], r["Emotion"], r["Line_Native"], a.kbps_main if r["Speaker"] in MAIN else a.kbps_minor))
    if not a.no_barks:
        arch = {}
        with open(os.path.join(DATA, "Barks.csv"), encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                arch[r["BarkID"]] = (r["Archetype"], r["Context"])
        with open(os.path.join(DATA, "Barks_Native.csv"), encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                ar, ctx = arch[r["BarkID"]]
                emo = {"WormNear": "Tense", "Ritual": "Whisper", "Shiana": "Whisper", "Offworld": "Wry", "Kin": "Wry"}.get(ctx, "Neutral")
                jobs.append((r["BarkID"], BARK_VOICE.get(ar, "Crowd"), emo, r["Line_Native"], a.kbps_bark))
    only = set(a.only.split(",")) if a.only else None
    if only:
        jobs = [j for j in jobs if j[0] in only]
    # запасные безсловесные «бормотания» — те же задания (ключ BARK<k>), чтобы шардироваться вместе со всеми
    murmur_jobs = []
    if not a.no_barks and not only:
        per = {}
        for k, (archetype, voice, lat) in enumerate(BARKS_MURMUR):
            if per.get(archetype, 0) >= MURMUR_PER_ARCH:
                continue
            per[archetype] = per.get(archetype, 0) + 1
            murmur_jobs.append((f"BARK{k}", voice, "Calm", lat, a.kbps_bark, archetype))
    part_dir = os.path.join(HERE, ".cache", "parts")
    results = {}   # id → {"u": uri, "d": dur, "n": bytes, "arch": archetype|None}
    if a.from_wav:
        allj = [(j[0], j[1], j[2], j[3], j[4], None) for j in jobs] + murmur_jobs
        for did, spk, emo, nat, kb, arch in allj:
            fp = os.path.join(a.from_wav, did + ".wav")
            if not os.path.exists(fp):
                print("нет WAV:", did)
                continue
            pcm, sr = read_wav(fp)
            data, d = encode_opus(pcm, sr, kb)
            results[did] = {"u": data_uri(data), "d": round(d, 2), "n": len(data), "arch": arch}
    elif a.merge:
        for fn in sorted(os.listdir(part_dir)):
            if fn.endswith(".json"):
                results.update(json.load(open(os.path.join(part_dir, fn), encoding="utf-8")))
    else:
        allj = [(j[0], j[1], j[2], j[3], j[4], None) for j in jobs] + murmur_jobs
        if a.shard:
            k, n = (int(x) for x in a.shard.split("/"))
            allj = allj[k::n]
        voices = Voices()
        if a.keep_wav:
            os.makedirs(a.keep_wav, exist_ok=True)
        for i, (did, spk, emo, nat, kb, arch) in enumerate(allj, 1):
            pcm, sr = say(voices, spk, emo, nat, did)
            data, d = encode_opus(pcm, sr, kb)
            results[did] = {"u": data_uri(data), "d": round(d, 2), "n": len(data), "arch": arch}
            if a.keep_wav:
                write_wav(os.path.join(a.keep_wav, did + ".wav"), pcm, sr)
            if i % 10 == 0 or i == len(allj):
                print(f"  {i}/{len(allj)}  всего {sum(r['n'] for r in results.values()) / 1024:.0f} КБ", flush=True)
        if a.shard:
            os.makedirs(part_dir, exist_ok=True)
            k = a.shard.split("/")[0]
            json.dump(results, open(os.path.join(part_dir, f"part_{k}.json"), "w", encoding="utf-8"), ensure_ascii=False)
            print(f"шард {a.shard}: {len(results)} клипов — слейте: piper_build.py --merge")
            return 0
    vo, dur, sizes, barks = {}, {}, {}, {}
    for did, r in results.items():
        if r["arch"]:
            barks.setdefault(r["arch"], []).append({"u": r["u"], "d": r["d"]})
        else:
            vo[did] = r["u"]; dur[did] = r["d"]
        sizes[did] = r["n"]

    total = sum(sizes.values())
    if only and not a.write:
        print(f"проверка: {len(vo)} клипов, {total / 1024:.0f} КБ (vo.js не тронут)")
        return 0
    if not only:
        json.dump(dur, open(DUR_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=0, sort_keys=True)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write("// Сгенерировано Tools/tts/piper_build.py (Piper, голос на персонажа, Opus моно %d/%d/%d кбит/с) — не править вручную.\n" % (a.kbps_main, a.kbps_minor, a.kbps_bark))
        f.write("// VO: DialogueID/BarkID → data-URI (OGG/Opus, моно, сухая запись). VO_DUR: длительность, с. BARKS: архетип → [{u, d}] — запасное безсловесное бормотание.\n")
        f.write("export const VO = " + json.dumps(vo, ensure_ascii=False, separators=(",", ":")) + ";\n")
        f.write("export const VO_DUR = " + json.dumps(dur, separators=(",", ":")) + ";\n")
        f.write("export const BARKS = " + json.dumps(barks, ensure_ascii=False, separators=(",", ":")) + ";\n")
    sz = os.path.getsize(a.out)
    print(f"{a.out}: {len(vo)} реплик + {sum(len(v) for v in barks.values())} запасных, сырых Opus {total / 1024:.0f} КБ, vo.js {sz / 1024 / 1024:.2f} МБ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
