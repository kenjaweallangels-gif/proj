#!/usr/bin/env python3
"""Earth textures for every quality preset (seasonal day imagery, ultra detail tiles, water mask with rivers and
lakes, night lights, bathymetry / land fraction, clouds, relief normals).

Usage: python3 -I tools/prepare_earth_textures.py <source dir> [step ...]
  steps (default: all): months base tiles night water aux clouds normals
  Fetch the sources first with tools/fetch_earth_sources.sh <source dir>.

Sources (see public/textures/CREDITS.md):
  world.2004MM.3x5400x2700.jpg      NASA Blue Marble Next Generation (no topography shading, no bathymetry), monthly
                                    2004, 11 months (June is not published at this size: interpolated May/July)
  world.200410.3x21600x10800.jpg    the same, October, full resolution (500 m)
  gebco_08_rev_bath_21600x10800.png GEBCO_08 bathymetry via NASA Visible Earth (255 = land or < ~30 m, 0 = 8000 m)
  gebco_08_rev_elev_21600x10800.png GEBCO_08 land elevation via NASA Visible Earth (0 = sea level, 255 = 6400 m)
  night_3km.jpg                     NASA Black Marble 2016, 13500x6750
  clouds_8192.tif                   NASA Visible Earth cloud_combined, 8192x4096
  ne_10m_*.geojson                  Natural Earth 1:10m rivers + lake centrelines (scale rank), lakes, and the
                                    Europe / North America supplements
  [NS]_2024MM_concentration_v4.0.tif NSIDC Sea Ice Index (G02135) v4 monthly sea-ice concentration, 25 km polar
                                    stereographic grids, 2024

Outputs (public/textures/earth/):
  season/earth_mMM_4096.jpg   monthly day colour, sea ice from NSIDC composited over the ocean (all GPU presets bake
                              the sim date's two nearest months; 'lite' loads the nearest one)
  earth_base_m10_8192.jpg     October 8K (high/ultra: the seasonal difference of the 4K months is added to it)
  tiles/m10/rRcC.jpg          October 21600x10800 cut into 18-degree tiles of 1080x1080 (rows 1..8 = 72N..72S),
                              streamed around the sub-station point on 'ultra' as a high-pass detail layer
  earth_night_8192.jpg / _4096.jpg   city lights only (Black Marble minus its blue terrain background), grey
  earth_water_8192.png / _4096.png   water fraction per texel: ocean + lakes + rivers (river width by scale rank)
  earth_aux_2048.png          R land fraction (smoothed), G sqrt(ocean depth / 8000 m), B sqrt(land elevation / 6400 m)
  earth_clouds_8192.jpg / _4096.jpg  cloud cover, grey
  earth_normal_4096.jpg / _2048.jpg  tangent-space relief normals (+X east, +Y north), vertical exaggeration 18
"""
import sys, os, json, struct, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
Image.MAX_IMAGE_PIXELS = None

SRC = sys.argv[1]
STEPS = set(sys.argv[2:]) or {'months', 'base', 'tiles', 'night', 'water', 'aux', 'clouds', 'normals'}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'textures', 'earth')
BASE_MONTH = 10


def src(name):
    return os.path.join(SRC, name)


def save(img, name, **kw):
    p = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    img.save(p, **kw)
    print(f'{name}: {img.size} {img.mode} {os.path.getsize(p) // 1024} KB', flush=True)


def srgb_to_lin(a):
    a = a.astype(np.float32) / 255.0
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(a):
    a = np.clip(a, 0.0, 1.0)
    return (np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055) * 255.0 + 0.5).astype(np.uint8)


def latlon_grid(w, h, rows=None):
    """Latitude/longitude (degrees) of texel centres of an equirectangular image (row 0 = north, col 0 = 180W)."""
    r = np.arange(h) if rows is None else rows
    lat = 90.0 - (r + 0.5) * 180.0 / h
    lon = -180.0 + (np.arange(w) + 0.5) * 360.0 / w
    return lat, lon


# ---------------------------------------------------------------- sea ice (NSIDC polar stereographic -> equirect)
def read_nsidc_tiff(path):
    """Minimal reader for the uncompressed 16-bit palette GeoTIFFs of the Sea Ice Index (PIL cannot open them)."""
    b = open(path, 'rb').read()
    off = struct.unpack_from('<I', b, 4)[0]
    n = struct.unpack_from('<H', b, off)[0]
    tags = {}
    for i in range(n):
        tag, typ, cnt, val = struct.unpack_from('<HHII', b, off + 2 + 12 * i)
        if typ == 3 and cnt == 1:
            tags[tag] = [val & 0xFFFF]
        elif typ == 3:
            tags[tag] = struct.unpack_from('<' + 'H' * cnt, b, val if cnt > 2 else off + 2 + 12 * i + 8)
        elif typ == 4 and cnt == 1:
            tags[tag] = [val]
        elif typ == 4:
            tags[tag] = struct.unpack_from('<' + 'I' * cnt, b, val)
        elif typ == 12:
            tags[tag] = struct.unpack_from('<' + 'd' * cnt, b, val)
    w, h = tags[256][0], tags[257][0]
    data = b''.join(b[o:o + c] for o, c in zip(tags[273], tags[279]))
    a = np.frombuffer(data, '<u2')[:w * h].reshape(h, w)
    x0, y0 = tags[33922][3], tags[33922][4]
    return a, x0, y0, tags[33550][0]


def polar_stereo(lat, lon, south):
    """NSIDC polar stereographic (Hughes 1980 ellipsoid, true scale at 70 deg): x, y in metres."""
    a, e = 6378273.0, 0.081816153
    phi_c = math.radians(70.0)
    phi = np.radians(-lat if south else lat)
    lam = np.radians(lon if south else lon + 45.0)
    t = np.tan(np.pi / 4 - phi / 2) / ((1 - e * np.sin(phi)) / (1 + e * np.sin(phi))) ** (e / 2)
    tc = math.tan(math.pi / 4 - phi_c / 2) / ((1 - e * math.sin(phi_c)) / (1 + e * math.sin(phi_c))) ** (e / 2)
    mc = math.cos(phi_c) / math.sqrt(1 - e * e * math.sin(phi_c) ** 2)
    rho = a * mc * t / tc
    if south:
        return rho * np.sin(lam), rho * np.cos(lam)
    return rho * np.sin(lam), -rho * np.cos(lam)


def value_noise(h, w, cell, seed, stretch=1):
    """Smooth value noise (bicubic-upsampled random lattice), [0, 1]; `stretch` elongates it east-west."""
    rng = np.random.default_rng(seed)
    cx = cell * stretch
    gh, gw = max(2, h // cell + 2), max(2, w // cx + 2)
    g = Image.fromarray((rng.random((gh, gw)) * 255).astype(np.uint8), 'L')
    return np.asarray(g.resize((gw * cx, gh * cell), Image.BICUBIC), dtype=np.float32)[:h, :w] / 255.0


def ice_concentration(month, w, h):
    """Sea-ice concentration 0..1 on an equirect grid (w x h), both hemispheres; 0 on land and outside the grids."""
    out = np.zeros((h, w), np.float32)
    lat_all, lon = latlon_grid(w, h)
    for hemi, south in (('N', False), ('S', True)):
        a, x0, y0, px = read_nsidc_tiff(src(f'{hemi}_2024{month:02d}_concentration_v4.0.tif'))
        c = a.astype(np.float32)
        c = np.where(a <= 1000, c / 1000.0, np.where(a == 2510, 1.0, 0.0))     # 2510 = pole hole (ice); land/coast/missing -> 0
        # the coast / land cells (2530/2540) would leave an open-water gap along the shore: fill them from neighbours
        hole = a > 2510
        for _ in range(3):
            nb = np.maximum.reduce([np.roll(c, 1, 0), np.roll(c, -1, 0), np.roll(c, 1, 1), np.roll(c, -1, 1)])
            c = np.where(hole, np.maximum(c, nb), c)
        rows = np.nonzero((lat_all > 39.0) if not south else (lat_all < -39.0))[0]
        lat = lat_all[rows][:, None]
        X, Y = polar_stereo(lat, lon[None, :], south)
        fx = (X - x0) / px - 0.5
        fy = (y0 - Y) / px - 0.5
        ix = np.floor(fx).astype(np.int32); iy = np.floor(fy).astype(np.int32)
        tx = fx - ix; ty = fy - iy
        H, W = c.shape
        def at(yy, xx):
            ok = (xx >= 0) & (xx < W) & (yy >= 0) & (yy < H)
            return np.where(ok, c[np.clip(yy, 0, H - 1), np.clip(xx, 0, W - 1)], 0.0)
        v = (at(iy, ix) * (1 - tx) * (1 - ty) + at(iy, ix + 1) * tx * (1 - ty)
             + at(iy + 1, ix) * (1 - tx) * ty + at(iy + 1, ix + 1) * tx * ty)
        out[rows] = np.maximum(out[rows], v)
    return out


def ocean_mask_fullres():
    """Ocean (1) / land (0) at 21600x10800, uint8 0/255. GEBCO bathymetry < 255 is water; where it saturates
    (land or water shallower than ~30 m) and the land elevation is 0, the October Blue Marble colour decides."""
    bath = np.asarray(Image.open(src('gebco_08_rev_bath_21600x10800.png')))
    elev = np.asarray(Image.open(src('gebco_08_rev_elev_21600x10800.png')).convert('L'))
    day = Image.open(src('world.200410.3x21600x10800.jpg')).convert('RGB')
    out = np.zeros(bath.shape, np.uint8)
    H = bath.shape[0]
    for y0 in range(0, H, 1080):
        y1 = min(H, y0 + 1080)
        rgb = np.asarray(day.crop((0, y0, day.width, y1)), dtype=np.int16)
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        waterish = ((b - r) > 6) | ((r + g + b) < 60) & (b >= r)
        amb = (bath[y0:y1] == 255) & (elev[y0:y1] == 0)
        out[y0:y1] = np.where((bath[y0:y1] < 255) | (amb & waterish), 255, 0)
    return out


def add_sea_ice(rgb_u8, month, ocean):
    """Composite sea ice (NSIDC concentration, broken into floes and leads by noise) over the ocean, linear space."""
    h, w, _ = rgb_u8.shape
    conc = ice_concentration(month, w, h)
    rows = np.nonzero(conc.max(axis=1) > 0)[0]
    if not len(rows):
        return rgb_u8
    r0, r1 = rows.min(), rows.max() + 1
    c = conc[r0:r1]
    hh = r1 - r0
    s = w / 8192.0
    vn = lambda cell, seed, st=1: value_noise(hh, w, max(2, int(cell * s)), seed * 37 + month, st)
    # marginal ice zone: the edge breaks up into floes and wind-drawn bands (elongated east-west)
    n_edge = 0.35 * vn(3, 1, 3) + 0.35 * vn(10, 2, 3) + 0.3 * vn(40, 3, 2)
    cover = np.clip((c - (1.0 - n_edge) * 0.8) * 3.5 + 0.05, 0, 1) * np.clip(c * 5.0, 0, 1)
    cover *= ocean[r0:r1]
    lin = srgb_to_lin(rgb_u8[r0:r1])
    shade = (0.7 + 0.3 * (0.6 * vn(9, 6) + 0.4 * vn(33, 7)))[..., None]
    ice = np.array([0.60, 0.65, 0.72], np.float32) * shade                 # snow-covered pack ice, a little blue-grey
    thin = np.array([0.16, 0.19, 0.24], np.float32)                         # grey nilas / young ice at the margins
    icecol = thin + (ice - thin) * np.clip(c * 1.6 - 0.35, 0, 1)[..., None]
    lin = lin * (1 - cover[..., None]) + icecol * cover[..., None]
    out = rgb_u8.copy()
    out[r0:r1] = lin_to_srgb(lin)
    return out


_ocean_cache = {}
def ocean_at(w, h):
    if (w, h) not in _ocean_cache:
        if 'full' not in _ocean_cache:
            _ocean_cache['full'] = Image.fromarray(ocean_mask_fullres(), 'L')
        _ocean_cache[(w, h)] = np.asarray(_ocean_cache['full'].resize((w, h), Image.BOX), dtype=np.float32) / 255.0
    return _ocean_cache[(w, h)]


# ---------------------------------------------------------------- monthly day colour
def month_image(m):
    if m == 6:   # not published at 5400x2700: average of May and July in linear light
        a = srgb_to_lin(np.asarray(Image.open(src('world.200405.3x5400x2700.jpg')).convert('RGB')))
        b = srgb_to_lin(np.asarray(Image.open(src('world.200407.3x5400x2700.jpg')).convert('RGB')))
        return Image.fromarray(lin_to_srgb(0.5 * (a + b)), 'RGB')
    return Image.open(src(f'world.2004{m:02d}.3x5400x2700.jpg')).convert('RGB')


if 'months' in STEPS:
    oc = ocean_at(4096, 2048)
    for m in range(1, 13):
        img = np.asarray(month_image(m).resize((4096, 2048), Image.LANCZOS))
        img = add_sea_ice(img, m, oc)
        save(Image.fromarray(img, 'RGB'), f'season/earth_m{m:02d}_4096.jpg', quality=88, optimize=True, progressive=True)

if 'base' in STEPS:
    day = Image.open(src(f'world.2004{BASE_MONTH:02d}.3x21600x10800.jpg')).convert('RGB').resize((8192, 4096), Image.LANCZOS)
    img = add_sea_ice(np.asarray(day), BASE_MONTH, ocean_at(8192, 4096))
    save(Image.fromarray(img, 'RGB'), f'earth_base_m{BASE_MONTH:02d}_8192.jpg', quality=90, optimize=True, progressive=True)

if 'tiles' in STEPS:
    day = Image.open(src(f'world.2004{BASE_MONTH:02d}.3x21600x10800.jpg')).convert('RGB')
    T = 1080
    for r in range(1, 9):
        for c in range(20):
            save(day.crop((c * T, r * T, (c + 1) * T, (r + 1) * T)), f'tiles/m{BASE_MONTH:02d}/r{r}c{c}.jpg', quality=84, optimize=True, progressive=True)

# ---------------------------------------------------------------- night lights
if 'night' in STEPS:
    n = np.asarray(Image.open(src('night_3km.jpg')).convert('RGB'), dtype=np.float32) / 255.0
    r, g, b = n[..., 0], n[..., 1], n[..., 2]
    # Black Marble 2016 = warm city lights over a blue moonlit-terrain/ocean background (R ~ 0.6 B): keep the lights only
    excess = r - 0.6 * b
    t = np.clip((excess - 0.015) / 0.12, 0, 1)
    lum = np.maximum(r, g) * t * t * (3 - 2 * t)
    L = Image.fromarray((np.clip(lum, 0, 1) * 255 + 0.5).astype(np.uint8), 'L')
    del n, r, g, b, excess, t, lum
    save(L.resize((8192, 4096), Image.LANCZOS), 'earth_night_8192.jpg', quality=90, optimize=True, progressive=True)
    save(L.resize((4096, 2048), Image.LANCZOS), 'earth_night_4096.jpg', quality=90, optimize=True, progressive=True)

# ---------------------------------------------------------------- water fraction: ocean + lakes + rivers
RIVER_WIDTH_KM = {0: 3.0, 1: 2.5, 2: 2.0, 3: 1.5, 4: 1.1, 5: 0.8, 6: 0.6, 7: 0.45, 8: 0.35, 9: 0.3, 10: 0.22, 11: 0.18, 12: 0.15}

def geo_lines(path, classes):
    d = json.load(open(src(path)))
    for f in d['features']:
        p, g = f['properties'], f['geometry']
        if not g or p.get('featurecla') not in classes:
            continue
        parts = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        for part in parts:
            yield int(p.get('scalerank') or 10), part


def geo_polys(path, classes):
    d = json.load(open(src(path)))
    for f in d['features']:
        p, g = f['properties'], f['geometry']
        if not g or p.get('featurecla') not in classes:
            continue
        polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        for poly in polys:
            yield poly


def rasterise_inland_water(W, H):
    """Lakes (filled polygons, islands cut out) and rivers (lines whose intensity is the width / texel coverage)."""
    lakes = Image.new('L', (W, H), 0)
    rivers = Image.new('L', (W, H), 0)
    dl, dr = ImageDraw.Draw(lakes), ImageDraw.Draw(rivers)
    px = lambda lon, lat: ((lon + 180.0) / 360.0 * W, (90.0 - lat) / 180.0 * H)
    for f in ('ne_10m_lakes.geojson', 'ne_10m_lakes_europe.geojson', 'ne_10m_lakes_north_america.geojson'):
        for poly in geo_polys(f, {'Lake', 'Reservoir', 'Alkaline Lake'}):
            for k, ring in enumerate(poly):
                if len(ring) >= 3:
                    dl.polygon([px(x, y) for x, y in ring], fill=255 if k == 0 else 0)
    km_per_px = 40075.0 / W
    segs = []
    for f in ('ne_10m_rivers_lake_centerlines_scale_rank.geojson', 'ne_10m_rivers_europe.geojson', 'ne_10m_rivers_north_america.geojson'):
        segs += list(geo_lines(f, {'River', 'Canal'}))
    segs.sort(key=lambda s: -s[0])          # draw small rivers first so the big ones win where they meet
    for rank, line in segs:
        wkm = RIVER_WIDTH_KM.get(rank, 0.15)
        lat_mid = sum(p[1] for p in line) / len(line)
        cov = wkm / (km_per_px * max(0.3, math.cos(math.radians(lat_mid))) ** 0.5)   # texels are narrower east-west at high latitude
        width = max(1, int(round(cov)))
        val = int(min(1.0, cov / width) * 255)
        pts = [px(x, y) for x, y in line]
        run = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            if abs(a[0] - b[0]) > W / 2:      # crosses the date line: start a new run
                if len(run) > 1: dr.line(run, fill=val, width=width)
                run = []
            run.append(b)
        if len(run) > 1:
            dr.line(run, fill=val, width=width)
    return lakes, rivers


if 'water' in STEPS:
    SS = 16384
    lakes, rivers = rasterise_inland_water(SS, SS // 2)
    base = srgb_to_lin(np.asarray(Image.open(src(f'world.2004{BASE_MONTH:02d}.3x21600x10800.jpg')).convert('RGB').resize((8192, 4096), Image.BOX)))
    lum8 = base @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    del base
    for w in (8192, 4096):
        h = w // 2
        oc = ocean_at(w, h)
        lk = np.asarray(lakes.resize((w, h), Image.BOX), dtype=np.float32) / 255.0
        rv = np.asarray(rivers.resize((w, h), Image.BOX), dtype=np.float32) / 255.0
        lum = lum8 if w == 8192 else np.asarray(Image.fromarray(lum8).resize((w, h), Image.BOX))
        lk *= np.clip((0.12 - lum) / 0.07, 0, 1)        # dried / salt-crust lake beds (bright in the imagery) are not water
        water = np.maximum(oc, np.clip(lk + rv * 1.6, 0, 1))
        save(Image.fromarray((water * 255 + 0.5).astype(np.uint8), 'L'), f'earth_water_{w}.png', optimize=True)

# ---------------------------------------------------------------- auxiliary low-resolution fields
if 'aux' in STEPS:
    W, H = 2048, 1024
    land = 1.0 - ocean_at(W, H)
    land = np.asarray(Image.fromarray((land * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(2.0)), dtype=np.float32) / 255.0
    bath = Image.open(src('gebco_08_rev_bath_21600x10800.png')).convert('L').resize((W, H), Image.BOX)
    depth = (255.0 - np.asarray(bath, dtype=np.float32)) / 255.0                 # 0..1 of 8000 m
    elev = np.asarray(Image.open(src('gebco_08_rev_elev_21600x10800.png')).convert('L').resize((W, H), Image.BOX), dtype=np.float32) / 255.0
    aux = np.stack([land, np.sqrt(depth), np.sqrt(elev)], axis=-1)
    save(Image.fromarray((aux * 255 + 0.5).astype(np.uint8), 'RGB'), 'earth_aux_2048.png', optimize=True)

# ---------------------------------------------------------------- clouds and relief normals (unchanged from the 8K pass)
if 'clouds' in STEPS:
    clouds = Image.open(src('clouds_8192.tif')).convert('L')
    save(clouds, 'earth_clouds_8192.jpg', quality=88, optimize=True, progressive=True)
    save(clouds.resize((4096, 2048), Image.LANCZOS), 'earth_clouds_4096.jpg', quality=85, optimize=True, progressive=True)

if 'normals' in STEPS:
    elev = Image.open(src('gebco_08_rev_elev_21600x10800.png')).convert('L')
    for W in (4096, 2048):
        h = np.array(elev.resize((W, W // 2), Image.BOX), dtype=np.float32) * (6400.0 / 255.0)   # metres
        H = h.shape[0]
        R = 6371000.0
        lat = (0.5 - (np.arange(H) + 0.5) / H) * np.pi
        dx = (2 * np.pi * R / W) * np.maximum(np.cos(lat), 0.02)[:, None]
        dy = np.pi * R / H
        gx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) / (2 * dx)
        gy = (np.roll(h, 1, axis=0) - np.roll(h, -1, axis=0)) / (2 * dy)       # +north
        ex = 18.0 * (W / 4096.0) ** 0.5                                          # relief is tiny vs the texel size: exaggerate
        nx, ny, nz = -gx * ex, -gy * ex, np.ones_like(h)
        l = np.sqrt(nx * nx + ny * ny + nz * nz)
        nrm = np.stack([nx / l, ny / l, nz / l], axis=-1) * 0.5 + 0.5
        save(Image.fromarray((nrm * 255).clip(0, 255).astype(np.uint8), 'RGB'), f'earth_normal_{W}.jpg', quality=92, optimize=True)


# ================================================================ 500 m tiles and 1 km relief
# 5-degree tiles, rows r = 3..32 (75N..75S), columns c = 0..71 (lon -180 + 5c). Tile file names: rRRcCC.
#   tiles/day/rRRcCC.webp    1200 x 1200 Blue Marble NG October 2004 at 500 m (land / inland water only)
#   tiles/night/rRRcCC.webp  1200 x 1200 Black Marble 2016 at 500 m, city lights only, grey (lit tiles only)
#   tiles/relief/rRRcCC.webp  600 x 600 relief at ~1 km from the AWS Terrain Tiles (zoom 7): R, G = east / north
#                            slope (0.5 + 0.5 sign(s) sqrt(|s| / 2)), B = sqrt(height / 9000 m)  (land tiles only)
#   tiles/manifest.json      the tiles present per layer
#   earth_relief_8192.webp / _2048.webp   the same relief encoding globally
TILE_DEG, ROW0, ROW1 = 5, 3, 33
SRC500 = {('A', 1): (-180, 90), ('B', 1): (-90, 90), ('C', 1): (0, 90), ('D', 1): (90, 90),
          ('A', 2): (-180, 0), ('B', 2): (-90, 0), ('C', 2): (0, 0), ('D', 2): (90, 0)}
MANIFEST = os.path.join(OUT, 'tiles', 'manifest.json')


def manifest_update(layer, ids):
    m = json.load(open(MANIFEST)) if os.path.exists(MANIFEST) else {}
    m['tileDeg'] = TILE_DEG
    m['rows'] = [ROW0, ROW1]
    m[layer] = sorted(ids)
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    json.dump(m, open(MANIFEST, 'w'), separators=(',', ':'))


def tiles_in_source(key):
    lon0, lat0 = SRC500[key]
    for r in range(ROW0, ROW1):
        lat_top = 90 - TILE_DEG * r
        if not (lat0 - 90 < lat_top <= lat0):
            continue
        for c in range(72):
            lon = -180 + TILE_DEG * c
            if lon0 <= lon < lon0 + 90:
                yield r, c, int((lon - lon0) * 240), int((lat0 - lat_top) * 240)


def lights_only(rgb_u8):
    """Black Marble = warm lights over a blue moonlit-terrain / ocean background (R ~ 0.6 B): keep the lights."""
    n = rgb_u8.astype(np.float32) / 255.0
    excess = n[..., 0] - 0.6 * n[..., 2]
    t = np.clip((excess - 0.015) / 0.12, 0, 1)
    return np.clip(np.maximum(n[..., 0], n[..., 1]) * t * t * (3 - 2 * t), 0, 1)


if 'day500' in STEPS:
    os.makedirs(os.path.join(OUT, 'tiles', 'day'), exist_ok=True)
    water = np.asarray(Image.open(os.path.join(OUT, 'earth_water_8192.png')), dtype=np.float32) / 255.0
    ids = []
    for key in SRC500:
        img = Image.open(src(f't500/world.200410.3x21600x21600.{key[0]}{key[1]}.jpg')).convert('RGB')
        for r, c, x, y in tiles_in_source(key):
            # any land or inland water in the tile (water fraction < 1)?
            wr0 = int(TILE_DEG * r / 180 * 4096); wc0 = int(c * TILE_DEG / 360 * 8192)
            blk = water[wr0:wr0 + 114, wc0:wc0 + 114]
            if blk.size == 0 or blk.min() > 0.98:
                continue
            img.crop((x, y, x + 1200, y + 1200)).save(os.path.join(OUT, 'tiles', 'day', f'r{r:02d}c{c:02d}.webp'), quality=80, method=6)
            ids.append(r * 100 + c)
        print('day500', key, len(ids), flush=True)
        del img
    manifest_update('day', ids)

if 'night500' in STEPS:
    os.makedirs(os.path.join(OUT, 'tiles', 'night'), exist_ok=True)
    glob8k = np.zeros((4096, 8192), np.float32)
    ids = []
    for key in SRC500:
        img = Image.open(src(f't500/BlackMarble_2016_{key[0]}{key[1]}.jpg')).convert('RGB')
        lon0, lat0 = SRC500[key]
        lights = np.zeros((21600, 21600), np.uint8)
        for y0 in range(0, 21600, 2700):
            lights[y0:y0 + 2700] = (lights_only(np.asarray(img.crop((0, y0, 21600, y0 + 2700)))) * 255 + 0.5).astype(np.uint8)
        del img
        L = Image.fromarray(lights, 'L')
        # global 8K: area average of the 500 m lights (display units, like the source)
        g = np.asarray(L.resize((2048, 2048), Image.BOX), dtype=np.float32) / 255.0
        gx0 = int((lon0 + 180) / 360 * 8192); gy0 = int((90 - lat0) / 180 * 4096)
        glob8k[gy0:gy0 + 2048, gx0:gx0 + 2048] = g
        for r, c, x, y in tiles_in_source(key):
            t = lights[y:y + 1200, x:x + 1200]
            if t.max() < 12:
                continue
            Image.fromarray(t, 'L').save(os.path.join(OUT, 'tiles', 'night', f'r{r:02d}c{c:02d}.webp'), quality=82, method=6)
            ids.append(r * 100 + c)
        print('night500', key, len(ids), flush=True)
        del lights, L
    manifest_update('night', ids)
    G = Image.fromarray((np.clip(glob8k, 0, 1) * 255 + 0.5).astype(np.uint8), 'L')
    save(G, 'earth_night_8192.jpg', quality=90, optimize=True, progressive=True)
    save(G.resize((4096, 2048), Image.BOX), 'earth_night_4096.jpg', quality=90, optimize=True, progressive=True)


def enc_slope(g):
    return 0.5 + 0.5 * np.sign(g) * np.sqrt(np.minimum(np.abs(g), 2.0) / 2.0)


def relief_rgb(h, dx, dy):
    """h: heights (m) with a 1-texel margin; dx (per row, column vector) / dy: texel sizes in metres. -> uint8 RGB."""
    gx = (h[1:-1, 2:] - h[1:-1, :-2]) / (2 * dx)
    gy = (h[:-2, 1:-1] - h[2:, 1:-1]) / (2 * dy)               # +north
    hb = np.sqrt(np.clip(h[1:-1, 1:-1], 0, 9000) / 9000.0)
    return (np.stack([enc_slope(gx), enc_slope(gy), hb], -1) * 255 + 0.5).clip(0, 255).astype(np.uint8)


if 'relief' in STEPS:
    TZ = 7
    NT = 1 << TZ
    TD = src(f'terrarium{TZ}')
    cache = {}

    def terr(x, y):
        k = (x % NT, y)
        if k not in cache:
            f = os.path.join(TD, f'{TZ}_{k[0]}_{k[1]}.png')
            if os.path.exists(f) and os.path.getsize(f) > 0:
                a = np.asarray(Image.open(f).convert('RGB'), dtype=np.float32)
                cache[k] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
            else:
                cache[k] = None
            if len(cache) > 800:
                cache.pop(next(iter(cache)))
        return cache[k]

    def sample_merc(lat, lon):
        """Bilinear terrarium height (m) at arrays of lat / lon (deg); NaN where no tile."""
        X = (lon + 180.0) / 360.0 * NT * 256 - 0.5
        Y = (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * NT * 256 - 0.5
        x0 = np.floor(X).astype(np.int64); y0 = np.floor(Y).astype(np.int64)
        fx = (X - x0).astype(np.float32); fy = (Y - y0).astype(np.float32)

        def at(xx, yy):
            v = np.full(xx.shape, np.nan, np.float32)
            tx, ty = (xx // 256) % NT, yy // 256
            for a in np.unique(tx):
                for b in np.unique(ty):
                    t = terr(int(a), int(b))
                    if t is None:
                        continue
                    m = (tx == a) & (ty == b)
                    if m.any():
                        v[m] = t[yy[m] % 256, xx[m] % 256]
            return v
        return (at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy)
                + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy)

    os.makedirs(os.path.join(OUT, 'tiles', 'relief'), exist_ok=True)
    # global height at 24 px/deg (8640 x 4320); GEBCO_08 land elevation where no terrain tile exists
    gH = np.asarray(Image.open(src('gebco_08_rev_elev_21600x10800.png')).convert('L').resize((8640, 4320), Image.BOX), dtype=np.float32) * (6400.0 / 255.0)
    ids = []
    P = 120 * TILE_DEG          # 600 px per tile (120 px/deg, ~0.93 km)
    Rm = 6371000.0
    dy = np.pi * Rm / (180 * 120)
    for r in range(ROW0, ROW1):
        lat_top = 90 - TILE_DEG * r
        lat = lat_top - (np.arange(-1, P + 1) + 0.5) / 120.0
        dx = (2 * np.pi * Rm / (360 * 120)) * np.maximum(np.cos(np.radians(lat[1:-1])), 0.02)[:, None]
        for c in range(72):
            lon0 = -180 + TILE_DEG * c
            tf = os.path.join(OUT, 'tiles', 'relief', f'r{r:02d}c{c:02d}.webp')
            if 'reuse' in STEPS and os.path.exists(tf):
                # rebuild the global grid from an existing tile (height channel)
                b = np.asarray(Image.open(tf).convert('RGB'), dtype=np.float32)[..., 2] / 255.0
                ids.append(r * 100 + c)
                gy0, gx0 = (90 - lat_top) * 24, (lon0 + 180) * 24
                gH[gy0:gy0 + 120, gx0:gx0 + 120] = (b * b * 9000.0).reshape(120, 5, 120, 5).mean(axis=(1, 3))
                continue
            if 'reuse' in STEPS:
                continue
            lon = lon0 + (np.arange(-1, P + 1) + 0.5) / 120.0
            LA, LO = np.meshgrid(lat, lon, indexing='ij')
            h = sample_merc(LA, LO)
            if np.isnan(h).all():
                continue
            h = np.where(np.isnan(h), 0.0, np.maximum(h, 0.0)).astype(np.float32)
            if h.max() < 1.0:
                continue
            Image.fromarray(relief_rgb(h, dx, dy), 'RGB').save(os.path.join(OUT, 'tiles', 'relief', f'r{r:02d}c{c:02d}.webp'), quality=88, method=6)
            ids.append(r * 100 + c)
            hb = h[1:-1, 1:-1].reshape(120, 5, 120, 5).mean(axis=(1, 3))
            gy0, gx0 = (90 - lat_top) * 24, (lon0 + 180) * 24
            gH[gy0:gy0 + 120, gx0:gx0 + 120] = hb
        print('relief row', r, len(ids), flush=True)
    manifest_update('relief', ids)
    for W in (8192, 2048):
        Hg = np.asarray(Image.fromarray(gH).resize((W, W // 2), Image.BOX), dtype=np.float32)
        Hp = np.pad(Hg, ((1, 1), (1, 1)), mode='edge')
        Hp[1:-1, 0] = Hg[:, -1]; Hp[1:-1, -1] = Hg[:, 0]
        latg = 90 - (np.arange(W // 2) + 0.5) * 360 / W
        dxg = (2 * np.pi * Rm / W) * np.maximum(np.cos(np.radians(latg)), 0.02)[:, None]
        save(Image.fromarray(relief_rgb(Hp, dxg, 2 * np.pi * Rm / W), 'RGB'), f'earth_relief_{W}.webp', quality=90, method=6)
