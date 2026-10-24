#!/usr/bin/env python3
"""
Crew body for the astronaut rig, built from MakeHuman CC0 assets (base mesh hm08, targets, default rig
weights, skin / clothes / hair / eyebrow / eyelash / eye proxies). Output: public/models/crew/
  crew.json   parts (offsets into crew.bin, material), rig joints + rest frames (body space, metres), eye point
  crew.bin    per part: position f32x3, normal f32x3, uv f32x2, skinIndex u8x4, skinWeight u8x4, index u32
  textures    skin_albedo.jpg / skin_normal.png / skin_orm.jpg, clothes_*, shoes_albedo.png, hair_albedo.png,
              hair_normal.png, brows.png, lashes.png, eye.png (2048 / 1024 / 512, see SIZES)

Inputs (all CC0 — "This asset was explicitly released as CC0 in september 2020"):
  --mh   directory with  3dobjs/base.obj, rigs/default.mhskel, rigs/default_weights.mhw
         (raw files of makehumancommunity/makehuman, makehuman/data/...)
  --targets directory with  caucasian-male-young.target.gz, universal-male-young-maxmuscle-averageweight.target.gz
         (makehumancommunity/mpfb2, src/mpfb/data/targets/macrodetails/)
  --pack directory with the extracted MakeHuman system assets pack
         (http://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip):
         skins/young_caucasian_male, clothes/male_casualsuit06, clothes/shoes05, hair/short02,
         eyebrows/eyebrow001, eyelashes/eyelashes01, eyes/high-poly, eyes/materials, proxymeshes/proxy741

The body is the hm08 base mesh with the young caucasian male target (+35 % muscle), scaled to a stature of
1.80 m (soles at y = 0, +Z forward, +X the body's left). Clothes (t-shirt + jeans of male_casualsuit06,
recoloured to a navy crew shirt and khaki-grey trousers, the MakeHuman logo removed), shoes with socks,
short hair, eyebrows, eyelashes and eyes are fitted with their .mhclo data. Skin weights come from the
MakeHuman default rig, mapped onto the 51-bone astronaut skeleton (src/player/suit/Rig.js). The rest frame of
every bone (limb along local -Y, front +Z) is exported so the runtime can pose the A-pose bind mesh from the
canonical "arms down" frames. LOD2 uses the proxy741 low-poly body with region colours.
"""
import argparse
import gzip
import json
import os
import re
import struct

import numpy as np
from PIL import Image, ImageFilter

STATURE = 1.80
MUSCLE = 0.35

# MakeHuman bone -> [(astronaut bone, factor)]
def map_bone(n):
    side = 'L' if n.endswith('.L') else 'R' if n.endswith('.R') else ''
    b = n[:-2] if side else n
    if b == 'root' or b == 'pelvis':
        return [('pelvis', 1)]
    if b in ('spine05', 'spine04'):
        return [('spine', 1)]
    if b in ('spine03', 'spine02', 'spine01', 'breast', 'clavicle'):
        return [('chest', 1)]
    if b == 'shoulder01':
        return [('chest', 0.45), (f'upperArm{side}', 0.55)]
    if b.startswith('neck'):
        return [('neck', 1)]
    if b in ('upperarm01', 'upperarm02'):
        return [(f'upperArm{side}', 1)]
    if b in ('lowerarm01', 'lowerarm02'):
        return [(f'forearm{side}', 1)]
    if b == 'wrist' or b.startswith('metacarpal'):
        return [(f'hand{side}', 1)]
    m = re.match(r'finger(\d)-(\d)', b)
    if m:
        f = ['thumb', 'index', 'middle', 'ring', 'pinky'][int(m.group(1)) - 1]
        return [(f'{f}{m.group(2)}{side}', 1)]
    if b in ('upperleg01', 'upperleg02'):
        return [(f'thigh{side}', 1)]
    if b in ('lowerleg01', 'lowerleg02'):
        return [(f'shin{side}', 1)]
    if b == 'foot':
        return [(f'foot{side}', 1)]
    if b.startswith('toe'):
        return [(f'toes{side}', 1)]
    return [('head', 1)]          # head, jaw, eyes, facial muscles, tongue, special*


def bone_list():
    L = ['root', 'pelvis', 'spine', 'chest', 'neck', 'head', 'hatch']
    for s in 'LR':
        L += [f'upperArm{s}', f'forearm{s}', f'hand{s}']
        for f in ['thumb', 'index', 'middle', 'ring', 'pinky']:
            L += [f'{f}1{s}', f'{f}2{s}', f'{f}3{s}']
        L += [f'thigh{s}', f'shin{s}', f'foot{s}', f'toes{s}']
    return L


BONES = bone_list()
BI = {b: i for i, b in enumerate(BONES)}


# ------------------------------------------------------------------------------------------ io
def load_obj(path, group=None):
    V, VT, F, FT, G = [], [], [], [], []
    g = None
    for line in open(path, encoding='latin1'):
        if line.startswith('v '):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vt '):
            VT.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('g '):
            g = line.split()[1].strip()
        elif line.startswith('f '):
            parts = line.split()[1:]
            vi = [int(p.split('/')[0]) - 1 for p in parts]
            ti = [int(p.split('/')[1]) - 1 if '/' in p and p.split('/')[1] else -1 for p in parts]
            F.append(vi); FT.append(ti); G.append(g)
    return np.array(V, np.float64), np.array(VT, np.float64) if VT else np.zeros((0, 2)), F, FT, G


def load_target(path):
    op = gzip.open if path.endswith('.gz') else open
    idx, d = [], []
    with op(path, 'rt', encoding='latin1') as f:
        for line in f:
            if not line.strip() or line[0] == '#':
                continue
            a = line.split()
            idx.append(int(a[0])); d.append([float(a[1]), float(a[2]), float(a[3])])
    return np.array(idx, int), np.array(d)


def load_mhclo(path):
    """-> dict(obj_file, scales {x:(a,b,d)...}, refs: list of (idx[3], w[3], off[3]), delete set, material)."""
    out = {'scales': {}, 'refs': [], 'delete': set(), 'obj': None, 'material': None, 'zdepth': 50}
    mode = None
    for line in open(path, encoding='latin1'):
        s = line.strip()
        if not s or s.startswith('#'):
            continue
        a = s.split()
        if a[0] == 'verts':
            mode = 'verts'; continue
        if a[0] == 'delete_verts':
            mode = 'delete'; continue
        if mode == 'verts' and re.match(r'^-?\d', a[0]):
            if len(a) == 1:
                out['refs'].append(([int(a[0])] * 3, [1.0, 0, 0], [0, 0, 0]))
            else:
                out['refs'].append(([int(x) for x in a[0:3]], [float(x) for x in a[3:6]], [float(x) for x in a[6:9]]))
            continue
        if mode == 'delete' and re.match(r'^\d', a[0]):
            i = 0
            while i < len(a):
                if i + 2 < len(a) and a[i + 1] == '-':
                    out['delete'].update(range(int(a[i]), int(a[i + 2]) + 1)); i += 3
                else:
                    out['delete'].add(int(a[i])); i += 1
            continue
        # keyword lines (material, ...) may sit between 'verts' and its data: keep the mode
        if a[0] == 'obj_file':
            out['obj'] = a[1]
        elif a[0] in ('x_scale', 'y_scale', 'z_scale'):
            out['scales'][a[0][0]] = (int(a[1]), int(a[2]), float(a[3]))
        elif a[0] == 'material':
            out['material'] = a[1]
        elif a[0] == 'z_depth':
            out['zdepth'] = int(a[1])
    return out


def fit_proxy(clo, X):
    ax = {'x': 0, 'y': 1, 'z': 2}
    sc = np.ones(3)
    for k, (a, b, d) in clo['scales'].items():
        sc[ax[k]] = abs(X[a, ax[k]] - X[b, ax[k]]) / d
    P = []
    for idx, w, off in clo['refs']:
        p = w[0] * X[idx[0]] + w[1] * X[idx[1]] + w[2] * X[idx[2]] + np.array(off) * sc
        P.append(p)
    return np.array(P)


# ------------------------------------------------------------------------------------------ geometry helpers
def tri_split(F, FT, keep=None):
    """Quads / tris -> triangle list of (vertex, uv) corner pairs; keep(face_index) filters faces."""
    T = []
    for i, (f, t) in enumerate(zip(F, FT)):
        if keep is not None and not keep(i):
            continue
        for k in range(1, len(f) - 1):
            T.append(((f[0], t[0]), (f[k], t[k]), (f[k + 1], t[k + 1])))
    return T


def vertex_normals(P, tris):
    N = np.zeros_like(P)
    for a, b, c in tris:
        n = np.cross(P[b] - P[a], P[c] - P[a])
        N[a] += n; N[b] += n; N[c] += n
    ln = np.linalg.norm(N, axis=1, keepdims=True)
    return N / np.maximum(ln, 1e-12)


def build_part(P, UV, tris, W, flip_v=False):
    """Unique (v, vt) corners -> arrays. W: per-vertex dict bone->weight."""
    key = {}
    pos, uv, sidx, swt, idx = [], [], [], [], []
    vtris = [(a[0], b[0], c[0]) for a, b, c in tris]
    N = vertex_normals(P, vtris)
    nrm = []
    for t in tris:
        for v, vt in t:
            k = (v, vt)
            if k not in key:
                key[k] = len(pos)
                pos.append(P[v]); nrm.append(N[v])
                u = UV[vt] if vt >= 0 and len(UV) else (0, 0)
                uv.append((u[0], 1 - u[1] if flip_v else u[1]))
                w = sorted(W[v].items(), key=lambda x: -x[1])[:4]
                tot = sum(x[1] for x in w) or 1
                si = [BI[b] for b, _ in w] + [0] * (4 - len(w))
                sw = [x / tot for _, x in w] + [0] * (4 - len(w))
                q = [int(round(x * 255)) for x in sw]
                q[0] += 255 - sum(q)
                sidx.append(si); swt.append(q)
            idx.append(key[k])
    return {'pos': np.array(pos, np.float32), 'nrm': np.array(nrm, np.float32), 'uv': np.array(uv, np.float32),
            'si': np.array(sidx, np.uint8), 'sw': np.array(swt, np.uint8), 'idx': np.array(idx, np.uint32)}


def proxy_weights(clo, BW):
    out = []
    for idx, w, _ in clo['refs']:
        d = {}
        for i, wi in zip(idx, w):
            if wi <= 0:
                continue
            for b, x in BW[i].items():
                d[b] = d.get(b, 0) + x * wi
        out.append(d or {'pelvis': 1.0})
    return out


# ------------------------------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mh', required=True)
    ap.add_argument('--targets', required=True)
    ap.add_argument('--pack', required=True)
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'public', 'models', 'crew'))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    V, VT, F, FT, G = load_obj(os.path.join(a.mh, '3dobjs', 'base.obj'))
    print('base mesh', V.shape, len(F))
    X = V.copy()
    for name, wgt in (('caucasian-male-young.target.gz', 1.0), ('universal-male-young-maxmuscle-averageweight.target.gz', MUSCLE)):
        i, d = load_target(os.path.join(a.targets, name))
        X[i] += d * wgt
        print('target', name, len(i), 'x', wgt)
    body_faces = [k for k, g in enumerate(G) if g == 'body']
    bverts = sorted({v for k in body_faces for v in F[k]})
    # joints (MakeHuman units: decimetres)
    skel = json.load(open(os.path.join(a.mh, 'rigs', 'default.mhskel')))
    jpos = {j: X[vs].mean(axis=0) for j, vs in skel['joints'].items()}
    head = {b: jpos[d['head']] for b, d in skel['bones'].items()}
    tail = {b: jpos[d['tail']] for b, d in skel['bones'].items()}
    # scale to the stature, soles at 0, midpoint between the ankles at x = z = 0
    ys = X[bverts, 1]
    s = STATURE / (ys.max() - ys.min())
    ank = (head['foot.L'] + head['foot.R']) / 2
    off = np.array([-ank[0], -ys.min(), -ank[2]])
    T = lambda p: (np.asarray(p) + off) * s
    X = T(X)
    head = {k: T(v) for k, v in head.items()}
    tail = {k: T(v) for k, v in tail.items()}
    print('scale', s, 'stature', X[bverts, 1].max())

    # ---------------------------------------------------------------- joints of the astronaut rig
    J = {'root': np.zeros(3), 'pelvis': head['root'], 'spine': head['spine04'], 'chest': head['spine02'], 'neck': head['neck01'], 'head': head['head']}
    J['hatch'] = J['chest'].copy()
    for sd in 'LR':
        J[f'upperArm{sd}'] = head[f'upperarm01.{sd}']; J[f'forearm{sd}'] = head[f'lowerarm01.{sd}']; J[f'hand{sd}'] = head[f'wrist.{sd}']
        for fi, f in enumerate(['thumb', 'index', 'middle', 'ring', 'pinky']):
            for k in range(1, 4):
                J[f'{f}{k}{sd}'] = head[f'finger{fi + 1}-{k}.{sd}']
        J[f'thigh{sd}'] = head[f'upperleg01.{sd}']; J[f'shin{sd}'] = head[f'lowerleg01.{sd}']; J[f'foot{sd}'] = head[f'foot.{sd}']
        J[f'toes{sd}'] = np.mean([head[f'toe{t}-1.{sd}'] for t in range(1, 6)], axis=0)
    eye = (head['eye.L'] + head['eye.R']) / 2 + np.array([0, 0, 0.012])
    # which side is +X?
    left_is_plus_x = J['upperArmL'][0] > 0
    print('L at +X:', left_is_plus_x, 'shoulders', J['upperArmL'], J['upperArmR'], 'eye', eye)

    # ---------------------------------------------------------------- rest frames (rotation matrices, columns X Y Z)
    def frame(yaxis, zhint):
        y = yaxis / np.linalg.norm(yaxis)
        z = zhint - y * np.dot(zhint, y); z /= np.linalg.norm(z)
        x = np.cross(y, z)
        return np.stack([x, y, z], axis=1)
    R = {b: np.eye(3) for b in BONES}
    FWD = np.array([0, 0, 1.0])
    for sd in 'LR':
        R[f'upperArm{sd}'] = frame(J[f'upperArm{sd}'] - J[f'forearm{sd}'], FWD)
        R[f'forearm{sd}'] = frame(J[f'forearm{sd}'] - J[f'hand{sd}'], FWD)
        fdir = J[f'middle1{sd}'] - J[f'hand{sd}']
        thumbside = J[f'index1{sd}'] - J[f'pinky1{sd}']
        R[f'hand{sd}'] = frame(-fdir, thumbside)
        zh = R[f'hand{sd}'][:, 2]
        for fi, f in enumerate(['thumb', 'index', 'middle', 'ring', 'pinky']):
            for k in range(1, 4):
                mb = f'finger{fi + 1}-{k}.{sd}'
                d = tail[mb] - head[mb]
                if f == 'thumb':
                    # thumb: Z = flexion axis analogue (perpendicular to the thumb and the palm normal)
                    palm = -R[f'hand{sd}'][:, 0] * (1 if sd == 'L' else -1)
                    R[f'{f}{k}{sd}'] = frame(-d, np.cross(d, palm) * (1 if sd == 'L' else -1) + 1e-6 * zh)
                else:
                    R[f'{f}{k}{sd}'] = frame(-d, zh)
        R[f'thigh{sd}'] = frame(J[f'thigh{sd}'] - J[f'shin{sd}'], FWD)
        R[f'shin{sd}'] = frame(J[f'shin{sd}'] - J[f'foot{sd}'], FWD)
        fd = J[f'toes{sd}'] - J[f'foot{sd}']; fd[1] = 0
        R[f'foot{sd}'] = frame(np.array([0, 1.0, 0]), fd)
        R[f'toes{sd}'] = R[f'foot{sd}']

    def quat(M):
        m = M
        t = m[0, 0] + m[1, 1] + m[2, 2]
        if t > 0:
            S = np.sqrt(t + 1) * 2; w = 0.25 * S; x = (m[2, 1] - m[1, 2]) / S; y = (m[0, 2] - m[2, 0]) / S; z = (m[1, 0] - m[0, 1]) / S
        elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
            S = np.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2; w = (m[2, 1] - m[1, 2]) / S; x = 0.25 * S; y = (m[0, 1] + m[1, 0]) / S; z = (m[0, 2] + m[2, 0]) / S
        elif m[1, 1] > m[2, 2]:
            S = np.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2; w = (m[0, 2] - m[2, 0]) / S; x = (m[0, 1] + m[1, 0]) / S; y = 0.25 * S; z = (m[1, 2] + m[2, 1]) / S
        else:
            S = np.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2; w = (m[1, 0] - m[0, 1]) / S; x = (m[0, 2] + m[2, 0]) / S; y = (m[1, 2] + m[2, 1]) / S; z = 0.25 * S
        return [float(x), float(y), float(z), float(w)]

    # ---------------------------------------------------------------- skin weights (per base vertex)
    mhw = json.load(open(os.path.join(a.mh, 'rigs', 'default_weights.mhw')))['weights']
    BW = [dict() for _ in range(len(X))]
    for b, lst in mhw.items():
        for tb, fac in map_bone(b):
            for vi, w in lst:
                BW[vi][tb] = BW[vi].get(tb, 0) + w * fac
    for d in BW:
        if not d:
            d['pelvis'] = 1.0

    parts = []
    tex = {}

    def proxy(dirname, clo_name, key, keep_tri=None):
        clo = load_mhclo(os.path.join(a.pack, dirname, clo_name))
        PV, PVT, PF, PFT, _ = load_obj(os.path.join(a.pack, dirname, clo['obj']))
        P = fit_proxy(clo, X / s - off)       # fitting works in MakeHuman units
        P = T(P)
        W = proxy_weights(clo, BW)
        tris = tri_split(PF, PFT)
        part = build_part(P, PVT, tris, W)
        part['key'] = key
        print('proxy', dirname, len(PV), 'verts', len(part['idx']) // 3, 'tris')
        return part, clo, P

    # ---------------------------------------------------------------- clothes first (their delete_verts hide body faces)
    clothes, cclo, CP = proxy('clothes/male_casualsuit06', 'male_casualsuit06.mhclo', 'clothes')
    shoes, sclo, _ = proxy('clothes/shoes05', 'shoes05.mhclo', 'shoes')
    hidden = cclo['delete'] | sclo['delete']
    keep = lambda k: G[k] == 'body' and not all(v in hidden for v in F[k])
    body = build_part(X, VT, tri_split(F, FT, keep), BW)
    body['key'] = 'skin'
    print('body', len(body['idx']) // 3, 'tris (hidden by clothes:', sum(1 for k in body_faces if all(v in hidden for v in F[k])), 'faces)')
    hair, _, _ = proxy('hair/short02', 'short02.mhclo', 'hair')
    brows, _, _ = proxy('eyebrows/eyebrow001', 'eyebrow001.mhclo', 'brows')
    lashes, _, _ = proxy('eyelashes/eyelashes01', 'eyelashes01.mhclo', 'lashes')
    eyes, _, _ = proxy('eyes/high-poly', 'high-poly.mhclo', 'eyes')
    lod2, _, LP = proxy('proxymeshes/proxy741', 'proxy741.proxy', 'lod2')
    # LOD2 region colours (linear): skin / navy shirt / khaki trousers / shoes
    cols = []
    for p in lod2['pos']:
        y, x = p[1], abs(p[0])
        if y < 0.1:
            c = (0.75, 0.75, 0.75)
        elif y < 1.0:
            c = (0.22, 0.21, 0.17)
        elif y < 1.45 and not (x > 0.24 and y < 1.27):
            c = (0.03, 0.045, 0.1)
        else:
            c = (0.6, 0.42, 0.33)
        cols.append(c)
    lod2['col'] = np.array(cols, np.float32)
    for prt in (body, clothes, shoes, hair, brows, lashes, eyes, lod2):
        parts.append(prt)

    # ---------------------------------------------------------------- textures
    def save(img, name, sizes=(2048, 1024), fmt='jpg'):
        for i, sz in enumerate(sizes):
            im = img if img.size[0] == sz else img.resize((sz, sz), Image.LANCZOS)
            suffix = '' if i == 0 else f'_{sz}'
            fn = f'{name}{suffix}.{fmt}'
            if fmt == 'jpg':
                im.convert('RGB').save(os.path.join(a.out, fn), quality=90)
            else:
                im.save(os.path.join(a.out, fn), optimize=True)
            tex.setdefault(name, []).append(fn)
    P = lambda *p: os.path.join(a.pack, *p)
    skin = Image.open(P('skins', 'young_caucasian_male', 'young_lightskinned_male_diffuse.png')).convert('RGB')
    save(skin, 'skin_albedo')
    save(skin_detail_normal(2048), 'skin_normal', fmt='png')
    save(skin_orm(skin), 'skin_orm')
    alb = recolour_clothes(Image.open(P('clothes', 'male_casualsuit06', 'male_casualsuit06_diffuse.png')).convert('RGB'), clothes, CP)
    save(alb, 'clothes_albedo')
    save(Image.open(P('clothes', 'male_casualsuit06', 'male_casualsuit06_normal.png')).convert('RGB').resize((2048, 2048), Image.LANCZOS), 'clothes_normal', fmt='png')
    ao = Image.open(P('clothes', 'male_casualsuit06', 'male_casualsuit06_ao.png')).convert('L').resize((2048, 2048))
    orm = Image.merge('RGB', (ao, Image.new('L', ao.size, 222), Image.new('L', ao.size, 0)))
    save(orm, 'clothes_orm')
    save(Image.open(P('clothes', 'shoes05', 'shoes05_diffuse.png')).convert('RGBA'), 'shoes_albedo', sizes=(1024, 512), fmt='png')
    save(Image.open(P('hair', 'short02', 'short02_diffuse.png')).convert('RGBA').resize((1024, 1024), Image.LANCZOS), 'hair_albedo', sizes=(1024, 512), fmt='png')
    save(Image.open(P('hair', 'short02', 'short02_normal.png')).convert('RGB').resize((1024, 1024), Image.LANCZOS), 'hair_normal', sizes=(1024,), fmt='png')
    save(Image.open(P('eyebrows', 'eyebrow001', 'eyebrow001.png')).convert('RGBA'), 'brows', sizes=(512,), fmt='png')
    save(Image.open(P('eyelashes', 'eyelashes01', 'eyelashes01.png')).convert('RGBA'), 'lashes', sizes=(512,), fmt='png')
    save(Image.open(P('eyes', 'materials', 'brown_eye.png')).convert('RGB'), 'eye', sizes=(1024, 512))

    # ---------------------------------------------------------------- write
    blob = bytearray()
    meta_parts = []
    for prt in parts:
        m = {'key': prt['key'], 'count': int(len(prt['pos'])), 'indices': int(len(prt['idx']))}
        for k, fmt in (('pos', 'f4'), ('nrm', 'f4'), ('uv', 'f4'), ('si', 'u1'), ('sw', 'u1'), ('idx', 'u4'), ('col', 'f4')):
            if k not in prt:
                continue
            while len(blob) % 4:
                blob.append(0)
            m[k] = len(blob)
            blob += prt[k].astype(fmt).tobytes()
        meta_parts.append(m)
    meta = {
        'source': 'MakeHuman hm08 base mesh, default rig weights and system assets (CC0); tools/prepare_human.py',
        'bones': BONES,
        'joints': {b: [round(float(x), 5) for x in J[b]] for b in BONES},
        'rest': {b: quat(R[b]) for b in BONES},
        'eye': [round(float(x), 5) for x in eye],
        'parts': meta_parts,
        'textures': tex,
    }
    open(os.path.join(a.out, 'crew.bin'), 'wb').write(bytes(blob))
    json.dump(meta, open(os.path.join(a.out, 'crew.json'), 'w'), indent=1)
    print('wrote', len(blob), 'bytes;', {p['key']: p['indices'] // 3 for p in meta_parts})


def skin_detail_normal(n):
    """Pores and fine wrinkles tiled over the skin UV atlas (the photo skin has no normal map)."""
    rng = np.random.default_rng(5)
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    h = np.zeros((n, n))
    cells = 640
    c = n / cells
    gi, gj = (x / c).astype(int) % cells, (y / c).astype(int) % cells
    jx = rng.uniform(-0.35, 0.35, (cells, cells)); jy = rng.uniform(-0.35, 0.35, (cells, cells))
    px = (gi + 0.5 + jx[gj, gi]) * c; py = (gj + 0.5 + jy[gj, gi]) * c
    d2 = (x - px) ** 2 + (y - py) ** 2
    h -= np.exp(-d2 / (c * 0.22) ** 2)
    h += 0.25 * rng.standard_normal((n, n))
    h = (2 * h + np.roll(h, 1, 0) + np.roll(h, -1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 1)) / 6
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    k = 0.35
    nx, ny, nz = -dx * k, dy * k, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([nx / ln, ny / ln, nz / ln], -1) * 0.5 + 0.5
    return Image.fromarray((rgb * 255).astype(np.uint8), 'RGB')


def skin_orm(skin):
    a = np.asarray(skin.resize((1024, 1024))).astype(np.float32) / 255
    lum = a.mean(-1)
    red = a[..., 0] - a[..., 1]
    rough = np.clip(0.5 + 0.25 * (0.55 - lum) + 0.2 * np.clip(red - 0.25, 0, 1), 0.35, 0.75)   # lips / creases a little rougher, oily T-zone smoother
    orm = np.stack([np.ones_like(lum), rough, np.zeros_like(lum)], -1)
    return Image.fromarray((orm * 255).astype(np.uint8), 'RGB').resize((2048, 2048))


def recolour_clothes(img, part, P):
    """T-shirt -> navy crew shirt (logo removed), jeans -> khaki-grey trousers. Regions from the UV islands."""
    n = img.size[0]
    a = np.asarray(img).astype(np.float32) / 255
    # rasterise triangles into a region mask: 1 = shirt (above the waist), 2 = trousers
    mask = Image.new('L', (n, n), 0)
    from PIL import ImageDraw
    dr = ImageDraw.Draw(mask)
    idx = part['idx'].reshape(-1, 3)
    for t in idx:
        y = part['pos'][t, 1].mean()
        uv = part['uv'][t]
        pts = [(float(u * n), float((1 - v) * n)) for u, v in uv]
        dr.polygon(pts, fill=1 if y > 1.02 else 2)
    m = np.asarray(mask.filter(ImageFilter.MaxFilter(7)))
    lum = a.mean(-1)
    out = a.copy()
    # shirt: flatten the logo (saturated / dark marks in a light region) to the local cloth shading
    shirt = m == 1
    sat = a.max(-1) - a.min(-1)
    blur = np.asarray(Image.fromarray((lum * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(24))).astype(np.float32) / 255
    logo = shirt & ((sat > 0.08) | (lum < blur - 0.08))
    logo = np.asarray(Image.fromarray(logo.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(9))) > 0
    shade = np.where(logo, blur, lum)
    base = np.median(lum[shirt]) if shirt.any() else 0.8
    navy = np.array([0.13, 0.17, 0.31])     # sRGB
    sh = np.clip(shade / base, 0.6, 1.25)[..., None]
    out[shirt] = (navy[None, None, :] * sh)[shirt]
    # trousers: keep the weave / fade luminance, khaki-grey hue
    tr = m == 2
    tbase = np.median(lum[tr]) if tr.any() else 0.4
    khaki = np.array([0.52, 0.5, 0.41])     # sRGB
    tsh = np.clip(lum / tbase, 0.55, 1.45)[..., None] ** 0.8
    out[tr] = (khaki[None, None, :] * tsh)[tr]
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), 'RGB')


if __name__ == '__main__':
    main()
