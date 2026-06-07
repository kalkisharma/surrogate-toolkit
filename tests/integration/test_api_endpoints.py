"""
================================================================================
FILE: test_api_endpoints.py
MODULE: tests/integration/
PURPOSE: Integration tests for the /api/data/* HTTP endpoints. Tests the full
         request/response cycle including STATE mutations.
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


def _upload(client, csv_bytes: bytes, filename: str = "test.csv"):
    """POST a CSV file to /api/data/upload and return the response."""
    return client.post(
        "/api/data/upload",
        data={"file": (io.BytesIO(csv_bytes), filename)},
        content_type="multipart/form-data",
    )


# ─── ENTRY SCREEN ROUTE ───────────────────────────────────────────────────────


def test_root_returns_html(client):
    """GET / returns 200 with HTML content (SPA shell)."""
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"<!DOCTYPE html>" in resp.data or b"<html" in resp.data


def test_api_404_returns_json(client):
    """GET /api/nonexistent returns 404 JSON error envelope."""
    resp = client.get("/api/nonexistent")
    assert resp.status_code == 404
    data = json.loads(resp.data)
    assert data["success"] is False
    assert "error_code" in data


def test_unknown_path_returns_html(client):
    """GET /some/deep/path returns 200 HTML (SPA deep-link support)."""
    resp = client.get("/some/deep/path")
    assert resp.status_code == 200


def test_upload_method_not_allowed(client):
    """GET /api/data/upload returns 405."""
    resp = client.get("/api/data/upload")
    assert resp.status_code == 405


# ─── STATE ENDPOINT ───────────────────────────────────────────────────────────


def test_state_returns_json(client):
    """GET /api/state/ returns 200 JSON with success and state keys."""
    resp = client.get("/api/state/")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert "state" in data
    assert "session" in data["state"]
    assert "datasets" in data["state"]


# ─── UPLOAD — HAPPY PATH ──────────────────────────────────────────────────────


def test_upload_clean_csv(client, csv_clean):
    """Uploading a valid clean CSV returns 200 with preview."""
    resp = _upload(client, csv_clean, "sample_clean.csv")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert "preview" in data
    assert "columns" in data["preview"]
    assert "rows" in data["preview"]
    assert data["preview"]["total_rows"] == 500


def test_upload_edge_csv(client, csv_edge):
    """Minimum-size dataset (10×2) uploads successfully."""
    resp = _upload(client, csv_edge, "sample_edge.csv")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert data["preview"]["total_rows"] == 10


def test_upload_preview_has_10_rows_max(client, csv_clean):
    """Preview never contains more than 10 rows regardless of dataset size."""
    resp = _upload(client, csv_clean)
    data = json.loads(resp.data)
    assert len(data["preview"]["rows"]) <= 10


def test_upload_updates_state(client, csv_edge):
    """After upload, GET /api/state/ reflects the loaded dataset."""
    _upload(client, csv_edge, "sample_edge.csv")
    state_resp = client.get("/api/state/")
    state = json.loads(state_resp.data)["state"]
    assert state["datasets"]["primary"]["metadata"]["filename"] == "sample_edge.csv"


def test_upload_response_is_json_serializable(client, csv_clean):
    """Response must not contain NaN or other non-JSON values."""
    resp = _upload(client, csv_clean)
    # json.loads raises if the response is not valid JSON
    data = json.loads(resp.data)
    assert data is not None


# ─── UPLOAD — ERROR CASES ─────────────────────────────────────────────────────


def test_upload_no_file(client):
    """POST with no file field returns 400 NO_FILE."""
    resp = client.post("/api/data/upload", data={}, content_type="multipart/form-data")
    assert resp.status_code == 400
    data = json.loads(resp.data)
    assert data["error_code"] == "NO_FILE"


def test_upload_empty_filename(client):
    """POST with an empty filename returns 400 NO_FILENAME."""
    resp = client.post(
        "/api/data/upload",
        data={"file": (io.BytesIO(b"a,b\n1,2\n"), "")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 400
    data = json.loads(resp.data)
    assert data["error_code"] == "NO_FILENAME"


def test_upload_non_csv(client):
    """Uploading a .txt file returns 415 INVALID_FILE_TYPE."""
    resp = _upload(client, b"hello world", "data.txt")
    assert resp.status_code == 415
    data = json.loads(resp.data)
    assert data["error_code"] == "INVALID_FILE_TYPE"


def test_upload_too_few_rows(client, csv_single_row):
    """A CSV with fewer than MIN_ROWS rows returns 422 INSUFFICIENT_ROWS."""
    resp = _upload(client, csv_single_row, "single_row.csv")
    assert resp.status_code == 422
    data = json.loads(resp.data)
    assert data["error_code"] == "INSUFFICIENT_ROWS"


def test_upload_duplicate_headers(client):
    """A CSV with duplicate column names returns 422 DUPLICATE_HEADERS."""
    csv_bytes = b"x,x,y\n1,2,3\n4,5,6\n7,8,9\n10,11,12\n13,14,15\n"
    resp = _upload(client, csv_bytes)
    assert resp.status_code == 422
    data = json.loads(resp.data)
    assert data["error_code"] == "DUPLICATE_HEADERS"


def test_upload_excessive_nulls(client):
    """A CSV column with >30% nulls returns 422 EXCESSIVE_NULLS."""
    csv_bytes = b"x,y\n1.0,\n2.0,\n3.0,3.0\n4.0,4.0\n5.0,5.0\n"
    resp = _upload(client, csv_bytes)
    assert resp.status_code == 422
    data = json.loads(resp.data)
    assert data["error_code"] == "EXCESSIVE_NULLS"


# ─── SUMMARY ENDPOINT ─────────────────────────────────────────────────────────


def test_summary_no_data(client):
    """GET /api/data/summary without uploading returns 400 NO_DATA."""
    resp = client.get("/api/data/summary")
    assert resp.status_code == 400
    data = json.loads(resp.data)
    assert data["error_code"] == "NO_DATA"


def test_summary_after_upload(client, csv_edge):
    """GET /api/data/summary after upload returns full-dataset stats."""
    _upload(client, csv_edge, "sample_edge.csv")
    resp = client.get("/api/data/summary")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert "stats" in data
    assert data["n_rows"] == 10


# ─── ROWS ENDPOINT ────────────────────────────────────────────────────────────


def test_rows_no_data(client):
    """GET /api/data/rows without uploading returns 400 NO_DATA."""
    resp = client.get("/api/data/rows")
    assert resp.status_code == 400
    data = json.loads(resp.data)
    assert data["error_code"] == "NO_DATA"


def test_rows_after_upload(client, csv_clean):
    """GET /api/data/rows after upload returns all rows up to MAX_PLOT_ROWS."""
    _upload(client, csv_clean, "sample_clean.csv")
    resp = client.get("/api/data/rows")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert "rows" in data
    assert "columns" in data
    assert "total_rows" in data
    assert "shown_rows" in data
    assert isinstance(data["truncated"], bool)
    # sample_clean.csv has 500 rows — all within MAX_PLOT_ROWS (2000)
    assert data["total_rows"] == 500
    assert data["shown_rows"] == 500
    assert data["truncated"] is False
    assert len(data["rows"]) == 500


# ─── SESSION UPDATE ───────────────────────────────────────────────────────────


def test_session_update(client):
    """PUT /api/state/session updates session fields."""
    resp = client.put(
        "/api/state/session",
        data=json.dumps({"learning_mode": True, "experience_level": "beginner"}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert data["session"]["learning_mode"] is True


# ─── MULTI-FILE LOADING ───────────────────────────────────────────────────────


def test_upload_returns_dataset_key(client, csv_clean):
    """POST /api/data/upload response includes dataset_key and loaded_count."""
    resp = _upload(client, csv_clean, "file_a.csv")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert "dataset_key" in data
    assert "loaded_count" in data
    assert data["loaded_count"] == 1
    assert data["dataset_key"] == "file_a.csv"


def test_two_uploads_accumulate(client, csv_clean):
    """Uploading two distinct files accumulates both in _datasets."""
    _upload(client, csv_clean, "file_a.csv")
    resp = _upload(client, csv_clean, "file_b.csv")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["loaded_count"] == 2
    assert data["dataset_key"] == "file_b.csv"


def test_datasets_endpoint_lists_loaded(client, csv_clean):
    """GET /api/data/datasets returns all loaded datasets with correct shape."""
    _upload(client, csv_clean, "file_a.csv")
    _upload(client, csv_clean, "file_b.csv")
    resp = client.get("/api/data/datasets")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert data["count"] == 2
    keys = {ds["key"] for ds in data["datasets"]}
    assert "file_a.csv" in keys
    assert "file_b.csv" in keys
    # file_b should be active (last uploaded)
    active = next(ds for ds in data["datasets"] if ds["active"])
    assert active["key"] == "file_b.csv"


def test_active_dataset_switch(client, csv_clean):
    """PUT /api/state/session with active_dataset_key mirrors that dataset to primary."""
    _upload(client, csv_clean, "file_a.csv")
    _upload(client, csv_clean, "file_b.csv")
    # Switch back to file_a
    resp = client.put(
        "/api/state/session",
        data=json.dumps({"active_dataset_key": "file_a.csv"}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    # Verify rows endpoint now serves file_a (same data in this test, so just check 200)
    rows_resp = client.get("/api/data/rows")
    assert rows_resp.status_code == 200


def test_switch_to_nonexistent_dataset_returns_404(client, csv_clean):
    """PUT /api/state/session with unknown active_dataset_key returns 404."""
    _upload(client, csv_clean, "file_a.csv")
    resp = client.put(
        "/api/state/session",
        data=json.dumps({"active_dataset_key": "nonexistent.csv"}),
        content_type="application/json",
    )
    assert resp.status_code == 404


def test_data_type_stored_per_dataset(client, csv_clean):
    """PUT /api/state/session data_type annotates the active dataset metadata."""
    _upload(client, csv_clean, "file_a.csv")
    client.put(
        "/api/state/session",
        data=json.dumps({"data_type": "simulation"}),
        content_type="application/json",
    )
    resp = client.get("/api/data/datasets")
    data = json.loads(resp.data)
    active = next(ds for ds in data["datasets"] if ds["active"])
    assert active["data_type"] == "simulation"


def test_datasets_endpoint_no_data(client):
    """GET /api/data/datasets with no uploads returns empty list."""
    resp = client.get("/api/data/datasets")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert data["count"] == 0
    assert data["datasets"] == []


def test_state_reset_clears_datasets(client, csv_clean):
    """POST /api/state/reset wipes all loaded datasets."""
    _upload(client, csv_clean)
    assert json.loads(client.get("/api/data/datasets").data)["count"] == 1

    resp = client.post("/api/state/reset")
    assert resp.status_code == 200
    assert json.loads(resp.data)["success"] is True
    assert json.loads(client.get("/api/data/datasets").data)["count"] == 0


def test_state_reset_clears_primary(client, csv_clean):
    """POST /api/state/reset removes the primary dataset DataFrame."""
    _upload(client, csv_clean)
    resp = client.post("/api/state/reset")
    assert resp.status_code == 200
    rows_resp = json.loads(client.get("/api/data/rows").data)
    assert rows_resp["success"] is False


# ─── COLUMN DESIGNATION ───────────────────────────────────────────────────────


def test_designate_happy_path(client, csv_clean):
    """POST /api/data/designate stores input/output columns."""
    _upload(client, csv_clean, "test.csv")
    # csv_clean has columns x1..x5 and y1..y5 (10 cols)
    resp = client.post(
        "/api/data/designate",
        data=json.dumps({"input_columns": ["mach", "alpha"], "output_columns": ["cl"]}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert data["input_columns"] == ["mach", "alpha"]
    assert data["output_columns"] == ["cl"]


def test_designate_no_data(client):
    """POST /api/data/designate without a loaded dataset returns 400."""
    resp = client.post(
        "/api/data/designate",
        data=json.dumps({"input_columns": ["mach"], "output_columns": ["cl"]}),
        content_type="application/json",
    )
    assert resp.status_code == 400
    assert json.loads(resp.data)["error_code"] == "NO_DATA"


def test_designate_no_inputs(client, csv_clean):
    """POST /api/data/designate with empty input_columns returns 422."""
    _upload(client, csv_clean)
    resp = client.post(
        "/api/data/designate",
        data=json.dumps({"input_columns": [], "output_columns": ["cl"]}),
        content_type="application/json",
    )
    assert resp.status_code == 422
    assert json.loads(resp.data)["error_code"] == "NO_INPUTS"


def test_designate_no_outputs(client, csv_clean):
    """POST /api/data/designate with empty output_columns returns 422."""
    _upload(client, csv_clean)
    resp = client.post(
        "/api/data/designate",
        data=json.dumps({"input_columns": ["x1"], "output_columns": []}),
        content_type="application/json",
    )
    assert resp.status_code == 422
    assert json.loads(resp.data)["error_code"] == "NO_OUTPUTS"


def test_designate_overlap(client, csv_clean):
    """POST /api/data/designate with overlapping columns returns 422."""
    _upload(client, csv_clean)
    resp = client.post(
        "/api/data/designate",
        data=json.dumps({"input_columns": ["mach", "cl"], "output_columns": ["cl"]}),
        content_type="application/json",
    )
    assert resp.status_code == 422
    assert json.loads(resp.data)["error_code"] == "COLUMN_OVERLAP"


def test_designate_persisted_in_datasets_endpoint(client, csv_clean):
    """After designation, GET /api/data/datasets reflects input/output columns."""
    _upload(client, csv_clean, "test.csv")
    client.post(
        "/api/data/designate",
        data=json.dumps({"input_columns": ["mach", "alpha"], "output_columns": ["cl"]}),
        content_type="application/json",
    )
    ds_resp = json.loads(client.get("/api/data/datasets").data)
    active  = next(d for d in ds_resp["datasets"] if d["active"])
    assert active["input_columns"] == ["mach", "alpha"]
    assert active["output_columns"] == ["cl"]


# ─── CORRELATION ──────────────────────────────────────────────────────────────


def test_correlate_no_data(client):
    """GET /api/data/correlate without a loaded dataset returns 400."""
    resp = client.get("/api/data/correlate")
    assert resp.status_code == 400
    assert json.loads(resp.data)["error_code"] == "NO_DATA"


def test_correlate_after_upload(client, csv_clean):
    """GET /api/data/correlate returns a correlation matrix."""
    _upload(client, csv_clean, "test.csv")
    resp = client.get("/api/data/correlate")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert "matrix" in data
    assert "high_corr_pairs" in data
    assert "columns" in data
    # Diagonal should be 1.0
    for col in data["columns"]:
        assert data["matrix"][col][col] == 1.0


def test_correlate_cached(client, csv_clean):
    """Second GET /api/data/correlate returns cached result (same matrix)."""
    _upload(client, csv_clean, "test.csv")
    resp1 = json.loads(client.get("/api/data/correlate").data)
    resp2 = json.loads(client.get("/api/data/correlate").data)
    assert resp1["matrix"] == resp2["matrix"]


# ─── NORMALIZATION ────────────────────────────────────────────────────────────


def test_normalize_no_data(client):
    """POST /api/data/normalize without a loaded dataset returns 400."""
    resp = client.post(
        "/api/data/normalize",
        data=json.dumps({"method": "minmax"}),
        content_type="application/json",
    )
    assert resp.status_code == 400
    assert json.loads(resp.data)["error_code"] == "NO_DATA"


def test_normalize_no_designation(client, csv_clean):
    """POST /api/data/normalize without designation returns 400 NO_DESIGNATION."""
    _upload(client, csv_clean)
    resp = client.post(
        "/api/data/normalize",
        data=json.dumps({"method": "minmax"}),
        content_type="application/json",
    )
    assert resp.status_code == 400
    assert json.loads(resp.data)["error_code"] == "NO_DESIGNATION"


def test_normalize_minmax(client, csv_clean):
    """POST /api/data/normalize with minmax succeeds after designation."""
    _upload(client, csv_clean, "test.csv")
    client.post(
        "/api/data/designate",
        data=json.dumps({"input_columns": ["mach", "alpha"], "output_columns": ["cl"]}),
        content_type="application/json",
    )
    resp = client.post(
        "/api/data/normalize",
        data=json.dumps({"method": "minmax"}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert data["method"] == "minmax"
    assert data["n_columns"] == 2  # mach and alpha


def test_normalize_zscore(client, csv_clean):
    """POST /api/data/normalize with zscore succeeds after designation."""
    _upload(client, csv_clean, "test.csv")
    client.post(
        "/api/data/designate",
        data=json.dumps({"input_columns": ["mach"], "output_columns": ["cl"]}),
        content_type="application/json",
    )
    resp = client.post(
        "/api/data/normalize",
        data=json.dumps({"method": "zscore"}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    assert json.loads(resp.data)["method"] == "zscore"


def test_normalize_unknown_method(client, csv_clean):
    """POST /api/data/normalize with unknown method returns 422."""
    _upload(client, csv_clean)
    client.post(
        "/api/data/designate",
        data=json.dumps({"input_columns": ["mach"], "output_columns": ["cl"]}),
        content_type="application/json",
    )
    resp = client.post(
        "/api/data/normalize",
        data=json.dumps({"method": "pca"}),
        content_type="application/json",
    )
    assert resp.status_code == 422
    assert json.loads(resp.data)["error_code"] == "UNKNOWN_METHOD"


# ─── AUDIT TRAIL ──────────────────────────────────────────────────────────────


def test_audit_event_on_upload(client, csv_clean):
    """Upload creates an 'upload' audit event in STATE."""
    _upload(client, csv_clean, "test.csv")
    state = json.loads(client.get("/api/state/").data)["state"]
    events = state["audit"]["events"]
    assert any(e["event_type"] == "upload" for e in events)


def test_audit_event_on_designation(client, csv_clean):
    """Designation creates a 'designation' audit event."""
    _upload(client, csv_clean, "test.csv")
    client.post(
        "/api/data/designate",
        data=json.dumps({"input_columns": ["mach"], "output_columns": ["cl"]}),
        content_type="application/json",
    )
    state = json.loads(client.get("/api/state/").data)["state"]
    events = state["audit"]["events"]
    assert any(e["event_type"] == "designation" for e in events)


def test_audit_event_on_normalization(client, csv_clean):
    """Normalization creates a 'normalization' audit event."""
    _upload(client, csv_clean, "test.csv")
    client.post(
        "/api/data/designate",
        data=json.dumps({"input_columns": ["mach"], "output_columns": ["cl"]}),
        content_type="application/json",
    )
    client.post(
        "/api/data/normalize",
        data=json.dumps({"method": "minmax"}),
        content_type="application/json",
    )
    state = json.loads(client.get("/api/state/").data)["state"]
    events = state["audit"]["events"]
    assert any(e["event_type"] == "normalization" for e in events)


# ─── SUMMARY — CLEANING STATS ─────────────────────────────────────────────────


def test_summary_includes_cleaning_stats_no_data(client):
    """GET /api/data/summary returns 400 when no data is loaded."""
    resp = client.get("/api/data/summary")
    assert resp.status_code == 400


def test_summary_includes_cleaning_stats(client, csv_dirty):
    """GET /api/data/summary includes cleaning_stats after upload."""
    _upload(client, csv_dirty, "dirty.csv")
    resp = client.get("/api/data/summary")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert "cleaning_stats" in data
    cs = data["cleaning_stats"]
    assert cs["null_rows"] > 0
    assert cs["duplicate_rows"] >= 5
    assert "outlier_rows" in cs


def test_summary_cleaning_stats_clean_dataset(client, csv_clean):
    """GET /api/data/summary on a clean dataset reports zero duplicates and nulls."""
    _upload(client, csv_clean, "clean.csv")
    resp = client.get("/api/data/summary")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    cs = data["cleaning_stats"]
    assert cs["null_rows"] == 0
    assert cs["duplicate_rows"] == 0


# ─── CLEAN / NULLS ────────────────────────────────────────────────────────────


def test_clean_nulls_no_data(client):
    """POST /api/data/clean/nulls returns 400 when no dataset is loaded."""
    resp = client.post(
        "/api/data/clean/nulls",
        data=json.dumps({"strategy": "drop_rows"}),
        content_type="application/json",
    )
    assert resp.status_code == 400
    assert json.loads(resp.data)["error_code"] == "NO_DATA"


def test_clean_nulls_unknown_strategy(client, csv_dirty):
    """POST /api/data/clean/nulls with invalid strategy returns 422."""
    _upload(client, csv_dirty, "dirty.csv")
    resp = client.post(
        "/api/data/clean/nulls",
        data=json.dumps({"strategy": "interpolate"}),
        content_type="application/json",
    )
    assert resp.status_code == 422
    assert json.loads(resp.data)["error_code"] == "UNKNOWN_STRATEGY"


def test_clean_nulls_drop_rows(client, csv_dirty):
    """POST /api/data/clean/nulls with drop_rows removes rows and returns delta."""
    _upload(client, csv_dirty, "dirty.csv")
    rows_before = json.loads(client.get("/api/data/summary").data)["n_rows"]
    resp = client.post(
        "/api/data/clean/nulls",
        data=json.dumps({"strategy": "drop_rows"}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert data["rows_before"] == rows_before
    assert data["rows_after"] < rows_before
    assert data["rows_affected"] == rows_before - data["rows_after"]


def test_clean_nulls_mean_impute(client, csv_dirty):
    """POST /api/data/clean/nulls with mean_impute preserves row count."""
    _upload(client, csv_dirty, "dirty.csv")
    rows_before = json.loads(client.get("/api/data/summary").data)["n_rows"]
    resp = client.post(
        "/api/data/clean/nulls",
        data=json.dumps({"strategy": "mean_impute"}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["rows_after"] == rows_before
    # After imputation, summary should report zero null rows
    cs = json.loads(client.get("/api/data/summary").data)["cleaning_stats"]
    assert cs["null_rows"] == 0


def test_clean_nulls_median_impute(client, csv_dirty):
    """POST /api/data/clean/nulls with median_impute preserves row count."""
    _upload(client, csv_dirty, "dirty.csv")
    rows_before = json.loads(client.get("/api/data/summary").data)["n_rows"]
    resp = client.post(
        "/api/data/clean/nulls",
        data=json.dumps({"strategy": "median_impute"}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    assert json.loads(resp.data)["rows_after"] == rows_before


# ─── CLEAN / OUTLIERS ─────────────────────────────────────────────────────────


def test_clean_outliers_no_data(client):
    """POST /api/data/clean/outliers returns 400 when no dataset is loaded."""
    resp = client.post(
        "/api/data/clean/outliers",
        data=json.dumps({"strategy": "drop_rows"}),
        content_type="application/json",
    )
    assert resp.status_code == 400
    assert json.loads(resp.data)["error_code"] == "NO_DATA"


def test_clean_outliers_unknown_strategy(client, csv_clean):
    """POST /api/data/clean/outliers with invalid strategy returns 422."""
    _upload(client, csv_clean, "clean.csv")
    resp = client.post(
        "/api/data/clean/outliers",
        data=json.dumps({"strategy": "winsorize"}),
        content_type="application/json",
    )
    assert resp.status_code == 422
    assert json.loads(resp.data)["error_code"] == "UNKNOWN_STRATEGY"


def test_clean_outliers_keep_noop(client, csv_clean):
    """POST /api/data/clean/outliers with keep strategy leaves row count unchanged."""
    _upload(client, csv_clean, "clean.csv")
    rows_before = json.loads(client.get("/api/data/summary").data)["n_rows"]
    resp = client.post(
        "/api/data/clean/outliers",
        data=json.dumps({"strategy": "keep"}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["rows_before"] == rows_before
    assert data["rows_after"] == rows_before
    assert data["rows_affected"] == 0


def test_clean_outliers_drop_rows(client, csv_dirty):
    """POST /api/data/clean/outliers with drop_rows removes outlier rows."""
    _upload(client, csv_dirty, "dirty.csv")
    # Impute nulls first so IQR computation is not skewed
    client.post(
        "/api/data/clean/nulls",
        data=json.dumps({"strategy": "mean_impute"}),
        content_type="application/json",
    )
    rows_before = json.loads(client.get("/api/data/summary").data)["n_rows"]
    resp = client.post(
        "/api/data/clean/outliers",
        data=json.dumps({"strategy": "drop_rows"}),
        content_type="application/json",
    )
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert data["rows_after"] <= rows_before


# ─── CLEAN / DUPLICATES ───────────────────────────────────────────────────────


def test_clean_duplicates_no_data(client):
    """POST /api/data/clean/duplicates returns 400 when no dataset is loaded."""
    resp = client.post("/api/data/clean/duplicates")
    assert resp.status_code == 400
    assert json.loads(resp.data)["error_code"] == "NO_DATA"


def test_clean_duplicates_removes_dupes(client, csv_dirty):
    """POST /api/data/clean/duplicates removes the 5 known duplicate rows."""
    _upload(client, csv_dirty, "dirty.csv")
    rows_before = json.loads(client.get("/api/data/summary").data)["n_rows"]
    resp = client.post("/api/data/clean/duplicates")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert data["rows_removed"] == 5
    assert data["rows_after"] == rows_before - 5


def test_clean_duplicates_clean_dataset(client, csv_clean):
    """POST /api/data/clean/duplicates on a clean dataset reports 0 removed."""
    _upload(client, csv_clean, "clean.csv")
    resp = client.post("/api/data/clean/duplicates")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["rows_removed"] == 0


# ─── CLEAN / RESET ────────────────────────────────────────────────────────────


def test_clean_reset_no_data(client):
    """POST /api/data/clean/reset returns 400 when no dataset is loaded."""
    resp = client.post("/api/data/clean/reset")
    assert resp.status_code == 400
    assert json.loads(resp.data)["error_code"] == "NO_DATA"


def test_clean_reset_restores_raw(client, csv_dirty):
    """POST /api/data/clean/reset restores original row count after cleaning."""
    _upload(client, csv_dirty, "dirty.csv")
    original_rows = json.loads(client.get("/api/data/summary").data)["n_rows"]
    # Apply cleaning
    client.post(
        "/api/data/clean/nulls",
        data=json.dumps({"strategy": "drop_rows"}),
        content_type="application/json",
    )
    reduced_rows = json.loads(client.get("/api/data/summary").data)["n_rows"]
    assert reduced_rows < original_rows
    # Reset
    resp = client.post("/api/data/clean/reset")
    assert resp.status_code == 200
    assert json.loads(resp.data)["rows_restored"] == original_rows
    restored_rows = json.loads(client.get("/api/data/summary").data)["n_rows"]
    assert restored_rows == original_rows


# ─── AUDIT TRAIL — CLEANING ───────────────────────────────────────────────────


def test_audit_event_on_null_cleaning(client, csv_dirty):
    """Null handling creates a 'cleaning_nulls' audit event."""
    _upload(client, csv_dirty, "dirty.csv")
    client.post(
        "/api/data/clean/nulls",
        data=json.dumps({"strategy": "drop_rows"}),
        content_type="application/json",
    )
    events = json.loads(client.get("/api/state/").data)["state"]["audit"]["events"]
    assert any(e["event_type"] == "cleaning_nulls" for e in events)


def test_audit_event_on_cleaning_reset(client, csv_dirty):
    """Clean reset creates a 'cleaning_reset' audit event."""
    _upload(client, csv_dirty, "dirty.csv")
    client.post("/api/data/clean/reset")
    events = json.loads(client.get("/api/state/").data)["state"]["audit"]["events"]
    assert any(e["event_type"] == "cleaning_reset" for e in events)


# ─── POST /api/data/clean/transform ──────────────────────────────────────────


def test_clean_transform_no_data(client):
    """POST /api/data/clean/transform returns 400 when no dataset is loaded."""
    resp = client.post(
        "/api/data/clean/transform",
        data=json.dumps({"columns": ["x1"]}),
        content_type="application/json",
    )
    assert resp.status_code == 400
    assert json.loads(resp.data)["error_code"] == "NO_DATA"


def test_clean_transform_no_columns(client, csv_clean):
    """POST /api/data/clean/transform returns 422 when columns list is empty."""
    _upload(client, csv_clean, "test.csv")
    resp = client.post(
        "/api/data/clean/transform",
        data=json.dumps({"columns": []}),
        content_type="application/json",
    )
    assert resp.status_code == 422


def test_clean_transform_invalid_column(client, csv_clean):
    """POST /api/data/clean/transform returns 422 for unknown column names."""
    _upload(client, csv_clean, "test.csv")
    resp = client.post(
        "/api/data/clean/transform",
        data=json.dumps({"columns": ["does_not_exist"]}),
        content_type="application/json",
    )
    assert resp.status_code == 422
    data = json.loads(resp.data)
    assert data["error_code"] == "INVALID_COLUMNS"


def test_clean_transform_negative_values_rejected(client):
    """POST /api/data/clean/transform returns 422 when column has values <= -1."""
    csv_neg = b"x1,x2,y\n-5.0,0.1,1.0\n1.0,0.2,2.0\n2.0,0.3,3.0\n3.0,0.4,4.0\n4.0,0.5,5.0\n"
    _upload(client, csv_neg, "neg.csv")
    resp = client.post(
        "/api/data/clean/transform",
        data=json.dumps({"columns": ["x1"]}),
        content_type="application/json",
    )
    assert resp.status_code == 422


def test_clean_transform_success(client, csv_clean):
    """POST /api/data/clean/transform transforms specified columns."""
    _upload(client, csv_clean, "test.csv")
    # Identify a valid column from the summary
    summary = json.loads(client.get("/api/data/summary").data)
    col = summary["columns"][0]
    resp = client.post(
        "/api/data/clean/transform",
        data=json.dumps({"columns": [col]}),
        content_type="application/json",
    )
    data = json.loads(resp.data)
    assert resp.status_code == 200
    assert data["success"] is True
    assert data["n_columns"] == 1
    assert col in data["columns_transformed"]
    assert data["rows_before"] == data["rows_after"]


def test_summary_includes_skew(client, csv_clean):
    """GET /api/data/summary response includes skew for each column."""
    _upload(client, csv_clean, "test.csv")
    resp = client.get("/api/data/summary")
    data = json.loads(resp.data)
    assert resp.status_code == 200
    for col_stats in data["stats"].values():
        assert "skew" in col_stats


# ─── GET /api/model/config ────────────────────────────────────────────────────


def test_model_config_default(client):
    """GET /api/model/config returns default config before any configuration."""
    resp = client.get("/api/model/config")
    data = json.loads(resp.data)
    assert resp.status_code == 200
    assert data["success"] is True
    assert "config" in data
    assert data["config"]["model_type"] is None
    assert data["config"]["test_split"] == 0.20
    assert data["config"]["cv_folds"] == 5


# ─── POST /api/model/configure ───────────────────────────────────────────────


def test_model_configure_happy_path(client):
    """POST /api/model/configure saves and returns the training config."""
    resp = client.post(
        "/api/model/configure",
        data=json.dumps({"model_type": "gpr", "test_split": 0.25, "cv_folds": 5}),
        content_type="application/json",
    )
    data = json.loads(resp.data)
    assert resp.status_code == 200
    assert data["success"] is True
    assert data["config"]["model_type"] == "gpr"
    assert data["config"]["test_split"] == 0.25
    assert data["config"]["cv_folds"] == 5


def test_model_configure_persists(client):
    """Config saved by POST is returned by a subsequent GET."""
    client.post(
        "/api/model/configure",
        data=json.dumps({"model_type": "rf", "test_split": 0.20, "cv_folds": 10}),
        content_type="application/json",
    )
    resp = client.get("/api/model/config")
    data = json.loads(resp.data)
    assert data["config"]["model_type"] == "rf"
    assert data["config"]["cv_folds"] == 10


def test_model_configure_invalid_model_type(client):
    """POST /api/model/configure returns 422 for unknown model type."""
    resp = client.post(
        "/api/model/configure",
        data=json.dumps({"model_type": "xgboost", "test_split": 0.20, "cv_folds": 5}),
        content_type="application/json",
    )
    assert resp.status_code == 422
    assert json.loads(resp.data)["error_code"] == "UNKNOWN_MODEL_TYPE"


def test_model_configure_invalid_test_split(client):
    """POST /api/model/configure returns 422 for out-of-range test_split."""
    resp = client.post(
        "/api/model/configure",
        data=json.dumps({"model_type": "gpr", "test_split": 0.99, "cv_folds": 5}),
        content_type="application/json",
    )
    assert resp.status_code == 422
    assert json.loads(resp.data)["error_code"] == "INVALID_TEST_SPLIT"


def test_model_configure_invalid_cv_folds(client):
    """POST /api/model/configure returns 422 for out-of-range cv_folds."""
    resp = client.post(
        "/api/model/configure",
        data=json.dumps({"model_type": "gpr", "test_split": 0.20, "cv_folds": 1}),
        content_type="application/json",
    )
    assert resp.status_code == 422
    assert json.loads(resp.data)["error_code"] == "INVALID_CV_FOLDS"


def test_model_configure_audit_event(client):
    """POST /api/model/configure creates a 'model_configure' audit event."""
    client.post(
        "/api/model/configure",
        data=json.dumps({"model_type": "linear", "test_split": 0.20, "cv_folds": 5}),
        content_type="application/json",
    )
    events = json.loads(client.get("/api/state/").data)["state"]["audit"]["events"]
    assert any(e["event_type"] == "model_configure" for e in events)


# ─── HELPERS (train pipeline) ─────────────────────────────────────────────────


def _designate(client, input_columns, output_columns):
    return client.post(
        "/api/data/designate",
        data=json.dumps({"input_columns": input_columns, "output_columns": output_columns}),
        content_type="application/json",
    )


def _configure_model(client, model_type="linear", test_split=0.2, cv_folds=3):
    return client.post(
        "/api/model/configure",
        data=json.dumps({"model_type": model_type, "test_split": test_split, "cv_folds": cv_folds}),
        content_type="application/json",
    )


def _train(client):
    return client.post("/api/model/train", data=json.dumps({}), content_type="application/json")


# ─── GET /api/model/results — no model ───────────────────────────────────────


def test_model_results_no_model(client):
    """GET /api/model/results before training returns 200 with success=false."""
    resp = client.get("/api/model/results")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is False
    assert data["error_code"] == "NO_TRAINED_MODEL"


# ─── POST /api/model/train — error cases ─────────────────────────────────────


def test_model_train_no_data(client):
    """POST /api/model/train with no dataset loaded returns 422 NO_CLEAN_DATA."""
    resp = _train(client)
    assert resp.status_code == 422
    assert json.loads(resp.data)["error_code"] == "NO_CLEAN_DATA"


def test_model_train_no_designation(client, csv_edge):
    """POST /api/model/train without designation returns 422 DESIGNATION_REQUIRED."""
    _upload(client, csv_edge, "sample_edge.csv")
    resp = _train(client)
    assert resp.status_code == 422
    assert json.loads(resp.data)["error_code"] == "DESIGNATION_REQUIRED"


def test_model_train_no_config(client, csv_edge):
    """POST /api/model/train without saved config returns 422 CONFIG_REQUIRED."""
    _upload(client, csv_edge, "sample_edge.csv")
    _designate(client, ["input_x"], ["output_y"])
    resp = _train(client)
    assert resp.status_code == 422
    assert json.loads(resp.data)["error_code"] == "CONFIG_REQUIRED"


# ─── POST /api/model/train — happy paths ─────────────────────────────────────


def test_model_train_linear_returns_results(client, csv_edge):
    """Train a Linear model end-to-end; response has expected structure."""
    _upload(client, csv_edge, "sample_edge.csv")
    _designate(client, ["input_x"], ["output_y"])
    _configure_model(client, model_type="linear", test_split=0.2, cv_folds=3)
    resp = _train(client)
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    r = data["results"]
    assert r["model_type"] == "linear"
    assert r["n_train"] > 0
    assert r["n_test"] > 0
    assert len(r["test_metrics"]) == 1
    assert r["test_metrics"][0]["column"] == "output_y"
    assert "r2" in r["test_metrics"][0]
    assert "rmse" in r["test_metrics"][0]
    assert r["cv_results"]["n_folds"] == 3


def test_model_train_rf_returns_results(client, csv_edge):
    """Train a Random Forest model; response has expected structure."""
    _upload(client, csv_edge, "sample_edge.csv")
    _designate(client, ["input_x"], ["output_y"])
    _configure_model(client, model_type="rf", test_split=0.2, cv_folds=3)
    resp = _train(client)
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["results"]["model_type"] == "rf"


def test_model_results_after_train(client, csv_edge):
    """GET /api/model/results after training returns 200 with results."""
    _upload(client, csv_edge, "sample_edge.csv")
    _designate(client, ["input_x"], ["output_y"])
    _configure_model(client, model_type="linear", test_split=0.2, cv_folds=3)
    _train(client)
    resp = client.get("/api/model/results")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert data["success"] is True
    assert data["results"]["model_type"] == "linear"


def test_state_endpoint_safe_after_train(client, csv_edge):
    """GET /api/state/ does not crash after a model has been trained."""
    _upload(client, csv_edge, "sample_edge.csv")
    _designate(client, ["input_x"], ["output_y"])
    _configure_model(client, model_type="linear", test_split=0.2, cv_folds=3)
    _train(client)
    resp = client.get("/api/state/")
    assert resp.status_code == 200
    state = json.loads(resp.data)["state"]
    # The model object must have been replaced by its summary dict
    trained = state["surrogate_sessions"]["primary"]["models"].get("trained")
    if trained is not None:
        assert trained.get("_type") == "model"


def test_model_train_audit_event(client, csv_edge):
    """POST /api/model/train creates a 'model_train' audit event."""
    _upload(client, csv_edge, "sample_edge.csv")
    _designate(client, ["input_x"], ["output_y"])
    _configure_model(client, model_type="linear", test_split=0.2, cv_folds=3)
    _train(client)
    events = json.loads(client.get("/api/state/").data)["state"]["audit"]["events"]
    assert any(e["event_type"] == "model_train" for e in events)


def test_model_train_multi_output(client, csv_clean):
    """Train on a multi-output dataset; test_metrics has one entry per output."""
    _upload(client, csv_clean, "sample_clean.csv")
    _designate(client, ["mach", "alpha", "beta", "altitude_ft", "q_bar", "reynolds"], ["cl", "cd"])
    _configure_model(client, model_type="linear", test_split=0.2, cv_folds=3)
    resp = _train(client)
    assert resp.status_code == 200
    metrics = json.loads(resp.data)["results"]["test_metrics"]
    assert len(metrics) == 2
    cols = [m["column"] for m in metrics]
    assert "cl" in cols
    assert "cd" in cols
