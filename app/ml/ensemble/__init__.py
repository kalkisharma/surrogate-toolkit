"""
================================================================================
FILE: __init__.py
MODULE: app/ml/ensemble/
PURPOSE: Package marker for ensemble model modules
DEPENDENCIES: None
FUTURE EXTENSIONS: None
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-11
VERSION: 0.1.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

from app.ml.ensemble.ensemble_model import EnsembleSurrogateModel

__all__ = ["EnsembleSurrogateModel"]
