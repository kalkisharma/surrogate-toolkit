"""
================================================================================
FILE: cross_validation.py
MODULE: app/ml/validation/
PURPOSE: K-fold cross-validation for surrogate models
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-06-02
VERSION: 0.7.3
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import copy
import os

import numpy as np
from joblib import Parallel, delayed
from sklearn.model_selection import KFold

from app.ml.models.base_model import BaseSurrogateModel
from app.ml.validation.diagnostics import compute_metrics
from config.settings import DEFAULT_RANDOM_STATE


def _fit_fold(model, X, y, train_idx, val_idx, input_columns, output_columns,
              n_jobs_per_fold=1, n_blas_per_fold=None):
    """Train one CV fold and return predictions on the validation slice."""
    fold_model = copy.deepcopy(model)
    fold_model.set_n_jobs(n_jobs_per_fold)
    if n_blas_per_fold is not None:
        try:
            from threadpoolctl import threadpool_limits
            with threadpool_limits(limits=n_blas_per_fold):
                fold_model.fit(X[train_idx], y[train_idx], input_columns, output_columns)
        except Exception:
            # threadpoolctl can fail on certain Anaconda/Windows DLL combinations;
            # fall through to an uncapped fit rather than crashing the training run.
            fold_model.fit(X[train_idx], y[train_idx], input_columns, output_columns)
    else:
        fold_model.fit(X[train_idx], y[train_idx], input_columns, output_columns)
    return fold_model.predict(X[val_idx])


def run_cross_validation(
    model: BaseSurrogateModel,
    X: np.ndarray,
    y: np.ndarray,
    output_columns: list,
    n_folds: int,
    input_columns: list,
    n_jobs: int = 1,
    n_outputs: int = 1,
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

    kf     = KFold(n_splits=n_folds, shuffle=True, random_state=DEFAULT_RANDOM_STATE)
    splits = list(kf.split(X))

    # Compute per-fold BLAS budget: divide CPU cores evenly among active fold workers.
    # Without this cap, 5 parallel fold threads each spawn 16 OpenBLAS threads,
    # giving 80 threads on 16 cores and superlinear slowdown.
    n_cpus       = os.cpu_count() or 1
    active_folds = min(n_jobs, n_folds)
    n_blas_limit = max(1, n_cpus // active_folds) if active_folds > 1 else None

    # prefer="threads" avoids process-spawn overhead on all platforms and works
    # correctly for sklearn models whose C extensions release the GIL.
    fold_preds = Parallel(n_jobs=n_jobs, prefer="threads")(
        delayed(_fit_fold)(model, X, y, ti, vi, input_columns, output_columns,
                          1, n_blas_limit)
        for ti, vi in splits
    )

    # Accumulate per-fold scores: {col_name: {metric: [fold_scores...]}}
    accum = {col: {"r2": [], "rmse": [], "mae": []} for col in output_columns}
    for (_, val_idx), y_pred in zip(splits, fold_preds):
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
