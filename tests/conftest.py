"""
================================================================================
FILE: conftest.py
MODULE: tests/
PURPOSE: pytest fixtures shared across all test modules. Provides a Flask test
         client, pre-built CSV byte buffers, and helper file-like objects.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-11
VERSION: 0.1.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import io
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def app():
    """
    Create a Flask test application with testing config.

    Returns:
        Flask: Configured app instance in testing mode.
    """
    from app import create_app

    application = create_app()
    application.config["TESTING"] = True
    # Disable the MAX_CONTENT_LENGTH enforcement during testing so we can
    # test our own size check in ingestion.py independently.
    application.config["MAX_CONTENT_LENGTH"] = None
    return application


@pytest.fixture()
def client(app):
    """
    Flask test client.

    Args:
        app: The test Flask app fixture.

    Returns:
        FlaskClient: Test client for making requests.
    """
    return app.test_client()


# ─── CSV FIXTURES ─────────────────────────────────────────────────────────────


@pytest.fixture()
def csv_clean():
    """500-row clean dataset bytes."""
    return (FIXTURES / "sample_clean.csv").read_bytes()


@pytest.fixture()
def csv_dirty():
    """505-row dataset with nulls, outliers, and duplicate rows."""
    return (FIXTURES / "sample_dirty.csv").read_bytes()


@pytest.fixture()
def csv_edge():
    """10-row minimal dataset."""
    return (FIXTURES / "sample_edge.csv").read_bytes()


@pytest.fixture()
def csv_single_row():
    """1-row dataset (below MIN_ROWS)."""
    return (FIXTURES / "edge_cases" / "single_row.csv").read_bytes()


def make_csv_bytes(content: str) -> bytes:
    """Helper: convert a CSV string to bytes for use with ingest_csv."""
    return content.encode("utf-8")


def make_file_obj(data: bytes, filename: str = "test.csv"):
    """
    Return a BytesIO object with a .name attribute, mimicking werkzeug FileStorage.

    Args:
        data: Raw bytes of the file.
        filename: Filename string.

    Returns:
        BytesIO: File-like object.
    """
    buf = io.BytesIO(data)
    buf.name = filename
    return buf
