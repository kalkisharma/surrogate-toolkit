"""
================================================================================
FILE: active_learning_api.py
MODULE: app/api/
PURPOSE: Blueprint and routes for /api/active/* — coverage, objective-mode,
         and residual-guided active learning recommendations.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-26
VERSION: 1.1.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import numpy as np
from datetime import datetime, timezone
from flask import Blueprint, current_app, jsonify, request

from app.state.schema import append_audit_event
from config.settings import MAX_ACTIVE_LEARNING_HISTORY

bp = Blueprint("active", __name__)


# ── Coverage mode ─────────────────────────────────────────────────────────────

@bp.route("/coverage", methods=["POST"])
def coverage():
    """
    Generate space-filling recommendations using max-min distance criterion.

    Args (JSON body):
        n_recommendations (int, optional): Default 10, max 50.
        n_candidates (int, optional):      Default 2000, max 10000.

    Returns:
        JSON 200: {"success": True, "mode": "coverage", "recommendations": [...], ...}
        JSON 404: No trained model.
    """
    state  = current_app.config["STATE"]
    data   = request.get_json(silent=True) or {}
    n_recs = min(int(data.get("n_recommendations", 10)), 50)
    n_cand = min(int(data.get("n_candidates", 2000)), 10000)

    X_train, input_cols, err = _get_training_data(state)
    if err:
        return jsonify(err), 404

    from app.ml.active_learning.coverage_mode import CoverageRecommender
    result = CoverageRecommender().recommend(X_train, input_cols, n_recs, n_cand)
    _denorm_recommendations(result, state)

    _store_history(state, result)
    append_audit_event(state, "active_learning_recommendations", {
        "mode": "coverage", "n_recommendations": n_recs,
    })

    return jsonify({"success": True, **result}), 200


# ── Objective mode ────────────────────────────────────────────────────────────

@bp.route("/objective", methods=["POST"])
def objective():
    """
    Generate objective-guided recommendations using EI or UCB.

    Args (JSON body):
        n_recommendations (int, optional): Default 10, max 50.
        n_candidates (int, optional):      Default 2000, max 10000.
        acquisition (str, optional):       "EI" (default) or "UCB".
        direction (str, optional):         "minimize" (default) or "maximize".
        output_col (str, optional):        Target output column name.
        kappa (float, optional):           UCB exploration weight. Default 2.0.

    Returns:
        JSON 200: {"success": True, "mode": "objective", "recommendations": [...], ...}
        JSON 404: No trained model.
    """
    state       = current_app.config["STATE"]
    data        = request.get_json(silent=True) or {}
    n_recs      = min(int(data.get("n_recommendations", 10)), 50)
    n_cand      = min(int(data.get("n_candidates", 2000)), 10000)
    acquisition = data.get("acquisition", "EI")
    direction   = data.get("direction", "minimize")
    output_col  = data.get("output_col")
    kappa       = float(data.get("kappa", 2.0))

    X_train, input_cols, err = _get_training_data(state)
    if err:
        return jsonify(err), 404

    models_dict = state["surrogate_sessions"]["primary"]["models"]
    model       = models_dict.get("trained")
    results     = models_dict.get("results")
    output_cols = results["output_columns"]
    if not output_col or output_col not in output_cols:
        output_col = output_cols[0]
    output_idx = output_cols.index(output_col)
    model_type = results["model_type"]

    from app.ml.active_learning.objective_mode import ObjectiveRecommender
    result = ObjectiveRecommender().recommend(
        model, X_train, input_cols, output_idx,
        n_recs, n_cand, acquisition, direction, model_type, kappa,
    )
    result["output_col"] = output_col
    _denorm_recommendations(result, state)

    _store_history(state, result)
    append_audit_event(state, "active_learning_recommendations", {
        "mode": "objective", "acquisition": acquisition,
        "output_col": output_col, "n_recommendations": n_recs,
    })

    return jsonify({"success": True, **result}), 200


# ── Residual mode ─────────────────────────────────────────────────────────────

@bp.route("/residual", methods=["POST"])
def residual():
    """
    Generate residual-guided recommendations targeting high-error test regions.

    score(c) = Σ_t |residual_t| · exp(−‖c − t‖² / 2h²)
    where h = median pairwise distance of test points.

    Args (JSON body):
        n_recommendations (int, optional): Default 10, max 50.
        n_candidates (int, optional):      Default 2000, max 10000.
        output_col (str, optional):        Which output's residuals to use.

    Returns:
        JSON 200: {"success": True, "mode": "residual", "recommendations": [...], ...}
        JSON 404: No trained model or no test data.
    """
    state      = current_app.config["STATE"]
    data       = request.get_json(silent=True) or {}
    n_recs     = min(int(data.get("n_recommendations", 10)), 50)
    n_cand     = min(int(data.get("n_candidates", 2000)), 10000)
    output_col = data.get("output_col")

    X_train, input_cols, err = _get_training_data(state)
    if err:
        return jsonify(err), 404

    models_dict      = state["surrogate_sessions"]["primary"]["models"]
    results          = models_dict.get("results")
    output_cols      = results["output_columns"]
    if not output_col or output_col not in output_cols:
        output_col = output_cols[0]
    output_idx       = output_cols.index(output_col)

    test_inputs      = results.get("test_inputs") or []
    test_actuals     = results.get("test_actuals") or []
    test_predictions = results.get("test_predictions") or []

    if not test_inputs:
        return jsonify({
            "success": False,
            "error_code": "NO_TEST_DATA",
            "message": "No test data available. Retrain the model to generate test-set residuals.",
        }), 404

    X_test    = np.array(test_inputs)
    actuals   = np.array(test_actuals)[:, output_idx]
    predicted = np.array(test_predictions)[:, output_idx]
    residuals = np.abs(actuals - predicted)

    from app.ml.active_learning.residual_mode import ResidualRecommender
    result = ResidualRecommender().recommend(
        X_train, X_test, residuals, input_cols, n_recs, n_cand,
    )
    result["output_col"] = output_col
    _denorm_recommendations(result, state)

    _store_history(state, result)
    append_audit_event(state, "active_learning_recommendations", {
        "mode": "residual", "output_col": output_col, "n_recommendations": n_recs,
    })

    return jsonify({"success": True, **result}), 200


# ── History ───────────────────────────────────────────────────────────────────

@bp.route("/history", methods=["GET"])
def get_history():
    """Return stored active learning history (most recent first)."""
    state   = current_app.config["STATE"]
    history = list(reversed(state["active_learning"]["history"]))
    return jsonify({"success": True, "history": history, "count": len(history)}), 200


# ── Helpers ───────────────────────────────────────────────────────────────────

def _denorm_recommendations(result, state):
    """Denormalize recommendation input coordinates and bounds to original space in-place."""
    meta        = state["datasets"]["primary"]["metadata"]
    norm_params = meta.get("normalization_params", {})
    primary     = state["datasets"]["primary"]
    clean_df    = primary.get("clean")
    input_cols  = result.get("input_cols", [])

    def _denorm(v, col):
        p = norm_params.get(col)
        if not p:
            return v
        m = p.get("method", "none")
        if m == "minmax":
            return v * (p["max"] - p["min"]) + p["min"]
        if m == "zscore":
            return v * p["std"] + p["mean"]
        return v

    for rec in result.get("recommendations", []):
        for col in input_cols:
            if col in rec:
                rec[col] = _denorm(float(rec[col]), col)

    # Update bounds to original space
    if clean_df is not None:
        result["bounds"] = {
            "min": {col: float(clean_df[col].min()) for col in input_cols if col in clean_df.columns},
            "max": {col: float(clean_df[col].max()) for col in input_cols if col in clean_df.columns},
        }


def _get_training_data(state):
    """Return (X_train, input_cols, error_dict). error_dict is None on success."""
    models_dict = state["surrogate_sessions"]["primary"]["models"]
    results     = models_dict.get("results")

    if results is None:
        return None, None, {
            "success": False,
            "error_code": "NO_TRAINED_MODEL",
            "message": "No trained model. Complete Step 8 — Model first.",
        }

    input_cols = results["input_columns"]
    primary    = state["datasets"]["primary"]
    _norm      = primary.get("normalized")
    _clean     = primary.get("clean")
    df         = _norm if _norm is not None else _clean
    X_train    = df[input_cols].values

    return X_train, input_cols, None


def _store_history(state, result):
    """Append result to active_learning history, capped at MAX_ACTIVE_LEARNING_HISTORY."""
    history = state["active_learning"]["history"]
    entry   = {**result, "timestamp": datetime.now(timezone.utc).isoformat()}
    history.append(entry)
    while len(history) > MAX_ACTIVE_LEARNING_HISTORY:
        history.pop(0)
