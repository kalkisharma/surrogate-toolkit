"""
================================================================================
FILE: schema.py
MODULE: app/state/
PURPOSE: Defines the canonical STATE dict shape and helpers to reset, read, and
         serialize it. STATE is the single source of truth for all session data.
DEPENDENCIES: config.settings, copy, pandas (for JSON-safe serialization only)
FUTURE EXTENSIONS: Persistent STATE (Redis or SQLite), per-user STATE isolation,
                   STATE diff/patch for undo support.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-12
VERSION: 0.7.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import copy
from datetime import datetime, timezone

from config.settings import (
    DEFAULT_CLASSIFICATION,
    DEFAULT_CV_FOLDS,
    DEFAULT_EXPERIENCE_LEVEL,
    DEFAULT_LEARNING_MODE,
    DEFAULT_PROCESSOR_MODE,
    DEFAULT_TEST_SPLIT,
    MAX_AUDIT_EVENTS,
)

# ─── CANONICAL TEMPLATE ────────────────────────────────────────────────────────
# This dict defines the shape and defaults for every key in STATE.
# NEVER read from _CANONICAL_STATE directly in application code — use get_state().
# NEVER add DataFrames or non-serializable objects here.

_CANONICAL_STATE = {
    "session": {
        "id": None,
        "created": None,
        "last_modified": None,
        "project_name": None,
        "program": None,
        "classification": DEFAULT_CLASSIFICATION,
        "processor_mode": DEFAULT_PROCESSOR_MODE,
        "processor_count": 1,
        "max_processors": None,
        "learning_mode": DEFAULT_LEARNING_MODE,
        "experience_level": DEFAULT_EXPERIENCE_LEVEL,
        "data_type": None,
        "warnings": [],
    },
    "datasets": {
        "primary": {
            # raw MUST NOT be mutated after import — all processing writes to clean.
            "raw": None,
            "clean": None,
            "normalized": None,
            "reduced": None,
            "active": None,
            "filters": [],
            "metadata": {
                "filename": None,
                "upload_timestamp": None,
                "source": None,
                "classification": None,
                "program": None,
                "n_rows_original": None,
                "n_rows_clean": None,
                "n_rows_excluded": None,
                "excluded_rows": [],
                "excluded_rows_reasons": [],
                "n_inputs": None,
                "n_outputs": None,
                "input_columns": [],
                "output_columns": [],
                "removed_inputs": [],
                "normalization_method": None,
                "normalization_params": {},
                "dimensionality_reduction": None,
                "correlation_warnings": [],
                "missing_data_report": {},
                "data_type": None,
                "repeated_cases": [],
                "variability_estimate": None,
                # Extended by ingestion.py:
                "n_cols": None,
                "dtypes": {},
                "null_counts": {},
                "coercion_warnings": [],
            },
        },
        # Accumulator for all loaded datasets. Each entry:
        # { raw, clean, metadata, memory_bytes, last_accessed }
        "_datasets": {},
        "active_dataset_key": None,
        "secondary": None,
        "combined": None,
    },
    "surrogate_sessions": {
        "primary": {
            "session_id": None,
            "dataset_ref": "primary",
            "config": {
                "model_type": None,
                "test_split": DEFAULT_TEST_SPLIT,
                "cv_folds":   DEFAULT_CV_FOLDS,
            },
            "models": {},
        },
        "secondary": None,
        "correction": None,
    },
    "active_learning": {
        "mode": None,
        "coverage": {
            "recommendations": None,
            "uncertainty_map": None,
            "computed_timestamp": None,
        },
        "objective": {
            "recommendations": None,
            "objective_definition": {},
            "pareto_front": None,
            "computed_timestamp": None,
        },
        "history": [],
    },
    "comparison": {
        "primary_ref": "primary",
        "secondary_ref": "secondary",
        "error_model": {
            "session_id": None,
            "model_object": None,
            "metrics": {},
            "uncertainty_map": None,
        },
        "comparison_statistics": {},
        "comparison_plots": {},
        "bias_analysis": {},
    },
    "predictions": {
        "single": {
            "history": [],
            "last_prediction": None,
        },
        "batch": {
            "input_data": None,
            "results": None,
            "validation_mode": False,
            "validation_results": None,
            "timestamp": None,
        },
    },
    "processors": {
        "available": None,
        "allocated": 1,
        "mode": DEFAULT_PROCESSOR_MODE,
        "locked": False,
        "current_task": None,
        "head_node_warning_shown": False,
    },
    "compliance": {
        "classification": DEFAULT_CLASSIFICATION,
        "program": None,
        "data_type": None,
        "export_log": [],
        "classification_confirmed": False,
        "session_warnings": [],
    },
    "audit": {
        "events": [],
    },
    "ui": {
        "active_tab": None,
        "learning_mode": DEFAULT_LEARNING_MODE,
        "experience_level": DEFAULT_EXPERIENCE_LEVEL,
        "side_panel_open": False,
        "active_warnings": [],
        "notification_queue": [],
    },
}

# ─── LIVE STATE ────────────────────────────────────────────────────────────────
# Application code accesses STATE via get_state(). app/__init__.py stores the
# reference in app.config['STATE'] so blueprints can reach it without importing
# this module directly (avoids circular imports).

STATE = copy.deepcopy(_CANONICAL_STATE)


# ─── HELPERS ──────────────────────────────────────────────────────────────────

def append_audit_event(state: dict, event_type: str, detail: dict) -> None:
    """Append a timestamped audit event to state["audit"]["events"], capped at MAX_AUDIT_EVENTS."""
    events = state["audit"]["events"]
    events.append({
        "timestamp":  datetime.now(timezone.utc).isoformat(),
        "event_type": event_type,
        "detail":     detail,
    })
    while len(events) > MAX_AUDIT_EVENTS:
        events.pop(0)


def reset_state() -> None:
    """
    Resets the live STATE dict to canonical defaults in-place.

    Uses clear() + update() to preserve the object identity of STATE so that
    any existing references (e.g. app.config['STATE']) remain valid.

    Args:
        None

    Returns:
        None

    Raises:
        Nothing — this function is always safe to call.

    Notes:
        All DataFrames stored in STATE (raw, clean, etc.) are dropped when this
        is called. Callers are responsible for releasing references before calling
        if memory matters.

    Future:
        Snapshot STATE before reset and store as undo history.
    """
    STATE.clear()
    STATE.update(copy.deepcopy(_CANONICAL_STATE))


def get_state() -> dict:
    """
    Returns a reference to the live STATE dict.

    Args:
        None

    Returns:
        dict: The live STATE dict. Do NOT store this reference — always call
              get_state() to ensure you have the current object after a reset.

    Raises:
        Nothing.

    Notes:
        The returned dict is mutable. Callers should write directly to keys
        rather than replacing the dict itself.

    Future:
        Return a read-only proxy in debug mode to catch accidental mutations.
    """
    return STATE


def get_state_json_safe() -> dict:
    """
    Returns a JSON-serializable copy of STATE with DataFrames replaced by
    lightweight metadata dicts.

    Used by the /api/state/ endpoint so the frontend can inspect STATE without
    needing to serialize DataFrames.

    Args:
        None

    Returns:
        dict: A deep copy of STATE with all pd.DataFrame values replaced by
              {"_type": "dataframe", "shape": [n_rows, n_cols], "columns": [...]}.

    Raises:
        Nothing.

    Future:
        Include column dtype info and sample row count in the replacement dict.
    """
    import pandas as pd

    def _safe(obj):
        if isinstance(obj, pd.DataFrame):
            return {
                "_type": "dataframe",
                "shape": list(obj.shape),
                "columns": list(obj.columns),
            }
        # Model objects: duck-type on get_summary() to avoid importing sklearn
        # here. BaseSurrogateModel subclasses implement get_summary() and return
        # a JSON-serializable dict.
        if hasattr(obj, "get_summary") and callable(getattr(obj, "get_summary")):
            return obj.get_summary()
        if isinstance(obj, dict):
            return {k: _safe(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_safe(i) for i in obj]
        return obj

    # Walk STATE directly rather than deep-copying first: deep-copying a fitted
    # Random Forest (100 trees) is expensive and the copy is discarded immediately.
    # _safe builds a brand-new dict/list structure at every level so the returned
    # dict is fully independent of the live STATE.
    return _safe(STATE)
