"""
================================================================================
FILE: learning_api.py
MODULE: app/api/
PURPOSE: Blueprint for /api/learning/* — serves static learning content from
         app/learning/*.json and app/learning/decision_trees/*.json.
         Exercise endpoints also inject synthetic datasets and track progress
         in STATE.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-19
LAST MODIFIED: 2026-05-26
VERSION: 3.1.1
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import json
import os
from datetime import datetime, timezone

import numpy as np
from flask import Blueprint, current_app, jsonify, request
from werkzeug.utils import secure_filename

from app.data.ingestion import ingest_csv
from app.state.schema import append_audit_event
from config.settings import DEFAULT_CV_FOLDS, DEFAULT_TEST_SPLIT

bp = Blueprint("learning", __name__)

_LEARNING_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "learning")
_EXERCISES_DIR = os.path.join(_LEARNING_DIR, "exercises")
_DATASETS_DIR  = os.path.join(_LEARNING_DIR, "datasets")

_TOPIC_FILES = {
    "diagnostics":          "diagnostics.json",
    "uncertainty":          "uncertainty.json",
    "cv_strategies":        "cv_strategies.json",
    "sensitivity":          "sensitivity.json",
    "active_learning":      "active_learning.json",
    "data_cleaning":        "data_cleaning.json",
    "input_filtering":      "input_filtering.json",
    "multifidelity":        "multifidelity.json",
    "model_troubleshooting": "model_troubleshooting.json",
}

_GUIDE_FILES = {
    "model_selection": os.path.join("decision_trees", "model_selection.json"),
    "cv_selection":    os.path.join("decision_trees", "cv_selection.json"),
}


def _load_json(rel_path: str):
    abs_path = os.path.normpath(os.path.join(_LEARNING_DIR, rel_path))
    with open(abs_path, "r", encoding="utf-8") as f:
        return json.load(f)


@bp.route("/glossary", methods=["GET"])
def glossary():
    """Return all glossary terms."""
    data = _load_json("glossary.json")
    return jsonify({"success": True, **data}), 200


@bp.route("/models", methods=["GET"])
def models():
    """Return model guide entries."""
    data = _load_json("models.json")
    return jsonify({"success": True, **data}), 200


@bp.route("/content/<topic>", methods=["GET"])
def content(topic: str):
    """Return sections for a named topic."""
    if topic not in _TOPIC_FILES:
        return jsonify({
            "success": False,
            "error_code": "UNKNOWN_TOPIC",
            "message": f"Unknown topic '{topic}'. Valid topics: {sorted(_TOPIC_FILES.keys())}",
        }), 404
    data = _load_json(_TOPIC_FILES[topic])
    return jsonify({"success": True, "topic": topic, **data}), 200


@bp.route("/guide/<path:guide_name>", methods=["GET"])
def guide(guide_name: str):
    """Return decision-tree nodes for a named guide."""
    if guide_name not in _GUIDE_FILES:
        return jsonify({
            "success": False,
            "error_code": "UNKNOWN_GUIDE",
            "message": f"Unknown guide '{guide_name}'. Valid guides: {sorted(_GUIDE_FILES.keys())}",
        }), 404
    data = _load_json(_GUIDE_FILES[guide_name])
    return jsonify({"success": True, "guide": guide_name, **data}), 200


# ─── EXERCISE HELPERS ─────────────────────────────────────────────────────────

def _load_exercise(exercise_id: str) -> dict:
    """Load exercise JSON by id. Raises FileNotFoundError if not found."""
    safe_id = secure_filename(exercise_id)
    path = os.path.join(_EXERCISES_DIR, f"{safe_id}.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _list_exercises() -> list:
    """Return all exercise JSON objects sorted by id."""
    exercises = []
    if not os.path.isdir(_EXERCISES_DIR):
        return exercises
    for fname in sorted(os.listdir(_EXERCISES_DIR)):
        if fname.endswith(".json"):
            try:
                with open(os.path.join(_EXERCISES_DIR, fname), "r", encoding="utf-8") as f:
                    exercises.append(json.load(f))
            except Exception:
                pass
    return exercises


# ─── EXERCISE ROUTES ──────────────────────────────────────────────────────────


@bp.route("/exercises", methods=["GET"])
def list_exercises():
    """Return all exercises with metadata and the current session's progress."""
    state = current_app.config["STATE"]
    progress = state["session"].get("exercise_progress", {})
    exercises = _list_exercises()
    summaries = []
    for ex in exercises:
        ex_id = ex["id"]
        prog = progress.get(ex_id, {})
        steps_total = len(ex.get("steps", []))
        steps_done = len(prog.get("steps_completed", []))
        summaries.append({
            "id":                ex_id,
            "title":             ex["title"],
            "difficulty":        ex["difficulty"],
            "estimated_minutes": ex["estimated_minutes"],
            "description":       ex.get("description", ""),
            "tags":              ex.get("tags", []),
            "dataset":           ex["dataset"],
            "steps_total":       steps_total,
            "steps_completed":   steps_done,
            "status": (
                "complete"    if steps_done >= steps_total and steps_total > 0
                else "in_progress" if steps_done > 0
                else "not_started"
            ),
            "started_at":    prog.get("started_at"),
            "completed_at":  prog.get("completed_at"),
        })
    return jsonify({"success": True, "exercises": summaries}), 200


@bp.route("/exercises/<exercise_id>", methods=["GET"])
def get_exercise(exercise_id: str):
    """Return a full exercise definition (steps + quizzes)."""
    try:
        ex = _load_exercise(exercise_id)
    except FileNotFoundError:
        return jsonify({
            "success": False,
            "error_code": "UNKNOWN_EXERCISE",
            "message": f"Exercise '{exercise_id}' not found.",
        }), 404
    state    = current_app.config["STATE"]
    progress = state["session"].get("exercise_progress", {}).get(exercise_id, {})
    return jsonify({"success": True, "exercise": ex, "progress": progress}), 200


@bp.route("/exercises/<exercise_id>/start", methods=["POST"])
def start_exercise(exercise_id: str):
    """
    Inject the exercise's synthetic dataset into STATE via the normal ingestion
    pipeline. Returns the same upload-metadata envelope as POST /api/data/upload.
    """
    try:
        ex = _load_exercise(exercise_id)
    except FileNotFoundError:
        return jsonify({
            "success": False,
            "error_code": "UNKNOWN_EXERCISE",
            "message": f"Exercise '{exercise_id}' not found.",
        }), 404

    dataset_name = ex["dataset"]
    dataset_path = os.path.join(_DATASETS_DIR, dataset_name)
    if not os.path.isfile(dataset_path):
        return jsonify({
            "success": False,
            "error_code": "DATASET_MISSING",
            "message": f"Exercise dataset '{dataset_name}' not found on server.",
        }), 500

    # Ingest using the standard pipeline
    with open(dataset_path, "rb") as f:
        df, result = ingest_csv(f, dataset_name)

    if not result["success"]:
        return jsonify(result), 400

    # Mirror into STATE (same logic as data_api.upload)
    state   = current_app.config["STATE"]
    meta    = result["metadata"]
    now_ts  = datetime.now(timezone.utc).isoformat()
    mem_bytes = int(df.memory_usage(deep=True).sum())

    missing_data_report = {
        col: {
            "count": meta["null_counts"][col],
            "ratio": round(meta["null_counts"][col] / meta["n_rows_original"], 4),
        }
        for col in meta["columns"]
        if meta["null_counts"][col] > 0
    }

    ds_meta = {
        "filename":            meta["filename"],
        "upload_timestamp":    meta["upload_timestamp"],
        "n_rows_original":     meta["n_rows_original"],
        "n_cols":              meta["n_cols"],
        "columns":             meta["columns"],
        "dtypes":              meta["dtypes"],
        "null_counts":         meta["null_counts"],
        "coercion_warnings":   meta["coercion_warnings"],
        "missing_data_report": missing_data_report,
        "data_type":           None,
        "preview_rows":        _numpy_to_python(df.head(10).where(df.head(10).notna(), other=None).to_dict(orient="records")),
        "summary_stats":       _build_summary_stats(df),
    }

    _datasets = state["datasets"]["_datasets"]

    # Save current surrogate session before switching
    prev_key = state["datasets"].get("active_dataset_key")
    if prev_key and prev_key in _datasets and prev_key != dataset_name:
        _datasets[prev_key]["surrogate_session"] = {
            "models": state["surrogate_sessions"]["primary"]["models"],
            "config": {**state["surrogate_sessions"]["primary"]["config"]},
        }

    ds_entry = {
        "raw":           df.copy(),
        "clean":         df.copy(),
        "metadata":      ds_meta,
        "memory_bytes":  mem_bytes,
        "last_accessed": now_ts,
        "surrogate_session": {
            "models": {},
            "config": {
                "model_type": None,
                "test_split": DEFAULT_TEST_SPLIT,
                "cv_folds":   DEFAULT_CV_FOLDS,
            },
        },
    }
    _datasets[dataset_name] = ds_entry
    state["datasets"]["active_dataset_key"] = dataset_name

    primary = state["datasets"]["primary"]
    primary["raw"]   = ds_entry["raw"]
    primary["clean"] = ds_entry["clean"]
    primary["metadata"].update(ds_meta)

    # Reset surrogate session for fresh start
    state["surrogate_sessions"]["primary"]["models"] = {}
    state["surrogate_sessions"]["primary"]["config"] = {
        "model_type": None,
        "test_split": DEFAULT_TEST_SPLIT,
        "cv_folds":   DEFAULT_CV_FOLDS,
        "hyperparams": {},
    }

    # Record exercise start in progress
    progress = state["session"].setdefault("exercise_progress", {})
    if exercise_id not in progress:
        progress[exercise_id] = {
            "steps_completed": [],
            "quiz_answers":    {},
            "started_at":      now_ts,
            "completed_at":    None,
        }

    # Load secondary datasets (for multi-dataset exercises like multi-fidelity)
    secondary_names = [d for d in ex.get("datasets", []) if d != dataset_name]
    for sec_name in secondary_names:
        sec_path = os.path.join(_DATASETS_DIR, sec_name)
        if not os.path.isfile(sec_path):
            continue  # skip silently — primary is already loaded
        with open(sec_path, "rb") as f:
            sec_df, sec_result = ingest_csv(f, sec_name)
        if not sec_result["success"]:
            continue
        sec_meta  = sec_result["metadata"]
        sec_bytes = int(sec_df.memory_usage(deep=True).sum())
        sec_missing = {
            col: {"count": sec_meta["null_counts"][col],
                  "ratio": round(sec_meta["null_counts"][col] / sec_meta["n_rows_original"], 4)}
            for col in sec_meta["columns"] if sec_meta["null_counts"][col] > 0
        }
        _datasets[sec_name] = {
            "raw":           sec_df.copy(),
            "clean":         sec_df.copy(),
            "metadata":      {
                "filename":            sec_meta["filename"],
                "upload_timestamp":    sec_meta["upload_timestamp"],
                "n_rows_original":     sec_meta["n_rows_original"],
                "n_cols":              sec_meta["n_cols"],
                "columns":             sec_meta["columns"],
                "dtypes":              sec_meta["dtypes"],
                "null_counts":         sec_meta["null_counts"],
                "coercion_warnings":   sec_meta["coercion_warnings"],
                "missing_data_report": sec_missing,
                "data_type":           None,
                "preview_rows":        _numpy_to_python(sec_df.head(10).where(sec_df.head(10).notna(), other=None).to_dict(orient="records")),
                "summary_stats":       _build_summary_stats(sec_df),
            },
            "memory_bytes":  sec_bytes,
            "last_accessed": now_ts,
            "surrogate_session": {
                "models": {},
                "config": {
                    "model_type": None,
                    "test_split": DEFAULT_TEST_SPLIT,
                    "cv_folds":   DEFAULT_CV_FOLDS,
                },
            },
        }

    append_audit_event(state, "exercise_started", {
        "exercise_id":       exercise_id,
        "dataset":           dataset_name,
        "secondary_datasets": secondary_names,
    })

    return jsonify({
        "success":     True,
        "message":     f"Exercise dataset '{dataset_name}' loaded. "
                       f"{meta['n_rows_original']:,} rows × {meta['n_cols']} columns.",
        "dataset_key": dataset_name,
        "metadata": {
            "filename":             meta["filename"],
            "n_rows":               meta["n_rows_original"],
            "n_cols":               meta["n_cols"],
            "columns":              meta["columns"],
            "dtypes":               meta["dtypes"],
            "null_counts":          meta["null_counts"],
            "coercion_warnings":    meta["coercion_warnings"],
            "upload_timestamp":     meta["upload_timestamp"],
            "input_columns":        [],
            "output_columns":       [],
            "normalization_method": None,
        },
        "preview": {
            "columns":    meta["columns"],
            "rows":       ds_meta["preview_rows"],
            "total_rows": meta["n_rows_original"],
        },
    }), 200


@bp.route("/exercises/progress", methods=["POST"])
def update_progress():
    """
    Record a completed step and/or a quiz answer in STATE.

    Body JSON:
        exercise_id   (str, required)
        step_num      (int, required)
        quiz_answer   (int, optional) — index of chosen option
    """
    data        = request.get_json(silent=True) or {}
    exercise_id = data.get("exercise_id")
    step_num    = data.get("step_num")

    if not exercise_id or step_num is None:
        return jsonify({
            "success": False,
            "error_code": "MISSING_FIELDS",
            "message": "exercise_id and step_num are required.",
        }), 400

    state    = current_app.config["STATE"]
    progress = state["session"].setdefault("exercise_progress", {})
    entry    = progress.setdefault(exercise_id, {
        "steps_completed": [],
        "quiz_answers":    {},
        "started_at":      datetime.now(timezone.utc).isoformat(),
        "completed_at":    None,
    })

    if step_num not in entry["steps_completed"]:
        entry["steps_completed"].append(step_num)

    if "quiz_answer" in data and data["quiz_answer"] is not None:
        entry["quiz_answers"][str(step_num)] = int(data["quiz_answer"])

    # Check completion
    try:
        ex = _load_exercise(exercise_id)
        total_steps = len(ex.get("steps", []))
        if len(entry["steps_completed"]) >= total_steps and not entry.get("completed_at"):
            entry["completed_at"] = datetime.now(timezone.utc).isoformat()
    except FileNotFoundError:
        pass

    return jsonify({"success": True, "progress": entry}), 200


# ─── SERIALISATION HELPERS ────────────────────────────────────────────────────

def _numpy_to_python(obj):
    """Recursively convert NumPy scalars / native NaN to JSON-safe Python types."""
    if isinstance(obj, list):
        return [_numpy_to_python(i) for i in obj]
    if isinstance(obj, dict):
        return {k: _numpy_to_python(v) for k, v in obj.items()}
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return None if np.isnan(obj) else float(obj)
    if isinstance(obj, float) and (obj != obj):   # catches Python native float('nan')
        return None
    return obj


def _to_python(val):
    if val is None:
        return None
    if isinstance(val, (np.integer,)):
        return int(val)
    if isinstance(val, (np.floating,)):
        return None if np.isnan(val) else float(val)
    if isinstance(val, float) and (val != val):   # catches Python native float('nan')
        return None
    return val


def _build_summary_stats(df) -> dict:
    stats = {}
    for col in df.columns:
        series = df[col].dropna()
        stats[col] = {
            "min":        _to_python(series.min())    if len(series) else None,
            "max":        _to_python(series.max())    if len(series) else None,
            "mean":       _to_python(series.mean())   if len(series) else None,
            "std":        _to_python(series.std())    if len(series) else None,
            "median":     _to_python(series.median()) if len(series) else None,
            "null_count": int(df[col].isnull().sum()),
            "skew":       _to_python(series.skew())   if len(series) >= 3 else None,
        }
    return stats
