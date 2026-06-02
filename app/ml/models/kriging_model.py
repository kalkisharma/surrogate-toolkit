"""
================================================================================
FILE: kriging_model.py
MODULE: app/ml/models/
PURPOSE: Backward-compatibility alias — KrigingModel is now GPRModel.
         Kept so existing .surrogate project files that contain pickled
         KrigingModel instances load without ImportError.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-18
LAST MODIFIED: 2026-06-01
VERSION: 2.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

from app.ml.models.gpr_model import GPRModel

KrigingModel = GPRModel
