#!/usr/bin/env python3
"""
Генератор Content/Rakis/Data/Dialogue_S1.csv из авторского источника Tools/tts/script_s1.py (Ред. 2).

    python3 Tools/tts/gen_dialogue.py            # перезаписать CSV
    python3 Tools/tts/gen_dialogue.py --check    # только проверить, что CSV совпадает с источником (код 1, если нет)

* Line_Native: стандартная форма + диалектный выговор спикера (Kair: q -> ʾ; Rayn: акцент инопланетника);
* Line_NativeScript: native2ar.to_script(Line_Native);
* Duration: из Tools/tts/vo_durations.json (длина озвучки + 0.4 с), если файл есть, иначе оценка по длине строки;
* строки Speaker=Lore (надписи) переносятся из текущего CSV без изменений.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CSV_PATH = os.path.join(ROOT, "Content", "Rakis", "Data", "Dialogue_S1.csv")
DUR_PATH = os.path.join(HERE, "vo_durations.json")
sys.path.insert(0, HERE)
from native2ar import to_script  # noqa: E402

HEADER = ["DialogueID", "Speaker", "Line_RU", "Line_EN", "Condition", "Emotion", "VO_File", "Duration", "NextID", "Line_Native", "Line_NativeScript"]

RAYN_EXEMPT = {"sawm", "ḥalaṣ", "ḥalaṣku", "ḥawḍ", "yaḥluṣ", "aḥluṣ", "ḥalaṣū"}  # торговые слова Рэйн выговаривает лучше всего
RAYN_MAP = {"ṭ": "t", "ḍ": "d", "ṣ": "s", "q": "k", "ḥ": "h", "ʿ": "", "ʾ": "", "ġ": "k",
            "Ṭ": "T", "Ḍ": "D", "Ṣ": "S", "Q": "K", "Ḥ": "H", "Ġ": "K"}


def kin_register(s: str) -> str:
    """Кинский выговор: q -> ʾ (как в городской речи)."""
    return s.replace("q", "ʾ").replace("Q", "ʾ")


def rayn_accent(s: str) -> str:
    """Акцент инопланетника: эмфатические -> простые, q -> k, ḥ -> h, ʿ ʾ выпадают, kh ġ -> k."""
    def word(m):
        w = m.group(0)
        if w.lower().replace("-", "") in RAYN_EXEMPT:
            return w
        w = w.replace("kh", "k").replace("Kh", "K")
        return "".join(RAYN_MAP.get(c, c) for c in w)
    return re.sub(r"[A-Za-zĀĪŪāīūōṬḌṢŠḤĠṭḍṣšḥġʿʾ\-]+", word, s)


DIALECT = {"Kair": kin_register, "Rayn": rayn_accent}


def native_for(speaker: str, std: str) -> str:
    if std.strip().lower() == "[galach]":
        return "[Galach]"
    f = DIALECT.get(speaker)
    return f(std) if f else std


def bump(first_id: str, k: int) -> str:
    m = re.search(r"(\d+)$", first_id)
    if not m:
        raise ValueError(first_id)
    n = m.group(1)
    return first_id[: m.start()] + str(int(n) + k).zfill(len(n))


def estimate(ru: str) -> float:
    return round(min(7.0, max(2.0, 0.06 * len(ru) + 1.2)), 1)


def build_rows(script_scenes, durations, lore_rows):
    rows = []
    seen = set()
    for first, cond, lines in script_scenes:
        for k, (spk, emo, nat, ru, en) in enumerate(lines):
            did = bump(first, k) if len(lines) > 1 else first
            if did in seen:
                raise SystemExit(f"дубликат ID {did}")
            seen.add(did)
            nxt = bump(first, k + 1) if k + 1 < len(lines) else ""
            native = native_for(spk, nat)
            script = to_script(native)
            dur = durations.get(did)
            rows.append({
                "DialogueID": did, "Speaker": spk, "Line_RU": ru, "Line_EN": en, "Condition": cond if k == 0 else "",
                "Emotion": emo, "VO_File": f"/Game/Rakis/Audio/VO/{did}",
                "Duration": f"{dur:.1f}" if dur else f"{estimate(ru):.1f}", "NextID": nxt,
                "Line_Native": native, "Line_NativeScript": script,
            })
    for r in lore_rows:
        if r["DialogueID"] in seen:
            raise SystemExit(f"лор-ID {r['DialogueID']} совпал с репликой")
        rows.append(r)
    return rows


def write_csv(rows) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n", quoting=csv.QUOTE_MINIMAL)
    w.writerow(HEADER)
    for r in rows:
        w.writerow([r[h] for h in HEADER])
    return buf.getvalue()


def load_lore():
    if not os.path.exists(CSV_PATH):
        return []
    with open(CSV_PATH, encoding="utf-8", newline="") as f:
        return [r for r in csv.DictReader(f) if r["Speaker"] == "Lore"]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    import importlib
    script = importlib.import_module("script_s1")
    durations = json.load(open(DUR_PATH, encoding="utf-8")) if os.path.exists(DUR_PATH) else {}
    rows = build_rows(script.SCENES, durations, load_lore())
    out = write_csv(rows)
    if a.check:
        cur = open(CSV_PATH, encoding="utf-8", newline="").read() if os.path.exists(CSV_PATH) else ""
        ok = cur == out
        print("CSV совпадает с источником" if ok else "CSV отличается от источника — запустите gen_dialogue.py")
        return 0 if ok else 1
    with open(CSV_PATH, "w", encoding="utf-8", newline="") as f:
        f.write(out)
    n_voiced = sum(1 for r in rows if r["Speaker"] != "Lore" and r["Line_NativeScript"])
    print(f"Dialogue_S1.csv: {len(rows)} строк, озвучивается {n_voiced}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
