"""
================================================================================
FILE: pce_model.py
MODULE: app/ml/models/
PURPOSE: Polynomial Chaos Expansion surrogate model using chaospy.
         Represents each output as a sum of orthogonal polynomials in the inputs.
         Sobol sensitivity indices (S1, ST) fall out analytically from the
         expansion coefficients — no Monte Carlo sampling needed.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-18
LAST MODIFIED: 2026-05-18
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import numpy as np

from app.ml.models.base_model import BaseSurrogateModel


class PCEModel(BaseSurrogateModel):
    """Polynomial Chaos Expansion (PCE) surrogate via chaospy.

    Fits one polynomial expansion per output column by regression
    (point collocation). Uses Uniform distributions over each input's
    training range, producing Legendre orthogonal basis polynomials.

    Key advantages over black-box surrogates:
    - Sobol sensitivity indices are exact and free (no Monte Carlo).
    - The surrogate is an explicit polynomial formula — fully interpretable.
    - Prediction is O(n_terms) per point — very fast at inference time.

    Limitations:
    - Accuracy degrades for non-smooth responses (discontinuities, kinks).
    - Curse of dimensionality: number of terms grows as C(n+p, p) where n
      is n_inputs and p is polynomial order. At order=3 with 10 inputs,
      this is 286 terms — manageable. At order=5 with 15 inputs it is
      11 628 — require more training data than rows.
    - Auto-tune is not supported (no sklearn GridSearchCV interface).
    """

    def __init__(self, order: int = 3):
        super().__init__("pce")
        self._order        = max(1, int(order))
        self._expansions   = []   # one fitted chaospy polynomial per output
        self._distributions = None  # joint chaospy distribution over inputs
        self._X_bounds     = []   # [(lo, hi), ...] for each input

    def fit(
        self,
        X: np.ndarray,
        y: np.ndarray,
        input_columns: list,
        output_columns: list,
    ) -> None:
        """Fit one PCE per output column.

        Args:
            X: (n_samples, n_inputs) training features.
            y: (n_samples, n_outputs) training targets.
            input_columns: Input column names in order.
            output_columns: Output column names in order.

        Returns:
            None

        Raises:
            ImportError: If chaospy is not installed.
            RuntimeError: If fitting fails (e.g. underdetermined system — more
                          polynomial terms than training points).

        Notes:
            Requires n_samples >= C(n_inputs + order, order) for a well-posed
            regression. Warn the user if this is not met.

        Future:
            Sparse PCE (LARS regression) to handle underdetermined systems.
        """
        try:
            import chaospy as cp
        except ImportError as exc:
            raise ImportError(
                "chaospy is required for PCE. Install it with: pip install chaospy"
            ) from exc

        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float)
        if y.ndim == 1:
            y = y.reshape(-1, 1)

        n_inputs = X.shape[1]

        # Build Uniform distributions over each input's training range.
        # A small epsilon ensures lo < hi for constant columns.
        self._X_bounds = []
        dists = []
        for i in range(n_inputs):
            lo = float(X[:, i].min())
            hi = float(X[:, i].max())
            if abs(hi - lo) < 1e-10:
                hi = lo + 1.0
            self._X_bounds.append((lo, hi))
            dists.append(cp.Uniform(lo, hi))

        self._distributions = cp.J(*dists)
        expansion = cp.generate_expansion(self._order, self._distributions)

        self._expansions = []
        for i in range(y.shape[1]):
            try:
                fitted = cp.fit_regression(expansion, X.T, y[:, i])
                self._expansions.append(fitted)
            except Exception as exc:
                raise RuntimeError(
                    f"PCE fitting failed for output column {i} "
                    f"({output_columns[i] if i < len(output_columns) else '?'}): {exc}. "
                    "Try a lower polynomial order or provide more training data."
                ) from exc

        self._input_columns  = list(input_columns)
        self._output_columns = list(output_columns)
        self._is_fitted = True

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Return predictions for X by evaluating the fitted polynomials.

        Args:
            X: (n_samples, n_inputs) feature array.

        Returns:
            np.ndarray of shape (n_samples, n_outputs).

        Raises:
            RuntimeError: If called before fit().

        Notes:
            chaospy evaluates polynomials via cp.call(poly, X.T). Each column
            of X.T is one input variable; rows correspond to samples.        """
        self._check_fitted()
        import chaospy as cp

        X = np.asarray(X, dtype=float)
        preds = []
        for exp in self._expansions:
            p = np.asarray(cp.call(exp, X.T), dtype=float).ravel()
            preds.append(p)
        result = np.column_stack(preds) if len(preds) > 1 else preds[0].reshape(-1, 1)
        return result

    def get_sensitivity(self, output_idx: int = 0) -> dict:
        """Return analytical Sobol S1 and ST indices for one output.

        Indices are computed from the polynomial coefficients — exact and
        free (no Monte Carlo sampling required).

        Args:
            output_idx: Index of the target output column.

        Returns:
            dict:
                {
                    "method": "pce_analytical",
                    "S1":     {col: float, ...},
                    "ST":     {col: float, ...},
                    "S1_conf": {},   # empty — no confidence interval for analytical
                    "ST_conf": {},
                    "n_evaluations": 0,
                }

        Raises:
            RuntimeError: If called before fit().

        Notes:
            cp.Sens_m returns first-order indices; cp.Sens_t returns total-order.
            Both return arrays of length n_inputs.        """
        self._check_fitted()
        import chaospy as cp

        exp = self._expansions[output_idx]
        S1 = np.asarray(cp.Sens_m(exp, self._distributions), dtype=float)
        ST = np.asarray(cp.Sens_t(exp, self._distributions), dtype=float)

        # Clip to [0, 1] — small numerical errors can push values slightly negative
        S1 = np.clip(S1, 0.0, 1.0)
        ST = np.clip(ST, 0.0, 1.0)

        return {
            "method":        "pce_analytical",
            "S1":            {col: float(S1[i]) for i, col in enumerate(self._input_columns)},
            "ST":            {col: float(ST[i]) for i, col in enumerate(self._input_columns)},
            "S1_conf":       {col: 0.0 for col in self._input_columns},
            "ST_conf":       {col: 0.0 for col in self._input_columns},
            "n_evaluations": 0,
        }

    def get_param_grid(self) -> dict:
        # chaospy has no sklearn-compatible GridSearchCV interface.
        return {}

    def get_summary(self) -> dict:
        """Return a JSON-serializable summary of this model.

        Args:
            None

        Returns:
            dict with "_type", "model_type", "is_fitted", "input_columns",
                "output_columns", "order".
        Notes:
            Called by get_state_json_safe() in schema.py.

        Future:
            Include n_terms (number of polynomial basis functions).
        """
        return {
            "_type":          "model",
            "model_type":     self.model_type,
            "is_fitted":      self._is_fitted,
            "input_columns":  self._input_columns,
            "output_columns": self._output_columns,
            "order":          self._order,
        }
