"""
================================================================================
FILE: run.py
MODULE: (root)
PURPOSE: Development entry point. Reads HOST/PORT/DEBUG from .env and starts
         the Flask development server.
         When running as a PyInstaller exe (sys.frozen=True), uses waitress
         instead and auto-opens the browser.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-06-07
VERSION: 0.3.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

# load_dotenv() MUST be called before importing create_app so that any
# environment-driven config (secret key, debug flag) is visible at import time.
import os
import sys

from dotenv import load_dotenv

load_dotenv()

from app import create_app          # noqa: E402 — intentional late import
from config.settings import VERSION  # noqa: E402

app = create_app()

if __name__ == "__main__":
    host = "127.0.0.1"
    port = 5000

    border = "-" * 42
    print(f"\n{border}", flush=True)
    print(f"  Surrogate Toolkit  v{VERSION}", flush=True)
    print(f"  http://{host}:{port}", flush=True)

    if getattr(sys, "frozen", False):
        # Running as PyInstaller exe — use waitress and auto-open browser.
        import threading
        import webbrowser
        from waitress import serve

        print(f"{border}\n", flush=True)
        threading.Timer(1.5, lambda: webbrowser.open(f"http://{host}:{port}")).start()
        serve(app, host=host, port=port)
    else:
        # Normal development run — use Flask dev server with .env config.
        host  = os.getenv("HOST", host)
        port  = int(os.getenv("PORT", str(port)))
        debug = os.getenv("DEBUG", "false").lower() == "true"
        print(f"  Debug: {'on' if debug else 'off'}", flush=True)
        print(f"{border}\n", flush=True)
        app.run(host=host, port=port, debug=debug)
