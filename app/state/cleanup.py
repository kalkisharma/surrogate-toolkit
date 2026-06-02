"""
================================================================================
FILE: cleanup.py
MODULE: app/state/
PURPOSE: Temp file cleanup — removes stale .surrogate files from the system
         temp directory to avoid unbounded disk growth.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-14
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import glob
import os
import tempfile
import time


def cleanup_temp_files(temp_dir: str = None, max_age_seconds: int = 3600) -> int:
    """
    Remove .surrogate files in temp_dir that are older than max_age_seconds.

    Args:
        temp_dir: Directory to scan. Defaults to the system temp directory.
        max_age_seconds: Files older than this are deleted. Default 1 hour.

    Returns:
        Number of files removed.
    """
    if temp_dir is None:
        temp_dir = tempfile.gettempdir()

    removed = 0
    now = time.time()
    for path in glob.glob(os.path.join(temp_dir, "*.surrogate")):
        try:
            if now - os.path.getmtime(path) > max_age_seconds:
                os.remove(path)
                removed += 1
        except OSError:
            pass
    return removed
