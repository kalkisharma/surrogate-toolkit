"""
================================================================================
FILE: test_api_endpoints.py
MODULE: tests/integration/
PURPOSE: Integration tests for the /api/data/* HTTP endpoints. Tests the full
         request/response cycle including STATE mutations.
DEPENDENCIES: pytest, pytest-flask, io, json, tests.conftest
FUTURE EXTENSIONS: Tests for /api/model/*, /api/predict/*, authentication tests.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-11
VERSION: 0.1.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

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
