#!/usr/bin/env python3
"""
Download the CC0 source material scans used by tools/bake_station_textures.py (ambientCG, https://ambientcg.com,
Creative Commons CC0 1.0). Only the maps the baker needs are extracted.

    python3 tools/fetch_station_textures.py [--dest DIR]      (default: ~/.cache/station-texture-sources)
"""
import argparse, io, os, sys, urllib.request, zipfile

SOURCES = {
    # asset id, resolution: why
    'Foil002': '4K',        # crumpled metal foil: MLI blanket crinkle (normal / roughness)
    'Foil001': '2K',        # second foil scan (variation for the silver MLI)
    'Fabric060': '2K',      # white twill weave: beta cloth covers, interior soft goods
    'Scratches001': '2K',   # scratch / smudge masks: paint wear, roughness variation
    'Scratches002': '2K',
    'Scratches003': '2K',
    'Scratches004': '2K',
    'Smear001': '2K',       # fingerprint / smear mask: grime, glass
    'Plastic013A': '2K',    # white plastic (orange-peel micro normal): paint / interior panels
    'Metal009': '2K',       # brushed metal
    'Metal011': '2K',       # brushed metal, finer
    'Metal032': '2K',       # machined / anodised metal
}
WANT = ('_Color.', '_NormalGL.', '_Roughness.', '_Opacity.', '_Displacement.', '_AmbientOcclusion.', '_Metalness.')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dest', default=os.path.expanduser('~/.cache/station-texture-sources'))
    a = ap.parse_args()
    os.makedirs(a.dest, exist_ok=True)
    for aid, res in SOURCES.items():
        out = os.path.join(a.dest, aid)
        if os.path.isdir(out) and os.listdir(out):
            print('have', aid); continue
        url = f'https://ambientcg.com/get?file={aid}_{res}-JPG.zip'
        print('get', url, flush=True)
        req = urllib.request.Request(url, headers={'User-Agent': 'curl/8.5.0'})
        data = urllib.request.urlopen(req, timeout=600).read()
        os.makedirs(out, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for n in z.namelist():
                base = os.path.basename(n)
                if not base or '/' in n.strip('/') and n.endswith('/'): continue
                if any(w in base for w in WANT) and base.lower().endswith(('.jpg', '.png')):
                    # normalise the name: <id>_<Map>.<ext>
                    m = [w for w in WANT if w in base][0].strip('_.')
                    with open(os.path.join(out, f'{aid}_{m}{os.path.splitext(base)[1].lower()}'), 'wb') as f: f.write(z.read(n))
        print('  ->', sorted(os.listdir(out)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
