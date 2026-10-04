#!/usr/bin/env python3
"""
native2ipa.py — латиница хашшаны (Line_Native) → фонемы IPA для Piper в обход espeak-ng (Ред. 3).

Зачем. Раньше арабицу с огласовками отдавали espeak-ng, а тот на выдуманных словах ставил побочные ударения на последнем слоге,
терял долготу, разваливал «ṭ/ḍ» и читал «bā-Rayn» как «ba:r-ayn». Piper получал рваную просодию → «робот». Теперь фонемы строим сами:
  * ударение по правилам левантийского (тяжёлый предпоследний слог → он; иначе третий с конца; односложное — ударное);
  * артикль an- ассимилируется перед «солнечными» (an-tirb → at-tirb), клитики wa-/bi-/li-/fu-/ka-/fa-/bā-/mā- сливаются со словом;
  * безударные открытые слоги редуцируются (короткие гласные в ряду, как в разговорной речи), фраза делится на синтагмы по знакам препинания;
  * для голосов, обученных не на арабском (урду/хинди/фарси), глоточные ħ ʕ и эмфатика ˤ заменяются ближайшими звуками этих языков.
Выход: список синтагм [{'ph': [символы], 'end': ',' | '.' | '?' | '!' | '…' | '—'}] — их синтезирует piper_build.py по отдельности (паузы, дыхание).

    python3 Tools/tts/native2ipa.py "Yā Kayr, kay ʿalaška hum?" ar
"""
from __future__ import annotations

import re
import sys

LET = "A-Za-zĀĪŪŌāīūōṬḌṢŠḤĠṭḍṣšḥġʿʾ"
SUN = {"t", "d", "ṭ", "ḍ", "r", "z", "s", "š", "ṣ", "l", "n"}
CLITICS = {"wa", "bi", "li", "fu", "ka", "fa", "bā", "mā"}
VOWELS = "aiueoāīūō"

# Профили голосов: как писать звуки, которых нет в обучающем языке модели.
#   arabic — kareem (родной арабский, глоточные есть); persian/urdu/hindi — заменяем.
PROFILES = {
    "arabic":  dict(ph={}, vow={}, emph=True, pharyn=True),
    "persian": dict(ph={"ħ": "h", "ʕ": "ʔ", "ɣ": "ɣ", "q": "ɢ", "ʒ": "ʒ", "tˤ": "t", "dˤ": "d", "sˤ": "s"}, vow={"a": "æ", "aː": "ɒː"}, emph=False, pharyn=False),
    "urdu":    dict(ph={"ħ": "h", "ʕ": "ʔ", "q": "q", "tˤ": "t̪", "dˤ": "d̪", "sˤ": "s"}, vow={"a": "ə", "aː": "aː", "i": "ɪ", "u": "ʊ"}, emph=False, pharyn=False),
    "hindi":   dict(ph={"ħ": "h", "ʕ": "ʔ", "q": "k", "ɣ": "ɡ", "x": "kʰ", "tˤ": "t̪", "dˤ": "d̪", "sˤ": "s", "ʒ": "dʒ"}, vow={"a": "ə", "i": "ɪ", "u": "ʊ"}, emph=False, pharyn=False),
    "turkish": dict(ph={"ħ": "h", "ʕ": "ʔ", "q": "k", "tˤ": "t", "dˤ": "d", "sˤ": "s", "ɣ": "ɣ"}, vow={"a": "ɑ", "aː": "ɑː", "i": "ɯ", "iː": "iː"}, emph=False, pharyn=False),
}


def _split(word: str):
    """слово (нижний регистр) → [('C','b'|'tˤ'..., dbl) | ('V','a'|'aː'...)]"""
    out = []
    i, n = 0, len(word)
    while i < n:
        ch = word[i]
        if ch in VOWELS:
            out.append(("V", ch)); i += 1; continue
        if ch == "k" and i + 1 < n and word[i + 1] == "h":
            c = "kh"; i += 2
        elif ch == "ġ" or ch == "ʿ" or ch == "ʾ" or ch.isalpha():
            c = ch; i += 1
        else:
            i += 1; continue
        dbl = False
        if i < n and word[i:i + len(c)] == c:
            dbl = True; i += len(c)
        out.append(("C", c, dbl))
    return out


CMAP = {"b": "b", "t": "t", "d": "d", "ṭ": "tˤ", "ḍ": "dˤ", "k": "k", "q": "q", "f": "f", "s": "s", "z": "z", "ṣ": "sˤ", "š": "ʃ", "ġ": "ɣ", "ḥ": "ħ",
        "ʿ": "ʕ", "h": "h", "m": "m", "n": "n", "l": "l", "r": "r", "w": "w", "y": "j", "j": "ʒ", "ʾ": "ʔ", "kh": "x", "g": "ɡ", "p": "p", "v": "v", "c": "k"}
VMAP = {"a": ("a", 1), "i": ("i", 1), "u": ("u", 1), "e": ("e", 1), "o": ("o", 1), "ā": ("aː", 2), "ī": ("iː", 2), "ū": ("uː", 2), "ō": ("oː", 2)}


def _syllables(toks):
    """Разбор в слоги: список {'on': [...], 'v': (sym, w), 'co': [...]} + признаки тяжести."""
    sy = []
    i, n = 0, len(toks)
    onset = []
    while i < n:
        t = toks[i]
        if t[0] == "C":
            # удвоение: первая половина — кода предыдущего слога, вторая — онсет
            if t[2]:
                if sy:
                    sy[-1]["co"].append(CMAP.get(t[1], t[1]))
                onset.append(CMAP.get(t[1], t[1]))
            else:
                onset.append(CMAP.get(t[1], t[1]))
            i += 1
            continue
        v, w = VMAP[t[1]]
        # дифтонг ay / aw
        coda = []
        sy.append({"on": onset, "v": v, "w": w, "co": coda})
        onset = []
        # согласные после гласной: если до следующей гласной ≥2 согласных — первая в коду; в конце слова — всё в коду
        j = i + 1
        cons = []
        while j < n and toks[j][0] == "C":
            cons.append(toks[j]); j += 1
        if j >= n:      # конец слова
            for c in cons:
                coda.append(CMAP.get(c[1], c[1]))
                if c[2]:
                    coda.append(CMAP.get(c[1], c[1]))
            i = n
            break
        # середина
        flat = []
        for c in cons:
            flat.append(c)
        if len(flat) >= 2:
            first = flat[0]
            coda.append(CMAP.get(first[1], first[1]))
            rest = flat[1:]
            onset = [CMAP.get(c[1], c[1]) for c in rest]
            # дубли внутри кластера
            if first[2]:
                pass
            for c in rest:
                if c[2]:
                    onset.append(CMAP.get(c[1], c[1]))
        else:
            onset = [CMAP.get(c[1], c[1]) for c in flat]
            if flat and flat[0][2]:   # геминат: coda + onset
                coda.append(CMAP.get(flat[0][1], flat[0][1]))
        i = j
    if onset and sy:
        sy[-1]["co"].extend(onset)
    return sy


def _stress(sy):
    n = len(sy)
    if n <= 1:
        return 0
    def heavy(s): return s["w"] == 2 or len(s["co"]) >= 1
    def superheavy(s): return (s["w"] == 2 and len(s["co"]) >= 1) or len(s["co"]) >= 2
    if superheavy(sy[-1]):
        return n - 1
    if heavy(sy[-2]) or n == 2:
        return n - 2
    return max(0, n - 3)


def word_ipa(word: str, prof: dict, final_reduce: bool = False) -> list[str]:
    toks = _split(word)
    # дифтонги: aj / aw перед согласной или в конце → один слог с глайдом
    sy = _syllables(toks)
    if not sy:
        return [CMAP.get(t[1], t[1]) for t in toks if t[0] == "C"]
    st = _stress(sy)
    out: list[str] = []
    for k, s in enumerate(sy):
        out += s["on"]
        if k == st and len(sy) > 1 or (len(sy) == 1):
            out.append("ˈ")
        v = s["v"]
        # редукция: безударный краткий «a» в открытом слоге — короче/центральнее
        if s["w"] == 1 and k != st and v == "a" and not s["co"] and k != len(sy) - 1:
            v = "ɐ"
        out.append(v)
        out += s["co"]
    # профиль голоса
    ph, vow = prof["ph"], prof["vow"]
    res = []
    for k, sym in enumerate(out):
        if sym in ph:
            sym = ph[sym]
        elif sym in vow:
            sym = vow[sym]
        res.append(sym)
    if not prof["emph"]:
        # без эмфатики: гласные рядом с ṭ ḍ ṣ q → заднего ряда (хоть намёк)
        pass
    return res


def _flatten(ph):
    out = []
    for s in ph:
        for ch in (list(s) if len(s) > 1 and s not in ("tˤ", "dˤ", "sˤ", "t̪", "d̪") else [s]):
            out.append(ch)
    return out


def _morphs(raw: str):
    parts = [p.lower() for p in raw.split("-") if p]
    words, pend = [], ""
    i = 0
    while i < len(parts):
        p = parts[i]
        nxt = parts[i + 1] if i + 1 < len(parts) else None
        if p == "an" and nxt:
            # артикль: ассимиляция
            f = "kh" if nxt[:2] == "kh" else nxt[0]
            if f in SUN:
                pend += "a"
                parts[i + 1] = nxt[0] + nxt          # at-tirb: первый согласный слова удваивается
            else:
                pend += "an"
            i += 1
            continue
        if p in CLITICS and nxt is not None:
            pend += p; i += 1; continue
        if p in ("b", "l", "f", "w", "k", "m") and nxt == "an":
            pend += p; i += 1; continue
        words.append(pend + p); pend = ""; i += 1
    if pend:
        words.append(pend)
    return words


def parse(native: str, profile: str = "arabic"):
    """→ синтагмы [{'ph': [...], 'end': '...'}]"""
    prof = PROFILES[profile]
    s = (native or "").strip()
    toks = re.findall(rf"[{LET}\-]+|[.,?!;:…—–]+", s)
    phrases = []
    cur: list[str] = []
    for t in toks:
        if re.match(rf"[{LET}]", t):
            for w in _morphs(t):
                if cur:
                    cur.append(" ")
                cur += word_ipa(w, prof)
        else:
            end = "…" if "…" in t else "—" if re.search("[—–]", t) else ("?" if "?" in t else "!" if "!" in t else "." if "." in t else ",")
            if cur:
                phrases.append({"ph": cur, "end": end})
            elif phrases:
                # знак после знака (напр. «?!»): усиливаем предыдущую
                phrases[-1]["end"] = end if end in ("?", "!") else phrases[-1]["end"]
            cur = []
    if cur:
        phrases.append({"ph": cur, "end": "."})
    return phrases


def to_phoneme_string(ph):
    return "".join(ph)


if __name__ == "__main__":
    prof = sys.argv[2] if len(sys.argv) > 2 else "arabic"
    txt = sys.argv[1] if len(sys.argv) > 1 else "Bā-Rayn, tūm taḍbuṭū. An-tirb yaṣnut an-ḍabṭ!"
    for p in parse(txt, prof):
        print(to_phoneme_string(p["ph"]), p["end"])
