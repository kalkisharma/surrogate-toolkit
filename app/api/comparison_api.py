"""
================================================================================
FILE: comparison_api.py
MODULE: app/api/
PURPOSE: Blueprint and routes for /api/comparison/*. Multi-dataset side-by-side
         comparison: status listing, LHS-sampled bias analysis, error model
         fitting, and cached result retrieval.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-15
LAST MODIFIED: 2026-05-15
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import numpy as np
from flask import Blueprint, current_app, jsonify, request

from app.state.schema import append_audit_event

bp = Blueprint("comparison", __name__)


# ─── HELPERS ──────────────────────────────────────────────────────────────────

def _get_session_models(state, key):
    """Return (models_dict, results) for any dataset key (active or not)."""
    active_key = state["datasets"]["active_dataset_key"]
    if key == active_key:
        models_dict = state["surrogate_sessions"]["primary"]["models"]
    else:
        ds = state["datasets"]["_datasets"].get(key)
        if ds is None:
            return None, None
        models_dict = ds.get("surrogate_session", {}).get("models", {})
    results = models_dict.get("results")
    return models_dict, results


def _get_df_for_key(state, key):
    """Return the clean/normalized DataFrame for a dataset key."""
    active_key = state["datasets"]["active_dataset_key"]
    if key == active_key:
        primary = state["datasets"]["primary"]
        df = primary.get("normalized")
        return df if df is not None else primary.get("clean")
    ds = state["datasets"]["_datasets"].get(key)
    if ds is None:
        return None
    df = ds.get("normalized")
    return df if df is not None else ds.get("clean")


def _metrics_by_column(test_metrics):
    """Convert test_metrics list to {column: {r2, rmse, mae}} dict."""
    return {m["column"]: {"r2": m["r2"], "rmse": m["rmse"], "mae": m["mae"]}
            for m in (test_metrics or [])}


# ─── ROUTES ───────────────────────────────────────────────────────────────────

@bp.route("/status", methods=["GET"])
def comparison_status():
    """List all loaded datasets and whether each has a trained model.

    Returns:
        JSON 200:
            {
              "success": true,
              "datasets": [
                {
                  "key":             str,
                  "filename":        str,
                  "n_rows":          int | null,
                  "input_columns":   list[str],
                  "output_columns":  list[str],
                  "has_model":       bool,
                  "model_type":      str | null,
                  "active":          bool
                }, ...
              ]
            }
    """
    state     = current_app.config["STATE"]
    _datasets = state["datasets"]["_datasets"]
    active_key = state["datasets"]["active_dataset_key"]

    result = []
    for key, ds in _datasets.items():
        _, results = _get_session_models(state, key)
        meta = ds["metadata"]
        result.append({
            "key":            key,
            "filename":       meta.get("filename", key),
            "n_rows":         meta.get("n_rows_clean") or meta.get("n_rows_original"),
            "input_columns":  meta.get("input_columns", []),
            "output_columns": meta.get("output_columns", []),
            "has_model":      results is not None,
            "model_type":     results.get("model_type") if results else None,
            "active":         key == active_key,
        })

    return jsonify({"success": True, "datasets": result}), 200


@bp.route("/run", methods=["POST"])
def run_comparison():
    """Run a side-by-side comparison of two trained surrogates.

    Request JSON:
        {
          "dataset_a":  str,          // key for Model A (defaults to active)
          "dataset_b":  str,          // key for Model B
          "n_samples":  int           // LHS sample count (default 200, max 1000)
        }

    Returns:
        JSON 200:
            {
              "success": true,
              "dataset_a":       str,
              "dataset_b":       str,
              "common_inputs":   list[str],
              "common_outputs":  list[str],
              "n_samples":       int,
              "outputs": {
                <col>: {
                  "y_a":        list[float],
                  "y_b":        list[float],
                  "delta":      list[float],   // B - A
                  "delta_mean": float,
                  "delta_std":  float,
                  "delta_min":  float,
                  "delta_max":  float,
                  "pct_bias":   float          // delta_mean / mean(y_a) * 100, if |mean(y_a)| > 1e-9
                }
              },
              "metrics_a": { <col>: {r2, rmse, mae}, ... },
              "metrics_b": { <col>: {r2, rmse, mae}, ... }
            }
        JSON 400/404 on validation failure.
    """
    state = current_app.config["STATE"]
    data  = request.get_json(silent=True) or {}

    key_a = data.get("dataset_a") or state["datasets"].get("active_dataset_key")
    key_b = data.get("dataset_b")
    n_samples = min(int(data.get("n_samples", 200)), 1000)

    if not key_a or not key_b:
        return jsonify({
            "success": False, "error_code": "MISSING_KEYS",
            "message": "Provide both dataset_a and dataset_b.",
        }), 400

    if key_a == key_b:
        return jsonify({
            "success": False, "error_code": "SAME_DATASET",
            "message": "dataset_a and dataset_b must be different datasets.",
        }), 400

    _, results_a = _get_session_models(state, key_a)
    _, results_b = _get_session_models(state, key_b)
    models_a, _ = _get_session_models(state, key_a)
    models_b, _ = _get_session_models(state, key_b)

    if results_a is None:
        return jsonify({
            "success": False, "error_code": "NO_MODEL_A",
            "message": f"Dataset '{key_a}' has no trained model.",
        }), 404

    if results_b is None:
        return jsonify({
            "success": False, "error_code": "NO_MODEL_B",
            "message": f"Dataset '{key_b}' has no trained model.",
        }), 404

    model_a = models_a.get("trained")
    model_b = models_b.get("trained")

    inputs_a = list(results_a["input_columns"])
    inputs_b = list(results_b["input_columns"])
    outputs_a = list(results_a["output_columns"])
    outputs_b = list(results_b["output_columns"])

    common_inputs  = sorted(set(inputs_a) & set(inputs_b))
    common_outputs = sorted(set(outputs_a) & set(outputs_b))

    if not common_inputs:
        return jsonify({
            "success": False, "error_code": "NO_COMMON_INPUTS",
            "message": "The two models share no common input columns.",
        }), 400

    if not common_outputs:
        return jsonify({
            "success": False, "error_code": "NO_COMMON_OUTPUTS",
            "message": "The two models share no common output columns.",
        }), 400

    # ── Bounds for common inputs ──────────────────────────────────────────────
    mins_a = results_a.get("input_mins") or {}
    maxs_a = results_a.get("input_maxs") or {}
    mins_b = results_b.get("input_mins") or {}
    maxs_b = results_b.get("input_maxs") or {}

    # Fall back to dataset df if results don't have bounds (older models)
    df_a = _get_df_for_key(state, key_a)
    df_b = _get_df_for_key(state, key_b)

    lhs_bounds = {}
    for col in common_inputs:
        lo_a = mins_a.get(col)
        hi_a = maxs_a.get(col)
        lo_b = mins_b.get(col)
        hi_b = maxs_b.get(col)

        if lo_a is None and df_a is not None and col in df_a.columns:
            lo_a, hi_a = float(df_a[col].min()), float(df_a[col].max())
        if lo_b is None and df_b is not None and col in df_b.columns:
            lo_b, hi_b = float(df_b[col].min()), float(df_b[col].max())

        if lo_a is None or lo_b is None:
            lo, hi = 0.0, 1.0
        else:
            # Sample in the intersection of both training ranges (shared region)
            lo = max(lo_a, lo_b)
            hi = min(hi_a, hi_b)
            if lo >= hi:
                lo = min(lo_a, lo_b)
                hi = max(hi_a, hi_b)

        lhs_bounds[col] = [lo, hi]

    # ── LHS sampling ─────────────────────────────────────────────────────────
    from scipy.stats.qmc import LatinHypercube, scale as qmc_scale

    sampler = LatinHypercube(d=len(common_inputs), seed=42)
    X_unit  = sampler.random(n=n_samples)
    lo_arr  = np.array([lhs_bounds[c][0] for c in common_inputs])
    hi_arr  = np.array([lhs_bounds[c][1] for c in common_inputs])
    X_lhs   = qmc_scale(X_unit, lo_arr, hi_arr)   # (n_samples, n_common_inputs)

    # ── Build full input arrays for each model ────────────────────────────────
    # Models are trained on their full input_columns set; non-common cols get median.

    def _build_X(inputs_full, df_for_medians):
        """Build (n_samples, len(inputs_full)) array from LHS common inputs + medians."""
        X = np.zeros((n_samples, len(inputs_full)))
        for j, col in enumerate(inputs_full):
            if col in common_inputs:
                ci = common_inputs.index(col)
                X[:, j] = X_lhs[:, ci]
            else:
                if df_for_medians is not None and col in df_for_medians.columns:
                    X[:, j] = float(df_for_medians[col].median())
                else:
                    X[:, j] = 0.0
        return X

    X_a = _build_X(inputs_a, df_a)
    X_b = _build_X(inputs_b, df_b)

    y_a = model_a.predict(X_a)   # (n_samples, n_outputs_a)
    y_b = model_b.predict(X_b)   # (n_samples, n_outputs_b)

    if y_a.ndim == 1:
        y_a = y_a.reshape(-1, 1)
    if y_b.ndim == 1:
        y_b = y_b.reshape(-1, 1)

    # ── Build output comparison dict ──────────────────────────────────────────
    outputs_payload = {}
    for out_col in common_outputs:
        idx_a = outputs_a.index(out_col)
        idx_b = outputs_b.index(out_col)

        ya = y_a[:, idx_a]
        yb = y_b[:, idx_b]
        delta = yb - ya

        mean_a = float(np.mean(ya))
        pct_bias = float(np.mean(delta) / abs(mean_a) * 100) if abs(mean_a) > 1e-9 else None

        outputs_payload[out_col] = {
            "y_a":        ya.tolist(),
            "y_b":        yb.tolist(),
            "delta":      delta.tolist(),
            "delta_mean": float(np.mean(delta)),
            "delta_std":  float(np.std(delta)),
            "delta_min":  float(np.min(delta)),
            "delta_max":  float(np.max(delta)),
            "pct_bias":   pct_bias,
        }

    # ── Metrics from each model's test results ────────────────────────────────
    metrics_a = _metrics_by_column(results_a.get("test_metrics"))
    metrics_b = _metrics_by_column(results_b.get("test_metrics"))

    payload = {
        "dataset_a":      key_a,
        "dataset_b":      key_b,
        "common_inputs":  common_inputs,
        "common_outputs": common_outputs,
        "n_samples":      n_samples,
        "outputs":        outputs_payload,
        "metrics_a":      {c: metrics_a[c] for c in common_outputs if c in metrics_a},
        "metrics_b":      {c: metrics_b[c] for c in common_outputs if c in metrics_b},
        "model_type_a":   results_a.get("model_type"),
        "model_type_b":   results_b.get("model_type"),
    }

    # Cache in state
    state.setdefault("comparison_cache", {})["last"] = payload

    append_audit_event(state, "comparison_run", {
        "dataset_a": key_a,
        "dataset_b": key_b,
        "n_samples": n_samples,
        "common_outputs": common_outputs,
    })

    return jsonify({"success": True, **payload}), 200


@bp.route("/error_model", methods=["POST"])
def fit_error_model():
    """Fit a linear model to predict Δ(output) from common inputs.

    Uses the cached LHS comparison result. Helps understand if bias is
    spatially structured (i.e., concentrated in certain input regions).

    Request JSON:
        { "output_col": str }

    Returns:
        JSON 200:
            {
              "success":      true,
              "output_col":   str,
              "r2":           float,
              "coefficients": { <input_col>: float, ... },
              "intercept":    float,
              "method":       "linear"
            }
    """
    state = current_app.config["STATE"]
    data  = request.get_json(silent=True) or {}

    cache = state.get("comparison_cache", {}).get("last")
    if cache is None:
        return jsonify({
            "success": False, "error_code": "NO_COMPARISON",
            "message": "Run a comparison first via POST /api/comparison/run.",
        }), 404

    output_col = data.get("output_col")
    if output_col not in cache["outputs"]:
        output_col = cache["common_outputs"][0] if cache["common_outputs"] else None

    if output_col is None:
        return jsonify({
            "success": False, "error_code": "NO_OUTPUT",
            "message": "No valid output column.",
        }), 400

    common_inputs = cache["common_inputs"]
    delta = np.array(cache["outputs"][output_col]["delta"])

    key_a = cache["dataset_a"]
    df_a  = _get_df_for_key(state, key_a)

    # Rebuild the LHS X matrix from the cached inputs bounds
    # We need to re-run the same LHS (same seed) to recover X_lhs
    from scipy.stats.qmc import LatinHypercube, scale as qmc_scale
    from sklearn.linear_model import LinearRegression

    n_samples = cache["n_samples"]
    sampler   = LatinHypercube(d=len(common_inputs), seed=42)
    X_unit    = sampler.random(n=n_samples)

    # Reconstruct bounds from the models' results
    key_b     = cache["dataset_b"]
    _, res_a  = _get_session_models(state, key_a)
    _, res_b  = _get_session_models(state, key_b)

    mins_a = (res_a or {}).get("input_mins") or {}
    maxs_a = (res_a or {}).get("input_maxs") or {}
    mins_b = (res_b or {}).get("input_mins") or {}
    maxs_b = (res_b or {}).get("input_maxs") or {}
    df_b   = _get_df_for_key(state, key_b)

    lo_arr = np.zeros(len(common_inputs))
    hi_arr = np.ones(len(common_inputs))
    for i, col in enumerate(common_inputs):
        lo_a = mins_a.get(col)
        hi_a = maxs_a.get(col)
        lo_b = mins_b.get(col)
        hi_b = maxs_b.get(col)
        if lo_a is None and df_a is not None and col in df_a.columns:
            lo_a, hi_a = float(df_a[col].min()), float(df_a[col].max())
        if lo_b is None and df_b is not None and col in df_b.columns:
            lo_b, hi_b = float(df_b[col].min()), float(df_b[col].max())
        if lo_a is not None and lo_b is not None:
            lo = max(lo_a, lo_b)
            hi = min(hi_a, hi_b)
            if lo >= hi:
                lo = min(lo_a, lo_b)
                hi = max(hi_a, hi_b)
            lo_arr[i], hi_arr[i] = lo, hi

    X_lhs = qmc_scale(X_unit, lo_arr, hi_arr)

    lr = LinearRegression()
    lr.fit(X_lhs, delta)
    r2 = float(lr.score(X_lhs, delta))

    coefficients = {col: float(lr.coef_[i]) for i, col in enumerate(common_inputs)}

    return jsonify({
        "success":      True,
        "output_col":   output_col,
        "r2":           round(r2, 4),
        "coefficients": coefficients,
        "intercept":    float(lr.intercept_),
        "method":       "linear",
    }), 200


@bp.route("/results", methods=["GET"])
def get_results():
    """Return the cached comparison result from the most recent run.

    Returns:
        JSON 200: { "success": true, "cached": true, ...comparison payload... }
        JSON 404: { "success": false, "error_code": "NO_COMPARISON" }
    """
    state = current_app.config["STATE"]
    cache = state.get("comparison_cache", {}).get("last")
    if cache is None:
        return jsonify({
            "success": False, "error_code": "NO_COMPARISON",
        }), 404
    return jsonify({"success": True, "cached": True, **cache}), 200
