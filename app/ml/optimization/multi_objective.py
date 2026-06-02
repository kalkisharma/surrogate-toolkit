"""
================================================================================
FILE: multi_objective.py
MODULE: app/ml/optimization/
PURPOSE: Multi-objective surrogate optimization via NSGA-II (pymoo).
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-15
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import numpy as np


class MultiObjectiveOptimizer:
    """
    Multi-objective surrogate optimization using NSGA-II from pymoo.

    Returns a Pareto front of non-dominated solutions.
    Raises ImportError if pymoo is not installed.
    """

    def optimize(
        self,
        model,
        input_cols: list,
        output_cols: list,
        bounds_dict: dict,
        objectives: list,
        pop_size: int = 100,
        n_gen: int = 100,
        seed: int = 42,
    ) -> dict:
        """
        Parameters
        ----------
        model        : fitted surrogate — predict(X) → ndarray (n, n_outputs)
        input_cols   : ordered list of input column names
        output_cols  : ordered list of all output column names
        bounds_dict  : {col: [min, max]} per input column
        objectives   : list of {"output_col": str, "direction": "minimize"|"maximize"}
        pop_size     : NSGA-II population size per generation
        n_gen        : number of generations
        seed         : random seed

        Returns
        -------
        dict with pareto_inputs, pareto_outputs, n_solutions, objectives
        """
        try:
            from pymoo.algorithms.moo.nsga2 import NSGA2
            from pymoo.core.problem import Problem
            from pymoo.optimize import minimize as pymoo_minimize
            from pymoo.termination.default import DefaultMultiObjectiveTermination
        except ImportError:
            raise ImportError(
                "pymoo is required for multi-objective optimization. "
                "Install it with: pip install pymoo"
            )

        # ── Validate and enrich objectives ────────────────────────────────────
        enriched = []
        for obj in objectives:
            col = obj.get("output_col", "")
            if col not in output_cols:
                raise ValueError(f"Output column '{col}' not in trained model outputs: {output_cols}")
            enriched.append({
                "output_col": col,
                "direction":  obj.get("direction", "minimize"),
                "_idx":       output_cols.index(col),
            })

        n_var = len(input_cols)
        n_obj = len(enriched)
        xl    = np.array([bounds_dict[col][0] for col in input_cols], dtype=float)
        xu    = np.array([bounds_dict[col][1] for col in input_cols], dtype=float)

        _model    = model
        _enriched = enriched

        class SurrogateProblem(Problem):
            def __init__(self_inner):
                super().__init__(n_var=n_var, n_obj=n_obj, xl=xl, xu=xu)

            def _evaluate(self_inner, X, out, *args, **kwargs):
                Y = _model.predict(X)   # shape: (pop, n_total_outputs)
                F = np.zeros((len(X), n_obj), dtype=float)
                for j, obj in enumerate(_enriched):
                    vals = Y[:, obj["_idx"]]
                    F[:, j] = vals if obj["direction"] == "minimize" else -vals
                out["F"] = F

        termination = DefaultMultiObjectiveTermination(n_max_gen=n_gen)
        algorithm   = NSGA2(pop_size=pop_size)

        res = pymoo_minimize(
            SurrogateProblem(),
            algorithm,
            termination,
            seed=seed,
            verbose=False,
        )

        X_pareto = res.X   # (n_solutions, n_var)
        Y_pareto = _model.predict(X_pareto)

        pareto_inputs  = [dict(zip(input_cols, row.tolist())) for row in X_pareto]
        pareto_outputs = []
        for i in range(len(X_pareto)):
            row = {obj["output_col"]: float(Y_pareto[i, obj["_idx"]]) for obj in enriched}
            pareto_outputs.append(row)

        return {
            "mode":          "multi",
            "objectives":    [{"output_col": o["output_col"], "direction": o["direction"]}
                              for o in enriched],
            "pareto_inputs":  pareto_inputs,
            "pareto_outputs": pareto_outputs,
            "n_solutions":    len(pareto_inputs),
            "n_gen":          n_gen,
            "pop_size":       pop_size,
            "input_cols":     input_cols,
            "output_cols":    [o["output_col"] for o in enriched],
        }
