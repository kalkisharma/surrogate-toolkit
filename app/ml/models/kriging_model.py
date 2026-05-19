"""
================================================================================
FILE: kriging_model.py
MODULE: app/ml/models/
PURPOSE: Kriging surrogate model — GPR with Matérn or Rational Quadratic kernel.
         Extends BaseSurrogateModel identically to GPRModel; the distinction is
         that Kriging exposes non-RBF kernels suited to responses with finite
         differentiability (e.g. sharp transonic gradients, contact discontinuities).
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
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import Matern, RationalQuadratic
from sklearn.multioutput import MultiOutputRegressor

from app.ml.models.base_model import BaseSurrogateModel
from config.settings import DEFAULT_RANDOM_STATE, GPR_DEFAULT_ALPHA

_KERNELS = {
    "matern15": Matern(nu=1.5),
    "matern25": Matern(nu=2.5),
    "rq":       RationalQuadratic(),
}


class KrigingModel(BaseSurrogateModel):
    """Kriging (GPR with Matérn / Rational Quadratic kernel).

    Identical interface to GPRModel. Wrapped in MultiOutputRegressor so
    multi-output prediction is transparent. Exposes predict_std() for
    95% CI error bars on parity plots and active learning.
    """

    def __init__(self, kernel: str = "matern25", alpha: float = None):
        super().__init__("kriging")
        k = _KERNELS.get(kernel, Matern(nu=2.5))
        single_gpr = GaussianProcessRegressor(
            kernel=k,
            alpha=float(alpha) if alpha is not None else GPR_DEFAULT_ALPHA,
            normalize_y=True,
            random_state=DEFAULT_RANDOM_STATE,
        )
        self._model = MultiOutputRegressor(single_gpr)
        self._kernel_name = kernel

    def fit(
        self,
        X: np.ndarray,
        y: np.ndarray,
        input_columns: list,
        output_columns: list,
    ) -> None:
        """Fit one Kriging estimator per output column.

        Args:
            X: (n_samples, n_inputs) training features.
            y: (n_samples, n_outputs) training targets.
            input_columns: Input column names in order.
            output_columns: Output column names in order.

        Returns:
            None

        Raises:
            ValueError: If X or y have incompatible shapes.

        Notes:
            Training complexity is O(n³) per output — same caveat as GPRModel.

        Future:
            Expose kernel hyperparameter bounds for optimisation.
        """
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float)
        if y.ndim == 1:
            y = y.reshape(-1, 1)
        self._model.fit(X, y)
        self._input_columns = list(input_columns)
        self._output_columns = list(output_columns)
        self._is_fitted = True

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Return point predictions for X.

        Args:
            X: (n_samples, n_inputs) feature array.

        Returns:
            np.ndarray of shape (n_samples, n_outputs).

        Raises:
            RuntimeError: If called before fit().
        Future:
            None.
        """
        self._check_fitted()
        X = np.asarray(X, dtype=float)
        result = self._model.predict(X)
        if result.ndim == 1:
            result = result.reshape(-1, 1)
        return result

    def predict_std(self, X: np.ndarray) -> np.ndarray:
        """Return posterior std for each output (shape: n_samples × n_outputs).

        Args:
            X: (n_samples, n_inputs) feature array.

        Returns:
            np.ndarray of shape (n_samples, n_outputs).

        Raises:
            RuntimeError: If called before fit().

        Notes:
            Delegates to each per-output GaussianProcessRegressor estimator.        """
        self._check_fitted()
        X = np.asarray(X, dtype=float)
        stds = []
        for estimator in self._model.estimators_:
            _, std_i = estimator.predict(X, return_std=True)
            stds.append(std_i)
        return np.column_stack(stds) if len(stds) > 1 else stds[0].reshape(-1, 1)

    def get_param_grid(self) -> dict:
        return {
            "estimator__kernel": [Matern(nu=1.5), Matern(nu=2.5), RationalQuadratic()],
            "estimator__alpha":  [0.001, 0.01, 0.1, 1.0],
        }

    def get_summary(self) -> dict:
        """Return a JSON-serializable summary of this model.

        Args:
            None

        Returns:
            dict with "_type", "model_type", "is_fitted", "input_columns",
                "output_columns", "kernel".
        Notes:
            Called by get_state_json_safe() in schema.py.

        Future:
            Include fitted kernel parameters.
        """
        return {
            "_type":          "model",
            "model_type":     self.model_type,
            "is_fitted":      self._is_fitted,
            "input_columns":  self._input_columns,
            "output_columns": self._output_columns,
            "kernel":         self._kernel_name,
        }
