"""
================================================================================
FILE: ensemble_model.py
MODULE: app/ml/ensemble/
PURPOSE: Weighted ensemble of multiple surrogate model types.
         Three strategies: equal weights, CV-performance weights, stacking
         (out-of-fold meta-model). Implements the same BaseSurrogateModel
         interface as every other surrogate — all downstream panels
         (predictions, sensitivity, export) work without modification.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-19
LAST MODIFIED: 2026-05-19
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import numpy as np
from sklearn.linear_model import Ridge
from sklearn.metrics import r2_score
from sklearn.model_selection import KFold

from app.ml.models.base_model import BaseSurrogateModel
from config.settings import DEFAULT_RANDOM_STATE


# ─── FACTORY ──────────────────────────────────────────────────────────────────

def _create_component(model_type: str, hyperparams: dict = None):
    """Instantiate one component model by type string.

    Kept here (not in model_api.py) to avoid circular imports: this module
    imports from app.ml.models; model_api.py imports from here.

    Args:
        model_type:  One of the SUPPORTED_MODEL_TYPES strings.
        hyperparams: Optional dict of model-specific overrides.

    Returns:
        Unfitted BaseSurrogateModel subclass instance.
    """
    from app.ml.models import (
        GPRModel, KrigingModel, LinearModel, PCEModel, RBFModel, RFModel,
    )
    hp = hyperparams or {}
    if model_type == "gpr":
        return GPRModel(kernel=hp.get("kernel", "rbf"), alpha=hp.get("alpha"))
    if model_type == "kriging":
        return KrigingModel(kernel=hp.get("kernel", "matern25"), alpha=hp.get("alpha"))
    if model_type == "rf":
        return RFModel(
            n_estimators=hp.get("n_estimators"),
            max_depth=hp.get("max_depth"),
            min_samples_leaf=hp.get("min_samples_leaf", 1),
            max_features=hp.get("max_features", "sqrt"),
        )
    if model_type == "rbf":
        return RBFModel(
            kernel=hp.get("kernel", "thin_plate_spline"),
            smoothing=hp.get("smoothing", 1e-3),
        )
    if model_type == "pce":
        return PCEModel(order=hp.get("order", 3))
    return LinearModel(alpha=hp.get("alpha", 1.0))


def _compute_cv_weights(cv_r2_dict: dict) -> dict:
    """Normalize CV R² scores to weights; clamp negatives to zero.

    Args:
        cv_r2_dict: {model_type: float} — CV R² per component.

    Returns:
        {model_type: float} — weights summing to 1.0.
        Falls back to equal weights if all scores are ≤ 0.
    """
    clamped = {mt: max(0.0, r2) for mt, r2 in cv_r2_dict.items()}
    total = sum(clamped.values())
    if total <= 0:
        n = len(clamped)
        return {mt: 1.0 / n for mt in clamped} if n > 0 else {}
    return {mt: v / total for mt, v in clamped.items()}


# ─── MODEL ────────────────────────────────────────────────────────────────────

class EnsembleSurrogateModel(BaseSurrogateModel):
    """Weighted ensemble of multiple surrogate model types.

    Supports three weighting strategies:

    - "equal"          — each component receives weight 1/n.
    - "cv_performance" — weights proportional to cross-validation R²
                         (default). Components with negative CV R² receive
                         weight 0.
    - "stacking"       — a Ridge meta-model (one per output) is trained on
                         out-of-fold (OOF) component predictions. The OOF
                         loop provides CV R² as a free byproduct.

    `predict_std()` returns the standard deviation across component
    predictions at each point — a free uncertainty proxy independent of
    the weighting strategy.

    `get_param_grid()` returns {} — ensembles are not auto-tuned.
    """

    def __init__(
        self,
        component_types: list,
        strategy: str = "cv_performance",
        hyperparams_per_type: dict = None,
        cv_folds: int = 5,
    ):
        super().__init__("ensemble")
        self._component_types    = list(component_types)
        self._strategy           = strategy
        self._hyperparams_per_type = hyperparams_per_type or {}
        self._cv_folds           = cv_folds
        self._components         = []   # [(model_type, fitted_model), ...]
        self._weights            = {}   # {model_type: float}
        self._meta_models        = []   # [Ridge, ...] one per output; non-empty for stacking
        self._component_cv_r2    = {}   # {model_type: float} — average R² across outputs
        self._failed_components  = []   # [{"model_type": str, "error": str}, ...]

    # ─── BaseSurrogateModel interface ─────────────────────────────────────────

    def fit(
        self,
        X: np.ndarray,
        y: np.ndarray,
        input_columns: list,
        output_columns: list,
    ) -> None:
        """Fit the ensemble on the training data.

        Args:
            X: (n_samples, n_inputs) training features.
            y: (n_samples, n_outputs) training targets.
            input_columns: Input column names in order.
            output_columns: Output column names in order.

        Returns:
            None

        Raises:
            RuntimeError: If all component models fail to train.

        Notes:
            For "cv_performance": runs k-fold CV per component to compute
            weights, then trains each component on the full training set.
            Total fits = n_components * (cv_folds + 1).

            For "equal": trains each component once on full data.
            Total fits = n_components.

            For "stacking": OOF loop trains each component cv_folds times,
            fits final components on full data, then trains one Ridge
            meta-model per output on the OOF predictions.
            Total fits = n_components * (cv_folds + 1) + n_outputs Ridge fits.

        Future:
            Warm-start reuse of fold models to avoid redundant training.
        """
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float)
        if y.ndim == 1:
            y = y.reshape(-1, 1)

        cv_folds = min(self._cv_folds, len(X))

        if self._strategy == "stacking":
            self._fit_stacking(X, y, input_columns, output_columns, cv_folds)
        else:
            self._fit_weighted(X, y, input_columns, output_columns, cv_folds)

        self._input_columns  = list(input_columns)
        self._output_columns = list(output_columns)
        self._is_fitted      = True

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Return ensemble predictions for X.

        For equal/cv_performance: weighted average across components.
        For stacking: meta-model prediction (one per output) from component
        predictions as input features.

        Args:
            X: (n_samples, n_inputs) feature array.

        Returns:
            np.ndarray of shape (n_samples, n_outputs).

        Raises:
            RuntimeError: If called before fit().

        Notes:
            Weights are re-normalised inside predict() as a safety guard
            against floating-point drift from OOF exclusions.        """
        self._check_fitted()
        X     = np.asarray(X, dtype=float)
        n     = len(X)
        n_out = len(self._output_columns)

        if self._meta_models:
            # Stacking path
            comp_preds = np.array([m.predict(X) for _, m in self._components])
            # comp_preds shape: (n_components, n, n_out)
            result = np.zeros((n, n_out))
            for out_idx, meta in enumerate(self._meta_models):
                meta_X = comp_preds[:, :, out_idx].T   # (n, n_components)
                result[:, out_idx] = meta.predict(meta_X)
            return result

        # Weighted-average path
        result  = np.zeros((n, n_out))
        total_w = sum(self._weights.get(mt, 0.0) for mt, _ in self._components)
        if total_w <= 0:
            preds = [m.predict(X) for _, m in self._components]
            return np.mean(preds, axis=0) if preds else np.zeros((n, n_out))
        for mt, m in self._components:
            w = self._weights.get(mt, 0.0)
            if w > 0:
                result += (w / total_w) * m.predict(X)
        return result

    def predict_std(self, X: np.ndarray) -> np.ndarray:
        """Return std across component predictions as uncertainty proxy.

        Args:
            X: (n_samples, n_inputs) feature array.

        Returns:
            np.ndarray of shape (n_samples, n_outputs). Zero if < 2 components.

        Raises:
            RuntimeError: If called before fit().

        Notes:
            This is model disagreement, not posterior uncertainty. High std
            means the components disagree — a useful warning signal.
            For GPR/Kriging components, this complements the native posterior
            std rather than replacing it.        """
        self._check_fitted()
        X = np.asarray(X, dtype=float)
        if len(self._components) < 2:
            return np.zeros((len(X), len(self._output_columns)))
        preds = np.array([m.predict(X) for _, m in self._components])
        # preds shape: (n_components, n_samples, n_outputs)
        return np.std(preds, axis=0)

    def get_param_grid(self) -> dict:
        # Ensembles are not auto-tuned via GridSearchCV.
        return {}

    def get_summary(self) -> dict:
        """Return a JSON-serializable summary of this ensemble.

        Args:
            None

        Returns:
            dict with "_type", "model_type", "is_fitted", "input_columns",
                "output_columns", "strategy", "components", "weights",
                "component_cv_r2", "failed_components".
        Notes:
            Called by get_state_json_safe() in schema.py.        """
        return {
            "_type":             "model",
            "model_type":        self.model_type,
            "is_fitted":         self._is_fitted,
            "input_columns":     self._input_columns,
            "output_columns":    self._output_columns,
            "strategy":          self._strategy,
            "components":        [mt for mt, _ in self._components],
            "weights":           self._weights,
            "component_cv_r2":   self._component_cv_r2,
            "failed_components": self._failed_components,
        }

    # ─── Private fitting helpers ───────────────────────────────────────────────

    def _fit_weighted(self, X, y, input_columns, output_columns, cv_folds):
        """Fit components and compute equal or CV-performance weights.

        For "equal": one fit per component, uniform weights.
        For "cv_performance": k-fold CV pass per component to compute weights,
        then one final fit per component on full data.
        """
        n_outputs = y.shape[1]
        self._components        = []
        self._failed_components = []
        cv_r2s                  = {}

        for mt in self._component_types:
            hp = self._hyperparams_per_type.get(mt, {})
            try:
                if self._strategy == "cv_performance":
                    kf = KFold(
                        n_splits=cv_folds, shuffle=True,
                        random_state=DEFAULT_RANDOM_STATE,
                    )
                    fold_r2s = []
                    for train_idx, val_idx in kf.split(X):
                        m_fold = _create_component(mt, hp)
                        m_fold.fit(X[train_idx], y[train_idx], input_columns, output_columns)
                        pred    = m_fold.predict(X[val_idx])
                        avg_r2  = float(np.mean([
                            r2_score(y[val_idx, i], pred[:, i])
                            for i in range(n_outputs)
                        ]))
                        fold_r2s.append(avg_r2)
                    cv_r2 = float(np.mean(fold_r2s))
                else:
                    cv_r2 = 1.0  # equal weighting — all start at 1 before normalisation

                m = _create_component(mt, hp)
                m.fit(X, y, input_columns, output_columns)
                self._components.append((mt, m))
                cv_r2s[mt] = cv_r2

            except Exception as exc:
                self._failed_components.append({"model_type": mt, "error": str(exc)})

        self._component_cv_r2 = cv_r2s
        n = len(cv_r2s)
        if self._strategy == "equal":
            self._weights = {mt: 1.0 / n for mt in cv_r2s} if n > 0 else {}
        else:
            self._weights = _compute_cv_weights(cv_r2s)

    def _fit_stacking(self, X, y, input_columns, output_columns, cv_folds):
        """Fit with stacking: OOF predictions → Ridge meta-model per output.

        OOF loop:
        1. For each component type, run k-fold CV and collect out-of-fold
           predictions in a (n_samples, n_types, n_outputs) array.
        2. Compute CV R² per component as a byproduct.

        Final training:
        3. Train each component on the full X (only valid ones from OOF loop).
        4. Train one Ridge meta-model per output on OOF predictions from
           successfully-trained final components.

        Components that fail at any stage are excluded and recorded in
        self._failed_components. The meta-model is trained only on columns
        from components that succeeded in both the OOF loop and final training.
        """
        n_samples, n_outputs = y.shape
        n_types              = len(self._component_types)

        oof_preds   = np.zeros((n_samples, n_types, n_outputs))
        cv_r2s      = {}
        failed_set  = set()
        self._failed_components = []

        kf = KFold(n_splits=cv_folds, shuffle=True, random_state=DEFAULT_RANDOM_STATE)

        # ── OOF pass ──────────────────────────────────────────────────────────
        for i, mt in enumerate(self._component_types):
            hp        = self._hyperparams_per_type.get(mt, {})
            fold_r2s  = []
            ok        = True

            for train_idx, val_idx in kf.split(X):
                try:
                    m_fold = _create_component(mt, hp)
                    m_fold.fit(X[train_idx], y[train_idx], input_columns, output_columns)
                    pred   = m_fold.predict(X[val_idx])
                    oof_preds[val_idx, i, :] = pred
                    avg_r2 = float(np.mean([
                        r2_score(y[val_idx, j], pred[:, j])
                        for j in range(n_outputs)
                    ]))
                    fold_r2s.append(avg_r2)
                except Exception as exc:
                    self._failed_components.append({"model_type": mt, "error": str(exc)})
                    failed_set.add(i)
                    ok = False
                    break

            if ok:
                cv_r2s[mt] = float(np.mean(fold_r2s))

        # ── Final component training ───────────────────────────────────────────
        oof_valid_cols = []   # column indices in oof_preds that survived both passes
        self._components = []

        for i, mt in enumerate(self._component_types):
            if i in failed_set:
                continue
            hp = self._hyperparams_per_type.get(mt, {})
            try:
                m = _create_component(mt, hp)
                m.fit(X, y, input_columns, output_columns)
                self._components.append((mt, m))
                oof_valid_cols.append(i)
            except Exception as exc:
                self._failed_components.append({"model_type": mt, "error": str(exc)})

        self._component_cv_r2 = cv_r2s
        self._weights         = _compute_cv_weights(
            {mt: cv_r2s[mt] for mt in [self._component_types[i] for i in oof_valid_cols]
             if mt in cv_r2s}
        )

        # ── Meta-model training (one Ridge per output) ────────────────────────
        self._meta_models = []
        for out_idx in range(n_outputs):
            oof_X = oof_preds[:, oof_valid_cols, out_idx]   # (n_samples, n_valid)
            meta  = Ridge(alpha=1.0)
            meta.fit(oof_X, y[:, out_idx])
            self._meta_models.append(meta)
