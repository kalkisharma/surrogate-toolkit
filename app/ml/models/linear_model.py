"""
================================================================================
FILE: linear_model.py
MODULE: app/ml/models/
PURPOSE: Linear regression surrogate model
DEPENDENCIES: scikit-learn, numpy
FUTURE EXTENSIONS: Polynomial features, Lasso variant
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-19
VERSION: 1.0.2
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import numpy as np
from sklearn.linear_model import Ridge

from app.ml.models.base_model import BaseSurrogateModel


class LinearModel(BaseSurrogateModel):
    """Ridge regression surrogate model.

    Ridge handles multiple output columns natively via a single coefficient
    matrix. It is fast, interpretable, and serves as a reliable baseline
    against GPR and Random Forest.
    """

    def __init__(self, alpha: float = 1.0):
        super().__init__("linear")
        self._model = Ridge(alpha=float(alpha) if alpha is not None else 1.0, solver="lsqr")

    def fit(
        self,
        X: np.ndarray,
        y: np.ndarray,
        input_columns: list,
        output_columns: list,
    ) -> None:
        """Fit the Ridge model to training data.

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
            Ridge fits a single coefficient matrix — it is equivalent to
            running one Ridge per output but in a single solve step.

        Future:
            Expose alpha as a constructor argument.
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
        """Return predictions for X.

        Args:
            X: (n_samples, n_inputs) feature array.

        Returns:
            np.ndarray of shape (n_samples, n_outputs).

        Raises:
            RuntimeError: If called before fit().

        Notes:
            None.

        Future:
            None.
        """
        self._check_fitted()
        X = np.asarray(X, dtype=float)
        result = self._model.predict(X)
        # Ridge returns 1D when fitted on a column-vector y; normalise to 2D.
        if result.ndim == 1:
            result = result.reshape(-1, 1)
        return result

    def get_param_grid(self) -> dict:
        return {"alpha": [0.001, 0.1, 1.0, 10.0, 100.0]}

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
            Include coefficient values for interpretability.
        """
        return {
            "_type": "model",
            "model_type": self.model_type,
            "is_fitted": self._is_fitted,
            "input_columns": self._input_columns,
            "output_columns": self._output_columns,
        }
