"""
================================================================================
FILE: test_export_bundle.py
MODULE: tests/unit/
PURPOSE: Unit tests for app/ml/export/bundle.py — build_export_bundle()
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-26
LAST MODIFIED: 2026-05-26
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import io
import json
import zipfile

import joblib
import numpy as np
import pytest
from sklearn.decomposition import PCA

from app.ml.export.bundle import build_export_bundle
from app.ml.models.gpr_model import GPRModel
from app.ml.models.linear_model import LinearModel
from app.ml.models.rf_model import RFModel


# ─── CONSTANTS ────────────────────────────────────────────────────────────────

INPUT_COLS  = ["x1", "x2", "x3"]
OUTPUT_COLS = ["y1"]
OUT2_COLS   = ["y1", "y2"]
NORM_PARAMS = {
    "x1": {"method": "minmax", "min": 0.0, "max": 10.0},
    "x2": {"method": "minmax", "min": 0.0, "max": 10.0},
    "x3": {"method": "zscore",  "mean": 5.0, "std": 2.0},
}


# ─── FIXTURES ─────────────────────────────────────────────────────────────────

def _make_xy(n=60, n_in=3, n_out=1, seed=0):
    rng = np.random.default_rng(seed)
    X   = rng.random((n, n_in))
    y   = rng.random((n, n_out))
    return X, y


def _fit_linear(n_out=1):
    X, y = _make_xy(n_out=n_out)
    cols_in  = INPUT_COLS
    cols_out = OUTPUT_COLS if n_out == 1 else OUT2_COLS
    m = LinearModel()
    m.fit(X, y, cols_in, cols_out)
    return m, cols_in, cols_out, X, y


def _fit_gpr():
    X, y = _make_xy()
    m = GPRModel()
    m.fit(X, y, INPUT_COLS, OUTPUT_COLS)
    return m, X


def _fit_rf():
    X, y = _make_xy()
    m = RFModel()
    m.fit(X, y, INPUT_COLS, OUTPUT_COLS)
    return m, X


def _make_state(model, input_cols, output_cols, model_type,
                norm_params=None, pca_obj=None, pca_original=None,
                source_filename="test_data.csv"):
    results = {
        "model_type":      model_type,
        "input_columns":   list(input_cols),
        "output_columns":  list(output_cols),
        "source_filename": source_filename,
    }
    primary_meta = {"normalization_params": norm_params or {}}
    sess = {
        "primary": {
            "models": {"trained": model, "results": results},
        }
    }
    if pca_obj is not None:
        sess["primary"]["pca"] = {
            "model":           pca_obj,
            "original_inputs": list(pca_original or input_cols),
            "pc_names":        list(input_cols),
        }
    return {
        "datasets": {
            "primary": {"metadata": primary_meta},
            "_datasets": {},
            "active_dataset_key": None,
        },
        "surrogate_sessions": sess,
    }


@pytest.fixture()
def linear_state():
    m, cols_in, cols_out, X, _ = _fit_linear()
    return _make_state(m, cols_in, cols_out, "linear", NORM_PARAMS), X


@pytest.fixture()
def gpr_state():
    m, X = _fit_gpr()
    return _make_state(m, INPUT_COLS, OUTPUT_COLS, "gpr", NORM_PARAMS), X


@pytest.fixture()
def rf_state():
    m, X = _fit_rf()
    return _make_state(m, INPUT_COLS, OUTPUT_COLS, "rf", NORM_PARAMS), X


@pytest.fixture()
def no_model_state():
    return {
        "datasets": {
            "primary": {"metadata": {}},
            "_datasets": {},
            "active_dataset_key": None,
        },
        "surrogate_sessions": {
            "primary": {"models": {}},
        },
    }


# ─── TESTS: ValueError when no model ─────────────────────────────────────────

def test_raises_when_no_model(no_model_state):
    with pytest.raises(ValueError, match="No trained model"):
        build_export_bundle(no_model_state)


def test_raises_when_results_missing():
    m, _, _, _, _ = _fit_linear()
    state = {
        "datasets": {"primary": {"metadata": {}}, "_datasets": {}, "active_dataset_key": None},
        "surrogate_sessions": {"primary": {"models": {"trained": m}}},
    }
    with pytest.raises(ValueError):
        build_export_bundle(state)


# ─── TESTS: return type and filename ─────────────────────────────────────────

def test_returns_bytes_and_filename(linear_state):
    state, _ = linear_state
    result = build_export_bundle(state)
    assert isinstance(result, tuple) and len(result) == 2
    zip_bytes, filename = result
    assert isinstance(zip_bytes, bytes) and len(zip_bytes) > 0
    assert filename.startswith("surrogate_export_")
    assert filename.endswith(".zip")


# ─── TESTS: zip contents ─────────────────────────────────────────────────────

def _open_zip(state):
    zip_bytes, _ = build_export_bundle(state)
    return zipfile.ZipFile(io.BytesIO(zip_bytes))


def test_zip_contains_required_files(linear_state):
    state, _ = linear_state
    zf = _open_zip(state)
    names = zf.namelist()
    for required in ("model.joblib", "pipeline.json", "surrogate.py", "README.txt"):
        assert required in names, f"Missing {required}"


def test_no_pca_joblib_without_pca(linear_state):
    state, _ = linear_state
    zf = _open_zip(state)
    assert "pca.joblib" not in zf.namelist()


def test_pipeline_json_keys(linear_state):
    state, _ = linear_state
    zf = _open_zip(state)
    pipeline = json.loads(zf.read("pipeline.json"))
    for key in ("input_columns", "output_columns", "model_type",
                "norm_params", "has_pca", "sklearn_version",
                "toolkit_version", "dataset_name", "exported_at"):
        assert key in pipeline, f"pipeline.json missing key: {key}"


def test_pipeline_columns_correct(linear_state):
    state, _ = linear_state
    zf = _open_zip(state)
    pipeline = json.loads(zf.read("pipeline.json"))
    assert pipeline["input_columns"]  == INPUT_COLS
    assert pipeline["output_columns"] == OUTPUT_COLS
    assert pipeline["model_type"]     == "linear"
    assert pipeline["has_pca"]        is False


def test_pipeline_norm_params_present(linear_state):
    state, _ = linear_state
    zf = _open_zip(state)
    pipeline = json.loads(zf.read("pipeline.json"))
    assert "x1" in pipeline["norm_params"]
    assert pipeline["norm_params"]["x1"]["method"] == "minmax"


def test_surrogate_py_is_valid_python(linear_state):
    state, _ = linear_state
    zf = _open_zip(state)
    src = zf.read("surrogate.py").decode()
    compile(src, "surrogate.py", "exec")


def test_readme_contains_column_names(linear_state):
    state, _ = linear_state
    zf = _open_zip(state)
    readme = zf.read("README.txt").decode()
    for col in INPUT_COLS + OUTPUT_COLS:
        assert col in readme


# ─── TESTS: surrogate.py predict correctness ─────────────────────────────────

def _load_wrapper(state):
    """Execute surrogate.py in an isolated namespace and return the class."""
    zip_bytes, _ = build_export_bundle(state)
    zf   = zipfile.ZipFile(io.BytesIO(zip_bytes))
    src  = zf.read("surrogate.py").decode()

    # Load model.joblib and pipeline.json into a temp dir for the wrapper
    import tempfile, os
    with tempfile.TemporaryDirectory() as tmpdir:
        for name in zf.namelist():
            with open(os.path.join(tmpdir, name), "wb") as fh:
                fh.write(zf.read(name))
        # Execute surrogate.py with __file__ pointing to the temp dir
        ns = {"__file__": os.path.join(tmpdir, "surrogate.py")}
        exec(compile(src, "surrogate.py", "exec"), ns)
        sm = ns["SurrogateModel"]()
        return sm, tmpdir


def test_predict_shape_linear(linear_state):
    state, X = linear_state
    sm, _ = _load_wrapper(state)
    # X is already normalized; pass raw unnormalized version
    X_raw = X * 10  # undo minmax for x1, x2; approximate for x3
    y = sm.predict(X_raw)
    assert y.shape == (len(X_raw), 1)


def test_predict_matches_model_linear(linear_state):
    """Wrapper predict() on raw inputs should match direct model.predict() on normalized inputs."""
    state, X_norm = linear_state
    model  = state["surrogate_sessions"]["primary"]["models"]["trained"]
    y_direct = model.predict(X_norm)

    sm, _ = _load_wrapper(state)
    # Reconstruct raw inputs from norm_params
    X_raw = X_norm.copy()
    X_raw[:, 0] = X_norm[:, 0] * 10.0          # minmax inverse: x1 min=0 max=10
    X_raw[:, 1] = X_norm[:, 1] * 10.0          # minmax inverse: x2
    X_raw[:, 2] = X_norm[:, 2] * 2.0 + 5.0    # zscore inverse: x3 mean=5 std=2

    y_wrapper = sm.predict(X_raw)
    np.testing.assert_allclose(y_wrapper, y_direct, rtol=1e-5)


def test_predict_wrong_column_count_raises(linear_state):
    state, X = linear_state
    sm, _ = _load_wrapper(state)
    with pytest.raises(ValueError, match="Expected 3 input columns"):
        sm.predict(np.zeros((1, 2)))


def test_predict_dataframe_input(linear_state):
    import pandas as pd
    state, X_norm = linear_state
    X_raw = X_norm.copy()
    X_raw[:, 0] = X_norm[:, 0] * 10.0
    X_raw[:, 1] = X_norm[:, 1] * 10.0
    X_raw[:, 2] = X_norm[:, 2] * 2.0 + 5.0
    df = pd.DataFrame(X_raw, columns=INPUT_COLS)
    sm, _ = _load_wrapper(state)
    y = sm.predict(df)
    assert y.shape[1] == 1


def test_predict_dataframe_missing_column_raises(linear_state):
    import pandas as pd
    state, X = linear_state
    sm, _ = _load_wrapper(state)
    df = pd.DataFrame(X[:, :2], columns=["x1", "x2"])
    with pytest.raises(ValueError, match="missing columns"):
        sm.predict(df)


# ─── TESTS: GPR and RF model types ───────────────────────────────────────────

def test_zip_produced_for_gpr(gpr_state):
    state, _ = gpr_state
    zip_bytes, filename = build_export_bundle(state)
    assert len(zip_bytes) > 0
    pipeline = json.loads(zipfile.ZipFile(io.BytesIO(zip_bytes)).read("pipeline.json"))
    assert pipeline["model_type"] == "gpr"


def test_zip_produced_for_rf(rf_state):
    state, _ = rf_state
    zip_bytes, _ = build_export_bundle(state)
    pipeline = json.loads(zipfile.ZipFile(io.BytesIO(zip_bytes)).read("pipeline.json"))
    assert pipeline["model_type"] == "rf"


# ─── TESTS: PCA mode ─────────────────────────────────────────────────────────

def test_pca_bundle_includes_pca_joblib():
    X, y = _make_xy()
    pca  = PCA(n_components=2)
    X_pc = pca.fit_transform(X)
    pc_names = ["PC1", "PC2"]
    m = LinearModel()
    m.fit(X_pc, y, pc_names, OUTPUT_COLS)
    state = _make_state(
        m, pc_names, OUTPUT_COLS, "linear",
        norm_params=NORM_PARAMS,
        pca_obj=pca,
        pca_original=INPUT_COLS,
    )
    zf = _open_zip(state)
    assert "pca.joblib" in zf.namelist()


def test_pca_pipeline_exposes_original_columns():
    X, y = _make_xy()
    pca  = PCA(n_components=2)
    X_pc = pca.fit_transform(X)
    pc_names = ["PC1", "PC2"]
    m = LinearModel()
    m.fit(X_pc, y, pc_names, OUTPUT_COLS)
    state = _make_state(
        m, pc_names, OUTPUT_COLS, "linear",
        pca_obj=pca, pca_original=INPUT_COLS,
    )
    zf       = _open_zip(state)
    pipeline = json.loads(zf.read("pipeline.json"))
    assert pipeline["input_columns"] == INPUT_COLS
    assert pipeline["has_pca"] is True


def test_pca_predict_shape():
    X, y = _make_xy()
    pca  = PCA(n_components=2)
    X_pc = pca.fit_transform(X)
    pc_names = ["PC1", "PC2"]
    m = LinearModel()
    m.fit(X_pc, y, pc_names, OUTPUT_COLS)
    state = _make_state(
        m, pc_names, OUTPUT_COLS, "linear",
        pca_obj=pca, pca_original=INPUT_COLS,
    )
    sm, _ = _load_wrapper(state)
    y_pred = sm.predict(X)
    assert y_pred.shape == (len(X), 1)


# ─── TESTS: no normalization ─────────────────────────────────────────────────

def test_no_norm_params_predict_passthrough():
    m, cols_in, cols_out, X, _ = _fit_linear()
    state = _make_state(m, cols_in, cols_out, "linear", norm_params={})
    sm, _ = _load_wrapper(state)
    y = sm.predict(X)
    y_direct = m.predict(X)
    np.testing.assert_allclose(y, y_direct, rtol=1e-5)
