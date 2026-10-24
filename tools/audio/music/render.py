#!/usr/bin/env python3
"""
Offline soundtrack renderer.

  python3 tools/audio/music/render.py [track ...] [--out public/audio/music] [--wav DIR] [--bitrate 160]

Renders the tracks defined in tracks.py (all when none is named), masters them to -18 LUFS integrated
(true peak <= -1 dBTP), encodes Ogg Opus with ffmpeg, decodes the file back and analyses both
(loudness, peaks, DC, spectrum balance, clicks, loop seam), and updates <out>/manifest.json.
"""
import argparse
import json
import os
import subprocess
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dsp import SR  # noqa: E402
from analyze import analyse  # noqa: E402
import tracks as T  # noqa: E402

ROLL = 0.5


def encode(st, path, bitrate):
    pcm = np.ascontiguousarray(st.T.astype(np.float32)).tobytes()
    cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-',
           '-c:a', 'libopus', '-b:a', f'{bitrate}k', '-vbr', 'on', '-compression_level', '10', '-application', 'audio',
           '-metadata', 'artist=Orbital Station (procedural score)', path]
    subprocess.run(cmd, input=pcm, check=True)


def decode(path):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path, '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-'],
                         capture_output=True, check=True).stdout
    a = np.frombuffer(out, dtype=np.float32).reshape(-1, 2).T
    return a.astype(np.float64)


def write_wav(st, path):
    from scipy.io import wavfile
    wavfile.write(path, SR, (np.clip(st.T, -1, 1) * 32767).astype(np.int16))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('names', nargs='*')
    ap.add_argument('--out', default='public/audio/music')
    ap.add_argument('--wav', default=None, help='also write 16-bit WAV masters here')
    ap.add_argument('--bitrate', type=int, default=160)
    args = ap.parse_args()
    names = args.names or list(T.TRACKS.keys())
    os.makedirs(args.out, exist_ok=True)
    man_path = os.path.join(args.out, 'manifest.json')
    manifest = {'tracks': {}}
    if os.path.exists(man_path):
        with open(man_path) as f:
            manifest = json.load(f)
    for name in names:
        fn, meta = T.TRACKS[name]
        t0 = time.time()
        mix, plan = fn()
        st = mix.master(target=-18.0 if meta['loop'] else -19.0, fade_out=meta.get('fade', 0.0))
        rt = time.time() - t0
        path = os.path.join(args.out, f'{name}.ogg')
        # loops carry ROLL seconds of wrapped pre-roll and post-roll: the player loops between loopStart and
        # loopEnd, so codec warm-up at the file start never reaches the seam and a constant decoder offset
        # cannot misalign it (both sides of the seam hold identical material)
        roll = int(ROLL * SR) if meta['loop'] else 0
        enc = np.concatenate([st[:, -roll:], st, st[:, :roll]], axis=1) if roll else st
        encode(enc, path, args.bitrate)
        if args.wav:
            os.makedirs(args.wav, exist_ok=True)
            write_wav(st, os.path.join(args.wav, f'{name}.wav'))
        dec = decode(path)
        if roll:
            dec = dec[:, roll:roll + st.shape[1]]   # what the looping player hears
        a_master = analyse(st, loop=meta['loop'])
        a_dec = analyse(dec, loop=meta['loop'])
        info = dict(file=f'{name}.ogg', title=meta['title'], mood=meta['mood'], loop=meta['loop'],
                    duration=round(st.shape[1] / SR, 3), loopStart=round(roll / SR, 6), loopEnd=round((roll + st.shape[1]) / SR, 6),
                    bpm=plan.bpm, bytes=os.path.getsize(path),
                    lufs=a_dec['lufs'], truePeak=a_dec['true_peak_db'])
        manifest['tracks'][name] = info
        print(f'== {name} «{meta["title"]}»  {info["duration"]:.1f} s  render {rt:.0f} s  {info["bytes"] / 1e6:.2f} MB')
        print('   stems (LUFS before levelling): ' + ', '.join(f'{k} {v}' for k, v in mix.report))
        print('   master : ' + json.dumps(a_master))
        print('   decoded: ' + json.dumps(a_dec))
        with open(man_path, 'w') as f:
            json.dump(manifest, f, indent=1, ensure_ascii=False)
        sys.stdout.flush()


if __name__ == '__main__':
    main()
