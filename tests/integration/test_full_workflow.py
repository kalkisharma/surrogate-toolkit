"""
================================================================================
FILE: test_full_workflow.py
MODULE: tests/integration/
PURPOSE: End-to-end integration tests covering the full surrogate modeling
         pipeline: upload → designate → configure → train → results.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-12
VERSION: 0.7.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import io
import json

import pytest


# ─── HELPERS ──────────────────────────────────────────────────────────────────


def _upload(client, csv_bytes, filename="test.csv"):
    return client.post(
        "/api/data/upload",
        data={"file": (io.BytesIO(csv_bytes), filename)},
        content_type="multipart/form-data",
    )


def _designate(client, inputs, outputs):
    return client.post(
        "/api/data/designate",
        data=json.dumps({"input_columns": inputs, "output_columns": outputs}),
        content_type="application/json",
    )


def _configure(client, model_type, test_split=0.2, cv_folds=3):
    return client.post(
        "/api/model/configure",
        data=json.dumps({"model_type": model_type, "test_split": test_split, "cv_folds": cv_folds}),
        content_type="application/json",
    )


def _train(client):
    return client.post(
        "/api/model/train",
        data=json.dumps({}),
        content_type="application/json",
    )


# ─── FULL WORKFLOW ────────────────────────────────────────────────────────────


def test_full_pipeline_linear(client, csv_clean):
    """
    Full end-to-end pipeline with a Linear model on a 500-row dataset.

    Steps:
        1. Upload sample_clean.csv
        2. Designate 6 inputs and 2 outputs
        3. Configure training (linear, 20% test split, 3-fold CV)
        4. Train the model
        5. Verify results structure and metric keys
        6. Verify GET /api/model/results returns the stored results
        7. Verify GET /api/state/ does not crash (model object serialised safely)
    """
    # ── Step 1: Upload ────────────────────────────────────────────────────────
    upload_resp = _upload(client, csv_clean, "sample_clean.csv")
    assert upload_resp.status_code == 200
    upload_data = json.loads(upload_resp.data)
    assert upload_data["success"] is True
    assert upload_data["preview"]["total_rows"] == 500

    # ── Step 2: Designate ─────────────────────────────────────────────────────
    input_cols  = ["mach", "alpha", "beta", "altitude_ft", "q_bar", "reynolds"]
    output_cols = ["cl", "cd"]
    des_resp = _designate(client, input_cols, output_cols)
    assert des_resp.status_code == 200
    assert json.loads(des_resp.data)["success"] is True

    # ── Step 3: Configure ─────────────────────────────────────────────────────
    cfg_resp = _configure(client, "linear", test_split=0.2, cv_folds=3)
    assert cfg_resp.status_code == 200
    assert json.loads(cfg_resp.data)["config"]["model_type"] == "linear"

    # ── Step 4: Train ─────────────────────────────────────────────────────────
    train_resp = _train(client)
    assert train_resp.status_code == 200
    results = json.loads(train_resp.data)["results"]

    # ── Step 5: Verify results structure ──────────────────────────────────────
    assert results["model_type"] == "linear"
    assert results["n_train"] + results["n_test"] == 500
    assert results["input_columns"] == input_cols
    assert results["output_columns"] == output_cols

    # Test metrics: one entry per output column
    assert len(results["test_metrics"]) == 2
    for m in results["test_metrics"]:
        assert m["column"] in output_cols
        assert isinstance(m["r2"], float)
        assert isinstance(m["rmse"], float)
        assert isinstance(m["mae"], float)

    # CV results: n_folds and per_output entries
    cv = results["cv_results"]
    assert cv["n_folds"] == 3
    assert len(cv["per_output"]) == 2
    for po in cv["per_output"]:
        assert po["column"] in output_cols
        assert "mean_r2" in po
        assert "std_r2" in po
        assert "mean_rmse" in po

    # ── Step 6: GET /api/model/results ────────────────────────────────────────
    get_resp = client.get("/api/model/results")
    assert get_resp.status_code == 200
    stored = json.loads(get_resp.data)["results"]
    assert stored["model_type"] == "linear"

    # ── Step 7: STATE endpoint safe ───────────────────────────────────────────
    state_resp = client.get("/api/state/")
    assert state_resp.status_code == 200
    state = json.loads(state_resp.data)["state"]
    # Model object must have been serialised as a summary dict, not a raw object
    trained = state["surrogate_sessions"]["primary"]["models"].get("trained")
    assert trained is not None
    assert trained["_type"] == "model"
    assert trained["is_fitted"] is True


def test_full_pipeline_rf(client, csv_edge):
    """
    Full end-to-end pipeline with a Random Forest model on the minimal fixture.

    Uses sample_edge.csv (10 rows, single input/output) to keep test fast.
    Verifies that RF trains and returns valid results without error.
    """
    _upload(client, csv_edge, "sample_edge.csv")
    _designate(client, ["input_x"], ["output_y"])
    _configure(client, "rf", test_split=0.2, cv_folds=2)
    resp = _train(client)

    assert resp.status_code == 200
    results = json.loads(resp.data)["results"]
    assert results["model_type"] == "rf"
    assert len(results["test_metrics"]) == 1
    assert results["test_metrics"][0]["column"] == "output_y"


def test_pipeline_train_uses_normalized_data_when_available(client, csv_edge):
    """
    If normalization has been applied, training should use the normalised data.

    After normalising with min-max, the clean and normalised DataFrames are
    different. Verify that /api/model/train succeeds (the endpoint selects
    normalised over clean when both exist).
    """
    _upload(client, csv_edge, "sample_edge.csv")
    _designate(client, ["input_x"], ["output_y"])

    # Apply min-max normalisation
    norm_resp = client.post(
        "/api/data/normalize",
        data=json.dumps({"method": "minmax"}),
        content_type="application/json",
    )
    assert norm_resp.status_code == 200

    _configure(client, "linear", test_split=0.2, cv_folds=2)
    train_resp = _train(client)
    assert train_resp.status_code == 200
    assert json.loads(train_resp.data)["results"]["model_type"] == "linear"
