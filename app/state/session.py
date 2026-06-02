"""
================================================================================
FILE: session.py
MODULE: app/state/
PURPOSE: Session lifecycle management — thin wrappers around project.py
         serialize/deserialize operations.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-14
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

from app.state.project import write_project, read_project


def save_session(state: dict) -> bytes:
    """Serialize STATE to .surrogate ZIP bytes ready for download."""
    return write_project(state)


def load_session(file_bytes: bytes):
    """
    Deserialize a .surrogate ZIP file.

    Returns:
        (meta: dict, state: dict) — see project.read_project for details.
    """
    return read_project(file_bytes)
