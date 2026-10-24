#!/usr/bin/env python3
"""Reference data (small JSON files) for planets, constants, comets and the Apophis 2029 flyby.

Inputs (downloaded by hand into <jpl dir>):
  approx_pos.html           https://ssd.jpl.nasa.gov/planets/approx_pos.html (Standish & Williams; tables 1, 2a, 2b)
  phys_par.html             https://ssd.jpl.nasa.gov/planets/phys_par.html
  sbdb/*.json               https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=<des>&phys-par=1&full-prec=1
  sbdb/cad_apophis.json     https://ssd-api.jpl.nasa.gov/cad.api?des=99942&date-min=2029-01-01&date-max=2029-12-31&dist-max=0.05&body=ALL
  sbdb/horizons_apophis.json  Horizons API, geocentric ICRF state vectors, 2029-04-13 09:00 .. 04-14 09:00 TDB, 10 min
Usage: python3 -I build_refdata.py <jpl dir> <outdir>
"""
import sys, os, re, json, html, glob

src, out = sys.argv[1:3]
os.makedirs(out, exist_ok=True)

def text(p):
    t = open(p, encoding='utf8').read()
    t = re.sub(r'<script.*?</script>', '', t, flags=re.S)
    return html.unescape(re.sub(r'<[^>]+>', ' ', t))

# ------------------------------------------------------------------ JPL approximate positions
s = text(os.path.join(src, 'approx_pos.html'))
NAMES = ['Mercury', 'Venus', 'EM Bary', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']
def table(label, nxt):
    seg = s[s.rindex(label):s.rindex(nxt) if nxt else None]
    rows = {}
    for nm in NAMES:
        m = re.search(re.escape(nm) + r'\s+' + r'\s+'.join([r'(-?[\d\.]+)'] * 12), seg)
        v = [float(x) for x in m.groups()]
        keys = ['a', 'e', 'I', 'L', 'varpi', 'Omega']
        rows[nm] = {k: [v[i], v[6 + i]] for i, k in enumerate(keys)}
    return rows
t1 = table('Table 1', 'Table 2a')
t2a = table('Table 2a', 'Table 2b')
seg = s[s.rindex('Table 2b'):]
t2b = {}
for nm in ['Jupiter', 'Saturn', 'Uranus', 'Neptune']:
    m = re.search(nm + r'\s+' + r'\s+'.join([r'(-?[\d\.]+)'] * 4), seg)
    t2b[nm] = dict(zip(['b', 'c', 's', 'f'], [float(x) for x in m.groups()]))
kep = {
    'source': 'E.M. Standish & J.G. Williams (1992), "Keplerian Elements for Approximate Positions of the Major Planets", '
              'https://ssd.jpl.nasa.gov/planets/approx_pos.html (NASA/JPL Solar System Dynamics). US Government work.',
    'frame': 'heliocentric, mean ecliptic and equinox of J2000; EM Bary = Earth-Moon barycentre',
    'units': {'a': 'au, au/century', 'e': '-, 1/century', 'I': 'deg, deg/century', 'L': 'mean longitude deg, deg/century',
              'varpi': 'longitude of perihelion deg, deg/century', 'Omega': 'longitude of ascending node deg, deg/century'},
    'format': 'each element is [value at J2000, rate per Julian century]',
    'algorithm': [
        'T = (JD_TDB - 2451545.0) / 36525  (Julian centuries from J2000)',
        'element = value + rate * T for a, e, I, L, varpi, Omega',
        'omega = varpi - Omega ;  M = L - varpi + b*T^2 + c*cos(f*T) + s*sin(f*T)  (b,c,s,f only with table 2a, Jupiter..Neptune; angles in deg, f*T in deg)',
        'reduce M to -180..180 deg; solve Kepler M = E - e* sin E with e* = (180/pi) e (degrees): E0 = M + e* sin M; '
        'repeat dM = M - (E - e* sin E); dE = dM / (1 - e cos E); E += dE  until |dE| <= 1e-6 deg',
        "x' = a (cos E - e) ;  y' = a sqrt(1 - e^2) sin E ;  z' = 0",
        "x_ecl = (cos w cos O - sin w sin O cos I) x' + (-sin w cos O - cos w sin O cos I) y'",
        "y_ecl = (cos w sin O + sin w cos O cos I) x' + (-sin w sin O + cos w cos O cos I) y'",
        "z_ecl = (sin w sin I) x' + (cos w sin I) y'",
        'equatorial (ICRF/J2000): x_eq = x_ecl ; y_eq = cos(eps) y_ecl - sin(eps) z_ecl ; z_eq = sin(eps) y_ecl + cos(eps) z_ecl ; eps = 23.43928 deg',
    ],
    'accuracy_1800_2050': {'note': 'nominal errors (heliocentric longitude arcsec, latitude arcsec, distance 1000 km)',
                           'Mercury': [15, 1, 1], 'Venus': [20, 1, 4], 'EM Bary': [20, 8, 6], 'Mars': [40, 2, 25],
                           'Jupiter': [400, 10, 600], 'Saturn': [600, 25, 1500], 'Uranus': [50, 2, 1000], 'Neptune': [10, 1, 200]},
    'table1_1800_2050': t1, 'table2a_3000BC_3000AD': t2a, 'table2b_extra_M_terms': t2b,
    'earth_from_embary': 'Earth = EMB - r_moon_geocentric * GM_moon/(GM_earth+GM_moon) (= 1/82.30057 of the Earth-Moon vector)',
}
json.dump(kep, open(os.path.join(out, 'planets_kepler_jpl.json'), 'w'), indent=1)

# ------------------------------------------------------------------ physical parameters
t = open(os.path.join(src, 'phys_par.html'), encoding='utf8').read()
phys = {}
for row in re.findall(r'<tr.*?</tr>', t, re.S):
    cells = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', c))).strip() for c in re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', row, re.S)]
    if cells and cells[0] in ('Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Ceres', 'Pluto'):
        num = lambda c: float(re.match(r'-?[\d\.]+', c).group())
        phys[cells[0]] = {'radius_eq_km': num(cells[1]), 'radius_mean_km': num(cells[2]),
                          'mass_kg': num(cells[3]) * (1e24 if cells[0] not in ('Ceres', 'Pluto') else 1e18),
                          'density_g_cm3': num(cells[4]), 'sidereal_rotation_d': num(cells[5]),
                          'sidereal_orbit_y': num(cells[6]), 'V10_mag': num(cells[7]), 'geometric_albedo': num(cells[8])}
const = {
    'sources': {
        'GM': 'JPL DE440 (Park et al. 2021, AJ 161:105) via https://ssd.jpl.nasa.gov/astro_par.html',
        'planets': 'https://ssd.jpl.nasa.gov/planets/phys_par.html (JPL SSD physical parameters)',
        'earth': 'IERS Conventions (2010), TN36, table 1.1 (J2 zero-tide, a, 1/f, omega)',
        'moon': 'LOLA/LRO reference radius 1737.4 km (NASA SVS CGI Moon Kit, PDS LOLA products); GM from DE440',
        'sun': 'IAU 2015 Resolution B3 nominal solar radius',
        'pole': 'IAU WGCCRE 2009 report (Archinal et al. 2011, Celest. Mech. Dyn. Astr. 109:101), main terms only (periodic terms omitted)'},
    'au_m': 149597870700, 'c_m_s': 299792458, 'G_SI': 6.67430e-11, 'julian_day_s': 86400, 'julian_century_d': 36525,
    'J2000_JD': 2451545.0, 'obliquity_J2000_arcsec_IAU2006': 84381.406, 'obliquity_J2000_arcsec_IAU1976': 84381.448,
    'GM_km3_s2': {'Sun': 1.32712440041279419e11, 'Mercury': 22031.868551, 'Venus': 324858.592, 'Earth': 398600.435507,
                  'Moon': 4902.800118, 'Mars_system': 42828.375816, 'Jupiter_system': 126712764.1,
                  'Saturn_system': 37940584.8418, 'Uranus_system': 5794556.4, 'Neptune_system': 6836527.10058},
    'earth': {'radius_eq_km': 6378.1366, 'inv_flattening': 298.25642, 'radius_mean_km': 6371.0084, 'J2': 1.0826359e-3,
              'rotation_rad_s': 7.292115e-5, 'sidereal_day_s': 86164.09054, 'note_J2': 'WGS84 uses J2 = 1.08263e-3'},
    'moon': {'radius_mean_km': 1737.4, 'radius_ref_lola_km': 1737.4, 'mean_distance_km': 384400, 'sidereal_month_d': 27.321661,
             'J2_approx': 2.033e-4, 'note': 'Moon J2 approximate (GRAIL gravity fields give ~2.03e-4); synchronous rotation'},
    'sun': {'radius_km': 695700, 'luminosity_W': 3.828e26},
    'planets': phys,
    'pole_orientation_IAU2009': {
        'note': 'alpha0, delta0 in deg (ICRF), T in Julian centuries and d in days from J2000 TDB; W = prime meridian angle deg',
        'Sun': {'alpha0': [286.13, 0], 'delta0': [63.87, 0], 'W': [84.176, 14.1844]},
        'Mercury': {'alpha0': [281.0097, -0.0328], 'delta0': [61.4143, -0.0049], 'W': [329.5469, 6.1385025]},
        'Venus': {'alpha0': [272.76, 0], 'delta0': [67.16, 0], 'W': [160.20, -1.4813688]},
        'Earth': {'alpha0': [0.0, -0.641], 'delta0': [90.0, -0.557], 'W': [190.147, 360.9856235]},
        'Moon': {'alpha0': [269.9949, 0.0031], 'delta0': [66.5392, 0.0130], 'W': [38.3213, 13.17635815],
                 'note': 'periodic terms (up to ~3.6 deg in alpha0, ~1.5 deg in delta0/W) omitted'},
        'Mars': {'alpha0': [317.68143, -0.1061], 'delta0': [52.88650, -0.0609], 'W': [176.630, 350.89198226]},
        'Jupiter': {'alpha0': [268.056595, -0.006499], 'delta0': [64.495303, 0.002413], 'W': [284.95, 870.5360000],
                    'note': 'W = System III; small periodic terms in alpha0/delta0 omitted'},
        'Saturn': {'alpha0': [40.589, -0.036], 'delta0': [83.537, -0.004], 'W': [38.90, 810.7939024]},
        'Uranus': {'alpha0': [257.311, 0], 'delta0': [-15.175, 0], 'W': [203.81, -501.1600928]},
        'Neptune': {'alpha0': [299.36, 0], 'delta0': [43.46, 0], 'W': [249.978, 541.1397757],
                    'note': 'plus 0.70 sin N, -0.51 cos N, -0.48 sin N with N = 357.85 + 52.316 T'}},
    'saturn_rings_km': {'D_inner': 66900, 'C_inner': 74658, 'B_inner': 92000, 'B_outer': 117580, 'Cassini_div': [117580, 122170],
                        'A_inner': 122170, 'Encke_gap': 133589, 'A_outer': 136775, 'F': 140180,
                        'texture_mapping': 'saturn_ring_*.png: r_km = 69700 + u * 71250 (u = 0..1 along the strip, inner edge at u=0)'},
}
json.dump(const, open(os.path.join(out, 'constants.json'), 'w'), indent=1, ensure_ascii=False)

# ------------------------------------------------------------------ comets and asteroids
NOTES = {  # well-known apparition facts (approximate, for flavour)
    '1P': ('1986 return; 2061-Jul-28 next perihelion', 2.1), '2P': ('shortest-period bright comet (3.3 y)', 6),
    '12P': ('2024-Apr perihelion, "devil comet" outbursts', 4.5), '109P': ('1992 return; parent of the Perseids', 5),
    '67P': ('Rosetta target 2014-2016', 9),
    'C/1995 O1': ('Great Comet of 1997, naked-eye for 18 months', -1.0), 'C/1996 B2': ('1996 Mar: passed 0.10 au from Earth, ion tail > 70 deg', 0.0),
    'C/2006 P1': ('Great Comet of 2007, brightest in 40 years, huge striated southern dust tail', -5.5),
    'C/2020 F3': ('July 2020 northern-hemisphere naked-eye comet', 1.0), 'C/2023 A3': ('Oct 2024, forward-scattering peak', -4.9),
    'C/2022 E3': ('green comet, Feb 2023, 0.28 au from Earth', 4.6), 'C/2011 W3': ('Kreutz sungrazer, survived perihelion 2011-Dec-16', -4),
}
def els(d):
    e = {x['name']: x['value'] for x in d['orbit']['elements']}
    f = lambda k: float(e[k]) if e.get(k) not in (None, '') else None
    return {'e': f('e'), 'q_au': f('q'), 'a_au': f('a'), 'i_deg': f('i'), 'node_deg': f('om'), 'peri_deg': f('w'),
            'M_deg': f('ma'), 'tp_jd_tdb': f('tp'), 'period_d': f('per'), 'n_deg_d': f('n')}
comets, asts = [], []
for p in sorted(glob.glob(os.path.join(src, 'sbdb', '*.json'))):
    if 'cad_' in p or 'horizons' in p:
        continue
    d = json.load(open(p))
    o = d['object']
    ent = {'designation': o['des'], 'name': o['fullname'].strip(), 'kind': o.get('kind'),
           'epoch_jd_tdb': float(d['orbit']['epoch']), 'frame': 'heliocentric ecliptic J2000 (JPL SBDB)',
           'orbit_id': d['orbit'].get('orbit_id'), 'moid_earth_au': float(d['orbit']['moid']) if d['orbit'].get('moid') else None,
           'elements': els(d),
           'phys': {x['name']: x['value'] for x in (d.get('phys_par') or [])},
           'source': 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=' + o['des']}
    if o.get('kind', '').startswith('c'):
        key = o['des']
        if key in NOTES:
            ent['apparition'], ent['peak_mag_approx'] = NOTES[key]
        ent['magnitude_law'] = 'm = M1 + 5 log10(delta_au) + K1 log10(r_au)  (M1, K1 in phys when available)'
        comets.append(ent)
    else:
        asts.append(ent)
comets.sort(key=lambda c: c['elements']['tp_jd_tdb'])
json.dump({'note': 'Real comets with JPL SBDB osculating elements (full precision). Long-period orbits are only valid '
                   'near the given epoch / perihelion. Useful for a visible apparition: use q, e, i, node, peri and tp.',
           'comets': comets}, open(os.path.join(out, 'comets.json'), 'w'), indent=1, ensure_ascii=False)

# ------------------------------------------------------------------ Apophis 2029
cad = json.load(open(os.path.join(src, 'sbdb', 'cad_apophis.json')))
cads = [dict(zip(cad['fields'], r)) for r in cad['data']]
hz = json.load(open(os.path.join(src, 'sbdb', 'horizons_apophis.json')))['result']
blk = hz[hz.index('$$SOE') + 5:hz.index('$$EOE')]
vec = []
for line in blk.strip().splitlines():
    c = [x.strip() for x in line.split(',')]
    vec.append([float(c[0])] + [float(x) for x in c[2:8]])
import math
best = min(vec, key=lambda v: math.sqrt(v[1] ** 2 + v[2] ** 2 + v[3] ** 2))
apo = [a for a in asts if a['designation'] == '99942'][0]
AU = 149597870.7
flyby = {
    'object': apo, 'close_approaches_2029': [
        {'body': c['body'], 'time_tdb': c['cd'], 'jd_tdb': float(c['jd']), 'dist_au': float(c['dist']),
         'dist_km': round(float(c['dist']) * AU, 1), 'v_rel_km_s': float(c['v_rel']), 'v_inf_km_s': float(c['v_inf'])}
        for c in cads],
    'closest_sample': {'jd_tdb': best[0], 'r_km': round(math.sqrt(sum(x * x for x in best[1:4])), 1),
                       'altitude_km_above_6378': round(math.sqrt(sum(x * x for x in best[1:4])) - 6378.137, 1)},
    'geocentric_vectors': {'source': 'JPL Horizons API (solution JPL#220, DE441), geometric states, center 500@399, ICRF',
                           'columns': ['jd_tdb', 'x_km', 'y_km', 'z_km', 'vx_km_s', 'vy_km_s', 'vz_km_s'],
                           'step_min': 10, 'data': vec},
    'notes': 'Apophis (~340 m, H 19.09, albedo 0.35, P_rot 30.56 h, tumbling) passes ~38 000 km from Earth centre '
             '(~31 600 km altitude, inside geostationary ring) on 2029-Apr-13 ~21:46 TDB; naked-eye (~mag 3) from Europe/Africa. '
             'Sources: JPL SBDB, CAD API, Horizons; Brozovic et al. 2018 (shape/size).'}
json.dump(flyby, open(os.path.join(out, 'apophis_2029.json'), 'w'), indent=1)
json.dump({'asteroids': asts}, open(os.path.join(out, 'asteroids.json'), 'w'), indent=1)
for f in sorted(os.listdir(out)):
    print(f, os.path.getsize(os.path.join(out, f)) // 1024, 'KB')
print('comets', [c['name'] for c in comets]); print('closest', flyby['closest_sample'], flyby['close_approaches_2029'])
