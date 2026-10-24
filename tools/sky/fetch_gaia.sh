#!/bin/bash
# Fetch a magnitude-limited Gaia DR3 extract via the ESA Gaia archive TAP service (async jobs, anonymous).
# Output: CSV files in $OUT (one per declination band) + Tycho-2/Hipparcos cross-match lists.
OUT=${1:?outdir}
TAP=https://gea.esac.esa.int/tap-server/tap
run() { # name query
  local name=$1 q=$2
  [ -s "$OUT/$name.csv" ] && { echo "skip $name"; return; }
  loc=$(curl -sS -i "$TAP/async" --data-urlencode "REQUEST=doQuery" --data-urlencode "LANG=ADQL" \
        --data-urlencode "FORMAT=csv" --data-urlencode "PHASE=RUN" --data-urlencode "MAXREC=5000000" --data-urlencode "QUERY=$q" | tr -d '\r' | awk '/^[Ll]ocation:/{print $2; exit}')
  echo "$name job $loc"
  while true; do
    ph=$(curl -sS "$loc/phase"); echo "  $name $ph"
    case $ph in COMPLETED) break;; ERROR|ABORTED) curl -sS "$loc/error"; return 1;; esac
    sleep 10
  done
  curl -sS -L --retry 5 -o "$OUT/$name.part" "$loc/results/result" && mv "$OUT/$name.part" "$OUT/$name.csv"
  wc -l "$OUT/$name.csv"
}
COLS="g.source_id, g.ra, g.dec, g.pmra, g.pmdec, g.phot_g_mean_mag AS g, g.bp_rp"
run hip_xm "SELECT source_id, original_ext_source_id AS hip, angular_distance FROM gaiadr3.hipparcos2_best_neighbour"

bands=(-90 -50 -30 -15 0 15 30 50 90)
for i in 0 1 2 3 4 5 6 7; do
  lo=${bands[$i]}; hi=${bands[$((i+1))]}
  run "g12_${i}" "SELECT $COLS, t.original_ext_source_id AS tyc FROM gaiadr3.gaia_source AS g LEFT OUTER JOIN gaiadr3.tycho2tdsc_merge_best_neighbour AS t ON g.source_id=t.source_id WHERE g.phot_g_mean_mag < 12 AND g.dec >= $lo AND g.dec < $hi"
done
# Tycho-2 stars fainter than G=12 (needed so the catalogue is the complete HIP+TYC set, the complement of the
# SVS milkyway_2020 map). Banded to stay below the 60 s anonymous execution limit.
for i in 0 1 2 3 4 5 6 7; do
  lo=${bands[$i]}; hi=${bands[$((i+1))]}
  run "tycf_${i}" "SELECT $COLS, t.original_ext_source_id AS tyc FROM gaiadr3.tycho2tdsc_merge_best_neighbour AS t JOIN gaiadr3.gaia_source AS g ON g.source_id=t.source_id WHERE g.phot_g_mean_mag >= 12 AND g.dec >= $lo AND g.dec < $hi"
done
echo GAIADONE
# retry: split any Tycho-faint band that hit the 60 s limit into 4 sub-bands
for i in 0 1 2 3 4 5 6 7; do
  [ -s "$OUT/tycf_${i}.csv" ] && continue
  lo=${bands[$i]}; hi=${bands[$((i+1))]}
  for k in 0 1 2 3; do
    a=$(python3 -c "print($lo+($hi-($lo))*$k/4)"); b=$(python3 -c "print($lo+($hi-($lo))*($k+1)/4)")
    run "tycf_${i}_${k}" "SELECT $COLS, t.original_ext_source_id AS tyc FROM gaiadr3.tycho2tdsc_merge_best_neighbour AS t JOIN gaiadr3.gaia_source AS g ON g.source_id=t.source_id WHERE g.phot_g_mean_mag >= 12 AND g.dec >= $a AND g.dec < $b"
  done
done
echo RETRYDONE
