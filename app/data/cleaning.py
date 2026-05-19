"""
================================================================================
FILE: cleaning.py
MODULE: app/data/
PURPOSE: Data cleaning: outlier removal, imputation, deduplication.
         All functions are non-mutating — they accept a DataFrame and return
         a new DataFrame plus a count of affected rows.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-12
LAST MODIFIED: 2026-05-12
VERSION: 0.5.1
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import numpy as np
import pandas as pd

from config.settings import IQR_OUTLIER_MULTIPLIER


# ─── SUMMARY ──────────────────────────────────────────────────────────────────


def compute_cleaning_stats(df: pd.DataFrame) -> dict:
    """
    Compute actionable cleaning counts for the given DataFrame.

    Args:
        df (pd.DataFrame): The current clean DataFrame.

    Returns:
        dict: {
            "null_rows":      int,  # rows with at least one null value
            "duplicate_rows": int,  # exact duplicate rows
            "outlier_rows":   int,  # rows flagged as IQR outliers in any column
        }

    Notes:
        IQR computation skips NaN values via dropna() so existing nulls do not
        distort the outlier thresholds. Columns with fewer than 4 non-null values
        or zero IQR are excluded from outlier detection.

    Future:
        Return per-column breakdowns for a more detailed cleaning dashboard.
    """
    null_rows      = int(df.isnull().any(axis=1).sum())
    duplicate_rows = int(df.duplicated().sum())
    outlier_rows   = int(_outlier_mask(df).sum())

    return {
        "null_rows":      null_rows,
        "duplicate_rows": duplicate_rows,
        "outlier_rows":   outlier_rows,
    }


# ─── NULL HANDLING ─────────────────────────────────────────────────────────────


def handle_nulls(df: pd.DataFrame, strategy: str) -> tuple:
    """
    Apply a missing-value strategy to the DataFrame.

    Args:
        df (pd.DataFrame): Source DataFrame. Not mutated.
        strategy (str): One of "drop_rows", "mean_impute", "median_impute".

    Returns:
        tuple[pd.DataFrame, int]:
            result_df   — cleaned DataFrame
            rows_affected — rows removed (drop_rows) or rows that had at least
                            one null and were imputed (impute strategies)

    Raises:
        ValueError: If strategy is not one of the accepted values.

    Notes:
        Imputation is applied only to numeric columns. Non-numeric columns with
        nulls are left unchanged (edge case: all-numeric datasets assumed here).

    Future:
        Per-column strategy overrides; forward/backward fill for time-series data.
    """
    if strategy == "drop_rows":
        result = df.dropna().reset_index(drop=True)
        return result, len(df) - len(result)

    if strategy in ("mean_impute", "median_impute"):
        rows_with_null = int(df.isnull().any(axis=1).sum())
        result = df.copy()
        for col in result.select_dtypes(include=[np.number]).columns:
            if result[col].isnull().any():
                fill = result[col].mean() if strategy == "mean_impute" else result[col].median()
                result[col] = result[col].fillna(fill)
        return result, rows_with_null

    raise ValueError(f"Unknown null strategy: {strategy!r}")


# ─── OUTLIER TREATMENT ────────────────────────────────────────────────────────


def handle_outliers(df: pd.DataFrame, strategy: str, columns=None, iqr_multiplier=None) -> tuple:
    """
    Apply an outlier treatment strategy to the DataFrame.

    Args:
        df (pd.DataFrame): Source DataFrame. Not mutated.
        strategy (str):    One of "keep", "drop_rows".
        columns (list):    Optional list of columns to consider for outlier detection.
                           If None, all numeric columns are used.

    Returns:
        tuple[pd.DataFrame, int]:
            result_df     — treated DataFrame
            rows_affected — rows removed (0 for "keep")

    Raises:
        ValueError: If strategy is not one of the accepted values.

    Notes:
        Uses IQR_OUTLIER_MULTIPLIER from settings (default 1.5). NaN values are
        excluded from quartile computation to avoid skewing thresholds.
        Columns with fewer than 4 non-null values or zero IQR are skipped.

        "winsorize" is intentionally absent. Winsorizing output columns would
        corrupt training targets. Winsorize will be added post-designation so it
        can be safely scoped to input columns only.

    Future:
        Winsorize strategy (post-designation, input columns only).
    """
    if strategy == "keep":
        return df.copy(), 0

    if strategy == "drop_rows":
        mask    = _outlier_mask(df, columns=columns, iqr_multiplier=iqr_multiplier)
        removed = int(mask.sum())
        result  = df[~mask].reset_index(drop=True)
        return result, removed

    raise ValueError(f"Unknown outlier strategy: {strategy!r}")


# ─── DEDUPLICATION ────────────────────────────────────────────────────────────


def remove_duplicates(df: pd.DataFrame) -> tuple:
    """
    Remove exact duplicate rows from the DataFrame.

    Args:
        df (pd.DataFrame): Source DataFrame. Not mutated.

    Returns:
        tuple[pd.DataFrame, int]: (result_df, rows_removed)

    Notes:
        Uses pandas.DataFrame.drop_duplicates() with default keep="first".

    Future:
        Fuzzy deduplication (near-duplicate detection via numeric distance threshold).
    """
    before = len(df)
    result = df.drop_duplicates().reset_index(drop=True)
    return result, before - len(result)


# ─── LOG TRANSFORM ────────────────────────────────────────────────────────────


def apply_log_transform(df: pd.DataFrame, columns: list) -> tuple:
    """
    Apply a natural log(1 + x) transform to the specified numeric columns.

    Args:
        df (pd.DataFrame): Source DataFrame. Not mutated.
        columns (list[str]): Column names to transform.

    Returns:
        tuple[pd.DataFrame, int]: (result_df, n_columns_transformed)

    Raises:
        ValueError: If any column name is not in df, or if any selected column
                    contains values <= -1 (log1p undefined or -inf at those points).

    Notes:
        Uses numpy.log1p for zero-safe computation: log1p(0) = 0. Columns with
        values > -1 but near -1 will produce large negative outputs — the caller
        should inspect the resulting distribution before proceeding.

    Future:
        Per-column transform preview; box-cox / Yeo-Johnson alternatives.
    """
    invalid = [c for c in columns if c not in df.columns]
    if invalid:
        raise ValueError(f"Unknown column(s): {invalid}")

    for col in columns:
        col_min = df[col].dropna().min()
        if col_min <= -1:
            raise ValueError(
                f"Column '{col}' has values ≤ −1 (min≈{col_min:.4g}). "
                "log1p requires all values > −1."
            )

    result = df.copy()
    for col in columns:
        result[col] = np.log1p(result[col])

    return result, len(columns)


# ─── PRIVATE HELPERS ──────────────────────────────────────────────────────────


def _outlier_mask(df: pd.DataFrame, columns=None, iqr_multiplier=None) -> "pd.Series":
    """Return a boolean Series: True for rows that are IQR outliers.

    Args:
        df:             Source DataFrame.
        columns:        Optional list of column names to consider. If None, all numeric
                        columns are used (original behaviour).
        iqr_multiplier: Optional k for Q1 - k*IQR / Q3 + k*IQR thresholds.
                        Defaults to IQR_OUTLIER_MULTIPLIER (1.5).
    """
    k = float(iqr_multiplier) if iqr_multiplier is not None else IQR_OUTLIER_MULTIPLIER
    numeric_cols = list(df.select_dtypes(include=[np.number]).columns)
    if columns:
        numeric_cols = [c for c in columns if c in numeric_cols]
    mask = pd.Series(False, index=df.index)
    for col in numeric_cols:
        series = df[col].dropna()
        if len(series) < 4:
            continue
        q1  = series.quantile(0.25)
        q3  = series.quantile(0.75)
        iqr = q3 - q1
        if iqr == 0:
            continue
        lower      = q1 - k * iqr
        upper      = q3 + k * iqr
        col_flags  = (df[col] < lower) | (df[col] > upper)
        mask       = mask | col_flags.fillna(False)
    return mask


def compute_column_outlier_counts(df: pd.DataFrame) -> dict:
    """Return {col: count} of IQR outlier rows for each numeric column independently."""
    counts: dict = {}
    for col in df.select_dtypes(include=[np.number]).columns:
        series = df[col].dropna()
        if len(series) < 4:
            counts[col] = 0
            continue
        q1  = series.quantile(0.25)
        q3  = series.quantile(0.75)
        iqr = q3 - q1
        if iqr == 0:
            counts[col] = 0
            continue
        lower      = q1 - IQR_OUTLIER_MULTIPLIER * iqr
        upper      = q3 + IQR_OUTLIER_MULTIPLIER * iqr
        counts[col] = int(((df[col] < lower) | (df[col] > upper)).sum())
    return counts
