// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/state.js
// Description: Client-side STATE cache. Fetches STATE from /api/state/ after
//              every mutating POST. Read-path uses the local copy to avoid
//              redundant network calls.
// =============================================================================

import { get } from "./api.js";

let _state = {};
let _availableCores = 1;

/**
 * Returns the current local STATE cache.
 * @returns {object}
 */
export function getLocalState() {
  return _state;
}

/**
 * Fetch the full STATE from the server and update the local cache.
 * Called after every mutating POST.
 * @returns {Promise<object>} Updated STATE.
 */
export async function refreshState() {
  const data = await get("/api/state/");
  if (data.success && data.state) {
    _state = data.state;
    if (data.available_cores) _availableCores = data.available_cores;
  }
  return _state;
}

/** Return server-reported CPU count (set on first refreshState call). */
export function getAvailableCores() { return _availableCores; }

/**
 * Return a nested value from the local STATE by dot-path.
 * e.g. getPath('datasets.primary.metadata.filename')
 * @param {string} path
 * @param {*} defaultValue
 * @returns {*}
 */
export function getPath(path, defaultValue = null) {
  return path.split(".").reduce((obj, key) => {
    if (obj === null || obj === undefined) return defaultValue;
    return obj[key] ?? defaultValue;
  }, _state);
}
