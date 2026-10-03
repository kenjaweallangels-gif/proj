#!/usr/bin/env python3
"""
Латиница хашшаны (Line_Native) → огласованная арабица (Line_NativeScript) по правилам docs/lore/language.md §3.

Единый источник правды — латиница: арабицу не пишут руками, её строит этот модуль
(Tools/tts/gen_dialogue.py при генерации CSV, Tools/validate_data.py — для сверки).

    from native2ar import to_script
    to_script("Bā-Rayn… adwāsukum.")  ->  'بَارَيْنْ… أَدْوَاسُكُمْ.'

Правила (Ред. 2: любой согласный в конце слова получает сукун — так паузальную форму читают и браузерный TTS, и Piper):
  согласный + a/i/u -> буква + фатха/касра/дамма;  ā/ī/ū -> ـَا / ـِي / ـُو;  ay / aw -> ـَيْ / ـَوْ;
  удвоение -> шадда (в конце слова — буква дважды с сукунами: так espeak не теряет долготу);
  начало слова: a -> أَ, i -> إِ, u -> أُ, ā -> آ, ī -> إِي, ū -> أُو;  ʾ внутри: أ / ئ (перед i) / ؤ (перед u);
  an- (артикль) и сочетания b-an / l-an / f-an / w-an / k-an — отдельные слова;
  клитики wa- bi- li- fu- ka- fa- и почтительные bā- mā- пишутся слитно со следующим словом;
  прочие дефисные части (Šay-Ḥulūd, Abū-Jabr) — отдельные слова.
"""
from __future__ import annotations

import re

CONS = {
    "b": "ب", "t": "ت", "d": "د", "ṭ": "ط", "ḍ": "ض", "k": "ك", "q": "ق", "f": "ف", "s": "س", "z": "ز",
    "ṣ": "ص", "š": "ش", "ġ": "غ", "ḥ": "ح", "ʿ": "ع", "h": "ه", "m": "م", "n": "ن", "l": "ل", "r": "ر",
    "w": "و", "y": "ي", "j": "ج", "ʾ": "ء",
}
# диграф kh -> خ обрабатывается отдельно
FATHA, KASRA, DAMMA, SUKUN, SHADDA = "َ", "ِ", "ُ", "ْ", "ّ"
SHORT = {"a": FATHA, "i": KASRA, "u": DAMMA, "o": DAMMA, "e": KASRA}
PUNCT = {",": "،", "?": "؟", ";": "؛"}
CLITICS = {"wa", "bi", "li", "fu", "ka", "fa", "bā", "mā"}
ART_COMB = {"b": "بِنْ", "l": "لِنْ", "f": "فِنْ", "w": "وَنْ", "k": "كَنْ", "an": "أَنْ"}
VOWELS = "aiueoāīūō"


def _tokens(word: str):
    """Разбирает слово (латиница в нижнем регистре, без пунктуации) в список ('C', буква, удвоена) / ('V', гласная)."""
    out = []
    i = 0
    n = len(word)
    while i < n:
        ch = word[i]
        if ch == "k" and i + 1 < n and word[i + 1] == "h":
            c = "kh"; i += 2
        elif ch in CONS:
            c = ch; i += 1
        elif ch in VOWELS:
            out.append(("V", ch)); i += 1
            continue
        else:
            raise ValueError(f"неизвестный символ '{ch}' в слове '{word}'")
        dbl = False
        if i < n and word[i:i + len(c)] == c and not (c == "kh" and False):
            dbl = True; i += len(c)
        out.append(("C", c, dbl))
    return out


def _letter(c: str) -> str:
    return "خ" if c == "kh" else CONS[c]


def _word(word: str) -> str:
    """Одно слово без дефисов и пунктуации."""
    toks = _tokens(word)
    # начальная ʾ + гласная = просто гласная с носителем (иначе получится «ءِ»)
    if len(toks) > 1 and toks[0][0] == "C" and toks[0][1] == "ʾ" and not toks[0][2] and toks[1][0] == "V":
        toks = toks[1:]
    res = []
    i = 0
    n = len(toks)
    # начальная гласная — носитель
    if toks and toks[0][0] == "V":
        v = toks[0][1]
        seat = {"a": "أَ", "i": "إِ", "u": "أُ", "o": "أُ", "e": "إِ", "ā": "آ", "ī": "إِي", "ū": "أُو", "ō": "أُو"}[v]
        res.append(seat); i = 1
    while i < n:
        t = toks[i]
        if t[0] == "V":  # гласная после гласной (хиатус): носитель-хамза
            v = t[1]
            res.append("ء" + (SHORT.get(v, "")) + ("ا" if v == "ā" else "ي" if v == "ī" else "و" if v in "ūō" else ""))
            i += 1
            continue
        _, c, dbl = t
        letter = _letter(c)
        nxt = toks[i + 1] if i + 1 < n else None
        nxt2 = toks[i + 2] if i + 2 < n else None
        # гамза в середине: сиденье по следующей гласной
        if c == "ʾ" and i > 0:
            if nxt and nxt[0] == "V":
                letter = {"i": "ئ", "ī": "ئ", "u": "ؤ", "ū": "ؤ", "ō": "ؤ"}.get(nxt[1], "أ")
            else:
                letter = "ء"
        mark = SHADDA if dbl else ""
        if nxt and nxt[0] == "V":
            v = nxt[1]
            # дифтонги ay / aw
            if v == "a" and nxt2 and nxt2[0] == "C" and nxt2[1] in ("y", "w") and not nxt2[2] and (i + 3 >= n or toks[i + 3][0] == "C"):
                res.append(letter + mark + FATHA + _letter(nxt2[1]) + SUKUN)
                i += 3
                continue
            if v in SHORT:
                res.append(letter + mark + SHORT[v]); i += 2; continue
            if v == "ā":
                res.append(letter + mark + FATHA + "ا"); i += 2; continue
            if v == "ī":
                res.append(letter + mark + KASRA + "ي"); i += 2; continue
            if v in ("ū", "ō"):
                res.append(letter + mark + DAMMA + "و"); i += 2; continue
        # согласный без гласной: конец слова или кластер
        if dbl:
            if i == n - 1:      # финальное удвоение: «CْCْ»
                res.append(letter + SUKUN + letter + SUKUN)
            else:               # внутри слова: шадда перед следующим согласным
                res.append(letter + SHADDA + SUKUN if False else letter + SUKUN + letter + SUKUN)
        else:
            res.append(letter + SUKUN)
        i += 1
    return "".join(res)


def _split_morphs(raw: str):
    """«wa-fu-Kīn» -> ['wa','fu','kīn']; «b-an-falq» -> ['b','an','falq']."""
    return [m for m in raw.split("-") if m]


def _hyphenated(raw: str) -> str:
    parts = [p.lower() for p in _split_morphs(raw)]
    out: list[str] = []
    i = 0
    pending = ""  # слитные клитики перед словом
    while i < len(parts):
        p = parts[i]
        nxt = parts[i + 1] if i + 1 < len(parts) else None
        if p in ART_COMB and nxt == "an" and p != "an":
            out.append(ART_COMB[p]); i += 2; continue
        if p == "an":
            if pending:  # «li-an-X», «wa-fu-an-X»: клитика + артикль = отдельное слово (b-an → بِنْ)
                last = pending[-1]
                if last == FATHA or last == KASRA or last == DAMMA:
                    base = pending[:-1]
                    vow = FATHA if last == FATHA else KASRA
                else:
                    base, vow = pending, KASRA
                out.append(base + vow + "نْ"); pending = ""
            else:
                out.append(ART_COMB["an"])
            i += 1; continue
        if p in ART_COMB and p != "an" and nxt is not None and p in ("b", "l", "f", "w", "k"):
            # одинокая b-/l-… перед не-артиклем: слитно
            pending += _word(p)[:-1]  # без сукуна: будет огласовано следующим слогом
            i += 1; continue
        if p in CLITICS and nxt is not None:
            # слитно с последующим словом
            pending += _word(p)
            i += 1; continue
        out.append(pending + _word(p)); pending = ""; i += 1
    if pending:
        out.append(pending)
    return " ".join(out)


def to_script(native: str) -> str:
    """Строка хашшаны (латиница) → арабица с огласовками. '[Galach]' и пустая строка → ''."""
    s = (native or "").strip()
    if not s or re.fullmatch(r"\[galach\]", s, re.I):
        return ""
    out = []
    # токены: слова (латиница/дефис/апострофы) и всё остальное
    for m in re.finditer(r"[A-Za-zĀĪŪŌāīūōṬḌṢŠḤĠṭḍṣšḥġʿʾ\-]+|[^\sA-Za-zĀĪŪŌāīūōṬḌṢŠḤĠṭḍṣšḥġʿʾ\-]+|\s+", s):
        t = m.group(0)
        if t.isspace():
            out.append(" ")
        elif re.match(r"[A-Za-zĀĪŪŌāīūōṬḌṢŠḤĠṭḍṣšḥġʿʾ]", t):
            out.append(_hyphenated(t))
        else:  # пунктуация
            out.append("".join(PUNCT.get(ch, ch) for ch in t))
    txt = "".join(out)
    txt = re.sub(r" +", " ", txt)
    txt = re.sub(r" ([،؟؛!.…—])", r"\1", txt) if False else txt
    return txt.strip()


def words(native: str) -> list[str]:
    """Список слов-морфем (нижний регистр, без пунктуации) — для проверки по словарю."""
    s = re.sub(r"[^A-Za-zĀĪŪŌāīūōṬḌṢŠḤĠṭḍṣšḥġʿʾ\-\s]", " ", native or "")
    res = []
    for w in s.split():
        res.append(w.lower())
    return res


if __name__ == "__main__":
    import sys
    tests = ["Bā-Rayn… adwāsukum.", "An-tirb yaṣnut.", "Kullmā hun — duḥ adwāsak.", "Wa-fu-Kīn, b-an-falq?", "Šay-Ḥulūd šān; naḥ ḥašīn.",
             "Ṭull fūqak!", "Nāʾib", "Yā ṭull, jamm!", "Ḥā tafšul."]
    for t in (sys.argv[1:] or tests):
        print(t, "→", to_script(t))
