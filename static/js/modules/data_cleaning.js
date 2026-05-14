// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/data_cleaning.js
// Version: 0.8.9
// Description: Data cleaning step — lets users handle missing values, remove
//              duplicates, and flag/drop outliers before column designation.
//              Sends POST /api/data/clean/* endpoints. Calls onClean() after
//              each successful operation so the exploration view can refresh.
// =============================================================================

import { get, post } from "../api.js";
import { showError, showSuccess, showWarning } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { registerPrimer } from "../learning_mode.js";
import { el, clearEl } from "../utils.js";

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

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Step 3 — Data Cleaning</h2>
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
     <p><strong>Undo</strong> resets to the originally uploaded data at any time.</p>`
  );

  // ── Cleaning cards ───────────────────────────────────────────────────────────
  const grid = el("div", { cls: "cleaning-grid" });
  containerEl.appendChild(grid);

  grid.appendChild(_buildNullCard(cs.null_rows, nRows, onClean));
  grid.appendChild(_buildDuplicatesCard(cs.duplicate_rows, onClean));
  grid.appendChild(_buildOutlierCard(cs.outlier_rows, nRows, onClean));
  grid.appendChild(_buildTransformCard(summaryResp.stats || {}, onClean));

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
      onClean();
    } else {
      showError(resp.message || "Reset failed.");
    }
  });
}

// ── Null card ─────────────────────────────────────────────────────────────────

function _buildNullCard(nullRows, nRows, onClean) {
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
      const msg = strategy === "drop_rows"
        ? `Dropped ${resp.rows_affected.toLocaleString()} row(s). ${resp.rows_after.toLocaleString()} remain.`
        : `Imputed ${resp.rows_affected.toLocaleString()} row(s) using ${strategy === "mean_impute" ? "mean" : "median"}.`;
      showSuccess(msg);
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
        onClean();
      }
    } else {
      showError(resp.message || "Deduplication failed.");
    }
  });

  return card;
}

// ── Outlier card ──────────────────────────────────────────────────────────────

function _buildOutlierCard(outlierRows, nRows, onClean) {
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
    <p class="cleaning-item-desc">Rows with at least one value outside Q1 − 1.5×IQR or Q3 + 1.5×IQR.</p>
  `;

  const strategies = [
    { value: "keep",      label: "Keep (flag only)", desc: "Outliers remain in the data. They are highlighted in the scatter matrix but not removed." },
    { value: "drop_rows", label: "Drop outlier rows", desc: "Removes every row that contains an IQR outlier in any column." },
  ];

  const stratSel = _buildStrategySelect("outlier-strategy", strategies);
  card.appendChild(stratSel);

  const applyBtn = el("button", {
    cls:  "btn btn-primary btn-sm cleaning-apply-btn",
    text: "Apply",
    id:   "outlier-apply-btn",
  });
  card.appendChild(applyBtn);

  applyBtn.addEventListener("click", async () => {
    const strategy = card.querySelector("#outlier-strategy").value;
    applyBtn.disabled = true;
    const resp = await post("/api/data/clean/outliers", { strategy });
    applyBtn.disabled = false;
    if (resp.success) {
      if (strategy === "keep") {
        showSuccess("Outliers flagged. No rows were removed.");
      } else {
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

  registerPrimer(
    "cleaning_logtransform",
    card.querySelector(".cleaning-item-title"),
    "What is skewness, and when should I log-transform?",
    `<p><strong>Skewness</strong> means most values cluster at one end with a long tail stretching
     the other way — for example, a few very large values pulling the distribution right.
     Surrogate models trained on skewed data can over-fit the tail region and perform poorly
     across the rest of the range.</p>
     <p><strong>log(1 + x)</strong> compresses large values and spreads small ones, making the
     distribution more symmetric. The <em>+1</em> ensures log(0) is safe — the result is 0
     rather than undefined.</p>
     <p><strong>When not to use it:</strong> if a column contains negative values, adding 1 may
     not be enough to make all values positive, and the transform will fail or produce
     misleading results. Check the column's minimum value before applying.</p>`
  );

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
