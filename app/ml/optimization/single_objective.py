"""
================================================================================
FILE: single_objective.py
MODULE: app/ml/optimization/
PURPOSE: Single-objective surrogate optimization via scipy differential_evolution.
DEPENDENCIES: scipy, numpy
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-15
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import numpy as np
from scipy.optimize import differential_evolution


class SingleObjectiveOptimizer:
    """
    Optimize a single output column of a trained surrogate using
    scipy.optimize.differential_evolution.

    All other output columns can appear as inequality constraints.
    """

    def optimize(
        self,
        model,
        input_cols: list,
        output_cols: list,
        bounds_dict: dict,
        output_col: str,
        direction: str = "minimize",
        constraints: list = None,
        n_population: int = 50,
        max_iter: int = 200,
        seed: int = 42,
    ) -> dict:
        """
        Parameters
        ----------
        model : fitted surrogate — must implement predict(X) → ndarray (n, n_outputs)
        input_cols   : ordered list of input column names
        output_cols  : ordered list of output column names (matches model predict order)
        bounds_dict  : {col: [min, max]} per input column
        output_col   : which output to optimize
        direction    : "minimize" or "maximize"
        constraints  : list of {"output_col": str, "operator": "<=" | ">=", "threshold": float}
        n_population : approximate DE population (scaled by n_vars)
        max_iter     : maximum DE generations
        seed         : random seed

        Returns
        -------
        dict with best_inputs, best_outputs, n_evaluations, converged, warnings
        """
        if output_col not in output_cols:
            raise ValueError(f"'{output_col}' is not a trained output column.")

        output_idx = output_cols.index(output_col)
        sign       = 1.0 if direction == "minimize" else -1.0
        bounds     = [bounds_dict.get(col, [0.0, 1.0]) for col in input_cols]
        eval_count = [0]

        def objective(x):
            eval_count[0] += 1
            y = model.predict(x.reshape(1, -1))[0]
            return sign * float(y[output_idx])

        result = differential_evolution(
            objective,
            bounds,
            seed=seed,
            maxiter=max_iter,
            popsize=max(5, n_population // max(len(input_cols), 1)),
            tol=1e-7,
            mutation=(0.5, 1.0),
            recombination=0.7,
            polish=True,
        )

        best_X   = result.x.reshape(1, -1)
        best_y   = model.predict(best_X)[0]

        best_inputs  = {col: float(result.x[i])  for i, col in enumerate(input_cols)}
        best_outputs = {col: float(best_y[i])     for i, col in enumerate(output_cols)}

        warnings = []

        # ── Constraint checks ─────────────────────────────────────────────────
        for c in (constraints or []):
            c_col = c.get("output_col", "")
            if c_col not in output_cols:
                continue
            c_idx  = output_cols.index(c_col)
            val    = float(best_y[c_idx])
            op     = c.get("operator", "<=")
            thresh = float(c.get("threshold", 0.0))
            violated = (op == "<=" and val > thresh) or (op == ">=" and val < thresh)
            if violated:
                warnings.append(
                    f"Constraint violated: {c_col} {op} {thresh:.4g} (got {val:.4g})"
                )

        # ── GPR uncertainty warning ────────────────────────────────────────────
        if hasattr(model, "predict_std"):
            try:
                stds    = model.predict_std(best_X)[0]
                std_val = float(stds[output_idx]) if hasattr(stds, "__len__") else float(stds)
                pred_abs = abs(float(best_y[output_idx]))
                if pred_abs > 1e-10 and std_val / pred_abs > 0.10:
                    pct = 100.0 * std_val / pred_abs
                    warnings.append(
                        f"High uncertainty at optimum: ±{std_val:.4g} ({pct:.1f}% of predicted value). "
                        "Consider collecting training data near this point."
                    )
            except Exception:
                pass

        return {
            "mode":          "single",
            "target_output": output_col,
            "direction":     direction,
            "best_inputs":   best_inputs,
            "best_outputs":  best_outputs,
            "n_evaluations": eval_count[0],
            "converged":     bool(result.success),
            "warnings":      warnings,
            "input_cols":    input_cols,
            "output_cols":   output_cols,
        }
