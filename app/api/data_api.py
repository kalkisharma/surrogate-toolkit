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
VERSION: 0.4.0
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
from app.data.normalization import normalize_dataframe
from app.state.schema import append_audit_event
from config.settings import (
    CORRELATION_WARNING_THRESHOLD,
    MAX_DATASETS,
    MAX_DATASETS_MEMORY_MB,
    MAX_PLOT_ROWS,
)

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
    "NO_DESIGNATION": 400,
    "NO_INPUTS": 422,
    "NO_OUTPUTS": 422,
    "COLUMN_OVERLAP": 422,
    "INVALID_COLUMNS": 422,
    "UNKNOWN_METHOD": 422,
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

    append_audit_event(state, "upload", {
        "filename": safe_name,
        "n_rows":   meta["n_rows_original"],
        "n_cols":   meta["n_cols"],
    })

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
                "dtypes":            meta["dtypes"],
                "null_counts":       meta["null_counts"],
                "coercion_warnings": meta["coercion_warnings"],
                "upload_timestamp":  meta["upload_timestamp"],
                "input_columns":     [],
                "output_columns":    [],
                "normalization_method": None,
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
            "key":                  key,
            "filename":             m.get("filename", key),
            "n_rows":               m.get("n_rows_original", 0),
            "n_cols":               m.get("n_cols", 0),
            "data_type":            m.get("data_type"),
            "memory_bytes":         ds.get("memory_bytes", 0),
            "columns":              m.get("columns", []),
            "dtypes":               m.get("dtypes", {}),
            "null_counts":          m.get("null_counts", {}),
            "preview_rows":         m.get("preview_rows", []),
            "input_columns":        m.get("input_columns", []),
            "output_columns":       m.get("output_columns", []),
            "normalization_method": m.get("normalization_method"),
            "active":               key == active_key,
        })

    return jsonify({
        "success":    True,
        "active_key": active_key,
        "count":      len(result),
        "datasets":   result,
    }), 200


@bp.route("/designate", methods=["POST"])
def designate():
    """
    Designate input and output columns for the active dataset.

    Args (JSON body):
        input_columns  (list[str]): Column names to use as model inputs.
        output_columns (list[str]): Column names to use as model outputs.

    Returns:
        JSON 200: {"success": true, "input_columns": [...], "output_columns": [...]}
        JSON 4xx: Standard error envelope.

    Notes:
        Columns not listed in either list are treated as Unused. Designation is
        stored per-dataset and mirrored to primary["metadata"] on every switch.
    """
    state     = current_app.config["STATE"]
    active_key = state["datasets"]["active_dataset_key"]
    _datasets  = state["datasets"]["_datasets"]

    if not active_key or active_key not in _datasets:
        return (
            jsonify({
                "success": False, "error_code": "NO_DATA",
                "message": "No dataset is loaded. Upload a CSV file first.",
                "detail": "", "recoverable": True, "allowed_actions": ["upload"],
            }),
            400,
        )

    data           = request.get_json(silent=True) or {}
    input_columns  = data.get("input_columns", [])
    output_columns = data.get("output_columns", [])

    ds          = _datasets[active_key]
    meta        = ds["metadata"]
    all_columns = meta.get("columns", [])

    if not input_columns:
        return (
            jsonify({"success": False, "error_code": "NO_INPUTS",
                     "message": "At least one input column is required.",
                     "detail": "", "recoverable": True, "allowed_actions": ["retry"]}),
            422,
        )
    if not output_columns:
        return (
            jsonify({"success": False, "error_code": "NO_OUTPUTS",
                     "message": "At least one output column is required.",
                     "detail": "", "recoverable": True, "allowed_actions": ["retry"]}),
            422,
        )

    overlap = sorted(set(input_columns) & set(output_columns))
    if overlap:
        return (
            jsonify({"success": False, "error_code": "COLUMN_OVERLAP",
                     "message": f"Columns cannot be both input and output: {overlap}",
                     "detail": "", "recoverable": True, "allowed_actions": ["retry"]}),
            422,
        )

    invalid = [c for c in input_columns + output_columns if c not in all_columns]
    if invalid:
        return (
            jsonify({"success": False, "error_code": "INVALID_COLUMNS",
                     "message": f"Unknown column(s): {invalid}",
                     "detail": "", "recoverable": True, "allowed_actions": ["retry"]}),
            422,
        )

    # Store designation in dataset metadata
    meta["input_columns"]  = input_columns
    meta["output_columns"] = output_columns
    meta["n_inputs"]       = len(input_columns)
    meta["n_outputs"]      = len(output_columns)

    # Mirror to primary
    primary_meta = state["datasets"]["primary"]["metadata"]
    primary_meta["input_columns"]  = input_columns
    primary_meta["output_columns"] = output_columns
    primary_meta["n_inputs"]       = len(input_columns)
    primary_meta["n_outputs"]      = len(output_columns)

    append_audit_event(state, "designation", {
        "dataset":   active_key,
        "n_inputs":  len(input_columns),
        "n_outputs": len(output_columns),
    })

    current_app.logger.info(
        f"Designation saved: '{active_key}' — "
        f"{len(input_columns)} input(s), {len(output_columns)} output(s)"
    )

    return jsonify({
        "success":        True,
        "input_columns":  input_columns,
        "output_columns": output_columns,
    }), 200


@bp.route("/correlate", methods=["GET"])
def correlate():
    """
    Compute and return the Pearson correlation matrix for the active dataset.

    Result is cached in _datasets[key]["metadata"]["correlation_matrix"] after
    the first computation. Subsequent calls return the cache.

    Returns:
        JSON 200:
            {
              "success": true,
              "matrix": {"col_a": {"col_a": 1.0, "col_b": 0.87, ...}, ...},
              "high_corr_pairs": [{"col_a": "x1", "col_b": "x2", "r": 0.97}, ...],
              "threshold": 0.90,
              "columns": [...]
            }
        JSON 400: No data loaded.
    """
    state     = current_app.config["STATE"]
    active_key = state["datasets"]["active_dataset_key"]
    _datasets  = state["datasets"]["_datasets"]
    df         = state["datasets"]["primary"]["clean"]

    if df is None:
        return (
            jsonify({
                "success": False, "error_code": "NO_DATA",
                "message": "No dataset is loaded. Upload a CSV file first.",
                "detail": "", "recoverable": True, "allowed_actions": ["upload"],
            }),
            400,
        )

    # Serve from cache if already computed
    cached = _datasets.get(active_key, {}).get("metadata", {}).get("correlation_matrix")
    if cached:
        high_pairs = _high_corr_pairs(cached, list(df.columns))
        return jsonify({
            "success":        True,
            "matrix":         cached,
            "high_corr_pairs": high_pairs,
            "threshold":      CORRELATION_WARNING_THRESHOLD,
            "columns":        list(df.columns),
        }), 200

    # Compute Pearson correlation and round to 4 dp for payload size
    import numpy as np
    corr_df = df.corr(numeric_only=True)
    matrix  = {}
    for col in corr_df.columns:
        row = {}
        for col2 in corr_df.columns:
            val = corr_df.loc[col, col2]
            row[col2] = None if (isinstance(val, float) and np.isnan(val)) else round(float(val), 4)
        matrix[col] = row

    # Cache
    if active_key and active_key in _datasets:
        _datasets[active_key]["metadata"]["correlation_matrix"] = matrix
        state["datasets"]["primary"]["metadata"]["correlation_matrix"] = matrix

    high_pairs = _high_corr_pairs(matrix, list(df.columns))

    return jsonify({
        "success":         True,
        "matrix":          matrix,
        "high_corr_pairs": high_pairs,
        "threshold":       CORRELATION_WARNING_THRESHOLD,
        "columns":         list(df.columns),
    }), 200


def _high_corr_pairs(matrix: dict, columns: list) -> list:
    """Return list of {col_a, col_b, r} for |r| >= threshold (upper triangle only)."""
    pairs = []
    cols  = [c for c in columns if c in matrix]
    for i, ca in enumerate(cols):
        for cb in cols[i + 1:]:
            r = matrix[ca].get(cb)
            if r is not None and abs(r) >= CORRELATION_WARNING_THRESHOLD:
                pairs.append({"col_a": ca, "col_b": cb, "r": r})
    return sorted(pairs, key=lambda p: -abs(p["r"]))


@bp.route("/normalize", methods=["POST"])
def normalize():
    """
    Normalize input columns of the active dataset.

    Args (JSON body):
        method (str): "minmax" | "zscore" | "none"

    Returns:
        JSON 200: {"success": true, "method": "...", "n_columns": N}
        JSON 4xx: Standard error envelope.

    Notes:
        Normalization applies only to designated input columns. Output columns
        and unused columns are copied to primary["normalized"] unchanged.
        primary["clean"] is never mutated.
    """
    state     = current_app.config["STATE"]
    active_key = state["datasets"]["active_dataset_key"]
    _datasets  = state["datasets"]["_datasets"]

    if not active_key or active_key not in _datasets:
        return (
            jsonify({
                "success": False, "error_code": "NO_DATA",
                "message": "No dataset is loaded. Upload a CSV file first.",
                "detail": "", "recoverable": True, "allowed_actions": ["upload"],
            }),
            400,
        )

    ds            = _datasets[active_key]
    meta          = ds["metadata"]
    input_columns = meta.get("input_columns", [])

    if not input_columns:
        return (
            jsonify({
                "success": False, "error_code": "NO_DESIGNATION",
                "message": "Designate input columns before normalizing.",
                "detail": "", "recoverable": True, "allowed_actions": ["designate"],
            }),
            400,
        )

    data   = request.get_json(silent=True) or {}
    method = data.get("method", "none")

    if method not in ("minmax", "zscore", "none"):
        return (
            jsonify({
                "success": False, "error_code": "UNKNOWN_METHOD",
                "message": f"Unknown normalization method '{method}'. Use minmax, zscore, or none.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    clean_df = ds["raw"]   # normalize from clean; ds["clean"] is the validated DF
    # Use primary clean DF for normalization
    clean_df = state["datasets"]["primary"]["clean"]

    try:
        normalized_df, params = normalize_dataframe(clean_df, input_columns, method)
    except Exception as exc:
        current_app.logger.error(f"Normalization error: {exc}")
        return (
            jsonify({
                "success": False, "error_code": "FILE_READ_ERROR",
                "message": "Normalization failed. See server log for details.",
                "detail": str(exc), "recoverable": True, "allowed_actions": ["retry"],
            }),
            400,
        )

    # Store normalized DataFrame
    ds["normalized"] = normalized_df
    state["datasets"]["primary"]["normalized"] = normalized_df

    # Persist method and params in metadata
    meta["normalization_method"] = method
    meta["normalization_params"] = params
    state["datasets"]["primary"]["metadata"]["normalization_method"] = method
    state["datasets"]["primary"]["metadata"]["normalization_params"] = params

    append_audit_event(state, "normalization", {
        "dataset":   active_key,
        "method":    method,
        "n_columns": len(input_columns),
    })

    current_app.logger.info(
        f"Normalization applied: '{active_key}' — method={method}, {len(input_columns)} column(s)"
    )

    return jsonify({
        "success":   True,
        "method":    method,
        "n_columns": len(input_columns),
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
