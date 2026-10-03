import json

from conftest import EXAMPLES
from tp_csv_to_json import build, main, num


def test_round_trip_equals_reference(op040):
    assert build(EXAMPLES / "op040_csv") == op040


def test_cli_writes_valid(tmp_path):
    out = tmp_path / "op.json"
    assert main([str(EXAMPLES / "op040_csv"), str(out)]) == 0
    assert json.loads(out.read_text(encoding="utf-8"))["operation"]["id"] == "040"


def test_num_decimal_comma():
    assert num("1,5") == 1.5 and num("30") == 30 and isinstance(num("30"), int) and num("") is None


def test_missing_reference_fails(tmp_path):
    src = EXAMPLES / "op040_csv"
    for f in src.iterdir():
        (tmp_path / f.name).write_bytes(f.read_bytes())
    steps = (tmp_path / "steps.csv").read_text(encoding="utf-8-sig").replace("K204;F1,F2", "K999;F1,F2")
    (tmp_path / "steps.csv").write_text(steps, encoding="utf-8-sig")
    assert main([str(tmp_path), str(tmp_path / "o.json")]) == 1
