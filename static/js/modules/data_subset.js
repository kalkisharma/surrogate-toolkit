// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/data_subset.js
// Version: 1.0.0
// Description: Step 5 — Subset. Per-column range filters that permanently
//              slice the clean DataFrame via POST /api/data/subset. Excluded
//              points are shown dimmed in a live 2D scatter preview so the user
//              can see what they are about to remove before committing.
// =============================================================================

import { renderDataScatter2D } from "../charts.js";
import { get, post } from "../api.js";
import { showSuccess, showError, showWarning } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { el, clearEl } from "../utils.js";

export async function initSubset(containerEl) {
  clearEl(containerEl);

  // ── Fetch current clean data ───────────────────────────────────────────────
  const [summaryResp, rowsResp] = await Promise.all([
    get("/api/data/summary"),
    get("/api/data/rows"),
  ]);

  if (!summaryResp.success || !rowsResp.success) {
    showError("Failed to load dataset for Subset step.");
    return;
  }

  const stats     = summaryResp.stats   || {};
  const allCols   = summaryResp.columns || [];
  const rows      = rowsResp.rows       || [];
  const totalRows = summaryResp.n_rows;

  // Only numeric columns with a non-trivial range can be filtered
  const numericCols = allCols.filter(col => {
    const s = stats[col];
    return s && s.min != null && s.max != null && s.min !== s.max;
  });

  // Per-column limits, step size, and decimal precision
  const colMins = {}, colMaxs = {}, colStep = {}, colDec = {};
  for (const col of numericCols) {
    colMins[col] = stats[col].min;
    colMaxs[col] = stats[col].max;
    const range  = colMaxs[col] - colMins[col];
    colStep[col] = range / 500 || 0.0001;
    const s      = colStep[col];
    colDec[col]  = s < 0.01 ? 4 : s < 0.1 ? 3 : s < 1 ? 2 : 1;
  }

  // Active filter state — starts at full range per column
  const filterRanges = {};
  for (const col of numericCols) filterRanges[col] = [colMins[col], colMaxs[col]];

  // ── Card ───────────────────────────────────────────────────────────────────
  const card = el("div", { cls: "card" });

  const titleRow = el("div", { cls: "subset-title-row" });
  const titleEl  = el("h3", { cls: "section-title", text: "Step 5 — Subset" });

  const rowCountEl = el("span", { cls: "subset-row-count" });
  rowCountEl.textContent = `${totalRows.toLocaleString()} rows`;

  titleRow.appendChild(titleEl);
  titleRow.appendChild(rowCountEl);
  card.appendChild(titleRow);

  const descEl = el("p", { cls: "section-desc" });
  descEl.textContent =
    "Set per-column value ranges to keep only the rows you want. "
    + "All conditions apply simultaneously (AND logic). "
    + "Click Commit to permanently apply the subset to the dataset.";
  card.appendChild(descEl);

  containerEl.appendChild(card);

  // ── Commit status bar (hidden until first commit) ─────────────────────────
  const statusBar = el("div", { cls: "subset-status hidden" });
  card.appendChild(statusBar);

  // ── Filter section ────────────────────────────────────────────────────────
  const filterSection = el("div", { cls: "subset-filter-section" });

  const filterHeader = el("div", { cls: "subset-filter-header" });
  const filterTitle  = el("span", { cls: "subset-filter-title", text: "Range Filters" });
  const previewCount = el("span", { cls: "subset-preview-count" });
  previewCount.textContent = `Would keep: ${totalRows.toLocaleString()} / ${totalRows.toLocaleString()} rows`;

  const resetAllBtn = el("button", {
    cls: "btn btn--ghost btn--sm", type: "button", text: "Reset All",
  });

  filterHeader.appendChild(filterTitle);
  filterHeader.appendChild(previewCount);
  filterHeader.appendChild(resetAllBtn);
  filterSection.appendChild(filterHeader);

  const filterGrid = el("div", { cls: "scatter2d-filter-grid subset-filter-grid" });
  filterSection.appendChild(filterGrid);
  card.appendChild(filterSection);

  // ── 2D scatter preview ────────────────────────────────────────────────────
  let chartEl = null;
  let xCol = numericCols[0] || null;
  let yCol = numericCols[1] || numericCols[0] || null;

  if (numericCols.length >= 2) {
    const previewSection = el("div", { cls: "subset-preview-section" });

    const previewHeader = el("div", { cls: "subset-preview-header" });
    const previewTitle  = el("span", { cls: "subset-filter-title", text: "Live Preview" });

    const axesRow = el("div", { cls: "subset-axes-row" });
    const xLabel  = el("label", { cls: "subset-axis-label", text: "X" });
    const xSel    = el("select", { cls: "explore-select subset-axis-sel" });
    xSel.id = "subset-x-sel";
    const yLabel  = el("label", { cls: "subset-axis-label", text: "Y" });
    const ySel    = el("select", { cls: "explore-select subset-axis-sel" });
    ySel.id = "subset-y-sel";

    for (const col of numericCols) {
      xSel.appendChild(new Option(col, col));
      ySel.appendChild(new Option(col, col));
    }
    if (numericCols[1]) ySel.value = numericCols[1];

    axesRow.appendChild(xLabel);
    axesRow.appendChild(xSel);
    axesRow.appendChild(yLabel);
    axesRow.appendChild(ySel);

    previewHeader.appendChild(previewTitle);
    previewHeader.appendChild(axesRow);
    previewSection.appendChild(previewHeader);

    chartEl = el("div", { cls: "subset-chart" });
    previewSection.appendChild(chartEl);
    card.appendChild(previewSection);

    xSel.addEventListener("change", () => { xCol = xSel.value; _drawPreview(); });
    ySel.addEventListener("change", () => { yCol = ySel.value; _drawPreview(); });
  }

  // ── Action row ─────────────────────────────────────────────────────────────
  const actionRow = el("div", { cls: "subset-action-row" });
  const commitBtn = el("button", { cls: "btn btn--primary", type: "button", text: "Commit Subset" });
  const undoBtn   = el("button", { cls: "btn btn--ghost",   type: "button", text: "Undo" });
  actionRow.appendChild(commitBtn);
  actionRow.appendChild(undoBtn);
  card.appendChild(actionRow);

  // ── Build one filter card per numeric column ───────────────────────────────
  function _clamp(v, mn, mx) { return Math.min(Math.max(v, mn), mx); }

  for (const col of numericCols) {
    const lo   = colMins[col];
    const hi   = colMaxs[col];
    const step = colStep[col];
    const dec  = colDec[col];

    const cardEl   = el("div", { cls: "scatter2d-filter-item" });
    const hdrEl    = el("div", { cls: "scatter2d-filter-item-header" });
    const lblEl    = el("span", { cls: "scatter2d-filter-item-label" });
    lblEl.textContent = col;
    lblEl.title       = col;
    const rstBtn = el("button", { cls: "scatter2d-filter-reset", type: "button", text: "↺" });
    rstBtn.title = "Reset to full range";
    hdrEl.appendChild(lblEl);
    hdrEl.appendChild(rstBtn);

    const ctrlsEl = el("div", { cls: "scatter2d-filter-controls" });
    const uid = col.replace(/[^a-z0-9]/gi, "_");
    ctrlsEl.innerHTML = `
      <input type="number" class="scatter2d-num" id="sub-nlo-${uid}"
             min="${lo}" max="${hi}" step="${step}" value="${lo.toFixed(dec)}">
      <input type="range" class="scatter2d-slider" id="sub-slo-${uid}"
             min="${lo}" max="${hi}" step="${step}" value="${lo}">
      <input type="range" class="scatter2d-slider" id="sub-shi-${uid}"
             min="${lo}" max="${hi}" step="${step}" value="${hi}">
      <input type="number" class="scatter2d-num" id="sub-nhi-${uid}"
             min="${lo}" max="${hi}" step="${step}" value="${hi.toFixed(dec)}">
    `;

    cardEl.appendChild(hdrEl);
    cardEl.appendChild(ctrlsEl);
    filterGrid.appendChild(cardEl);

    const nLo = ctrlsEl.querySelector(`#sub-nlo-${uid}`);
    const nHi = ctrlsEl.querySelector(`#sub-nhi-${uid}`);
    const sLo = ctrlsEl.querySelector(`#sub-slo-${uid}`);
    const sHi = ctrlsEl.querySelector(`#sub-shi-${uid}`);

    // Capture loop variables in closure
    const _sync = (newLo, newHi) => {
      newLo = _clamp(newLo, colMins[col], colMaxs[col]);
      newHi = _clamp(newHi, colMins[col], colMaxs[col]);
      if (newLo > newHi) newLo = newHi;
      filterRanges[col] = [newLo, newHi];
      sLo.value = newLo;    sHi.value = newHi;
      nLo.value = newLo.toFixed(colDec[col]);
      nHi.value = newHi.toFixed(colDec[col]);
      _updatePreviewCount();
      _drawPreview();
    };

    sLo.addEventListener("input",  () => _sync(parseFloat(sLo.value), filterRanges[col][1]));
    sHi.addEventListener("input",  () => _sync(filterRanges[col][0],  parseFloat(sHi.value)));
    nLo.addEventListener("change", () => _sync(parseFloat(nLo.value), filterRanges[col][1]));
    nHi.addEventListener("change", () => _sync(filterRanges[col][0],  parseFloat(nHi.value)));
    rstBtn.addEventListener("click", () => _sync(colMins[col], colMaxs[col]));
  }

  resetAllBtn.addEventListener("click", () => {
    for (const col of numericCols) {
      filterRanges[col] = [colMins[col], colMaxs[col]];
      const uid = col.replace(/[^a-z0-9]/gi, "_");
      const sLo = filterGrid.querySelector(`#sub-slo-${uid}`);
      const sHi = filterGrid.querySelector(`#sub-shi-${uid}`);
      const nLo = filterGrid.querySelector(`#sub-nlo-${uid}`);
      const nHi = filterGrid.querySelector(`#sub-nhi-${uid}`);
      if (sLo) { sLo.value = colMins[col]; sHi.value = colMaxs[col]; }
      if (nLo) {
        nLo.value = colMins[col].toFixed(colDec[col]);
        nHi.value = colMaxs[col].toFixed(colDec[col]);
      }
    }
    _updatePreviewCount();
    _drawPreview();
  });

  // ── Preview helpers ────────────────────────────────────────────────────────
  function _countIncluded() {
    return rows.filter(row =>
      numericCols.every(col => {
        const v = row[col];
        if (v == null || !isFinite(v)) return true;   // nulls pass through
        const [lo, hi] = filterRanges[col];
        return v >= lo && v <= hi;
      })
    ).length;
  }

  function _activeFilters() {
    const active = {};
    for (const [col, [lo, hi]] of Object.entries(filterRanges)) {
      if (lo > colMins[col] || hi < colMaxs[col]) active[col] = [lo, hi];
    }
    return active;
  }

  function _updatePreviewCount() {
    const kept  = _countIncluded();
    const total = rows.length;
    previewCount.textContent = `Would keep: ${kept.toLocaleString()} / ${total.toLocaleString()} rows`;
    previewCount.classList.toggle("subset-preview-count--warn", total > 0 && kept / total < 0.1);
  }

  function _drawPreview() {
    if (!chartEl || !xCol || !yCol) return;
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    renderDataScatter2D(chartEl, rows, {
      xCol,
      yCol,
      filterRanges: _activeFilters(),
      height: 340,
      fontSize: 11, tickFontSize: 9, titleFontSize: 12,
      markerSize: 6,
      markerColor: isDark ? "#818cf8" : "#3b5dd9",
      includedOpacity: 0.75,
      excludedOpacity: 0.12,
    });
  }

  // Re-render on theme toggle
  const _themeHandler = () => _drawPreview();
  document.addEventListener("theme:changed", _themeHandler);

  // ── Commit ─────────────────────────────────────────────────────────────────
  commitBtn.addEventListener("click", async () => {
    const conditions = {};
    for (const col of numericCols) {
      const [lo, hi] = filterRanges[col];
      if (lo > colMins[col] || hi < colMaxs[col]) {
        conditions[col] = { lo, hi };
      }
    }

    if (Object.keys(conditions).length === 0) {
      showWarning(
        "No filters applied — all rows would be kept. "
        + "Adjust at least one range before committing."
      );
      return;
    }

    showSpinner("Applying subset…");
    const resp = await post("/api/data/subset", { conditions });
    hideSpinner();

    if (!resp.success) {
      showError(resp.message || "Subset failed.");
      return;
    }

    showSuccess(
      `Subset applied — kept ${resp.rows_after.toLocaleString()} of `
      + `${resp.rows_before.toLocaleString()} rows.`
    );

    if (resp.zero_variance_columns?.length) {
      showWarning(
        `Zero-variance columns after subset: ${resp.zero_variance_columns.join(", ")}. `
        + "Consider removing them in Filter."
      );
    }

    rowCountEl.textContent = `${resp.rows_after.toLocaleString()} rows (subset active)`;
    rowCountEl.classList.add("subset-row-count--active");

    statusBar.classList.remove("hidden");
    statusBar.innerHTML =
      `<span class="subset-status-icon">&#x2713;</span> `
      + `Subset committed — ${resp.rows_removed.toLocaleString()} rows removed.`
      + (resp.zero_variance_columns?.length
        ? ` <span class="subset-status-warn">Zero-variance: ${resp.zero_variance_columns.join(", ")}</span>`
        : "");

    // Notify main.js to invalidate explore/clean panels
    containerEl.dispatchEvent(new CustomEvent("subset:committed", {
      bubbles: true,
      detail: { rows_after: resp.rows_after, rows_before: resp.rows_before },
    }));
  });

  // ── Undo ───────────────────────────────────────────────────────────────────
  undoBtn.addEventListener("click", async () => {
    showSpinner("Undoing subset…");
    const resp = await post("/api/data/subset/undo", {});
    hideSpinner();

    if (!resp.success) {
      showError(resp.message || "Undo failed.");
      return;
    }

    document.removeEventListener("theme:changed", _themeHandler);
    showSuccess(`Subset undone — restored ${resp.rows_restored.toLocaleString()} rows.`);
    await initSubset(containerEl);
  });

  // ── Initial render ─────────────────────────────────────────────────────────
  _updatePreviewCount();
  _drawPreview();
}
