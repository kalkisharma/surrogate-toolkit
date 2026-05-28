// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/data_cleaning.js
// Version: 0.10.0
// Description: Data cleaning step — lets users handle missing values, remove
//              duplicates, and flag/drop outliers before column designation.
//              Sends POST /api/data/clean/* endpoints. Calls onClean() after
//              each successful operation so the exploration view can refresh.
//              Maintains a cumulative cleaning summary card with download button.
// =============================================================================

import { get, post } from "../api.js";
import { showError, showSuccess, showWarning } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { registerPrimer } from "../learning_mode.js";
import { el, clearEl } from "../utils.js";

// ── Cleaning history (module-level, persists across onClean re-renders) ────────
let _cleaningOps      = [];
let _currentRows      = 0;
let _initialRows      = 0;
let _summaryCardEl    = null;
let _onCleanCallback  = null;   // stored so Undo Last can trigger it

/**
 * Render the data cleaning section into containerEl.
 *
 * @param {HTMLElement} containerEl - Target card element.
 * @param {Function}    onClean     - Called after any successful cleaning operation.
 *                                    No arguments — parent refreshes exploration view.
 */
export async function initCleaning(containerEl, onClean) {
  clearEl(containerEl);
  showSpinner(containerEl);

  const summaryResp = await get("/api/data/summary");
  hideSpinner(containerEl);

  if (!summaryResp.success) {
    showError("Could not load cleaning summary. Reload the page and try again.");
    return;
  }

  const cs = summaryResp.cleaning_stats || { null_rows: 0, duplicate_rows: 0, outlier_rows: 0 };
  const nRows = summaryResp.n_rows || 0;

  // Reset cleaning history for this dataset
  _cleaningOps      = [];
  _currentRows      = nRows;
  _initialRows      = nRows;
  _onCleanCallback  = onClean;

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Step 4 — Data Cleaning</h2>
    <p class="section-desc">Optionally remove or repair problematic rows before designating columns. All operations are reversible with Undo.</p>
  `;
  containerEl.appendChild(header);

  registerPrimer(
    "cleaning",
    header,
    "Why clean data before training?",
    `<p>Surrogate models learn from the patterns in your data. Missing values, duplicate rows,
     and extreme outliers can distort those patterns or cause training to fail entirely.</p>
     <p><strong>Missing values</strong> — some algorithms cannot handle nulls at all.
     Drop the affected rows or fill them with an estimated value (imputation).</p>
     <p><strong>Duplicates</strong> — identical rows over-weight that region of the design space,
     biasing the model toward conditions that are already well-sampled.</p>
     <p><strong>Outliers</strong> — extreme values can be real physics (keep them) or data errors
     (drop them). Use the IQR flag in the Exploration view to decide before acting here.</p>
     <p><strong>Log-transform (skew)</strong> — a skewed column has most values clustered at one
     end with a long tail stretching the other way. This can bias the model toward the tail region.
     Applying <em>log(1 + x)</em> compresses large values and spreads small ones, making the
     distribution more symmetric. The +1 keeps log(0) safe. Do not apply to columns with
     negative values — the +1 shift only protects zero, not negatives.</p>
     <p><strong>Undo</strong> resets to the originally uploaded data at any time.</p>`
  );

  // ── Cleaning cards ───────────────────────────────────────────────────────────
  const grid = el("div", { cls: "cleaning-grid" });
  containerEl.appendChild(grid);

  // Extract per-column null counts from column stats
  const nullPerCol = {};
  const rawStats = summaryResp.stats || {};
  for (const [col, s] of Object.entries(rawStats)) {
    if (s.null_count > 0) nullPerCol[col] = s.null_count;
  }

  grid.appendChild(_buildNullCard(cs.null_rows, nRows, onClean, nullPerCol));
  grid.appendChild(_buildDuplicatesCard(cs.duplicate_rows, onClean));
  grid.appendChild(_buildTransformCard(rawStats, onClean));
  grid.appendChild(await _buildOutlierCard(cs.outlier_rows, nRows, onClean));

  // ── Undo all ─────────────────────────────────────────────────────────────────
  const resetRow = el("div", { cls: "cleaning-reset-row" });
  const resetBtn = el("button", { cls: "btn btn-secondary btn-sm", text: "Undo all cleaning", id: "cleaning-reset-btn" });
  resetRow.appendChild(resetBtn);
  containerEl.appendChild(resetRow);

  resetBtn.addEventListener("click", async () => {
    resetBtn.disabled = true;
    const resp = await post("/api/data/clean/reset", {});
    resetBtn.disabled = false;
    if (resp.success) {
      showSuccess(`Restored ${resp.rows_restored.toLocaleString()} rows from original upload.`);
      _cleaningOps  = [];
      _currentRows  = resp.rows_restored;
      _renderCleaningSummary();
      onClean();
    } else {
      showError(resp.message || "Reset failed.");
    }
  });

  // ── Cleaning summary card (hidden until first op) ──────────────────────────
  _summaryCardEl = el("div", { cls: "cleaning-summary-card hidden", id: "cleaning-summary-card" });
  containerEl.appendChild(_summaryCardEl);
}

// ── Summary card helpers ───────────────────────────────────────────────────────

function _recordOp(label, rowsRemoved, rowsAfter) {
  const rowsBefore = _currentRows;
  _cleaningOps.push({ label, rowsBefore, rowsRemoved, rowsAfter });
  _currentRows = rowsAfter;
  _renderCleaningSummary();
}

function _renderCleaningSummary() {
  if (!_summaryCardEl) return;
  if (_cleaningOps.length === 0) {
    _summaryCardEl.classList.add("hidden");
    return;
  }
  _summaryCardEl.classList.remove("hidden");
  clearEl(_summaryCardEl);

  const title = el("div", { cls: "cleaning-summary-card__title", text: "Cleaning Summary" });
  _summaryCardEl.appendChild(title);

  const table = document.createElement("table");
  table.className = "cleaning-summary-table";
  table.innerHTML = `<thead><tr>
    <th>Operation</th><th>Before</th><th>Removed</th><th>After</th>
  </tr></thead>`;
  const tbody = document.createElement("tbody");
  for (const op of _cleaningOps) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${op.label}</td>
      <td>${op.rowsBefore.toLocaleString()}</td>
      <td>${op.rowsRemoved.toLocaleString()}</td>
      <td>${op.rowsAfter.toLocaleString()}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  const totalRemoved = _initialRows - _currentRows;
  const tfoot = document.createElement("tfoot");
  tfoot.innerHTML = `<tr>
    <td>Total</td>
    <td>${_initialRows.toLocaleString()}</td>
    <td>${totalRemoved.toLocaleString()}</td>
    <td>${_currentRows.toLocaleString()}</td>
  </tr>`;
  table.appendChild(tfoot);
  _summaryCardEl.appendChild(table);

  const btnRow = el("div", { cls: "cleaning-summary-btn-row" });

  const dlBtn = el("button", { cls: "btn btn-secondary btn-sm", text: "⬇ Download cleaned CSV", id: "download-clean-btn" });
  dlBtn.addEventListener("click", () => { window.location.href = "/api/export/clean"; });
  btnRow.appendChild(dlBtn);

  const undoBtn = el("button", { cls: "btn btn-secondary btn-sm", text: "↩ Undo Last", id: "undo-clean-btn" });
  undoBtn.addEventListener("click", async () => {
    undoBtn.disabled = true;
    const resp = await post("/api/data/clean/undo", {});
    undoBtn.disabled = false;
    if (resp.success) {
      showSuccess(`Undid last operation. ${resp.rows_restored.toLocaleString()} rows restored.`);
      _cleaningOps.pop();
      _currentRows = resp.rows_restored;
      _renderCleaningSummary();
      // Notify parent so explore re-fetches cleaned data
      if (typeof _onCleanCallback === "function") _onCleanCallback();
    } else {
      showError(resp.message || "Undo failed.");
    }
  });
  btnRow.appendChild(undoBtn);

  _summaryCardEl.appendChild(btnRow);
}

// ── Null card ─────────────────────────────────────────────────────────────────

function _buildNullCard(nullRows, nRows, onClean, nullPerCol) {
  const card = el("div", { cls: "cleaning-item-card" });

  const hasNulls = nullRows > 0;
  const pct      = nRows > 0 ? ((nullRows / nRows) * 100).toFixed(1) : "0.0";
  const badge    = hasNulls
    ? `<span class="cleaning-badge cleaning-badge--warn">${nullRows.toLocaleString()} rows (${pct}%)</span>`
    : `<span class="cleaning-badge cleaning-badge--ok">None detected</span>`;

  card.innerHTML = `
    <div class="cleaning-item-header">
      <span class="cleaning-item-title">Missing Values</span>
      ${badge}
    </div>
    <p class="cleaning-item-desc">Rows with at least one empty cell.</p>
  `;

  if (!hasNulls) {
    card.appendChild(el("p", { cls: "cleaning-item-none", text: "No action needed." }));
    return card;
  }

  // Per-column breakdown
  if (nullPerCol && Object.keys(nullPerCol).length > 0) {
    const colEntries = Object.entries(nullPerCol).sort((a, b) => b[1] - a[1]);
    const details = document.createElement("details");
    details.className = "null-col-details";
    details.open = true;
    const summary = document.createElement("summary");
    summary.className = "null-col-summary";
    summary.textContent = `Affected columns (${colEntries.length})`;
    details.appendChild(summary);
    const list = el("div", { cls: "null-col-list" });
    for (const [col, count] of colEntries) {
      const row = el("div", { cls: "null-col-row" });
      row.appendChild(el("span", { cls: "null-col-name", text: col }));
      row.appendChild(el("span", { cls: "null-col-count cleaning-badge cleaning-badge--warn", text: `${count} null${count !== 1 ? "s" : ""}` }));
      list.appendChild(row);
    }
    details.appendChild(list);
    card.appendChild(details);
  }

  const strategies = [
    { value: "drop_rows",     label: "Drop rows with nulls",   desc: "Removes any row that has at least one missing value." },
    { value: "mean_impute",   label: "Fill with column mean",  desc: "Replaces each null with the average of non-null values in that column." },
    { value: "median_impute", label: "Fill with column median", desc: "Replaces each null with the median — less sensitive to other outliers." },
  ];

  const stratSel = _buildStrategySelect("null-strategy", strategies);
  card.appendChild(stratSel);

  const applyBtn = el("button", {
    cls:  "btn btn-primary btn-sm cleaning-apply-btn",
    text: "Apply",
    id:   "null-apply-btn",
  });
  card.appendChild(applyBtn);

  applyBtn.addEventListener("click", async () => {
    const strategy = card.querySelector("#null-strategy").value;
    applyBtn.disabled = true;
    const resp = await post("/api/data/clean/nulls", { strategy });
    applyBtn.disabled = false;
    if (resp.success) {
      if (strategy === "drop_rows") {
        showSuccess(`Dropped ${resp.rows_affected.toLocaleString()} row(s). ${resp.rows_after.toLocaleString()} remain.`);
        _recordOp("Drop null rows", resp.rows_affected, resp.rows_after);
      } else {
        const methodLabel = strategy === "mean_impute" ? "mean" : "median";
        showSuccess(`Imputed ${resp.rows_affected.toLocaleString()} row(s) using ${methodLabel}.`);
        _recordOp(`Impute nulls (${methodLabel})`, 0, _currentRows);
      }
      onClean();
    } else {
      showError(resp.message || "Null handling failed.");
    }
  });

  return card;
}

// ── Duplicates card ───────────────────────────────────────────────────────────

function _buildDuplicatesCard(dupRows, onClean) {
  const card = el("div", { cls: "cleaning-item-card" });

  const hasDups = dupRows > 0;
  const badge   = hasDups
    ? `<span class="cleaning-badge cleaning-badge--warn">${dupRows.toLocaleString()} duplicate row(s)</span>`
    : `<span class="cleaning-badge cleaning-badge--ok">None detected</span>`;

  card.innerHTML = `
    <div class="cleaning-item-header">
      <span class="cleaning-item-title">Duplicate Rows</span>
      ${badge}
    </div>
    <p class="cleaning-item-desc">Exact row duplicates over-weight those design points.</p>
  `;

  if (!hasDups) {
    card.appendChild(el("p", { cls: "cleaning-item-none", text: "No action needed." }));
    return card;
  }

  const applyBtn = el("button", {
    cls:  "btn btn-primary btn-sm cleaning-apply-btn",
    text: `Remove ${dupRows.toLocaleString()} duplicate row(s)`,
    id:   "dup-apply-btn",
  });
  card.appendChild(applyBtn);

  applyBtn.addEventListener("click", async () => {
    applyBtn.disabled = true;
    const resp = await post("/api/data/clean/duplicates", {});
    applyBtn.disabled = false;
    if (resp.success) {
      if (resp.rows_removed === 0) {
        showWarning("No duplicate rows found — data unchanged.");
      } else {
        showSuccess(`Removed ${resp.rows_removed.toLocaleString()} duplicate row(s). ${resp.rows_after.toLocaleString()} remain.`);
        _recordOp("Remove duplicates", resp.rows_removed, resp.rows_after);
        onClean();
      }
    } else {
      showError(resp.message || "Deduplication failed.");
    }
  });

  return card;
}

// ── Outlier card ──────────────────────────────────────────────────────────────

async function _buildOutlierCard(outlierRows, nRows, onClean) {
  const card = el("div", { cls: "cleaning-item-card" });

  const hasOutliers = outlierRows > 0;
  const pct         = nRows > 0 ? ((outlierRows / nRows) * 100).toFixed(1) : "0.0";
  const badge       = hasOutliers
    ? `<span class="cleaning-badge cleaning-badge--warn">${outlierRows.toLocaleString()} rows (${pct}%)</span>`
    : `<span class="cleaning-badge cleaning-badge--ok">None detected</span>`;

  card.innerHTML = `
    <div class="cleaning-item-header">
      <span class="cleaning-item-title">Outlier Rows (IQR)</span>
      ${badge}
    </div>
    <p class="cleaning-item-desc">Rows outside Q1 − 1.5×IQR or Q3 + 1.5×IQR. Select which columns to consider.</p>
  `;

  const strategies = [
    { value: "keep",      label: "Keep (reviewed, no action)", desc: "No rows removed. Use this to confirm you have reviewed the outliers and intentionally kept them — outliers are already visible in the scatter matrix by default." },
    { value: "drop_rows", label: "Drop outlier rows", desc: "Removes every row that contains an IQR outlier in the selected columns." },
  ];

  const stratSel = _buildStrategySelect("outlier-strategy", strategies);
  card.appendChild(stratSel);

  // Fetch per-column counts
  const countsResp = await get("/api/data/clean/outlier_counts");
  const counts     = (countsResp.success && countsResp.counts) ? countsResp.counts : {};
  const colNames   = Object.keys(counts);
  const withOutliers = colNames.filter(c => (counts[c] || 0) > 0).length;

  // ── Per-column checklist in a collapsible <details> ───────────────────────────
  const checklistDetails = document.createElement("details");
  checklistDetails.className = "outlier-checklist-details";
  const checklistSummary = document.createElement("summary");
  checklistSummary.className = "outlier-checklist-summary";
  checklistSummary.textContent = `Columns (${withOutliers} with outliers)`;
  checklistDetails.appendChild(checklistSummary);

  const checklistWrap = el("div", { cls: "outlier-checklist-wrap" });
  checklistDetails.appendChild(checklistWrap);
  card.appendChild(checklistDetails);

  if (colNames.length > 0) {
    const header = el("div", { cls: "outlier-checklist-header" });
    const selectAllBtn = el("button", { cls: "btn-link outlier-select-all", text: "Select All" });
    const clearAllBtn  = el("button", { cls: "btn-link outlier-clear-all",  text: "Clear All" });
    header.appendChild(selectAllBtn);
    header.appendChild(document.createTextNode(" / "));
    header.appendChild(clearAllBtn);
    checklistWrap.appendChild(header);

    const list = el("div", { cls: "outlier-checklist" });
    for (const col of colNames) {
      const count    = counts[col] || 0;
      const hasOut   = count > 0;
      const row      = el("label", { cls: `outlier-checklist-row${hasOut ? "" : " outlier-checklist-row--none"}` });
      const cb       = document.createElement("input");
      cb.type        = "checkbox";
      cb.value       = col;
      cb.checked     = hasOut;
      cb.disabled    = !hasOut;
      const nameSpan = el("span", { cls: "outlier-col-name", text: col });
      nameSpan.title = col;
      const cntSpan  = el("span", {
        cls:  `outlier-col-count${hasOut ? " outlier-col-count--warn" : ""}`,
        text: hasOut ? `${count} outlier${count !== 1 ? "s" : ""}` : "none",
      });
      row.appendChild(cb);
      row.appendChild(nameSpan);
      row.appendChild(cntSpan);
      list.appendChild(row);
    }
    checklistWrap.appendChild(list);

    selectAllBtn.addEventListener("click", () => {
      list.querySelectorAll("input[type=checkbox]:not(:disabled)").forEach(c => { c.checked = true; });
    });
    clearAllBtn.addEventListener("click", () => {
      list.querySelectorAll("input[type=checkbox]:not(:disabled)").forEach(c => { c.checked = false; });
    });
  }

  const iqrRow = el("div", { cls: "hyperparam-row level-expert-only" });
  iqrRow.innerHTML = `
    <span class="hyperparam-label">IQR multiplier</span>
    <input id="iqr-multiplier-input" type="number" class="hyperparam-input"
           min="0.5" max="5.0" step="0.1" value="1.5">
    <span class="hyperparam-hint">Default 1.5 — lower = stricter, higher = lenient</span>`;
  card.appendChild(iqrRow);

  const applyBtn = el("button", {
    cls:  "btn btn-primary btn-sm cleaning-apply-btn",
    text: "Apply",
    id:   "outlier-apply-btn",
  });
  card.appendChild(applyBtn);

  const statusEl = el("p", { cls: "outlier-status-line" });
  card.appendChild(statusEl);

  applyBtn.addEventListener("click", async () => {
    const strategy = card.querySelector("#outlier-strategy").value;
    const checked  = [...checklistDetails.querySelectorAll("input[type=checkbox]:checked")].map(c => c.value);
    const columns  = checked.length > 0 ? checked : null;   // null = all (backend default)
    const iqrInput = card.querySelector("#iqr-multiplier-input");
    const iqr_multiplier = iqrInput ? (parseFloat(iqrInput.value) || 1.5) : 1.5;
    applyBtn.disabled = true;
    const resp = await post("/api/data/clean/outliers", { strategy, columns, iqr_multiplier });
    applyBtn.disabled = false;
    if (resp.success) {
      if (strategy === "keep") {
        showSuccess("Outliers flagged. No rows were removed.");
      } else {
        const colNote = columns ? ` (${columns.length} column${columns.length !== 1 ? "s" : ""})` : "";
        const label   = `Drop outlier rows${colNote}`;
        _recordOp(label, resp.rows_affected, resp.rows_after);
        // Re-fetch counts to show how many are still flagged
        const newCounts = await get("/api/data/clean/outlier_counts");
        const stillFlagged = newCounts.success
          ? Object.values(newCounts.counts).reduce((s, v) => s + v, 0)
          : 0;
        if (stillFlagged > 0) {
          statusEl.textContent = `${resp.rows_affected} row(s) removed — ${stillFlagged} still flagged. Click Apply to continue.`;
          statusEl.className = "outlier-status-line outlier-status-line--warn";
          checklistSummary.textContent = `Columns (${Object.values(newCounts.counts).filter(v => v > 0).length} with outliers)`;
        } else {
          statusEl.textContent = `${resp.rows_affected} row(s) removed — no outliers remaining.`;
          statusEl.className = "outlier-status-line outlier-status-line--ok";
          checklistSummary.textContent = "Columns (0 with outliers)";
        }
        showSuccess(`Dropped ${resp.rows_affected.toLocaleString()} outlier row(s). ${resp.rows_after.toLocaleString()} remain.`);
        onClean();
      }
    } else {
      showError(resp.message || "Outlier handling failed.");
    }
  });

  return card;
}

// ── Log-transform card ────────────────────────────────────────────────────────

const LOG_SKEW_THRESHOLD = 1.0;

function _buildTransformCard(stats, onClean) {
  const card = el("div", { cls: "cleaning-item-card" });

  // Collect columns with |skew| > threshold
  const skewedCols = Object.entries(stats)
    .filter(([, s]) => s.skew !== null && s.skew !== undefined && Math.abs(s.skew) > LOG_SKEW_THRESHOLD)
    .sort((a, b) => Math.abs(b[1].skew) - Math.abs(a[1].skew));

  const badge = skewedCols.length > 0
    ? `<span class="cleaning-badge cleaning-badge--warn">${skewedCols.length} column(s) with |skew| > ${LOG_SKEW_THRESHOLD}</span>`
    : `<span class="cleaning-badge cleaning-badge--ok">None detected</span>`;

  card.innerHTML = `
    <div class="cleaning-item-header">
      <span class="cleaning-item-title">Log-Transform (Skew)</span>
      ${badge}
    </div>
    <p class="cleaning-item-desc">Columns with high skewness can bias model training. log(1+x) compresses the tail.</p>
  `;


  if (skewedCols.length === 0) {
    card.appendChild(el("p", { cls: "cleaning-item-none", text: "No action needed." }));
    return card;
  }

  const colList = el("div", { cls: "cleaning-transform-columns" });
  for (const [col, s] of skewedCols) {
    const item  = el("div", { cls: "cleaning-transform-col-item" });
    const skewLabel = s.skew >= 0 ? `+${s.skew.toFixed(2)}` : s.skew.toFixed(2);
    item.innerHTML = `
      <label class="cleaning-transform-col-label">
        <input type="checkbox" class="cleaning-transform-col-check" value="${col}" checked>
        <span class="cleaning-transform-col-name">${col}</span>
        <span class="cleaning-transform-col-skew">skew ${skewLabel}</span>
      </label>
    `;
    colList.appendChild(item);
  }
  card.appendChild(colList);

  const applyBtn = el("button", {
    cls:  "btn btn-primary btn-sm cleaning-apply-btn",
    text: "Apply log-transform",
    id:   "transform-apply-btn",
  });
  card.appendChild(applyBtn);

  applyBtn.addEventListener("click", async () => {
    const checked = [...card.querySelectorAll(".cleaning-transform-col-check:checked")]
      .map(cb => cb.value);
    if (checked.length === 0) {
      showWarning("Select at least one column to transform.");
      return;
    }
    applyBtn.disabled = true;
    const resp = await post("/api/data/clean/transform", { columns: checked });
    applyBtn.disabled = false;
    if (resp.success) {
      showSuccess(`Applied log-transform to ${resp.n_columns} column(s): ${resp.columns_transformed.join(", ")}.`);
      _recordOp(`Log-transform (${resp.n_columns} col${resp.n_columns !== 1 ? "s" : ""})`, 0, _currentRows);
      onClean();
    } else {
      showError(resp.message || "Log-transform failed.");
    }
  });

  return card;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function _buildStrategySelect(id, strategies) {
  const wrap = el("div", { cls: "cleaning-strategy-wrap" });
  const sel  = el("select", { cls: "cleaning-strategy-select", id });

  for (const s of strategies) {
    const opt      = document.createElement("option");
    opt.value      = s.value;
    opt.textContent = s.label;
    opt.title       = s.desc;
    sel.appendChild(opt);
  }

  wrap.appendChild(sel);
  return wrap;
}
