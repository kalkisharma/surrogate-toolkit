"""
================================================================================
FILE: model_api.py
MODULE: app/api/
PURPOSE: Blueprint and route handlers for /api/model/*. Manages training
         configuration, model training, and results retrieval.
DEPENDENCIES: flask, app.state.schema, app.ml.models, app.ml.validation,
              config.settings, sklearn.model_selection
FUTURE EXTENSIONS: GET /api/model/metrics, POST /api/model/predict,
                   per-output model type selection, hyperparameter overrides.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-14
VERSION: 0.9.9
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import time

from flask import Blueprint, current_app, jsonify, request
from sklearn.model_selection import train_test_split

from app.ml.models import GPRModel, LinearModel, RFModel
from app.ml.validation import compute_metrics, run_cross_validation
from app.state.schema import append_audit_event
from config.settings import (
    CV_FOLDS_MAX,
    CV_FOLDS_MIN,
    DEFAULT_RANDOM_STATE,
    MAX_MODEL_HISTORY,
    MAX_PLOT_ROWS,
    SUPPORTED_MODEL_TYPES,
    TEST_SPLIT_MAX,
    TEST_SPLIT_MIN,
)

bp = Blueprint("model", __name__)

# ─── ERROR CODE → HTTP STATUS ─────────────────────────────────────────────────

_ERROR_HTTP_STATUS = {
    "UNKNOWN_MODEL_TYPE":    422,
    "INVALID_TEST_SPLIT":    422,
    "INVALID_CV_FOLDS":      422,
    "NO_CLEAN_DATA":         422,
    "DESIGNATION_REQUIRED":  422,
    "CONFIG_REQUIRED":       422,
    "NO_TRAINED_MODEL":      404,
}


def _http_status(error_code: str) -> int:
    return _ERROR_HTTP_STATUS.get(error_code, 400)


# ─── ROUTES ───────────────────────────────────────────────────────────────────


@bp.route("/config", methods=["GET"])
def get_config():
    """
    Return the current training configuration from STATE.

    Returns:
        JSON 200:
            {
              "success": true,
              "config": {
                "model_type": str | null,
                "test_split": float,
                "cv_folds":   int
              }
            }

    Notes:
        Returns defaults (model_type=null, test_split=0.20, cv_folds=5) until
        the user saves a configuration via POST /api/model/configure.

    Future:
        Per-dataset config storage for multi-dataset sessions.
    """
    state  = current_app.config["STATE"]
    config = state["surrogate_sessions"]["primary"]["config"]
    return jsonify({"success": True, "config": config}), 200


@bp.route("/configure", methods=["POST"])
def configure():
    """
    Save training configuration to STATE.

    Args (JSON body):
        model_type (str): "gpr" | "rf" | "linear"
        test_split (float): Fraction of data held out for testing. Must be
                            in [TEST_SPLIT_MIN, TEST_SPLIT_MAX] (0.05–0.50).
        cv_folds   (int):  Number of folds for k-fold cross-validation.
                            Must be in [CV_FOLDS_MIN, CV_FOLDS_MAX] (2–20).

    Returns:
        JSON 200:
            {
              "success": true,
              "config": { "model_type": ..., "test_split": ..., "cv_folds": ... }
            }
        JSON 422: Validation error envelope.

    Notes:
        Config is stored in state["surrogate_sessions"]["primary"]["config"].
        It is session-scoped, not tied to a specific dataset. Resetting the
        session (POST /api/state/reset) clears it back to defaults.
        Appends a "model_configure" audit event on success.

    Future:
        Per-output model type; hyperparameter overrides (kernel for GPR,
        n_estimators for RF, alpha for Ridge); stratified split for
        classification targets.
    """
    state = current_app.config["STATE"]
    data  = request.get_json(silent=True) or {}

    model_type = data.get("model_type")
    test_split = data.get("test_split")
    cv_folds   = data.get("cv_folds")

    # ── Validate model type ───────────────────────────────────────────────────
    if model_type not in SUPPORTED_MODEL_TYPES:
        return (
            jsonify({
                "success": False, "error_code": "UNKNOWN_MODEL_TYPE",
                "message": f"Unknown model type '{model_type}'. "
                           f"Supported: {', '.join(SUPPORTED_MODEL_TYPES)}.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    # ── Validate test split ───────────────────────────────────────────────────
    try:
        test_split = float(test_split)
    except (TypeError, ValueError):
        test_split = None

    if test_split is None or not (TEST_SPLIT_MIN <= test_split <= TEST_SPLIT_MAX):
        return (
            jsonify({
                "success": False, "error_code": "INVALID_TEST_SPLIT",
                "message": f"test_split must be between {TEST_SPLIT_MIN} and "
                           f"{TEST_SPLIT_MAX}. Got: {data.get('test_split')!r}.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    # ── Validate CV folds ─────────────────────────────────────────────────────
    try:
        cv_folds = int(cv_folds)
    except (TypeError, ValueError):
        cv_folds = None

    if cv_folds is None or not (CV_FOLDS_MIN <= cv_folds <= CV_FOLDS_MAX):
        return (
            jsonify({
                "success": False, "error_code": "INVALID_CV_FOLDS",
                "message": f"cv_folds must be an integer between {CV_FOLDS_MIN} "
                           f"and {CV_FOLDS_MAX}. Got: {data.get('cv_folds')!r}.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    # ── Persist ───────────────────────────────────────────────────────────────
    config = state["surrogate_sessions"]["primary"]["config"]
    config["model_type"] = model_type
    config["test_split"] = test_split
    config["cv_folds"]   = cv_folds

    append_audit_event(state, "model_configure", {
        "model_type": model_type,
        "test_split": test_split,
        "cv_folds":   cv_folds,
    })

    current_app.logger.info(
        f"Training config saved — model={model_type}, "
        f"test_split={test_split}, cv_folds={cv_folds}"
    )

    return jsonify({"success": True, "config": config}), 200


@bp.route("/train", methods=["POST"])
def train():
    """
    Train the configured surrogate model and store results in STATE.

    The endpoint:
    1. Resolves training data (normalized → clean fallback).
    2. Validates designation and config are present.
    3. Splits into train/test sets.
    4. Runs k-fold cross-validation on the training set.
    5. Fits the final model on the full training set.
    6. Evaluates the final model on the held-out test set.
    7. Stores model object and results dict in STATE.

    Args (JSON body):
        None required — all parameters come from STATE.

    Returns:
        JSON 200:
            {
              "success": true,
              "results": {
                "model_type":      str,
                "n_train":         int,
                "n_test":          int,
                "input_columns":   list[str],
                "output_columns":  list[str],
                "test_metrics":    [...],
                "cv_results":      {...},
                "warnings":        list[str]
              }
            }
        JSON 422: Validation error envelope (NO_CLEAN_DATA, DESIGNATION_REQUIRED,
                  CONFIG_REQUIRED).

    Notes:
        Stores the fitted model in
        state["surrogate_sessions"]["primary"]["models"]["trained"] and the
        serializable results in ["models"]["results"].

        get_state_json_safe() in schema.py detects the model object via
        duck-typing (hasattr "get_summary") and replaces it with its summary
        dict so the /api/state/ endpoint remains safe.

    Future:
        Async training for GPR on large datasets; per-output model type.
    """
    state = current_app.config["STATE"]

    # ── Resolve training data ─────────────────────────────────────────────────
    # Cannot use `or` — bool(DataFrame) raises ValueError.
    primary = state["datasets"]["primary"]
    _norm  = primary.get("normalized")
    _clean = primary.get("clean")
    df = _norm if _norm is not None else _clean
    if df is None:
        return (
            jsonify({
                "success": False, "error_code": "NO_CLEAN_DATA",
                "message": "No clean data is loaded. Upload and prepare a dataset first.",
                "detail": "", "recoverable": True, "allowed_actions": ["upload"],
            }),
            422,
        )

    # ── Validate designation ──────────────────────────────────────────────────
    meta        = primary["metadata"]
    input_cols  = meta.get("input_columns") or []
    output_cols = meta.get("output_columns") or []
    if not input_cols or not output_cols:
        return (
            jsonify({
                "success": False, "error_code": "DESIGNATION_REQUIRED",
                "message": "Input and output columns must be designated before training.",
                "detail": "", "recoverable": True, "allowed_actions": ["designate"],
            }),
            422,
        )

    # ── Validate config ───────────────────────────────────────────────────────
    config = state["surrogate_sessions"]["primary"]["config"]
    if config.get("model_type") is None:
        return (
            jsonify({
                "success": False, "error_code": "CONFIG_REQUIRED",
                "message": "Training configuration has not been saved. "
                           "Complete Step 6 — Configure Training first.",
                "detail": "", "recoverable": True, "allowed_actions": ["configure"],
            }),
            422,
        )

    model_type = config["model_type"]
    test_split = config["test_split"]
    cv_folds   = config["cv_folds"]

    # ── Build feature / target arrays ─────────────────────────────────────────
    X = df[input_cols].values
    y = df[output_cols].values

    # ── Train/test split ──────────────────────────────────────────────────────
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_split, random_state=DEFAULT_RANDOM_STATE
    )

    # ── Build model ───────────────────────────────────────────────────────────
    model = _make_model(model_type)

    # ── GPR large-dataset warning ─────────────────────────────────────────────
    warnings = []
    if model_type == "gpr" and len(X_train) > MAX_PLOT_ROWS:
        warnings.append(
            f"GPR training time scales as O(n³). Your training set has "
            f"{len(X_train):,} rows — this may take several minutes."
        )

    # ── Cross-validation on training set ─────────────────────────────────────
    # Guard: k-fold requires at least n_folds samples in the training set.
    safe_folds = min(cv_folds, len(X_train))
    cv_results = run_cross_validation(
        model, X_train, y_train, output_cols, safe_folds, input_cols
    )

    # ── Fit final model on full training set ──────────────────────────────────
    model.fit(X_train, y_train, input_cols, output_cols)

    # ── Evaluate on held-out test set ─────────────────────────────────────────
    y_pred_test = model.predict(X_test)
    test_metrics = compute_metrics(y_test, y_pred_test, output_cols)

    # ── Persist to STATE ──────────────────────────────────────────────────────
    results = {
        "model_type":       model_type,
        "n_train":          int(len(X_train)),
        "n_test":           int(len(X_test)),
        "source_filename":  meta.get("filename"),
        "input_columns":    input_cols,
        "output_columns":   output_cols,
        "input_means":      {col: float((_clean if _clean is not None else df)[col].mean()) for col in input_cols},
        "test_metrics":     test_metrics,
        "cv_results":       cv_results,
        "warnings":         warnings,
        # Raw arrays for parity and residual plots (shape: n_test × n_outputs).
        "test_actuals":     y_test.tolist(),
        "test_predictions": y_pred_test.tolist(),
    }
    models_dict = state["surrogate_sessions"]["primary"]["models"]
    models_dict["trained"] = model
    models_dict["results"] = results

    # Append full run entry to "runs" (one entry per training run, full results payload).
    runs    = models_dict.setdefault("runs", [])
    run_num = len(runs) + 1
    run_entry = dict(results)
    run_entry["run"] = run_num
    runs.append(run_entry)
    if len(runs) > MAX_MODEL_HISTORY:
        models_dict["runs"] = runs[-MAX_MODEL_HISTORY:]

    # Append compact history entries (one per output) for backward compatibility.
    history      = models_dict.setdefault("history", [])
    cv_r2_by_col = {
        entry["column"]: entry["mean_r2"]
        for entry in cv_results.get("metrics", [])
    }
    now_ts = int(time.time())
    for m in test_metrics:
        history.append({
            "run":        run_num,
            "timestamp":  now_ts,
            "model_type": model_type,
            "n_rows":     int(len(X_train)) + int(len(X_test)),
            "output":     m["column"],
            "r2_test":    round(float(m["r2"]),   4),
            "rmse_test":  round(float(m["rmse"]), 4),
            "r2_cv":      round(float(cv_r2_by_col.get(m["column"], 0)), 4),
        })
    if len(history) > MAX_MODEL_HISTORY:
        models_dict["history"] = history[-MAX_MODEL_HISTORY:]

    append_audit_event(state, "model_train", {
        "model_type": model_type,
        "n_train":    int(len(X_train)),
        "n_test":     int(len(X_test)),
    })

    current_app.logger.info(
        f"Model trained — type={model_type}, n_train={len(X_train)}, "
        f"n_test={len(X_test)}"
    )

    return jsonify({"success": True, "results": results}), 200


@bp.route("/results", methods=["GET"])
def get_results():
    """
    Return stored training results from STATE.

    Args:
        None

    Returns:
        JSON 200:
            {
              "success": true,
              "results": {
                "model_type":      str,
                "n_train":         int,
                "n_test":          int,
                "input_columns":   list[str],
                "output_columns":  list[str],
                "test_metrics":    [...],
                "cv_results":      {...},
                "warnings":        list[str]
              }
            }
        JSON 404:
            {
              "success": false,
              "error_code": "NO_TRAINED_MODEL",
              "message": str
            }

    Notes:
        Returns 404 if no model has been trained in this session. The frontend
        uses this to decide whether to render the results card on page re-render.

    Future:
        Return history of all trained models once MAX_MODEL_HISTORY is enforced.
    """
    state       = current_app.config["STATE"]
    models_dict = state["surrogate_sessions"]["primary"]["models"]
    results     = models_dict.get("results")
    history     = models_dict.get("history", [])
    runs        = models_dict.get("runs", [])

    if results is None:
        return (
            jsonify({
                "success": False, "error_code": "NO_TRAINED_MODEL",
                "message": "No trained model in this session. Train a model first.",
            }),
            404,
        )

    return jsonify({"success": True, "results": results, "history": history, "runs": runs}), 200


# ─── HELPERS ──────────────────────────────────────────────────────────────────


def _make_model(model_type: str):
    """Instantiate the correct model class for model_type.

    Args:
        model_type: One of "gpr", "rf", "linear".

    Returns:
        BaseSurrogateModel subclass instance (unfitted).

    Raises:
        Nothing — caller validates model_type before calling this.

    Notes:
        Imports happen here (not at module top) to keep the module importable
        even when sklearn is not installed — error surfaces at training time.

    Future:
        Accept hyperparameter overrides dict.
    """
    if model_type == "gpr":
        return GPRModel()
    if model_type == "rf":
        return RFModel()
    return LinearModel()
