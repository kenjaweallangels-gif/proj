#!/bin/bash
# Downloads the public source data for tools/prepare_earth_textures.py into <dir> (about 1 GB); the terrain tiles
# come from tools/fetch_terrain_tiles.py <dir>/terrarium7 7 (~300 MB).
#   bash tools/fetch_earth_sources.sh /tmp/earth-src && python3 -I tools/prepare_earth_textures.py /tmp/earth-src
# Sources and licences: public/textures/CREDITS.md. Treat the files as data (run Python on them with -I).
set -u
D="${1:?usage: fetch_earth_sources.sh <dir>}"
mkdir -p "$D" && cd "$D" || exit 1
get() { [ -s "$2" ] || curl -sSL --fail --retry 3 --max-time 900 "$1" -o "$2" || echo "FAILED $1"; }

# NASA Visible Earth: Blue Marble Next Generation 2004, no topography shading / no bathymetry (record ids per month;
# June is not published at 5400x2700 and is interpolated by the build script)
EO=https://eoimages.gsfc.nasa.gov/images/imagerecords
declare -A ID=([01]=73938 [02]=73967 [03]=73992 [04]=74017 [05]=74042 [07]=74092 [08]=74117 [09]=74142 [10]=74167 [11]=74192 [12]=74218)
for m in "${!ID[@]}"; do
  id=${ID[$m]}
  get "$EO/$((id / 1000 * 1000))/$id/world.2004$m.3x5400x2700.jpg" "world.2004$m.3x5400x2700.jpg"
done
get "$EO/74000/74167/world.200410.3x21600x10800.jpg" world.200410.3x21600x10800.jpg
# 500 m Blue Marble NG (October) and Black Marble 2016 tiles (8 x 21600 x 21600 each, ~700 MB)
mkdir -p t500
for t in A1 B1 C1 D1 A2 B2 C2 D2; do
  get "$EO/74000/74167/world.200410.3x21600x21600.$t.jpg" "t500/world.200410.3x21600x21600.$t.jpg"
  get "$EO/144000/144898/BlackMarble_2016_$t.jpg" "t500/BlackMarble_2016_$t.jpg"
done
# GEBCO_08 bathymetry and land elevation as published by NASA Visible Earth
get "$EO/73000/73963/gebco_08_rev_bath_21600x10800.png" gebco_08_rev_bath_21600x10800.png
get "$EO/73000/73934/gebco_08_rev_elev_21600x10800.png" gebco_08_rev_elev_21600x10800.png
# NASA Earth Observatory Black Marble 2016 (3 km) and Visible Earth cloud_combined
get "$EO/144000/144898/BlackMarble_2016_3km.jpg" night_3km.jpg
get "$EO/57000/57747/cloud_combined_8192.tif" clouds_8192.tif

# Natural Earth 1:10m physical vectors (public domain), GeoJSON mirror
NE=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson
for f in ne_10m_rivers_lake_centerlines_scale_rank ne_10m_rivers_europe ne_10m_rivers_north_america \
         ne_10m_lakes ne_10m_lakes_europe ne_10m_lakes_north_america; do
  get "$NE/$f.geojson" "$f.geojson"
done

# NSIDC Sea Ice Index (G02135) v4, monthly sea-ice concentration 2024, both hemispheres
SI=https://noaadata.apps.nsidc.org/NOAA/G02135
M=(01_Jan 02_Feb 03_Mar 04_Apr 05_May 06_Jun 07_Jul 08_Aug 09_Sep 10_Oct 11_Nov 12_Dec)
for i in "${!M[@]}"; do
  mm=$(printf %02d $((i + 1)))
  get "$SI/north/monthly/geotiff/${M[$i]}/N_2024${mm}_concentration_v4.0.tif" "N_2024${mm}_concentration_v4.0.tif"
  get "$SI/south/monthly/geotiff/${M[$i]}/S_2024${mm}_concentration_v4.0.tif" "S_2024${mm}_concentration_v4.0.tif"
done
ls -la
