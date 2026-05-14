"""
================================================================================
FILE: settings.py
MODULE: config/
PURPOSE: Single source of truth for all configurable constants. Nothing is
         hardcoded elsewhere in the application — all tunable values live here.
DEPENDENCIES: None — this module has no internal imports.
FUTURE EXTENSIONS: Per-program overrides, runtime config loading from a database.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-13
VERSION: 0.9.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

# ─── VERSION ──────────────────────────────────────────────────────────────────

VERSION = "0.9.0"

# ─── DATA VALIDATION ──────────────────────────────────────────────────────────

MAX_FILE_SIZE_MB = 500
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

MIN_ROWS = 5
MAX_ROWS = 500_000

MIN_COLUMNS = 2
MAX_COLUMNS = 200

MISSING_VALUE_THRESHOLD = 0.30       # max null fraction per column
CORRELATION_WARNING_THRESHOLD = 0.90

# ─── DATA CLEANING ─────────────────────────────────────────────────────────────

IQR_OUTLIER_MULTIPLIER = 1.5         # rows outside Q1 - k*IQR or Q3 + k*IQR are flagged
CLEANING_STRATEGIES_NULL     = ["drop_rows", "mean_impute", "median_impute"]
CLEANING_STRATEGIES_OUTLIER  = ["keep", "drop_rows"]
LOG_TRANSFORM_SKEW_THRESHOLD = 1.0   # |skew| > this flags a column as a candidate for log-transform

# ─── MODEL TRAINING ────────────────────────────────────────────────────────────

SUPPORTED_MODEL_TYPES = ["gpr", "rf", "linear"]

TEST_SPLIT_MIN = 0.05        # minimum fraction reserved for the test set
TEST_SPLIT_MAX = 0.50        # maximum fraction reserved for the test set

CV_FOLDS_MIN = 2             # minimum k for k-fold cross-validation
CV_FOLDS_MAX = 20            # maximum k for k-fold cross-validation
DIMENSIONALITY_WARNING_THRESHOLD = 10

MAX_HEADER_LENGTH = 256              # characters per column name

# ─── MODELS ───────────────────────────────────────────────────────────────────

DEFAULT_CV_FOLDS = 5
DEFAULT_TEST_SPLIT = 0.2
DEFAULT_RANDOM_STATE = 42
MAX_MODEL_HISTORY = 10               # stored runs per output

BOOTSTRAP_DEFAULT_SAMPLES = 100
RF_DEFAULT_ESTIMATORS = 100
GPR_DEFAULT_ALPHA = 0.1

# ─── ACTIVE LEARNING ──────────────────────────────────────────────────────────

DEFAULT_RECOMMENDATIONS = 10
MAX_ACTIVE_LEARNING_HISTORY = 5

# ─── PROCESSORS ───────────────────────────────────────────────────────────────

DEFAULT_PROCESSOR_MODE = 'serial'
HEAD_NODE_WARNING_THRESHOLD = 4      # show caution if user requests more than this

# ─── STATE LIMITS ─────────────────────────────────────────────────────────────

MAX_PLOT_ROWS = 2000            # max rows sent to the browser scatter matrix
MAX_DATASETS = 5                # max simultaneously loaded datasets per session
MAX_DATASETS_MEMORY_MB = 2048   # total in-memory DataFrame budget across all datasets

MAX_PREDICTION_HISTORY = 20
MAX_AUDIT_EVENTS = 1000

# ─── WARNING THRESHOLDS ───────────────────────────────────────────────────────

EXTRAPOLATION_CAUTION_THRESHOLD = 1.1
EXTRAPOLATION_WARNING_THRESHOLD = 1.25

R2_MINIMUM_ACCEPTABLE = 0.70
R2_CAUTION_THRESHOLD = 0.85

# ─── UI / UX ──────────────────────────────────────────────────────────────────

DEFAULT_EXPERIENCE_LEVEL = 'beginner'
DEFAULT_LEARNING_MODE = False

# ─── COMPLIANCE ───────────────────────────────────────────────────────────────

DEFAULT_CLASSIFICATION = 'Unclassified'
SUPPORTED_CLASSIFICATIONS = ['Unclassified', 'CUI', 'ITAR', 'EAR']

# ─── LOGGING ──────────────────────────────────────────────────────────────────

LOG_LEVEL = 'INFO'
MAX_LOG_FILE_SIZE_MB = 50
LOG_BACKUP_COUNT = 5
AUDIT_LOG_EXPIRY_WARNING_DAYS = 7

# ─── REPORTING ────────────────────────────────────────────────────────────────

REPORT_FORMATS = ['PDF', 'HTML']
