"""
================================================================================
FILE: generator.py
MODULE: app/report/
PURPOSE: Collect STATE data into a flat dict for the Jinja2 report template.
         Handles missing sections gracefully — sections appear only when data
         is available.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-15
LAST MODIFIED: 2026-06-06
VERSION: 1.1.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

from datetime import datetime, timezone
from typing import Dict, List, Optional


def build_report_data(state: dict, classification: str) -> dict:
    """
    Collect all available STATE data and return a flat dict suitable for
    render_template('report/report_base.html', **data).
    """
    from config.settings import VERSION
    from app.compliance.classification import get_watermark_text, get_banner_text

    models_dict    = state.get("surrogate_sessions", {}).get("primary", {}).get("models", {})
    results        = models_dict.get("results")
    interpretation = models_dict.get("interpretation", {})
    al_history     = state.get("active_learning", {}).get("history", [])
    audit_events   = state.get("audit", {}).get("events", [])

    return {
        "tool_version":   VERSION,
        "generated_at":   datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "classification": classification,
        "watermark":      get_watermark_text(classification),
        "banner_text":    get_banner_text(classification),
        "dataset":        _build_dataset_section(state),
        "model":          _build_model_section(results),
        "sensitivity":    _build_sensitivity_section(interpretation),
        "active_learning": _build_al_section(al_history),
        "audit_events":   audit_events[-50:],
        "audit_total":    len(audit_events),
    }


# ── Section builders ──────────────────────────────────────────────────────────

def _build_dataset_section(state: dict) -> Optional[dict]:
    active_key = state["datasets"].get("active_dataset_key")
    if not active_key:
        return None
    ds = state["datasets"]["_datasets"].get(active_key)
    if not ds:
        return None
    meta = ds.get("metadata", {})
    clean_df = ds.get("clean")
    n_rows = len(clean_df) if clean_df is not None else meta.get("n_rows_original", 0)

    return {
        "filename":            meta.get("filename", "—"),
        "n_rows":              n_rows,
        "n_rows_original":     meta.get("n_rows_original", n_rows),
        "n_cols":              meta.get("n_cols", 0),
        "input_columns":       meta.get("input_columns", []),
        "output_columns":      meta.get("output_columns", []),
        "normalization_method": meta.get("normalization_method"),
        "null_counts":         {k: v for k, v in meta.get("null_counts", {}).items() if v > 0},
        "coercion_warnings":   meta.get("coercion_warnings", []),
    }


def _build_model_section(results: Optional[dict]) -> Optional[dict]:
    if not results:
        return None

    parity_charts = _build_parity_charts(results)
    cv            = results.get("cv_results", {}) or {}

    # Enrich test metrics with NRMSE (%) to match app display
    raw_metrics = results.get("test_metrics", [])
    test_metrics = []
    for m in raw_metrics:
        entry = dict(m)
        r = m.get("output_range")
        entry["nrmse_pct"] = round(m["rmse"] / r * 100, 2) if r else None
        test_metrics.append(entry)

    # Kernel length scales (GPR only)
    kls_raw = results.get("kernel_length_scales")
    kernel_length_scales = None
    if kls_raw and isinstance(kls_raw, dict):
        kernel_length_scales = kls_raw  # {output_col: {input_col: value}}

    return {
        "model_type":          results.get("model_type", "—"),
        "hyperparams":         results.get("hyperparams", {}),
        "n_train":             results.get("n_train", 0),
        "n_test":              results.get("n_test", 0),
        "test_metrics":        test_metrics,
        "cv_metrics":          cv.get("per_output", []),
        "parity_charts":       parity_charts,
        "warnings":            results.get("warnings", []),
        "kernel_length_scales": kernel_length_scales,
    }


def _build_parity_charts(results: dict) -> list:
    actuals_raw = results.get("test_actuals", [])
    preds_raw   = results.get("test_predictions", [])
    stds_raw    = results.get("test_stds")
    output_cols = results.get("output_columns", [])

    charts = []
    for i, col in enumerate(output_cols):
        try:
            actuals = [float(row[i]) if isinstance(row, list) else float(row)
                       for row in actuals_raw]
            preds   = [float(row[i]) if isinstance(row, list) else float(row)
                       for row in preds_raw]
        except (IndexError, TypeError, ValueError):
            continue

        if not actuals:
            continue

        all_vals = actuals + preds
        mn, mx   = min(all_vals), max(all_vals)
        pad      = (mx - mn) * 0.05 if mx > mn else abs(mn) * 0.05 + 0.1

        traces = [
            {
                "type": "scatter", "mode": "lines", "name": "Ideal",
                "x": [mn - pad, mx + pad], "y": [mn - pad, mx + pad],
                "line": {"color": "#94a3b8", "dash": "dot", "width": 1.5},
                "showlegend": False,
            },
            {
                "type": "scatter", "mode": "markers", "name": col,
                "x": actuals, "y": preds,
                "marker": {"color": "rgba(99,102,241,0.7)", "size": 6},
            },
        ]

        if stds_raw:
            try:
                stds = [float(row[i]) if isinstance(row, list) else float(row)
                        for row in stds_raw]
                traces[1]["error_y"] = {
                    "type": "data",
                    "array": [s * 1.96 for s in stds],
                    "symmetric": True,
                    "visible": True,
                    "color": "rgba(99,102,241,0.3)",
                    "thickness": 1.2,
                    "width": 3,
                }
            except (IndexError, TypeError, ValueError):
                pass

        layout = {
            "height": 320,
            "margin": {"t": 36, "b": 50, "l": 60, "r": 20},
            "xaxis": {"title": "Actual",    "zeroline": False, "gridcolor": "#e2e8f0"},
            "yaxis": {"title": "Predicted", "zeroline": False, "gridcolor": "#e2e8f0"},
            "title": {"text": col, "x": 0.05, "font": {"size": 13, "color": "#1e3a5f"}},
            "paper_bgcolor": "#ffffff",
            "plot_bgcolor":  "#f8fafc",
            "showlegend":    False,
        }
        charts.append({"traces": traces, "layout": layout})

    return charts


def _build_sensitivity_section(interpretation: dict) -> Optional[list]:
    if not interpretation:
        return None
    sections = []
    for output_col, payload in interpretation.items():
        sens       = payload.get("sensitivity", {})
        input_cols = payload.get("input_cols", [])
        if not sens or not input_cols:
            continue
        sorted_cols = sorted(
            input_cols,
            key=lambda c: sens.get("ST", {}).get(c, 0.0),
            reverse=True,
        )
        sections.append({
            "output_col":  output_col,
            "method":      sens.get("method", "sobol"),
            "n_evals":     sens.get("n_evaluations", 0),
            "sorted_cols": sorted_cols,
            "S1":          sens.get("S1", {}),
            "ST":          sens.get("ST", {}),
            "S1_conf":     sens.get("S1_conf", {}),
            "ST_conf":     sens.get("ST_conf", {}),
        })
    return sections or None


def _build_al_section(al_history: list) -> Optional[dict]:
    if not al_history:
        return None
    last = al_history[-1]
    ts_raw = last.get("timestamp", "")
    ts = ts_raw.replace("T", " ")[:19] + " UTC" if ts_raw else "—"
    return {
        "mode":              last.get("mode", "—"),
        "acquisition":       last.get("acquisition"),
        "direction":         last.get("direction"),
        "output_col":        last.get("output_col"),
        "timestamp":         ts,
        "n_recommendations": last.get("n_recommendations", 0),
        "input_cols":        last.get("input_cols", []),
        "recommendations":   last.get("recommendations", [])[:20],
    }
