"""
================================================================================
FILE: __init__.py
MODULE: app/ml/multi_fidelity/
PURPOSE: Package marker for multi-fidelity modeling modules
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-19
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

from app.ml.multi_fidelity.bridge_correction import BridgeCorrectionModel
from app.ml.multi_fidelity.kennedy_ohagan    import KOCoKrigingModel

__all__ = ["BridgeCorrectionModel", "KOCoKrigingModel"]
