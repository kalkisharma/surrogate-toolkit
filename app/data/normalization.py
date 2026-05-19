"""
================================================================================
FILE: normalization.py
MODULE: app/data/
PURPOSE: Feature normalization and scaling for designated input columns.
         Writes to primary["normalized"]; primary["clean"] is never mutated.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-12
VERSION: 0.4.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

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
