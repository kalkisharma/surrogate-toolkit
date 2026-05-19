"""
================================================================================
FILE: __init__.py
MODULE: app/ml/validation/
PURPOSE: Package marker — exports cross-validation and diagnostic functions
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-12
VERSION: 0.7.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

from app.ml.validation.cross_validation import run_cross_validation
from app.ml.validation.diagnostics import compute_metrics

__all__ = ["run_cross_validation", "compute_metrics"]
