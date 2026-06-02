"""
================================================================================
FILE: __init__.py
MODULE: app/ml/validation/
PURPOSE: Package marker — exports cross-validation and diagnostic functions
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-12
VERSION: 0.7.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

from app.ml.validation.cross_validation import run_cross_validation
from app.ml.validation.diagnostics import compute_metrics

__all__ = ["run_cross_validation", "compute_metrics"]
