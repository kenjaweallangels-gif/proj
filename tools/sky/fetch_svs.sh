#!/bin/sh
# NASA SVS sources for build_milkyway.py (Deep Star Maps 2020, ID 4851) and build_moon.py (CGI Moon Kit, ID 4720).
# Usage: sh tools/sky/fetch_svs.sh <download dir>
D="${1:?download dir}"; mkdir -p "$D/svs_mw" "$D/svs_moon"
B=https://svs.gsfc.nasa.gov/vis/a000000/a004800
curl -sS -L --retry 5 -C - -o "$D/svs_mw/milkyway_2020_8k.exr" $B/a004851/milkyway_2020_8k.exr
curl -sS -L --retry 5 -C - -o "$D/svs_moon/ldem_64_uint.tif" https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_64_uint.tif
curl -sS -L --retry 5 -C - -o "$D/svs_moon/lroc_color_16bit_srgb_16k.tif" https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_16k.tif
