import copy

import jsonschema
import numpy as np
import pytest

from arcore.io.package import load_package, validate


@pytest.mark.parametrize("name", ["op040_path", "op070_path"])
def test_examples_valid(name, request):
    pkg = load_package(request.getfixturevalue(name))
    assert pkg.steps and pkg.markers()


def test_markers_in_meters(op040_path):
    m = {x.id: x for x in load_package(op040_path).markers()}
    assert m[7].size_m == pytest.approx(0.08)
    np.testing.assert_allclose(m[7].T_op_marker[:3, 3], [-0.6, 0.001, -0.26])


def test_check_distance(op040_path):
    a, b, nominal, tol = load_package(op040_path).check_distance_m()
    assert np.linalg.norm(b - a) == pytest.approx(nominal)
    assert tol == pytest.approx(0.0015)


def test_bad_reference_rejected(op040):
    bad = copy.deepcopy(op040)
    bad["steps"][1]["parts"] = ["NOPE"]
    with pytest.raises(ValueError, match="нет детали NOPE"):
        validate(bad)


def test_bad_kind_rejected(op040):
    bad = copy.deepcopy(op040)
    bad["steps"][0]["kind"] = "dance"
    with pytest.raises(jsonschema.ValidationError):
        validate(bad)


def test_step_order(op040):
    bad = copy.deepcopy(op040)
    bad["steps"][2]["n"] = 1
    with pytest.raises(ValueError, match="по возрастанию"):
        validate(bad)
