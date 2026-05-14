"""
================================================================================
FILE: stats.py
MODULE: app/data/
PURPOSE: Statistical helpers beyond basic pandas — currently distance correlation
         (dCor). Pure numpy, no external dependencies.
DEPENDENCIES: numpy
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-14
LAST MODIFIED: 2026-05-14
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import numpy as np


def _dcor(x: np.ndarray, y: np.ndarray) -> float:
    """
    Distance correlation between two 1-D arrays.

    Uses the Székely / Rizzo double-centering formula.
    Returns a value in [0, 1]: 0 = independent, 1 = perfectly dependent.
    Non-linear relationships that Pearson misses are detected.

    Requires n >= 4. Returns 0.0 for shorter arrays or zero-variance inputs.
    O(n²) — caller should cap rows before calling.
    """
    n = len(x)
    if n < 4:
        return 0.0

    A = np.abs(x[:, None] - x[None, :])
    B = np.abs(y[:, None] - y[None, :])

    # Double-center: subtract row means, column means, add grand mean
    Ac = A - A.mean(axis=1, keepdims=True) - A.mean(axis=0, keepdims=True) + A.mean()
    Bc = B - B.mean(axis=1, keepdims=True) - B.mean(axis=0, keepdims=True) + B.mean()

    dcov2_xy = float(np.mean(Ac * Bc))
    dcov2_xx = float(np.mean(Ac * Ac))
    dcov2_yy = float(np.mean(Bc * Bc))

    if dcov2_xx <= 0 or dcov2_yy <= 0:
        return 0.0

    return float(np.sqrt(max(0.0, dcov2_xy / np.sqrt(dcov2_xx * dcov2_yy))))


def compute_dcor_matrix(df, cols: list) -> dict:
    """
    Compute the distance correlation matrix for ``cols`` subset of ``df``.

    Drops rows with any NaN in the selected columns so all pairs share the
    same aligned arrays. Returns ``{col: {col: float}}`` with values rounded
    to 4 decimal places.

    Args:
        df:   pandas DataFrame (all numeric).
        cols: column names to include (caller should cap at ≤ 12).

    Returns:
        Symmetric dict of dicts; diagonal is always 1.0.
    """
    sub = df[cols].dropna()
    arrays = {c: sub[c].values.astype(float) for c in cols}

    matrix: dict = {}
    for i, ca in enumerate(cols):
        matrix[ca] = {}
        for j, cb in enumerate(cols):
            if ca == cb:
                matrix[ca][cb] = 1.0
            elif j < i:
                # Symmetric — reuse already-computed value
                matrix[ca][cb] = matrix[cb][ca]
            else:
                matrix[ca][cb] = round(_dcor(arrays[ca], arrays[cb]), 4)

    return matrix
