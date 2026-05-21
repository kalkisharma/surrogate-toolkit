"""
================================================================================
FILE: run.py
MODULE: (root)
PURPOSE: Development entry point. Reads HOST/PORT/DEBUG from .env and starts
         the Flask development server.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-12
VERSION: 0.2.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

# load_dotenv() MUST be called before importing create_app so that any
# environment-driven config (secret key, debug flag) is visible at import time.
import os

from dotenv import load_dotenv

load_dotenv()

from app import create_app          # noqa: E402 — intentional late import
from config.settings import VERSION  # noqa: E402

app = create_app()

if __name__ == "__main__":
    # Production deployment uses: gunicorn "app:create_app()"
    # This block is for local development only.
    host  = os.getenv("HOST", "127.0.0.1")
    port  = int(os.getenv("PORT", "5000"))
    debug = os.getenv("DEBUG", "false").lower() == "true"

    border = "-" * 42
    import sys
    def _print(s=""):
        sys.stdout.buffer.write((s + "\n").encode("utf-8"))
    _print(f"\n{border}")
    _print(f"  Surrogate Toolkit  v{VERSION}")
    _print(f"  http://{host}:{port}")
    _print(f"  Debug: {'on' if debug else 'off'}")
    _print(f"{border}\n")

    app.run(host=host, port=port, debug=debug)
