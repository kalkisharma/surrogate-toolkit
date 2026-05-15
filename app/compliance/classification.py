"""
================================================================================
FILE: classification.py
MODULE: app/compliance/
PURPOSE: Classification label constants and helpers for export compliance.
DEPENDENCIES: None
MAINTAINER: Kalki Sharma (kalki.j.sharma@lmco.com)
CLASSIFICATION: Not program-specific
CREATED: 2026-05-11
LAST MODIFIED: 2026-05-15
VERSION: 1.0.0
================================================================================
"""

# Copyright © 2026 Kalki Sharma. All rights reserved.
# Licensed for internal use by Lockheed Martin employees only.
# See LICENSE.md for full terms.

CLASSIFICATION_GUIDANCE = {
    "Unclassified": "This report contains no controlled or restricted information.",
    "CUI": (
        "Controlled Unclassified Information — handle per CUI program requirements. "
        "Do not distribute without authorization."
    ),
    "ITAR": (
        "EXPORT CONTROLLED — International Traffic in Arms Regulations. "
        "Unauthorized disclosure is prohibited by 22 U.S.C. §2778. "
        "Confirm export authorization before sharing."
    ),
    "EAR": (
        "EXPORT CONTROLLED — Export Administration Regulations. "
        "Check EAR Part 730–774 for licensing requirements before transfer."
    ),
}

WATERMARK_TEXT = {
    "Unclassified": "",
    "CUI":  "// CUI //",
    "ITAR": "// ITAR — EXPORT CONTROLLED //",
    "EAR":  "// EAR — EXPORT CONTROLLED //",
}


def requires_confirmation(classification: str) -> bool:
    """Return True if the classification level requires explicit user acknowledgment."""
    return classification in ("ITAR", "EAR")


def get_watermark_text(classification: str) -> str:
    """Return the classification watermark string, empty for Unclassified."""
    return WATERMARK_TEXT.get(classification, f"// {classification} //")


def get_banner_text(classification: str) -> str:
    """Return the full guidance text for the given classification."""
    return CLASSIFICATION_GUIDANCE.get(classification, classification)
