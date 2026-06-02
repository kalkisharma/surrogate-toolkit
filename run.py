"""
================================================================================
FILE: run.py
MODULE: (root)
PURPOSE: Development entry point. Reads HOST/PORT/DEBUG from .env and starts
         the Flask development server.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-27
VERSION: 0.2.1
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

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
    print(f"\n{border}", flush=True)
    print(f"  Surrogate Toolkit  v{VERSION}", flush=True)
    print(f"  http://{host}:{port}", flush=True)
    print(f"  Debug: {'on' if debug else 'off'}", flush=True)
    print(f"{border}\n", flush=True)

    app.run(host=host, port=port, debug=debug)
