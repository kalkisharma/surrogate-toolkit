"""
================================================================================
FILE: gpr_model.py
MODULE: app/ml/models/
PURPOSE: Gaussian Process Regression surrogate model
DEPENDENCIES: scikit-learn, numpy
FUTURE EXTENSIONS: Custom kernels, active learning integration
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-14
VERSION: 1.0.1
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import numpy as np
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF, Matern
from sklearn.multioutput import MultiOutputRegressor

from app.ml.models.base_model import BaseSurrogateModel
from config.settings import DEFAULT_RANDOM_STATE, GPR_DEFAULT_ALPHA

_KERNELS = {
    "matern15": Matern(nu=1.5),
    "matern25": Matern(nu=2.5),
}


class GPRModel(BaseSurrogateModel):
    """Gaussian Process Regression wrapped in MultiOutputRegressor.

    scikit-learn's GaussianProcessRegressor is single-output only. The
    MultiOutputRegressor wrapper trains one independent GPR per output column,
    which makes multi-output prediction transparent to the rest of the system.
    """

    def __init__(self, kernel: str = "rbf", alpha: float = None):
        super().__init__("gpr")
        k = _KERNELS.get(kernel, RBF())
        single_gpr = GaussianProcessRegressor(
            kernel=k,
            alpha=float(alpha) if alpha is not None else GPR_DEFAULT_ALPHA,
            normalize_y=True,
            random_state=DEFAULT_RANDOM_STATE,
        )
        # MultiOutputRegressor clones single_gpr internally for each output.
        self._model = MultiOutputRegressor(single_gpr)

    def fit(
        self,
        X: np.ndarray,
        y: np.ndarray,
        input_columns: list,
        output_columns: list,
    ) -> None:
        """Fit one GPR per output column.

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
            Training complexity is O(n³) per output — warn the user before
            calling this if n_samples > MAX_PLOT_ROWS (2 000) and GPR is
            the selected model type.

        Future:
            Expose kernel as a constructor argument for custom kernels.
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

        Notes:
            None.

        Future:
            Expose posterior standard deviation for uncertainty propagation.
        """
        self._check_fitted()
        X = np.asarray(X, dtype=float)
        result = self._model.predict(X)
        if result.ndim == 1:
            result = result.reshape(-1, 1)
        return result

    def predict_std(self, X: np.ndarray) -> np.ndarray:
        """Return posterior std for each output (shape: n_samples × n_outputs)."""
        self._check_fitted()
        X = np.asarray(X, dtype=float)
        stds = []
        for estimator in self._model.estimators_:
            _, std_i = estimator.predict(X, return_std=True)
            stds.append(std_i)
        return np.column_stack(stds) if len(stds) > 1 else stds[0].reshape(-1, 1)

    def get_param_grid(self) -> dict:
        return {
            "estimator__kernel": [RBF(1.0), Matern(nu=1.5), Matern(nu=2.5)],
            "estimator__alpha":  [0.001, 0.01, 0.1, 1.0],
        }

    def get_summary(self) -> dict:
        """Return a JSON-serializable summary of this model.

        Args:
            None

        Returns:
            dict: "_type", "model_type", "is_fitted", "input_columns",
                  "output_columns".

        Raises:
            Nothing.

        Notes:
            Called by get_state_json_safe() in schema.py.

        Future:
            Include fitted kernel parameters (length-scale, noise level).
        """
        return {
            "_type": "model",
            "model_type": self.model_type,
            "is_fitted": self._is_fitted,
            "input_columns": self._input_columns,
            "output_columns": self._output_columns,
        }
