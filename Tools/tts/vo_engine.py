#!/usr/bin/env python3
"""
vo_engine.py — движок озвучки (Ред. 3): голоса персонажей, фразовая просодия, паузы, дыхание, смех.

Почему переписано (диагноз «роботизированной» озвучки Ред. 2):
  1. Один мужской голос (ar_JO-kareem) на всех, женщины — тот же голос с pitch-shift +4…+6 полутонов → «бурундук», пропавшие форманты.
  2. Весь текст шёл в Piper одной строкой: темп один, пауз и вдохов нет, интонация — по единственному знаку в конце.
  3. espeak-ng ставил побочные ударения и терял долготу на выдуманных словах; Piper получал рваную последовательность фонем.
  4. Реверберация «запечена» в клип (одинаковая в пустыне и в сиетче), хор/вибрато/шёпот-FX добавляли артефакты.
  5. Реплики не реагировали друг на друга по темпу: зазор между репликами был константой 0.4 с.
Что сделано:
  * свой голос у каждого персонажа (разные модели Piper: женские — ur_PK-aegis_female и hi_IN-priyamvada, 130–230 Гц без pitch-shift);
  * реплика делится на синтагмы по знакам препинания; на каждую — свои length_scale / noise_scale / noise_w (эмоция, позиция в реплике), детерминированный разброс;
  * между синтагмами паузы по типу знака (запятая < точка < многоточие/тире), вдох перед длинной синтагмой после точки, смешок на шутках;
  * лёгкий сдвиг высоты ПО СИНТАГМАМ (±0.5…1.2 полутона, склонение к концу фразы, подъём на вопросе) — живая мелодика без «бурундука»;
  * клипы сухие: комнату (камень сиетча / сухая пустыня + ветер / мягкий сад) добавляет Web/src/audio/voice.js по game.space.
"""
from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys
import tempfile
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from native2ar import to_script  # noqa: E402

MODEL_DIR = os.environ.get("RAKIS_TTS_MODELS", os.path.join(HERE, "models"))
CACHE = os.path.join(HERE, ".cache")
HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
MODELS = {   # ключ → (путь в репозитории rhasspy/piper-voices, профиль произношения)
    "kareem": ("ar/ar_JO/kareem/medium/ar_JO-kareem-medium", "arabic"),
    "amir": ("fa/fa_IR/amir/medium/fa_IR-amir-medium", "persian"),
    "ganji": ("fa/fa_IR/ganji/medium/fa_IR-ganji-medium", "persian"),
    "reza": ("fa/fa_IR/reza_ibrahim/medium/fa_IR-reza_ibrahim-medium", "persian"),
    "aegis": ("ur/ur_PK/aegis_female/medium/ur_PK-aegis_female-medium", "urdu"),
    "priya": ("hi/hi_IN/priyamvada/medium/hi_IN-priyamvada-medium", "hindi"),
}
# Замена звуков, которых нет в обучающем языке модели (глоточные, эмфатика, увулярный q).
PROFILE_MAP = {
    "arabic": {},
    "persian": {"ħ": "h", "ʕ": "ʔ", "ˤ": "", "̪": "", "q": "ɢ"},
    "urdu": {"ħ": "h", "ʕ": "ʔ", "ˤ": "", "̪": ""},
    "hindi": {"ħ": "h", "ʕ": "ʔ", "ˤ": "", "̪": "", "q": "k", "x": "k", "ɣ": "ɡ"},
}

# ----------------------------------------------------------------------------------------------------------------------
# Каст: speaker → модель и характер голоса.
#   len — базовая длина фонемы (>1 медленнее), nz — noise_scale (живость тембра), nw — noise_w (вариативность длительностей),
#   st — сдвиг высоты в полутонах (малый! крупный сдвиг даёт «бурундук»), fm — сдвиг формант, gain — дБ,
#   eq — [(Гц, Q, дБ)], pause — множитель пауз, breath — вероятность вдоха перед длинной синтагмой, laugh — вероятность смешка на шутке.
# ----------------------------------------------------------------------------------------------------------------------
CAST = {
    "Kair":      dict(m="kareem", len=1.00, nz=0.62, nw=0.78, st=0.0,  fm=0.0,  gain=0.0, eq=[(120, 1.0, 1.5), (3200, 1.0, 1.0)], pause=1.0, breath=0.30, laugh=0.5),
    "Rayn":      dict(m="amir",   len=0.95, nz=0.70, nw=0.88, st=-1.4, fm=-0.4,  gain=0.0, eq=[(2800, 1.2, 1.0)],                    pause=0.85, breath=0.35, laugh=0.6),
    "Ilva":      dict(m="aegis",  len=1.05, nz=0.55, nw=0.70, st=0.0,  fm=0.0,  gain=0.0, eq=[(250, 1.0, -1.0), (3800, 1.0, 1.0)],  pause=1.1, breath=0.30, laugh=0.35),
    "Ossana":    dict(m="priya",  len=0.98, nz=0.60, nw=0.75, st=-0.8, fm=-0.3, gain=0.5, eq=[(2500, 1.0, 2.0)],                    pause=1.0, breath=0.25, laugh=0.3),
    "Harmat":    dict(m="reza",   len=1.28, nz=0.50, nw=0.60, st=-1.0, fm=-0.5, gain=0.0, eq=[(100, 1.0, 2.0), (4000, 0.8, -3.0)],   pause=1.5, breath=0.5,  laugh=0.0, lp=6800),
    "Guard":     dict(m="ganji",  len=1.00, nz=0.55, nw=0.60, st=-0.5, fm=-0.3, gain=0.0, eq=[(110, 1.0, 1.5), (3000, 1.0, 1.0)],   pause=1.0, breath=0.15, laugh=0.1),
    "Rider1":    dict(m="reza",   len=0.95, nz=0.58, nw=0.70, st=0.8,  fm=0.3,  gain=0.0, eq=[(2600, 1.0, 1.5)],                    pause=0.9, breath=0.15, laugh=0.0),
    "Rider2":    dict(m="ganji",  len=0.95, nz=0.58, nw=0.70, st=0.8,  fm=0.3,  gain=0.0, eq=[(2600, 1.0, 1.5)],                    pause=0.9, breath=0.15, laugh=0.0),
    "Rider":     dict(m="reza",   len=0.95, nz=0.58, nw=0.70, st=0.8,  fm=0.3,  gain=0.0, eq=[(2600, 1.0, 1.5)],                    pause=0.9, breath=0.15, laugh=0.0),
    "Priestess": dict(m="aegis",  len=1.55, nz=0.45, nw=0.50, st=0.5,  fm=0.0,  gain=-1.0, eq=[(1800, 1.0, 1.5)],                   pause=1.6, breath=0.6,  laugh=0.0, choir=True),
    "Trader":    dict(m="amir",   len=0.92, nz=0.68, nw=0.85, st=-0.8, fm=-0.3, gain=0.0, eq=[(2800, 1.0, 1.5)],                    pause=0.85, breath=0.2, laugh=0.5),
    "Carrier":   dict(m="aegis",  len=0.98, nz=0.58, nw=0.75, st=-1.0, fm=-0.4, gain=0.0, eq=[(300, 1.0, -1.0), (3500, 1.0, 1.5)],   pause=1.0, breath=0.2, laugh=0.3),
    "Weaver":    dict(m="aegis",  len=1.04, nz=0.58, nw=0.72, st=0.6,  fm=0.3,  gain=0.0, eq=[(300, 1.0, -1.0), (3500, 1.0, 1.0)],   pause=1.1, breath=0.3, laugh=0.3),
    "Mother":    dict(m="aegis",  len=1.02, nz=0.55, nw=0.70, st=-2.8, fm=-1.1, gain=0.0, eq=[(300, 1.0, -1.0), (3200, 1.0, 1.0)],   pause=1.1, breath=0.3, laugh=0.2),
    "Child":     dict(m="priya",  len=0.90, nz=0.70, nw=0.90, st=2.8,  fm=1.4,  gain=0.0, eq=[(200, 1.0, -2.0), (4200, 1.0, 1.5)],   pause=0.7, breath=0.1, laugh=0.6),
    "Girl":      dict(m="aegis",  len=0.92, nz=0.70, nw=0.90, st=2.4,  fm=1.2,  gain=0.0, eq=[(200, 1.0, -2.0), (4400, 1.0, 1.5)],   pause=0.7, breath=0.1, laugh=0.6),
    "Elder":     dict(m="reza",   len=1.18, nz=0.52, nw=0.62, st=0.0,  fm=-0.3, gain=0.0, eq=[(100, 1.0, 1.5), (3800, 0.8, -3.5)],   pause=1.4, breath=0.5, laugh=0.1, lp=6800),
    "Youth":     dict(m="kareem", len=0.96, nz=0.70, nw=0.85, st=1.4,  fm=0.6,  gain=0.0, eq=[(2800, 1.0, 1.5)],                    pause=0.8, breath=0.15, laugh=0.5),
    "Pilgrim":   dict(m="aegis",  len=1.08, nz=0.55, nw=0.70, st=-2.2, fm=-0.9, gain=0.0, eq=[(300, 1.0, -1.0), (3500, 1.0, 1.0)],   pause=1.2, breath=0.4, laugh=0.1),
    "Crowd":     dict(m="kareem", len=1.00, nz=0.68, nw=0.85, st=0.0,  fm=0.0,  gain=-1.0, eq=[], pause=0.9, breath=0.1, laugh=0.2),
}
# Архетипы лая (Barks.csv) → персонаж-голос
BARK_VOICE = {"Trader": "Trader", "Artisan": "Youth", "WaterCarrier": "Carrier", "Child": "Child", "Guard": "Guard", "Pilgrim": "Pilgrim", "Elder": "Elder", "Weaver": "Weaver"}

# Эмоция → (множитель длины, noise_scale·, noise_w·, сдвиг высоты, дБ, множитель пауз)
EMOTION = {
    "Neutral": (1.00, 1.00, 1.00, 0.0, 0.0, 1.0), "Calm": (1.06, 0.92, 0.92, -0.2, 0.0, 1.15), "Tense": (0.93, 1.00, 1.05, 0.5, 0.5, 0.8),
    "Afraid": (0.90, 1.12, 1.15, 1.0, 0.0, 0.7), "Angry": (0.90, 1.05, 1.10, 0.6, 1.2, 0.6), "Whisper": (1.10, 0.85, 0.85, -0.5, -4.0, 1.3),
    "Reverent": (1.20, 0.80, 0.80, -0.3, -1.0, 1.5), "Wry": (1.02, 1.05, 1.10, 0.2, 0.0, 1.0), "Amused": (0.96, 1.08, 1.12, 0.7, 0.0, 0.9),
    "Warm": (1.05, 0.95, 0.95, 0.0, 0.0, 1.1), "Joy": (0.90, 1.10, 1.15, 1.0, 0.5, 0.8), "Sad": (1.12, 0.85, 0.85, -0.6, -1.0, 1.4),
}
PAUSE_MS = {",": 190, ".": 380, "?": 400, "!": 330, "…": 560, "—": 300}


# ----------------------------------------------------------------------------------------------------------------------
def ensure_model(key: str) -> str:
    rel, _ = MODELS[key]
    os.makedirs(MODEL_DIR, exist_ok=True)
    base = os.path.join(MODEL_DIR, os.path.basename(rel))
    for ext in (".onnx", ".onnx.json"):
        if not os.path.exists(base + ext):
            import urllib.request
            print(f"скачиваю {HF + rel + ext}", flush=True)
            urllib.request.urlretrieve(HF + rel + ext, base + ext)
    return base + ".onnx"


AR_LET = "ء-غف-ي"
SUKUN, SHADDA = "ْ", "ّ"
HARAKAT = "ًٌٍَُِّْ"


def piper_text(script: str) -> str:
    """Арабица → вид, который espeak-ng читает без падежных окончаний и с сохранением долготы (паузальные формы)."""
    t = script.replace("…", "،").replace("—", "،").replace("–", "،").replace(";", "،").replace("؛", "،")
    t = re.sub(r"[\[\]]", "", t)
    t = re.sub(r"\s*،\s*(،\s*)+", "، ", t)
    out = []
    for w in t.split(" "):
        m = re.match(rf"^([{AR_LET}{HARAKAT}]+)(.*)$", w)
        if m:
            body, rest = m.group(1), m.group(2)
            if body and body[-1] == SHADDA:
                body = body[:-1] + SUKUN + body[-2] + SUKUN if len(body) >= 2 else body
            out.append(body + rest)
        else:
            out.append(w)
    t = " ".join(out)
    t = re.sub(r"\s+([،؟!.])", r"\1", t)
    return t.strip()


def split_phrases(native: str):
    """Line_Native → [(текст синтагмы, знак конца)]; знак: , . ? ! … —"""
    s = (native or "").strip()
    parts = re.findall(r"[^.,?!;:…—–]+|[.,?!;:…—–]+", s)
    out, cur = [], ""
    for p in parts:
        if re.match(r"[.,?!;:…—–]", p):
            end = "…" if "…" in p else "—" if re.search("[—–]", p) else "?" if "?" in p else "!" if "!" in p else "." if "." in p else ","
            if cur.strip():
                out.append((cur.strip(), end))
            elif out:
                out[-1] = (out[-1][0], end if end in "?!…" else out[-1][1])
            cur = ""
        else:
            cur += p
    if cur.strip():
        out.append((cur.strip(), "."))
    # слишком короткие хвосты (1 слово) приклеиваем к соседу, чтобы не дробить речь на «рубку»
    merged = []
    for t, e in out:
        if merged and len(t.split()) == 1 and len(merged[-1][0].split()) <= 3 and merged[-1][1] == ",":
            merged[-1] = (merged[-1][0] + " " + t, e)
        else:
            merged.append((t, e))
    return merged


class Voices:
    """Ленивая загрузка моделей Piper + кэш синтеза на диске."""

    def __init__(self):
        from piper import PiperVoice, SynthesisConfig
        self._PV, self._SC = PiperVoice, SynthesisConfig
        self.loaded = {}

    def get(self, key):
        if key not in self.loaded:
            self.loaded[key] = self._PV.load(ensure_model(key))
        return self.loaded[key]

    def phonemes(self, key: str, native_phrase: str) -> list[str]:
        """Фонемы синтагмы для модели key. Источник — espeak-ng (арабский) по огласованной арабице; для не-арабских голосов — замена звуков по профилю."""
        script = piper_text(to_script(native_phrase))
        sents = self.get("kareem").phonemize(script)
        flat = []
        for s in sents:
            flat += [p for p in s if p not in ("ˌ", ".")]
            flat.append(" ")
        while flat and flat[-1] == " ":
            flat.pop()
        mp = PROFILE_MAP[MODELS[key][1]]
        out = []
        for p in flat:
            q = mp.get(p, p)
            if q:
                out.append(q)
        return out

    def render(self, key: str, native_phrase: str, end: str, length: float, nz: float, nw: float) -> np.ndarray:
        ph = self.phonemes(key, native_phrase)
        syms = ph + [end if end in ",.?!" else ","]
        h = hashlib.sha1(f"{key}|{''.join(syms)}|{length:.3f}|{nz:.3f}|{nw:.3f}|r3".encode()).hexdigest()[:20]
        os.makedirs(CACHE, exist_ok=True)
        cp = os.path.join(CACHE, h + ".npy")
        if os.path.exists(cp):
            return np.load(cp)
        v = self.get(key)
        ids = v.phonemes_to_ids(syms)
        a = v.phoneme_ids_to_audio(ids, self._SC(length_scale=length, noise_scale=nz, noise_w_scale=nw))
        a = np.asarray(a, dtype=np.float32).ravel()
        np.save(cp + ".tmp.npy", a)
        os.replace(cp + ".tmp.npy", cp)
        return a

    def sr(self, key):
        return self.get(key).config.sample_rate


# ----------------------------------------------------------------------------------------------------------------------
# DSP
# ----------------------------------------------------------------------------------------------------------------------
def write_wav(path, a, sr):
    a = np.clip(a, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((a * 32767).astype(np.int16).tobytes())


def read_wav(path):
    with wave.open(path, "rb") as w:
        sr, n = w.getframerate(), w.getnframes()
        a = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
    return a, sr


def ffmpeg(args):
    r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg: " + r.stderr.strip()[:400])


def pitch_shift(a, sr, st, fm=0.0):
    """Сдвиг высоты st полутонов с сохранением формант (rubberband), затем сдвиг формант fm (ресемплинг). Малые значения — естественный звук."""
    if abs(st) < 0.08 and abs(fm) < 0.08:
        return a
    with tempfile.TemporaryDirectory() as td:
        src, dst = os.path.join(td, "i.wav"), os.path.join(td, "o.wav")
        write_wav(src, a, sr)
        flt = []
        if abs(fm) >= 0.08:
            r = 2 ** (fm / 12)
            flt += [f"asetrate={sr * r:.2f}", f"aresample={sr}", f"atempo={1 / r:.5f}"]
        rest = st - fm
        if abs(rest) >= 0.08:
            flt.append(f"rubberband=pitch={2 ** (rest / 12):.5f}:formant=preserved:pitchq=quality:transients=smooth")
        ffmpeg(["-i", src, "-af", ",".join(flt), dst])
        return read_wav(dst)[0]


def eq_filter(a, sr, eq, hp=70, lp=None):
    flt = [f"highpass=f={hp}"]
    if lp:
        flt.append(f"lowpass=f={lp}")
    for f, q, g in eq:
        flt.append(f"equalizer=f={f}:t=q:w={q}:g={g}")
    with tempfile.TemporaryDirectory() as td:
        src, dst = os.path.join(td, "i.wav"), os.path.join(td, "o.wav")
        write_wav(src, a, sr)
        ffmpeg(["-i", src, "-af", ",".join(flt), dst])
        return read_wav(dst)[0]


def trim(a, sr, pre=0.02, post=0.05, thr_db=-44):
    win = int(0.008 * sr)
    sm = np.convolve(np.abs(a), np.ones(win) / win, mode="same")
    th = 10 ** (thr_db / 20) * max(1e-6, float(sm.max()))
    idx = np.where(sm > th)[0]
    if len(idx) == 0:
        return a
    return a[max(0, idx[0] - int(pre * sr)):min(len(a), idx[-1] + int(post * sr))]


def speech_rms_db(a, sr):
    fr = int(0.02 * sr)
    n = len(a) // fr
    if n == 0:
        return -60.0
    r = np.sqrt(np.mean(a[: n * fr].reshape(n, fr) ** 2, axis=1) + 1e-12)
    act = r[r > r.max() * 0.1]
    return float(20 * np.log10(np.sqrt(np.mean(act ** 2)) + 1e-9))


def fade(a, sr, ms_in=6, ms_out=30):
    a = a.copy()
    i, o = int(sr * ms_in / 1000), int(sr * ms_out / 1000)
    if len(a) > i + o:
        a[:i] *= np.linspace(0, 1, i); a[-o:] *= np.linspace(1, 0, o)
    return a


def breath(sr, rng, level_db=-33.0, dur=0.26):
    """Вдох: шум, прошедший полосовой фильтр речевого диапазона, с плавной огибающей."""
    n = int(sr * dur)
    x = rng.standard_normal(n).astype(np.float32)
    # простой полосовой: разность двух однополюсных ФНЧ
    def lp(sig, k):
        y = np.empty_like(sig); acc = 0.0
        for i, v in enumerate(sig):
            acc += (v - acc) * k; y[i] = acc
        return y
    x = lp(x, 0.55) - lp(x, 0.06)
    env = np.sin(np.linspace(0, np.pi, n)) ** 1.6
    x = x * env
    x *= 10 ** (level_db / 20) / (np.sqrt(np.mean(x ** 2)) + 1e-9)
    return x


def hash01(s: str, salt: str = "") -> float:
    return int(hashlib.sha1((s + salt).encode()).hexdigest()[:6], 16) / 0xFFFFFF


# ----------------------------------------------------------------------------------------------------------------------
def say(voices: Voices, speaker: str, emotion: str, native: str, key: str, role_gain_db: float = 0.0) -> tuple[np.ndarray, int]:
    """Полная реплика → (моно float32, sample rate)."""
    cast = CAST.get(speaker) or CAST["Crowd"]
    elen, enz, enw, est, egain, epause = EMOTION.get(emotion, EMOTION["Neutral"])
    mkey = cast["m"]
    sr = voices.sr(mkey)
    rng = np.random.default_rng(int(hash01(key, "rng") * 1e9))
    phrases = split_phrases(native)
    if not phrases:
        return np.zeros(0, np.float32), sr
    out: list[np.ndarray] = []
    n = len(phrases)
    for i, (txt, end) in enumerate(phrases):
        jitter = 1.0 + (hash01(key, f"len{i}") - 0.5) * 0.10          # ±5 % темп
        pos_len = 1.0 + (0.07 if i == n - 1 else 0.0) - (0.03 if 0 < i < n - 1 else 0.0)   # замедление в конце, лёгкое ускорение в середине
        length = cast["len"] * elen * jitter * pos_len
        a = voices.render(mkey, txt, end, length, min(1.0, cast["nz"] * enz), min(1.0, cast["nw"] * enw))
        a = trim(a, sr)
        # мелодика: склонение по реплике, подъём на вопросе, акцент на первой синтагме
        decl = -0.9 * (i / max(1, n - 1)) if n > 1 else -0.3
        st = cast["st"] + est + decl + (hash01(key, f"p{i}") - 0.5) * 0.8
        if end == "?":
            st += 0.9
        elif end == "!":
            st += 0.6
        fm = cast["fm"]
        a = pitch_shift(a, sr, st, fm)
        out.append(a)
        # пауза и дыхание
        if i < n - 1:
            ms = PAUSE_MS.get(end, 250) * cast["pause"] * epause * (0.85 + 0.3 * hash01(key, f"ps{i}"))
            gap = np.zeros(int(sr * ms / 1000), np.float32)
            nxt_long = len(phrases[i + 1][0].split()) >= 4
            if end in ".?!…" and nxt_long and hash01(key, f"br{i}") < cast["breath"] and ms > 250:
                b = breath(sr, rng)
                e = len(gap) - int(0.03 * sr)
                st0 = max(0, e - len(b))
                gap[st0:e] += b[len(b) - (e - st0):]
            out.append(gap)
    # смешок на шутке (в конце реплики): "ха-ха" голосом персонажа, тихо
    if emotion in ("Amused", "Joy", "Wry") and hash01(key, "laugh") < cast["laugh"] * (1.0 if emotion != "Wry" else 0.5):
        out.append(np.zeros(int(sr * 0.12), np.float32))
        out.append(laugh(voices, mkey, cast, sr, key))
    a = np.concatenate(out)
    if cast.get("choir"):
        a = choir(a, sr)
    a = eq_filter(a, sr, cast["eq"], hp=85 if cast["st"] < 2 else 130, lp=cast.get("lp"))
    if emotion == "Whisper":
        a = whisperize(a, sr, 0.55)
    # тихий «воздух комнаты» не нужен: комнату даёт игра. Нормализация громкости по активной речи.
    a = trim(a, sr, pre=0.02, post=0.12)
    target = -20.0 + cast["gain"] + egain + role_gain_db
    a = a * 10 ** ((target - speech_rms_db(a, sr)) / 20)
    pk = float(np.max(np.abs(a)) + 1e-9)
    if pk > 0.89:
        a = a * (0.89 / pk)
    return fade(a, sr), sr


def laugh(voices: Voices, mkey: str, cast: dict, sr: int, key: str) -> np.ndarray:
    """Короткий смешок: «ха-ха-ха» теми же фонемами голоса (h + открытый гласный), угасающий и чуть выше по тону."""
    v = voices.get(mkey)
    syms = list("hˈaha") + [" "] + list("haha") + [" "] + list("ha") + [","]
    ids = v.phonemes_to_ids(syms)
    a = v.phoneme_ids_to_audio(ids, voices._SC(length_scale=0.75, noise_scale=0.9, noise_w_scale=1.0))
    a = np.asarray(a, np.float32).ravel()
    a = trim(a, sr, pre=0.0, post=0.02)
    a = pitch_shift(a, sr, cast["st"] + 1.5, cast["fm"] + 0.3)
    env = np.linspace(1.0, 0.35, len(a)) ** 1.2
    return (a * env * 0.6).astype(np.float32)


def whisperize(a, sr, mix):
    n, hop = 512, 128
    win = np.hanning(n).astype(np.float32)
    pad = np.concatenate([np.zeros(n, np.float32), a, np.zeros(n, np.float32)])
    out = np.zeros_like(pad); wsum = np.zeros_like(pad)
    rng = np.random.default_rng(7)
    for i in range(0, len(pad) - n, hop):
        X = np.fft.rfft(pad[i:i + n] * win)
        Y = np.abs(X) * np.exp(1j * rng.uniform(0, 2 * np.pi, X.shape))
        out[i:i + n] += np.fft.irfft(Y, n) * win; wsum[i:i + n] += win * win
    out = (out / np.maximum(wsum, 1e-3))[n:n + len(a)]
    out *= np.sqrt(np.mean(a ** 2) + 1e-9) / np.sqrt(np.mean(out ** 2) + 1e-9)
    return (1 - mix) * a + mix * out


def choir(a, sr):
    """Литургический «хор» жрицы: тот же голос на октаву ниже и квинту выше, чуть позже (без вибрато-артефактов)."""
    low = pitch_shift(a, sr, -12, -6)
    up = pitch_shift(a, sr, 7, 3)
    L = max(len(a), len(low) + int(0.02 * sr), len(up) + int(0.035 * sr))
    mix = np.zeros(L, np.float32)
    mix[:len(a)] += a
    mix[int(0.02 * sr):int(0.02 * sr) + len(low)] += 0.5 * low
    mix[int(0.035 * sr):int(0.035 * sr) + len(up)] += 0.3 * up
    return mix


def encode_opus(a, sr, kbps, out_sr=24000):
    with tempfile.TemporaryDirectory() as td:
        src, dst = os.path.join(td, "i.wav"), os.path.join(td, "o.ogg")
        write_wav(src, a, sr)
        ffmpeg(["-i", src, "-ac", "1", "-ar", str(out_sr), "-c:a", "libopus", "-b:a", f"{kbps}k", "-vbr", "on", "-compression_level", "10",
                "-application", "audio" if kbps >= 32 else "voip", "-frame_duration", "20" if kbps >= 32 else "60", dst])
        data = open(dst, "rb").read()
    return data, len(a) / sr
