"""
================================================================================
FILE: test_explore_api.py
MODULE: tests/unit/
PURPOSE: Unit tests for GET /api/model/explore/scatter and
         POST /api/model/explore/contour endpoints.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-26
LAST MODIFIED: 2026-05-26
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import json

import numpy as np
import pytest
from sklearn.model_selection import train_test_split

from app.ml.models.linear_model import LinearModel
from app.ml.models.rf_model import RFModel


# ─── HELPERS ──────────────────────────────────────────────────────────────────

INPUT_COLS  = ["x1", "x2", "x3"]
OUTPUT_COLS = ["y1"]
OUT2_COLS   = ["y1", "y2"]


def _make_data(n=80, n_in=3, n_out=1, seed=0):
    rng = np.random.default_rng(seed)
    X   = rng.uniform(0.0, 10.0, (n, n_in))
    y   = rng.random((n, n_out))
    return X, y


def _fit_linear(n_out=1):
    X, y = _make_data(n_out=n_out)
    cols_out = OUTPUT_COLS if n_out == 1 else OUT2_COLS
    m = LinearModel()
    m.fit(X, y, INPUT_COLS[:len(INPUT_COLS)], cols_out)
    return m, X, y


def _build_state(app, model, X, y, input_cols, output_cols):
    """Inject a trained model directly into STATE."""
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=0)
    y_pred = model.predict(X_test)

    results = {
        "model_type":       "linear",
        "input_columns":    list(input_cols),
        "output_columns":   list(output_cols),
        "source_filename":  "test.csv",
        "input_mins":       {c: float(X[:, i].min()) for i, c in enumerate(input_cols)},
        "input_maxs":       {c: float(X[:, i].max()) for i, c in enumerate(input_cols)},
        "test_inputs":      X_test.tolist(),
        "test_actuals":     y_test.tolist(),
        "test_predictions": y_pred.tolist(),
        "n_train":          len(X_train),
        "n_test":           len(X_test),
    }
    with app.app_context():
        state = app.config["STATE"]
        state["surrogate_sessions"]["primary"]["models"]["trained"] = model
        state["surrogate_sessions"]["primary"]["models"]["results"] = results
        state["surrogate_sessions"]["primary"].pop("pca", None)
    return results


# ─── FIXTURES ─────────────────────────────────────────────────────────────────

@pytest.fixture()
def trained_client(app, client):
    model, X, y = _fit_linear()
    _build_state(app, model, X, y, INPUT_COLS, OUTPUT_COLS)
    return client, app


@pytest.fixture()
def multi_output_client(app, client):
    model, X, y = _fit_linear(n_out=2)
    _build_state(app, model, X, y, INPUT_COLS, OUT2_COLS)
    return client, app


# ─── SCATTER: no model ────────────────────────────────────────────────────────

def test_scatter_no_model_returns_404(client):
    resp = client.get("/api/model/explore/scatter")
    assert resp.status_code == 404
    assert json.loads(resp.data)["success"] is False


# ─── SCATTER: success ─────────────────────────────────────────────────────────

def test_scatter_returns_200(trained_client):
    client, _ = trained_client
    resp = client.get("/api/model/explore/scatter")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True


def test_scatter_response_keys(trained_client):
    client, _ = trained_client
    data = json.loads(client.get("/api/model/explore/scatter").data)
    for key in ("input_columns", "output_columns", "input_mins", "input_maxs", "rows", "n_points"):
        assert key in data, f"missing key: {key}"


def test_scatter_columns_correct(trained_client):
    client, _ = trained_client
    data = json.loads(client.get("/api/model/explore/scatter").data)
    assert data["input_columns"]  == INPUT_COLS
    assert data["output_columns"] == OUTPUT_COLS


def test_scatter_row_keys(trained_client):
    client, _ = trained_client
    data = json.loads(client.get("/api/model/explore/scatter").data)
    row = data["rows"][0]
    for col in INPUT_COLS:
        assert col in row
    for col in OUTPUT_COLS:
        assert f"{col}__actual"    in row
        assert f"{col}__predicted" in row
        assert f"{col}__residual"  in row


def test_scatter_residual_equals_predicted_minus_actual(trained_client):
    client, _ = trained_client
    data = json.loads(client.get("/api/model/explore/scatter").data)
    for row in data["rows"]:
        col = OUTPUT_COLS[0]
        expected_resid = row[f"{col}__predicted"] - row[f"{col}__actual"]
        assert abs(row[f"{col}__residual"] - expected_resid) < 1e-9


def test_scatter_n_points_matches_rows(trained_client):
    client, _ = trained_client
    data = json.loads(client.get("/api/model/explore/scatter").data)
    assert data["n_points"] == len(data["rows"])


def test_scatter_input_mins_maxs_present(trained_client):
    client, _ = trained_client
    data = json.loads(client.get("/api/model/explore/scatter").data)
    for col in INPUT_COLS:
        assert col in data["input_mins"]
        assert col in data["input_maxs"]
        assert data["input_mins"][col] <= data["input_maxs"][col]


def test_scatter_multi_output_has_all_output_cols(multi_output_client):
    client, _ = multi_output_client
    data = json.loads(client.get("/api/model/explore/scatter").data)
    row = data["rows"][0]
    for col in OUT2_COLS:
        assert f"{col}__actual" in row
        assert f"{col}__predicted" in row
        assert f"{col}__residual" in row


# ─── CONTOUR: no model ────────────────────────────────────────────────────────

def test_contour_no_model_returns_404(client):
    resp = client.post(
        "/api/model/explore/contour",
        data=json.dumps({"x_col": "x1", "y_col": "x2", "output_col": "y1"}),
        content_type="application/json",
    )
    assert resp.status_code == 404


# ─── CONTOUR: validation errors ──────────────────────────────────────────────

def _post_contour(client, body):
    return client.post(
        "/api/model/explore/contour",
        data=json.dumps(body),
        content_type="application/json",
    )


def test_contour_same_x_y_returns_400(trained_client):
    client, _ = trained_client
    resp = _post_contour(client, {"x_col": "x1", "y_col": "x1", "output_col": "y1"})
    assert resp.status_code == 400


def test_contour_invalid_x_col_returns_400(trained_client):
    client, _ = trained_client
    resp = _post_contour(client, {"x_col": "NOPE", "y_col": "x2", "output_col": "y1"})
    assert resp.status_code == 400


def test_contour_invalid_output_col_returns_400(trained_client):
    client, _ = trained_client
    resp = _post_contour(client, {"x_col": "x1", "y_col": "x2", "output_col": "NOPE"})
    assert resp.status_code == 400


# ─── CONTOUR: success ─────────────────────────────────────────────────────────

def test_contour_returns_200(trained_client):
    client, _ = trained_client
    resp = _post_contour(client, {"x_col": "x1", "y_col": "x2", "output_col": "y1"})
    assert resp.status_code == 200
    assert json.loads(resp.data)["success"] is True


def test_contour_response_keys(trained_client):
    client, _ = trained_client
    data = json.loads(_post_contour(client, {"x_col": "x1", "y_col": "x2", "output_col": "y1"}).data)
    for key in ("x_vals", "y_vals", "z_grid", "x_col", "y_col", "output_col"):
        assert key in data


def test_contour_grid_shape_default_50(trained_client):
    client, _ = trained_client
    data = json.loads(_post_contour(client, {"x_col": "x1", "y_col": "x2", "output_col": "y1"}).data)
    assert len(data["x_vals"]) == 50
    assert len(data["y_vals"]) == 50
    assert len(data["z_grid"]) == 50
    assert len(data["z_grid"][0]) == 50


def test_contour_grid_shape_custom_n(trained_client):
    client, _ = trained_client
    data = json.loads(_post_contour(client, {
        "x_col": "x1", "y_col": "x2", "output_col": "y1", "n_grid": 25
    }).data)
    assert len(data["x_vals"]) == 25
    assert len(data["z_grid"]) == 25


def test_contour_n_grid_capped_at_100(trained_client):
    client, _ = trained_client
    data = json.loads(_post_contour(client, {
        "x_col": "x1", "y_col": "x2", "output_col": "y1", "n_grid": 9999
    }).data)
    assert len(data["x_vals"]) == 100


def test_contour_x_vals_within_input_range(trained_client):
    client, app = trained_client
    data = json.loads(_post_contour(client, {"x_col": "x1", "y_col": "x2", "output_col": "y1"}).data)
    with app.app_context():
        results = app.config["STATE"]["surrogate_sessions"]["primary"]["models"]["results"]
    x_min = results["input_mins"]["x1"]
    x_max = results["input_maxs"]["x1"]
    assert min(data["x_vals"]) >= x_min - 1e-9
    assert max(data["x_vals"]) <= x_max + 1e-9


def test_contour_z_grid_all_floats(trained_client):
    client, _ = trained_client
    data = json.loads(_post_contour(client, {"x_col": "x1", "y_col": "x2", "output_col": "y1"}).data)
    for row in data["z_grid"]:
        for val in row:
            assert isinstance(val, float)


def test_contour_fixed_inputs_used(trained_client):
    """Contour at two different fixed x3 values should produce different z_grids."""
    client, _ = trained_client
    d1 = json.loads(_post_contour(client, {
        "x_col": "x1", "y_col": "x2", "output_col": "y1",
        "fixed_inputs": {"x3": 0.0}, "n_grid": 10,
    }).data)
    d2 = json.loads(_post_contour(client, {
        "x_col": "x1", "y_col": "x2", "output_col": "y1",
        "fixed_inputs": {"x3": 10.0}, "n_grid": 10,
    }).data)
    z1 = np.array(d1["z_grid"])
    z2 = np.array(d2["z_grid"])
    assert not np.allclose(z1, z2), "Different fixed_inputs should yield different contour grids"


def test_contour_multi_output_works(multi_output_client):
    client, _ = multi_output_client
    data = json.loads(_post_contour(client, {
        "x_col": "x1", "y_col": "x2", "output_col": "y2"
    }).data)
    assert data["success"] is True
    assert data["output_col"] == "y2"
