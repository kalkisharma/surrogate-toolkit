"""
================================================================================
FILE: coverage_mode.py
MODULE: app/ml/active_learning/
PURPOSE: Coverage-based recommendation using max-min distance criterion.
         Generates Latin Hypercube candidates and selects those farthest from
         existing training samples to maximise design space coverage.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-15
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import numpy as np


class CoverageRecommender:
    """Select new simulation points that maximise design-space coverage."""

    def recommend(
        self,
        X_train: np.ndarray,
        input_cols: list,
        n_recommendations: int = 10,
        n_candidates: int = 2000,
        seed: int = 42,
    ) -> dict:
        """
        Generate space-filling recommendations using the max-min distance
        criterion over a Latin Hypercube candidate pool.

        Args:
            X_train:          Training data array  (n_samples × n_features).
            input_cols:       Ordered list of input column names.
            n_recommendations: Number of points to return.
            n_candidates:     LHS pool size to draw candidates from.
            seed:             Random seed for reproducibility.

        Returns:
            dict with keys: mode, input_cols, bounds, recommendations,
            score_label, n_recommendations, n_training.
        """
        from scipy.stats.qmc import LatinHypercube, scale as qmc_scale

        n_features  = len(input_cols)
        bounds_min  = X_train.min(axis=0)
        bounds_max  = X_train.max(axis=0)

        # Generate candidates in the unit hypercube then scale to data bounds
        sampler    = LatinHypercube(d=n_features, seed=seed)
        unit_samp  = sampler.random(n=n_candidates)
        candidates = qmc_scale(unit_samp, bounds_min, bounds_max)

        # Min distance from each candidate to its nearest training neighbour
        # Shape: (n_candidates, n_train) via broadcasting
        diff          = candidates[:, np.newaxis, :] - X_train[np.newaxis, :, :]
        dist_matrix   = np.sqrt((diff ** 2).sum(axis=2))
        min_distances = dist_matrix.min(axis=1)

        # Greedy sequential selection: pick farthest point, add to pool,
        # recompute min distances against the growing selected set
        selected_indices = []
        remaining_mask   = np.ones(n_candidates, dtype=bool)
        current_min_dist = min_distances.copy()

        for _ in range(min(n_recommendations, n_candidates)):
            idx = int(np.argmax(current_min_dist * remaining_mask))
            selected_indices.append(idx)
            remaining_mask[idx] = False
            # Update min distances relative to newly selected point
            new_point = candidates[idx]
            new_dists = np.sqrt(((candidates - new_point) ** 2).sum(axis=1))
            current_min_dist = np.minimum(current_min_dist, new_dists)

        recommendations = []
        for rank, idx in enumerate(selected_indices, start=1):
            rec              = {col: float(candidates[idx, j]) for j, col in enumerate(input_cols)}
            rec["_score"]    = float(min_distances[idx])
            rec["_rank"]     = rank
            recommendations.append(rec)

        return {
            "mode":            "coverage",
            "input_cols":      input_cols,
            "bounds":          {
                "min": {col: float(bounds_min[i]) for i, col in enumerate(input_cols)},
                "max": {col: float(bounds_max[i]) for i, col in enumerate(input_cols)},
            },
            "recommendations":   recommendations,
            "score_label":       "Min distance to nearest training point",
            "n_recommendations": len(recommendations),
            "n_training":        len(X_train),
        }
