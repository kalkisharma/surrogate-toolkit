"""
================================================================================
FILE: bridge_correction.py
MODULE: app/ml/multi_fidelity/
PURPOSE: Bridge correction multi-fidelity model.  Trains a LF surrogate on
         full low-fidelity data, then fits an RF error model on the residuals
         (y_hf - lf_pred) at the high-fidelity sample points.  Prediction =
         LF_prediction + RF_correction.
DEPENDENCIES: scikit-learn, numpy, app.ml.models.base_model
FUTURE EXTENSIONS: Configurable error model type; kriging-based correction
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-19
LAST MODIFIED: 2026-05-19
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import numpy as np
from typing import Optional
from sklearn.ensemble import RandomForestRegressor

from app.ml.models.base_model import BaseSurrogateModel


class BridgeCorrectionModel(BaseSurrogateModel):
    """Multi-fidelity surrogate via bridge (error) correction.

    Trains a LF surrogate on full low-fidelity data, then trains a Random
    Forest to predict the systematic error (y_hf - lf_pred) at high-fidelity
    sample points.  The final prediction at any point x is:

        f_mf(x) = f_lf(x) + f_error(x)

    RF is used for the error model because it handles the small HF sample
    sizes typical in aerospace multi-fidelity workflows (20–100 points) and
    extrapolates conservatively (predicts near the training mean outside the
    HF sample range).
    """

    def __init__(self, lf_model: BaseSurrogateModel):
        """
        Args:
            lf_model: Unfitted BaseSurrogateModel instance used for the LF
                      surrogate.  Will be fitted on the full LF dataset.
        """
        super().__init__("bridge_correction")
        self._lf_model:    BaseSurrogateModel                = lf_model
        self._error_model: Optional[RandomForestRegressor]  = None
        self._n_outputs:   int                               = 0
        self._n_lf:        int                               = 0
        self._n_hf:        int                               = 0

    def fit_multifidelity(
        self,
        X_lf: np.ndarray,
        y_lf: np.ndarray,
        X_hf: np.ndarray,
        y_hf: np.ndarray,
        input_columns: list,
        output_columns: list,
    ) -> None:
        """Train LF surrogate then RF error model.

        Args:
            X_lf: (n_lf, n_inputs) low-fidelity feature array.
            y_lf: (n_lf, n_outputs) low-fidelity target array.
            X_hf: (n_hf, n_inputs) high-fidelity feature array.
            y_hf: (n_hf, n_outputs) high-fidelity target array.
            input_columns:  Input column names (shared by LF and HF).
            output_columns: Output column names (shared by LF and HF).
        """
        X_lf = np.asarray(X_lf, dtype=float)
        y_lf = np.asarray(y_lf, dtype=float)
        X_hf = np.asarray(X_hf, dtype=float)
        y_hf = np.asarray(y_hf, dtype=float)
        if y_lf.ndim == 1:
            y_lf = y_lf.reshape(-1, 1)
        if y_hf.ndim == 1:
            y_hf = y_hf.reshape(-1, 1)

        n_outputs = y_lf.shape[1]

        # 1. Train LF model on all LF data
        self._lf_model.fit(X_lf, y_lf, input_columns, output_columns)

        # 2. Compute residuals at HF sample points
        lf_at_hf = self._lf_model.predict(X_hf)   # (n_hf, n_outputs)
        error     = y_hf - lf_at_hf                # (n_hf, n_outputs)

        # 3. Fit RF error model (supports multi-output natively)
        self._error_model = RandomForestRegressor(
            n_estimators=100, random_state=42,
        )
        if n_outputs == 1:
            self._error_model.fit(X_hf, error[:, 0])
        else:
            self._error_model.fit(X_hf, error)

        self._n_outputs        = n_outputs
        self._n_lf             = len(X_lf)
        self._n_hf             = len(X_hf)
        self._input_columns    = list(input_columns)
        self._output_columns   = list(output_columns)
        self._is_fitted        = True

    def fit(
        self,
        X: np.ndarray,
        y: np.ndarray,
        input_columns: list,
        output_columns: list,
    ) -> None:
        raise NotImplementedError(
            "BridgeCorrectionModel requires separate LF and HF arrays. "
            "Call fit_multifidelity() instead."
        )

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Return MF prediction = LF prediction + error correction.

        Args:
            X: (n_samples, n_inputs) feature array.

        Returns:
            np.ndarray of shape (n_samples, n_outputs).
        """
        self._check_fitted()
        X           = np.asarray(X, dtype=float)
        lf_pred     = self._lf_model.predict(X)     # (n, n_outputs)
        correction  = self._error_model.predict(X)  # (n,) or (n, n_outputs)
        if correction.ndim == 1:
            correction = correction.reshape(-1, 1)
        return lf_pred + correction

    def get_param_grid(self) -> dict:
        return {}

    def get_summary(self) -> dict:
        return {
            "_type":            "model",
            "model_type":       self.model_type,
            "is_fitted":        self._is_fitted,
            "input_columns":    self._input_columns,
            "output_columns":   self._output_columns,
            "base_model_type":  self._lf_model.model_type if self._lf_model else None,
            "n_lf":             self._n_lf,
            "n_hf":             self._n_hf,
        }
