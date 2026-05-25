"""
================================================================================
FILE: global_sensitivity.py
MODULE: app/ml/sensitivity/
PURPOSE: Sobol global sensitivity analysis
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-14
VERSION: 1.1.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import numpy as np


class SobolAnalyzer:
    """Compute Sobol first-order (S1) and total-order (ST) sensitivity indices."""

    def analyze(self, model, X_train, input_cols, output_col_idx, n_samples=512):
        """Return Sobol S1/ST indices for one output column.

        For PCEModel, returns analytical indices directly from the expansion
        coefficients (no Monte Carlo). For all other model types, runs Saltelli
        sampling + SALib Sobol analysis.

        Args:
            model:          Fitted surrogate model (implements predict()).
            X_train:        (n_train, n_inputs) training feature array — used for bounds.
            input_cols:     Ordered list of input column names.
            output_col_idx: Index of the target output column.
            n_samples:      Base sample count N; total evaluations = N*(2D+2).

        Returns:
            dict with keys: method, S1, ST, S1_conf, ST_conf, n_evaluations.
        """
        # PCE shortcut: analytical sensitivity, no Monte Carlo needed
        if hasattr(model, "get_sensitivity"):
            return model.get_sensitivity(output_col_idx)

        from SALib.sample import sobol as sobol_sample
        from SALib.analyze import sobol

        bounds = [
            [float(X_train[:, i].min()), float(X_train[:, i].max())]
            for i in range(len(input_cols))
        ]
        problem = {
            "num_vars": len(input_cols),
            "names":    list(input_cols),
            "bounds":   bounds,
        }
        X_sample = sobol_sample.sample(problem, N=n_samples, calc_second_order=False)
        Y = model.predict(X_sample)[:, output_col_idx]
        Si = sobol.analyze(problem, Y, calc_second_order=False, print_to_console=False)

        return {
            "method":        "sobol",
            "S1":            {col: float(Si["S1"][i])      for i, col in enumerate(input_cols)},
            "ST":            {col: float(Si["ST"][i])      for i, col in enumerate(input_cols)},
            "S1_conf":       {col: float(Si["S1_conf"][i]) for i, col in enumerate(input_cols)},
            "ST_conf":       {col: float(Si["ST_conf"][i]) for i, col in enumerate(input_cols)},
            "n_evaluations": len(X_sample),
        }
