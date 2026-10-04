#!/usr/bin/env python3
"""
Отчёт по словарю: какие слова реплик (стандартная форма из script_s1.py) не встречаются в docs/lore/language.md.

    python3 Tools/tts/lexicon_check.py            # список неизвестных слов с примерами
    python3 Tools/tts/lexicon_check.py --strict   # код 1, если есть слова, не найденные даже после снятия аффиксов

Слово считается известным, если его форма (или форма без приставок/окончаний: ya- ta- na- a- i-, -ū -ku -ka -at -nā -kum -hum -hā -uh -ak -ī -īn -āt)
встречается в тексте language.md как отдельное слово. Это страховка от «слов из воздуха», а не грамматический анализатор.
"""
from __future__ import annotations

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
LET = "A-Za-zĀĪŪŌāīūōṬḌṢŠḤĠṭḍṣšḥġʿʾ"


def doc_words():
    txt = open(os.path.join(ROOT, "docs", "lore", "language.md"), encoding="utf-8").read()
    return {w.lower() for w in re.findall(rf"[{LET}]+", txt)}


PRE = ["ya", "ta", "na", "a", "i", "yu", "tu", "nu", "u", "mu", "ma", "bā", "mā"]
SUF = ["ū", "ku", "ka", "at", "nā", "kum", "hum", "hā", "uh", "ak", "ī", "īn", "āt", "ānī", "ah", "tū", "ta", "ti", "nu", "kun", "ayh", "iyy", "ān", "u", "a", "i"]


def known(w, D):
    if w in D:
        return True
    cands = {w}
    for p in PRE:
        if w.startswith(p) and len(w) > len(p) + 1:
            cands.add(w[len(p):])
    new = set(cands)
    for c in cands:
        for s in SUF:
            if c.endswith(s) and len(c) > len(s) + 1:
                new.add(c[: -len(s)])
    for c in new:
        if c in D:
            return True
        # с краевой гласной корня: напр. yaṣnut -> ṣnut -> ṣanat (грубо: сверяем согласный каркас)
    skel = lambda x: re.sub(r"[aiuāīūō]", "", x)
    sk = {skel(c) for c in new if len(skel(c)) >= 2}
    return any(skel(d) in sk for d in D if len(skel(d)) >= 2 and abs(len(d) - len(w)) <= 4)


def main(argv=None):
    import script_s1
    D = doc_words()
    unknown = {}
    for first, cond, lines in script_s1.SCENES:
        for spk, emo, nat, ru, en in lines:
            if nat.strip().lower() == "[galach]":
                continue
            for w in re.findall(rf"[{LET}]+", nat):
                wl = w.lower()
                if not known(wl, D):
                    unknown.setdefault(wl, []).append(first)
    for w in sorted(unknown):
        print(f"{w:16s} ← {', '.join(sorted(set(unknown[w]))[:3])}")
    print(f"\nнеизвестных слов: {len(unknown)}")
    return 1 if (unknown and "--strict" in (argv or sys.argv[1:])) else 0


if __name__ == "__main__":
    sys.exit(main())
