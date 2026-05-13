"""
================================================================================
FILE: model_api.py
MODULE: app/api/
PURPOSE: Blueprint and route handlers for /api/model/*. Manages training
         configuration: model type, train/test split, and cross-validation
         folds. Actual model training is wired up in Phase 3 (0.7.x).
DEPENDENCIES: flask, app.state.schema, config.settings
FUTURE EXTENSIONS: POST /api/model/train, GET /api/model/results,
                   GET /api/model/metrics, POST /api/model/predict.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-12
VERSION: 0.6.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

from flask import Blueprint, current_app, jsonify, request

from app.state.schema import append_audit_event
from config.settings import (
    CV_FOLDS_MAX,
    CV_FOLDS_MIN,
    SUPPORTED_MODEL_TYPES,
    TEST_SPLIT_MAX,
    TEST_SPLIT_MIN,
)

bp = Blueprint("model", __name__)

# ─── ERROR CODE → HTTP STATUS ─────────────────────────────────────────────────

_ERROR_HTTP_STATUS = {
    "UNKNOWN_MODEL_TYPE": 422,
    "INVALID_TEST_SPLIT": 422,
    "INVALID_CV_FOLDS":   422,
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
