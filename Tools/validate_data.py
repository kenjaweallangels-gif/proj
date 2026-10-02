#!/usr/bin/env python3
"""
Валидатор данных Rakis (только stdlib). Запуск из корня проекта:

    python3 Tools/validate_data.py            # все CSV в Content/Rakis/Data
    python3 Tools/validate_data.py --strict   # предупреждения тоже считаются ошибками

Проверяет:
  * CSV валиден по RFC 4180, UTF-8 (без BOM), одинаковое число колонок в строках;
  * заголовок = строка-комментарий над USTRUCT в RakisDataTypes.h, колонки 2..N = UPROPERTY-поля;
  * уникальность ID (первая колонка = имя строки DataTable);
  * типы (float/int/bool), перечисления из RakisTypes.h;
  * Dialogue: Speaker/Emotion из словаря, NextID существует, VO_File = /Game/Rakis/Audio/VO/<ID>,
    словарь Condition, все LoreID из docs/lore/inscriptions.md;
  * Barks: архетипы/контексты, покрытие 8 архетипов;
  * CrowdArchetypes: Smart Object теги, аксессуары из docs/art/characters/modular_clothing.md;
  * AudioEvents: Music.<State> для каждого ERakisMusicState, Amb.<Zone> для каждой зоны, шины;
  * StoryBeats: словарь триггеров/действий, ссылки Beat:/PlayDialogue, пресеты погоды, ровно один Hint.
Код выхода: 0 — ок, 1 — есть ошибки.
"""
from __future__ import annotations

import argparse
import csv
import io
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA = os.path.join(ROOT, "Content", "Rakis", "Data")
H_DATA = os.path.join(ROOT, "Source", "Rakis", "Public", "Core", "RakisDataTypes.h")
H_TYPES = os.path.join(ROOT, "Source", "Rakis", "Public", "Core", "RakisTypes.h")
MODULAR_MD = os.path.join(ROOT, "docs", "art", "characters", "modular_clothing.md")
INSCR_MD = os.path.join(ROOT, "docs", "lore", "inscriptions.md")

SPEAKERS = {"Kair", "Ilva", "Rayn", "Ossana", "Rider1", "Rider2", "Guard", "Harmat", "Priestess", "Crowd", "Lore"}
EMOTIONS = {"Neutral", "Calm", "Tense", "Afraid", "Angry", "Whisper", "Reverent", "Wry"}
ARCHETYPES = {"Trader", "Artisan", "WaterCarrier", "Child", "Guard", "Pilgrim", "Elder", "Weaver"}
CONTEXTS = {"Idle", "Stranger", "Market", "Water", "Shiana", "Kin", "WormNear", "Ritual", "Offworld"}
SO_TAGS = {"Loom", "Stall", "WaterJar", "PrayerMat", "Bench", "Niche", "StillsuitRepair"}
AGE = {"Child", "Adult", "Elder"}
BUSES = {"Music", "Ambience", "SFX", "VO", "UI"}
WEATHER = {"Dawn_Ridge", "Morning_Erg", "Worm_Tension", "Worm_Reveal", "Noon_Approach", "Storm_Horizon",
           "Crevice_Shade", "Sietch_Interior", "Hall_Ritual"}
CINEMATICS = {"/Game/Rakis/Cinematics/LS_WormReveal", "/Game/Rakis/Cinematics/LS_HallFinale"}
ACTIONS = {"PlayDialogue", "PlayCinematic", "SetWeather", "SetMusic", "TitleCard", "ForceWorm", "CrowdRitual",
           "Hint", "FadeOut", "EndDemo", "Ellipsis"}
LORE_IDS = ["LORE_Carving_Fremen", "LORE_Quizarate_Sigil", "LORE_Revivalist_Mural", "LORE_Cistern_Grate",
            "LORE_Thumper_Rack", "LORE_Shiana_Shrine", "LORE_Water_Rings", "LORE_Maker_Hooks"]
# Словарь Condition диалогов: триггеры StoryBeats + реактивные условия компаньонов (docs/design/mechanics.md §6)
COND_PREFIX = {"WormState", "ZoneEnter", "Beat", "Interact", "NoiseAbove", "SandWalk", "Surface", "MoistureBelow"}
SANDWALK = {"Regular", "Irregular"}

CSV_TO_STRUCT = {
    "Dialogue_S1": "FRakisDialogueRow", "Barks": "FRakisBarkRow", "CrowdArchetypes": "FRakisCrowdArchetypeRow",
    "AudioEvents": "FRakisAudioEventRow", "StoryBeats": "FRakisStoryBeatRow", "WeatherPresets": "FRakisWeatherPresetRow",
}


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.info: list[str] = []

    def err(self, f: str, msg: str) -> None:
        self.errors.append(f"[ERR ] {f}: {msg}")

    def warn(self, f: str, msg: str) -> None:
        self.warnings.append(f"[WARN] {f}: {msg}")

    def ok(self, msg: str) -> None:
        self.info.append(f"[ OK ] {msg}")


# ---------------------------------------------------------------- разбор C++ заголовков
def parse_structs(path: str) -> dict[str, dict]:
    """{StructName: {"fields": [(type, name)], "header": [csv columns] | None}}"""
    src = open(path, encoding="utf-8").read()
    out: dict[str, dict] = {}
    for m in re.finditer(r"struct\s+(F\w+)\s*:\s*public\s+FTableRowBase\s*\{(.*?)\n\};", src, re.S):
        name, body = m.group(1), m.group(2)
        fields = re.findall(r"UPROPERTY\([^)]*\)\s*([\w<>:]+)\s+(\w+)\s*(?:=[^;]*)?;", body)
        before = src[:m.start()]
        hm = re.findall(r"/\*\*\s*\w+\.csv:\s*([\w,]+)", before[-600:])
        out[name] = {"fields": fields, "header": hm[-1].split(",") if hm else None}
    return out


def parse_enums(path: str) -> dict[str, list[str]]:
    src = open(path, encoding="utf-8").read()
    res = {}
    for m in re.finditer(r"enum\s+class\s+(\w+)\s*:\s*uint8\s*\{(.*?)\};", src, re.S):
        vals = re.findall(r"^\s*(\w+)\s*(?:UMETA|,|$)", m.group(2), re.M)
        res[m.group(1)] = [v for v in vals if v]
    return res


# ---------------------------------------------------------------- CSV
def read_csv(path: str, rep: Report):
    fn = os.path.basename(path)
    raw = open(path, "rb").read()
    if raw.startswith(b"\xef\xbb\xbf"):
        rep.warn(fn, "UTF-8 BOM (UE переварит, но держим файлы без BOM)")
        raw = raw[3:]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        rep.err(fn, f"не UTF-8: {e}")
        return None, None
    try:
        rows = list(csv.reader(io.StringIO(text, newline=""), strict=True))
    except csv.Error as e:
        rep.err(fn, f"CSV невалиден: {e}")
        return None, None
    rows = [r for r in rows if any(c.strip() for c in r)]
    if not rows:
        rep.err(fn, "пустой файл")
        return None, None
    header, body = rows[0], rows[1:]
    for i, r in enumerate(body, 2):
        if len(r) != len(header):
            rep.err(fn, f"строка {i}: {len(r)} колонок вместо {len(header)}")
    return header, [dict(zip(header, r)) for r in body if len(r) == len(header)]


def is_float(v: str) -> bool:
    try:
        float(v)
        return True
    except ValueError:
        return False


def check_types(fn: str, rows: list[dict], fields: list[tuple[str, str]], rep: Report) -> None:
    for t, name in fields:
        for r in rows:
            v = r.get(name, "")
            if t == "float" and not is_float(v):
                rep.err(fn, f"{r[next(iter(r))]}.{name}='{v}' — не float")
            elif t == "int32" and not re.fullmatch(r"-?\d+", v):
                rep.err(fn, f"{r[next(iter(r))]}.{name}='{v}' — не int")
            elif t == "bool" and v not in ("True", "False", "true", "false", "1", "0"):
                rep.err(fn, f"{r[next(iter(r))]}.{name}='{v}' — не bool")


# ---------------------------------------------------------------- проверки таблиц
def check_dialogue(fn, rows, rep, ctx):
    ids = {r["DialogueID"] for r in rows}
    ctx["dialogue_ids"] = ids
    for r in rows:
        i = r["DialogueID"]
        if r["Speaker"] not in SPEAKERS:
            rep.err(fn, f"{i}: Speaker '{r['Speaker']}' не из словаря")
        if r["Emotion"] not in EMOTIONS:
            rep.err(fn, f"{i}: Emotion '{r['Emotion']}' не из словаря")
        if r["NextID"] and r["NextID"] not in ids:
            rep.err(fn, f"{i}: NextID '{r['NextID']}' не существует")
        if r["NextID"] == i:
            rep.err(fn, f"{i}: NextID указывает сам на себя")
        if r["VO_File"] != f"/Game/Rakis/Audio/VO/{i}":
            rep.err(fn, f"{i}: VO_File должен быть /Game/Rakis/Audio/VO/{i}")
        if not r["Line_RU"].strip() or not r["Line_EN"].strip():
            rep.err(fn, f"{i}: пустая строка RU/EN")
        c = r["Condition"]
        if c:
            check_condition(fn, i, c, rep, ctx)
    # циклы в цепочках
    nxt = {r["DialogueID"]: r["NextID"] for r in rows}
    for start in nxt:
        seen, cur = set(), start
        while cur:
            if cur in seen:
                rep.err(fn, f"цикл NextID, начиная с {start}")
                break
            seen.add(cur)
            cur = nxt.get(cur, "")
    for lid in LORE_IDS:
        row = next((r for r in rows if r["DialogueID"] == lid), None)
        if row is None:
            rep.err(fn, f"нет строки лора {lid}")
        elif row["Speaker"] != "Lore":
            rep.err(fn, f"{lid}: Speaker должен быть Lore")
    lines = len(rows)
    rep.ok(f"{fn}: {lines} реплик ({sum(1 for r in rows if r['Speaker'] == 'Lore')} лор), "
           f"спикеров {len({r['Speaker'] for r in rows})}")
    if lines < 60:
        rep.err(fn, f"реплик {lines} < 60")
    if os.path.exists(INSCR_MD):
        md = open(INSCR_MD, encoding="utf-8").read()
        for lid in LORE_IDS:
            if lid not in md:
                rep.warn(fn, f"{lid} не описан в docs/lore/inscriptions.md")


def check_condition(fn, rid, c, rep, ctx):
    if ":" not in c:
        rep.err(fn, f"{rid}: Condition '{c}' без префикса")
        return
    k, v = c.split(":", 1)
    if k not in COND_PREFIX:
        rep.err(fn, f"{rid}: Condition-префикс '{k}' вне словаря")
    elif k == "WormState" and v not in ctx["enums"]["ERakisWormState"]:
        rep.err(fn, f"{rid}: WormState '{v}' нет в ERakisWormState")
    elif k == "ZoneEnter" and v not in ctx["zones"]:
        rep.err(fn, f"{rid}: зона '{v}' нет в ERakisZone")
    elif k == "Surface" and v not in ctx["enums"]["ERakisSurface"]:
        rep.err(fn, f"{rid}: Surface '{v}' нет в ERakisSurface")
    elif k in ("NoiseAbove", "MoistureBelow") and not (is_float(v) and 0 <= float(v) <= 1):
        rep.err(fn, f"{rid}: '{c}' — ожидается 0..1")
    elif k == "SandWalk" and v not in SANDWALK:
        rep.err(fn, f"{rid}: SandWalk '{v}' — ожидается Regular|Irregular")


def check_barks(fn, rows, rep, ctx):
    per = {}
    for r in rows:
        i = r["BarkID"]
        if r["Archetype"] not in ARCHETYPES:
            rep.err(fn, f"{i}: архетип '{r['Archetype']}'")
        if r["Context"] not in CONTEXTS:
            rep.err(fn, f"{i}: контекст '{r['Context']}'")
        if not r["VO_File"].startswith("/Game/Rakis/Audio/VO/"):
            rep.err(fn, f"{i}: VO_File вне /Game/Rakis/Audio/VO/")
        per.setdefault(r["Archetype"], set()).add(r["Context"])
    missing = ARCHETYPES - set(per)
    if missing:
        rep.err(fn, f"нет архетипов: {sorted(missing)}")
    for a, cs in per.items():
        if CONTEXTS - cs:
            rep.warn(fn, f"{a}: не покрыты контексты {sorted(CONTEXTS - cs)}")
    if len(rows) < 80:
        rep.err(fn, f"барков {len(rows)} < 80")
    rep.ok(f"{fn}: {len(rows)} барков, {len(per)} архетипов × {len(set().union(*per.values()))} контекстов")


def check_crowd(fn, rows, rep, ctx):
    modules = set()
    if os.path.exists(MODULAR_MD):
        modules = set(re.findall(r"`(Mod_\w+)`", open(MODULAR_MD, encoding="utf-8").read()))
    else:
        rep.warn(fn, "нет docs/art/characters/modular_clothing.md — аксессуары не проверены")
    names = {r["Archetype"] for r in rows}
    if names != ARCHETYPES:
        rep.err(fn, f"архетипы {sorted(names)} ≠ {sorted(ARCHETYPES)}")
    for r in rows:
        a = r["Archetype"]
        for t in filter(None, r["SmartObjectTags"].split(";")):
            if t not in SO_TAGS:
                rep.err(fn, f"{a}: SmartObject '{t}'")
        for c in filter(None, r["ClothPalette"].split(";")):
            if not re.fullmatch(r"#[0-9A-Fa-f]{6}", c):
                rep.err(fn, f"{a}: цвет '{c}'")
        for m in filter(None, r["Accessories"].split(";")):
            if modules and m not in modules:
                rep.err(fn, f"{a}: модуль '{m}' не описан в modular_clothing.md")
        if r["AgeGroup"] not in AGE:
            rep.err(fn, f"{a}: AgeGroup '{r['AgeGroup']}'")
        if r["BaseMesh"] and not r["BaseMesh"].startswith("/Game/"):
            rep.err(fn, f"{a}: BaseMesh '{r['BaseMesh']}'")
    rep.ok(f"{fn}: {len(rows)} архетипов")


def check_audio(fn, rows, rep, ctx):
    ids = {r["EventID"] for r in rows}
    for st in ctx["enums"]["ERakisMusicState"]:
        if f"Music.{st}" not in ids:
            rep.err(fn, f"нет Music.{st}")
    for z in ctx["zones"]:
        if f"Amb.{z}" not in ids:
            rep.err(fn, f"нет Amb.{z}")
    for s in ctx["enums"]["ERakisSurface"]:
        if f"Foot.{s}" not in ids:
            rep.warn(fn, f"нет Foot.{s}")
    for r in rows:
        i = r["EventID"]
        if r["Bus"] not in BUSES:
            rep.err(fn, f"{i}: Bus '{r['Bus']}'")
        if not r["Asset"].startswith("/Game/Rakis/Audio/"):
            rep.err(fn, f"{i}: Asset вне /Game/Rakis/Audio/")
        if r["Attenuation"] and not r["Attenuation"].startswith("/Game/Rakis/Audio/"):
            rep.err(fn, f"{i}: Attenuation вне /Game/Rakis/Audio/")
        if is_float(r["Volume"]) and not 0 <= float(r["Volume"]) <= 2:
            rep.err(fn, f"{i}: Volume вне 0..2")
    rep.ok(f"{fn}: {len(rows)} событий")


def check_beats(fn, rows, rep, ctx):
    ids = [r["BeatID"] for r in rows]
    idset = set(ids)
    orders = [int(r["Order"]) for r in rows if re.fullmatch(r"-?\d+", r["Order"])]
    if len(orders) != len(set(orders)):
        rep.err(fn, "Order не уникален")
    music = set(ctx["enums"]["ERakisMusicState"])
    dlg = ctx.get("dialogue_ids", set())
    hints = 0
    order_of = {r["BeatID"]: int(r["Order"]) for r in rows}
    for r in rows:
        i, t, a, p = r["BeatID"], r["Trigger"], r["Action"], r["Param"]
        # триггер
        if t != "Start":
            if ":" not in t:
                rep.err(fn, f"{i}: триггер '{t}'")
            else:
                k, v = t.split(":", 1)
                if k == "ZoneEnter":
                    if v not in ctx["zones"]:
                        rep.err(fn, f"{i}: зона '{v}'")
                elif k == "Beat":
                    if v not in idset:
                        rep.err(fn, f"{i}: Beat:{v} не существует")
                    elif v == i:
                        rep.err(fn, f"{i}: ссылается сам на себя")
                    elif order_of[v] >= order_of[i]:
                        rep.warn(fn, f"{i}: зависит от {v} с бо́льшим Order")
                elif k == "WormState":
                    if v not in ctx["enums"]["ERakisWormState"]:
                        rep.err(fn, f"{i}: WormState '{v}'")
                elif k == "Interact":
                    if not v:
                        rep.err(fn, f"{i}: Interact без тега")
                elif k == "NoiseAbove":
                    if not (is_float(v) and 0 <= float(v) <= 1):
                        rep.err(fn, f"{i}: NoiseAbove '{v}'")
                else:
                    rep.err(fn, f"{i}: префикс триггера '{k}' вне словаря")
        # действие
        if a not in ACTIONS:
            rep.err(fn, f"{i}: действие '{a}' вне словаря")
        elif a == "PlayDialogue" and dlg and p not in dlg:
            rep.err(fn, f"{i}: DialogueID '{p}' нет в Dialogue_S1")
        elif a == "PlayCinematic" and p not in CINEMATICS:
            rep.err(fn, f"{i}: кат-сцена '{p}'")
        elif a == "SetWeather":
            pid, _, blend = p.partition(",")
            if pid not in WEATHER:
                rep.err(fn, f"{i}: пресет '{pid}'")
            elif ctx.get("weather_ids") and pid not in ctx["weather_ids"]:
                rep.err(fn, f"{i}: пресета '{pid}' нет в WeatherPresets.csv")
            if blend and not is_float(blend):
                rep.err(fn, f"{i}: BlendSec '{blend}'")
        elif a == "SetMusic" and p not in music:
            rep.err(fn, f"{i}: музыка '{p}' нет в ERakisMusicState")
        elif a in ("TitleCard", "Hint") and p.count("|") != 1:
            rep.err(fn, f"{i}: {a} ожидает 'RU|EN'")
        elif a == "ForceWorm" and not p.startswith("Rakis.Worm."):
            rep.err(fn, f"{i}: ForceWorm ожидает тег Rakis.Worm.*")
        elif a == "FadeOut" and not is_float(p):
            rep.err(fn, f"{i}: FadeOut ожидает секунды")
        if a == "Hint":
            hints += 1
    if hints != 1:
        rep.err(fn, f"Hint должен быть ровно один (онбординг), найдено {hints}")
    for need in ("PlayCinematic", "CrowdRitual", "EndDemo", "ForceWorm"):
        if not any(r["Action"] == need for r in rows):
            rep.err(fn, f"нет действия {need}")
    used_presets = {r["Param"].partition(",")[0] for r in rows if r["Action"] == "SetWeather"}
    if WEATHER - used_presets:
        rep.warn(fn, f"не используются пресеты {sorted(WEATHER - used_presets)}")
    used_music = {r["Param"] for r in rows if r["Action"] == "SetMusic"}
    if music - used_music:
        rep.warn(fn, f"не используются музыкальные состояния {sorted(music - used_music)}")
    rep.ok(f"{fn}: {len(rows)} битов, {len(used_presets)} пресетов погоды, {len(used_music)} музыкальных состояний")


CHECKS = {"Dialogue_S1": check_dialogue, "Barks": check_barks, "CrowdArchetypes": check_crowd,
          "AudioEvents": check_audio, "StoryBeats": check_beats}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args(argv)
    rep = Report()
    structs = parse_structs(H_DATA)
    enums = parse_enums(H_TYPES)
    ctx = {"enums": enums, "zones": [z for z in enums["ERakisZone"] if z != "None"]}
    files = sorted(f for f in os.listdir(DATA) if f.lower().endswith(".csv")) if os.path.isdir(DATA) else []
    if not files:
        rep.err("Data", f"нет CSV в {DATA}")
    wp = os.path.join(DATA, "WeatherPresets.csv")
    if os.path.exists(wp):  # зона tech-artist: только сверка ID пресетов со StoryBeats
        with open(wp, encoding="utf-8", newline="") as f:
            ctx["weather_ids"] = {r[0] for r in list(csv.reader(f))[1:] if r}
    # Dialogue раньше StoryBeats (ссылки)
    files.sort(key=lambda f: (f != "Dialogue_S1.csv", f))
    for f in files:
        name = f[:-4]
        path = os.path.join(DATA, f)
        header, rows = read_csv(path, rep)
        if header is None:
            continue
        sname = CSV_TO_STRUCT.get(name)
        if not sname or sname not in structs:
            rep.warn(f, "нет соответствующего USTRUCT — пропуск схемы")
            continue
        st = structs[sname]
        fields = [n for _, n in st["fields"]]
        if st["header"] and header != st["header"]:
            rep.err(f, f"заголовок {header} ≠ контракт {st['header']}")
        if header[1:] != fields:
            if set(header[1:]) == set(fields):
                rep.warn(f, "порядок колонок отличается от порядка полей (UE сопоставляет по имени)")
            else:
                rep.err(f, f"колонки {header[1:]} ≠ поля {sname} {fields}")
        ids = [r[header[0]] for r in rows]
        dups = {i for i in ids if ids.count(i) > 1}
        if dups:
            rep.err(f, f"дубликаты ID: {sorted(dups)}")
        if any(not i or " " in i for i in ids):
            rep.err(f, "пустой ID или пробел в ID")
        check_types(f, rows, st["fields"], rep)
        if name in CHECKS:
            CHECKS[name](f, rows, rep, ctx)
        else:
            rep.ok(f"{f}: {len(rows)} строк (схема проверена)")
    for line in rep.info + rep.warnings + rep.errors:
        print(line)
    fail = bool(rep.errors) or (args.strict and bool(rep.warnings))
    print(f"\nИтог: {len(rep.errors)} ошибок, {len(rep.warnings)} предупреждений — {'FAIL' if fail else 'PASS'}")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
