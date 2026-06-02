"""
================================================================================
FILE: test_models.py
MODULE: tests/unit/
PURPOSE: Unit tests for surrogate model implementations and diagnostics
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-12
VERSION: 0.7.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import numpy as np
import pytest

from app.ml.models.gpr_model import GPRModel
from app.ml.models.linear_model import LinearModel
from app.ml.models.rf_model import RFModel
from app.ml.validation.diagnostics import compute_metrics


# ─── FIXTURES ─────────────────────────────────────────────────────────────────


@pytest.fixture()
def xy_single_output():
    """20-row single-output regression dataset."""
    rng = np.random.default_rng(0)
    X = rng.standard_normal((20, 3))
    y = 2 * X[:, 0] + 0.5 * X[:, 1] + rng.standard_normal(20) * 0.1
    return X, y.reshape(-1, 1)


@pytest.fixture()
def xy_multi_output():
    """20-row two-output regression dataset."""
    rng = np.random.default_rng(1)
    X = rng.standard_normal((20, 3))
    y1 = 2 * X[:, 0] + rng.standard_normal(20) * 0.1
    y2 = -X[:, 1] + rng.standard_normal(20) * 0.1
    return X, np.column_stack([y1, y2])


INPUT_COLS  = ["x1", "x2", "x3"]
OUTPUT_COLS = ["y"]
OUTPUT_COLS2 = ["y1", "y2"]


# ─── GPR ──────────────────────────────────────────────────────────────────────


def test_gpr_fit_predict_single_output(xy_single_output):
    X, y = xy_single_output
    model = GPRModel()
    model.fit(X, y, INPUT_COLS, OUTPUT_COLS)
    preds = model.predict(X)
    assert preds.shape == (20, 1)
    assert model._is_fitted is True


def test_gpr_fit_predict_multi_output(xy_multi_output):
    X, y = xy_multi_output
    model = GPRModel()
    model.fit(X, y, INPUT_COLS, OUTPUT_COLS2)
    preds = model.predict(X)
    assert preds.shape == (20, 2)


def test_gpr_predict_before_fit_raises():
    with pytest.raises(RuntimeError, match="not been fitted"):
        GPRModel().predict(np.zeros((5, 3)))


def test_gpr_get_summary_after_fit(xy_single_output):
    X, y = xy_single_output
    model = GPRModel()
    model.fit(X, y, INPUT_COLS, OUTPUT_COLS)
    summary = model.get_summary()
    assert summary["_type"] == "model"
    assert summary["model_type"] == "gpr"
    assert summary["is_fitted"] is True
    assert summary["input_columns"] == INPUT_COLS
    assert summary["output_columns"] == OUTPUT_COLS


# ─── RANDOM FOREST ────────────────────────────────────────────────────────────


def test_rf_fit_predict_single_output(xy_single_output):
    X, y = xy_single_output
    model = RFModel()
    model.fit(X, y, INPUT_COLS, OUTPUT_COLS)
    preds = model.predict(X)
    assert preds.shape == (20, 1)
    assert model._is_fitted is True


def test_rf_fit_predict_multi_output(xy_multi_output):
    X, y = xy_multi_output
    model = RFModel()
    model.fit(X, y, INPUT_COLS, OUTPUT_COLS2)
    preds = model.predict(X)
    assert preds.shape == (20, 2)


def test_rf_source_not_mutated(xy_single_output):
    X, y = xy_single_output
    X_orig = X.copy()
    y_orig = y.copy()
    RFModel().fit(X, y, INPUT_COLS, OUTPUT_COLS)
    np.testing.assert_array_equal(X, X_orig)
    np.testing.assert_array_equal(y, y_orig)


# ─── LINEAR ───────────────────────────────────────────────────────────────────


def test_linear_fit_predict_single_output(xy_single_output):
    X, y = xy_single_output
    model = LinearModel()
    model.fit(X, y, INPUT_COLS, OUTPUT_COLS)
    preds = model.predict(X)
    assert preds.shape == (20, 1)
    assert model._is_fitted is True


def test_linear_fit_predict_multi_output(xy_multi_output):
    X, y = xy_multi_output
    model = LinearModel()
    model.fit(X, y, INPUT_COLS, OUTPUT_COLS2)
    preds = model.predict(X)
    assert preds.shape == (20, 2)


def test_linear_predict_before_fit_raises():
    with pytest.raises(RuntimeError, match="not been fitted"):
        LinearModel().predict(np.zeros((5, 3)))


# ─── DIAGNOSTICS ──────────────────────────────────────────────────────────────


def test_compute_metrics_perfect_predictions():
    y = np.array([[1.0], [2.0], [3.0]])
    metrics = compute_metrics(y, y, ["out"])
    assert metrics[0]["r2"] == pytest.approx(1.0)
    assert metrics[0]["rmse"] == pytest.approx(0.0)
    assert metrics[0]["mae"] == pytest.approx(0.0)


def test_compute_metrics_shape_mismatch_raises():
    y_true = np.zeros((5, 1))
    y_pred = np.zeros((5, 2))
    with pytest.raises(ValueError, match="shape"):
        compute_metrics(y_true, y_pred, ["out"])


def test_compute_metrics_column_count_mismatch_raises():
    y = np.zeros((5, 2))
    with pytest.raises(ValueError, match="output_columns"):
        compute_metrics(y, y, ["only_one"])


def test_compute_metrics_returns_one_entry_per_column(xy_multi_output):
    X, y = xy_multi_output
    model = LinearModel()
    model.fit(X, y, INPUT_COLS, OUTPUT_COLS2)
    preds = model.predict(X)
    metrics = compute_metrics(y, preds, OUTPUT_COLS2)
    assert len(metrics) == 2
    assert metrics[0]["column"] == "y1"
    assert metrics[1]["column"] == "y2"
    for m in metrics:
        assert "r2" in m
        assert "rmse" in m
        assert "mae" in m
