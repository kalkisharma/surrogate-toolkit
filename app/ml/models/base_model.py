"""
================================================================================
FILE: base_model.py
MODULE: app/ml/models/
PURPOSE: Abstract base class for all surrogate models
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-14
VERSION: 1.0.1
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

from abc import ABC, abstractmethod

import numpy as np


class BaseSurrogateModel(ABC):
    """Abstract base class that every surrogate model must implement."""

    def __init__(self, model_type: str):
        self.model_type = model_type
        self._model = None
        self._is_fitted = False
        self._input_columns: list = []
        self._output_columns: list = []

    # ─── Interface ─────────────────────────────────────────────────────────────

    @abstractmethod
    def fit(
        self,
        X: np.ndarray,
        y: np.ndarray,
        input_columns: list,
        output_columns: list,
    ) -> None:
        """Fit the model to training data.

        Args:
            X: 2-D array of shape (n_samples, n_inputs).
            y: 2-D array of shape (n_samples, n_outputs).
            input_columns: Ordered list of input column names.
            output_columns: Ordered list of output column names.

        Returns:
            None

        Raises:
            ValueError: If X or y are malformed.

        Notes:
            Implementations must set self._is_fitted = True on success and
            store self._input_columns / self._output_columns.

        Future:
            Sample weights, warm starts for incremental learning.
        """

    @abstractmethod
    def predict(self, X: np.ndarray) -> np.ndarray:
        """Return predictions for X.

        Args:
            X: 2-D array of shape (n_samples, n_inputs).

        Returns:
            np.ndarray of shape (n_samples, n_outputs).

        Raises:
            RuntimeError: If called before fit().
        Future:
            Return uncertainty alongside point estimates.
        """

    @abstractmethod
    def get_param_grid(self) -> dict:
        """Return sklearn-compatible param grid dict for GridSearchCV.

        Keys must use the `estimator__` prefix for MultiOutputRegressor wrappers.
        """

    @abstractmethod
    def get_summary(self) -> dict:
        """Return a JSON-serializable summary of the fitted model.

        Args:
            None

        Returns:
            dict with at least:
                {
                    "_type": "model",
                    "model_type": str,
                    "is_fitted": bool,
                    "input_columns": list,
                    "output_columns": list,
                }
        Notes:
            Used by get_state_json_safe() in schema.py to replace the model
            object with a serializable dict. Must never return non-serializable
            objects (DataFrames, numpy arrays, sklearn estimators).

        Future:
            Include hyperparameter values, training data shape.
        """

    # ─── Helpers ───────────────────────────────────────────────────────────────

    def _check_fitted(self) -> None:
        """Raise RuntimeError if the model has not been fitted yet.

        Args:
            None

        Returns:
            None

        Raises:
            RuntimeError: If self._is_fitted is False.

        Notes:
            Call at the top of predict() in every subclass.        """
        if not self._is_fitted:
            raise RuntimeError(
                f"{self.__class__.__name__} has not been fitted yet. "
                "Call fit() first."
            )
