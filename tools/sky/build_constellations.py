#!/usr/bin/env python3
"""Constellation figures, IAU boundaries and names (Latin / genitive / English / Russian) from d3-celestial
(BSD-3-Clause, (c) Olaf Frohn): constellations.json, constellations.lines.json, constellations.borders.json,
constellations.bounds.json.  Coordinates converted to RA 0..360 deg, Dec deg, J2000.

Output constellations.json:
  { "constellations": [ { "id": "And", "la": "Andromeda", "gen": "Andromedae", "en": "Andromeda",
                          "ru": "Андромеда", "rank": 1, "label": [ra, dec],
                          "lines": [[[ra,dec], ...], ...]           # figure polylines (stick figures)
                          "bound": [[ra,dec], ...] } ],             # closed IAU boundary polygon(s)
    "borders": [[[ra,dec],[ra,dec],...], ...] }                     # each boundary segment once (no doubles)
Note: d3-celestial stores the boundaries in J2000 (precessed from the B1875 IAU definitions); long RA-constant
or Dec-constant edges are densified so they can be drawn as great-circle chords without visible error.
Usage: python3 -I build_constellations.py <d3-celestial dir> <out.json>
"""
import sys, os, json, math

src, out = sys.argv[1:3]
L = lambda n: json.load(open(os.path.join(src, n), encoding='utf8'))
names = {f['id']: f for f in L('constellations.json')['features']}
lines = {f['id']: f['geometry']['coordinates'] for f in L('constellations.lines.json')['features']}
bounds = {f['id']: f['geometry'] for f in L('constellations.bounds.json')['features']}
borders = L('constellations.borders.json')['features']

def r(p):
    return [round(p[0] % 360.0, 4), round(p[1], 4)]

def densify(seg, step=2.0):
    """Insert points so that no two consecutive points are more than `step` deg apart in RA or Dec
    (boundaries follow parallels, which are not great circles)."""
    outp = [seg[0]]
    for a, b in zip(seg[:-1], seg[1:]):
        da = ((b[0] - a[0] + 180) % 360) - 180
        dd = b[1] - a[1]
        n = max(1, int(math.ceil(max(abs(da), abs(dd)) / step)))
        for k in range(1, n + 1):
            outp.append([a[0] + da * k / n, a[1] + dd * k / n])
    return [r(p) for p in outp]

res = []
for cid, f in names.items():
    p = f['properties']
    g = bounds.get(cid)
    polys = []
    if g:
        rings = g['coordinates'] if g['type'] == 'Polygon' else [rr for poly in g['coordinates'] for rr in poly]
        polys = [densify(ring) for ring in rings]
    res.append({'id': cid, 'la': p.get('la') or p.get('name'), 'gen': p.get('gen'), 'en': p.get('en'),
                'ru': p.get('ru'), 'rank': int(p.get('rank', 3)), 'label': r(f['geometry']['coordinates']),
                'lines': [[r(q) for q in pl] for pl in lines.get(cid, [])], 'bound': polys})
res.sort(key=lambda c: c['id'])
bl = []
for f in borders:
    g = f['geometry']
    segs = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
    bl += [densify(s) for s in segs]
json.dump({'constellations': res, 'borders': bl}, open(out, 'w', encoding='utf8'), ensure_ascii=False, separators=(',', ':'))
print(out, len(res), 'constellations,', sum(len(c['lines']) for c in res), 'figure polylines,', len(bl),
      'border segments,', os.path.getsize(out) // 1024, 'KB; missing ru:', [c['id'] for c in res if not c['ru']])
