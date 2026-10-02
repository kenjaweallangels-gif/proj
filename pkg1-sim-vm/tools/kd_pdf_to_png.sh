#!/usr/bin/env bash
# Листы КД (PDF) → PNG для показа в очках и демо.
#   tools/kd_pdf_to_png.sh КД/АИ.7045.200_СБ.pdf server_data/files/kd 200
# Аргументы: PDF, папка, dpi (по умолчанию 200: лист A3 ≈ 3300×2340 px — читается в очках при зуме).
# Требуется poppler-utils (pdftoppm), ставится в setup/ubuntu/01_install_base.sh.
# После конвертации впишите в kd_sheets.csv uri (kd/<имя>-<N>.png) и рамки позиций [x, y, w, h] в пикселях PNG.
set -euo pipefail
PDF="${1:?PDF}"; OUT="${2:?папка}"; DPI="${3:-200}"
command -v pdftoppm >/dev/null || { echo "Нет pdftoppm: sudo apt install poppler-utils"; exit 1; }
mkdir -p "$OUT"
BASE="$(basename "${PDF%.*}" | tr ' ' '_')"
pdftoppm -r "$DPI" -png "$PDF" "$OUT/$BASE"
ls -1 "$OUT"/"$BASE"*.png
echo "Готово. Размер по осям — см. 'file $OUT/$BASE-1.png'"
