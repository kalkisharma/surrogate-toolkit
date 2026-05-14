"""
================================================================================
FILE: rf_model.py
MODULE: app/ml/models/
PURPOSE: Random Forest surrogate model
DEPENDENCIES: scikit-learn, numpy
FUTURE EXTENSIONS: XGBoost variant, SHAP feature importance
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-12
VERSION: 0.7.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import numpy as np
from sklearn.ensemble import RandomForestRegressor

from app.ml.models.base_model import BaseSurrogateModel
from config.settings import DEFAULT_RANDOM_STATE, RF_DEFAULT_ESTIMATORS


class RFModel(BaseSurrogateModel):
    """Random Forest surrogate model.

    RandomForestRegressor natively handles multi-output targets — no wrapper
    is required. n_jobs=1 to respect the processor allocation stored in STATE.
    """

    def __init__(
        self,
        n_estimators: int = None,
        max_depth: int = None,
        min_samples_leaf: int = 1,
        max_features: str = "sqrt",
    ):
        super().__init__("rf")
        self._model = RandomForestRegressor(
            n_estimators=int(n_estimators) if n_estimators is not None else RF_DEFAULT_ESTIMATORS,
            max_depth=int(max_depth) if max_depth is not None else None,
            min_samples_leaf=int(min_samples_leaf) if min_samples_leaf else 1,
            max_features=max_features or "sqrt",
            random_state=DEFAULT_RANDOM_STATE,
            n_jobs=1,
        )

    def fit(
        self,
        X: np.ndarray,
        y: np.ndarray,
        input_columns: list,
        output_columns: list,
    ) -> None:
        """Fit the Random Forest to training data.

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
            RandomForestRegressor supports multi-output regression natively
            by training one tree ensemble on all outputs simultaneously.

        Future:
            Expose n_estimators and max_depth as constructor arguments.
        """
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float)
        if y.ndim == 1:
            y = y.reshape(-1, 1)
        # RF expects 1D y for single-output; 2D for multi-output.
        # Squeeze to (n,) when there is one output to avoid DataConversionWarning.
        fit_y = y.ravel() if y.shape[1] == 1 else y
        self._model.fit(X, fit_y)
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
            Bootstrap uncertainty via the spread of individual tree predictions.
        """
        self._check_fitted()
        X = np.asarray(X, dtype=float)
        result = self._model.predict(X)
        # RF returns 1D when fitted on a column-vector y; normalise to 2D.
        if result.ndim == 1:
            result = result.reshape(-1, 1)
        return result

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
            Include feature importances (mean decrease in impurity).
        """
        return {
            "_type": "model",
            "model_type": self.model_type,
            "is_fitted": self._is_fitted,
            "input_columns": self._input_columns,
            "output_columns": self._output_columns,
        }
