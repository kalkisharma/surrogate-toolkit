"""
================================================================================
FILE: optimization_api.py
MODULE: app/api/
PURPOSE: Blueprint and routes for /api/optimize/*. Single-objective and
         multi-objective surrogate optimization endpoints.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-15
LAST MODIFIED: 2026-05-15
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

from flask import Blueprint, current_app, jsonify, request

from app.state.schema import append_audit_event

bp = Blueprint("optimize", __name__)

_MAX_HISTORY = 5


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_model_and_results(state):
    models_dict = state["surrogate_sessions"]["primary"]["models"]
    return models_dict.get("trained"), models_dict.get("results")


def _denorm_value(v, col, params):
    """Inverse-transform a single normalized scalar back to original space."""
    p = params.get(col)
    if p is None:
        return v
    method = p.get("method", "none")
    if method == "minmax":
        return v * (p["max"] - p["min"]) + p["min"]
    if method == "zscore":
        return v * p["std"] + p["mean"]
    return v


def _norm_value(v, col, params):
    """Apply the forward normalization transform to a single scalar."""
    p = params.get(col)
    if p is None:
        return v
    method = p.get("method", "none")
    if method == "minmax":
        rng = p["max"] - p["min"]
        return (v - p["min"]) / rng if rng != 0 else 0.0
    if method == "zscore":
        return (v - p["mean"]) / p["std"] if p["std"] != 0 else 0.0
    return v


def _get_norm_context(state):
    """Return (norm_params, orig_mins, orig_maxs) for the primary dataset."""
    meta        = state["datasets"]["primary"]["metadata"]
    norm_params = meta.get("normalization_params", {})
    primary     = state["datasets"]["primary"]
    clean_df    = primary.get("clean")
    input_cols  = list(state["surrogate_sessions"]["primary"]["models"]
                       .get("results", {}).get("input_columns", []))
    if clean_df is not None:
        orig_mins = {col: float(clean_df[col].min()) for col in input_cols if col in clean_df.columns}
        orig_maxs = {col: float(clean_df[col].max()) for col in input_cols if col in clean_df.columns}
    else:
        results   = state["surrogate_sessions"]["primary"]["models"].get("results", {})
        orig_mins = results.get("input_mins", {})
        orig_maxs = results.get("input_maxs", {})
    return norm_params, orig_mins, orig_maxs


def _default_bounds(state, input_cols):
    """Return original-space default bounds from the clean dataframe."""
    _, orig_mins, orig_maxs = _get_norm_context(state)
    return {col: [float(orig_mins.get(col, 0.0)), float(orig_maxs.get(col, 1.0))]
            for col in input_cols}


def _merge_bounds(defaults, user_bounds, input_cols):
    merged = dict(defaults)
    for col, rng in (user_bounds or {}).items():
        if col in merged and isinstance(rng, list) and len(rng) == 2:
            lo, hi = float(rng[0]), float(rng[1])
            if lo < hi:
                merged[col] = [lo, hi]
    return merged


def _store_history(state, entry):
    hist = state.setdefault("optimization", {}).setdefault("history", [])
    hist.append(entry)
    if len(hist) > _MAX_HISTORY:
        state["optimization"]["history"] = hist[-_MAX_HISTORY:]


# ── Single-objective ──────────────────────────────────────────────────────────

@bp.route("/single", methods=["POST"])
def optimize_single():
    """
    Run differential_evolution to find the input combination that minimizes or
    maximizes one output column.

    Body (JSON):
        output_col   (str):  target output column
        direction    (str):  "minimize" | "maximize"
        bounds       (dict): {col: [min, max]} overrides per input (optional)
        constraints  (list): [{"output_col", "operator", "threshold"}] (optional)
        n_population (int):  DE population hint (default 50, max 500)
        max_iter     (int):  max generations (default 200, max 1000)
    """
    state  = current_app.config["STATE"]
    model, results = _get_model_and_results(state)
    if model is None or results is None:
        return jsonify({
            "success": False, "error_code": "NO_TRAINED_MODEL",
            "message": "No trained model. Train a model in Step 7 first.",
        }), 404

    data        = request.get_json(silent=True) or {}
    input_cols  = results["input_columns"]
    output_cols = results["output_columns"]

    output_col   = data.get("output_col", output_cols[0])
    direction    = data.get("direction", "minimize")
    constraints  = data.get("constraints", [])
    n_population = min(int(data.get("n_population", 50)), 500)
    max_iter     = min(int(data.get("max_iter", 200)), 1000)

    if output_col not in output_cols:
        output_col = output_cols[0]
    if direction not in ("minimize", "maximize"):
        direction = "minimize"

    # Bounds are in original (pre-normalization) space; normalize for optimizer.
    norm_params, _, _ = _get_norm_context(state)
    orig_bounds = _merge_bounds(
        _default_bounds(state, input_cols),
        data.get("bounds"),
        input_cols,
    )
    norm_bounds = {
        col: [_norm_value(lo, col, norm_params), _norm_value(hi, col, norm_params)]
        for col, (lo, hi) in orig_bounds.items()
    }

    from app.ml.optimization.single_objective import SingleObjectiveOptimizer
    try:
        result = SingleObjectiveOptimizer().optimize(
            model, input_cols, output_cols, norm_bounds,
            output_col, direction, constraints, n_population, max_iter,
        )
    except Exception as exc:
        return jsonify({
            "success": False, "error_code": "OPTIMIZER_ERROR",
            "message": str(exc),
        }), 500

    # Denormalize best_inputs to original space for display.
    result["best_inputs"] = {
        col: _denorm_value(v, col, norm_params)
        for col, v in result["best_inputs"].items()
    }

    _store_history(state, result)
    append_audit_event(state, "optimization_single", {
        "output_col":    output_col,
        "direction":     direction,
        "n_evaluations": result["n_evaluations"],
        "converged":     result["converged"],
    })

    return jsonify({"success": True, **result}), 200


# ── Multi-objective ───────────────────────────────────────────────────────────

@bp.route("/multi", methods=["POST"])
def optimize_multi():
    """
    Run NSGA-II to find the Pareto front across two or more output objectives.

    Body (JSON):
        objectives (list): [{"output_col", "direction"}]
        bounds     (dict): {col: [min, max]} overrides per input (optional)
        pop_size   (int):  NSGA-II population size (default 100, max 500)
        n_gen      (int):  number of generations (default 100, max 500)
    """
    state  = current_app.config["STATE"]
    model, results = _get_model_and_results(state)
    if model is None or results is None:
        return jsonify({
            "success": False, "error_code": "NO_TRAINED_MODEL",
            "message": "No trained model. Train a model in Step 7 first.",
        }), 404

    data        = request.get_json(silent=True) or {}
    input_cols  = results["input_columns"]
    output_cols = results["output_columns"]

    objectives = data.get("objectives") or [
        {"output_col": c, "direction": "minimize"} for c in output_cols[:2]
    ]
    pop_size = min(int(data.get("pop_size", 100)), 500)
    n_gen    = min(int(data.get("n_gen",    100)), 500)

    norm_params, _, _ = _get_norm_context(state)
    orig_bounds = _merge_bounds(
        _default_bounds(state, input_cols),
        data.get("bounds"),
        input_cols,
    )
    norm_bounds = {
        col: [_norm_value(lo, col, norm_params), _norm_value(hi, col, norm_params)]
        for col, (lo, hi) in orig_bounds.items()
    }

    from app.ml.optimization.multi_objective import MultiObjectiveOptimizer
    try:
        result = MultiObjectiveOptimizer().optimize(
            model, input_cols, output_cols, norm_bounds,
            objectives, pop_size, n_gen,
        )
    except ImportError as exc:
        return jsonify({
            "success": False, "error_code": "PYMOO_NOT_INSTALLED",
            "message": str(exc),
        }), 503
    except Exception as exc:
        return jsonify({
            "success": False, "error_code": "OPTIMIZER_ERROR",
            "message": str(exc),
        }), 500

    # Denormalize Pareto solution inputs to original space for display.
    result["pareto_inputs"] = [
        {col: _denorm_value(v, col, norm_params) for col, v in row.items()}
        for row in result.get("pareto_inputs", [])
    ]

    _store_history(state, result)
    append_audit_event(state, "optimization_multi", {
        "n_objectives": len(objectives),
        "n_solutions":  result["n_solutions"],
    })

    return jsonify({"success": True, **result}), 200


# ── History ───────────────────────────────────────────────────────────────────

@bp.route("/history", methods=["GET"])
def get_history():
    """Return stored optimization runs (most recent first)."""
    state = current_app.config["STATE"]
    hist  = state.get("optimization", {}).get("history", [])
    return jsonify({"success": True, "history": list(reversed(hist))}), 200
