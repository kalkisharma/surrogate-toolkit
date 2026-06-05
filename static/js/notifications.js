// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/notifications.js
// Version: 1.1.0
// Description: Centralised toast notification system. All modules call
//              showSuccess/showError/showWarning/showInfo — never implement
//              toast logic elsewhere. Maintains an in-session log accessible
//              via getNotifLog() for the notification history panel.
// =============================================================================

const ICONS = {
  success: "✓",
  error:   "✕",
  warning: "⚠",
  info:    "ℹ",
};

// ── Notification log ──────────────────────────────────────────────────────────

const _notifLog = [];     // {ts: Date, type: string, message: string}
let _unseenCount = 0;

export function getNotifLog() { return [..._notifLog]; }

export function clearLog() {
  _notifLog.length = 0;
  _unseenCount = 0;
  _updateBadge();
}

export function clearUnseen() {
  _unseenCount = 0;
  _updateBadge();
}

function _pushLog(type, message) {
  _notifLog.push({ ts: new Date(), type, message });
  if (_notifLog.length > 100) _notifLog.shift();
  _unseenCount++;
  _updateBadge();
}

function _updateBadge() {
  const badge = document.getElementById("notif-badge");
  if (!badge) return;
  badge.textContent = _unseenCount > 99 ? "99+" : String(_unseenCount);
  badge.style.display = _unseenCount > 0 ? "" : "none";
}

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
  _pushLog(type, message);
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
