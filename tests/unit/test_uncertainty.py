"""
================================================================================
FILE: test_uncertainty.py
MODULE: tests/unit/
PURPOSE: Unit tests for SobolAnalyzer, OATAnalyzer, and compute_uncertainty
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-25
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import numpy as np
import pytest

from app.ml.models.gpr_model import GPRModel
from app.ml.models.linear_model import LinearModel
from app.ml.models.rf_model import RFModel
from app.ml.sensitivity.global_sensitivity import SobolAnalyzer
from app.ml.sensitivity.one_at_a_time import OATAnalyzer
from app.ml.uncertainty.bootstrap import compute_uncertainty


# ─── CONSTANTS ────────────────────────────────────────────────────────────────

INPUT_COLS   = ["a", "b", "c"]
INPUT_1COL   = ["a"]
OUTPUT_COLS  = ["y"]
OUTPUT_COLS2 = ["y1", "y2"]


# ─── FIXTURES ─────────────────────────────────────────────────────────────────


@pytest.fixture()
def xy_3in_1out():
    """40-row 3-input 1-output dataset."""
    rng = np.random.default_rng(42)
    X = rng.uniform(0.0, 1.0, (40, 3))
    y = 3.0 * X[:, 0] + 1.5 * X[:, 1] + 0.1 * rng.standard_normal(40)
    return X, y.reshape(-1, 1)


@pytest.fixture()
def xy_3in_2out():
    """40-row 3-input 2-output dataset."""
    rng = np.random.default_rng(7)
    X = rng.uniform(0.0, 1.0, (40, 3))
    y1 = 3.0 * X[:, 0] + 0.1 * rng.standard_normal(40)
    y2 = -2.0 * X[:, 1] + 0.1 * rng.standard_normal(40)
    return X, np.column_stack([y1, y2])


@pytest.fixture()
def xy_1in_1out():
    """30-row single-input single-output dataset (edge case)."""
    rng = np.random.default_rng(99)
    X = rng.uniform(0.0, 1.0, (30, 1))
    y = 2.0 * X[:, 0] + 0.05 * rng.standard_normal(30)
    return X, y.reshape(-1, 1)


@pytest.fixture()
def fitted_linear(xy_3in_1out):
    X, y = xy_3in_1out
    m = LinearModel()
    m.fit(X, y, INPUT_COLS, OUTPUT_COLS)
    return m, X


@pytest.fixture()
def fitted_gpr(xy_3in_1out):
    X, y = xy_3in_1out
    m = GPRModel()
    m.fit(X, y, INPUT_COLS, OUTPUT_COLS)
    return m, X


@pytest.fixture()
def fitted_gpr_multi(xy_3in_2out):
    X, y = xy_3in_2out
    m = GPRModel()
    m.fit(X, y, INPUT_COLS, OUTPUT_COLS2)
    return m, X


@pytest.fixture()
def fitted_rf(xy_3in_1out):
    X, y = xy_3in_1out
    m = RFModel(n_estimators=20)
    m.fit(X, y, INPUT_COLS, OUTPUT_COLS)
    return m, X


@pytest.fixture()
def fitted_rf_multi(xy_3in_2out):
    X, y = xy_3in_2out
    m = RFModel(n_estimators=20)
    m.fit(X, y, INPUT_COLS, OUTPUT_COLS2)
    return m, X


# ─── SOBOL ANALYZER ───────────────────────────────────────────────────────────


def test_sobol_returns_required_keys(fitted_linear):
    model, X_train = fitted_linear
    result = SobolAnalyzer().analyze(model, X_train, INPUT_COLS, 0, n_samples=32)
    assert set(result.keys()) == {"method", "S1", "ST", "S1_conf", "ST_conf", "n_evaluations"}


def test_sobol_method_is_sobol(fitted_linear):
    model, X_train = fitted_linear
    result = SobolAnalyzer().analyze(model, X_train, INPUT_COLS, 0, n_samples=32)
    assert result["method"] == "sobol"


def test_sobol_all_input_cols_present(fitted_linear):
    model, X_train = fitted_linear
    result = SobolAnalyzer().analyze(model, X_train, INPUT_COLS, 0, n_samples=32)
    for col in INPUT_COLS:
        assert col in result["S1"]
        assert col in result["ST"]
        assert col in result["S1_conf"]
        assert col in result["ST_conf"]


def test_sobol_values_are_floats(fitted_linear):
    model, X_train = fitted_linear
    result = SobolAnalyzer().analyze(model, X_train, INPUT_COLS, 0, n_samples=32)
    for col in INPUT_COLS:
        assert isinstance(result["S1"][col],     float)
        assert isinstance(result["ST"][col],     float)
        assert isinstance(result["S1_conf"][col], float)
        assert isinstance(result["ST_conf"][col], float)


def test_sobol_n_evaluations_positive_int(fitted_linear):
    model, X_train = fitted_linear
    result = SobolAnalyzer().analyze(model, X_train, INPUT_COLS, 0, n_samples=32)
    assert isinstance(result["n_evaluations"], int)
    assert result["n_evaluations"] > 0


def test_sobol_n_evaluations_divisible_by_n_samples(fitted_linear):
    model, X_train = fitted_linear
    n_samples = 32
    result = SobolAnalyzer().analyze(model, X_train, INPUT_COLS, 0, n_samples=n_samples)
    assert result["n_evaluations"] % n_samples == 0


def test_sobol_second_output_index(fitted_gpr_multi):
    model, X_train = fitted_gpr_multi
    r0 = SobolAnalyzer().analyze(model, X_train, INPUT_COLS, 0, n_samples=32)
    r1 = SobolAnalyzer().analyze(model, X_train, INPUT_COLS, 1, n_samples=32)
    # The dominant input differs between outputs — output 0 dominated by "a",
    # output 1 dominated by "b". ST values must differ.
    assert r0["ST"] != r1["ST"]


def test_sobol_pce_shortcut_bypasses_salib():
    """If model.get_sensitivity() exists, SobolAnalyzer must call it directly."""
    expected = {
        "method": "pce_analytical",
        "S1":     {"a": 0.6, "b": 0.3, "c": 0.1},
        "ST":     {"a": 0.6, "b": 0.3, "c": 0.1},
        "S1_conf": {"a": 0.0, "b": 0.0, "c": 0.0},
        "ST_conf": {"a": 0.0, "b": 0.0, "c": 0.0},
        "n_evaluations": 0,
    }

    class _MockPCE:
        def get_sensitivity(self, output_idx):
            return expected

    rng = np.random.default_rng(0)
    X_dummy = rng.standard_normal((10, 3))
    result = SobolAnalyzer().analyze(_MockPCE(), X_dummy, INPUT_COLS, 0, n_samples=512)
    assert result == expected


def test_sobol_single_input(xy_1in_1out):
    X, y = xy_1in_1out
    model = LinearModel()
    model.fit(X, y, INPUT_1COL, OUTPUT_COLS)
    result = SobolAnalyzer().analyze(model, X, INPUT_1COL, 0, n_samples=32)
    assert "a" in result["S1"]
    assert isinstance(result["S1"]["a"], float)


# ─── OAT ANALYZER ─────────────────────────────────────────────────────────────


def test_oat_returns_all_input_cols(fitted_linear):
    model, X_train = fitted_linear
    result = OATAnalyzer().analyze(model, X_train, INPUT_COLS, 0)
    assert set(result.keys()) == set(INPUT_COLS)


def test_oat_entry_keys(fitted_linear):
    model, X_train = fitted_linear
    result = OATAnalyzer().analyze(model, X_train, INPUT_COLS, 0)
    for col in INPUT_COLS:
        assert set(result[col].keys()) == {"x", "y", "median", "min", "max"}


def test_oat_xy_length_matches_n_points(fitted_linear):
    model, X_train = fitted_linear
    n_pts = 30
    result = OATAnalyzer().analyze(model, X_train, INPUT_COLS, 0, n_points=n_pts)
    for col in INPUT_COLS:
        assert len(result[col]["x"]) == n_pts
        assert len(result[col]["y"]) == n_pts


def test_oat_median_min_max_are_floats(fitted_linear):
    model, X_train = fitted_linear
    result = OATAnalyzer().analyze(model, X_train, INPUT_COLS, 0)
    for col in INPUT_COLS:
        assert isinstance(result[col]["median"], float)
        assert isinstance(result[col]["min"],    float)
        assert isinstance(result[col]["max"],    float)


def test_oat_min_max_match_data_range(fitted_linear):
    model, X_train = fitted_linear
    result = OATAnalyzer().analyze(model, X_train, INPUT_COLS, 0)
    for i, col in enumerate(INPUT_COLS):
        assert pytest.approx(result[col]["min"]) == float(X_train[:, i].min())
        assert pytest.approx(result[col]["max"]) == float(X_train[:, i].max())


def test_oat_x_range_spans_min_to_max(fitted_linear):
    model, X_train = fitted_linear
    result = OATAnalyzer().analyze(model, X_train, INPUT_COLS, 0)
    for i, col in enumerate(INPUT_COLS):
        assert pytest.approx(result[col]["x"][0])  == float(X_train[:, i].min())
        assert pytest.approx(result[col]["x"][-1]) == float(X_train[:, i].max())


def test_oat_output_col_idx_selects_correct_output(fitted_gpr_multi):
    model, X_train = fitted_gpr_multi
    r0 = OATAnalyzer().analyze(model, X_train, INPUT_COLS, 0)
    r1 = OATAnalyzer().analyze(model, X_train, INPUT_COLS, 1)
    # Output 0 is dominated by input "a"; output 1 by "b" — y ranges must differ.
    assert r0["a"]["y"] != r1["a"]["y"]


def test_oat_single_input(xy_1in_1out):
    X, y = xy_1in_1out
    model = LinearModel()
    model.fit(X, y, INPUT_1COL, OUTPUT_COLS)
    result = OATAnalyzer().analyze(model, X, INPUT_1COL, 0)
    assert "a" in result
    assert len(result["a"]["x"]) == 50


def test_oat_constant_input_does_not_crash():
    """When all values in a column are identical, linspace returns a constant
    range — the model must still predict without error."""
    rng = np.random.default_rng(3)
    X = rng.uniform(0.0, 1.0, (20, 2))
    X[:, 1] = 0.5      # column "b" is constant
    y = X[:, 0].reshape(-1, 1)
    model = LinearModel()
    model.fit(X, y, ["a", "b"], OUTPUT_COLS)
    result = OATAnalyzer().analyze(model, X, ["a", "b"], 0)
    # All y values for constant column should be identical
    assert len(set(round(v, 8) for v in result["b"]["y"])) == 1


# ─── COMPUTE UNCERTAINTY ──────────────────────────────────────────────────────


def test_uncertainty_linear_returns_none_triple(fitted_linear):
    model, X_train = fitted_linear
    method, lo, hi = compute_uncertainty(model, X_train[:5], 0, "linear")
    assert method is None
    assert lo     is None
    assert hi     is None


def test_uncertainty_none_xtest_returns_none(fitted_gpr):
    model, _ = fitted_gpr
    method, lo, hi = compute_uncertainty(model, None, 0, "gpr")
    assert (method, lo, hi) == (None, None, None)


def test_uncertainty_empty_xtest_returns_none(fitted_gpr):
    model, _ = fitted_gpr
    method, lo, hi = compute_uncertainty(model, np.array([]), 0, "gpr")
    assert (method, lo, hi) == (None, None, None)


def test_uncertainty_gpr_method_string(fitted_gpr):
    model, X_train = fitted_gpr
    method, _, _ = compute_uncertainty(model, X_train[:8], 0, "gpr")
    assert method == "gpr_native"


def test_uncertainty_gpr_ci_shape(fitted_gpr):
    model, X_train = fitted_gpr
    n = 8
    _, lo, hi = compute_uncertainty(model, X_train[:n], 0, "gpr")
    assert len(lo) == n
    assert len(hi) == n


def test_uncertainty_gpr_lower_le_upper(fitted_gpr):
    model, X_train = fitted_gpr
    _, lo, hi = compute_uncertainty(model, X_train, 0, "gpr")
    assert all(l <= u for l, u in zip(lo, hi))


def test_uncertainty_gpr_bounds_are_lists(fitted_gpr):
    model, X_train = fitted_gpr
    _, lo, hi = compute_uncertainty(model, X_train[:5], 0, "gpr")
    assert isinstance(lo, list)
    assert isinstance(hi, list)


def test_uncertainty_gpr_second_output(fitted_gpr_multi):
    model, X_train = fitted_gpr_multi
    method, lo, hi = compute_uncertainty(model, X_train[:6], 1, "gpr")
    assert method == "gpr_native"
    assert len(lo) == 6
    assert all(l <= u for l, u in zip(lo, hi))


def test_uncertainty_rf_method_string(fitted_rf):
    model, X_train = fitted_rf
    method, _, _ = compute_uncertainty(model, X_train[:8], 0, "rf")
    assert method == "rf_tree_variance"


def test_uncertainty_rf_ci_shape(fitted_rf):
    model, X_train = fitted_rf
    n = 10
    _, lo, hi = compute_uncertainty(model, X_train[:n], 0, "rf")
    assert len(lo) == n
    assert len(hi) == n


def test_uncertainty_rf_lower_le_upper(fitted_rf):
    model, X_train = fitted_rf
    _, lo, hi = compute_uncertainty(model, X_train, 0, "rf")
    assert all(l <= u for l, u in zip(lo, hi))


def test_uncertainty_rf_bounds_are_lists(fitted_rf):
    model, X_train = fitted_rf
    _, lo, hi = compute_uncertainty(model, X_train[:5], 0, "rf")
    assert isinstance(lo, list)
    assert isinstance(hi, list)


def test_uncertainty_rf_second_output(fitted_rf_multi):
    model, X_train = fitted_rf_multi
    method, lo, hi = compute_uncertainty(model, X_train[:6], 1, "rf")
    assert method == "rf_tree_variance"
    assert len(lo) == 6
    assert all(l <= u for l, u in zip(lo, hi))


def test_uncertainty_kriging_routes_to_gpr_native(xy_3in_1out):
    """bootstrap.py treats 'kriging' identically to 'gpr' — uses predict_std."""
    X, y = xy_3in_1out
    model = GPRModel()
    model.fit(X, y, INPUT_COLS, OUTPUT_COLS)
    method, lo, hi = compute_uncertainty(model, X[:5], 0, "kriging")
    assert method == "gpr_native"
    assert len(lo) == 5
