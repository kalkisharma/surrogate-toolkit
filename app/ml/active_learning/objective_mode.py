"""
================================================================================
FILE: objective_mode.py
MODULE: app/ml/active_learning/
PURPOSE: Objective-guided recommendation using Expected Improvement (EI) or
         Upper Confidence Bound (UCB) acquisition functions.
DEPENDENCIES: numpy, scipy
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-15
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import numpy as np


class ObjectiveRecommender:
    """Select new simulation points guided by a surrogate acquisition function."""

    def recommend(
        self,
        model,
        X_train: np.ndarray,
        input_cols: list,
        output_col_idx: int,
        n_recommendations: int = 10,
        n_candidates: int = 2000,
        acquisition: str = "EI",
        direction: str = "minimize",
        model_type: str = "gpr",
        kappa: float = 2.0,
        seed: int = 42,
    ) -> dict:
        """
        Generate objective-guided recommendations using EI or UCB.

        Args:
            model:            Fitted BaseSurrogateModel.
            X_train:          Training data array (n_samples × n_features).
            input_cols:       Ordered list of input column names.
            output_col_idx:   Index of the target output column.
            n_recommendations: Number of points to return.
            n_candidates:     LHS pool size.
            acquisition:      "EI" or "UCB".
            direction:        "minimize" or "maximize".
            model_type:       "gpr", "rf", or "linear".
            kappa:            Exploration weight for UCB (ignored for EI).
            seed:             Random seed for reproducibility.

        Returns:
            dict with keys: mode, acquisition, direction, input_cols, bounds,
            recommendations, score_label, f_best, has_uncertainty,
            n_recommendations, n_training.
        """
        from scipy.stats import norm
        from scipy.stats.qmc import LatinHypercube, scale as qmc_scale

        n_features = len(input_cols)
        bounds_min = X_train.min(axis=0)
        bounds_max = X_train.max(axis=0)

        # Generate candidate pool
        sampler    = LatinHypercube(d=n_features, seed=seed)
        unit_samp  = sampler.random(n=n_candidates)
        candidates = qmc_scale(unit_samp, bounds_min, bounds_max)

        # Predict mean
        y_pred = model.predict(candidates)[:, output_col_idx]

        # Predict uncertainty
        y_std         = self._get_std(model, candidates, output_col_idx, model_type)
        has_uncertainty = y_std is not None
        if y_std is None:
            y_std = np.zeros(len(candidates))

        # Current best from training predictions
        y_train_pred = model.predict(X_train)[:, output_col_idx]
        f_best = float(y_train_pred.min() if direction == "minimize" else y_train_pred.max())

        # Acquisition scores (higher is always better)
        scores = self._acquisition_scores(
            y_pred, y_std, f_best, acquisition, direction, kappa
        )

        # Top N by score
        top_idx        = np.argsort(scores)[::-1][:n_recommendations]
        top_candidates = candidates[top_idx]
        top_scores     = scores[top_idx]
        top_preds      = y_pred[top_idx]
        top_stds       = y_std[top_idx]

        recommendations = []
        for rank, (point, score, pred, std) in enumerate(
            zip(top_candidates, top_scores, top_preds, top_stds), start=1
        ):
            rec = {col: float(point[j]) for j, col in enumerate(input_cols)}
            rec["_score"]       = float(score)
            rec["_predicted"]   = float(pred)
            rec["_uncertainty"] = float(std)
            rec["_rank"]        = rank
            recommendations.append(rec)

        return {
            "mode":            "objective",
            "acquisition":     acquisition,
            "direction":       direction,
            "input_cols":      input_cols,
            "bounds":          {
                "min": {col: float(bounds_min[i]) for i, col in enumerate(input_cols)},
                "max": {col: float(bounds_max[i]) for i, col in enumerate(input_cols)},
            },
            "recommendations":   recommendations,
            "score_label":       f"{acquisition} score",
            "f_best":            f_best,
            "has_uncertainty":   has_uncertainty,
            "n_recommendations": len(recommendations),
            "n_training":        len(X_train),
        }

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _get_std(self, model, X: np.ndarray, output_col_idx: int, model_type: str):
        """Return per-point std array for GPR/RF; None for linear."""
        if model_type == "gpr":
            try:
                return model.predict_std(X)[:, output_col_idx]
            except Exception:
                return None

        if model_type == "rf":
            try:
                tree_preds = []
                for tree in model._model.estimators_:
                    p = tree.predict(X)
                    if p.ndim == 1:
                        p = p.reshape(-1, 1)
                    col_idx = min(output_col_idx, p.shape[1] - 1)
                    tree_preds.append(p[:, col_idx])
                return np.array(tree_preds).std(axis=0)
            except Exception:
                return None

        return None  # linear: no native uncertainty

    def _acquisition_scores(
        self,
        y_pred: np.ndarray,
        y_std: np.ndarray,
        f_best: float,
        acquisition: str,
        direction: str,
        kappa: float,
    ) -> np.ndarray:
        from scipy.stats import norm

        if acquisition == "UCB":
            if direction == "minimize":
                return -(y_pred - kappa * y_std)
            return y_pred + kappa * y_std

        # Expected Improvement
        improvement = (f_best - y_pred) if direction == "minimize" else (y_pred - f_best)
        with np.errstate(divide="ignore", invalid="ignore"):
            Z = np.where(y_std > 1e-9, improvement / y_std, 0.0)
            ei = np.where(
                y_std > 1e-9,
                improvement * norm.cdf(Z) + y_std * norm.pdf(Z),
                np.maximum(improvement, 0.0),
            )
        return ei
