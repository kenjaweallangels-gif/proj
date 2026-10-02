"""STEP → GLB на маленькой сборке (tests/data/two_brackets.step: K204 и K205, CAD Z-up, мм).
Файл сгенерирован tools/make_test_step.py (нужен cadquery-ocp, в requirements не входит)."""
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("cascadio")
from step_to_glb import convert  # noqa: E402
from validate_bom import glb_nodes  # noqa: E402

STEP = Path(__file__).parent / "data" / "two_brackets.step"


def test_names_units_axes(tmp_path):
    out = tmp_path / "a.glb"
    convert(STEP, out, deflection_mm=0.1, up="z")
    nodes = glb_nodes(out)
    assert set(nodes) == {"K204", "K205"}
    # CAD: центр K204 (−400, 120, 65) мм, Z вверх → glTF Y вверх: (x, z, −y)
    np.testing.assert_allclose(nodes["K204"], [-400, 65, -120], atol=0.5)
    np.testing.assert_allclose(nodes["K205"], [400, 65, -120], atol=0.5)


def test_up_y_keeps_axes(tmp_path):
    out = tmp_path / "b.glb"
    convert(STEP, out, up="y")
    np.testing.assert_allclose(glb_nodes(out)["K204"], [-400, 120, 65], atol=0.5)
