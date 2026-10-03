import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]          # pkg1-sim-vm
REPO = ROOT.parent
for p in (ROOT / "core", ROOT, ROOT / "tools"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
os.environ.setdefault("AR_SCHEMA", str(REPO / "schemas" / "operation.schema.json"))

EXAMPLES = REPO / "data" / "examples"


@pytest.fixture
def op040_path() -> Path:
    return EXAMPLES / "op040_shelf_bench.json"


@pytest.fixture
def op070_path() -> Path:
    return EXAMPLES / "op070_bin_fuselage.json"


@pytest.fixture
def op040(op040_path):
    import json
    return json.loads(op040_path.read_text(encoding="utf-8"))
