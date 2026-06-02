"""
================================================================================
FILE: __init__.py
MODULE: app/
PURPOSE: Flask application factory. Creates and configures the Flask app,
         registers all blueprints, initializes STATE, and sets global error
         handlers.
MAINTAINER: Kalki Sharma (kalkijsharma@gmail.com)
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-13
VERSION: 0.9.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.

import os

from flask import Flask, jsonify, render_template, request

from config.settings import MAX_FILE_SIZE_BYTES, VERSION
from app.state.schema import STATE, reset_state


def create_app() -> Flask:
    """
    Flask application factory.

    Instantiates Flask, wires configuration, registers blueprints in dependency
    order, initializes STATE, and attaches global error handlers.

    Args:
        None

    Returns:
        Flask: Configured application instance ready to serve.

    Raises:
        Nothing at call time — misconfiguration surfaces at first request.

    Notes:
        Production deployment:  gunicorn "app:create_app()"
        Development server:     python run.py

        Thread safety: STATE is a plain dict shared across requests in the
        single-threaded dev server. gunicorn multi-worker mode gives each worker
        its own STATE — a shared backend (Redis, SQLite) is required for true
        multi-worker state sharing. This is a known Phase 2 concern.

        CORS: When the Vite dev server is introduced in Phase 2 (different port
        from Flask), add flask-cors here to allow cross-origin fetch() calls.

    Future:
        Feature flag injection, per-environment config class, health-check route.
    """
    # ─── INSTANTIATE ──────────────────────────────────────────────────────────
    # static_folder is resolved to an absolute path to avoid Windows path issues
    # when the working directory changes.
    app = Flask(
        __name__,
        template_folder="templates",
        static_folder=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static"),
        static_url_path="/static",
    )

    # ─── CONFIGURATION ────────────────────────────────────────────────────────
    app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-key-replace-in-production")

    # Flask enforces this limit and returns HTTP 413 before calling the view.
    # The ingestion pipeline also checks size as a secondary defence (e.g. for
    # chunked transfer encoding where Flask cannot pre-check the size).
    app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE_BYTES

    # ─── STATE INITIALIZATION ─────────────────────────────────────────────────
    # reset_state() deep-copies the canonical template into the live STATE dict.
    # Store the reference in app.config so blueprints can reach it via
    # current_app.config['STATE'] without importing schema.py directly.
    reset_state()
    app.config["STATE"] = STATE

    # ─── BLUEPRINTS ───────────────────────────────────────────────────────────
    # Registration order matters: main (SPA shell) first, then API blueprints.
    # State blueprint before data blueprint so /api/state/ is available
    # immediately after boot for frontend health checks.

    from app.routes.main import bp as main_bp
    app.register_blueprint(main_bp)

    from app.api.state_api import bp as state_bp
    app.register_blueprint(state_bp, url_prefix="/api/state")

    from app.api.data_api import bp as data_bp
    app.register_blueprint(data_bp, url_prefix="/api/data")

    from app.api.model_api import bp as model_bp
    app.register_blueprint(model_bp, url_prefix="/api/model")

    from app.api.prediction_api import bp as predict_bp
    app.register_blueprint(predict_bp, url_prefix="/api/predict")

    from app.api.active_learning_api import bp as active_bp
    app.register_blueprint(active_bp, url_prefix="/api/active")

    from app.api.export_api import bp as export_bp
    app.register_blueprint(export_bp, url_prefix="/api/export")

    from app.api.optimization_api import bp as optimize_bp
    app.register_blueprint(optimize_bp, url_prefix="/api/optimize")

    from app.api.comparison_api import bp as comparison_bp
    app.register_blueprint(comparison_bp, url_prefix="/api/comparison")

    from app.api.learning_api import bp as learning_bp
    app.register_blueprint(learning_bp, url_prefix="/api/learning")

    # ─── ERROR HANDLERS ───────────────────────────────────────────────────────

    @app.errorhandler(413)
    def payload_too_large(e):
        """
        Flask fires this before the view when MAX_CONTENT_LENGTH is exceeded.

        Returns the standard error envelope so the frontend can display an
        actionable message rather than a raw HTTP error page.
        """
        return (
            jsonify(
                {
                    "success": False,
                    "error_code": "FILE_TOO_LARGE",
                    "message": f"File exceeds the maximum allowed size of {MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB.",
                    "detail": str(e),
                    "recoverable": True,
                    "allowed_actions": ["retry"],
                }
            ),
            413,
        )

    @app.errorhandler(404)
    def not_found(e):
        """
        API paths return a JSON error envelope.
        All other paths serve index.html so the JS router handles navigation.
        This enables SPA deep links to work on page refresh.
        """
        if request.path.startswith("/api/"):
            return (
                jsonify(
                    {
                        "success": False,
                        "error_code": "NOT_FOUND",
                        "message": f"Endpoint '{request.path}' does not exist.",
                        "detail": str(e),
                        "recoverable": False,
                        "allowed_actions": [],
                    }
                ),
                404,
            )
        return render_template("index.html"), 200

    @app.errorhandler(405)
    def method_not_allowed(e):
        return (
            jsonify(
                {
                    "success": False,
                    "error_code": "METHOD_NOT_ALLOWED",
                    "message": f"Method '{request.method}' is not allowed on '{request.path}'.",
                    "detail": str(e),
                    "recoverable": False,
                    "allowed_actions": [],
                }
            ),
            405,
        )

    @app.errorhandler(500)
    def internal_error(e):
        return (
            jsonify(
                {
                    "success": False,
                    "error_code": "INTERNAL_SERVER_ERROR",
                    "message": "An unexpected server error occurred. Check the application logs.",
                    "detail": str(e),
                    "recoverable": False,
                    "allowed_actions": ["retry"],
                }
            ),
            500,
        )

    app.logger.info(f"Surrogate Toolkit v{VERSION} starting")

    return app
