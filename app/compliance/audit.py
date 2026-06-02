"""
================================================================================
FILE: audit.py
MODULE: app/compliance/
PURPOSE: Export audit trail recording and CSV export.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-15
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import csv
import hashlib
import io
from datetime import datetime, timezone


def record_export(state: dict, filename: str, classification: str, acknowledged: bool) -> dict:
    """
    Append an export event to state["compliance"]["export_log"] and return the entry.
    Call set_file_hash() on the returned entry after the file content is known.
    """
    entry = {
        "timestamp":      datetime.now(timezone.utc).isoformat(),
        "event":          "report_exported",
        "filename":       filename,
        "classification": classification,
        "acknowledged":   acknowledged,
        "file_hash":      None,
    }
    state["compliance"]["export_log"].append(entry)
    return entry


def set_file_hash(entry: dict, content: bytes) -> None:
    """Set the SHA-256 hash of the exported file content on the audit entry."""
    entry["file_hash"] = hashlib.sha256(content).hexdigest()


def get_export_log(state: dict) -> list:
    """Return the export log list from STATE."""
    return state["compliance"].get("export_log", [])


def format_audit_csv(state: dict) -> str:
    """Serialize the export log to a CSV string."""
    log = get_export_log(state)
    buf = io.StringIO()
    writer = csv.DictWriter(
        buf,
        fieldnames=["timestamp", "event", "filename", "classification", "acknowledged", "file_hash"],
        extrasaction="ignore",
    )
    writer.writeheader()
    for entry in log:
        writer.writerow({
            "timestamp":      entry.get("timestamp", ""),
            "event":          entry.get("event", ""),
            "filename":       entry.get("filename", ""),
            "classification": entry.get("classification", ""),
            "acknowledged":   str(entry.get("acknowledged", "")),
            "file_hash":      entry.get("file_hash") or "",
        })
    return buf.getvalue()
