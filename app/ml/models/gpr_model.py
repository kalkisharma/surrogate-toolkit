"""
================================================================================
FILE: gpr_model.py
MODULE: app/ml/models/
PURPOSE: Gaussian Process Regression surrogate model
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-06-01
VERSION: 1.4.1
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

from typing import Optional

import numpy as np
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF, Matern, RationalQuadratic
from sklearn.multioutput import MultiOutputRegressor

from app.ml.models.base_model import BaseSurrogateModel
from config.settings import DEFAULT_RANDOM_STATE, GPR_DEFAULT_ALPHA

class GPRModel(BaseSurrogateModel):
    """Gaussian Process Regression wrapped in MultiOutputRegressor.

    scikit-learn's GaussianProcessRegressor is single-output only. The
    MultiOutputRegressor wrapper trains one independent GPR per output column,
    which makes multi-output prediction transparent to the rest of the system.

    The kernel is built in fit() with ARD length scales (one per input
    dimension) so irrelevant inputs can be suppressed automatically.
    """

    def __init__(self, kernel: str = "rbf", alpha: float = None, n_jobs: int = 1, n_restarts: int = 10):
        super().__init__("gpr")
        self._kernel_name = kernel
        self._alpha = float(alpha) if alpha is not None else GPR_DEFAULT_ALPHA
        self._n_jobs = int(n_jobs)
        self._n_restarts = int(n_restarts)
        self._model = None  # built in fit() once n_features is known

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

        # Build ARD kernel now that n_features is known.
        n_features = X.shape[1]
        ls = np.ones(n_features)
        if self._kernel_name == "matern15":
            k = Matern(length_scale=ls, nu=1.5)
        elif self._kernel_name == "matern25":
            k = Matern(length_scale=ls, nu=2.5)
        elif self._kernel_name == "rq":
            k = RationalQuadratic()  # isotropic — ARD causes bounds mismatch in scipy optimizer
        else:
            k = RBF(length_scale=ls)

        # sklearn's GaussianProcessRegressor does not expose n_jobs for its
        # internal optimizer restarts — each restart runs the same L-BFGS-B
        # solver sequentially (ARD optimises all N length-scales jointly in one
        # call, so restarts can't be split per-input either). Parallelism via
        # n_jobs on MultiOutputRegressor is the only available path; it applies
        # only when n_outputs > 1. Future: use joblib.Parallel to run restarts
        # in parallel ourselves, bypassing sklearn's sequential loop.
        single_gpr = GaussianProcessRegressor(
            kernel=k,
            alpha=self._alpha,
            normalize_y=True,
            n_restarts_optimizer=self._n_restarts,
            random_state=DEFAULT_RANDOM_STATE,
        )
        self._model = MultiOutputRegressor(single_gpr, n_jobs=self._n_jobs)

        self._model.fit(X, y)
        self._input_columns = list(input_columns)
        self._output_columns = list(output_columns)
        self._is_fitted = True

    def build_estimator(self, n_features: int) -> None:
        """Build self._model without fitting — required by the tune endpoint so
        GridSearchCV receives a real estimator before fit() is ever called."""
        self._n_features = n_features
        ls = np.ones(n_features)
        if self._kernel_name == "matern15":
            k = Matern(length_scale=ls, nu=1.5)
        elif self._kernel_name == "matern25":
            k = Matern(length_scale=ls, nu=2.5)
        elif self._kernel_name == "rq":
            k = RationalQuadratic()  # isotropic — ARD causes bounds mismatch in scipy optimizer
        else:
            k = RBF(length_scale=ls)
        single_gpr = GaussianProcessRegressor(
            kernel=k,
            alpha=self._alpha,
            normalize_y=True,
            n_restarts_optimizer=self._n_restarts,
            random_state=DEFAULT_RANDOM_STATE,
        )
        self._model = MultiOutputRegressor(single_gpr, n_jobs=self._n_jobs)

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Return point predictions for X.

        Args:
            X: (n_samples, n_inputs) feature array.

        Returns:
            np.ndarray of shape (n_samples, n_outputs).

        Raises:
            RuntimeError: If called before fit().
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
        ls = np.ones(getattr(self, "_n_features", 1))
        return {
            "estimator__kernel": [
                RBF(length_scale=ls),
                Matern(length_scale=ls, nu=1.5),
                Matern(length_scale=ls, nu=2.5),
                RationalQuadratic(),  # isotropic — ARD causes bounds mismatch in scipy optimizer
            ],
            "estimator__alpha": [0.001, 0.01, 0.1, 1.0],
        }

    def get_kernel_info(self) -> Optional[dict]:
        """Return fitted ARD length scales per output column, or None if not fitted."""
        if not self._is_fitted:
            return None
        out = {}
        for col, est in zip(self._output_columns, self._model.estimators_):
            ls = est.kernel_.length_scale
            if hasattr(ls, "__len__"):
                out[col] = {inp: round(float(v), 4) for inp, v in zip(self._input_columns, ls)}
            else:
                out[col] = {inp: round(float(ls), 4) for inp in self._input_columns}
        return out

    def get_summary(self) -> dict:
        """Return a JSON-serializable summary of this model.

        Args:
            None

        Returns:
            dict: "_type", "model_type", "is_fitted", "input_columns",
                  "output_columns".
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
