#!/usr/bin/env python3
"""List Djangoplicity image-archive search hits: python3 -I dso_search.py <query> [sites]"""
import sys, re, urllib.request, urllib.parse
SITES = {'eso': 'https://www.eso.org/public/images/?search=', 'hub': 'https://esahubble.org/images/?search=',
         'noir': 'https://noirlab.edu/public/images/?search=', 'webb': 'https://esawebb.org/images/?search='}
q = sys.argv[1]; sites = sys.argv[2].split(',') if len(sys.argv) > 2 else list(SITES)
for s in sites:
    try:
        t = urllib.request.urlopen(urllib.request.Request(SITES[s] + urllib.parse.quote(q), headers={'User-Agent': 'Mozilla/5.0'}), timeout=60).read().decode('utf8', 'replace')
    except Exception as e:
        print(s, 'ERR', e); continue
    for m in re.finditer(r"id: '([^']+)',\s*title: '((?:[^'\\]|\\.)*)',\s*width: (\d+),\s*height: (\d+)", t):
        print(f'{s:5s} {m.group(1):14s} {m.group(3):>6s}x{m.group(4):<6s} {m.group(2)[:90]}')
