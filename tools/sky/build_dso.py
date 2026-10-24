#!/usr/bin/env python3
"""Deep-sky catalogue: all Messier objects + the brightest non-Messier NGC/IC objects + a few named
addendum objects (LMC, Hyades, Double Cluster, Coalsack, ...), from OpenNGC (CC BY-SA 4.0, Mattia Verga),
with English/Russian common names from d3-celestial dsonames.json (BSD-3, O. Frohn).

Usage: python3 -I build_dso.py <OpenNGC dir> <d3-celestial dir> <out.json> [N_extra=60]
Output: JSON list sorted by Messier number then magnitude. Fields:
  id        display id ("M31", "NGC 5139", "LMC")      ngc  NGC/IC designation if any
  m         Messier number or null                     type OpenNGC type code (G, GCl, OCl, PN, HII, EmN, ...)
  ra, dec   J2000 degrees                              con  constellation
  maj, min  apparent major/minor axis, arcmin (null if unknown)
  pa        position angle of the major axis, degrees from north through east (null if unknown)
  v, b      V / B magnitudes (null if unknown)         sb   surface brightness (B mag/arcsec^2, galaxies)
  hubble    morphological type (galaxies)              name common English name(s); ru Russian name
"""
import sys, csv, json, os, re

ngc_dir, d3c_dir, out = sys.argv[1:4]
N_EXTRA = int(sys.argv[4]) if len(sys.argv) > 4 else 60
rows = []
for fn in ('NGC.csv', 'addendum.csv'):
    with open(os.path.join(ngc_dir, fn), newline='', encoding='utf8') as fh:
        for r in csv.DictReader(fh, delimiter=';'):
            r['_file'] = fn
            rows.append(r)
by_name = {r['Name']: r for r in rows}
dnames = json.load(open(os.path.join(d3c_dir, 'dsonames.json'), encoding='utf8'))

def hms(s):
    h, m, x = s.split(':'); return (int(h) + int(m) / 60 + float(x) / 3600) * 15
def dms(s):
    sg = -1 if s.startswith('-') else 1
    d, m, x = s.lstrip('+-').split(':'); return sg * (int(d) + int(m) / 60 + float(x) / 3600)
def f(x):
    try: return float(x)
    except (TypeError, ValueError): return None
def pretty(name):
    m = re.match(r'^(NGC|IC)0*(\d+)(.*)$', name)
    return f'{m.group(1)} {m.group(2)}{m.group(3)}' if m else name
TYPE_NAMES = {'*': 'star', '**': 'double star', '*Ass': 'stellar association', 'OCl': 'open cluster',
              'GCl': 'globular cluster', 'Cl+N': 'cluster with nebula', 'G': 'galaxy', 'GPair': 'galaxy pair',
              'GTrpl': 'galaxy triplet', 'GGroup': 'galaxy group', 'PN': 'planetary nebula', 'HII': 'HII region',
              'DrkN': 'dark nebula', 'EmN': 'emission nebula', 'Neb': 'nebula', 'RfN': 'reflection nebula',
              'SNR': 'supernova remnant', 'Nova': 'nova', 'Other': 'other'}

def resolve(r):
    """Follow 'Dup' entries to the master object, keep the Messier number."""
    if r['Type'] == 'Dup':
        for col, pre in (('NGC', 'NGC'), ('IC', 'IC')):
            if r[col]:
                num = re.match(r'\d+', r[col]).group()
                k = f'{pre}{int(num):04d}' + r[col][len(num):]
                if k in by_name:
                    mm = r['M']
                    r = dict(by_name[k]); r['M'] = r['M'] or mm
                    return r
    return r

def entry(r):
    r = resolve(r)
    m = int(r['M']) if r['M'] else None
    name = pretty(r['Name'])
    ngc = name if name.startswith(('NGC', 'IC')) else None
    common = [c for c in (r['Common names'] or '').split(',') if c]
    dn = dnames.get(ngc or '', {}) or dnames.get(f'M {m}' if m else '', {})
    e = {'id': f'M{m}' if m else (ngc or common[0] if common else name), 'ngc': ngc, 'm': m,
         'type': r['Type'], 'typeName': TYPE_NAMES.get(r['Type'], r['Type']),
         'ra': round(hms(r['RA']), 5), 'dec': round(dms(r['Dec']), 5), 'con': r['Const'],
         'maj': f(r['MajAx']), 'min': f(r['MinAx']), 'pa': f(r['PosAng']),
         'v': f(r['V-Mag']), 'b': f(r['B-Mag']), 'sb': f(r['SurfBr']), 'hubble': r['Hubble'] or None,
         'name': ', '.join(common) or dn.get('name'), 'ru': dn.get('ru'), 'src': r['_file'] + ':' + r['Name']}
    return {k: v for k, v in e.items() if v not in (None, '')}

objs, seen = [], set()
for r in rows:
    if r['M']:
        e = entry(r)
        if e['m'] not in seen:
            seen.add(e['m']); objs.append(e)
if 102 not in seen and 'NGC5866' in by_name:   # M102 = NGC 5866 (the usual identification; OpenNGC leaves it blank)
    r = dict(by_name['NGC5866']); r['M'] = '102'; e = entry(r); seen.add(102); objs.append(e)
missing = sorted(set(range(1, 111)) - seen)
print('Messier found', len(seen), 'missing', missing)

def bright_mag(r):
    v, b = f(r['V-Mag']), f(r['B-Mag'])
    return v if v is not None else (b - 0.8 if b is not None else 99)
skip = {'*', '**', 'Dup', 'NonEx', 'Other', 'Nova'}
mess_srcs = {o['src'] for o in objs}
cands = [r for r in rows if r['_file'] == 'NGC.csv' and not r['M'] and r['Type'] not in skip]
cands.sort(key=bright_mag)
extra = []
for r in cands:
    e = entry(r)
    if e['src'] in mess_srcs or bright_mag(r) > 10.5:
        continue
    extra.append(e)
    if len(extra) >= N_EXTRA:
        break
# named showpieces without a (bright) magnitude in OpenNGC or living in the addendum
want = ['ESO056-115', 'C041', 'C014', 'C099', 'B033', 'Cl399', 'C009', 'ESO351-030', 'ESO356-004',
        'NGC3372', 'NGC2070', 'NGC5139', 'NGC0104', 'NGC0292', 'NGC4755', 'NGC7293', 'NGC6543', 'NGC2237',
        'NGC2244', 'NGC0869', 'NGC0884', 'NGC5128', 'NGC0253', 'NGC0055', 'NGC0300', 'NGC2264', 'NGC7000',
        'NGC6960', 'NGC6992', 'NGC1499', 'IC0434', 'NGC3242', 'NGC6826', 'NGC0457', 'NGC2392', 'NGC1300',
        'NGC4565', 'NGC891', 'NGC6397', 'NGC6752', 'NGC3532', 'IC2602', 'NGC2516', 'NGC6231']
have = {o['src'] for o in objs + extra}
for k in want:
    k2 = k if k in by_name else re.sub(r'^(NGC|IC)(\d+)$', lambda m: f'{m.group(1)}{int(m.group(2)):04d}', k)
    r = by_name.get(k2)
    if r is None:
        print('not found', k); continue
    e = entry(r)
    if e['src'] not in have:
        extra.append(e); have.add(e['src'])
if not any(o.get('ngc') == 'NGC 2070' for o in extra):
    pass
for e in extra:
    if e['src'] == 'addendum.csv:ESO056-115': e['id'] = 'LMC'; e['ru'] = 'Большое Магелланово Облако'
    if e['src'] == 'NGC.csv:NGC0292': e['id'] = 'SMC'; e['ru'] = e.get('ru') or 'Малое Магелланово Облако'
objs.sort(key=lambda o: o['m'])
extra.sort(key=lambda o: o.get('v', o.get('b', 99) - 0.8))
allo = objs + extra
for o in allo:
    o.pop('src', None)
json.dump(allo, open(out, 'w', encoding='utf8'), ensure_ascii=False, indent=0, separators=(',', ':'))
print('wrote', out, len(allo), 'objects (', len(objs), 'Messier,', len(extra), 'others )', os.path.getsize(out) // 1024, 'KB')
print('no size:', [o['id'] for o in allo if 'maj' not in o])
print('no ru:', len([o for o in allo if 'ru' not in o]))
