// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/utils.js
// Description: Shared utility functions used across all modules.
// =============================================================================

/**
 * Format a number for display.
 * @param {number|null} val
 * @param {number} decimals
 * @returns {string}
 */
export function formatNum(val, decimals = 4) {
  if (val === null || val === undefined || Number.isNaN(val)) return "—";
  return Number(val).toFixed(decimals);
}

/**
 * Format a large integer with thousands separators.
 * @param {number} n
 * @returns {string}
 */
export function formatInt(n) {
  return n.toLocaleString();
}

/**
 * Compute the mean of an array of numbers (ignores null/undefined).
 * @param {number[]} arr
 * @returns {number|null}
 */
export function mean(arr) {
  const valid = arr.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * Compute the standard deviation of an array (population std dev).
 * @param {number[]} arr
 * @returns {number|null}
 */
export function stdDev(arr) {
  const m = mean(arr);
  if (m === null) return null;
  const valid = arr.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  const variance = valid.reduce((sum, v) => sum + (v - m) ** 2, 0) / valid.length;
  return Math.sqrt(variance);
}

/**
 * Compute the median of an array.
 * @param {number[]} arr
 * @returns {number|null}
 */
export function median(arr) {
  const valid = arr
    .filter((v) => v !== null && v !== undefined && !Number.isNaN(v))
    .slice()
    .sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 !== 0 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
}

/**
 * Compute Pearson skewness of an array.
 * @param {number[]} arr
 * @returns {number|null}
 */
export function skewness(arr) {
  const valid = arr.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  const n = valid.length;
  if (n < 3) return null;
  const m = mean(valid);
  const s = stdDev(valid);
  if (s === null || s === 0) return 0;
  return valid.reduce((sum, v) => sum + ((v - m) / s) ** 3, 0) / n;
}

/**
 * Detect outliers using IQR method (Q1 - 1.5*IQR, Q3 + 1.5*IQR).
 * Returns a Set of indices (0-based) of rows where any column is an outlier.
 * @param {object[]} rows - Array of row objects
 * @param {string[]} columns - Column names to check
 * @returns {Set<number>}
 */
export function detectOutliers(rows, columns) {
  const outlierIndices = new Set();
  for (const col of columns) {
    const vals = rows.map((r) => r[col]);
    const sorted = vals.filter((v) => v !== null && v !== undefined).slice().sort((a, b) => a - b);
    if (sorted.length < 4) continue;
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr;
    const hi = q3 + 1.5 * iqr;
    vals.forEach((v, i) => {
      if (v !== null && v !== undefined && (v < lo || v > hi)) {
        outlierIndices.add(i);
      }
    });
  }
  return outlierIndices;
}

/**
 * Create an HTML element with optional class and attributes.
 * @param {string} tag
 * @param {object} opts
 * @returns {HTMLElement}
 */
export function el(tag, { cls, text, html, ...attrs } = {}) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  if (html !== undefined) node.innerHTML = html;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * Remove all children from an element.
 * @param {HTMLElement} element
 */
export function clearEl(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

/**
 * Escape a string for safe insertion into innerHTML.
 * Replaces &, <, >, ", ' with HTML entities.
 * @param {string} str
 * @returns {string}
 */
export function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Returns a debounced version of fn that fires only after `ms` ms of silence.
 * @param {Function} fn
 * @param {number} ms
 * @returns {Function}
 */
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
