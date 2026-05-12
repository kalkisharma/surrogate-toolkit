"""
================================================================================
FILE: data_api.py
MODULE: app/api/
PURPOSE: Blueprint and route handlers for /api/data/*. Wires the ingestion
         pipeline to the HTTP API, updates STATE, and returns standardised
         JSON responses.
DEPENDENCIES: flask, numpy, werkzeug.utils, app.data.ingestion, app.state.schema
FUTURE EXTENSIONS: GET /api/data/summary (full-dataset stats), POST /api/data/clean,
                   POST /api/data/normalize, POST /api/data/reduce,
                   GET /api/data/visualization, POST /api/data/filter.
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

import numpy as np
from flask import Blueprint, current_app, jsonify, request
from werkzeug.utils import secure_filename

from app.data.ingestion import ingest_csv

bp = Blueprint("data", __name__)

# ─── ERROR CODE → HTTP STATUS ─────────────────────────────────────────────────

_ERROR_HTTP_STATUS = {
    "FILE_TOO_LARGE": 413,
    "INVALID_FILE_TYPE": 415,
    "ENCODING_ERROR": 415,
    "CSV_PARSE_ERROR": 422,
    "DUPLICATE_HEADERS": 422,
    "HEADER_TOO_LONG": 422,
    "INSUFFICIENT_ROWS": 422,
    "TOO_MANY_ROWS": 422,
    "INSUFFICIENT_COLUMNS": 422,
    "TOO_MANY_COLUMNS": 422,
    "EXCESSIVE_NULLS": 422,
    "NON_NUMERIC_COLUMNS": 422,
    "FILE_READ_ERROR": 400,
    "NO_FILE": 400,
    "NO_FILENAME": 400,
    "NO_DATA": 400,
}


def _http_status(error_code: str) -> int:
    return _ERROR_HTTP_STATUS.get(error_code, 400)


# ─── ROUTES ───────────────────────────────────────────────────────────────────


@bp.route("/upload", methods=["POST"])
def upload():
    """
    Receive a multipart/form-data CSV upload, validate and ingest it, update
    STATE, and return a data preview.

    The frontend must send the file with the field name 'file'. Do NOT set
    Content-Type manually — the browser sets it with the multipart boundary.

    Args (multipart form data):
        file: The CSV file to upload.

    Returns:
        JSON 200:
            {
              "success": true,
              "message": "...",
              "metadata": { ... },
              "preview": {
                "columns": [...],
                "rows": [...],   # first 10 rows, NaN → null
                "total_rows": N
              }
            }
        JSON 4xx: Standard error envelope.

    Notes:
        Flask may return HTTP 413 before this view is called if the payload
        exceeds MAX_CONTENT_LENGTH. The global 413 handler in app/__init__.py
        handles that case.

        NaN values are replaced with None before serialisation because
        Python's json module cannot encode float('nan').

    Future:
        Accept multipart uploads with additional metadata fields (classification,
        program, source). Stream large files to disk instead of loading to memory.
    """
    # ── Presence checks ───────────────────────────────────────────────────────
    if "file" not in request.files:
        return (
            jsonify(
                {
                    "success": False,
                    "error_code": "NO_FILE",
                    "message": "No file was included in the request. "
                               "Attach the CSV as a 'file' field in a multipart form.",
                    "detail": "",
                    "recoverable": True,
                    "allowed_actions": ["retry"],
                }
            ),
            400,
        )

    file = request.files["file"]
    if file.filename == "":
        return (
            jsonify(
                {
                    "success": False,
                    "error_code": "NO_FILENAME",
                    "message": "The uploaded file has no filename. Please select a valid CSV file.",
                    "detail": "",
                    "recoverable": True,
                    "allowed_actions": ["retry"],
                }
            ),
            400,
        )

    # secure_filename strips path traversal characters from the filename before
    # storing it in STATE. The actual file is never written to disk in Phase 1.
    safe_name = secure_filename(file.filename)

    # ── Ingestion pipeline ───────────────────────────────────────────────────
    df, result = ingest_csv(file, safe_name)

    if not result["success"]:
        return jsonify(result), _http_status(result["error_code"])

    # ── Update STATE ─────────────────────────────────────────────────────────
    state = current_app.config["STATE"]
    primary = state["datasets"]["primary"]

    # raw is set once and NEVER modified after this line.
    primary["raw"] = df.copy()
    primary["clean"] = df.copy()

    # Populate metadata from ingestion result + spec fields
    meta = result["metadata"]
    primary["metadata"].update(
        {
            "filename": meta["filename"],
            "upload_timestamp": meta["upload_timestamp"],
            "n_rows_original": meta["n_rows_original"],
            "n_cols": meta["n_cols"],
            "columns": meta["columns"],
            "dtypes": meta["dtypes"],
            "null_counts": meta["null_counts"],
            "coercion_warnings": meta["coercion_warnings"],
            "missing_data_report": {
                col: {
                    "count": meta["null_counts"][col],
                    "ratio": round(meta["null_counts"][col] / meta["n_rows_original"], 4),
                }
                for col in meta["columns"]
                if meta["null_counts"][col] > 0
            },
        }
    )

    # ── Build preview ────────────────────────────────────────────────────────
    # Replace NaN with None so json.dumps can serialize the response.
    preview_df = df.head(10).where(df.head(10).notna(), other=None)
    preview_rows = preview_df.to_dict(orient="records")
    # numpy types are not JSON-serializable — convert to native Python types
    preview_rows = _numpy_to_python(preview_rows)

    return jsonify(
        {
            "success": True,
            "message": f"'{safe_name}' uploaded successfully. "
                       f"{meta['n_rows_original']:,} rows × {meta['n_cols']} columns.",
            "metadata": {
                "filename": meta["filename"],
                "n_rows": meta["n_rows_original"],
                "n_cols": meta["n_cols"],
                "columns": meta["columns"],
                "null_counts": meta["null_counts"],
                "coercion_warnings": meta["coercion_warnings"],
                "upload_timestamp": meta["upload_timestamp"],
            },
            "preview": {
                "columns": meta["columns"],
                "rows": preview_rows,
                "total_rows": meta["n_rows_original"],
            },
        }
    ), 200


@bp.route("/summary", methods=["GET"])
def summary():
    """
    Return descriptive statistics for the full ingested dataset.

    Computed from the in-memory DataFrame (datasets.primary.clean) so the
    stats reflect the full dataset, not just the 10-row preview.

    Args:
        None

    Returns:
        JSON 200:
            {
              "success": true,
              "stats": {
                "<col>": {"min": ..., "max": ..., "mean": ...,
                          "std": ..., "median": ..., "null_count": ...}
              },
              "n_rows": N,
              "n_cols": M,
              "columns": [...]
            }
        JSON 400: No data loaded yet.

    Future:
        Histogram data per column, correlation matrix, outlier flags.
    """
    state = current_app.config["STATE"]
    df = state["datasets"]["primary"]["clean"]

    if df is None:
        return (
            jsonify(
                {
                    "success": False,
                    "error_code": "NO_DATA",
                    "message": "No dataset is loaded. Upload a CSV file first.",
                    "detail": "",
                    "recoverable": True,
                    "allowed_actions": ["upload"],
                }
            ),
            400,
        )

    stats = {}
    for col in df.columns:
        series = df[col].dropna()
        stats[col] = {
            "min": _to_python(series.min()) if len(series) else None,
            "max": _to_python(series.max()) if len(series) else None,
            "mean": _to_python(series.mean()) if len(series) else None,
            "std": _to_python(series.std()) if len(series) else None,
            "median": _to_python(series.median()) if len(series) else None,
            "null_count": int(df[col].isnull().sum()),
        }

    return jsonify(
        {
            "success": True,
            "stats": stats,
            "n_rows": len(df),
            "n_cols": len(df.columns),
            "columns": list(df.columns),
        }
    ), 200


# ─── SERIALISATION HELPERS ────────────────────────────────────────────────────


def _to_python(val):
    """Convert numpy scalar to native Python type for JSON serialisation."""
    if isinstance(val, (np.integer,)):
        return int(val)
    if isinstance(val, (np.floating,)):
        return None if np.isnan(val) else float(val)
    if isinstance(val, (np.bool_,)):
        return bool(val)
    return val


def _numpy_to_python(obj):
    """
    Recursively convert numpy types in a nested dict/list to native Python.

    Required because json.dumps cannot serialise numpy int64, float64, etc.

    Args:
        obj: dict, list, or scalar.

    Returns:
        Same structure with numpy types replaced by native Python equivalents.
    """
    if isinstance(obj, dict):
        return {k: _numpy_to_python(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_numpy_to_python(i) for i in obj]
    return _to_python(obj)
