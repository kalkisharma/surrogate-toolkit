"""
================================================================================
FILE: bootstrap.py
MODULE: app/ml/uncertainty/
PURPOSE: Uncertainty estimation — GPR native posterior std; RF tree variance
DEPENDENCIES: numpy
FUTURE EXTENSIONS: Jackknife, conformal prediction
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-14
VERSION: 1.1.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import numpy as np


def compute_uncertainty(model, X_test, output_col_idx, model_type):
    """Return 95% CI bounds for one output column on the test set.

    Args:
        model:          Fitted surrogate model.
        X_test:         (n_test, n_inputs) test feature array, or None/empty.
        output_col_idx: Index of the target output column.
        model_type:     "gpr" | "rf" | "linear".

    Returns:
        (method, ci_lower, ci_upper) where method is a string and bounds are
        lists of floats. Returns (None, None, None) for linear models or when
        X_test is unavailable.
    """
    if X_test is None or len(X_test) == 0:
        return None, None, None

    if model_type in ("gpr", "kriging"):
        stds   = model.predict_std(X_test)[:, output_col_idx]
        y_mean = model.predict(X_test)[:, output_col_idx]
        return (
            "gpr_native",
            (y_mean - 1.96 * stds).tolist(),
            (y_mean + 1.96 * stds).tolist(),
        )

    if model_type == "rf":
        tree_preds = []
        for tree in model._model.estimators_:
            pred = tree.predict(X_test)
            if pred.ndim == 1:
                pred = pred.reshape(-1, 1)
            tree_preds.append(pred[:, output_col_idx])
        tree_preds = np.array(tree_preds)  # (n_trees, n_test)
        return (
            "rf_tree_variance",
            np.percentile(tree_preds, 2.5,  axis=0).tolist(),
            np.percentile(tree_preds, 97.5, axis=0).tolist(),
        )

    return None, None, None  # linear: no native uncertainty
