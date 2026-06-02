"""
================================================================================
FILE: cross_validation.py
MODULE: app/ml/validation/
PURPOSE: K-fold cross-validation for surrogate models
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-12
VERSION: 0.7.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import copy

import numpy as np
from sklearn.model_selection import KFold

from app.ml.models.base_model import BaseSurrogateModel
from app.ml.validation.diagnostics import compute_metrics
from config.settings import DEFAULT_RANDOM_STATE


def run_cross_validation(
    model: BaseSurrogateModel,
    X: np.ndarray,
    y: np.ndarray,
    output_columns: list,
    n_folds: int,
    input_columns: list,
) -> dict:
    """Run k-fold cross-validation, returning per-output aggregated metrics.

    Args:
        model: An *unfitted* BaseSurrogateModel. A deep copy is made for each
               fold so the original object is never mutated.
        X: (n_samples, n_inputs) feature array.
        y: (n_samples, n_outputs) target array.
        output_columns: Output column names in order.
        n_folds: Number of cross-validation folds (k).
        input_columns: Input column names in order.

    Returns:
        dict:
            {
                "n_folds": int,
                "per_output": [
                    {
                        "column":     str,
                        "mean_r2":    float,
                        "std_r2":     float,
                        "mean_rmse":  float,
                        "std_rmse":   float,
                        "mean_mae":   float,
                        "std_mae":    float,
                    },
                    ...   (one entry per output column)
                ]
            }

    Raises:
        ValueError: If n_folds > len(X).

    Notes:
        A fresh deep copy of the model is trained on each fold so earlier folds
        cannot contaminate later ones — this is the correct behaviour for sklearn
        estimators that update internal state on fit().

        The returned metrics are averages across all k folds and represent
        out-of-fold generalisation performance, not final model performance.
        After cross-validation, the caller should train a separate final model
        on the full training set and evaluate it on the held-out test set.

    Future:
        Stratified k-fold for classification surrogates.
        Return per-fold scores to enable learning-curve diagnostics.
    """
    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=float)
    if y.ndim == 1:
        y = y.reshape(-1, 1)

    if n_folds > len(X):
        raise ValueError(
            f"n_folds ({n_folds}) cannot exceed the number of samples ({len(X)})."
        )

    kf = KFold(n_splits=n_folds, shuffle=True, random_state=DEFAULT_RANDOM_STATE)

    # Accumulate per-fold scores: {col_name: {metric: [fold_scores...]}}
    accum = {col: {"r2": [], "rmse": [], "mae": []} for col in output_columns}

    for train_idx, val_idx in kf.split(X):
        fold_model = copy.deepcopy(model)
        fold_model.fit(X[train_idx], y[train_idx], input_columns, output_columns)
        y_pred = fold_model.predict(X[val_idx])
        for m in compute_metrics(y[val_idx], y_pred, output_columns):
            col = m["column"]
            accum[col]["r2"].append(m["r2"])
            accum[col]["rmse"].append(m["rmse"])
            accum[col]["mae"].append(m["mae"])

    per_output = []
    for col in output_columns:
        r2s   = accum[col]["r2"]
        rmses = accum[col]["rmse"]
        maes  = accum[col]["mae"]
        per_output.append({
            "column":    col,
            "mean_r2":   round(float(np.mean(r2s)),   6),
            "std_r2":    round(float(np.std(r2s)),    6),
            "mean_rmse": round(float(np.mean(rmses)), 6),
            "std_rmse":  round(float(np.std(rmses)),  6),
            "mean_mae":  round(float(np.mean(maes)),  6),
            "std_mae":   round(float(np.std(maes)),   6),
        })

    return {"n_folds": n_folds, "per_output": per_output}
