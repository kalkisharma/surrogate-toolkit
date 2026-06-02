"""
================================================================================
FILE: data_api.py
MODULE: app/api/
PURPOSE: Blueprint and route handlers for /api/data/*. Wires the ingestion
         pipeline to the HTTP API, updates STATE, and returns standardised
         JSON responses.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-28
VERSION: 1.0.2
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

from datetime import datetime, timezone

import numpy as np
from flask import Blueprint, current_app, jsonify, request
from werkzeug.utils import secure_filename

from app.data.cleaning import (
    apply_log_transform,
    compute_cleaning_stats,
    compute_column_outlier_counts,
    handle_nulls,
    handle_outliers,
    remove_duplicates,
)
from app.data.ingestion import ingest_csv
from app.data.normalization import normalize_dataframe
from app.data.stats import compute_dcor_matrix
from app.state.schema import append_audit_event
from config.settings import (
    CLEANING_STRATEGIES_NULL,
    CLEANING_STRATEGIES_OUTLIER,
    CORRELATION_WARNING_THRESHOLD,
    DEFAULT_CV_FOLDS,
    DEFAULT_TEST_SPLIT,
    LOG_TRANSFORM_SKEW_THRESHOLD,
    MAX_DATASETS,
    MAX_DATASETS_MEMORY_MB,
    MAX_PLOT_ROWS,
    MIN_ROWS,
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
    "UNKNOWN_STRATEGY": 422,
    "CLEAN_ERROR": 400,
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
            "skew":       _to_python(series.skew())   if len(series) >= 3 else None,
        }
    ds_meta["summary_stats"] = summary_stats

    # Build dataset entry and store in _datasets accumulator
    ds_entry = {
        "raw":          df.copy(),
        "clean":        df.copy(),
        "metadata":     ds_meta,
        "memory_bytes": mem_bytes,
        "last_accessed": now_ts,
        "surrogate_session": {
            "models": {},
            "config": {
                "model_type": None,
                "test_split":  DEFAULT_TEST_SPLIT,
                "cv_folds":    DEFAULT_CV_FOLDS,
            },
        },
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

    # ── Save current surrogate session before switching active dataset ────────
    prev_key = state["datasets"].get("active_dataset_key")
    if prev_key and prev_key in _datasets and prev_key != safe_name:
        _datasets[prev_key]["surrogate_session"] = {
            "models": state["surrogate_sessions"]["primary"]["models"],
            "config": {**state["surrogate_sessions"]["primary"]["config"]},
        }

    # ── Mirror active dataset to primary ─────────────────────────────────────
    state["datasets"]["active_dataset_key"] = safe_name
    primary = state["datasets"]["primary"]
    primary["raw"]   = ds_entry["raw"]
    primary["clean"] = ds_entry["clean"]
    primary["metadata"].update(ds_meta)

    # New uploads always start with no trained model
    surrogate = state["surrogate_sessions"]["primary"]
    surrogate["models"] = {}
    surrogate["config"]  = {
        "model_type": None,
        "test_split":  DEFAULT_TEST_SPLIT,
        "cv_folds":    DEFAULT_CV_FOLDS,
    }

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

    # Serve from cache if available (populated at upload time; invalidated after cleaning).
    _datasets = state["datasets"]["_datasets"]
    cached    = _datasets.get(active_key, {}).get("metadata", {}).get("summary_stats")
    cleaning  = compute_cleaning_stats(df)
    if cached:
        return jsonify(
            {
                "success":        True,
                "stats":          cached,
                "n_rows":         len(df),
                "n_cols":         len(df.columns),
                "columns":        list(df.columns),
                "cleaning_stats": cleaning,
            }
        ), 200

    stats = {}
    for col in df.columns:
        series = df[col].dropna()
        stats[col] = {
            "min":        _to_python(series.min())    if len(series) else None,
            "max":        _to_python(series.max())    if len(series) else None,
            "mean":       _to_python(series.mean())   if len(series) else None,
            "std":        _to_python(series.std())    if len(series) else None,
            "median":     _to_python(series.median()) if len(series) else None,
            "null_count": int(df[col].isnull().sum()),
            "skew":       _to_python(series.skew())   if len(series) >= 3 else None,
        }

    return jsonify(
        {
            "success":        True,
            "stats":          stats,
            "n_rows":         len(df),
            "n_cols":         len(df.columns),
            "columns":        list(df.columns),
            "cleaning_stats": cleaning,
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
    primary = state["datasets"]["primary"]

    # ?source=working returns normalized/PCA df — used by active learning scatter
    # so training points are in the same coordinate space as recommendations.
    from flask import request as _req
    use_working = _req.args.get("source") == "working"
    if use_working:
        _norm = primary.get("normalized")
        df = _norm if _norm is not None else primary.get("clean")
    else:
        df = primary["clean"]

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
            "preview_rows":         _numpy_to_python(m.get("preview_rows", [])),
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


@bp.route("/dcor", methods=["GET"])
def dcor():
    """
    Compute and return the distance correlation matrix for the active dataset.

    Distance correlation detects both linear and non-linear dependencies.
    Computed on up to MAX_PLOT_ROWS rows and up to 12 columns.
    Result is cached in _datasets[key]["metadata"]["dcor_matrix"] after the
    first computation. Cache is invalidated by any cleaning operation.

    Returns:
        JSON 200:
            {
              "success": true,
              "columns": [...],
              "matrix": {"col_a": {"col_a": 1.0, "col_b": 0.45, ...}, ...},
              "n_rows": N,
              "truncated": bool
            }
        JSON 400: No data loaded.
    """
    DCOR_MAX_COLS = 12

    state      = current_app.config["STATE"]
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

    # Serve from cache if available and valid
    cached = _datasets.get(active_key, {}).get("metadata", {}).get("dcor_matrix")
    if cached:
        cols = list(cached.keys())
        return jsonify({
            "success":   True,
            "columns":   cols,
            "matrix":    cached,
            "n_rows":    min(len(df), MAX_PLOT_ROWS),
            "truncated": len(df) > MAX_PLOT_ROWS,
        }), 200

    # Cap rows and columns for O(n²) computation
    cols      = list(df.select_dtypes(include=[np.number]).columns)[:DCOR_MAX_COLS]
    total     = len(df)
    subset    = df[cols].iloc[:MAX_PLOT_ROWS]
    truncated = total > MAX_PLOT_ROWS

    matrix = compute_dcor_matrix(subset, cols)

    # Cache result
    if active_key and active_key in _datasets:
        _datasets[active_key]["metadata"]["dcor_matrix"] = matrix

    return jsonify({
        "success":   True,
        "columns":   cols,
        "matrix":    matrix,
        "n_rows":    min(total, MAX_PLOT_ROWS),
        "truncated": truncated,
    }), 200


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

    clean_df = ds["clean"]

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

    # Build before/after histogram data (capped at 500 rows for payload size)
    hist_rows    = min(len(clean_df), 500)
    sample_clean = clean_df[input_columns].iloc[:hist_rows]
    sample_norm  = normalized_df[input_columns].iloc[:hist_rows]
    hist_data = {
        "before": {col: sample_clean[col].dropna().tolist() for col in input_columns},
        "after":  {col: sample_norm[col].dropna().tolist()  for col in input_columns},
    }
    def _sanitize_records(records):
        """Replace float NaN/Inf with None so jsonify produces valid JSON."""
        import math
        sanitized = []
        for row in records:
            sanitized.append({
                k: (None if isinstance(v, float) and (math.isnan(v) or math.isinf(v)) else v)
                for k, v in row.items()
            })
        return sanitized

    sample_rows = {
        "before": _sanitize_records(sample_clean[input_columns].head(5).to_dict(orient="records")),
        "after":  _sanitize_records(sample_norm[input_columns].head(5).to_dict(orient="records")),
    }

    return jsonify({
        "success":       True,
        "method":        method,
        "n_columns":     len(input_columns),
        "input_columns": input_columns,
        "hist_data":     hist_data,
        "sample_rows":   sample_rows,
    }), 200


# ─── CLEANING ROUTES ──────────────────────────────────────────────────────────


def _no_data_error():
    """Return standard 400 error envelope when no dataset is loaded."""
    return (
        jsonify({
            "success": False, "error_code": "NO_DATA",
            "message": "No dataset is loaded. Upload a CSV file first.",
            "detail": "", "recoverable": True, "allowed_actions": ["upload"],
        }),
        400,
    )


def _get_active_ds(state):
    """Return (active_key, ds_entry) or (None, None) if no dataset is active."""
    active_key = state["datasets"]["active_dataset_key"]
    _datasets  = state["datasets"]["_datasets"]
    if not active_key or active_key not in _datasets:
        return None, None
    return active_key, _datasets[active_key]


def _apply_clean(state, active_key, ds, result_df, save_prev=True):
    """
    Write a cleaned DataFrame to both the dataset accumulator and primary mirror.
    Stores the previous clean state for one-level undo before overwriting (unless
    save_prev=False, used by reset so the raw restore itself is not undoable).
    Invalidates the summary stats cache so the next GET /api/data/summary recomputes.
    """
    if save_prev:
        ds["clean_prev"] = ds["clean"].copy()    # one-level undo snapshot
    ds["clean"]  = result_df
    state["datasets"]["primary"]["clean"] = result_df
    ds["metadata"]["n_rows_clean"]  = len(result_df)
    ds["metadata"]["summary_stats"] = None   # invalidate stats cache
    ds["metadata"]["dcor_matrix"]   = None   # invalidate dCor cache


@bp.route("/clean/nulls", methods=["POST"])
def clean_nulls():
    """
    Apply a missing-value strategy to the active dataset's clean DataFrame.

    Args (JSON body):
        strategy (str): "drop_rows" | "mean_impute" | "median_impute"

    Returns:
        JSON 200: {
            "success": true,
            "strategy": "...",
            "rows_before": N,
            "rows_after": M,
            "rows_affected": K
        }
        JSON 4xx: Standard error envelope.

    Notes:
        "drop_rows" removes any row with at least one null value. Impute strategies
        replace nulls with column mean or median and preserve row count.
        drop_rows is rejected if the result would have fewer than MIN_ROWS rows.

    Future:
        Per-column strategy overrides; forward/backward fill.
    """
    state = current_app.config["STATE"]
    active_key, ds = _get_active_ds(state)
    if ds is None:
        return _no_data_error()

    data     = request.get_json(silent=True) or {}
    strategy = data.get("strategy", "")

    if strategy not in CLEANING_STRATEGIES_NULL:
        return (
            jsonify({
                "success": False, "error_code": "UNKNOWN_STRATEGY",
                "message": f"Unknown null strategy '{strategy}'. "
                           f"Use one of: {', '.join(CLEANING_STRATEGIES_NULL)}.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    clean_df = state["datasets"]["primary"]["clean"]

    try:
        result_df, affected = handle_nulls(clean_df, strategy)
    except Exception as exc:
        current_app.logger.error(f"Null handling error: {exc}")
        return (
            jsonify({
                "success": False, "error_code": "CLEAN_ERROR",
                "message": "Null handling failed. See server log for details.",
                "detail": str(exc), "recoverable": True, "allowed_actions": ["retry"],
            }),
            400,
        )

    if len(result_df) < MIN_ROWS:
        return (
            jsonify({
                "success": False, "error_code": "INSUFFICIENT_ROWS",
                "message": f"Dropping rows with nulls would leave only {len(result_df)} row(s). "
                           f"Minimum is {MIN_ROWS}. Try imputation instead.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    rows_before = len(clean_df)
    _apply_clean(state, active_key, ds, result_df)
    append_audit_event(state, "cleaning_nulls", {
        "dataset":       active_key,
        "strategy":      strategy,
        "rows_before":   rows_before,
        "rows_after":    len(result_df),
        "rows_affected": affected,
    })
    current_app.logger.info(
        f"Null handling: '{active_key}' — strategy={strategy}, affected={affected}"
    )

    return jsonify({
        "success":       True,
        "strategy":      strategy,
        "rows_before":   rows_before,
        "rows_after":    len(result_df),
        "rows_affected": affected,
    }), 200


@bp.route("/clean/outliers", methods=["POST"])
def clean_outliers():
    """
    Apply an outlier treatment strategy to the active dataset's clean DataFrame.

    Args (JSON body):
        strategy (str): "keep" | "drop_rows"

    Returns:
        JSON 200: {
            "success": true,
            "strategy": "...",
            "rows_before": N,
            "rows_after": M,
            "rows_affected": K
        }
        JSON 4xx: Standard error envelope.

    Notes:
        IQR detection uses IQR_OUTLIER_MULTIPLIER (1.5). NaN values are excluded
        from quartile computation. "keep" is a no-op but still appends an audit event.
        drop_rows is rejected if the result would have fewer than MIN_ROWS rows.

        "winsorize" is deferred to post-designation so it can be safely scoped to
        input columns only, avoiding corruption of training targets.

    Future:
        Winsorize strategy (post-designation, input columns only).
    """
    state = current_app.config["STATE"]
    active_key, ds = _get_active_ds(state)
    if ds is None:
        return _no_data_error()

    data     = request.get_json(silent=True) or {}
    strategy = data.get("strategy", "")
    columns  = data.get("columns", None)     # optional per-column selection
    try:
        iqr_multiplier = float(data["iqr_multiplier"]) if "iqr_multiplier" in data else None
        if iqr_multiplier is not None:
            iqr_multiplier = max(0.5, min(5.0, iqr_multiplier))
    except (TypeError, ValueError):
        iqr_multiplier = None

    if strategy not in CLEANING_STRATEGIES_OUTLIER:
        return (
            jsonify({
                "success": False, "error_code": "UNKNOWN_STRATEGY",
                "message": f"Unknown outlier strategy '{strategy}'. "
                           f"Use one of: {', '.join(CLEANING_STRATEGIES_OUTLIER)}.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    clean_df = state["datasets"]["primary"]["clean"]

    try:
        result_df, affected = handle_outliers(clean_df, strategy, columns=columns, iqr_multiplier=iqr_multiplier)
    except Exception as exc:
        current_app.logger.error(f"Outlier handling error: {exc}")
        return (
            jsonify({
                "success": False, "error_code": "CLEAN_ERROR",
                "message": "Outlier handling failed. See server log for details.",
                "detail": str(exc), "recoverable": True, "allowed_actions": ["retry"],
            }),
            400,
        )

    if strategy == "drop_rows" and len(result_df) < MIN_ROWS:
        return (
            jsonify({
                "success": False, "error_code": "INSUFFICIENT_ROWS",
                "message": f"Dropping outlier rows would leave only {len(result_df)} row(s). "
                           f"Minimum is {MIN_ROWS}. Use 'keep' to flag without removing.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    rows_before = len(clean_df)
    if strategy != "keep":
        _apply_clean(state, active_key, ds, result_df)

    append_audit_event(state, "cleaning_outliers", {
        "dataset":       active_key,
        "strategy":      strategy,
        "rows_before":   rows_before,
        "rows_after":    len(result_df),
        "rows_affected": affected,
    })
    current_app.logger.info(
        f"Outlier handling: '{active_key}' — strategy={strategy}, affected={affected}"
    )

    return jsonify({
        "success":       True,
        "strategy":      strategy,
        "rows_before":   rows_before,
        "rows_after":    len(result_df),
        "rows_affected": affected,
    }), 200


@bp.route("/clean/outlier_counts", methods=["GET"])
def outlier_counts():
    """Return per-column IQR outlier row counts for the current clean dataset."""
    state = current_app.config["STATE"]
    _, ds = _get_active_ds(state)
    if ds is None:
        return _no_data_error()
    counts = compute_column_outlier_counts(state["datasets"]["primary"]["clean"])
    return jsonify({"success": True, "counts": counts}), 200


@bp.route("/clean/undo", methods=["POST"])
def undo_clean():
    """Restore ds["clean"] from the one-level undo snapshot (clean_prev)."""
    state = current_app.config["STATE"]
    active_key, ds = _get_active_ds(state)
    if ds is None:
        return _no_data_error()
    if "clean_prev" not in ds:
        return jsonify({"success": False, "message": "Nothing to undo."}), 400

    prev_df = ds.pop("clean_prev")
    ds["clean"] = prev_df
    state["datasets"]["primary"]["clean"] = prev_df
    ds["metadata"]["n_rows_clean"]  = len(prev_df)
    ds["metadata"]["summary_stats"] = None

    append_audit_event(state, "cleaning_undo", {
        "dataset":       active_key,
        "rows_restored": len(prev_df),
    })
    current_app.logger.info(
        f"Undo last clean: '{active_key}' — restored {len(prev_df)} rows"
    )
    return jsonify({"success": True, "rows_restored": len(prev_df)}), 200


@bp.route("/clean/duplicates", methods=["POST"])
def clean_duplicates():
    """
    Remove exact duplicate rows from the active dataset's clean DataFrame.

    Returns:
        JSON 200: {
            "success": true,
            "rows_before": N,
            "rows_after": M,
            "rows_removed": K
        }
        JSON 4xx: Standard error envelope.

    Future:
        Fuzzy deduplication via numeric distance threshold.
    """
    state = current_app.config["STATE"]
    active_key, ds = _get_active_ds(state)
    if ds is None:
        return _no_data_error()

    clean_df = state["datasets"]["primary"]["clean"]

    try:
        result_df, removed = remove_duplicates(clean_df)
    except Exception as exc:
        current_app.logger.error(f"Deduplication error: {exc}")
        return (
            jsonify({
                "success": False, "error_code": "CLEAN_ERROR",
                "message": "Deduplication failed. See server log for details.",
                "detail": str(exc), "recoverable": True, "allowed_actions": ["retry"],
            }),
            400,
        )

    rows_before = len(clean_df)
    if removed > 0:
        _apply_clean(state, active_key, ds, result_df)

    append_audit_event(state, "cleaning_duplicates", {
        "dataset":      active_key,
        "rows_before":  rows_before,
        "rows_after":   len(result_df),
        "rows_removed": removed,
    })
    current_app.logger.info(
        f"Deduplication: '{active_key}' — removed={removed}"
    )

    return jsonify({
        "success":      True,
        "rows_before":  rows_before,
        "rows_after":   len(result_df),
        "rows_removed": removed,
    }), 200


@bp.route("/clean/reset", methods=["POST"])
def clean_reset():
    """
    Reset the active dataset's clean DataFrame to a copy of raw (undo all cleaning).

    Returns:
        JSON 200: {
            "success": true,
            "rows_restored": N
        }
        JSON 4xx: Standard error envelope.

    Notes:
        primary["raw"] is immutable by design. This copies raw to clean,
        restoring the original ingested state before any cleaning was applied.
        Summary stats cache is also invalidated so stats reflect the restored data.

    Future:
        Per-operation undo via cleaning_log replay in reverse.
    """
    state = current_app.config["STATE"]
    active_key, ds = _get_active_ds(state)
    if ds is None:
        return _no_data_error()

    raw_df   = state["datasets"]["primary"]["raw"]
    restored = raw_df.copy()

    ds.pop("clean_prev", None)           # discard any undo snapshot on full reset
    _apply_clean(state, active_key, ds, restored, save_prev=False)
    append_audit_event(state, "cleaning_reset", {
        "dataset":        active_key,
        "rows_restored":  len(restored),
    })
    current_app.logger.info(
        f"Cleaning reset: '{active_key}' — restored {len(restored)} rows from raw"
    )

    return jsonify({
        "success":       True,
        "rows_restored": len(restored),
    }), 200


@bp.route("/clean/transform", methods=["POST"])
def clean_transform():
    """
    Apply a natural log(1 + x) transform to selected columns of the active dataset.

    Args (JSON body):
        columns (list[str]): Column names to transform. Must all be present in the
                             dataset and must all have values > -1.

    Returns:
        JSON 200: {
            "success": true,
            "columns_transformed": [...],
            "n_columns": N,
            "rows_before": R,
            "rows_after": R    # same — transform does not remove rows
        }
        JSON 4xx: Standard error envelope.

    Notes:
        Uses numpy.log1p (zero-safe). Columns with any value <= -1 are rejected
        to avoid undefined/infinite results. Row count is unchanged.
        Skew threshold (LOG_TRANSFORM_SKEW_THRESHOLD = 1.0) is enforced in the UI
        but not here — any numeric column may be transformed via the API.

    Future:
        Box-Cox / Yeo-Johnson transforms; per-column transform preview.
    """
    state = current_app.config["STATE"]
    active_key, ds = _get_active_ds(state)
    if ds is None:
        return _no_data_error()

    data    = request.get_json(silent=True) or {}
    columns = data.get("columns", [])

    if not columns:
        return (
            jsonify({
                "success": False, "error_code": "UNKNOWN_STRATEGY",
                "message": "No columns specified. Provide at least one column name.",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    clean_df = state["datasets"]["primary"]["clean"]
    invalid  = [c for c in columns if c not in clean_df.columns]
    if invalid:
        return (
            jsonify({
                "success": False, "error_code": "INVALID_COLUMNS",
                "message": f"Unknown column(s): {invalid}",
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )

    try:
        result_df, n_transformed = apply_log_transform(clean_df, columns)
    except ValueError as exc:
        return (
            jsonify({
                "success": False, "error_code": "UNKNOWN_STRATEGY",
                "message": str(exc),
                "detail": "", "recoverable": True, "allowed_actions": ["retry"],
            }),
            422,
        )
    except Exception as exc:
        current_app.logger.error(f"Log-transform error: {exc}")
        return (
            jsonify({
                "success": False, "error_code": "CLEAN_ERROR",
                "message": "Log-transform failed. See server log for details.",
                "detail": str(exc), "recoverable": True, "allowed_actions": ["retry"],
            }),
            400,
        )

    rows_before = len(clean_df)
    _apply_clean(state, active_key, ds, result_df)
    append_audit_event(state, "cleaning_transform", {
        "dataset":             active_key,
        "columns_transformed": columns,
        "n_columns":           n_transformed,
    })
    current_app.logger.info(
        f"Log-transform: '{active_key}' — columns={columns}"
    )

    return jsonify({
        "success":             True,
        "columns_transformed": columns,
        "n_columns":           n_transformed,
        "rows_before":         rows_before,
        "rows_after":          len(result_df),
    }), 200


# ─── INPUT SCREENING ─────────────────────────────────────────────────────────


@bp.route("/screen", methods=["POST"])
def screen_inputs():
    """
    Compute Pearson |r| matrix, VIF, flagged pairs, low-variance flags, and
    (if available) Sobol ST rankings for all designated input columns.

    Body JSON (optional):
        threshold    (float, default 0.9)  — |r| threshold for correlated-pair flag
        cv_threshold (float, default 0.01) — CV threshold for low-variance flag
    """
    data         = request.get_json(silent=True) or {}
    threshold    = float(data.get("threshold",    0.9))
    cv_threshold = float(data.get("cv_threshold", 0.01))

    state      = current_app.config["STATE"]
    primary    = state["datasets"]["primary"]
    meta       = primary["metadata"]
    input_cols = meta.get("input_columns", [])

    if not input_cols:
        return jsonify({
            "success":    False,
            "error_code": "NO_INPUT_COLUMNS",
            "message":    "No input columns designated. Complete Step 5 — Assign first.",
        }), 400

    df = (primary["normalized"] if primary.get("normalized") is not None else primary["clean"])
    X  = df[input_cols]

    # Pearson correlation matrix
    corr = X.corr(method="pearson")

    # Flagged pairs — upper triangle only, sorted by |r| descending
    flagged_pairs = []
    for i, col_a in enumerate(input_cols):
        for j, col_b in enumerate(input_cols):
            if j <= i:
                continue
            r = float(corr.loc[col_a, col_b])
            if abs(r) >= threshold:
                flagged_pairs.append({
                    "col_a": col_a,
                    "col_b": col_b,
                    "r":     round(r, 4),
                    "abs_r": round(abs(r), 4),
                })
    flagged_pairs.sort(key=lambda x: x["abs_r"], reverse=True)

    # Low-variance flags — coefficient of variation = |std / mean|
    low_variance = []
    for col in input_cols:
        series = X[col].dropna()
        if len(series) == 0:
            continue
        mean = float(series.mean())
        std  = float(series.std()) if len(series) > 1 else 0.0
        cv   = abs(std / mean) if abs(mean) > 1e-10 else std
        if cv < cv_threshold:
            low_variance.append({
                "col":  col,
                "cv":   round(cv, 6),
                "std":  round(std, 6),
                "mean": round(mean, 6),
            })

    # VIF — diagonal of the inverse of the correlation matrix.
    # Falls back to per-column OLS if the matrix is singular.
    vif = {}
    try:
        corr_arr  = corr.values.astype(float)
        vif_diag  = np.diag(np.linalg.inv(corr_arr))
        vif       = {col: round(float(v), 2) for col, v in zip(input_cols, vif_diag)}
    except np.linalg.LinAlgError:
        X_arr = X.values.astype(float)
        for i, col in enumerate(input_cols):
            others = np.delete(X_arr, i, axis=1)
            A      = np.column_stack([np.ones(len(others)), others])
            y      = X_arr[:, i]
            coeffs, _, _, _ = np.linalg.lstsq(A, y, rcond=None)
            y_hat  = A @ coeffs
            ss_res = float(np.sum((y - y_hat) ** 2))
            ss_tot = float(np.sum((y - y.mean()) ** 2))
            r2     = 1.0 - ss_res / ss_tot if ss_tot > 1e-10 else 0.0
            vif[col] = round(1.0 / (1.0 - r2) if r2 < 0.9999 else 999.0, 2)

    # Sobol ST — mean across all cached interpretation outputs (if available)
    sobol_st = None
    interp_cache = state["surrogate_sessions"]["primary"]["models"].get("interpretation", {})
    if interp_cache:
        st_sum   = {col: 0.0 for col in input_cols}
        n_cached = 0
        for interp in interp_cache.values():
            st_vals = (interp.get("sensitivity") or {}).get("ST", {})
            for col in input_cols:
                st_sum[col] += float(st_vals.get(col, 0.0))
            n_cached += 1
        if n_cached > 0:
            sobol_st = {col: round(st_sum[col] / n_cached, 4) for col in input_cols}

    # Correlation matrix as dict[col][col] → float
    corr_dict = {
        col: {other: round(float(corr.loc[col, other]), 4) for other in input_cols}
        for col in input_cols
    }

    return jsonify({
        "success":            True,
        "input_columns":      input_cols,
        "threshold":          threshold,
        "cv_threshold":       cv_threshold,
        "correlation_matrix": corr_dict,
        "flagged_pairs":      flagged_pairs,
        "low_variance":       low_variance,
        "vif":                vif,
        "sobol_st":           sobol_st,
    }), 200


@bp.route("/screen/pca", methods=["POST"])
def screen_pca():
    """
    Compute PCA on current designated input columns.
    Returns explained variance per component, cumulative variance, and
    top-3 input loadings per component — used to preview before applying.

    Body JSON (optional):
        n_components (int) — number of components to preview; None = auto (≥95% variance)
    """
    from sklearn.decomposition import PCA as _PCA

    data         = request.get_json(silent=True) or {}
    n_components = data.get("n_components", None)

    state      = current_app.config["STATE"]
    primary    = state["datasets"]["primary"]
    meta       = primary["metadata"]
    input_cols = meta.get("input_columns", [])

    if not input_cols:
        return jsonify({
            "success":    False,
            "error_code": "NO_INPUT_COLUMNS",
            "message":    "No input columns designated.",
        }), 400

    df   = (primary["normalized"] if primary.get("normalized") is not None else primary["clean"])
    X    = df[input_cols].values.astype(float)
    max_comp = len(input_cols)

    pca_full = _PCA(n_components=max_comp)
    pca_full.fit(X)

    ev         = pca_full.explained_variance_ratio_
    cumulative = np.cumsum(ev)

    # Auto n_components: fewest components reaching ≥ 95% cumulative variance
    auto_n = int(np.searchsorted(cumulative, 0.95) + 1)
    auto_n = min(auto_n, max_comp)

    if n_components is None:
        n_components = auto_n
    n_components = max(1, min(int(n_components), max_comp))

    # Loadings: top-3 original inputs per component (by absolute loading weight)
    loadings = []
    for i in range(n_components):
        component = pca_full.components_[i]
        top_idx   = np.argsort(np.abs(component))[::-1][:3]
        loadings.append({
            "component":      f"PC{i + 1}",
            "variance_ratio": round(float(ev[i]), 4),
            "top_inputs":     [
                {"col": input_cols[j], "loading": round(float(component[j]), 4)}
                for j in top_idx
            ],
        })

    return jsonify({
        "success":                 True,
        "input_columns":           input_cols,
        "n_components_selected":   n_components,
        "n_components_auto":       auto_n,
        "n_components_max":        max_comp,
        "explained_variance_ratio": [round(float(v), 4) for v in ev],
        "cumulative_variance":      [round(float(v), 4) for v in cumulative],
        "loadings":                loadings,
    }), 200


@bp.route("/screen/apply", methods=["PUT"])
def screen_apply():
    """
    Apply a filtered input column subset (mode="columns") or PCA transform
    (mode="pca") to STATE. Clears the surrogate session in both cases.

    Body JSON:
        mode          ("columns" | "pca", default "columns")
        input_columns (list[str]) — for mode="columns"
        n_components  (int)       — for mode="pca"
    """
    from sklearn.decomposition import PCA as _PCA
    import pandas as pd

    data       = request.get_json(silent=True) or {}
    mode       = data.get("mode", "columns")

    state      = current_app.config["STATE"]
    primary    = state["datasets"]["primary"]
    meta       = primary["metadata"]
    all_inputs = meta.get("input_columns", [])

    if not all_inputs:
        return jsonify({
            "success":    False,
            "error_code": "NO_INPUT_COLUMNS",
            "message":    "No input columns designated.",
        }), 400

    def _clear_surrogate():
        active_key = state["datasets"].get("active_dataset_key")
        state["surrogate_sessions"]["primary"]["models"] = {}
        state["surrogate_sessions"]["primary"]["config"] = {
            "model_type":  None,
            "test_split":  DEFAULT_TEST_SPLIT,
            "cv_folds":    DEFAULT_CV_FOLDS,
            "hyperparams": {},
        }
        if active_key and active_key in state["datasets"]["_datasets"]:
            state["datasets"]["_datasets"][active_key]["surrogate_session"] = {
                "models": {},
                "config": {
                    "model_type": None,
                    "test_split": DEFAULT_TEST_SPLIT,
                    "cv_folds":   DEFAULT_CV_FOLDS,
                },
            }
        return active_key

    # ── Mode: column subset ───────────────────────────────────────────────────
    if mode == "columns":
        new_input_cols = list(data.get("input_columns", []))

        if len(new_input_cols) < 1:
            return jsonify({
                "success": False, "error_code": "TOO_FEW_INPUTS",
                "message": "At least one input column must be selected.",
            }), 400

        invalid = [c for c in new_input_cols if c not in all_inputs]
        if invalid:
            return jsonify({
                "success": False, "error_code": "INVALID_COLUMNS",
                "message": f"Columns not in designated inputs: {invalid}",
            }), 400

        meta["input_columns"] = new_input_cols
        meta["n_inputs"]      = len(new_input_cols)
        meta["pca_applied"]   = False

        active_key = _clear_surrogate()
        if active_key and active_key in state["datasets"]["_datasets"]:
            ds_meta = state["datasets"]["_datasets"][active_key]["metadata"]
            ds_meta["input_columns"] = new_input_cols
            ds_meta["n_inputs"]      = len(new_input_cols)

        n_dropped = len(all_inputs) - len(new_input_cols)
        append_audit_event(state, "inputs_filtered", {
            "mode":            "columns",
            "original_inputs": all_inputs,
            "selected_inputs": new_input_cols,
            "n_dropped":       n_dropped,
        })

        return jsonify({
            "success":       True,
            "mode":          "columns",
            "input_columns": new_input_cols,
            "n_selected":    len(new_input_cols),
            "n_dropped":     n_dropped,
            "message": (
                f"{len(new_input_cols)} input{'s' if len(new_input_cols) != 1 else ''} selected"
                + (f", {n_dropped} removed." if n_dropped else ".")
            ),
        }), 200

    # ── Mode: PCA ─────────────────────────────────────────────────────────────
    if mode == "pca":
        n_components = max(1, min(int(data.get("n_components", 2)), len(all_inputs)))

        df   = (primary["normalized"] if primary.get("normalized") is not None else primary["clean"])
        X    = df[all_inputs].values.astype(float)
        pca  = _PCA(n_components=n_components)
        X_pca = pca.fit_transform(X)
        pc_names = [f"PC{i + 1}" for i in range(n_components)]

        # Store fitted PCA for use in prediction pipeline
        state["surrogate_sessions"]["primary"]["pca"] = {
            "model":            pca,
            "original_inputs":  all_inputs,
            "pc_names":         pc_names,
            "n_components":     n_components,
            "explained_variance_ratio": pca.explained_variance_ratio_.tolist(),
        }

        # Inject PC columns into a copy of the normalized/clean DataFrame
        base_df = ((primary["normalized"] if primary.get("normalized") is not None else primary["clean"])).copy()
        for i, name in enumerate(pc_names):
            base_df[name] = X_pca[:, i]
        primary["normalized"] = base_df

        # Replace input_columns with PC names
        meta["input_columns"] = pc_names
        meta["n_inputs"]      = n_components
        meta["pca_applied"]   = True

        active_key = _clear_surrogate()
        if active_key and active_key in state["datasets"]["_datasets"]:
            ds_meta = state["datasets"]["_datasets"][active_key]["metadata"]
            ds_meta["input_columns"] = pc_names
            ds_meta["n_inputs"]      = n_components

        ev_pct = round(100 * float(sum(pca.explained_variance_ratio_)), 1)
        append_audit_event(state, "inputs_filtered", {
            "mode":             "pca",
            "original_inputs":  all_inputs,
            "pc_names":         pc_names,
            "n_components":     n_components,
            "explained_variance": pca.explained_variance_ratio_.tolist(),
        })

        return jsonify({
            "success":                  True,
            "mode":                     "pca",
            "input_columns":            pc_names,
            "n_selected":               n_components,
            "n_dropped":                len(all_inputs) - n_components,
            "explained_variance_ratio": pca.explained_variance_ratio_.tolist(),
            "message": (
                f"PCA applied: {n_components} component{'s' if n_components != 1 else ''} "
                f"explain {ev_pct}% of input variance."
            ),
        }), 200

    return jsonify({
        "success": False, "error_code": "UNKNOWN_MODE",
        "message": f"Unknown mode '{mode}'. Use 'columns' or 'pca'.",
    }), 400


# ─── SERIALISATION HELPERS ────────────────────────────────────────────────────


def _to_python(val):
    """Convert numpy scalar to native Python type for JSON serialisation."""
    if isinstance(val, (np.integer,)):
        return int(val)
    if isinstance(val, (np.floating,)):
        return None if np.isnan(val) else float(val)
    if isinstance(val, (np.bool_,)):
        return bool(val)
    if isinstance(val, float) and (val != val):   # catches Python native float('nan')
        return None
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
