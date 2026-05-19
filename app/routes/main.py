"""
================================================================================
FILE: main.py
MODULE: app/routes/
PURPOSE: SPA shell route. Serves index.html for GET / and any unknown non-API
         path so the JavaScript router can handle client-side navigation.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-11
VERSION: 0.1.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

from flask import Blueprint, render_template

bp = Blueprint("main", __name__)


@bp.route("/")
def index():
    """
    Serve the SPA shell (index.html).

    Flask handles /static/* automatically. This route handles the root path.
    The 404 handler in app/__init__.py catches all other non-API paths and also
    returns index.html so that deep links (e.g. /#explore) work on refresh.

    Args:
        None

    Returns:
        str: Rendered index.html template.

    Future:
        Inject server-side data (build hash, feature flags) into template context.
    """
    return render_template("index.html")
