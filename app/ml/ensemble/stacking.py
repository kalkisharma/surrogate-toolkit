"""
================================================================================
FILE: stacking.py
MODULE: app/ml/ensemble/
PURPOSE: Thin re-export wrapper for the stacking OOF utilities defined in
         ensemble_model.py. Kept as a separate module so future standalone
         stacking workflows can import directly from here without pulling in
         the full EnsembleSurrogateModel class.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-19
LAST MODIFIED: 2026-05-19
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

from app.ml.ensemble.ensemble_model import (  # noqa: F401
    EnsembleSurrogateModel,
    _compute_cv_weights,
    _create_component,
)

__all__ = ["EnsembleSurrogateModel", "_create_component", "_compute_cv_weights"]
