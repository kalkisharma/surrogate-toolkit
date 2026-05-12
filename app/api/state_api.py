"""
================================================================================
FILE: state_api.py
MODULE: app/api/
PURPOSE: Blueprint for /api/state/* — exposes the live STATE dict to the
         frontend as JSON. Used by state.js refreshState() after every mutating
         POST.
DEPENDENCIES: flask, app.state.schema
FUTURE EXTENSIONS: Partial STATE updates via PATCH, STATE diff endpoint,
                   per-session STATE isolation.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-12
VERSION: 0.4.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

from flask import Blueprint, jsonify

from app.state.schema import append_audit_event, get_state_json_safe, reset_state

bp = Blueprint("state", __name__)


@bp.route("/", methods=["GET"])
def get_state():
    """
    Return the current STATE as JSON with DataFrames replaced by metadata.

    The frontend calls this after every mutating POST to keep its local copy
    in sync. DataFrames are serialized as lightweight metadata objects so the
    response stays small.

    Args:
        None

    Returns:
        JSON: {"success": True, "state": <json-safe STATE dict>}

    Future:
        Support ETag-based conditional GET to skip sending unchanged STATE.
    """
    from config.settings import VERSION
    return jsonify({"success": True, "version": VERSION, "state": get_state_json_safe()})


@bp.route("/session", methods=["PUT"])
def update_session():
    """
    Update session-level settings (gates: data_type, experience_level,
    processor settings, learning mode).

    Args (JSON body):
        data_type (str, optional)
        experience_level (str, optional)
        processor_mode (str, optional)
        processor_count (int, optional)
        learning_mode (bool, optional)
        classification (str, optional)
        program (str, optional)

    Returns:
        JSON: {"success": True, "session": <updated session dict>}

    Future:
        Validate experience_level against SUPPORTED_EXPERIENCE_LEVELS.
        Validate classification against SUPPORTED_CLASSIFICATIONS.
    """
    from flask import current_app, request

    state = current_app.config["STATE"]
    session = state["session"]
    data = request.get_json(silent=True) or {}

    allowed_fields = {
        "data_type",
        "experience_level",
        "processor_mode",
        "processor_count",
        "learning_mode",
        "classification",
        "program",
        "project_name",
    }

    for field in allowed_fields:
        if field in data:
            session[field] = data[field]

    # Mirror learning_mode and experience_level into ui subtree
    if "learning_mode" in data:
        state["ui"]["learning_mode"] = data["learning_mode"]
    if "experience_level" in data:
        state["ui"]["experience_level"] = data["experience_level"]
    if "classification" in data:
        state["compliance"]["classification"] = data["classification"]

    # When data_type is set, also annotate the active dataset's metadata
    if "data_type" in data:
        active_key = state["datasets"].get("active_dataset_key")
        if active_key and active_key in state["datasets"]["_datasets"]:
            state["datasets"]["_datasets"][active_key]["metadata"]["data_type"] = data["data_type"]
        state["datasets"]["primary"]["metadata"]["data_type"] = data["data_type"]
        append_audit_event(state, "data_type_set", {
            "data_type": data["data_type"],
            "dataset":   active_key,
        })

    # ── Active dataset switch ─────────────────────────────────────────────────
    if "active_dataset_key" in data:
        from datetime import datetime, timezone
        new_key    = data["active_dataset_key"]
        _datasets  = state["datasets"]["_datasets"]
        if new_key not in _datasets:
            return (
                jsonify({
                    "success":    False,
                    "error_code": "DATASET_NOT_FOUND",
                    "message":    f"Dataset '{new_key}' is not loaded in this session.",
                }),
                404,
            )
        prev_key = state["datasets"]["active_dataset_key"]
        # Mirror selected dataset to primary
        ds = _datasets[new_key]
        ds["last_accessed"] = datetime.now(timezone.utc).isoformat()
        state["datasets"]["active_dataset_key"] = new_key
        primary = state["datasets"]["primary"]
        primary["raw"]        = ds["raw"]
        primary["clean"]      = ds["clean"]
        primary["normalized"] = ds.get("normalized")  # may be None if not yet normalized
        primary["metadata"].update(ds["metadata"])
        # Sync data_type to session
        session["data_type"] = ds["metadata"].get("data_type")
        from flask import current_app
        current_app.logger.info(f"Active dataset switched to '{new_key}'")
        append_audit_event(state, "dataset_switch", {
            "from": prev_key,
            "to":   new_key,
        })

    return jsonify({"success": True, "session": session})


@bp.route("/reset", methods=["POST"])
def reset():
    """
    Reset STATE to canonical defaults, clearing all loaded datasets and session data.

    Returns:
        JSON: {"success": True}
    """
    from flask import current_app
    from app.state.schema import STATE
    reset_state()
    append_audit_event(STATE, "reset", {})  # first event of the new session
    current_app.logger.info("Session reset via POST /api/state/reset")
    return jsonify({"success": True})
