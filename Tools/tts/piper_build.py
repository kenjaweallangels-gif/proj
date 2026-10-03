#!/usr/bin/env python3
"""
piper_build.py — офлайн-озвучка всех реплик среза нейросетью Piper (голос ar_JO-kareem-medium) на этапе сборки.

    pip install piper-tts numpy                       # ffmpeg (с rubberband и libopus) должен быть в PATH
    python3 Tools/tts/gen_dialogue.py                 # сначала собрать CSV из script_s1.py
    python3 Tools/tts/piper_build.py                  # → Web/src/assets/vo.js + Tools/tts/vo_durations.json
    python3 Tools/tts/piper_build.py --only DLG_A1_001,DLG_B5_P01 --keep-wav /tmp/vo_wav   # быстрая проверка на слух
    python3 Tools/tts/piper_build.py --bitrate 14     # меньше размер

Что делает:
  1. Берёт из Dialogue_S1.csv каждую озвучиваемую реплику (Speaker != Lore, есть Line_NativeScript) и из BARKS_MURMUR — безсловесные
     реплики-«бормотание» для лая толпы (на языке хашшана, 1–2 слова).
  2. Нормализует арабицу для Piper (паузальные формы, финальная долгота, «…» и «—» → запятая).
  3. Синтезирует голосом kareem (SynthesisConfig: темп и «живость» зависят от персонажа и эмоции).
  4. Пост-обработка на персонажа (VOICE_FX): сдвиг высоты с сохранением формант (rubberband) + отдельный сдвиг формант (ресемплинг),
     EQ, шёпот/дыхание (рандомизация фазы STFT), реверберация (свёртка с синтетической ИХ), хор жрицы (три голоса) и вибрато,
     тихий шум комнаты, нормализация громкости.
  5. Кодирует Opus (OGG) моно 16–20 кбит/с и кладёт data-URI в Web/src/assets/vo.js (ключ = DialogueID; лай — в BARKS по архетипам),
     плюс длительности (VO_DUR), которыми субтитры синхронизируются с аудио.
Идемпотентность: промежуточные WAV Piper кэшируются в Tools/tts/.cache/ по хешу (текст, конфиг); повторный запуск быстрый.
Модель: Tools/tts/models/ar_JO-kareem-medium.onnx (скачивается автоматически с huggingface.co/rhasspy/piper-voices, ~63 МБ, в git не кладём).
"""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from native2ar import to_script  # noqa: E402

CSV_PATH = os.path.join(ROOT, "Content", "Rakis", "Data", "Dialogue_S1.csv")
OUT_JS = os.path.join(ROOT, "Web", "src", "assets", "vo.js")
DUR_JSON = os.path.join(HERE, "vo_durations.json")
MODEL_DIR = os.path.join(HERE, "models")
MODEL_NAME = "ar_JO-kareem-medium"
MODEL_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium/" + MODEL_NAME
CACHE = os.path.join(HERE, ".cache")
SR_OUT = 24000

# ----------------------------------------------------------------------------------------------------------------------
# Голоса персонажей. len — множитель длины фонемы Piper (>1 медленнее), pitch — суммарный сдвиг высоты в полутонах,
# formant — сдвиг формант (спектральной огибающей) в полутонах: у женщин +2…+3 при +4…+7 по высоте (естественнее, чем «бурундук»),
# breath — доля «дыхания» (0..1), rev — (RT60 с, доля влажного), eq — [(Гц, Q, дБ)], gain — дБ, vib — (Гц, глубина) вибрато.
# ----------------------------------------------------------------------------------------------------------------------
VOICE_FX = {
    "Kair":      dict(len=1.00, pitch=-0.5, formant=-0.3, breath=0.00, rev=(0.35, 0.08), eq=[(120, 1.0, 1.5), (3200, 1.0, 1.0)], gain=0.0, noise=0.95),
    "Ilva":      dict(len=1.00, pitch=6.0, formant=2.8, breath=0.04, rev=(0.35, 0.08), eq=[(250, 1.0, -1.0), (3800, 1.0, 1.5)], gain=0.0, noise=0.8),
    "Rayn":      dict(len=1.10, pitch=1.4, formant=0.6, breath=0.00, rev=(0.35, 0.08), eq=[(2800, 1.2, 1.5)], gain=0.0, noise=1.0, tremble=True),
    "Ossana":    dict(len=0.96, pitch=4.2, formant=2.0, breath=0.05, rev=(0.35, 0.08), eq=[(180, 1.0, -1.5), (2500, 1.0, 2.5)], gain=0.5, noise=0.7),
    "Rider1":    dict(len=0.93, pitch=0.8, formant=0.4, breath=0.00, rev=(0.6, 0.12), eq=[(2600, 1.0, 1.5)], gain=0.0, noise=0.9),
    "Rider2":    dict(len=0.93, pitch=-1.2, formant=-0.6, breath=0.00, rev=(0.6, 0.12), eq=[(2600, 1.0, 1.5)], gain=0.0, noise=0.9),
    "Guard":     dict(len=1.02, pitch=-1.8, formant=-1.0, breath=0.00, rev=(0.45, 0.10), eq=[(110, 1.0, 2.0), (3000, 1.0, 1.0)], gain=0.0, noise=0.8),
    "Harmat":    dict(len=1.22, pitch=-2.8, formant=-1.8, breath=0.28, rev=(0.9, 0.14), eq=[(100, 1.0, 2.5), (4000, 0.8, -3.0)], gain=0.0, noise=0.55, lp=6500),
    "Priestess": dict(len=1.55, pitch=5.0, formant=2.0, breath=0.10, rev=(2.4, 0.42), eq=[(220, 1.0, -1.0), (1800, 1.0, 1.5)], gain=-1.0, noise=0.5, vib=(5.0, 0.28), choir=True),
    "Trader":    dict(len=0.97, pitch=0.8, formant=0.3, breath=0.00, rev=(0.4, 0.09), eq=[(2800, 1.0, 1.5)], gain=0.0, noise=1.0),
    "Carrier":   dict(len=1.02, pitch=4.8, formant=2.4, breath=0.05, rev=(0.45, 0.10), eq=[(300, 1.0, -1.0), (3500, 1.0, 1.5)], gain=0.0, noise=0.8),
    "Weaver":    dict(len=1.05, pitch=5.6, formant=2.8, breath=0.07, rev=(0.45, 0.10), eq=[(300, 1.0, -1.0), (3500, 1.0, 1.0)], gain=0.0, noise=0.75),
    "Mother":    dict(len=1.02, pitch=4.2, formant=2.2, breath=0.05, rev=(0.45, 0.10), eq=[(300, 1.0, -1.0), (3200, 1.0, 1.0)], gain=0.0, noise=0.75),
    "Child":     dict(len=0.90, pitch=9.0, formant=5.5, breath=0.02, rev=(0.45, 0.10), eq=[(200, 1.0, -2.0), (4200, 1.0, 1.5)], gain=0.0, noise=0.9),
    "Girl":      dict(len=0.92, pitch=10.0, formant=6.0, breath=0.02, rev=(0.45, 0.10), eq=[(200, 1.0, -2.0), (4400, 1.0, 1.5)], gain=0.0, noise=0.9),
    "Elder":     dict(len=1.16, pitch=-2.4, formant=-1.4, breath=0.30, rev=(0.6, 0.12), eq=[(100, 1.0, 1.5), (3800, 0.8, -3.5)], gain=0.0, noise=0.6, lp=6200),
    "Youth":     dict(len=0.98, pitch=1.8, formant=0.8, breath=0.00, rev=(0.45, 0.10), eq=[(2800, 1.0, 1.5)], gain=0.0, noise=1.0),
    "Pilgrim":   dict(len=1.04, pitch=6.2, formant=3.0, breath=0.07, rev=(0.5, 0.11), eq=[(300, 1.0, -1.0), (3500, 1.0, 1.0)], gain=0.0, noise=0.75),
    "Crowd":     dict(len=1.0, pitch=0.0, formant=0.0, breath=0.05, rev=(0.6, 0.14), eq=[], gain=-1.0, noise=0.9),
}
# длина фонемы по эмоции (множитель к len персонажа), «живость» просодии (noise_w) и громкость
EMOTION = {
    "Neutral": (1.00, 0.8, 0.0), "Calm": (1.04, 0.7, 0.0), "Tense": (0.92, 0.9, 0.5), "Afraid": (0.94, 1.0, 0.0),
    "Angry": (0.92, 1.0, 1.0), "Whisper": (1.10, 0.7, -4.0), "Reverent": (1.20, 0.6, -1.0), "Wry": (1.02, 0.95, 0.0),
    "Amused": (0.96, 1.0, 0.0), "Warm": (1.04, 0.85, 0.0), "Joy": (0.90, 1.0, 0.5),
}

# Безсловесные «бормотания» для лая толпы: (архетип, голос, латиница)
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


# ----------------------------------------------------------------------------------------------------------------------
# Нормализация арабицы для Piper/espeak
# ----------------------------------------------------------------------------------------------------------------------
AR_LET = "ء-غف-ي"
SUKUN, SHADDA = "ْ", "ّ"
HARAKAT = "ًٌٍَُِّْ"


def piper_text(script: str) -> str:
    """Приводит строку к виду, который espeak-ng читает без падежных окончаний и с сохранением долготы."""
    t = script.replace("…", "،").replace("—", "،").replace("–", "،").replace(";", "،").replace("؛", "،")
    t = re.sub(r"[\[\]]", "", t)
    t = re.sub(r"\s*،\s*(،\s*)+", "، ", t)
    out = []
    for w in t.split(" "):
        m = re.match(rf"^([{AR_LET}{HARAKAT}]+)(.*)$", w)
        if m:
            body, rest = m.group(1), m.group(2)
            if body and body[-1] == SHADDA:  # финальное удвоение
                body = body[:-1] + SUKUN + body[-2] + SUKUN if len(body) >= 2 else body
            out.append(body + rest)
        else:
            out.append(w)
    t = " ".join(out)
    t = re.sub(r"\s+([،؟!.])", r"\1", t)
    return t.strip()


# ----------------------------------------------------------------------------------------------------------------------
# Piper
# ----------------------------------------------------------------------------------------------------------------------
def ensure_model(path: str | None) -> str:
    if path:
        return path
    os.makedirs(MODEL_DIR, exist_ok=True)
    onnx = os.path.join(MODEL_DIR, MODEL_NAME + ".onnx")
    for ext in (".onnx", ".onnx.json"):
        f = os.path.join(MODEL_DIR, MODEL_NAME + ext)
        if not os.path.exists(f):
            print(f"скачиваю {MODEL_URL + ext}")
            urllib.request.urlretrieve(MODEL_URL + ext, f)
    return onnx


class Synth:
    def __init__(self, model):
        from piper import PiperVoice, SynthesisConfig
        self.SynthesisConfig = SynthesisConfig
        self.voice = PiperVoice.load(model)
        self.sr = self.voice.config.sample_rate

    def render(self, text: str, length: float, noise: float, noise_w: float) -> np.ndarray:
        key = hashlib.sha1(f"{text}|{length:.3f}|{noise:.3f}|{noise_w:.3f}|{MODEL_NAME}".encode()).hexdigest()[:20]
        os.makedirs(CACHE, exist_ok=True)
        cp = os.path.join(CACHE, key + ".wav")
        if not os.path.exists(cp):
            cfg = self.SynthesisConfig(length_scale=length, noise_scale=noise, noise_w_scale=noise_w)
            with wave.open(cp, "wb") as w:
                self.voice.synthesize_wav(text, w, syn_config=cfg)
        return read_wav(cp)[0]


def read_wav(path):
    with wave.open(path, "rb") as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        a = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    return a, sr


def write_wav(path, a, sr):
    a = np.clip(a, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((a * 32767).astype(np.int16).tobytes())


# ----------------------------------------------------------------------------------------------------------------------
# DSP
# ----------------------------------------------------------------------------------------------------------------------
def ffmpeg(args, quiet=True):
    cmd = ["ffmpeg", "-y", "-loglevel", "error", *args]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg: " + r.stderr.strip()[:500])


def shift_voice(a: np.ndarray, sr: int, pitch: float, formant: float, extra: str = "") -> np.ndarray:
    """Высота pitch (полутонов, суммарно) с формантами formant: ресемплинг двигает и то, и другое, rubberband докручивает высоту, не трогая форманты."""
    if abs(pitch) < 0.05 and abs(formant) < 0.05 and not extra:
        return a
    with tempfile.TemporaryDirectory() as td:
        src, dst = os.path.join(td, "i.wav"), os.path.join(td, "o.wav")
        write_wav(src, a, sr)
        flt = []
        if abs(formant) >= 0.05:
            r = 2 ** (formant / 12)
            flt.append(f"asetrate={sr * r:.2f}")
            flt.append(f"aresample={sr}")
            flt.append(f"atempo={1 / r:.5f}")
        rest = pitch - formant
        if abs(rest) >= 0.05:
            flt.append(f"rubberband=pitch={2 ** (rest / 12):.5f}:formant=preserved:pitchq=quality:transients=smooth")
        if extra:
            flt.append(extra)
        ffmpeg(["-i", src, "-af", ",".join(flt), dst])
        return read_wav(dst)[0]


def biquad_eq(a: np.ndarray, sr: int, eq, hp=70, lp=None) -> np.ndarray:
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


def whisperize(a: np.ndarray, sr: int, mix: float) -> np.ndarray:
    """Дыхание/шёпот: сохраняем огибающую спектра, фазу случайная (голос → шипение). mix 0..1."""
    if mix <= 0.01:
        return a
    n, hop = 512, 128
    win = np.hanning(n).astype(np.float32)
    pad = np.concatenate([np.zeros(n, np.float32), a, np.zeros(n, np.float32)])
    out = np.zeros_like(pad)
    wsum = np.zeros_like(pad)
    rng = np.random.default_rng(7)
    for i in range(0, len(pad) - n, hop):
        X = np.fft.rfft(pad[i:i + n] * win)
        ph = rng.uniform(0, 2 * np.pi, X.shape)
        Y = np.abs(X) * np.exp(1j * ph)
        out[i:i + n] += np.fft.irfft(Y, n) * win
        wsum[i:i + n] += win * win
    out = out / np.maximum(wsum, 1e-3)
    out = out[n:n + len(a)]
    ra, ro = np.sqrt(np.mean(a ** 2) + 1e-9), np.sqrt(np.mean(out ** 2) + 1e-9)
    out = out * (ra / ro)
    return (1 - mix) * a + mix * out


def reverb(a: np.ndarray, sr: int, rt60: float, wet: float, seed=3) -> np.ndarray:
    if wet <= 0.001:
        return a
    n = int(sr * rt60 * 1.1)
    rng = np.random.default_rng(seed)
    ir = rng.standard_normal(n).astype(np.float32)
    t = np.arange(n) / sr
    ir *= np.exp(-6.91 * t / rt60)
    # затемнение хвоста: однополюсный ФНЧ с нарастающей постоянной
    y = np.zeros_like(ir); lp = 0.0
    for i in range(n):
        k = 0.65 - 0.5 * min(1.0, t[i] / rt60)
        lp += (ir[i] - lp) * (1 - k)
        y[i] = lp
    ir = y
    pre = int(0.012 * sr)
    ir = np.concatenate([np.zeros(pre, np.float32), ir])
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    L = len(a) + len(ir)
    nfft = 1 << (L - 1).bit_length()
    w = np.fft.irfft(np.fft.rfft(a, nfft) * np.fft.rfft(ir, nfft), nfft)[:L].astype(np.float32)
    dry = np.concatenate([a, np.zeros(L - len(a), np.float32)])
    ra = np.sqrt(np.mean(dry ** 2) + 1e-9); rw = np.sqrt(np.mean(w ** 2) + 1e-9)
    return dry * (1 - 0.35 * wet) + w * (ra / rw) * wet


def trim(a: np.ndarray, sr: int, pre=0.06, post=0.10, thr_db=-46):
    env = np.abs(a)
    win = int(0.01 * sr)
    sm = np.convolve(env, np.ones(win) / win, mode="same")
    th = 10 ** (thr_db / 20) * max(1e-6, float(sm.max()))
    idx = np.where(sm > th)[0]
    if len(idx) == 0:
        return a
    s = max(0, idx[0] - int(pre * sr)); e = min(len(a), idx[-1] + int(post * sr))
    return a[s:e]


def speech_rms_db(a: np.ndarray, sr: int) -> float:
    fr = int(0.02 * sr)
    n = len(a) // fr
    if n == 0:
        return -60.0
    r = np.sqrt(np.mean(a[: n * fr].reshape(n, fr) ** 2, axis=1) + 1e-12)
    act = r[r > r.max() * 0.1]
    return float(20 * np.log10(np.sqrt(np.mean(act ** 2)) + 1e-9))


def fade(a: np.ndarray, sr: int, ms_in=8, ms_out=40):
    a = a.copy()
    i, o = int(sr * ms_in / 1000), int(sr * ms_out / 1000)
    if len(a) > i + o:
        a[:i] *= np.linspace(0, 1, i); a[-o:] *= np.linspace(1, 0, o)
    return a


def process(synth: Synth, text_ar: str, speaker: str, emotion: str, seed_key: str) -> np.ndarray:
    fx = VOICE_FX.get(speaker) or VOICE_FX["Crowd"]
    elen, enw, egain = EMOTION.get(emotion, EMOTION["Neutral"])
    length = fx["len"] * elen
    # небольшой разнобой для толпы, чтобы лай не звучал одним голосом
    pitch, formant = fx["pitch"], fx["formant"]
    if speaker == "Crowd":
        h = int(hashlib.sha1(seed_key.encode()).hexdigest()[:6], 16)
        pitch = (h % 120) / 10 - 3.0   # -3 … +9
        formant = pitch * 0.5
        length = 0.95 + (h % 25) / 100
    noise_w = enw
    a = synth.render(piper_text(text_ar), length, fx["noise"] * 0.667 + 0.1, noise_w)
    sr = synth.sr
    a = trim(a, sr)
    vib = fx.get("vib")
    extra = f"vibrato=f={vib[0]}:d={vib[1]}" if vib else ""
    if fx.get("tremble"):
        extra = "vibrato=f=6.5:d=0.07"
    base = shift_voice(a, sr, pitch, formant, extra)
    if fx.get("choir"):  # хор: тот же голос на октаву ниже и на квинту выше, чуть позже
        low = shift_voice(a, sr, pitch - 12, formant - 6, extra)
        up = shift_voice(a, sr, pitch + 7, formant + 3, extra)
        L = max(len(base), len(low) + int(0.02 * sr), len(up) + int(0.035 * sr))
        mix = np.zeros(L, np.float32)
        mix[:len(base)] += base
        mix[int(0.02 * sr):int(0.02 * sr) + len(low)] += 0.55 * low
        mix[int(0.035 * sr):int(0.035 * sr) + len(up)] += 0.35 * up
        base = mix
    breath = fx["breath"] + (0.55 if emotion == "Whisper" else 0.0)
    base = whisperize(base, sr, min(0.85, breath))
    base = biquad_eq(base, sr, fx["eq"], hp=90 if pitch < 3 else 130, lp=fx.get("lp"))
    rt, wet = fx["rev"]
    base = reverb(base, sr, rt, wet)
    # комнатный шум (очень тихий), чтобы реплики «сидели» в пространстве
    rng = np.random.default_rng(11)
    n = rng.standard_normal(len(base)).astype(np.float32)
    n = np.convolve(n, np.ones(6) / 6, mode="same")
    base = base + n * (10 ** (-58 / 20))
    base = trim(base, sr, pre=0.05, post=0.35 if wet > 0.3 else 0.12)
    # громкость: цель −20 dBFS по активной речи + персонаж/эмоция
    target = -20.0 + fx["gain"] + egain
    g = 10 ** ((target - speech_rms_db(base, sr)) / 20)
    base = base * g
    pk = np.max(np.abs(base))
    if pk > 0.89:
        base = base * (0.89 / pk)
    return fade(base, sr)


def encode_opus(a: np.ndarray, sr: int, kbps: int) -> tuple[bytes, float]:
    with tempfile.TemporaryDirectory() as td:
        src, dst = os.path.join(td, "i.wav"), os.path.join(td, "o.ogg")
        write_wav(src, a, sr)
        ffmpeg(["-i", src, "-ac", "1", "-ar", str(SR_OUT), "-c:a", "libopus", "-b:a", f"{kbps}k", "-vbr", "on", "-compression_level", "10",
                "-application", "audio", "-frame_duration", "40", dst])
        data = open(dst, "rb").read()
    return data, len(a) / sr


def data_uri(b: bytes) -> str:
    return "data:audio/ogg;codecs=opus;base64," + base64.b64encode(b).decode("ascii")


# ----------------------------------------------------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", help="путь к .onnx (по умолчанию Tools/tts/models/, скачивается)")
    ap.add_argument("--only", help="DialogueID через запятую (быстрый прогон; vo.js не перезаписывается без --write)")
    ap.add_argument("--no-barks", action="store_true")
    ap.add_argument("--bitrate", type=int, default=16)
    ap.add_argument("--keep-wav", help="каталог: сохранить финальные WAV для прослушивания")
    ap.add_argument("--write", action="store_true", help="записать vo.js даже при --only")
    ap.add_argument("--out", default=OUT_JS)
    a = ap.parse_args(argv)

    rows = []
    with open(CSV_PATH, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            if r["Speaker"] == "Lore" or not r["Line_NativeScript"].strip():
                continue
            rows.append(r)
    only = set(a.only.split(",")) if a.only else None
    if only:
        rows = [r for r in rows if r["DialogueID"] in only]

    synth = Synth(ensure_model(a.model))
    vo, dur, sizes = {}, {}, {}
    if a.keep_wav:
        os.makedirs(a.keep_wav, exist_ok=True)
    for i, r in enumerate(rows, 1):
        did = r["DialogueID"]
        pcm = process(synth, r["Line_NativeScript"], r["Speaker"], r["Emotion"], did)
        data, d = encode_opus(pcm, synth.sr, a.bitrate)
        vo[did] = data_uri(data); dur[did] = round(d, 2); sizes[did] = len(data)
        if a.keep_wav:
            write_wav(os.path.join(a.keep_wav, did + ".wav"), pcm, synth.sr)
        if i % 20 == 0 or i == len(rows):
            print(f"  {i}/{len(rows)}  всего {sum(sizes.values()) / 1024:.0f} КБ", flush=True)

    barks = {}
    if not a.no_barks and not only:
        for k, (arch, voice, lat) in enumerate(BARKS_MURMUR):
            pcm = process(synth, to_script(lat), voice, "Calm", f"BARK{k}")
            data, d = encode_opus(pcm, synth.sr, a.bitrate)
            barks.setdefault(arch, []).append({"u": data_uri(data), "d": round(d, 2)})
            sizes[f"BARK{k}"] = len(data)
        print(f"  лай: {sum(len(v) for v in barks.values())} клипов")

    total = sum(sizes.values())
    if only and not a.write:
        print(f"проверка: {len(vo)} клипов, {total / 1024:.0f} КБ (vo.js не тронут)")
        return 0
    if not only:
        json.dump(dur, open(DUR_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=0, sort_keys=True)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write("// Сгенерировано Tools/tts/piper_build.py (Piper ar_JO-kareem-medium + ffmpeg, Opus ~%d кбит/с) — не править вручную.\n" % a.bitrate)
        f.write("// VO: DialogueID → data-URI (OGG/Opus, моно). VO_DUR: длительность, с. BARKS: архетип → [{u, d}] — безсловесные бормотания толпы.\n")
        f.write("export const VO = " + json.dumps(vo, ensure_ascii=False, separators=(",", ":")) + ";\n")
        f.write("export const VO_DUR = " + json.dumps(dur, separators=(",", ":")) + ";\n")
        f.write("export const BARKS = " + json.dumps(barks, ensure_ascii=False, separators=(",", ":")) + ";\n")
    sz = os.path.getsize(a.out)
    print(f"{a.out}: {len(vo)} реплик + {sum(len(v) for v in barks.values())} лая, сырых Opus {total / 1024:.0f} КБ, vo.js {sz / 1024 / 1024:.2f} МБ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
