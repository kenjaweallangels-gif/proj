#!/usr/bin/env python3
"""Пишет Content/Rakis/Data/Barks_Native.csv (BarkID,Line_Native) из barks_native.py; проверяет, что покрыты все BarkID из Barks.csv и арабица собирается."""
import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from barks_native import BARKS_NATIVE  # noqa: E402
from native2ar import to_script  # noqa: E402

D = os.path.join(ROOT, "Content", "Rakis", "Data")
ids = [r["BarkID"] for r in csv.DictReader(open(os.path.join(D, "Barks.csv"), encoding="utf-8"))]
bad = [i for i in ids if i not in BARKS_NATIVE] + [i for i in BARKS_NATIVE if i not in ids]
if bad:
    sys.exit("нет соответствия BarkID: " + ", ".join(bad))
for i in ids:
    to_script(BARKS_NATIVE[i])   # ValueError на недопустимых символах
with open(os.path.join(D, "Barks_Native.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f, lineterminator="\n")
    w.writerow(["BarkID", "Line_Native"])
    for i in ids:
        w.writerow([i, BARKS_NATIVE[i]])
print(f"Barks_Native.csv: {len(ids)} строк")
