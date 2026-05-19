"""
================================================================================
FILE: learning_api.py
MODULE: app/api/
PURPOSE: Blueprint for /api/learning/* — serves static learning content from
         app/learning/*.json and app/learning/decision_trees/*.json.
         All endpoints are read-only GET; no STATE mutation.
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CREATED: 2026-05-19
LAST MODIFIED: 2026-05-19
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

import json
import os

from flask import Blueprint, jsonify

bp = Blueprint("learning", __name__)

_LEARNING_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "learning")

_TOPIC_FILES = {
    "diagnostics":    "diagnostics.json",
    "uncertainty":    "uncertainty.json",
    "cv_strategies":  "cv_strategies.json",
    "sensitivity":    "sensitivity.json",
    "active_learning": "active_learning.json",
    "data_cleaning":  "data_cleaning.json",
}

_GUIDE_FILES = {
    "model_selection": os.path.join("decision_trees", "model_selection.json"),
    "cv_selection":    os.path.join("decision_trees", "cv_selection.json"),
}


def _load_json(rel_path: str):
    abs_path = os.path.normpath(os.path.join(_LEARNING_DIR, rel_path))
    with open(abs_path, "r", encoding="utf-8") as f:
        return json.load(f)


@bp.route("/glossary", methods=["GET"])
def glossary():
    """Return all glossary terms."""
    data = _load_json("glossary.json")
    return jsonify({"success": True, **data}), 200


@bp.route("/models", methods=["GET"])
def models():
    """Return model guide entries."""
    data = _load_json("models.json")
    return jsonify({"success": True, **data}), 200


@bp.route("/content/<topic>", methods=["GET"])
def content(topic: str):
    """Return sections for a named topic."""
    if topic not in _TOPIC_FILES:
        return jsonify({
            "success": False,
            "error_code": "UNKNOWN_TOPIC",
            "message": f"Unknown topic '{topic}'. Valid topics: {sorted(_TOPIC_FILES.keys())}",
        }), 404
    data = _load_json(_TOPIC_FILES[topic])
    return jsonify({"success": True, "topic": topic, **data}), 200


@bp.route("/guide/<path:guide_name>", methods=["GET"])
def guide(guide_name: str):
    """Return decision-tree nodes for a named guide."""
    if guide_name not in _GUIDE_FILES:
        return jsonify({
            "success": False,
            "error_code": "UNKNOWN_GUIDE",
            "message": f"Unknown guide '{guide_name}'. Valid guides: {sorted(_GUIDE_FILES.keys())}",
        }), 404
    data = _load_json(_GUIDE_FILES[guide_name])
    return jsonify({"success": True, "guide": guide_name, **data}), 200
