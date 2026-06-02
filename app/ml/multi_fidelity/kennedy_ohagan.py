"""
================================================================================
FILE: kennedy_ohagan.py
MODULE: app/ml/multi_fidelity/
PURPOSE: Simplified Kennedy-O'Hagan co-kriging.
         f_hf(x) = ρ · f_lf(x) + δ(x)
         ρ (scale factor) estimated via ordinary least squares per output;
         f_lf is a GPR trained on LF data; δ is an independent GPR trained
         on the discrepancy at HF sample points.  Provides native uncertainty
         estimates by combining LF and δ posterior stds.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-19
LAST MODIFIED: 2026-05-19
VERSION: 1.0.1
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import numpy as np
from typing import List
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import Matern, ConstantKernel

from app.ml.models.base_model import BaseSurrogateModel


class KOCoKrigingModel(BaseSurrogateModel):
    """Simplified Kennedy-O'Hagan co-kriging surrogate.

    The model is:
        f_hf(x) = ρ · f_lf(x) + δ(x)

    where:
    - f_lf is a Gaussian Process Regressor fitted on the full LF dataset.
    - ρ is a scalar scale factor per output, estimated via ordinary least
      squares at the HF sample points: ρ = (f_lf(X_hf)ᵀ y_hf) / ‖f_lf(X_hf)‖².
    - δ is an independent GPR fitted on the discrepancy
      y_hf − ρ · f_lf(X_hf) at HF points.

    Prediction uncertainty combines the LF and δ posterior stds:
        σ_mf² ≈ ρ² · σ_lf² + σ_δ²
    """

    def __init__(self):
        super().__init__("co_kriging")
        self._lf_gps:    List[GaussianProcessRegressor] = []
        self._delta_gps: List[GaussianProcessRegressor] = []
        self._rhos:      List[float]                    = []
        self._n_lf:      int                            = 0
        self._n_hf:      int                            = 0

    def fit_multifidelity(
        self,
        X_lf: np.ndarray,
        y_lf: np.ndarray,
        X_hf: np.ndarray,
        y_hf: np.ndarray,
        input_columns: list,
        output_columns: list,
    ) -> None:
        """Fit LF GP, estimate ρ per output, fit δ GP on discrepancy.

        Args:
            X_lf: (n_lf, n_inputs) low-fidelity features.
            y_lf: (n_lf, n_outputs) low-fidelity targets.
            X_hf: (n_hf, n_inputs) high-fidelity features.
            y_hf: (n_hf, n_outputs) high-fidelity targets.
            input_columns:  Shared input column names.
            output_columns: Shared output column names.
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
        kernel    = ConstantKernel(1.0) * Matern(nu=2.5)

        self._lf_gps    = []
        self._delta_gps = []
        self._rhos      = []

        for i in range(n_outputs):
            # ── Step 1: fit GP on LF data ─────────────────────────────────
            gp_lf = GaussianProcessRegressor(
                kernel=kernel, alpha=1e-6,
                n_restarts_optimizer=3, normalize_y=True,
            )
            gp_lf.fit(X_lf, y_lf[:, i])
            self._lf_gps.append(gp_lf)

            # ── Step 2: estimate ρ via OLS ────────────────────────────────
            lf_at_hf = gp_lf.predict(X_hf)          # (n_hf,)
            denom    = float(lf_at_hf @ lf_at_hf)
            rho      = float(lf_at_hf @ y_hf[:, i]) / denom if denom > 1e-12 else 1.0
            rho      = float(np.clip(rho, 0.01, 10.0))
            self._rhos.append(rho)

            # ── Step 3: fit GP on discrepancy ─────────────────────────────
            delta_targets = y_hf[:, i] - rho * lf_at_hf
            gp_delta      = GaussianProcessRegressor(
                kernel=kernel, alpha=1e-6,
                n_restarts_optimizer=3, normalize_y=True,
            )
            gp_delta.fit(X_hf, delta_targets)
            self._delta_gps.append(gp_delta)

        self._n_lf           = len(X_lf)
        self._n_hf           = len(X_hf)
        self._input_columns  = list(input_columns)
        self._output_columns = list(output_columns)
        self._is_fitted      = True

    def fit(
        self,
        X: np.ndarray,
        y: np.ndarray,
        input_columns: list,
        output_columns: list,
    ) -> None:
        raise NotImplementedError(
            "KOCoKrigingModel requires separate LF and HF arrays. "
            "Call fit_multifidelity() instead."
        )

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Return MF prediction = ρ · f_lf(X) + δ(X).

        Args:
            X: (n_samples, n_inputs) feature array.

        Returns:
            np.ndarray of shape (n_samples, n_outputs).
        """
        self._check_fitted()
        X    = np.asarray(X, dtype=float)
        cols = [
            rho * gp_lf.predict(X) + gp_delta.predict(X)
            for gp_lf, gp_delta, rho in zip(self._lf_gps, self._delta_gps, self._rhos)
        ]
        return np.column_stack(cols) if len(cols) > 1 else cols[0].reshape(-1, 1)

    def predict_std(self, X: np.ndarray) -> np.ndarray:
        """Return combined posterior std σ_mf = sqrt(ρ²σ_lf² + σ_δ²).

        Args:
            X: (n_samples, n_inputs) feature array.

        Returns:
            np.ndarray of shape (n_samples, n_outputs).
        """
        self._check_fitted()
        X    = np.asarray(X, dtype=float)
        stds = []
        for gp_lf, gp_delta, rho in zip(self._lf_gps, self._delta_gps, self._rhos):
            _, std_lf    = gp_lf.predict(X,    return_std=True)
            _, std_delta = gp_delta.predict(X, return_std=True)
            stds.append(np.sqrt((rho * std_lf) ** 2 + std_delta ** 2))
        return np.column_stack(stds) if len(stds) > 1 else stds[0].reshape(-1, 1)

    def get_param_grid(self) -> dict:
        return {}

    def get_summary(self) -> dict:
        return {
            "_type":          "model",
            "model_type":     self.model_type,
            "is_fitted":      self._is_fitted,
            "input_columns":  self._input_columns,
            "output_columns": self._output_columns,
            "rhos":           self._rhos,
            "n_lf":           self._n_lf,
            "n_hf":           self._n_hf,
        }
