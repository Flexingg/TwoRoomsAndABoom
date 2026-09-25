#!/usr/bin/env bash
# Reproducible text extraction for the publisher's print-and-play sheets.
#
#   ./tools/extract_sheets.sh [outdir]
#
# Text-layer sheets: pdftotext -layout.
# Image-only sheets: pdftoppm at 300 dpi + rapidocr-onnxruntime OCR, cropped per card.
# Everything is written to outdir (default /tmp/tworooms_extract).
#
# Needs: poppler-utils (pdftotext, pdftoppm), python3.
# For the OCR half: a venv with `rapidocr-onnxruntime` and `pillow`
#   python3 -m venv /tmp/ocrvenv && /tmp/ocrvenv/bin/pip install rapidocr-onnxruntime pillow
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SHEETS="$HERE/printable_files"
OUT="${1:-/tmp/tworooms_extract}"
PY="${OCR_PYTHON:-/tmp/ocrvenv/bin/python}"
mkdir -p "$OUT/text" "$OUT/cards"

echo "== text-layer sheets -> $OUT/text"
for f in "$SHEETS"/*.pdf; do
  base="$(basename "$f" .pdf)"
  pdftotext -layout "$f" "$OUT/text/$base.txt" 2>/dev/null || true
  n=$(tr -d ' \n\f' < "$OUT/text/$base.txt" | wc -c)
  echo "   $(printf '%7d' "$n") chars  $base"
done

IMAGE_ONLY=(
  doc_1705dc200b9a_PnP03
  doc_2aba03f6ef39_PnP05
  doc_56d2b8d6b172_PnP06
  doc_6fded76a7c30_PnP07
  doc_26bab0d9382f_PnP13
  doc_c6006265a1ca_PnP14
  "doc_8ce20318115e_Pnp-Leader Cards-Front"
  "doc_ea303d3b6640_Pnp-Leader Cards-Back"
)
echo "== image-only sheets -> $OUT/cards (OCR)"
if [ ! -x "$PY" ]; then
  echo "   skip: no python at $PY (set OCR_PYTHON=...)"
  exit 0
fi
"$PY" - "$SHEETS" "$OUT/cards" "${IMAGE_ONLY[@]}" <<'PYEOF'
import glob, os, subprocess, sys
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

sheets, out, files = sys.argv[1], sys.argv[2], sys.argv[3:]
engine = RapidOCR()
for f in files:
    src = os.path.join(sheets, f + ".pdf")
    if not os.path.exists(src):
        print("   missing", f); continue
    prefix = os.path.join(out, f.replace(" ", "_"))
    subprocess.run(["pdftoppm", "-png", "-r", "300", src, prefix], check=True)
    for png in sorted(glob.glob(prefix + "*.png")):
        im = Image.open(png)
        ncol, nrow = (2, 1) if "Leader" in f else (4, 2)
        print("==", f, im.size, f"{ncol}x{nrow}")
        for r in range(nrow):
            for c in range(ncol):
                box = (c * im.width // ncol, r * im.height // nrow,
                       (c + 1) * im.width // ncol, (r + 1) * im.height // nrow)
                tile = im.crop(box)
                tile = tile.resize((tile.width * 2, tile.height * 2), Image.LANCZOS)
                tp = f"{prefix}_c{c}r{r}.png"
                tile.save(tp)
                res, _ = engine(tp)
                print(f"   col{c} row{r}: " + " || ".join(t[1] for t in (res or [])))
PYEOF
