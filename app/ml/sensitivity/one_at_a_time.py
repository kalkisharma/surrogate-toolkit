"""
================================================================================
FILE: one_at_a_time.py
MODULE: app/ml/sensitivity/
PURPOSE: One-at-a-time sensitivity analysis
DEPENDENCIES: numpy
FUTURE EXTENSIONS: None
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


class OATAnalyzer:
    """One-at-a-time response curves: vary each input over its range while
    holding all others at the training-data median."""

    def analyze(self, model, X_train, input_cols, output_col_idx, n_points=50):
        """Compute OAT response curve for each input column.

        Args:
            model:          Fitted surrogate model (implements predict()).
            X_train:        (n_train, n_inputs) training feature array.
            input_cols:     Ordered list of input column names.
            output_col_idx: Index of the target output column.
            n_points:       Number of evaluation points per input.

        Returns:
            dict keyed by input column name, each containing:
                x, y (lists), median, min, max (floats).
        """
        medians = np.median(X_train, axis=0)
        mins    = X_train.min(axis=0)
        maxs    = X_train.max(axis=0)
        results = {}
        for i, col in enumerate(input_cols):
            X_oat  = np.tile(medians, (n_points, 1))
            x_vals = np.linspace(mins[i], maxs[i], n_points)
            X_oat[:, i] = x_vals
            y_vals = model.predict(X_oat)[:, output_col_idx]
            results[col] = {
                "x":      x_vals.tolist(),
                "y":      y_vals.tolist(),
                "median": float(medians[i]),
                "min":    float(mins[i]),
                "max":    float(maxs[i]),
            }
        return results
