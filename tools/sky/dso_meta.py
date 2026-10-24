#!/usr/bin/env python3
"""Fetch Djangoplicity image pages (ESO, ESA/Hubble, NOIRLab, ESA/Webb) and extract the astrometric
metadata (reference RA/Dec, WorldWide Telescope reference pixel x/y [screen-size image pixels from the top-left],
scale [arcsec per screen pixel], rotation [180 = north up]; centre RA/Dec as shown on the page, field of view, orientation), the credit line and the download URLs.
Usage: python3 -I dso_meta.py <pagecache dir> <out.json> site:id [site:id ...]
"""
import sys, os, re, json, html, urllib.request
BASE = {'eso': 'https://www.eso.org/public/images/{}/', 'hub': 'https://esahubble.org/images/{}/',
        'noir': 'https://noirlab.edu/public/images/{}/', 'webb': 'https://esawebb.org/images/{}/'}
cache, outp = sys.argv[1], sys.argv[2]
os.makedirs(cache, exist_ok=True)
res = json.load(open(outp)) if os.path.exists(outp) else {}

def get(url, path):
    if not os.path.exists(path):
        t = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=90).read()
        open(path, 'wb').write(t)
    return open(path, encoding='utf8', errors='replace').read()

def text(t):
    t = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', t, flags=re.S)
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', t)))

for key in sys.argv[3:]:
    site, iid = key.split(':')
    t = get(BASE[site].format(iid), os.path.join(cache, f'{site}_{iid}.html'))
    s = text(t)
    def fld(label, pat=r'([^A-Z]+?)(?= [A-Z][a-z]|$)'):
        m = re.search(re.escape(label) + r'\s*' + pat, s)
        return m.group(1).strip() if m else None
    ra = fld('Position (RA):', r'([\d\s\.]+)')
    dec = fld('Position (Dec):', r"([-+−]?\d+°\s*\d+'\s*[\d\.]+\")")
    fov = fld('Field of view:', r'([\d\.]+ x [\d\.]+ (?:arcminutes|degrees|arcseconds))')
    ori = fld('Orientation:', r'(North is [\d\.]+° (?:left|right) of vertical)')
    size = fld('Size:', r'(\d+ x \d+ px)')
    title = re.search(r'<title>(.*?)</title>', t, re.S)
    cm = re.search(r'Credit:\s*</?\w*[^>]*>?(.*?)</(?:p|div)>', t, re.S)
    credit = text(cm.group(1)).strip() if cm else None
    links = sorted(set(re.findall(r'(https?://[^"\'\s>]+/(?:publicationjpg|large|screen|original)/' + re.escape(iid) + r'\.(?:jpg|tif|png))', t)))
    wm = re.search(r'ShowImage\.aspx\?([^"\']+)', t)
    wwt = None
    if wm:
        q = dict(kv.split('=', 1) for kv in html.unescape(wm.group(1)).split('&') if '=' in kv)
        try:
            wwt = {k: float(q[k]) for k in ('ra', 'dec', 'x', 'y', 'scale', 'rotation')}
        except (KeyError, ValueError):
            wwt = None
    res[key] = {'wwt': wwt, 'site': site, 'id': iid, 'title': html.unescape(title.group(1).strip()) if title else None,
                'ra': ra, 'dec': dec, 'fov': fov, 'orientation': ori, 'size': size, 'credit': credit,
                'page': BASE[site].format(iid), 'links': links}
    print(key, '|', ra, '|', dec, '|', fov, '|', ori, '|', size, '|', (credit or '')[:90])
json.dump(res, open(outp, 'w'), indent=1, ensure_ascii=False)
