"""
================================================================================
FILE: settings.py
MODULE: config/
PURPOSE: Single source of truth for all configurable constants. Nothing is
         hardcoded elsewhere in the application — all tunable values live here.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-23
VERSION: 3.3.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

# ─── VERSION ──────────────────────────────────────────────────────────────────

VERSION = "3.3.0"                     # bumped in settings.py, all changed file headers, and index.html on every release

# ─── DATA VALIDATION ──────────────────────────────────────────────────────────

MAX_FILE_SIZE_MB = 500               # hard upload limit; Flask returns HTTP 413 before the view is called
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024  # derived — do not set independently

MIN_ROWS = 5                         # reject CSVs with fewer rows than this
MAX_ROWS = 500_000                   # reject CSVs with more rows than this

MIN_COLUMNS = 2                      # need at least one input and one output column
MAX_COLUMNS = 200                    # practical cap; SPLOM degrades above ~12 visible columns

MISSING_VALUE_THRESHOLD = 0.30       # max null fraction per column before a warning is raised
CORRELATION_WARNING_THRESHOLD = 0.90 # flag input pairs with |Pearson r| ≥ this as potentially redundant

# ─── DATA CLEANING ─────────────────────────────────────────────────────────────

IQR_OUTLIER_MULTIPLIER = 1.5         # rows outside Q1 - k*IQR or Q3 + k*IQR are flagged
CLEANING_STRATEGIES_NULL     = ["drop_rows", "mean_impute", "median_impute"]  # valid values for POST /api/data/clean/nulls
CLEANING_STRATEGIES_OUTLIER  = ["keep", "drop_rows"]                          # valid values for POST /api/data/clean/outliers
LOG_TRANSFORM_SKEW_THRESHOLD = 1.0   # |skew| > this flags a column as a candidate for log-transform

# ─── MODEL TRAINING ────────────────────────────────────────────────────────────

SUPPORTED_MODEL_TYPES = ["gpr", "kriging", "rf", "rbf", "pce", "linear"]  # all keys accepted by POST /api/model/train

TEST_SPLIT_MIN = 0.05        # minimum fraction reserved for the test set
TEST_SPLIT_MAX = 0.50        # maximum fraction reserved for the test set

CV_FOLDS_MIN = 2             # minimum k for k-fold cross-validation
CV_FOLDS_MAX = 20            # maximum k for k-fold cross-validation
DIMENSIONALITY_WARNING_THRESHOLD = 10  # warn when input count exceeds this; high-dim data degrades GPR performance

MAX_HEADER_LENGTH = 256              # characters per column name; longer names are truncated on ingest

# ─── MODELS ───────────────────────────────────────────────────────────────────

DEFAULT_CV_FOLDS = 5         # k used when the user hasn't specified fold count
DEFAULT_TEST_SPLIT = 0.2     # fraction held out as test set when user hasn't specified
DEFAULT_RANDOM_STATE = 42    # fixed seed for reproducible train/test splits and model initialisation
MAX_MODEL_HISTORY = 10       # stored training runs per output column

BOOTSTRAP_DEFAULT_SAMPLES = 100  # number of bootstrap resamples for uncertainty estimation
RF_DEFAULT_ESTIMATORS = 100      # number of trees in the Random Forest
GPR_DEFAULT_ALPHA = 0.1          # noise regularisation added to GPR diagonal (sklearn GaussianProcessRegressor alpha)

# ─── ACTIVE LEARNING ──────────────────────────────────────────────────────────

DEFAULT_RECOMMENDATIONS = 10     # number of new experiment points suggested per active learning run
MAX_ACTIVE_LEARNING_HISTORY = 5  # rounds of recommendations stored in STATE before oldest is dropped

# ─── PROCESSORS ───────────────────────────────────────────────────────────────

DEFAULT_PROCESSOR_MODE = 'serial'    # 'serial' or 'parallel'; parallel uses joblib under sklearn
HEAD_NODE_WARNING_THRESHOLD = 4      # show caution if user requests more than this many cores

# ─── STATE LIMITS ─────────────────────────────────────────────────────────────

MAX_PLOT_ROWS = 2000            # max rows sent to the browser scatter matrix; larger datasets are sampled
MAX_DATASETS = 5                # max simultaneously loaded datasets per session (LRU eviction after this)
MAX_DATASETS_MEMORY_MB = 2048   # total in-memory DataFrame budget across all datasets

MAX_PREDICTION_HISTORY = 20     # single-point prediction history entries kept in STATE
MAX_AUDIT_EVENTS = 1000         # audit log entries kept in STATE before oldest are dropped

# ─── WARNING THRESHOLDS ───────────────────────────────────────────────────────

EXTRAPOLATION_CAUTION_THRESHOLD = 1.1   # input value is 10% outside training range — show amber warning
EXTRAPOLATION_WARNING_THRESHOLD = 1.25  # input value is 25% outside training range — show red warning

R2_MINIMUM_ACCEPTABLE = 0.70    # R² below this triggers a red badge in the results panel
R2_CAUTION_THRESHOLD = 0.85     # R² below this triggers an amber badge; above is green

# ─── UI / UX ──────────────────────────────────────────────────────────────────

DEFAULT_EXPERIENCE_LEVEL = 'beginner'   # 'beginner' | 'intermediate' | 'expert'; controls feature visibility
DEFAULT_LEARNING_MODE = False           # learning mode off by default; user toggles via header button

# ─── COMPLIANCE ───────────────────────────────────────────────────────────────

DEFAULT_CLASSIFICATION = 'Unclassified'                          # applied to new sessions before user sets a label
SUPPORTED_CLASSIFICATIONS = ['Unclassified', 'CUI', 'ITAR', 'EAR']  # valid values for the classification selector

# ─── LOGGING ──────────────────────────────────────────────────────────────────

LOG_LEVEL = 'INFO'               # Python logging level; set to 'DEBUG' for verbose request/response logging
MAX_LOG_FILE_SIZE_MB = 50        # log file rotates after this size
LOG_BACKUP_COUNT = 5             # number of rotated log files to keep before deletion
AUDIT_LOG_EXPIRY_WARNING_DAYS = 7  # warn if the audit log has not been exported in this many days

# ─── REPORTING ────────────────────────────────────────────────────────────────

REPORT_FORMATS = ['PDF', 'HTML']  # supported output formats for POST /api/export/report
