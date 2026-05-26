"""
================================================================================
FILE: residual_mode.py
MODULE: app/ml/active_learning/
PURPOSE: Residual-guided active learning: recommend new simulation points in
         regions where the surrogate has the highest error, weighted by
         Gaussian kernel proximity to existing test-set residuals.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-26
LAST MODIFIED: 2026-05-26
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import numpy as np


class ResidualRecommender:
    """
    Recommend new simulation points where surrogate error is highest.

    Algorithm:
        score(c) = Σ_t |residual_t| · exp(−‖c − t‖² / 2h²)
    where h = median pairwise Euclidean distance between test points.
    Candidates are drawn from a Latin Hypercube over the training bounding box.
    Greedy selection picks high-score candidates sequentially, skipping
    near-duplicates (separation < 1e-6 × mean range).
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
    ) -> dict:
        """
        Args:
            X_train:          (N, d) normalized training inputs.
            X_test:           (M, d) normalized test inputs.
            residuals:        (M,) per-test-point absolute residual magnitudes.
            input_cols:       Ordered list of input column names (length d).
            n_recommendations: Number of points to return (≤ n_candidates).
            n_candidates:     LHS pool size.
            seed:             Random seed for reproducibility.

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

        # Greedy selection — descending score, skip near-duplicates
        order      = np.argsort(-scores)
        range_mean = float((bounds_max - bounds_min).mean())
        min_sep    = range_mean * 1e-6
        picked_pts = []
        selected   = []

        for idx in order:
            if len(selected) >= n_recommendations:
                break
            pt = candidates[idx]
            if picked_pts:
                min_dist = min(np.linalg.norm(pt - p) for p in picked_pts)
                if min_dist < min_sep:
                    continue
            selected.append((float(scores[idx]), pt))
            picked_pts.append(pt)

        recommendations = []
        for rank, (score, pt) in enumerate(selected, 1):
            rec = {col: float(pt[j]) for j, col in enumerate(input_cols)}
            rec["_score"] = score
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
