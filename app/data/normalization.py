"""
================================================================================
FILE: normalization.py
MODULE: app/data/
PURPOSE: Feature normalization and scaling for designated input columns.
         Writes to primary["normalized"]; primary["clean"] is never mutated.
         Phase 22C: extract_noise_array() prepares per-sample σ² for model training.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-06-02
VERSION: 0.5.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import numpy as np
import pandas as pd


def normalize_dataframe(
    df: pd.DataFrame,
    columns: list,
    method: str,
) -> tuple:
    """
    Normalize the specified columns of df using the given method.

    Args:
        df:      Source DataFrame (primary["clean"]). Not mutated.
        columns: Column names to normalize (input columns only).
        method:  "minmax" | "zscore" | "none"

    Returns:
        (normalized_df, params) where:
            normalized_df — full copy of df with `columns` scaled
            params        — dict keyed by column name with scaler parameters
                            needed for inverse transform in Phase 4

    Raises:
        ValueError: if method is not recognised.
    """
    if method not in ("minmax", "zscore", "none"):
        raise ValueError(f"Unknown normalization method: {method!r}")

    result = df.copy()

    if method == "none":
        return result, {}

    params = {}
    for col in columns:
        series = df[col].dropna()
        if len(series) == 0:
            params[col] = {"method": method}
            continue

        if method == "minmax":
            col_min = float(series.min())
            col_max = float(series.max())
            rng = col_max - col_min
            if rng == 0:
                result[col] = 0.0
            else:
                result[col] = (df[col] - col_min) / rng
            params[col] = {"method": "minmax", "min": col_min, "max": col_max}

        elif method == "zscore":
            col_mean = float(series.mean())
            col_std  = float(series.std())
            if col_std == 0:
                result[col] = 0.0
            else:
                result[col] = (df[col] - col_mean) / col_std
            params[col] = {"method": "zscore", "mean": col_mean, "std": col_std}

    return result, params


def extract_noise_array(df: pd.DataFrame, error_columns: dict):
    """Return a per-sample variance array for noise-weighted model training (Phase 22C/D).

    Args:
        df:            Working DataFrame (normalized or clean).
        error_columns: {output_col: error_col} confirmed at designate time.
                       Values must be column names present in df.

    Returns:
        np.ndarray of shape (n_samples,) with per-sample σ² values,
        or None if error_columns is empty or no companion columns are in df.

    Notes:
        - σ values (std dev) are read from the companion columns and squared
          to produce variance (σ²), as expected by sklearn alpha and sample_weight.
        - NaN entries are substituted with the column mean before averaging.
        - A zero floor of 1e-6 is applied before squaring to prevent division-by-zero
          when sample_weight = 1/σ² is computed downstream.
        - Output columns are not scaled here because the toolkit does not currently
          normalize output columns. If output normalization is added in future, this
          function should divide each companion's σ by the output's normalization scale
          factor before squaring.
    """
    if not error_columns:
        return None

    available_cols = [ec for ec in error_columns.values() if ec in df.columns]
    if not available_cols:
        return None

    sigma_df = df[available_cols].copy()

    # Substitute NaN with per-column mean
    for col in sigma_df.columns:
        col_mean = float(sigma_df[col].mean(skipna=True))
        fill_val = col_mean if np.isfinite(col_mean) else 1e-6
        sigma_df[col] = sigma_df[col].fillna(fill_val)

    # Mean sigma across all available companion columns
    sigma_mean = sigma_df.mean(axis=1).values.astype(float)

    # Zero floor then square → σ²
    return np.maximum(sigma_mean, 1e-6) ** 2
