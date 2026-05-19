"""
================================================================================
FILE: rbf_model.py
MODULE: app/ml/models/
PURPOSE: Radial Basis Function interpolation surrogate model.
         Wraps scipy.interpolate.RBFInterpolator — one estimator per output.
         Interpolates exactly through training data (zero training error) and
         scales better than GPR for medium datasets (1 000–10 000 rows) because
         the solver is O(n²) rather than O(n³). No kernel hyperparameter
         optimisation required — just choose the basis function shape.
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
from scipy.interpolate import RBFInterpolator

from app.ml.models.base_model import BaseSurrogateModel

# Kernels supported by scipy.interpolate.RBFInterpolator
_VALID_KERNELS = {
    "thin_plate_spline",
    "multiquadric",
    "inverse_multiquadric",
    "inverse_quadratic",
    "gaussian",
    "linear",
    "cubic",
    "quintic",
}


class RBFModel(BaseSurrogateModel):
    """Radial Basis Function interpolation surrogate.

    One RBFInterpolator is trained per output column. Interpolates
    exactly through training points when smoothing=0; a small smoothing
    value (default 1e-3) regularises against ill-conditioning on nearly
    duplicate inputs.

    Auto-tune is not supported (no sklearn-compatible param grid).
    """

    def __init__(self, kernel: str = "thin_plate_spline", smoothing: float = 1e-3):
        super().__init__("rbf")
        if kernel not in _VALID_KERNELS:
            kernel = "thin_plate_spline"
        self._kernel_name = kernel
        self._smoothing   = float(smoothing)
        self._estimators  = []

    def fit(
        self,
        X: np.ndarray,
        y: np.ndarray,
        input_columns: list,
        output_columns: list,
    ) -> None:
        """Fit one RBFInterpolator per output column.

        Args:
            X: (n_samples, n_inputs) training features.
            y: (n_samples, n_outputs) training targets.
            input_columns: Input column names in order.
            output_columns: Output column names in order.

        Returns:
            None

        Raises:
            ValueError: If X or y have incompatible shapes.
            RuntimeError: If the RBF linear system is singular (try increasing smoothing).

        Notes:
            RBFInterpolator requires at least d+1 points for thin_plate_spline
            where d is the number of inputs. Very small datasets may fail.

        Future:
            Expose degree parameter for polynomial augmentation.
        """
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float)
        if y.ndim == 1:
            y = y.reshape(-1, 1)
        self._estimators = []
        for i in range(y.shape[1]):
            rbf = RBFInterpolator(
                X, y[:, i],
                kernel=self._kernel_name,
                smoothing=self._smoothing,
            )
            self._estimators.append(rbf)
        self._input_columns = list(input_columns)
        self._output_columns = list(output_columns)
        self._is_fitted = True

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Return predictions for X.

        Args:
            X: (n_samples, n_inputs) feature array.

        Returns:
            np.ndarray of shape (n_samples, n_outputs).

        Raises:
            RuntimeError: If called before fit().

        Notes:
            Each estimator is called independently; results are column-stacked.        """
        self._check_fitted()
        X = np.asarray(X, dtype=float)
        preds = [est(X) for est in self._estimators]
        result = np.column_stack(preds) if len(preds) > 1 else preds[0].reshape(-1, 1)
        return result

    def get_param_grid(self) -> dict:
        # RBFInterpolator has no sklearn-compatible GridSearchCV interface.
        return {}

    def get_summary(self) -> dict:
        """Return a JSON-serializable summary of this model.

        Args:
            None

        Returns:
            dict with "_type", "model_type", "is_fitted", "input_columns",
                "output_columns", "kernel", "smoothing".
        Notes:
            Called by get_state_json_safe() in schema.py.        """
        return {
            "_type":          "model",
            "model_type":     self.model_type,
            "is_fitted":      self._is_fitted,
            "input_columns":  self._input_columns,
            "output_columns": self._output_columns,
            "kernel":         self._kernel_name,
            "smoothing":      self._smoothing,
        }
