"""
================================================================================
FILE: export_api.py
MODULE: app/api/
PURPOSE: Blueprint and routes for /api/export/*. Provides CSV download of
         cleaned and normalized datasets, HTML report generation, audit log
         export, and surrogate model bundle download.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-26
VERSION: 1.2.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import io
from datetime import datetime, timezone

from flask import Blueprint, Response, current_app, jsonify, render_template, request, send_file

from app.compliance.audit import format_audit_csv, record_export, set_file_hash
from app.compliance.classification import requires_confirmation
from app.ml.export.bundle import build_export_bundle
from app.report.generator import build_report_data
from app.state.schema import append_audit_event

bp = Blueprint("export", __name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_active_ds():
    """Return the active dataset dict, or None if none is loaded."""
    state      = current_app.config["STATE"]
    active_key = state["datasets"]["active_dataset_key"]
    _datasets  = state["datasets"]["_datasets"]
    if not active_key or active_key not in _datasets:
        return None
    return _datasets[active_key]


def _csv_response(df, filename):
    """Stream a DataFrame as a CSV attachment, prepending a classification comment if needed."""
    state          = current_app.config["STATE"]
    classification = state["compliance"].get("classification", "Unclassified")
    csv_str = df.to_csv(index=False)
    if classification and classification != "Unclassified":
        csv_str = f"# Classification: {classification}\n" + csv_str
    return Response(
        csv_str,
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ── CSV data exports ──────────────────────────────────────────────────────────

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


# ── Report generation ─────────────────────────────────────────────────────────

@bp.route("/report", methods=["POST"])
def export_report():
    """
    Generate and download an HTML analysis report.

    Body (JSON):
        classification (str): Classification label for the report.
        acknowledged   (bool): Must be True for ITAR/EAR classifications.

    Returns:
        200: HTML file download.
        400: ITAR/EAR acknowledgment missing.
    """
    state  = current_app.config["STATE"]
    data   = request.get_json(silent=True) or {}

    classification = data.get("classification", "Unclassified")
    acknowledged   = bool(data.get("acknowledged", False))

    if requires_confirmation(classification) and not acknowledged:
        return jsonify({
            "success":    False,
            "error_code": "CONFIRMATION_REQUIRED",
            "message":    (
                f"Generating a {classification}-marked report requires explicit acknowledgment. "
                "Set acknowledged=true in the request body."
            ),
        }), 400

    report_data  = build_report_data(state, classification)
    html_content = render_template("report/report_base.html", **report_data)
    html_bytes   = html_content.encode("utf-8")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename  = f"surrogate_report_{timestamp}.html"

    entry = record_export(state, filename, classification, acknowledged)
    set_file_hash(entry, html_bytes)

    append_audit_event(state, "report_exported", {
        "filename":       filename,
        "classification": classification,
    })

    current_app.logger.info(f"Report exported — {filename} [{classification}]")

    return send_file(
        io.BytesIO(html_bytes),
        attachment_filename=filename,
        as_attachment=True,
        mimetype="text/html",
    )


# ── Audit log export ──────────────────────────────────────────────────────────

@bp.route("/audit", methods=["GET"])
def export_audit():
    """Download the export audit log as a CSV file."""
    state    = current_app.config["STATE"]
    csv_text = format_audit_csv(state)
    return Response(
        csv_text,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=export_audit_log.csv"},
    )


# ── Model bundle download ─────────────────────────────────────────────────────

@bp.route("/model", methods=["POST"])
def export_model():
    """
    Build and download a self-contained surrogate model export bundle.

    Body (JSON):
        classification (str): Classification label.
        acknowledged   (bool): Must be True for ITAR/EAR classifications.

    Returns:
        200: ZIP file download containing model, pipeline metadata,
             surrogate.py wrapper, and README.
        400: ITAR/EAR acknowledgment missing.
        422: No trained model in STATE.
    """
    state = current_app.config["STATE"]
    data  = request.get_json(silent=True) or {}

    classification = data.get("classification", "Unclassified")
    acknowledged   = bool(data.get("acknowledged", False))

    if requires_confirmation(classification) and not acknowledged:
        return jsonify({
            "success":    False,
            "error_code": "CONFIRMATION_REQUIRED",
            "message":    (
                f"Exporting a {classification}-marked model requires explicit "
                "acknowledgment. Set acknowledged=true in the request body."
            ),
        }), 400

    try:
        zip_bytes, zip_name = build_export_bundle(state)
    except ValueError as exc:
        return jsonify({
            "success":    False,
            "error_code": "NO_MODEL",
            "message":    str(exc),
        }), 422

    entry = record_export(state, zip_name, classification, acknowledged)
    set_file_hash(entry, zip_bytes)

    append_audit_event(state, "model_exported", {
        "filename":       zip_name,
        "classification": classification,
        "model_type":     (
            state["surrogate_sessions"]["primary"]["models"]
            .get("results", {}).get("model_type", "unknown")
        ),
    })

    current_app.logger.info(f"Model bundle exported — {zip_name} [{classification}]")

    return send_file(
        io.BytesIO(zip_bytes),
        attachment_filename=zip_name,
        as_attachment=True,
        mimetype="application/zip",
    )


# ── Export log (JSON) ─────────────────────────────────────────────────────────

@bp.route("/log", methods=["GET"])
def get_export_log():
    """Return the export log as JSON for the frontend history table."""
    state = current_app.config["STATE"]
    log   = state["compliance"].get("export_log", [])
    return jsonify({"success": True, "log": log}), 200
