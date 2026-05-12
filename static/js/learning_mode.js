// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/learning_mode.js
// Description: Learning mode toggle (global header button), collapsible
//              primers, and expanded tooltips. All modules call registerPrimer
//              and registerTooltip rather than implementing their own UI.
// =============================================================================

import { showInfo } from "./notifications.js";

let _active = false;
let _toggleBtnEl = null;
const _tooltips = new Map(); // element → { shortText, expandedText, expandedEl }
let _activeTooltipEl = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise learning mode, wiring the toggle button in the global header.
 * @param {HTMLElement} toggleBtnEl - The #learning-toggle button element.
 */
export function initLearningMode(toggleBtnEl) {
  _toggleBtnEl = toggleBtnEl;
  if (!toggleBtnEl) return;

  toggleBtnEl.addEventListener("click", () => {
    if (_active) {
      disableLearningMode();
    } else {
      enableLearningMode();
    }
  });
}

/** Enable learning mode — activates header button, dispatches event, notifies user. */
export function enableLearningMode() {
  _active = true;
  if (_toggleBtnEl) _toggleBtnEl.setAttribute("aria-pressed", "true");
  _applyTooltips(true);
  document.dispatchEvent(new CustomEvent("learning:enabled"));
  showInfo("Learning mode enabled — hover over labelled elements for explanations.");
}

/** Disable learning mode — deactivates header button, dispatches event. */
export function disableLearningMode() {
  _active = false;
  if (_toggleBtnEl) _toggleBtnEl.setAttribute("aria-pressed", "false");
  _applyTooltips(false);
  _hideExpandedTooltip();
  document.dispatchEvent(new CustomEvent("learning:disabled"));
}

/** @returns {boolean} */
export function isLearningModeActive() {
  return _active;
}

/**
 * Insert a collapsible primer <details> element before anchorEl.
 * Only visible when learning mode is enabled.
 *
 * @param {string} key - Unique identifier for this primer.
 * @param {HTMLElement} anchorEl - Insert primer before this element.
 * @param {string} summaryText - Summary line (always visible when open).
 * @param {string} contentHTML - Body HTML of the primer.
 */
export function registerPrimer(key, anchorEl, summaryText, contentHTML) {
  if (!anchorEl || !anchorEl.parentNode) return;

  const existing = anchorEl.parentNode.querySelector(`.primer[data-key="${key}"]`);
  if (existing) return;

  const details = document.createElement("details");
  details.className = "primer" + (_active ? "" : " hidden");
  details.dataset.key = key;
  details.setAttribute("aria-label", summaryText);
  details.innerHTML = `
    <summary>${_escapeHtml(summaryText)}</summary>
    <div class="primer__body">${contentHTML}</div>
  `;

  anchorEl.parentNode.insertBefore(details, anchorEl);

  // Listen for future mode changes
  document.addEventListener("learning:enabled",  () => details.classList.remove("hidden"));
  document.addEventListener("learning:disabled", () => details.classList.add("hidden"));
}

/**
 * Register an element for expanded tooltip behaviour in learning mode.
 * When learning mode is off, falls back to the native `title` attribute.
 *
 * @param {HTMLElement} el
 * @param {string} shortText - Used as `title` attribute when learning mode is off.
 * @param {string} expandedText - Shown in the floating panel when learning mode is on.
 */
export function registerTooltip(el, shortText, expandedText) {
  el.title = shortText;
  _tooltips.set(el, { shortText, expandedText, expandedEl: null });

  el.addEventListener("mouseenter", () => _onHover(el));
  el.addEventListener("mouseleave", () => _hideExpandedTooltip());
  el.addEventListener("focus",     () => _onHover(el));
  el.addEventListener("blur",      () => _hideExpandedTooltip());
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _applyTooltips(learningOn) {
  for (const [el, data] of _tooltips) {
    el.title = learningOn ? "" : data.shortText;
  }
}

function _onHover(el) {
  if (!_active) return;
  const data = _tooltips.get(el);
  if (!data) return;

  _hideExpandedTooltip();

  const panel = document.createElement("div");
  panel.className = "tooltip-expanded";
  panel.innerHTML = `
    <div class="tooltip-expanded__title">${_escapeHtml(data.shortText)}</div>
    ${_escapeHtml(data.expandedText)}
  `;
  document.body.appendChild(panel);

  // Position: below the element, flip if near viewport edge
  const rect = el.getBoundingClientRect();
  let top  = rect.bottom + 8;
  let left = rect.left;

  const panelW = 300;
  const panelH = 120; // estimated

  if (left + panelW > window.innerWidth - 16) {
    left = window.innerWidth - panelW - 16;
  }
  if (top + panelH > window.innerHeight - 16) {
    top = rect.top - panelH - 8;
  }

  panel.style.top  = `${top + window.scrollY}px`;
  panel.style.left = `${left + window.scrollX}px`;

  data.expandedEl = panel;
  _activeTooltipEl = panel;
}

function _hideExpandedTooltip() {
  if (_activeTooltipEl) {
    _activeTooltipEl.remove();
    _activeTooltipEl = null;
  }
  for (const data of _tooltips.values()) {
    if (data.expandedEl) {
      data.expandedEl.remove();
      data.expandedEl = null;
    }
  }
}

function _escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
