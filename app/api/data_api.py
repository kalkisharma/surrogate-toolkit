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
LAST MODIFIED: 2026-05-12
VERSION: 0.3.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

from datetime import datetime, timezone

import numpy as np
from flask import Blueprint, current_app, jsonify, request
from werkzeug.utils import secure_filename

from app.data.ingestion import ingest_csv
from config.settings import MAX_DATASETS, MAX_DATASETS_MEMORY_MB, MAX_PLOT_ROWS

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
    state    = current_app.config["STATE"]
    meta     = result["metadata"]
    now_ts   = datetime.now(timezone.utc).isoformat()
    mem_bytes = int(df.memory_usage(deep=True).sum())

    missing_data_report = {
        col: {
            "count": meta["null_counts"][col],
            "ratio": round(meta["null_counts"][col] / meta["n_rows_original"], 4),
        }
        for col in meta["columns"]
        if meta["null_counts"][col] > 0
    }

    ds_meta = {
        "filename":           meta["filename"],
        "upload_timestamp":   meta["upload_timestamp"],
        "n_rows_original":    meta["n_rows_original"],
        "n_cols":             meta["n_cols"],
        "columns":            meta["columns"],
        "dtypes":             meta["dtypes"],
        "null_counts":        meta["null_counts"],
        "coercion_warnings":  meta["coercion_warnings"],
        "missing_data_report": missing_data_report,
        "data_type":          None,   # filled in by the gate (PUT /api/state/session)
    }

    # Compute preview rows and summary stats at upload time so both can be
    # recalled on dataset switch without re-running pandas on every request.
    preview_df   = df.head(10).where(df.head(10).notna(), other=None)
    preview_rows = _numpy_to_python(preview_df.to_dict(orient="records"))
    ds_meta["preview_rows"] = preview_rows

    summary_stats = {}
    for col in df.columns:
        series = df[col].dropna()
        summary_stats[col] = {
            "min":        _to_python(series.min())    if len(series) else None,
            "max":        _to_python(series.max())    if len(series) else None,
            "mean":       _to_python(series.mean())   if len(series) else None,
            "std":        _to_python(series.std())    if len(series) else None,
            "median":     _to_python(series.median()) if len(series) else None,
            "null_count": int(df[col].isnull().sum()),
        }
    ds_meta["summary_stats"] = summary_stats

    # Build dataset entry and store in _datasets accumulator
    ds_entry = {
        "raw":          df.copy(),
        "clean":        df.copy(),
        "metadata":     ds_meta,
        "memory_bytes": mem_bytes,
        "last_accessed": now_ts,
    }

    _datasets = state["datasets"]["_datasets"]

    # ── Overwrite warning ─────────────────────────────────────────────────────
    eviction_warnings = []
    if safe_name in _datasets:
        eviction_warnings.append(
            f"'{ds_meta['filename']}' replaced an existing upload with the same filename."
        )

    _datasets[safe_name] = ds_entry

    # ── Eviction — enforce MAX_DATASETS cap ──────────────────────────────────
    while len(_datasets) > MAX_DATASETS:
        lru_key = min(
            (k for k in _datasets if k != safe_name),
            key=lambda k: _datasets[k]["last_accessed"],
            default=None,
        )
        if lru_key is None:
            break
        evicted_name = _datasets[lru_key]["metadata"]["filename"]
        del _datasets[lru_key]
        eviction_warnings.append(
            f"'{evicted_name}' was removed to stay within the {MAX_DATASETS}-dataset limit."
        )
        current_app.logger.info(
            f"LRU eviction (count cap): removed '{evicted_name}'"
        )

    # ── Eviction — enforce memory budget ─────────────────────────────────────
    total_mem = sum(ds.get("memory_bytes", 0) for ds in _datasets.values())
    budget    = MAX_DATASETS_MEMORY_MB * 1024 * 1024
    while total_mem > budget and len(_datasets) > 1:
        lru_key = min(
            (k for k in _datasets if k != safe_name),
            key=lambda k: _datasets[k]["last_accessed"],
            default=None,
        )
        if lru_key is None:
            break
        evicted_name = _datasets[lru_key]["metadata"]["filename"]
        total_mem -= _datasets[lru_key].get("memory_bytes", 0)
        del _datasets[lru_key]
        eviction_warnings.append(
            f"'{evicted_name}' was removed to stay within the {MAX_DATASETS_MEMORY_MB} MB memory limit."
        )
        current_app.logger.info(
            f"LRU eviction (memory cap): removed '{evicted_name}'"
        )

    # ── Mirror active dataset to primary ─────────────────────────────────────
    state["datasets"]["active_dataset_key"] = safe_name
    primary = state["datasets"]["primary"]
    primary["raw"]   = ds_entry["raw"]
    primary["clean"] = ds_entry["clean"]
    primary["metadata"].update(ds_meta)

    current_app.logger.info(
        f"Dataset loaded: '{safe_name}' ({mem_bytes // 1024} KB, "
        f"{len(_datasets)} dataset(s) in session)"
    )

    return jsonify(
        {
            "success": True,
            "message": f"'{safe_name}' uploaded successfully. "
                       f"{meta['n_rows_original']:,} rows × {meta['n_cols']} columns.",
            "dataset_key": safe_name,
            "loaded_count": len(_datasets),
            "eviction_warnings": eviction_warnings,
            "metadata": {
                "filename":          meta["filename"],
                "n_rows":            meta["n_rows_original"],
                "n_cols":            meta["n_cols"],
                "columns":           meta["columns"],
                "null_counts":       meta["null_counts"],
                "coercion_warnings": meta["coercion_warnings"],
                "upload_timestamp":  meta["upload_timestamp"],
            },
            "preview": {
                "columns":    meta["columns"],
                "rows":       preview_rows,
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
    state     = current_app.config["STATE"]
    df        = state["datasets"]["primary"]["clean"]
    active_key = state["datasets"]["active_dataset_key"]

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

    # Serve from cache if available (populated at upload time).
    _datasets = state["datasets"]["_datasets"]
    cached    = _datasets.get(active_key, {}).get("metadata", {}).get("summary_stats")
    if cached:
        return jsonify(
            {
                "success": True,
                "stats": cached,
                "n_rows": len(df),
                "n_cols": len(df.columns),
                "columns": list(df.columns),
            }
        ), 200

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


@bp.route("/rows", methods=["GET"])
def rows():
    """
    Return up to MAX_PLOT_ROWS rows from the full ingested dataset for use
    in the scatter matrix. The upload preview is limited to 10 rows; this
    endpoint provides the complete (or truncated) dataset to the chart.

    Returns:
        JSON 200:
            {
              "success": true,
              "rows": [...],
              "columns": [...],
              "total_rows": N,
              "shown_rows": M,
              "truncated": bool
            }
        JSON 400: No data loaded yet.
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

    total = len(df)
    limit = min(total, MAX_PLOT_ROWS)
    subset = df.iloc[:limit].where(df.iloc[:limit].notna(), other=None)
    row_data = _numpy_to_python(subset.to_dict(orient="records"))

    return jsonify(
        {
            "success": True,
            "rows": row_data,
            "columns": list(df.columns),
            "total_rows": total,
            "shown_rows": limit,
            "truncated": total > MAX_PLOT_ROWS,
        }
    ), 200


@bp.route("/datasets", methods=["GET"])
def datasets():
    """
    Return the list of all datasets currently loaded in the session.

    Returns:
        JSON 200:
            {
              "success": true,
              "active_key": str | null,
              "count": int,
              "datasets": [
                {
                  "key": str,
                  "filename": str,
                  "n_rows": int,
                  "n_cols": int,
                  "data_type": str | null,
                  "memory_bytes": int,
                  "active": bool
                }
              ]
            }
    """
    state      = current_app.config["STATE"]
    _datasets  = state["datasets"]["_datasets"]
    active_key = state["datasets"]["active_dataset_key"]

    result = []
    for key, ds in _datasets.items():
        m = ds["metadata"]
        result.append({
            "key":          key,
            "filename":     m.get("filename", key),
            "n_rows":        m.get("n_rows_original", 0),
            "n_cols":        m.get("n_cols", 0),
            "data_type":     m.get("data_type"),
            "memory_bytes":  ds.get("memory_bytes", 0),
            "columns":       m.get("columns", []),
            "null_counts":   m.get("null_counts", {}),
            "preview_rows":  m.get("preview_rows", []),
            "active":        key == active_key,
        })

    return jsonify({
        "success":    True,
        "active_key": active_key,
        "count":      len(result),
        "datasets":   result,
    }), 200


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
