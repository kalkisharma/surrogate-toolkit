"""
================================================================================
FILE: export_api.py
MODULE: app/api/
PURPOSE: Blueprint and routes for /api/export/*. Provides CSV download of
         cleaned and normalized datasets for user verification.
DEPENDENCIES: flask
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-14
VERSION: 0.9.6
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

from flask import Blueprint, Response, current_app, jsonify, session

bp = Blueprint("export", __name__)


def _get_active_ds():
    """Return the active dataset dict, or None if none is loaded."""
    state      = current_app.config["STATE"]
    active_key = state["datasets"]["active_dataset_key"]
    _datasets  = state["datasets"]["_datasets"]
    if not active_key or active_key not in _datasets:
        return None
    return _datasets[active_key]


def _csv_response(df, filename):
    """Stream a DataFrame as a CSV attachment, prepending a classification header if needed."""
    classification = session.get("classification", "Unclassified")
    csv_str = df.to_csv(index=False)
    if classification and classification != "Unclassified":
        csv_str = f"# Classification: {classification}\n" + csv_str
    return Response(
        csv_str,
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@bp.route("/clean", methods=["GET"])
def export_clean():
    """Download the cleaned dataset as a CSV file."""
    ds = _get_active_ds()
    if ds is None or ds.get("clean") is None:
        return (
            jsonify({
                "success": False, "error_code": "NO_DATA",
                "message": "No cleaned dataset available. Upload and clean a CSV first.",
                "detail": "", "recoverable": True, "allowed_actions": ["upload"],
            }),
            404,
        )
    return _csv_response(ds["clean"], "clean_data.csv")


@bp.route("/normalized", methods=["GET"])
def export_normalized():
    """Download the normalized dataset as a CSV file."""
    ds = _get_active_ds()
    if ds is None or ds.get("normalized") is None:
        return (
            jsonify({
                "success": False, "error_code": "NO_DATA",
                "message": "No normalized dataset available. Apply normalization first.",
                "detail": "", "recoverable": True, "allowed_actions": ["normalize"],
            }),
            404,
        )
    return _csv_response(ds["normalized"], "normalized_data.csv")
