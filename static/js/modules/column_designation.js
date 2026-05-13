// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/column_designation.js
// Version: 0.5.0
// Description: Column designation step — lets users classify each column as
//              Input, Output, or Unused. Sends POST /api/data/designate.
//              Pre-populates from existing metadata on dataset switch.
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
 * @param {Function}    onConfirm    - Called with ({input_columns, output_columns}) after successful POST.
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
) {
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Step 4 — Column Designation</h2>
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

  // Build role map from initial designation
  const roles = {};
  for (const col of columns) {
    if (initInputs.includes(col))  roles[col] = "input";
    else if (initOutputs.includes(col)) roles[col] = "output";
    else roles[col] = "unused";
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
  for (const col of columns) {
    const dtype   = dtypes?.[col] ?? "—";
    const nc      = nullCounts?.[col] ?? 0;
    const pct     = nRows > 0 ? ((nc / nRows) * 100).toFixed(1) : "0.0";
    const nullCls = nc === 0 ? "" : parseFloat(pct) <= 10 ? "null-warn" : "null-bad";

    const tr = el("tr");
    tr.innerHTML = `
      <td class="desig-col-name" title="${col}">${col}</td>
      <td class="desig-dtype text-mono">${dtype}</td>
      <td class="desig-null ${nullCls}">${pct}%</td>
      <td class="desig-role-cell"></td>
    `;

    const roleCell = tr.querySelector(".desig-role-cell");
    for (const role of ["input", "output", "unused"]) {
      const radioId = `desig-${CSS.escape(col)}-${role}`;
      const radio   = el("input", { type: "radio", name: `desig-${CSS.escape(col)}`, id: radioId, value: role });
      radio.checked = roles[col] === role;
      radio.addEventListener("change", () => { if (radio.checked) roles[col] = role; });

      const lbl = el("label", { cls: "desig-role-label", for: radioId, text: role });
      roleCell.appendChild(radio);
      roleCell.appendChild(lbl);
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
    for (const col of columns) roles[col] = role;
    tbody.querySelectorAll(`input[type=radio][value="${role}"]`).forEach(r => { r.checked = true; });
    // Uncheck others
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

    confirmBtn.disabled    = true;
    confirmBtn.textContent = "Saving…";
    showSpinner(containerEl);

    const resp = await post("/api/data/designate", { input_columns: inputCols, output_columns: outputCols });

    hideSpinner(containerEl);

    if (!resp.success) {
      confirmBtn.disabled    = false;
      confirmBtn.textContent = alreadyDesignated ? "Update Designation" : "Confirm Designation →";
      showError(resp.message || "Designation failed.");
      return;
    }

    confirmBtn.disabled    = false;
    confirmBtn.textContent = "Update Designation";
    showSuccess(`Designation saved — ${inputCols.length} input(s), ${outputCols.length} output(s).`);
    onConfirm({ input_columns: inputCols, output_columns: outputCols });
  });

  containerEl.appendChild(confirmBtn);
}
