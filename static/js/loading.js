// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/loading.js
// Version: 1.0.0
// Description: Spinner overlay, inline progress bars, and skeleton screens.
//              Import and call these helpers — never build loading UI inline.
// =============================================================================

/**
 * Overlay a blocking spinner on an element.
 * The element must have position: relative (or absolute/fixed) in CSS.
 * @param {HTMLElement} el
 */
export function showSpinner(el) {
  if (el.querySelector(".spinner-overlay")) return;
  const overlay = document.createElement("div");
  overlay.className = "spinner-overlay";
  overlay.innerHTML = '<div class="spinner" aria-label="Loading…"></div>';
  el.style.position = "relative";
  el.appendChild(overlay);
}

/**
 * Remove the spinner overlay from an element.
 * @param {HTMLElement} el
 */
export function hideSpinner(el) {
  const overlay = el.querySelector(".spinner-overlay");
  if (overlay) overlay.remove();
}

/**
 * Show an inline progress bar inside an element (0–100%).
 * Creates a new bar if one doesn't exist; updates the fill if it does.
 * @param {HTMLElement} el
 * @param {number} pct - 0 to 100
 */
export function showProgress(el, pct) {
  let wrap = el.querySelector(".progress-bar-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "progress-bar-wrap";
    const fill = document.createElement("div");
    fill.className = "progress-bar-fill";
    wrap.appendChild(fill);
    el.appendChild(wrap);
  }
  const fill = wrap.querySelector(".progress-bar-fill");
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

/**
 * Replace the contents of an element with skeleton loading rows.
 * @param {HTMLElement} el
 * @param {number} [rows=5]
 */
export function showSkeleton(el, rows = 5) {
  el.innerHTML = "";
  const widths = ["short", "medium", "", "short", "medium"];
  for (let i = 0; i < rows; i++) {
    const row = document.createElement("div");
    const mod = widths[i % widths.length];
    row.className = `skeleton skeleton-row${mod ? " skeleton-row--" + mod : ""}`;
    el.appendChild(row);
  }
}

/**
 * Clear skeleton rows from an element.
 * @param {HTMLElement} el
 */
export function hideSkeleton(el) {
  el.querySelectorAll(".skeleton").forEach((s) => s.remove());
}
