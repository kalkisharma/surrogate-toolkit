"""
================================================================================
FILE: prediction_api.py
MODULE: app/api/
PURPOSE: Blueprint and routes for /api/predict/*. Single-point and batch
         prediction against a trained surrogate model stored in STATE.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-30
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import io

import numpy as np
import pandas as pd
from flask import Blueprint, current_app, jsonify, request

from app.state.schema import append_audit_event

bp = Blueprint("predict", __name__)

# ─── ERROR CODE → HTTP STATUS ─────────────────────────────────────────────────

_ERROR_HTTP_STATUS = {
    "NO_TRAINED_MODEL":    404,
    "MISSING_INPUTS":      422,
    "INVALID_INPUT_VALUE": 422,
    "NO_FILE":             422,
    "INVALID_CSV":         422,
    "MISSING_CSV_COLUMNS": 422,
    "NON_NUMERIC_CSV":     422,
}


def _http_status(error_code: str) -> int:
    return _ERROR_HTTP_STATUS.get(error_code, 400)


# ─── HELPERS ──────────────────────────────────────────────────────────────────


def _normalize_row(row: list, input_cols: list, method: str, params: dict) -> list:
    """Apply the training normalization transform to a single input row.

    Args:
        row:        List of float values in original (user) scale, ordered by input_cols.
        input_cols: Column names in the same order as row.
        method:     "minmax" | "zscore" | "none" | None
        params:     Per-column scaler parameters from meta["normalization_params"].

    Returns:
        New list with scaled values. Original row is not mutated.
    """
    if not method or method == "none":
        return row

    result = list(row)
    for i, col in enumerate(input_cols):
        p = params.get(col, {})
        if method == "minmax":
            lo  = p.get("min", 0.0)
            hi  = p.get("max", 1.0)
            rng = hi - lo
            result[i] = (result[i] - lo) / rng if rng != 0 else 0.0
        elif method == "zscore":
            mu    = p.get("mean", 0.0)
            sigma = p.get("std",  1.0)
            result[i] = (result[i] - mu) / sigma if sigma != 0 else 0.0
    return result


def _normalize_df_cols(df, input_cols: list, method: str, params: dict):
    """Apply the training normalization transform to input columns of a DataFrame.

    Operates on a copy — the original DataFrame is not mutated.
    """
    if not method or method == "none":
        return df

    df = df.copy()
    for col in input_cols:
        if col not in df.columns:
            continue
        p = params.get(col, {})
        if method == "minmax":
            lo  = p.get("min", 0.0)
            hi  = p.get("max", 1.0)
            rng = hi - lo
            df[col] = (df[col] - lo) / rng if rng != 0 else 0.0
        elif method == "zscore":
            mu    = p.get("mean", 0.0)
            sigma = p.get("std",  1.0)
            df[col] = (df[col] - mu) / sigma if sigma != 0 else 0.0
    return df


# ─── PCA TRANSFORM HELPERS ────────────────────────────────────────────────────


def _get_predict_cols(state) -> tuple:
    """Return (input_cols_for_user, use_pca, pca_state) for the current session.

    When PCA was applied, input_cols_for_user are the original physical column
    names (velocity, mach, …).  The caller should accept these from the user,
    normalize them, then call _pca_transform_row / _pca_transform_df.
    """
    meta      = state["datasets"]["primary"]["metadata"]
    pca_state = state["surrogate_sessions"]["primary"].get("pca")
    use_pca   = bool(meta.get("pca_applied", False)) and pca_state is not None
    if use_pca:
        return pca_state["original_inputs"], True, pca_state
    results = state["surrogate_sessions"]["primary"]["models"].get("results", {})
    return results.get("input_columns", []), False, None


def _pca_transform_row(row: list, original_cols: list, norm_method: str,
                       norm_params: dict, pca_model) -> list:
    """Normalize one row then apply PCA — returns PC-coordinate list."""
    row_norm = _normalize_row(row, original_cols, norm_method, norm_params)
    X_pca    = pca_model.transform(np.array([row_norm]))
    return X_pca[0].tolist()


def _pca_transform_df(df, original_cols: list, norm_method: str,
                      norm_params: dict, pca_model) -> np.ndarray:
    """Normalize DataFrame columns then apply PCA — returns (n, n_components) array."""
    df_scaled = _normalize_df_cols(df, original_cols, norm_method, norm_params)
    X         = df_scaled[original_cols].values.astype(float)
    return pca_model.transform(X)


# ─── ROUTES ───────────────────────────────────────────────────────────────────


@bp.route("/single", methods=["POST"])
def predict_single():
    """
    Predict outputs for a single row of input values.

    Args (JSON body):
        inputs (dict): Mapping of input column name → numeric value.
                       Must include every column in the trained model's
                       input_columns list.

    Returns:
        JSON 200:
            {
              "success": true,
              "predictions": { "<output_col>": float, ... },
              "model_type": str
            }
        JSON 404: NO_TRAINED_MODEL — no model trained in this session.
        JSON 422: MISSING_INPUTS   — one or more input columns absent.
        JSON 422: INVALID_INPUT_VALUE — a value could not be cast to float.

    Notes:
        Reads the trained model from
        state["surrogate_sessions"]["primary"]["models"]["trained"].
        Input column order is taken from results["input_columns"] — the same
        order used during training so the feature vector is correctly aligned.
    """
    state       = current_app.config["STATE"]
    models_dict = state["surrogate_sessions"]["primary"]["models"]
    model       = models_dict.get("trained")
    results     = models_dict.get("results")

    if model is None or results is None:
        return (
            jsonify({
                "success": False, "error_code": "NO_TRAINED_MODEL",
                "message": "No trained model in this session. Train a model first.",
            }),
            404,
        )

    output_cols = results["output_columns"]
    meta        = state["datasets"]["primary"]["metadata"]
    norm_method = meta.get("normalization_method", "none")
    norm_params = meta.get("normalization_params", {})

    # Resolve which columns the user must supply (original physical names when PCA applied)
    user_cols, use_pca, pca_state = _get_predict_cols(state)

    data   = request.get_json(silent=True) or {}
    inputs = data.get("inputs", {})

    # ── Validate all input columns present ────────────────────────────────────
    missing = [c for c in user_cols if c not in inputs]
    if missing:
        return (
            jsonify({
                "success": False, "error_code": "MISSING_INPUTS",
                "message": f"Missing input value(s): {', '.join(missing)}.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    # ── Parse values ──────────────────────────────────────────────────────────
    try:
        row = [float(inputs[c]) for c in user_cols]
    except (TypeError, ValueError) as exc:
        return (
            jsonify({
                "success": False, "error_code": "INVALID_INPUT_VALUE",
                "message": f"All input values must be numeric. {exc}",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    # ── Apply normalization + optional PCA ────────────────────────────────────
    if use_pca:
        row = _pca_transform_row(row, user_cols, norm_method, norm_params,
                                 pca_state["model"])
    else:
        row = _normalize_row(row, user_cols, norm_method, norm_params)

    # ── Predict ───────────────────────────────────────────────────────────────
    X     = np.array([row])                 # shape (1, n_inputs)
    y_hat = model.predict(X)               # shape (1, n_outputs)

    predictions = {col: float(y_hat[0, i]) for i, col in enumerate(output_cols)}

    append_audit_event(state, "predict_single", {"n_inputs": len(input_cols)})
    current_app.logger.debug(f"Single prediction — inputs={row}, preds={list(predictions.values())}")

    return jsonify({
        "success":     True,
        "predictions": predictions,
        "model_type":  results["model_type"],
    }), 200


@bp.route("/batch", methods=["POST"])
def predict_batch():
    """
    Predict outputs for every row in an uploaded CSV of input values.

    Args (multipart form):
        file: CSV file with headers matching the model's input_columns.
              Extra columns are allowed and passed through to the output.
              Input columns missing from the CSV trigger a 422.

    Returns:
        JSON 200:
            {
              "success": true,
              "rows":           list[dict],   # input cols + predicted output cols
              "columns":        list[str],    # all column names (inputs then outputs)
              "input_columns":  list[str],
              "output_columns": list[str],
              "n_rows":         int,
              "model_type":     str,
              "classification": str
            }
        JSON 404: NO_TRAINED_MODEL
        JSON 422: NO_FILE | INVALID_CSV | MISSING_CSV_COLUMNS | NON_NUMERIC_CSV

    Notes:
        The response is JSON — the frontend builds and downloads the CSV so the
        API stays consistent with the rest of the application.

        When classification is not "Unclassified", the frontend prepends a
        "# Classification: <label>" comment line to the downloaded CSV.
    """
    state       = current_app.config["STATE"]
    models_dict = state["surrogate_sessions"]["primary"]["models"]
    model       = models_dict.get("trained")
    results     = models_dict.get("results")

    if model is None or results is None:
        return (
            jsonify({
                "success": False, "error_code": "NO_TRAINED_MODEL",
                "message": "No trained model in this session. Train a model first.",
            }),
            404,
        )

    output_cols    = results["output_columns"]
    classification = state["session"].get("classification", "Unclassified")
    meta           = state["datasets"]["primary"]["metadata"]
    norm_method    = meta.get("normalization_method", "none")
    norm_params    = meta.get("normalization_params", {})

    # Resolve which columns the CSV must supply (original physical names when PCA applied)
    user_cols, use_pca, pca_state = _get_predict_cols(state)
    input_cols = results["input_columns"]   # PC names (or original if no PCA) — for output only

    # ── Validate file present ─────────────────────────────────────────────────
    if "file" not in request.files:
        return (
            jsonify({
                "success": False, "error_code": "NO_FILE",
                "message": "No CSV file provided.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    # ── Parse CSV ─────────────────────────────────────────────────────────────
    try:
        df = pd.read_csv(io.BytesIO(request.files["file"].read()))
    except Exception as exc:
        return (
            jsonify({
                "success": False, "error_code": "INVALID_CSV",
                "message": f"Could not parse CSV: {exc}",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    # ── Validate required columns (use user_cols — original names when PCA) ────
    missing = [c for c in user_cols if c not in df.columns]
    if missing:
        return (
            jsonify({
                "success": False, "error_code": "MISSING_CSV_COLUMNS",
                "message": f"CSV is missing required input column(s): {', '.join(missing)}.",
                "detail": f"Required: {', '.join(user_cols)}",
                "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    # ── Build feature matrix ──────────────────────────────────────────────────
    try:
        if use_pca:
            X = _pca_transform_df(df, user_cols, norm_method, norm_params,
                                  pca_state["model"])
        else:
            df_scaled = _normalize_df_cols(df, user_cols, norm_method, norm_params)
            X = df_scaled[user_cols].values.astype(float)
    except (ValueError, TypeError) as exc:
        return (
            jsonify({
                "success": False, "error_code": "NON_NUMERIC_CSV",
                "message": f"Input columns must contain numeric values only. {exc}",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    # ── Predict ───────────────────────────────────────────────────────────────
    y_hat = model.predict(X)    # shape (n_rows, n_outputs)

    rows = []
    for i in range(len(df)):
        row = {c: df.at[i, c] for c in user_cols}
        for j, col in enumerate(output_cols):
            row[col] = float(y_hat[i, j])
        rows.append(row)

    all_cols = user_cols + output_cols

    append_audit_event(state, "predict_batch", {
        "n_rows":         len(df),
        "classification": classification,
    })
    current_app.logger.info(
        f"Batch prediction — {len(df)} rows, classification={classification}"
    )

    return jsonify({
        "success":        True,
        "rows":           rows,
        "columns":        all_cols,
        "input_columns":  user_cols,
        "output_columns": output_cols,
        "n_rows":         len(df),
        "model_type":     results["model_type"],
        "classification": classification,
    }), 200
