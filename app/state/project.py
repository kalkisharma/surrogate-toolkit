"""
================================================================================
FILE: project.py
MODULE: app/state/
PURPOSE: Project save/load to disk — serialize STATE to .surrogate ZIP and
         restore it. DataFrames are stored as Parquet; model objects as Pickle.
DEPENDENCIES: io, json, pickle, zipfile, pandas, numpy, config.settings
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-14
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import io
import json
import pickle
import zipfile
from datetime import datetime, timezone

from config.settings import VERSION

_FORMAT_VERSION = "1"


# ── Public API ─────────────────────────────────────────────────────────────────

def write_project(state: dict) -> bytes:
    """
    Serialize STATE to a .surrogate ZIP file and return the raw bytes.

    ZIP contents:
        meta.json       — version, date, classification, dataset names
        state.json      — JSON-safe STATE with DataFrames/models replaced by _ref dicts
        data/<name>.parquet — DataFrames serialized as Parquet
        models/<name>.pkl   — Fitted model objects serialized with Pickle
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        meta = {
            "surrogate_version": VERSION,
            "format_version":    _FORMAT_VERSION,
            "saved_at":          datetime.now(timezone.utc).isoformat(),
            "project_name":      state["session"].get("project_name"),
            "classification":    state["compliance"]["classification"],
            "dataset_names":     list(state["datasets"]["_datasets"].keys()),
        }
        zf.writestr("meta.json", json.dumps(meta, indent=2))
        state_copy = _serialize_state(state, zf)
        zf.writestr("state.json", json.dumps(state_copy, indent=2, default=_json_default))

    buf.seek(0)
    return buf.getvalue()


def read_project(file_bytes: bytes):
    """
    Deserialize a .surrogate ZIP file.

    Returns:
        (meta: dict, state: dict) — meta has project metadata; state is a fully
        restored dict with DataFrames and model objects in the right positions.

    Raises:
        Exception if the file is corrupt or cannot be read.
    """
    buf = io.BytesIO(file_bytes)
    with zipfile.ZipFile(buf, "r") as zf:
        meta  = json.loads(zf.read("meta.json"))
        state = json.loads(zf.read("state.json"))
        _resolve_refs(state, zf)
    return meta, state


# ── Serialization ──────────────────────────────────────────────────────────────

def _serialize_state(state: dict, zf: zipfile.ZipFile) -> dict:
    out = {}
    for key in ("session", "compliance", "audit", "ui", "active_learning",
                "comparison", "predictions", "processors"):
        out[key] = _json_safe(state.get(key, {}))
    out["datasets"]           = _serialize_datasets(state["datasets"], zf)
    out["surrogate_sessions"] = _serialize_surrogate_sessions(state["surrogate_sessions"], zf)
    return out


def _serialize_datasets(datasets: dict, zf: zipfile.ZipFile) -> dict:
    out = {
        "active_dataset_key": datasets.get("active_dataset_key"),
        "secondary":          None,
        "combined":           None,
        "primary":            _serialize_df_container("primary", datasets["primary"], zf),
        "_datasets":          {},
    }
    for key, ds in datasets.get("_datasets", {}).items():
        safe = key.replace("/", "_").replace("\\", "_")
        out["_datasets"][key] = _serialize_df_container(f"ds__{safe}", ds, zf)
    return out


def _serialize_df_container(prefix: str, container: dict, zf: zipfile.ZipFile) -> dict:
    import pandas as pd
    out = {}
    for df_key in ("raw", "clean", "normalized", "reduced", "active"):
        val = container.get(df_key)
        if isinstance(val, pd.DataFrame):
            ref = f"data/{prefix}__{df_key}.csv"
            buf = io.BytesIO()
            val.to_csv(buf, index=False)
            zf.writestr(ref, buf.getvalue())
            out[df_key] = {"_ref": ref}
        else:
            out[df_key] = None
    out["filters"]       = container.get("filters", [])
    out["metadata"]      = _json_safe(container.get("metadata", {}))
    out["memory_bytes"]  = container.get("memory_bytes")
    out["last_accessed"] = container.get("last_accessed")
    ss = container.get("surrogate_session")
    if ss:
        out["surrogate_session"] = _serialize_ss_models(f"stash__{prefix}", ss, zf)
    return out


def _serialize_surrogate_sessions(ss_root: dict, zf: zipfile.ZipFile) -> dict:
    primary = ss_root.get("primary") or {}
    return {
        "primary":    _serialize_ss_models("primary", primary, zf),
        "secondary":  None,
        "correction": None,
    }


def _serialize_ss_models(prefix: str, ss: dict, zf: zipfile.ZipFile) -> dict:
    if not ss:
        return {}
    out = {
        "session_id":  ss.get("session_id"),
        "dataset_ref": ss.get("dataset_ref"),
        "config":      _json_safe(ss.get("config", {})),
        "models":      {},
    }
    for key, val in ss.get("models", {}).items():
        if key == "trained" and val is not None:
            ref = f"models/{prefix}__trained.pkl"
            zf.writestr(ref, pickle.dumps(val, protocol=4))
            out["models"]["trained"] = {"_ref": ref}
        else:
            out["models"][key] = _json_safe(val)
    return out


def _json_safe(obj):
    import pandas as pd
    if obj is None:
        return None
    if isinstance(obj, pd.DataFrame):
        return None
    if hasattr(obj, "get_summary") and callable(getattr(obj, "get_summary")):
        return obj.get_summary()
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_safe(i) for i in obj]
    return obj


def _json_default(obj):
    import numpy as np
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


# ── Deserialization ────────────────────────────────────────────────────────────

def _resolve_refs(obj, zf: zipfile.ZipFile):
    """Walk obj in-place, replacing {"_ref": "path"} dicts with real objects."""
    import pandas as pd
    if isinstance(obj, dict):
        for key in list(obj.keys()):
            val = obj[key]
            if isinstance(val, dict) and list(val.keys()) == ["_ref"]:
                ref = val["_ref"]
                try:
                    raw = zf.read(ref)
                    if ref.endswith(".csv"):
                        obj[key] = pd.read_csv(io.BytesIO(raw))
                    elif ref.endswith(".pkl"):
                        obj[key] = pickle.loads(raw)
                except (KeyError, Exception):
                    obj[key] = None
            else:
                _resolve_refs(val, zf)
    elif isinstance(obj, list):
        for item in obj:
            _resolve_refs(item, zf)
