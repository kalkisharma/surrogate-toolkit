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
LAST MODIFIED: 2026-05-11
VERSION: 0.1.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

from flask import Blueprint, jsonify

from app.state.schema import get_state_json_safe

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
    return jsonify({"success": True, "state": get_state_json_safe()})


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

    return jsonify({"success": True, "session": session})
