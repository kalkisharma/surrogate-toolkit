// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/column_designation.js
// Version: 0.6.0
// Description: Column designation step — lets users classify each column as
//              Input, Output, or Unused. Sends POST /api/data/designate.
//              Pre-populates from existing metadata on dataset switch.
//              Phase 22B: error companion columns auto-labeled "Output Error".
// =============================================================================

import { post } from "../api.js";
import { showError, showSuccess } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { registerPrimer } from "../learning_mode.js";
import { el } from "../utils.js";

/**
 * Render the column designation section into containerEl.
 *
 * @param {HTMLElement} containerEl  - Target card element.
 * @param {string[]}    columns      - All column names in the dataset.
 * @param {Object}      dtypes       - {col: "float64", ...}
 * @param {Object}      nullCounts   - {col: N, ...}
 * @param {number}      nRows        - Total row count (for null % calculation).
 * @param {string[]}    initInputs   - Already-designated input columns (may be empty).
 * @param {string[]}    initOutputs  - Already-designated output columns (may be empty).
 * @param {Function}    onConfirm    - Called with ({input_columns, output_columns, error_columns}) after successful POST.
 * @param {Object}      errorColumns - Phase 22B: {output_col: error_col} pairs detected at upload. Default {}.
 */
export function initDesignation(
  containerEl,
  columns,
  dtypes,
  nullCounts,
  nRows,
  initInputs,
  initOutputs,
  onConfirm,
  errorColumns = {},
) {
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Step 5 — Column Designation</h2>
    <p class="section-desc">Classify each column as an input (feature), output (target), or unused.</p>
  `;
  containerEl.appendChild(header);

  registerPrimer(
    "designation",
    header,
    "Inputs vs. outputs — what's the difference?",
    `<p><strong>Inputs</strong> (features) are the variables you control or measure — they drive the model.
     <strong>Outputs</strong> (targets) are the quantities the model predicts.</p>
     <p>For a CFD surrogate: geometry parameters and boundary conditions are inputs;
     drag, lift, and heat flux are outputs.</p>
     <p><strong>Unused</strong> columns are excluded from training entirely — useful for
     identifiers, timestamps, or columns flagged as low-quality.</p>`
  );

  // Phase 22B: track which columns are error companions and which user has overridden
  const errorColSet     = new Set(Object.values(errorColumns));   // {"cl_std", "cd_std", ...}
  const removedErrorCols = new Set();                              // user-demoted companions

  // Build role map from initial designation (error companions are not in roles)
  const roles = {};
  for (const col of columns) {
    if (errorColSet.has(col)) continue;           // skip — managed separately
    if (initInputs.includes(col))       roles[col] = "input";
    else if (initOutputs.includes(col)) roles[col] = "output";
    else                                roles[col] = "unused";
  }

  // ── Table ──────────────────────────────────────────────────────────────────
  const tableWrap = el("div", { cls: "designation-table-wrap" });
  const table     = el("table", { cls: "designation-table" });

  const thead = el("thead");
  thead.innerHTML = `<tr>
    <th>Column</th><th>Type</th><th>Null %</th>
    <th class="desig-radio-group-header">Role</th>
  </tr>`;
  table.appendChild(thead);

  const tbody = el("tbody");

  function _renderRadios(roleCell, col) {
    roleCell.innerHTML = "";
    for (const role of ["input", "output", "unused"]) {
      const radioId = `desig-${CSS.escape(col)}-${role}`;
      const radio   = el("input", { type: "radio", name: `desig-${CSS.escape(col)}`, id: radioId, value: role });
      radio.checked = roles[col] === role;
      radio.addEventListener("change", () => { if (radio.checked) roles[col] = role; });
      const lbl = el("label", { cls: "desig-role-label", for: radioId, text: role });
      roleCell.appendChild(radio);
      roleCell.appendChild(lbl);
    }
  }

  function _renderErrorBadge(roleCell, col) {
    roleCell.innerHTML = "";
    const badge = el("span", { cls: "desig-error-badge" });
    badge.textContent = "Output Error";
    badge.title = "Paired uncertainty column — used to weight model training, not predicted directly. Assumed to be 1σ — values are squared internally before use.";
    const overrideBtn = el("button", { cls: "desig-error-override btn btn-xs btn-ghost" });
    overrideBtn.textContent = "Override → Unused";
    overrideBtn.addEventListener("click", () => {
      removedErrorCols.add(col);
      roles[col] = "unused";
      _renderRadios(roleCell, col);
    });
    roleCell.appendChild(badge);
    roleCell.appendChild(overrideBtn);
  }

  for (const col of columns) {
    const dtype   = dtypes?.[col] ?? "—";
    const nc      = nullCounts?.[col] ?? 0;
    const pct     = nRows > 0 ? ((nc / nRows) * 100).toFixed(1) : "0.0";
    const nullCls = nc === 0 ? "" : parseFloat(pct) <= 10 ? "null-warn" : "null-bad";

    const tr = el("tr");
    if (errorColSet.has(col)) tr.classList.add("desig-error-row");
    tr.innerHTML = `
      <td class="desig-col-name" title="${col}">${col}</td>
      <td class="desig-dtype text-mono">${dtype}</td>
      <td class="desig-null ${nullCls}">${pct}%</td>
      <td class="desig-role-cell"></td>
    `;

    const roleCell = tr.querySelector(".desig-role-cell");
    if (errorColSet.has(col) && !removedErrorCols.has(col)) {
      _renderErrorBadge(roleCell, col);
    } else {
      if (!(col in roles)) roles[col] = "unused";
      _renderRadios(roleCell, col);
    }

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  containerEl.appendChild(tableWrap);

  // ── Quick-select helpers ───────────────────────────────────────────────────
  const helperRow = el("div", { cls: "desig-helpers" });
  helperRow.innerHTML = `
    <span class="desig-helper-label">Quick-select:</span>
    <button class="btn btn-secondary desig-helper-btn" id="desig-all-input">All → Input</button>
    <button class="btn btn-secondary desig-helper-btn" id="desig-reset">Reset all → Unused</button>
  `;
  containerEl.appendChild(helperRow);

  function _setAllRadios(role) {
    for (const col of columns) {
      if (errorColSet.has(col) && !removedErrorCols.has(col)) continue;  // skip managed error cols
      roles[col] = role;
    }
    tbody.querySelectorAll(`input[type=radio][value="${role}"]`).forEach(r => { r.checked = true; });
    for (const other of ["input", "output", "unused"].filter(r => r !== role)) {
      tbody.querySelectorAll(`input[type=radio][value="${other}"]`).forEach(r => { r.checked = false; });
    }
  }
  helperRow.querySelector("#desig-all-input").addEventListener("click", () => _setAllRadios("input"));
  helperRow.querySelector("#desig-reset").addEventListener("click", () => _setAllRadios("unused"));

  // ── Confirm button ─────────────────────────────────────────────────────────
  const alreadyDesignated = initInputs.length > 0 && initOutputs.length > 0;
  const confirmBtn = el("button", {
    cls:  "btn btn-primary",
    text: alreadyDesignated ? "Update Designation" : "Confirm Designation →",
    style: "margin-top: var(--space-5);",
  });

  confirmBtn.addEventListener("click", async () => {
    const inputCols  = columns.filter(c => roles[c] === "input");
    const outputCols = columns.filter(c => roles[c] === "output");

    if (inputCols.length === 0) {
      showError("Designate at least one Input column.");
      return;
    }
    if (outputCols.length === 0) {
      showError("Designate at least one Output column.");
      return;
    }

    // Phase 22B: confirmed error columns = detected pairs minus user overrides
    const confirmedErrorCols = {};
    for (const [outCol, errCol] of Object.entries(errorColumns)) {
      if (!removedErrorCols.has(errCol)) confirmedErrorCols[outCol] = errCol;
    }

    confirmBtn.disabled    = true;
    confirmBtn.textContent = "Saving…";
    showSpinner(containerEl);

    const resp = await post("/api/data/designate", {
      input_columns:  inputCols,
      output_columns: outputCols,
      error_columns:  confirmedErrorCols,
    });

    hideSpinner(containerEl);

    if (!resp.success) {
      confirmBtn.disabled    = false;
      confirmBtn.textContent = alreadyDesignated ? "Update Designation" : "Confirm Designation →";
      showError(resp.message || "Designation failed.");
      return;
    }

    confirmBtn.disabled    = false;
    confirmBtn.textContent = "Update Designation";
    const errMsg = Object.keys(confirmedErrorCols).length > 0
      ? ` — ${Object.keys(confirmedErrorCols).length} error companion(s) confirmed`
      : "";
    showSuccess(`Designation saved — ${inputCols.length} input(s), ${outputCols.length} output(s)${errMsg}.`);
    onConfirm({ input_columns: inputCols, output_columns: outputCols, error_columns: confirmedErrorCols });
  });

  containerEl.appendChild(confirmBtn);
}
