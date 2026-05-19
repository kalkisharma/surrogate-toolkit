"""
================================================================================
FILE: state_api.py
MODULE: app/api/
PURPOSE: Blueprint for /api/state/* — exposes the live STATE dict to the
         frontend as JSON. Used by state.js refreshState() after every mutating
         POST.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-14
VERSION: 1.2.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

from flask import Blueprint, jsonify, send_file

from app.state.schema import append_audit_event, get_state_json_safe, reset_state
from config.settings import DEFAULT_CV_FOLDS, DEFAULT_TEST_SPLIT

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
        # Save current surrogate session to the outgoing dataset so it can be
        # restored when the user switches back.
        if prev_key and prev_key in _datasets:
            _datasets[prev_key]["surrogate_session"] = {
                "models": state["surrogate_sessions"]["primary"]["models"],
                "config": {**state["surrogate_sessions"]["primary"]["config"]},
            }
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
        # Restore the surrogate session for the incoming dataset.
        # If it has never been trained, models is empty and results returns 404.
        surrogate = state["surrogate_sessions"]["primary"]
        new_ss = ds.get("surrogate_session", {})
        surrogate["models"] = new_ss.get("models", {})
        surrogate["config"]  = new_ss.get("config", {
            "model_type": None,
            "test_split":  DEFAULT_TEST_SPLIT,
            "cv_folds":    DEFAULT_CV_FOLDS,
        })
        from flask import current_app
        current_app.logger.info(f"Active dataset switched to '{new_key}'")
        append_audit_event(state, "dataset_switch", {
            "from": prev_key,
            "to":   new_key,
        })

    return jsonify({"success": True, "session": session})


@bp.route("/save", methods=["POST"])
def save_project():
    """
    Serialize the current STATE to a .surrogate ZIP file and return it as a
    file download. DataFrames → Parquet; fitted models → Pickle.

    Returns:
        200 application/octet-stream: The .surrogate ZIP file as an attachment.
        500 JSON: Error envelope if serialization fails.
    """
    import io
    from flask import current_app
    from app.state.session import save_session

    state = current_app.config["STATE"]
    try:
        data = save_session(state)
    except Exception as e:
        current_app.logger.exception("Failed to serialize project")
        return jsonify({
            "success": False,
            "message": f"Failed to save project: {e}",
        }), 500

    project_name = (
        state["session"].get("project_name")
        or state["datasets"]["primary"].get("metadata", {}).get("filename", "").replace(".csv", "")
        or "session"
    )
    filename = f"{project_name}.surrogate"
    append_audit_event(state, "project_saved", {"filename": filename})

    return send_file(
        io.BytesIO(data),
        attachment_filename=filename,
        as_attachment=True,
        mimetype="application/octet-stream",
    )


@bp.route("/load", methods=["POST"])
def load_project():
    """
    Accept a .surrogate ZIP file upload, restore STATE from it, and return
    metadata about the loaded session.

    Args (multipart/form-data):
        file: The .surrogate file.

    Returns:
        JSON 200: {"success": True, "meta": {...}, "n_datasets": int}
        JSON 400: Error envelope for bad/missing file or corrupt archive.
    """
    from flask import current_app, request
    from app.state.session import load_session

    if "file" not in request.files:
        return jsonify({"success": False, "message": "No file provided."}), 400

    f = request.files["file"]
    if not f.filename.lower().endswith(".surrogate"):
        return jsonify({
            "success": False,
            "message": "Invalid file type. Only .surrogate files can be loaded.",
        }), 400

    try:
        meta, loaded = load_session(f.read())
    except Exception as e:
        current_app.logger.exception("Failed to deserialize project")
        return jsonify({
            "success": False,
            "message": f"Failed to load project: {e}",
        }), 400

    # Restore STATE in-place so app.config["STATE"] reference stays valid
    state = current_app.config["STATE"]
    state.clear()
    state.update(loaded)

    append_audit_event(state, "project_loaded", {
        "filename":          f.filename,
        "surrogate_version": meta.get("surrogate_version"),
    })
    current_app.logger.info(
        f"Project loaded: {f.filename} (saved with v{meta.get('surrogate_version')})"
    )

    return jsonify({
        "success":    True,
        "meta":       meta,
        "n_datasets": len(state["datasets"].get("_datasets", {})),
    }), 200


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
