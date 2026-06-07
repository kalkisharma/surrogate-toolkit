"""
================================================================================
FILE: residual_mode.py
MODULE: app/ml/active_learning/
PURPOSE: Residual-guided active learning: recommend new simulation points in
         regions where the surrogate has the highest error, weighted by
         Gaussian kernel proximity to existing test-set residuals.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-26
LAST MODIFIED: 2026-06-06
VERSION: 1.1.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import numpy as np


class ResidualRecommender:
    """
    Recommend new simulation points where surrogate error is highest.

    Algorithm:
        score(c) = Σ_t |residual_t| · exp(−‖c − t‖² / 2h²)
    where h = median pairwise Euclidean distance between test points.
    Candidates are drawn from a Latin Hypercube over the training bounding box.
    Greedy diversity-weighted selection spreads recommendations across the space.
    """

    def recommend(
        self,
        X_train: np.ndarray,
        X_test: np.ndarray,
        residuals: np.ndarray,
        input_cols: list,
        n_recommendations: int = 10,
        n_candidates: int = 2000,
        seed: int = 42,
        diversity_weight: float = 0.5,
    ) -> dict:
        """
        Args:
            X_train:           (N, d) normalized training inputs.
            X_test:            (M, d) normalized test inputs.
            residuals:         (M,) per-test-point absolute residual magnitudes.
            input_cols:        Ordered list of input column names (length d).
            n_recommendations: Number of points to return (≤ n_candidates).
            n_candidates:      LHS pool size.
            seed:              Random seed for reproducibility.
            diversity_weight:  0 = cluster at highest score; 1 = max spread (default 0.5).

        Returns:
            dict with keys: mode, input_cols, bounds, recommendations,
            score_label, n_recommendations, n_training, n_test.
        """
        from scipy.stats.qmc import LatinHypercube, scale as qmc_scale

        residuals = np.abs(np.asarray(residuals, dtype=float))
        n_dims    = X_train.shape[1]

        # Bandwidth: median pairwise distance between test points
        if len(X_test) >= 2:
            diff      = X_test[:, np.newaxis, :] - X_test[np.newaxis, :, :]  # (M, M, d)
            pairwise  = np.sqrt((diff ** 2).sum(axis=2))                      # (M, M)
            upper_tri = pairwise[np.triu_indices(len(X_test), k=1)]
            h         = float(np.median(upper_tri))
        else:
            h = 1.0
        h = max(h, 1e-6)

        # LHS candidates in training bounding box
        bounds_min = X_train.min(axis=0)
        bounds_max = X_train.max(axis=0)
        sampler    = LatinHypercube(d=n_dims, seed=seed)
        candidates = qmc_scale(sampler.random(n=n_candidates), bounds_min, bounds_max)

        # Score each candidate: Σ_t |r_t| · exp(−‖c − t‖² / 2h²)
        # Broadcasting: (n_cand, 1, d) − (1, M, d) = (n_cand, M, d)
        diff_ct  = candidates[:, np.newaxis, :] - X_test[np.newaxis, :, :]  # (n_cand, M, d)
        sq_dists = (diff_ct ** 2).sum(axis=2)                               # (n_cand, M)
        weights  = np.exp(-sq_dists / (2 * h ** 2))                        # (n_cand, M)
        scores   = weights @ residuals                                       # (n_cand,)

        # Greedy diversity-weighted selection
        selected_indices = self._greedy_diverse_select(
            candidates, scores, n_recommendations, diversity_weight
        )

        recommendations = []
        for rank, idx in enumerate(selected_indices, 1):
            rec = {col: float(candidates[idx, j]) for j, col in enumerate(input_cols)}
            rec["_score"] = float(scores[idx])
            rec["_rank"]  = rank
            recommendations.append(rec)

        return {
            "mode":              "residual",
            "input_cols":        input_cols,
            "bounds": {
                "min": {col: float(bounds_min[j]) for j, col in enumerate(input_cols)},
                "max": {col: float(bounds_max[j]) for j, col in enumerate(input_cols)},
            },
            "recommendations":   recommendations,
            "score_label":       "Residual proximity score",
            "n_recommendations": len(recommendations),
            "n_training":        int(len(X_train)),
            "n_test":            int(len(X_test)),
        }

    def _greedy_diverse_select(
        self,
        candidates: np.ndarray,
        scores: np.ndarray,
        n_recommendations: int,
        diversity_weight: float,
    ) -> list:
        """Greedy sequential selection blending acquisition score and spatial diversity."""
        n = len(candidates)
        score_min, score_max = scores.min(), scores.max()
        norm_scores = (scores - score_min) / (score_max - score_min + 1e-12)

        selected_indices = []
        remaining_mask   = np.ones(n, dtype=bool)
        min_dist_to_sel  = np.full(n, np.inf)

        for _ in range(min(n_recommendations, n)):
            if diversity_weight > 0 and selected_indices:
                finite   = min_dist_to_sel[np.isfinite(min_dist_to_sel)]
                dist_max = float(finite.max()) if len(finite) else 1.0
                norm_dists = np.minimum(min_dist_to_sel / (dist_max + 1e-12), 1.0)
                combined = (1.0 - diversity_weight) * norm_scores + diversity_weight * norm_dists
            else:
                combined = norm_scores

            combined_masked = np.where(remaining_mask, combined, -np.inf)
            idx = int(np.argmax(combined_masked))
            selected_indices.append(idx)
            remaining_mask[idx] = False

            new_dists = np.sqrt(((candidates - candidates[idx]) ** 2).sum(axis=1))
            min_dist_to_sel = np.minimum(min_dist_to_sel, new_dists)

        return selected_indices
