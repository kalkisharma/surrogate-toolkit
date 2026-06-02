"""
================================================================================
FILE: ingestion.py
MODULE: app/data/
PURPOSE: CSV ingestion pipeline. Validates, coerces, and returns a clean
         DataFrame from an uploaded file stream. Pure function — no Flask
         imports — so it can be unit tested without an app context.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-11
VERSION: 0.1.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

from datetime import datetime, timezone
from io import BytesIO
from typing import Optional

import numpy as np
import pandas as pd

from config.settings import (
    MAX_COLUMNS,
    MAX_FILE_SIZE_BYTES,
    MAX_HEADER_LENGTH,
    MIN_COLUMNS,
    MIN_ROWS,
    MAX_ROWS,
    MISSING_VALUE_THRESHOLD,
)

# ─── ERROR HELPERS ────────────────────────────────────────────────────────────


def _make_error(
    error_code: str,
    message: str,
    detail: str = "",
    recoverable: bool = True,
    allowed_actions: Optional[list] = None,
) -> dict:
    """
    Build a standard error envelope dict.

    All error returns from ingest_csv use this helper so the API layer
    can pass them through without transformation.

    Args:
        error_code: Machine-readable uppercase snake_case code.
        message: Actionable human-readable description.
        detail: Technical detail for logs (not shown in the UI).
        recoverable: True if the user can fix and retry.
        allowed_actions: List of allowed follow-up actions (e.g. ["retry"]).

    Returns:
        dict: Standard error envelope.

    Future:
        Add i18n message key for multi-language support.
    """
    return {
        "success": False,
        "error_code": error_code,
        "message": message,
        "detail": detail,
        "recoverable": recoverable,
        "allowed_actions": allowed_actions if allowed_actions is not None else ["retry"],
    }


# ─── HEADER CLEANING ──────────────────────────────────────────────────────────


def _clean_header(raw: str) -> str:
    """
    Strip leading/trailing whitespace and quote characters from a column name.

    Args:
        raw: The raw column name string as read by pandas.

    Returns:
        str: Cleaned column name.

    Future:
        Configurable character strip set.
    """
    cleaned = raw.strip().strip("'\"")
    return cleaned


def _clean_headers(columns) -> list[str]:
    """
    Apply _clean_header to every column name in the index.

    Args:
        columns: pandas Index of raw column names.

    Returns:
        list[str]: Cleaned column name strings.
    """
    return [_clean_header(str(c)) for c in columns]


# ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────


def ingest_csv(
    file_obj,
    filename: str,
) -> tuple[Optional[pd.DataFrame], dict]:
    """
    Validate and ingest a CSV file stream into a pandas DataFrame.

    The pipeline is:
      1. File size check (before reading into memory)
      2. Extension check
      3. Encoding detection (UTF-8, then latin-1)
      4. Header read + cleaning + length validation
      5. Duplicate header check
      6. Full CSV read with cleaned headers
      7. Row count check
      8. Column count check
      9. Float coercion (track failures)
     10. Null tolerance check (post-coercion)
     11. Residual non-numeric column check
     12. Build and return metadata

    Each step stops the pipeline on failure and returns (None, error_envelope).

    Args:
        file_obj: A file-like object (e.g. werkzeug FileStorage). Must support
                  seek() and read().
        filename: Original filename string for error messages and metadata.

    Returns:
        tuple[pd.DataFrame | None, dict]:
            On success: (dataframe, {"success": True, "metadata": {...}})
            On failure: (None, standard_error_envelope_dict)

    Raises:
        Nothing — all exceptions are caught and returned as error envelopes.

    Notes:
        The returned DataFrame has float64 columns after coercion. Columns that
        were originally integer-valued will be float64 if any nulls were
        introduced by coercion.

        File pointer position: seek(0) is called before each pandas read. Do
        not rely on the file pointer being at any particular position after this
        function returns.

    Future:
        Support .xlsx via openpyxl. Support gzip-compressed CSVs.
    """
    # ── 1. FILE SIZE ──────────────────────────────────────────────────────────
    try:
        file_obj.seek(0, 2)
        file_size = file_obj.tell()
        file_obj.seek(0)
    except Exception as exc:
        return None, _make_error(
            "FILE_READ_ERROR",
            "Could not read the file. Please try again.",
            detail=str(exc),
        )

    if file_size > MAX_FILE_SIZE_BYTES:
        return None, _make_error(
            "FILE_TOO_LARGE",
            f"File size ({file_size / (1024 * 1024):.1f} MB) exceeds the "
            f"maximum allowed size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB.",
            detail=f"file_size={file_size}, limit={MAX_FILE_SIZE_BYTES}",
        )

    # ── 2. EXTENSION ──────────────────────────────────────────────────────────
    if not filename.lower().endswith(".csv"):
        return None, _make_error(
            "INVALID_FILE_TYPE",
            "Only CSV files (.csv) are supported. Please upload a .csv file.",
            detail=f"filename='{filename}'",
            recoverable=True,
        )

    # ── 3. ENCODING ──────────────────────────────────────────────────────────
    raw_bytes = file_obj.read()
    file_obj.seek(0)

    content: Optional[str] = None
    for encoding in ("utf-8", "latin-1"):
        try:
            content = raw_bytes.decode(encoding)
            break
        except (UnicodeDecodeError, LookupError):
            continue

    if content is None:
        return None, _make_error(
            "ENCODING_ERROR",
            "Could not decode the file. Please save it as UTF-8 or latin-1 encoded CSV.",
            detail="Failed both utf-8 and latin-1 decoding.",
            recoverable=True,
        )

    # Use BytesIO from here so pandas reads from memory (no seek issues on
    # non-seekable streams, and avoids re-reading from the original file_obj).
    buf = BytesIO(raw_bytes)

    # ── 4. HEADER READ + CLEAN ────────────────────────────────────────────────
    # Read the header row via Python's csv module BEFORE pandas touches the file.
    # pandas auto-renames duplicate columns (x,x → x,x.1), which would hide
    # duplicates from our check. csv.reader gives us the raw column names as
    # they appear in the file.
    import csv as _csv
    import io as _io

    try:
        first_line = content.split("\n")[0]
        raw_headers = next(_csv.reader(_io.StringIO(first_line)))
    except (StopIteration, Exception) as exc:
        return None, _make_error(
            "CSV_PARSE_ERROR",
            "Could not parse the CSV header row. Check that the file is a valid CSV.",
            detail=str(exc),
        )

    cleaned_headers = _clean_headers(raw_headers)

    long_headers = [h for h in cleaned_headers if len(h) > MAX_HEADER_LENGTH]
    if long_headers:
        names_str = ", ".join(f"'{h[:40]}...'" if len(h) > 40 else f"'{h}'" for h in long_headers)
        return None, _make_error(
            "HEADER_TOO_LONG",
            f"Column name(s) exceed the maximum length of {MAX_HEADER_LENGTH} characters: {names_str}.",
            detail=f"offending_headers={long_headers}",
        )

    # ── 5. DUPLICATE HEADERS ──────────────────────────────────────────────────
    seen, duplicates = set(), []
    for h in cleaned_headers:
        if h in seen:
            duplicates.append(h)
        seen.add(h)

    if duplicates:
        dup_str = ", ".join(f"'{d}'" for d in set(duplicates))
        return None, _make_error(
            "DUPLICATE_HEADERS",
            f"Duplicate column name(s) detected: {dup_str}. Each column must have a unique name.",
            detail=f"duplicates={duplicates}",
        )

    # ── 6. FULL CSV READ ──────────────────────────────────────────────────────
    try:
        # Read with header=0 so pandas skips the header row automatically.
        # Then overwrite columns with our validated cleaned_headers list so that
        # the DataFrame uses the names we've already validated (stripped, de-duped).
        df = pd.read_csv(BytesIO(raw_bytes), header=0)
        df.columns = cleaned_headers
    except Exception as exc:
        return None, _make_error(
            "CSV_PARSE_ERROR",
            "Could not parse the CSV file. Check that it is a valid, well-formed CSV.",
            detail=str(exc),
        )

    # ── 7. ROW COUNT ──────────────────────────────────────────────────────────
    n_rows = len(df)
    if n_rows < MIN_ROWS:
        return None, _make_error(
            "INSUFFICIENT_ROWS",
            f"The file contains {n_rows} data row(s), but at least {MIN_ROWS} are required "
            f"to train a reliable surrogate model.",
            detail=f"n_rows={n_rows}, minimum={MIN_ROWS}",
        )
    if n_rows > MAX_ROWS:
        return None, _make_error(
            "TOO_MANY_ROWS",
            f"The file contains {n_rows:,} rows, which exceeds the maximum of {MAX_ROWS:,}. "
            f"Consider splitting the dataset or sampling.",
            detail=f"n_rows={n_rows}, maximum={MAX_ROWS}",
        )

    # ── 8. COLUMN COUNT ───────────────────────────────────────────────────────
    n_cols = len(df.columns)
    if n_cols < MIN_COLUMNS:
        return None, _make_error(
            "INSUFFICIENT_COLUMNS",
            f"The file contains {n_cols} column(s), but at least {MIN_COLUMNS} are required "
            f"(at minimum one input and one output column).",
            detail=f"n_cols={n_cols}, minimum={MIN_COLUMNS}",
        )
    if n_cols > MAX_COLUMNS:
        return None, _make_error(
            "TOO_MANY_COLUMNS",
            f"The file contains {n_cols} columns, which exceeds the maximum of {MAX_COLUMNS}. "
            f"Use dimensionality reduction before importing.",
            detail=f"n_cols={n_cols}, maximum={MAX_COLUMNS}",
        )

    # ── 9. FLOAT COERCION ─────────────────────────────────────────────────────
    coercion_warnings = []
    for col in df.columns:
        if not pd.api.types.is_numeric_dtype(df[col]):
            original_null_count = df[col].isna().sum()
            coerced = pd.to_numeric(df[col], errors="coerce")
            new_nulls = coerced.isna().sum() - original_null_count
            if new_nulls > 0:
                coercion_warnings.append(
                    f"Column '{col}': {new_nulls} non-numeric value(s) converted to NaN."
                )
            df[col] = coerced

    # ── 10. NULL TOLERANCE ────────────────────────────────────────────────────
    null_counts = df.isnull().sum()
    null_ratios = null_counts / n_rows
    excessive = {
        col: float(ratio)
        for col, ratio in null_ratios.items()
        if ratio > MISSING_VALUE_THRESHOLD
    }
    if excessive:
        col_list = ", ".join(
            f"'{c}' ({r * 100:.1f}%)" for c, r in excessive.items()
        )
        return None, _make_error(
            "EXCESSIVE_NULLS",
            f"The following column(s) exceed the {MISSING_VALUE_THRESHOLD * 100:.0f}% "
            f"missing-value limit: {col_list}. Remove or impute these columns before importing.",
            detail=f"excessive_null_columns={list(excessive.keys())}",
        )

    # ── 11. RESIDUAL NON-NUMERIC ──────────────────────────────────────────────
    non_numeric = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
    if non_numeric:
        col_list = ", ".join(f"'{c}'" for c in non_numeric)
        return None, _make_error(
            "NON_NUMERIC_COLUMNS",
            f"Column(s) {col_list} could not be converted to numbers. "
            f"Remove categorical columns before importing.",
            detail=f"non_numeric_columns={non_numeric}",
        )

    # ── 12. METADATA ──────────────────────────────────────────────────────────
    metadata = {
        "filename": filename,
        "upload_timestamp": datetime.now(timezone.utc).isoformat(),
        "n_rows_original": n_rows,
        "n_cols": n_cols,
        "columns": list(df.columns),
        "dtypes": {col: str(df[col].dtype) for col in df.columns},
        "null_counts": {col: int(null_counts[col]) for col in df.columns},
        "coercion_warnings": coercion_warnings,
    }

    return df, {"success": True, "metadata": metadata}
