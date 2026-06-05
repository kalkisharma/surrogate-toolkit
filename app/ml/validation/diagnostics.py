"""
================================================================================
FILE: diagnostics.py
MODULE: app/ml/validation/
PURPOSE: Model diagnostic metrics — R², RMSE, MAE per output column
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-06-05
VERSION: 0.7.1
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import warnings

import numpy as np
from sklearn.exceptions import UndefinedMetricWarning
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score


def compute_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    output_columns: list,
) -> list:
    """Compute R², RMSE, and MAE per output column.

    Args:
        y_true: (n_samples, n_outputs) array of actual values.
        y_pred: (n_samples, n_outputs) array of predicted values.
        output_columns: Names of each output column in order.

    Returns:
        List of dicts, one per output column:
            [
                {
                    "column": str,
                    "r2":   float,
                    "rmse": float,
                    "mae":  float,
                },
                ...
            ]

    Raises:
        ValueError: If y_true and y_pred shapes do not match, or if
                    len(output_columns) does not match n_outputs.

    Notes:
        All metrics are rounded to 6 decimal places to keep JSON responses
        compact. RMSE is computed as sqrt(mean_squared_error) to avoid
        dependency on the squared=False kwarg (added in sklearn 0.24).

    Future:
        Add per-sample residuals array for parity / residual plot preparation.
    """
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)

    if y_true.ndim == 1:
        y_true = y_true.reshape(-1, 1)
    if y_pred.ndim == 1:
        y_pred = y_pred.reshape(-1, 1)

    if y_true.shape != y_pred.shape:
        raise ValueError(
            f"y_true shape {y_true.shape} does not match "
            f"y_pred shape {y_pred.shape}."
        )
    if y_true.shape[1] != len(output_columns):
        raise ValueError(
            f"output_columns length ({len(output_columns)}) does not match "
            f"number of output columns ({y_true.shape[1]})."
        )

    results = []
    for i, col in enumerate(output_columns):
        yt = y_true[:, i]
        yp = y_pred[:, i]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UndefinedMetricWarning)
            r2 = float(r2_score(yt, yp))
        results.append({
            "column": col,
            "r2":   round(r2, 6),
            "rmse": round(float(np.sqrt(mean_squared_error(yt, yp))), 6),
            "mae":  round(float(mean_absolute_error(yt, yp)), 6),
        })

    return results
