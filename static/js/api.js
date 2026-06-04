// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/api.js
// Version: 1.0.0
// Description: Thin fetch wrapper — all HTTP calls go through here.
//              Handles FormData vs JSON body, and maps non-OK responses to
//              the standard error envelope format.
// =============================================================================

/**
 * POST to a backend endpoint.
 *
 * @param {string} url - Endpoint path, e.g. '/api/data/upload'
 * @param {FormData|object} body - FormData for file uploads, plain object for JSON.
 * @returns {Promise<object>} - Parsed JSON response body.
 */
export async function post(url, body) {
  const options = { method: "POST" };

  if (body instanceof FormData) {
    // Let the browser set Content-Type with the multipart boundary.
    options.body = body;
  } else {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (networkErr) {
    return _networkError(networkErr);
  }

  return _parseResponse(response);
}

/**
 * PUT to a backend endpoint with a JSON body.
 *
 * @param {string} url
 * @param {object} body
 * @returns {Promise<object>}
 */
export async function put(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    return _networkError(networkErr);
  }
  return _parseResponse(response);
}

/**
 * GET from a backend endpoint.
 *
 * @param {string} url
 * @returns {Promise<object>} - Parsed JSON response body.
 */
export async function get(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (networkErr) {
    return _networkError(networkErr);
  }
  return _parseResponse(response);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function _parseResponse(response) {
  try {
    return await response.json();
  } catch {
    return {
      success: false,
      error_code: "PARSE_ERROR",
      message: `Server returned an unreadable response (HTTP ${response.status}).`,
      detail: response.statusText,
      recoverable: false,
      allowed_actions: ["retry"],
    };
  }
}

function _networkError(err) {
  return {
    success: false,
    error_code: "NETWORK_ERROR",
    message: "Could not reach the server. Check that the application is running.",
    detail: err.message,
    recoverable: true,
    allowed_actions: ["retry"],
  };
}
