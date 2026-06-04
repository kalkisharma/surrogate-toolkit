// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/notifications.js
// Version: 1.0.0
// Description: Centralised toast notification system. All modules call
//              showSuccess/showError/showWarning/showInfo — never implement
//              toast logic elsewhere.
// =============================================================================

const ICONS = {
  success: "✓",
  error:   "✕",
  warning: "⚠",
  info:    "ℹ",
};

/**
 * @param {string} message
 * @param {number} [duration=4000]
 */
export function showSuccess(message, duration = 4000) {
  _show("success", message, duration);
}

/**
 * @param {string} message
 * @param {number} [duration=6000]
 */
export function showError(message, duration = 6000) {
  _show("error", message, duration);
}

/**
 * @param {string} message
 * @param {number} [duration=5000]
 */
export function showWarning(message, duration = 5000) {
  _show("warning", message, duration);
}

/**
 * @param {string} message
 * @param {number} [duration=4000]
 */
export function showInfo(message, duration = 4000) {
  _show("info", message, duration);
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _show(type, message, duration) {
  const container = document.getElementById("notification-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.setAttribute("role", "alert");
  toast.innerHTML = `
    <span class="toast__icon" aria-hidden="true">${ICONS[type]}</span>
    <span class="toast__body">
      <span class="toast__message">${_escapeHtml(message)}</span>
    </span>
    <button class="toast__dismiss" aria-label="Dismiss notification">×</button>
  `;

  const dismiss = toast.querySelector(".toast__dismiss");
  dismiss.addEventListener("click", () => _remove(toast));

  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => _remove(toast), duration);
  }
}

function _remove(toast) {
  if (!toast.isConnected) return;
  toast.classList.add("toast--exiting");
  toast.addEventListener("animationend", () => toast.remove(), { once: true });
}

function _escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
