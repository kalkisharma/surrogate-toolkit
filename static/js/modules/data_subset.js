// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/data_subset.js
// Version: 1.1.0
// Description: Step 5 — Subset. Per-column range filters that permanently
//              slice the clean DataFrame via POST /api/data/subset. Excluded
//              points are shown dimmed in a live 2D scatter preview. Settings
//              panel mirrors the Explore 2D scatter controls.
// =============================================================================

import { renderDataScatter2D } from "../charts.js";
import { get, post } from "../api.js";
import { showSuccess, showError, showWarning } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { el, clearEl } from "../utils.js";

const _S2D_KEY      = "surrogate_subset_scatter_settings";
const _S2D_DEFAULTS = {
  markerSize:       6,
  markerColor:      "#3b5dd9",
  edgeColor:        "#000000",
  edgeWidth:        0,
  includedOpacity:  0.75,
  excludedOpacity:  0.12,
  height:           340,
  showMajorGrid:    true,
  majorGridColor:   "#cccccc",
  majorGridOpacity: 1.0,
  showMinorGrid:    false,
  minorGridColor:   "#e0e0e0",
  minorGridOpacity: 0.6,
};

function _loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(_S2D_KEY) || "{}");
    return { ..._S2D_DEFAULTS, ...s };
  } catch { return { ..._S2D_DEFAULTS }; }
}
function _saveSettings(s) {
  try { localStorage.setItem(_S2D_KEY, JSON.stringify(s)); } catch {}
}

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

  const numericCols = allCols.filter(col => {
    const s = stats[col];
    return s && s.min != null && s.max != null && s.min !== s.max;
  });

  const colMins = {}, colMaxs = {}, colStep = {}, colDec = {};
  for (const col of numericCols) {
    colMins[col] = stats[col].min;
    colMaxs[col] = stats[col].max;
    const range  = colMaxs[col] - colMins[col];
    colStep[col] = range / 500 || 0.0001;
    const s      = colStep[col];
    colDec[col]  = s < 0.01 ? 4 : s < 0.1 ? 3 : s < 1 ? 2 : 1;
  }

  const filterRanges = {};
  for (const col of numericCols) filterRanges[col] = [colMins[col], colMaxs[col]];

  let s2d = _loadSettings();

  // ── Card ───────────────────────────────────────────────────────────────────
  const card = el("div", { cls: "card" });

  // Title row
  const titleRow   = el("div", { cls: "subset-title-row" });
  const titleEl    = el("h3", { cls: "section-title", text: "Step 5 — Subset" });
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

  // ── Filter section ────────────────────────────────────────────────────────
  const filterSection = el("div", { cls: "subset-filter-section" });

  const filterHeader  = el("div", { cls: "subset-filter-header" });
  const filterTitle   = el("span", { cls: "subset-filter-title", text: "Range Filters" });
  const previewCount  = el("span", { cls: "subset-preview-count" });
  previewCount.textContent = `Would keep: ${totalRows.toLocaleString()} / ${totalRows.toLocaleString()} rows`;
  const resetAllBtn   = el("button", { cls: "btn btn--ghost btn--sm", type: "button", text: "Reset All" });

  filterHeader.appendChild(filterTitle);
  filterHeader.appendChild(previewCount);
  filterHeader.appendChild(resetAllBtn);
  filterSection.appendChild(filterHeader);

  const filterList = el("div", { cls: "subset-filter-list" });
  filterSection.appendChild(filterList);
  card.appendChild(filterSection);

  // ── 2D scatter preview ────────────────────────────────────────────────────
  let chartEl = null;
  let xCol = numericCols[0] || null;
  let yCol = numericCols[1] || numericCols[0] || null;

  if (numericCols.length >= 2) {
    const previewSection = el("div", { cls: "subset-preview-section" });

    // Settings panel
    const settingsDetails = el("details", { cls: "subset-settings-panel" });
    const settingsSummary = el("summary", { cls: "subset-settings-summary", text: "Chart Settings" });
    settingsDetails.appendChild(settingsSummary);

    const settingsGrid = el("div", { cls: "subset-settings-grid" });

    function _settingRow(label, inputEl) {
      const row = el("div", { cls: "subset-settings-row" });
      const lbl = el("label", { cls: "subset-settings-label", text: label });
      row.appendChild(lbl);
      row.appendChild(inputEl);
      return row;
    }
    function _num(id, val, mn, mx, step) {
      const inp = el("input");
      inp.type = "number"; inp.id = id; inp.className = "subset-settings-input";
      inp.value = val; inp.min = mn; inp.max = mx; inp.step = step;
      return inp;
    }
    function _color(id, val) {
      const inp = el("input");
      inp.type = "color"; inp.id = id; inp.className = "subset-settings-color";
      inp.value = val;
      return inp;
    }
    function _chk(id, checked) {
      const inp = el("input");
      inp.type = "checkbox"; inp.id = id; inp.checked = checked;
      return inp;
    }

    const inpMarkerSize      = _num("ss-marker-size",     s2d.markerSize,       2, 20, 1);
    const inpMarkerColor     = _color("ss-marker-color",  s2d.markerColor);
    const inpEdgeWidth       = _num("ss-edge-width",      s2d.edgeWidth,        0, 5,  0.5);
    const inpEdgeColor       = _color("ss-edge-color",    s2d.edgeColor);
    const inpIncOpacity      = _num("ss-inc-opacity",     s2d.includedOpacity,  0, 1,  0.05);
    const inpExcOpacity      = _num("ss-exc-opacity",     s2d.excludedOpacity,  0, 1,  0.05);
    const inpHeight          = _num("ss-height",          s2d.height,           200, 800, 20);
    const inpMajorGrid       = _chk("ss-major-grid",      s2d.showMajorGrid);
    const inpMajorGridColor  = _color("ss-major-grid-color", s2d.majorGridColor);
    const inpMinorGrid       = _chk("ss-minor-grid",      s2d.showMinorGrid);
    const inpMinorGridColor  = _color("ss-minor-grid-color", s2d.minorGridColor);

    settingsGrid.appendChild(_settingRow("Marker size",        inpMarkerSize));
    settingsGrid.appendChild(_settingRow("Marker color",       inpMarkerColor));
    settingsGrid.appendChild(_settingRow("Edge width",         inpEdgeWidth));
    settingsGrid.appendChild(_settingRow("Edge color",         inpEdgeColor));
    settingsGrid.appendChild(_settingRow("Included opacity",   inpIncOpacity));
    settingsGrid.appendChild(_settingRow("Excluded opacity",   inpExcOpacity));
    settingsGrid.appendChild(_settingRow("Height (px)",        inpHeight));
    settingsGrid.appendChild(_settingRow("Major grid",         inpMajorGrid));
    settingsGrid.appendChild(_settingRow("Major grid color",   inpMajorGridColor));
    settingsGrid.appendChild(_settingRow("Minor grid",         inpMinorGrid));
    settingsGrid.appendChild(_settingRow("Minor grid color",   inpMinorGridColor));

    settingsDetails.appendChild(settingsGrid);
    previewSection.appendChild(settingsDetails);

    // Axis selectors
    const previewHeader = el("div", { cls: "subset-preview-header" });
    const previewTitle  = el("span", { cls: "subset-filter-title", text: "Live Preview" });
    const axesRow = el("div", { cls: "subset-axes-row" });
    const xLabel  = el("label", { cls: "subset-axis-label", text: "X" });
    const xSel    = el("select", { cls: "explore-select subset-axis-sel" });
    const yLabel  = el("label", { cls: "subset-axis-label", text: "Y" });
    const ySel    = el("select", { cls: "explore-select subset-axis-sel" });
    for (const col of numericCols) {
      xSel.appendChild(new Option(col, col));
      ySel.appendChild(new Option(col, col));
    }
    if (numericCols[1]) ySel.value = numericCols[1];
    axesRow.appendChild(xLabel); axesRow.appendChild(xSel);
    axesRow.appendChild(yLabel); axesRow.appendChild(ySel);
    previewHeader.appendChild(previewTitle);
    previewHeader.appendChild(axesRow);
    previewSection.appendChild(previewHeader);

    chartEl = el("div", { cls: "subset-chart" });
    previewSection.appendChild(chartEl);
    card.appendChild(previewSection);

    xSel.addEventListener("change", () => { xCol = xSel.value; _drawPreview(); });
    ySel.addEventListener("change", () => { yCol = ySel.value; _drawPreview(); });

    // Settings change wiring
    function _onSettingsChange() {
      s2d = {
        ...s2d,
        markerSize:       parseFloat(inpMarkerSize.value)     || _S2D_DEFAULTS.markerSize,
        markerColor:      inpMarkerColor.value,
        edgeWidth:        parseFloat(inpEdgeWidth.value)      || 0,
        edgeColor:        inpEdgeColor.value,
        includedOpacity:  parseFloat(inpIncOpacity.value)     || _S2D_DEFAULTS.includedOpacity,
        excludedOpacity:  parseFloat(inpExcOpacity.value)     || _S2D_DEFAULTS.excludedOpacity,
        height:           parseInt(inpHeight.value)           || _S2D_DEFAULTS.height,
        showMajorGrid:    inpMajorGrid.checked,
        majorGridColor:   inpMajorGridColor.value,
        showMinorGrid:    inpMinorGrid.checked,
        minorGridColor:   inpMinorGridColor.value,
      };
      _saveSettings(s2d);
      _drawPreview();
    }
    for (const inp of [inpMarkerSize, inpMarkerColor, inpEdgeWidth, inpEdgeColor,
                        inpIncOpacity, inpExcOpacity, inpHeight,
                        inpMajorGrid, inpMajorGridColor, inpMinorGrid, inpMinorGridColor]) {
      inp.addEventListener("input",  _onSettingsChange);
      inp.addEventListener("change", _onSettingsChange);
    }
  }

  // ── Action row + status bar ────────────────────────────────────────────────
  const actionRow = el("div", { cls: "subset-action-row" });
  const commitBtn = el("button", { cls: "btn btn--primary", type: "button", text: "Commit Subset" });
  const undoBtn   = el("button", { cls: "btn btn--ghost",   type: "button", text: "Undo" });
  undoBtn.disabled = true;
  actionRow.appendChild(commitBtn);
  actionRow.appendChild(undoBtn);
  card.appendChild(actionRow);

  // Status bar lives BELOW the action row so it appears near the commit button
  const statusBar = el("div", { cls: "subset-status hidden" });
  card.appendChild(statusBar);

  // ── Build one filter row per numeric column ────────────────────────────────
  function _clamp(v, mn, mx) { return Math.min(Math.max(v, mn), mx); }

  for (const col of numericCols) {
    const lo   = colMins[col];
    const hi   = colMaxs[col];
    const step = colStep[col];
    const dec  = colDec[col];
    const uid  = col.replace(/[^a-z0-9]/gi, "_");

    const rowEl  = el("div", { cls: "subset-filter-row" });
    const hdrEl  = el("div", { cls: "subset-filter-row-header" });
    const lblEl  = el("span", { cls: "subset-filter-row-label" });
    lblEl.textContent = col; lblEl.title = col;
    const rstBtn = el("button", { cls: "subset-filter-reset-btn", type: "button", text: "↺" });
    rstBtn.title = "Reset to full range";
    hdrEl.appendChild(lblEl);
    hdrEl.appendChild(rstBtn);

    const ctrlsEl = el("div", { cls: "subset-filter-row-controls" });
    ctrlsEl.innerHTML = `
      <span class="subset-filter-val" id="sub-vlo-${uid}">${lo.toFixed(dec)}</span>
      <div class="subset-filter-sliders">
        <input type="range" class="subset-slider" id="sub-slo-${uid}"
               min="${lo}" max="${hi}" step="${step}" value="${lo}">
        <input type="range" class="subset-slider" id="sub-shi-${uid}"
               min="${lo}" max="${hi}" step="${step}" value="${hi}">
      </div>
      <span class="subset-filter-val subset-filter-val--right" id="sub-vhi-${uid}">${hi.toFixed(dec)}</span>
      <div class="subset-filter-num-pair">
        <input type="number" class="subset-num" id="sub-nlo-${uid}"
               min="${lo}" max="${hi}" step="${step}" value="${lo.toFixed(dec)}" aria-label="Min ${col}">
        <span class="subset-num-sep">–</span>
        <input type="number" class="subset-num" id="sub-nhi-${uid}"
               min="${lo}" max="${hi}" step="${step}" value="${hi.toFixed(dec)}" aria-label="Max ${col}">
      </div>
    `;

    rowEl.appendChild(hdrEl);
    rowEl.appendChild(ctrlsEl);
    filterList.appendChild(rowEl);

    const vLo = ctrlsEl.querySelector(`#sub-vlo-${uid}`);
    const vHi = ctrlsEl.querySelector(`#sub-vhi-${uid}`);
    const sLo = ctrlsEl.querySelector(`#sub-slo-${uid}`);
    const sHi = ctrlsEl.querySelector(`#sub-shi-${uid}`);
    const nLo = ctrlsEl.querySelector(`#sub-nlo-${uid}`);
    const nHi = ctrlsEl.querySelector(`#sub-nhi-${uid}`);

    const _sync = (newLo, newHi) => {
      newLo = _clamp(newLo, colMins[col], colMaxs[col]);
      newHi = _clamp(newHi, colMins[col], colMaxs[col]);
      if (newLo > newHi) newLo = newHi;
      filterRanges[col] = [newLo, newHi];
      const d = colDec[col];
      sLo.value = newLo;  sHi.value = newHi;
      nLo.value = newLo.toFixed(d); nHi.value = newHi.toFixed(d);
      vLo.textContent = newLo.toFixed(d); vHi.textContent = newHi.toFixed(d);
      const isActive = newLo > colMins[col] || newHi < colMaxs[col];
      rowEl.classList.toggle("subset-filter-row--active", isActive);
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
      const row = filterList.querySelector(`#sub-slo-${uid}`)?.closest(".subset-filter-row");
      const sLo = filterList.querySelector(`#sub-slo-${uid}`);
      const sHi = filterList.querySelector(`#sub-shi-${uid}`);
      const nLo = filterList.querySelector(`#sub-nlo-${uid}`);
      const nHi = filterList.querySelector(`#sub-nhi-${uid}`);
      const vLo = filterList.querySelector(`#sub-vlo-${uid}`);
      const vHi = filterList.querySelector(`#sub-vhi-${uid}`);
      const d = colDec[col];
      if (sLo) { sLo.value = colMins[col]; sHi.value = colMaxs[col]; }
      if (nLo) { nLo.value = colMins[col].toFixed(d); nHi.value = colMaxs[col].toFixed(d); }
      if (vLo) { vLo.textContent = colMins[col].toFixed(d); vHi.textContent = colMaxs[col].toFixed(d); }
      if (row) row.classList.remove("subset-filter-row--active");
    }
    _updatePreviewCount();
    _drawPreview();
  });

  // ── Preview helpers ────────────────────────────────────────────────────────
  function _activeFilters() {
    const active = {};
    for (const [col, [lo, hi]] of Object.entries(filterRanges)) {
      if (lo > colMins[col] || hi < colMaxs[col]) active[col] = [lo, hi];
    }
    return active;
  }

  function _countIncluded() {
    const af = _activeFilters();
    if (Object.keys(af).length === 0) return rows.length;
    return rows.filter(row =>
      Object.entries(af).every(([col, [lo, hi]]) => {
        const v = row[col];
        if (v == null || !isFinite(v)) return true;
        return v >= lo && v <= hi;
      })
    ).length;
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
      height:           s2d.height,
      markerSize:       s2d.markerSize,
      markerColor:      isDark ? "#818cf8" : s2d.markerColor,
      edgeColor:        s2d.edgeColor,
      edgeWidth:        s2d.edgeWidth,
      includedOpacity:  s2d.includedOpacity,
      excludedOpacity:  s2d.excludedOpacity,
      showMajorGrid:    s2d.showMajorGrid,
      majorGridColor:   s2d.majorGridColor,
      majorGridOpacity: s2d.majorGridOpacity,
      showMinorGrid:    s2d.showMinorGrid,
      minorGridColor:   s2d.minorGridColor,
      minorGridOpacity: s2d.minorGridOpacity,
    });
  }

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

    // ── Update UI ───────────────────────────────────────────────────────────
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

    // Status bar below the commit button
    statusBar.innerHTML =
      `<span class="subset-status-icon">&#x2713;</span> `
      + `Subset committed — ${resp.rows_removed.toLocaleString()} rows removed, `
      + `${resp.rows_after.toLocaleString()} rows remain.`
      + (resp.zero_variance_columns?.length
        ? ` <span class="subset-status-warn">Zero-variance: ${resp.zero_variance_columns.join(", ")}</span>`
        : "");
    statusBar.classList.remove("hidden");

    undoBtn.disabled = false;

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
    containerEl.dispatchEvent(new CustomEvent("subset:undone", { bubbles: true }));
    await initSubset(containerEl);
  });

  // ── Initial render ─────────────────────────────────────────────────────────
  _updatePreviewCount();
  _drawPreview();
}
