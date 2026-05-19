"""
================================================================================
FILE: model_api.py
MODULE: app/api/
PURPOSE: Blueprint and route handlers for /api/model/*. Manages training
         configuration, model training, results retrieval, and interpretation.
DEPENDENCIES: flask, app.state.schema, app.ml.models, app.ml.validation,
              app.ml.sensitivity, app.ml.uncertainty, config.settings,
              sklearn.model_selection
FUTURE EXTENSIONS: GET /api/model/metrics, per-output model type selection.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-19
VERSION: 2.3.1
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import time

import numpy as np
from flask import Blueprint, current_app, jsonify, request
from sklearn.gaussian_process.kernels import Matern, RationalQuadratic
from sklearn.model_selection import train_test_split

from app.ml.models import GPRModel, KrigingModel, LinearModel, PCEModel, RBFModel, RFModel
from app.ml.multi_fidelity.bridge_correction import BridgeCorrectionModel
from app.ml.multi_fidelity.kennedy_ohagan    import KOCoKrigingModel
from app.ml.sensitivity.global_sensitivity import SobolAnalyzer
from app.ml.sensitivity.one_at_a_time import OATAnalyzer
from app.ml.uncertainty.bootstrap import compute_uncertainty
from app.ml.validation import compute_metrics, run_cross_validation
from app.state.schema import append_audit_event
from config.settings import (
    CV_FOLDS_MAX,
    CV_FOLDS_MIN,
    DEFAULT_CV_FOLDS,
    DEFAULT_RANDOM_STATE,
    DEFAULT_TEST_SPLIT,
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
    hyperparams = data.get("hyperparams") or {}
    if not isinstance(hyperparams, dict):
        hyperparams = {}

    config = state["surrogate_sessions"]["primary"]["config"]
    config["model_type"]  = model_type
    config["test_split"]  = test_split
    config["cv_folds"]    = cv_folds
    config["hyperparams"] = hyperparams

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


@bp.route("/tune", methods=["POST"])
def tune():
    """
    Run GridSearchCV on the current model type and store best hyperparameters.

    Uses the full dataset (no train/test split) so all available rows inform
    the search. CV is capped at 5 folds to keep GPR tuning tractable.
    Sets config["hyperparams"] to the best params so the next /train call
    uses them automatically.

    Args (JSON body):
        None — all parameters come from STATE.

    Returns:
        JSON 200:
            {
              "success": true,
              "best_params":  dict,
              "best_cv_r2":   float,
              "n_candidates": int
            }
        JSON 422: Validation error envelope (same codes as /train).
    """
    from sklearn.model_selection import GridSearchCV

    state = current_app.config["STATE"]

    # ── Resolve data (same checks as /train) ─────────────────────────────────
    primary = state["datasets"]["primary"]
    _norm   = primary.get("normalized")
    _clean  = primary.get("clean")
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

    meta        = primary["metadata"]
    input_cols  = meta.get("input_columns") or []
    output_cols = meta.get("output_columns") or []
    if not input_cols or not output_cols:
        return (
            jsonify({
                "success": False, "error_code": "DESIGNATION_REQUIRED",
                "message": "Input and output columns must be designated before tuning.",
                "detail": "", "recoverable": True, "allowed_actions": ["designate"],
            }),
            422,
        )

    config = state["surrogate_sessions"]["primary"]["config"]
    if config.get("model_type") is None:
        return (
            jsonify({
                "success": False, "error_code": "CONFIG_REQUIRED",
                "message": "Training configuration has not been saved. "
                           "Complete Step 7 — Configure Training first.",
                "detail": "", "recoverable": True, "allowed_actions": ["configure"],
            }),
            422,
        )

    model_type = config["model_type"]
    cv_folds   = min(config.get("cv_folds") or DEFAULT_CV_FOLDS, 5)

    X = df[input_cols].values
    y = df[output_cols].values

    # ── GridSearchCV ──────────────────────────────────────────────────────────
    model      = _make_model(model_type)
    param_grid = model.get_param_grid()

    if not param_grid:
        return (
            jsonify({
                "success": False, "error_code": "AUTOTUNE_NOT_SUPPORTED",
                "message": f"Auto-tune is not supported for '{model_type}'. "
                           "RBF and PCE models do not have a hyperparameter grid.",
                "detail": "", "recoverable": True, "allowed_actions": ["train"],
            }),
            422,
        )

    gs = GridSearchCV(
        model._model, param_grid,
        cv=cv_folds, scoring="r2", n_jobs=-1, refit=False,
    )
    gs.fit(X, y)

    best_cv_r2  = float(gs.cv_results_["mean_test_score"][gs.best_index_])
    n_candidates = len(gs.cv_results_["mean_test_score"])
    best_params  = _convert_best_params(model_type, gs.best_params_)

    config["hyperparams"]      = best_params
    config["auto_tune_result"] = {
        "best_params":  best_params,
        "best_cv_r2":   round(best_cv_r2, 4),
        "n_candidates": n_candidates,
    }

    append_audit_event(state, "model_autotune", {
        "model_type":   model_type,
        "n_candidates": n_candidates,
        "best_cv_r2":   round(best_cv_r2, 4),
    })

    current_app.logger.info(
        f"Auto-tune complete — type={model_type}, best_cv_r2={best_cv_r2:.4f}, "
        f"n_candidates={n_candidates}"
    )

    return jsonify({
        "success":      True,
        "best_params":  best_params,
        "best_cv_r2":   round(best_cv_r2, 4),
        "n_candidates": n_candidates,
    }), 200


@bp.route("/interpret", methods=["POST"])
def interpret():
    """Run Sobol + OAT + uncertainty for one output column. Caches result per output."""
    state  = current_app.config["STATE"]
    data   = request.get_json(silent=True) or {}
    output_col = data.get("output_col")
    n_samples  = min(int(data.get("n_samples", 512)), 2048)

    models_dict = state["surrogate_sessions"]["primary"]["models"]
    model       = models_dict.get("trained")
    results     = models_dict.get("results")
    if model is None or results is None:
        return jsonify({
            "success": False, "error_code": "NO_TRAINED_MODEL",
            "message": "No trained model. Train a model in Step 7 first.",
        }), 404

    input_cols  = results["input_columns"]
    output_cols = results["output_columns"]
    if output_col not in output_cols:
        output_col = output_cols[0]
    output_idx = output_cols.index(output_col)
    model_type = results["model_type"]

    primary = state["datasets"]["primary"]
    _norm   = primary.get("normalized")
    _clean  = primary.get("clean")
    df      = _norm if _norm is not None else _clean
    X_train = df[input_cols].values
    X_test  = np.array(results.get("test_inputs") or [])

    sensitivity = SobolAnalyzer().analyze(model, X_train, input_cols, output_idx, n_samples)
    oat         = OATAnalyzer().analyze(model, X_train, input_cols, output_idx)
    unc_method, ci_lower, ci_upper = compute_uncertainty(model, X_test, output_idx, model_type)

    uncertainty = None
    if unc_method is not None:
        uncertainty = {
            "method":        unc_method,
            "ci_lower":      ci_lower,
            "ci_upper":      ci_upper,
            "ci_confidence": 0.95,
        }

    payload = {
        "input_cols":  input_cols,
        "output_col":  output_col,
        "model_type":  model_type,
        "sensitivity": sensitivity,
        "oat":         oat,
        "uncertainty": uncertainty,
    }
    models_dict.setdefault("interpretation", {})[output_col] = payload
    append_audit_event(state, "sensitivity_analysis_run", {
        "output_col":    output_col,
        "n_evaluations": sensitivity["n_evaluations"],
    })

    return jsonify({"success": True, **payload}), 200


@bp.route("/interpret", methods=["GET"])
def get_interpret():
    """Return cached interpretation result for one output column."""
    output_col  = request.args.get("output_col")
    models_dict = current_app.config["STATE"]["surrogate_sessions"]["primary"]["models"]
    cache       = models_dict.get("interpretation", {})
    if output_col and output_col in cache:
        return jsonify({"success": True, "cached": True, **cache[output_col]}), 200
    return jsonify({"success": False, "error_code": "NO_INTERPRETATION"}), 404


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

    model_type  = config["model_type"]
    test_split  = config["test_split"]
    cv_folds    = config["cv_folds"]
    hyperparams = config.get("hyperparams") or {}

    # ── Build feature / target arrays ─────────────────────────────────────────
    X = df[input_cols].values
    y = df[output_cols].values

    # ── Train/test split ──────────────────────────────────────────────────────
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_split, random_state=DEFAULT_RANDOM_STATE
    )

    # ── Build model ───────────────────────────────────────────────────────────
    model = _make_model(model_type, hyperparams)

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

    # GPR/Kriging posterior std — free byproduct; None for RF/RBF/PCE/Linear.
    test_stds = None
    if model_type in ("gpr", "kriging"):
        test_stds = model.predict_std(X_test).tolist()

    # ── Persist to STATE ──────────────────────────────────────────────────────
    results = {
        "model_type":       model_type,
        "hyperparams":      hyperparams,
        "n_train":          int(len(X_train)),
        "n_test":           int(len(X_test)),
        "source_filename":  meta.get("filename"),
        "input_columns":    input_cols,
        "output_columns":   output_cols,
        "input_means":      {col: float((_clean if _clean is not None else df)[col].mean()) for col in input_cols},
        "input_mins":       {col: float(df[col].min()) for col in input_cols},
        "input_maxs":       {col: float(df[col].max()) for col in input_cols},
        "test_metrics":     test_metrics,
        "cv_results":       cv_results,
        "warnings":         warnings,
        # Raw arrays for parity and residual plots (shape: n_test × n_outputs).
        "test_actuals":     y_test.tolist(),
        "test_predictions": y_pred_test.tolist(),
        "test_inputs":      X_test.tolist(),
        "test_stds":        test_stds,
    }
    models_dict = state["surrogate_sessions"]["primary"]["models"]
    models_dict.pop("interpretation", None)
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


@bp.route("/train_ensemble", methods=["POST"])
def train_ensemble():
    """Train a weighted ensemble of surrogate models.

    Trains all selected component types, computes weights using the chosen
    strategy, and stores the ensemble in the same STATE slot as any trained
    model. All downstream panels (results, predictions, interpretation,
    export) work on the ensemble transparently.

    Args (JSON body):
        component_types    (list[str]): At least 2 model type strings.
        strategy           (str):       "equal" | "cv_performance" (default) |
                                        "stacking".
        hyperparams_per_type (dict):    Optional per-component hyperparams.
                                        Defaults are used for missing entries.

    Returns:
        JSON 200:
            {
              "success": true,
              "results": {
                "model_type":          "ensemble",
                "ensemble_strategy":   str,
                "ensemble_components": list[str],
                "ensemble_weights":    {model_type: float},
                "ensemble_cv_r2":      {model_type: float},
                "ensemble_failed":     [{model_type, error}, ...],
                "test_metrics":        [...],
                "cv_results":          {...},
                ...  (same shape as POST /api/model/train)
              }
            }
        JSON 422: Validation error envelope.
    """
    from app.ml.ensemble.ensemble_model import EnsembleSurrogateModel

    state = current_app.config["STATE"]
    data  = request.get_json(silent=True) or {}

    component_types      = data.get("component_types")
    strategy             = data.get("strategy", "cv_performance")
    hyperparams_per_type = data.get("hyperparams_per_type") or {}

    # ── Validate inputs ───────────────────────────────────────────────────────
    if not component_types or not isinstance(component_types, list):
        return (
            jsonify({
                "success": False, "error_code": "INVALID_COMPONENT_TYPES",
                "message": "component_types must be a non-empty list of model type strings.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    invalid = [mt for mt in component_types if mt not in SUPPORTED_MODEL_TYPES]
    if invalid:
        return (
            jsonify({
                "success": False, "error_code": "UNKNOWN_MODEL_TYPE",
                "message": f"Unknown model type(s): {', '.join(invalid)}. "
                           f"Supported: {', '.join(SUPPORTED_MODEL_TYPES)}.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    if len(component_types) < 2:
        return (
            jsonify({
                "success": False, "error_code": "INVALID_COMPONENT_TYPES",
                "message": "At least 2 component types are required for an ensemble.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    if strategy not in ("equal", "cv_performance", "stacking"):
        strategy = "cv_performance"

    # ── Resolve data ──────────────────────────────────────────────────────────
    primary = state["datasets"]["primary"]
    _norm   = primary.get("normalized")
    _clean  = primary.get("clean")
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

    meta        = primary["metadata"]
    input_cols  = meta.get("input_columns") or []
    output_cols = meta.get("output_columns") or []
    if not input_cols or not output_cols:
        return (
            jsonify({
                "success": False, "error_code": "DESIGNATION_REQUIRED",
                "message": "Designate input and output columns before training.",
                "detail": "", "recoverable": True, "allowed_actions": ["designate"],
            }),
            422,
        )

    config     = state["surrogate_sessions"]["primary"]["config"]
    test_split = config.get("test_split") or DEFAULT_TEST_SPLIT
    cv_folds   = config.get("cv_folds") or DEFAULT_CV_FOLDS

    X = df[input_cols].values
    y = df[output_cols].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_split, random_state=DEFAULT_RANDOM_STATE
    )

    # ── Build and train ensemble ──────────────────────────────────────────────
    ensemble = EnsembleSurrogateModel(
        component_types=component_types,
        strategy=strategy,
        hyperparams_per_type=hyperparams_per_type,
        cv_folds=min(cv_folds, len(X_train)),
    )
    ensemble.fit(X_train, y_train, input_cols, output_cols)

    if not ensemble._components:
        return (
            jsonify({
                "success": False, "error_code": "ENSEMBLE_ALL_FAILED",
                "message": "All component models failed to train. "
                           "Check your data or try fewer/different component types.",
                "detail": str(ensemble._failed_components),
                "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    warnings     = [f"{f['model_type']} excluded: {f['error']}"
                    for f in ensemble._failed_components]
    y_pred_test  = ensemble.predict(X_test)
    test_metrics = compute_metrics(y_test, y_pred_test, output_cols)
    test_stds    = ensemble.predict_std(X_test).tolist()

    # Construct cv_results in the per_output format expected by results.js.
    # Uses average component CV R² as the ensemble-level CV estimate.
    comp_r2s = list(ensemble._component_cv_r2.values())
    avg_r2   = float(np.mean(comp_r2s)) if comp_r2s else 0.0
    std_r2   = float(np.std(comp_r2s))  if len(comp_r2s) > 1 else 0.0
    cv_results = {
        "n_folds":    min(cv_folds, len(X_train)),
        "per_output": [
            {
                "column":    col,
                "mean_r2":   avg_r2,
                "std_r2":    std_r2,
                "mean_rmse": 0.0,
                "std_rmse":  0.0,
                "mean_mae":  0.0,
                "std_mae":   0.0,
            }
            for col in output_cols
        ],
    }

    results = {
        "model_type":          "ensemble",
        "ensemble_strategy":   strategy,
        "ensemble_components": [mt for mt, _ in ensemble._components],
        "ensemble_weights":    ensemble._weights,
        "ensemble_cv_r2":      ensemble._component_cv_r2,
        "ensemble_failed":     ensemble._failed_components,
        "hyperparams":         {"component_types": component_types, "strategy": strategy},
        "n_train":             int(len(X_train)),
        "n_test":              int(len(X_test)),
        "source_filename":     meta.get("filename"),
        "input_columns":       input_cols,
        "output_columns":      output_cols,
        "input_means":         {col: float((_clean if _clean is not None else df)[col].mean()) for col in input_cols},
        "input_mins":          {col: float(df[col].min()) for col in input_cols},
        "input_maxs":          {col: float(df[col].max()) for col in input_cols},
        "test_metrics":        test_metrics,
        "cv_results":          cv_results,
        "warnings":            warnings,
        "test_actuals":        y_test.tolist(),
        "test_predictions":    y_pred_test.tolist(),
        "test_inputs":         X_test.tolist(),
        "test_stds":           test_stds,
    }

    # ── Persist to STATE (same slot as any trained model) ─────────────────────
    models_dict = state["surrogate_sessions"]["primary"]["models"]
    models_dict.pop("interpretation", None)
    models_dict["trained"] = ensemble
    models_dict["results"] = results

    runs    = models_dict.setdefault("runs", [])
    run_num = len(runs) + 1
    run_entry       = dict(results)
    run_entry["run"] = run_num
    runs.append(run_entry)
    if len(runs) > MAX_MODEL_HISTORY:
        models_dict["runs"] = runs[-MAX_MODEL_HISTORY:]

    history  = models_dict.setdefault("history", [])
    now_ts   = int(time.time())
    for m in test_metrics:
        history.append({
            "run":        run_num,
            "timestamp":  now_ts,
            "model_type": "ensemble",
            "n_rows":     int(len(X_train)) + int(len(X_test)),
            "output":     m["column"],
            "r2_test":    round(float(m["r2"]),   4),
            "rmse_test":  round(float(m["rmse"]), 4),
            "r2_cv":      round(avg_r2, 4),
        })
    if len(history) > MAX_MODEL_HISTORY:
        models_dict["history"] = history[-MAX_MODEL_HISTORY:]

    append_audit_event(state, "ensemble_train", {
        "strategy":     strategy,
        "n_components": len(ensemble._components),
        "n_train":      int(len(X_train)),
        "n_test":       int(len(X_test)),
    })

    current_app.logger.info(
        f"Ensemble trained — strategy={strategy}, "
        f"components={[mt for mt, _ in ensemble._components]}, "
        f"n_train={len(X_train)}, n_test={len(X_test)}"
    )

    return jsonify({"success": True, "results": results}), 200


@bp.route("/compare", methods=["POST"])
def compare_models():
    """Train all supported model types with default hyperparameters and return
    side-by-side test metrics.

    Uses the current primary dataset and config (test_split, cv_folds). The
    trained model in STATE is not changed — this is a read-only comparison run.

    Args (JSON body):
        None — all parameters come from STATE.

    Returns:
        JSON 200:
            {
              "success": true,
              "input_columns":  list[str],
              "output_columns": list[str],
              "n_train": int,
              "n_test":  int,
              "comparison": [
                {
                  "model_type":    str,
                  "train_time_s":  float,
                  "metrics":       [{column, r2, rmse, mae}, ...],
                  "success":       true
                },
                { "model_type": str, "success": false, "error": str },
                ...
              ]
            }
        JSON 422: Validation error envelope.
    """
    state = current_app.config["STATE"]

    primary = state["datasets"]["primary"]
    _norm   = primary.get("normalized")
    _clean  = primary.get("clean")
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

    meta        = primary["metadata"]
    input_cols  = meta.get("input_columns") or []
    output_cols = meta.get("output_columns") or []
    if not input_cols or not output_cols:
        return (
            jsonify({
                "success": False, "error_code": "DESIGNATION_REQUIRED",
                "message": "Input and output columns must be designated before comparing models.",
                "detail": "", "recoverable": True, "allowed_actions": ["designate"],
            }),
            422,
        )

    config     = state["surrogate_sessions"]["primary"]["config"]
    test_split = config.get("test_split") or DEFAULT_TEST_SPLIT
    cv_folds   = min(config.get("cv_folds") or DEFAULT_CV_FOLDS, 5)

    X = df[input_cols].values
    y = df[output_cols].values
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_split, random_state=DEFAULT_RANDOM_STATE
    )

    comparison = []
    for mt in SUPPORTED_MODEL_TYPES:
        t0 = time.time()
        try:
            m = _make_model(mt)
            m.fit(X_train, y_train, input_cols, output_cols)
            y_pred = m.predict(X_test)
            metrics = compute_metrics(y_test, y_pred, output_cols)
            elapsed = round(time.time() - t0, 3)
            comparison.append({
                "model_type":   mt,
                "train_time_s": elapsed,
                "metrics":      metrics,
                "success":      True,
            })
        except Exception as exc:
            comparison.append({
                "model_type": mt,
                "success":    False,
                "error":      str(exc),
            })

    append_audit_event(state, "model_comparison_run", {"n_models": len(comparison)})

    current_app.logger.info(
        f"Model comparison complete — {len(comparison)} types, "
        f"n_train={len(X_train)}, n_test={len(X_test)}"
    )

    return jsonify({
        "success":        True,
        "input_columns":  input_cols,
        "output_columns": output_cols,
        "n_train":        int(len(X_train)),
        "n_test":         int(len(X_test)),
        "comparison":     comparison,
    }), 200


@bp.route("/train_multifidelity", methods=["POST"])
def train_multifidelity():
    """Train a multi-fidelity surrogate from two loaded datasets.

    Args (JSON body):
        lf_dataset_key   (str):  Key of the low-fidelity dataset.
        hf_dataset_key   (str):  Key of the high-fidelity dataset.
        method           (str):  "bridge" (default) | "co_kriging".
        base_model_type  (str):  LF surrogate type for bridge correction
                                 (ignored for co_kriging). Default "rf".
        cv_folds         (int):  Folds for HF CV comparison. Default 5.

    Returns:
        JSON 200:
            {
              "success": true,
              "results": {
                "model_type":    "bridge_correction" | "co_kriging",
                "n_train":       int   (n_lf),
                "n_test":        int   (n_hf),
                "test_metrics":  [...],
                "cv_results":    {...},
                "mf_comparison": {method, n_lf, n_hf, cv_type, per_output},
                "warnings":      list[str],
                ...
              }
            }
        JSON 400/404/422: Error envelopes.
    """
    state = current_app.config["STATE"]
    data  = request.get_json(silent=True) or {}

    lf_key          = data.get("lf_dataset_key")
    hf_key          = data.get("hf_dataset_key")
    method          = data.get("method", "bridge")
    base_model_type = data.get("base_model_type", "rf")
    cv_folds        = max(2, min(int(data.get("cv_folds", 5)), 10))

    # ── Validate keys ─────────────────────────────────────────────────────────
    if not lf_key or not hf_key:
        return (
            jsonify({
                "success": False, "error_code": "MISSING_DATASET_KEYS",
                "message": "lf_dataset_key and hf_dataset_key are required.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            400,
        )
    if lf_key == hf_key:
        return (
            jsonify({
                "success": False, "error_code": "SAME_DATASET",
                "message": "LF and HF dataset keys must be different.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            400,
        )

    _datasets = state["datasets"]["_datasets"]
    lf_ds = _datasets.get(lf_key)
    hf_ds = _datasets.get(hf_key)

    if lf_ds is None:
        return (
            jsonify({
                "success": False, "error_code": "LF_NOT_FOUND",
                "message": f"LF dataset '{lf_key}' not found. Load it first.",
                "detail": "", "recoverable": True, "allowed_actions": ["upload"],
            }),
            404,
        )
    if hf_ds is None:
        return (
            jsonify({
                "success": False, "error_code": "HF_NOT_FOUND",
                "message": f"HF dataset '{hf_key}' not found. Load it first.",
                "detail": "", "recoverable": True, "allowed_actions": ["upload"],
            }),
            404,
        )

    # ── Resolve dataframes ────────────────────────────────────────────────────
    _lf_norm  = lf_ds.get("normalized")
    _lf_clean = lf_ds.get("clean")
    lf_df     = _lf_norm if _lf_norm is not None else _lf_clean

    _hf_norm  = hf_ds.get("normalized")
    _hf_clean = hf_ds.get("clean")
    hf_df     = _hf_norm if _hf_norm is not None else _hf_clean

    if lf_df is None:
        return (
            jsonify({
                "success": False, "error_code": "LF_NOT_PROCESSED",
                "message": "LF dataset has not been cleaned. Complete Steps 4–5 for it first.",
                "detail": "", "recoverable": True, "allowed_actions": ["clean"],
            }),
            422,
        )
    if hf_df is None:
        return (
            jsonify({
                "success": False, "error_code": "HF_NOT_PROCESSED",
                "message": "HF dataset has not been cleaned. Complete Steps 4–5 for it first.",
                "detail": "", "recoverable": True, "allowed_actions": ["clean"],
            }),
            422,
        )

    # ── Validate column designations ──────────────────────────────────────────
    lf_meta      = lf_ds["metadata"]
    hf_meta      = hf_ds["metadata"]
    input_cols   = lf_meta.get("input_columns") or []
    output_cols  = lf_meta.get("output_columns") or []
    hf_in_cols   = hf_meta.get("input_columns") or []
    hf_out_cols  = hf_meta.get("output_columns") or []

    if not input_cols or not output_cols:
        return (
            jsonify({
                "success": False, "error_code": "LF_NO_DESIGNATION",
                "message": "LF dataset columns have not been designated. Complete Step 5 for it.",
                "detail": "", "recoverable": True, "allowed_actions": ["designate"],
            }),
            422,
        )
    if not hf_in_cols or not hf_out_cols:
        return (
            jsonify({
                "success": False, "error_code": "HF_NO_DESIGNATION",
                "message": "HF dataset columns have not been designated. Complete Step 5 for it.",
                "detail": "", "recoverable": True, "allowed_actions": ["designate"],
            }),
            422,
        )
    if set(input_cols) != set(hf_in_cols):
        return (
            jsonify({
                "success": False, "error_code": "INPUT_COLUMN_MISMATCH",
                "message": (
                    f"LF input columns {sorted(input_cols)} do not match "
                    f"HF input columns {sorted(hf_in_cols)}."
                ),
                "detail": "", "recoverable": True, "allowed_actions": ["designate"],
            }),
            422,
        )
    if set(output_cols) != set(hf_out_cols):
        return (
            jsonify({
                "success": False, "error_code": "OUTPUT_COLUMN_MISMATCH",
                "message": (
                    f"LF output columns {sorted(output_cols)} do not match "
                    f"HF output columns {sorted(hf_out_cols)}."
                ),
                "detail": "", "recoverable": True, "allowed_actions": ["designate"],
            }),
            422,
        )

    # ── Build arrays ──────────────────────────────────────────────────────────
    X_lf = lf_df[input_cols].values.astype(float)
    y_lf = lf_df[output_cols].values.astype(float)
    X_hf = hf_df[input_cols].values.astype(float)
    y_hf = hf_df[output_cols].values.astype(float)
    if y_lf.ndim == 1:
        y_lf = y_lf.reshape(-1, 1)
    if y_hf.ndim == 1:
        y_hf = y_hf.reshape(-1, 1)

    n_hf = len(X_hf)
    if n_hf < 3:
        return (
            jsonify({
                "success": False, "error_code": "INSUFFICIENT_HF_DATA",
                "message": f"HF dataset must have at least 3 rows; got {n_hf}.",
                "detail": "", "recoverable": True, "allowed_actions": ["upload"],
            }),
            422,
        )

    if method not in ("bridge", "co_kriging"):
        method = "bridge"
    if base_model_type not in SUPPORTED_MODEL_TYPES:
        base_model_type = "rf"

    # ── Train model ───────────────────────────────────────────────────────────
    try:
        if method == "bridge":
            mf_model = BridgeCorrectionModel(_make_model(base_model_type, {}))
        else:
            mf_model = KOCoKrigingModel()
        mf_model.fit_multifidelity(X_lf, y_lf, X_hf, y_hf, input_cols, output_cols)
    except Exception as exc:
        return (
            jsonify({
                "success": False, "error_code": "TRAINING_FAILED",
                "message": str(exc),
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            500,
        )

    # ── In-sample HF evaluation (test metrics) ────────────────────────────────
    y_pred_hf = mf_model.predict(X_hf)
    if y_pred_hf.ndim == 1:
        y_pred_hf = y_pred_hf.reshape(-1, 1)

    test_metrics = compute_metrics(y_hf, y_pred_hf, output_cols)

    # ── LOO / k-fold comparison: MF vs HF-only RF ─────────────────────────────
    use_loo  = n_hf <= 30
    mf_loo   = _mf_loo_r2(X_lf, y_lf, X_hf, y_hf, input_cols, output_cols,
                           method, base_model_type, cv_folds, use_loo)
    hf_loo   = _hf_only_loo_r2(X_hf, y_hf, input_cols, output_cols,
                                cv_folds, use_loo)
    if method == "co_kriging":
        k_used   = min(5, max(2, n_hf // 3))
        cv_label = f"{k_used}-fold"
    elif use_loo:
        cv_label = "loo"
    else:
        cv_label = f"{cv_folds}-fold"

    mf_comparison = {
        "method":     method,
        "n_lf":       int(len(X_lf)),
        "n_hf":       int(n_hf),
        "cv_type":    cv_label,
        "per_output": [
            {
                "column":     col,
                "mf_r2":      round(mf_loo[i], 4),
                "hf_only_r2": round(hf_loo[i], 4),
            }
            for i, col in enumerate(output_cols)
        ],
    }

    # ── test_stds for co_kriging (GPR-based uncertainty) ─────────────────────
    test_stds = None
    if method == "co_kriging":
        test_stds = mf_model.predict_std(X_hf).tolist()

    # ── cv_results stub (LOO R² as CV R²) ────────────────────────────────────
    cv_results = {
        "n_folds": n_hf if use_loo else cv_folds,
        "per_output": [
            {
                "column":    col,
                "mean_r2":   round(mf_loo[i], 4),
                "std_r2":    0.0,
                "mean_rmse": 0.0,
                "std_rmse":  0.0,
                "mean_mae":  0.0,
                "std_mae":   0.0,
            }
            for i, col in enumerate(output_cols)
        ],
    }

    # ── Warnings ──────────────────────────────────────────────────────────────
    warnings = []
    if n_hf < 20:
        warnings.append(
            f"Only {n_hf} HF rows — test metrics are in-sample; "
            "LOO CV provides the unbiased comparison below."
        )
    if n_hf < len(input_cols) * 2:
        warnings.append(
            f"HF dataset has fewer rows ({n_hf}) than 2× the number of inputs "
            f"({len(input_cols) * 2}). Results may be unreliable."
        )
    if method == "bridge" and base_model_type in ("gpr", "kriging") and n_hf > 10:
        warnings.append(
            f"LOO/k-fold CV with bridge + {base_model_type} base refits the LF GP "
            f"once per fold. With {n_hf} HF rows this may be slow. "
            "Use 'rf' as the base model for faster CV."
        )
    if method == "co_kriging" and hasattr(mf_model, "_rhos"):
        for i, rho in enumerate(mf_model._rhos):
            col = output_cols[i] if i < len(output_cols) else f"output {i}"
            if rho <= 0.011 or rho >= 9.989:
                warnings.append(
                    f"ρ for '{col}' hit the clamp boundary ({rho:.3f}). "
                    "LF and HF fidelity levels may be poorly matched."
                )

    # ── Build result dict ─────────────────────────────────────────────────────
    lf_filename = lf_meta.get("filename", lf_key)
    hf_filename = hf_meta.get("filename", hf_key)
    result = {
        "model_type":       mf_model.model_type,
        "n_train":          int(len(X_lf)),
        "n_test":           int(n_hf),
        "source_filename":  f"LF: {lf_filename}  +  HF: {hf_filename}",
        "input_columns":    input_cols,
        "output_columns":   output_cols,
        "input_means":      {col: float(lf_df[col].mean()) for col in input_cols},
        "input_mins":       {col: float(lf_df[col].min()) for col in input_cols},
        "input_maxs":       {col: float(lf_df[col].max()) for col in input_cols},
        "test_metrics":     test_metrics,
        "cv_results":       cv_results,
        "warnings":         warnings,
        "test_actuals":     y_hf.tolist(),
        "test_predictions": y_pred_hf.tolist(),
        "test_stds":        test_stds,
        "test_inputs":      X_hf.tolist(),
        "mf_comparison":    mf_comparison,
        "hyperparams":      {"method": method, "base_model_type": base_model_type},
    }

    # ── Persist to STATE ──────────────────────────────────────────────────────
    models_dict = state["surrogate_sessions"]["primary"]["models"]
    models_dict.pop("interpretation", None)
    models_dict["trained"] = mf_model
    models_dict["results"] = result

    runs    = models_dict.setdefault("runs", [])
    run_num = len(runs) + 1
    run_entry        = dict(result)
    run_entry["run"] = run_num
    runs.append(run_entry)
    if len(runs) > MAX_MODEL_HISTORY:
        models_dict["runs"] = runs[-MAX_MODEL_HISTORY:]

    history = models_dict.setdefault("history", [])
    now_ts  = int(time.time())
    for m in test_metrics:
        history.append({
            "run":        run_num,
            "timestamp":  now_ts,
            "model_type": mf_model.model_type,
            "n_rows":     int(len(X_lf)) + int(n_hf),
            "output":     m["column"],
            "r2_test":    round(float(m["r2"]),   4),
            "rmse_test":  round(float(m["rmse"]), 4),
            "r2_cv":      round(mf_loo[output_cols.index(m["column"])], 4),
        })
    if len(history) > MAX_MODEL_HISTORY:
        models_dict["history"] = history[-MAX_MODEL_HISTORY:]

    append_audit_event(state, "multifidelity_trained", {
        "method": method, "n_lf": int(len(X_lf)), "n_hf": int(n_hf),
    })

    current_app.logger.info(
        f"Multi-fidelity trained — method={method}, "
        f"n_lf={len(X_lf)}, n_hf={n_hf}"
    )

    return jsonify({"success": True, "results": result}), 200


# ─── HELPERS ──────────────────────────────────────────────────────────────────


def _make_model(model_type: str, hyperparams: dict = None):
    """Instantiate the correct model class for model_type.

    Args:
        model_type:  One of "gpr", "rf", "linear".
        hyperparams: Optional dict of model-specific hyperparameter overrides.
                     Unknown keys are silently ignored; each constructor uses
                     its own defaults for missing keys.

    Returns:
        BaseSurrogateModel subclass instance (unfitted).

    Raises:
        Nothing — caller validates model_type before calling this.
    """
    hp = hyperparams or {}
    if model_type == "gpr":
        return GPRModel(
            kernel=hp.get("kernel", "rbf"),
            alpha=hp.get("alpha"),
        )
    if model_type == "kriging":
        return KrigingModel(
            kernel=hp.get("kernel", "matern25"),
            alpha=hp.get("alpha"),
        )
    if model_type == "rf":
        return RFModel(
            n_estimators=hp.get("n_estimators"),
            max_depth=hp.get("max_depth"),
            min_samples_leaf=hp.get("min_samples_leaf", 1),
            max_features=hp.get("max_features", "sqrt"),
        )
    if model_type == "rbf":
        return RBFModel(
            kernel=hp.get("kernel", "thin_plate_spline"),
            smoothing=hp.get("smoothing", 1e-3),
        )
    if model_type == "pce":
        return PCEModel(order=hp.get("order", 3))
    return LinearModel(alpha=hp.get("alpha", 1.0))


def _mf_loo_r2(
    X_lf, y_lf, X_hf, y_hf,
    input_cols, output_cols,
    method, base_model_type, cv_folds, use_loo,
):
    """LOO or k-fold CV R² for the MF model evaluated on held-out HF points."""
    from sklearn.model_selection import LeaveOneOut, KFold
    from sklearn.metrics import r2_score as sk_r2

    n_hf      = len(X_hf)
    n_outputs = y_hf.shape[1] if y_hf.ndim > 1 else 1
    if y_hf.ndim == 1:
        y_hf = y_hf.reshape(-1, 1)
    if y_lf.ndim == 1:
        y_lf = y_lf.reshape(-1, 1)

    if method == "co_kriging":
        k        = min(5, max(2, n_hf // 3))
        splitter = KFold(n_splits=k, shuffle=True, random_state=42)
    elif use_loo:
        splitter = LeaveOneOut()
    else:
        splitter = KFold(n_splits=min(cv_folds, n_hf // 2),
                         shuffle=True, random_state=42)

    y_true_all = [[] for _ in range(n_outputs)]
    y_pred_all = [[] for _ in range(n_outputs)]

    for tr_idx, te_idx in splitter.split(X_hf):
        if len(tr_idx) < 2:
            continue
        try:
            if method == "bridge":
                m = BridgeCorrectionModel(_make_model(base_model_type, {}))
            else:
                m = KOCoKrigingModel()
            m.fit_multifidelity(
                X_lf, y_lf, X_hf[tr_idx], y_hf[tr_idx],
                input_cols, output_cols,
            )
            preds = m.predict(X_hf[te_idx])
            if preds.ndim == 1:
                preds = preds.reshape(-1, 1)
            for i in range(n_outputs):
                y_true_all[i].extend(y_hf[te_idx, i].tolist())
                y_pred_all[i].extend(preds[:, i].tolist())
        except Exception:
            continue

    result = []
    for i in range(n_outputs):
        if len(y_true_all[i]) >= 2:
            try:
                result.append(float(sk_r2(y_true_all[i], y_pred_all[i])))
            except Exception:
                result.append(0.0)
        else:
            result.append(0.0)
    return result


def _hf_only_loo_r2(X_hf, y_hf, input_cols, output_cols, cv_folds, use_loo):
    """LOO or k-fold CV R² for an RF model trained on HF data only (baseline)."""
    from sklearn.model_selection import LeaveOneOut, KFold
    from sklearn.metrics import r2_score as sk_r2

    n_hf      = len(X_hf)
    n_outputs = y_hf.shape[1] if y_hf.ndim > 1 else 1
    if y_hf.ndim == 1:
        y_hf = y_hf.reshape(-1, 1)

    splitter = (LeaveOneOut() if use_loo
                else KFold(n_splits=min(cv_folds, n_hf // 2),
                           shuffle=True, random_state=42))

    y_true_all = [[] for _ in range(n_outputs)]
    y_pred_all = [[] for _ in range(n_outputs)]

    for tr_idx, te_idx in splitter.split(X_hf):
        if len(tr_idx) < 2:
            continue
        try:
            m = _make_model("rf", {})
            m.fit(X_hf[tr_idx], y_hf[tr_idx], input_cols, output_cols)
            preds = m.predict(X_hf[te_idx])
            if preds.ndim == 1:
                preds = preds.reshape(-1, 1)
            for i in range(n_outputs):
                y_true_all[i].extend(y_hf[te_idx, i].tolist())
                y_pred_all[i].extend(preds[:, i].tolist())
        except Exception:
            continue

    result = []
    for i in range(n_outputs):
        if len(y_true_all[i]) >= 2:
            try:
                result.append(float(sk_r2(y_true_all[i], y_pred_all[i])))
            except Exception:
                result.append(0.0)
        else:
            result.append(0.0)
    return result


def _convert_best_params(model_type: str, best: dict) -> dict:
    """Convert sklearn GridSearchCV best_params_ to our hyperparams dict format."""
    if model_type == "gpr":
        k = best.get("estimator__kernel")
        if isinstance(k, Matern):
            kernel_str = "matern15" if abs(k.nu - 1.5) < 0.01 else "matern25"
        else:
            kernel_str = "rbf"
        return {"kernel": kernel_str, "alpha": float(best["estimator__alpha"])}
    if model_type == "kriging":
        k = best.get("estimator__kernel")
        if isinstance(k, Matern):
            kernel_str = "matern15" if abs(k.nu - 1.5) < 0.01 else "matern25"
        elif isinstance(k, RationalQuadratic):
            kernel_str = "rq"
        else:
            kernel_str = "matern25"
        return {"kernel": kernel_str, "alpha": float(best["estimator__alpha"])}
    if model_type == "rf":
        return {
            "n_estimators":     int(best["n_estimators"]),
            "max_depth":        best["max_depth"],
            "min_samples_leaf": int(best["min_samples_leaf"]),
            "max_features":     best["max_features"],
        }
    return {"alpha": float(best["alpha"])}
