"""
================================================================================
FILE: __init__.py
MODULE: app/ml/multi_fidelity/
PURPOSE: Package marker for multi-fidelity modeling modules
DEPENDENCIES: None
FUTURE EXTENSIONS: None
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-19
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

from app.ml.multi_fidelity.bridge_correction import BridgeCorrectionModel
from app.ml.multi_fidelity.kennedy_ohagan    import KOCoKrigingModel

__all__ = ["BridgeCorrectionModel", "KOCoKrigingModel"]
