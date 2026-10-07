import cv2

from conftest import EXAMPLES
from make_fallback_glb import main as fallback_main
from make_markers import main as markers_main
from validate_bom import check, glb_nodes


def test_fallback_glb_matches_package(tmp_path, op040):
    out = tmp_path / "m.glb"
    assert fallback_main([str(EXAMPLES / "op040_shelf_bench.json"), str(out)]) == 0
    errors, _ = check(op040, glb_nodes(out), tol_mm=1.0)
    assert errors == []


def test_bom_detects_missing_node(tmp_path, op040):
    out = tmp_path / "m.glb"
    fallback_main([str(EXAMPLES / "op040_shelf_bench.json"), str(out)])
    op040["parts"][0]["node"] = "K204_rev_C"
    errors, _ = check(op040, glb_nodes(out))
    assert any("K204_rev_C" in e for e in errors)


def test_markers_printable_and_detectable(tmp_path):
    assert markers_main(["--package", str(EXAMPLES / "op040_shelf_bench.json"), "--out", str(tmp_path)]) == 0
    img = cv2.imread(str(tmp_path / "op040_marker7.png"), cv2.IMREAD_GRAYSCALE)
    assert img.shape == (3508, 2480)                               # A4 @ 300 dpi
    det = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_6X6_250))
    _, ids, _ = det.detectMarkers(img)
    assert ids is not None and 7 in ids.ravel()
