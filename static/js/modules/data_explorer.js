// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/data_explorer.js
// Version: 1.6.0
// Description: Data exploration view — full-dataset scatter matrix, per-column
//              stats below chart, outlier overlay, expandable plot settings,
//              column distribution histograms, dCor heatmap, and 2D scatter.
// =============================================================================

import { renderScatterMatrix, renderDCorHeatmap, renderDataScatter2D, renderColumnHistogram, renderIOScatter } from "../charts.js";
import { registerPrimer, registerTooltip } from "../learning_mode.js";
import { mean, stdDev, median, skewness, detectOutliers, el, formatNum, clearEl } from "../utils.js";
import { get } from "../api.js";
import { showError } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";

let _currentRows      = [];
let _currentColumns   = [];
let _allColumns       = [];       // full column list before any selector filtering
let _selectedCols     = [];       // user-selected subset for SPLOM
let _outlierIndices   = new Set();
let _showOutliers     = false;
let _chartEl          = null;
let _fullStats        = null;
let _selectorRefreshFn  = null;   // set by _buildColumnSelector; used by updateColumnSelectorRoles
let _rerenderPending    = false;  // set when updateColumnSelectorRoles fires while panel is hidden
let _onPointClickCb     = null;   // set by initExploration; re-attached in _rerender via renderScatterMatrix

// Re-render on theme toggle so palette and font colors update immediately.
document.addEventListener("theme:changed", () => { if (_chartEl) _rerender(); });

// Handle browser window resize. Only fires when the chart is visible (offsetParent !== null)
// to avoid Plotly sizing the chart into a zero-width hidden container.
window.addEventListener("resize", () => {
  if (_chartEl && _chartEl.offsetParent !== null) {
    Plotly.Plots.resize(_chartEl);
  }
});

// ── Chart settings ────────────────────────────────────────────────────────────

const _SETTINGS_KEY = "surrogate_chart_settings";

const _DEFAULT_SETTINGS = {
  fontSize:          11,
  tickFontSize:      9,
  markerSize:        null,      // null = auto-scale by row count
  height:            null,      // null = auto-scale by column count
  maxWidth:          null,      // null = full (unconstrained)
  showMajorGrid:     true,
  showMinorGrid:     false,
  palette:           "blueRed",
  opacity:           0.8,
  edgeColor:         "#000000",
  edgeWidth:         0,
  fontColor:         null,      // null = auto (theme default)
  majorGridColor:    "#cccccc",
  majorGridOpacity:  1.0,
  minorGridColor:    "#e0e0e0",
  minorGridOpacity:  0.6,
  cellShading:       false,
  plotBgColor:       null,      // null = transparent (or cellShading tint)
  paperBgColor:      null,      // null = transparent
};

let _chartSettings = { ..._DEFAULT_SETTINGS };

function _loadSettings() {
  try {
    const saved = localStorage.getItem(_SETTINGS_KEY);
    if (saved) _chartSettings = { ..._DEFAULT_SETTINGS, ...JSON.parse(saved) };
  } catch (_) {
    _chartSettings = { ..._DEFAULT_SETTINGS };
  }
}

function _saveSettings() {
  localStorage.setItem(_SETTINGS_KEY, JSON.stringify(_chartSettings));
}

function _applyWidth() {
  if (!_chartEl) return;
  _chartEl.style.maxWidth = _chartSettings.maxWidth ? _chartSettings.maxWidth + "px" : "";
}

function _rerender() {
  if (!_chartEl || !_currentRows.length) return;
  const displayedCount = _currentColumns.length;
  const autoMarkerSize = Math.max(4, Math.min(8, 400 / _currentRows.length));
  const autoHeight     = Math.max(400, displayedCount * 90);
  const h = _chartSettings.height !== null ? _chartSettings.height : autoHeight;
  _chartEl.style.height = h + "px";
  _applyWidth();
  renderScatterMatrix(_chartEl, _currentColumns, _currentRows, {
    outlierIndices: _showOutliers ? _outlierIndices : new Set(),
    ..._chartSettings,
    markerSize:   _chartSettings.markerSize !== null ? _chartSettings.markerSize : autoMarkerSize,
    height:       _chartSettings.height     !== null ? _chartSettings.height     : autoHeight,
    onPointClick: _onPointClickCb,
  });
}

/**
 * Show a compact row-inspection card for the clicked SPLOM point.
 * Computes per-column IQR bounds to identify which columns pushed the row to outlier status.
 */
function _showRowInspector(rowIdx, rows, columns, inspectorEl) {
  clearEl(inspectorEl);
  const row = rows[rowIdx];
  if (!row) return;

  const isOutlier = _outlierIndices.has(rowIdx);

  // Which columns individually violate IQR for this row
  const outlierCols = new Set();
  for (const col of columns) {
    const vals = rows.map(r => r[col]).filter(v => v != null && isFinite(+v)).map(Number);
    if (vals.length < 4) continue;
    vals.sort((a, b) => a - b);
    const q1  = vals[Math.floor(vals.length * 0.25)];
    const q3  = vals[Math.floor(vals.length * 0.75)];
    const iqr = q3 - q1;
    if (iqr === 0) continue;
    const v = row[col];
    if (v != null && isFinite(+v) && (+v < q1 - 1.5 * iqr || +v > q3 + 1.5 * iqr)) {
      outlierCols.add(col);
    }
  }

  const card = el("div", { cls: "row-inspector-card" });

  // Header
  const hdr = el("div", { cls: "row-inspector-header" });
  const titleGroup = el("div", { cls: "row-inspector-title-group" });
  titleGroup.appendChild(el("span", { cls: "row-inspector-title", text: `Row ${rowIdx + 1} of ${rows.length}` }));
  if (isOutlier) titleGroup.appendChild(el("span", { cls: "row-inspector-badge", text: "Outlier" }));
  hdr.appendChild(titleGroup);
  const closeBtn = el("button", { cls: "row-inspector-close", type: "button" });
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => clearEl(inspectorEl));
  hdr.appendChild(closeBtn);
  card.appendChild(hdr);

  if (outlierCols.size > 0) {
    const note = el("p", { cls: "row-inspector-note" });
    note.textContent = `IQR violation in: ${[...outlierCols].join(", ")}`;
    card.appendChild(note);
  }

  const tableWrap = el("div", { cls: "row-inspector-table-wrap" });
  const table = el("table", { cls: "row-inspector-table" });
  const thead = el("thead");
  thead.innerHTML = "<tr><th>Column</th><th>Value</th></tr>";
  table.appendChild(thead);
  const tbody = el("tbody");

  for (const col of columns) {
    const val = row[col];
    const isOutCol = outlierCols.has(col);
    const tr = document.createElement("tr");
    if (isOutCol) tr.className = "row-inspector-row--outlier";

    const tdCol = document.createElement("td");
    tdCol.className = "row-inspector-col";
    tdCol.textContent = col;

    const tdVal = document.createElement("td");
    tdVal.className = "row-inspector-val";
    if (val == null) {
      tdVal.textContent = "—";
      tdVal.style.color = "var(--color-text-muted)";
    } else if (isFinite(+val)) {
      tdVal.textContent = formatNum(+val);
    } else {
      tdVal.textContent = String(val);
    }

    tr.appendChild(tdCol);
    tr.appendChild(tdVal);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  card.appendChild(tableWrap);
  inspectorEl.appendChild(card);
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/**
 * Initialise the data exploration view.
 *
 * @param {HTMLElement} containerEl - The view root element (inside #app).
 * @param {object} uploadResponse - The full response from POST /api/data/upload.
 */
export async function initExploration(containerEl, uploadResponse) {
  clearEl(containerEl);
  showSpinner(containerEl);

  _loadSettings();

  // Preview rows are the fallback; full rows are fetched below.
  const previewRows = uploadResponse.preview.rows;
  const columns     = uploadResponse.preview.columns;
  const totalRows   = uploadResponse.preview.total_rows;

  // ── Fetch full row data for SPLOM ─────────────────────────────────────────
  let plotRows  = previewRows;
  let truncated = false;
  let shownRows = previewRows.length;

  const rowsResp = await get("/api/data/rows");
  if (rowsResp.success && rowsResp.rows && rowsResp.rows.length > 0) {
    plotRows  = rowsResp.rows;
    truncated = rowsResp.truncated;
    shownRows = rowsResp.shown_rows;
  }

  // ── Fetch full-dataset summary stats ──────────────────────────────────────
  let usingFullStats = false;
  const summaryResp = await get("/api/data/summary");
  if (summaryResp.success && summaryResp.stats) {
    _fullStats    = summaryResp.stats;
    usingFullStats = true;
  }

  hideSpinner(containerEl);

  _allColumns = columns;

  const SPLOM_MAX = 12;
  // Preserve an existing valid selection; otherwise build a smart default.
  const prevValid = _selectedCols.length >= 2 && _selectedCols.every(c => columns.includes(c));
  if (!prevValid) {
    // Order: designated outputs first, then inputs, then remaining columns.
    const meta     = uploadResponse.metadata || {};
    const outCols  = (meta.output_columns || []).filter(c => columns.includes(c));
    const inCols   = (meta.input_columns  || []).filter(c => columns.includes(c));
    const rest     = columns.filter(c => !outCols.includes(c) && !inCols.includes(c));
    _selectedCols  = [...outCols, ...inCols, ...rest].slice(0, SPLOM_MAX);
  }
  _currentColumns = _selectedCols;

  _currentRows    = plotRows;
  _outlierIndices = detectOutliers(plotRows, _currentColumns);

  // Pre-compute auto values needed by the settings panel and initial render
  const displayedCount = _currentColumns.length;
  const autoMarkerSize = Math.max(4, Math.min(8, 400 / plotRows.length));
  const autoHeight     = Math.max(400, displayedCount * 90);

  // ── Header ────────────────────────────────────────────────────────────────
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Step 3 — Data Exploration</h2>
    <p class="section-desc">
      ${totalRows.toLocaleString()} rows × ${columns.length} columns
      — scatter matrix using ${shownRows.toLocaleString()} rows
    </p>
  `;
  containerEl.appendChild(header);

  registerPrimer(
    "explore",
    header,
    "What am I looking at? — Data exploration explained",
    `<p>The scatter plot matrix shows every pair of variables plotted against each other.
     Patterns here reveal correlations, clusters, and outliers before any model is trained.
     The stats section below the chart shows key summary statistics for each column.</p>
     <p><strong>Tip:</strong> Highly correlated column pairs (diagonal lines) may indicate
     redundant inputs — the Dimensionality Reduction step addresses this.</p>`
  );

  // ── Notices ───────────────────────────────────────────────────────────────
  if (truncated) {
    containerEl.appendChild(el("div", {
      cls: "limitation-notice",
      text: `Scatter matrix shows ${shownRows.toLocaleString()} of ${totalRows.toLocaleString()} rows (plot limit: 2,000). Full-dataset rendering is Phase 2.`,
    }));
  }

  if (!usingFullStats) {
    containerEl.appendChild(el("div", {
      cls: "limitation-notice",
      text: `Summary statistics computed from ${plotRows.length} rows. Full-dataset statistics will be available in Phase 2.`,
    }));
  }

  containerEl.appendChild(_buildColumnSelector(columns, () => {
    _currentColumns = _selectedCols;
    _outlierIndices = detectOutliers(plotRows, _currentColumns);
    _rerender();
  }));

  // ── Outlier controls ──────────────────────────────────────────────────────
  const controls = el("div", { cls: "explore-controls" });
  const outlierLabel    = el("label", { cls: "explore-controls__label" });
  const outlierCheckbox = el("input", { type: "checkbox", id: "outlier-toggle" });
  outlierLabel.appendChild(outlierCheckbox);
  outlierLabel.appendChild(document.createTextNode(" Show outliers (IQR)"));
  controls.appendChild(outlierLabel);

  registerTooltip(
    outlierLabel,
    "Toggle IQR-based outlier highlighting",
    "Outliers are points outside Q1 − 1.5×IQR or Q3 + 1.5×IQR for any column. Highlighted in red on the chart."
  );

  if (_outlierIndices.size > 0) {
    controls.appendChild(el("span", {
      cls: "text-muted text-sm",
      text: `${_outlierIndices.size} potential outlier row(s) detected`,
    }));
  }
  containerEl.appendChild(controls);

  // ── Plot settings panel ───────────────────────────────────────────────────
  const panelEl = _renderSettingsPanel(
    _chartSettings.markerSize !== null ? _chartSettings.markerSize : autoMarkerSize,
    _chartSettings.height     !== null ? _chartSettings.height     : autoHeight
  );
  containerEl.appendChild(panelEl);

  // ── Chart ─────────────────────────────────────────────────────────────────
  const chartWrap  = el("div", { cls: "explore-chart-wrap", id: "splom-container" });
  const chartInner = el("div");
  _chartEl = chartInner;
  chartWrap.appendChild(chartInner);
  containerEl.appendChild(chartWrap);

  // ── Row inspector (populated on SPLOM point click) ────────────────────────
  const rowInspectorEl = el("div", { cls: "row-inspector-wrap" });
  containerEl.appendChild(rowInspectorEl);
  _onPointClickCb = (rowIdx) => _showRowInspector(rowIdx, plotRows, _allColumns, rowInspectorEl);

  // ── Stats section (below chart) ───────────────────────────────────────────
  const statsEl = _buildStatsSection(_allColumns, plotRows, usingFullStats ? _fullStats : null, totalRows);
  containerEl.appendChild(statsEl);

  // ── Column Distributions (histograms) ────────────────────────────────────
  _buildHistogramSection(containerEl, plotRows, _allColumns);

  // ── Distance Correlation heatmap (lazy — fetched on first expand) ─────────
  containerEl.appendChild(_buildDCorSection());

  // ── 2D Scatter Plot ───────────────────────────────────────────────────────
  _buildScatter2DSection(containerEl, plotRows, columns);

  // ── Initial render ────────────────────────────────────────────────────────
  // Set height synchronously so the stats section below is positioned correctly.
  // Defer one frame so the browser commits layout before Plotly reads clientHeight.
  // Use _rerender() — it never calls Plotly.Plots.resize, which avoids a sizing
  // loop where Plotly reads the padded parent clientHeight instead of the element's
  // inline height and produces the wrong initial vertical size.
  chartInner.style.height = autoHeight + "px";
  _applyWidth();
  requestAnimationFrame(() => _rerender());

  // ── Event wiring ──────────────────────────────────────────────────────────
  outlierCheckbox.addEventListener("change", () => {
    _showOutliers = outlierCheckbox.checked;
    _rerender();
  });

  _wirePanelEvents(panelEl);
}

// ── Settings panel ────────────────────────────────────────────────────────────

function _renderSettingsPanel(currentMarkerSize, currentHeight) {
  const s = _chartSettings;

  const panel = document.createElement("details");
  panel.className = "chart-settings-panel";

  const edgeColorDisabled     = s.edgeWidth === 0   ? "disabled" : "";
  const edgeColorOpacity      = s.edgeWidth === 0   ? "0.4" : "1";
  const widthFull             = s.maxWidth === null;
  const fontColorAuto         = s.fontColor === null;
  const fontColorVal          = s.fontColor || "#4b5478";
  const fontColorDisabled     = fontColorAuto ? "disabled" : "";
  const fontColorOpacity      = fontColorAuto ? "0.4" : "1";
  const plotBgAuto            = s.plotBgColor === null;
  const plotBgVal             = s.plotBgColor || "#ffffff";
  const plotBgDisabled        = plotBgAuto ? "disabled" : "";
  const plotBgOpacity         = plotBgAuto ? "0.4" : "1";
  const paperBgAuto           = s.paperBgColor === null;
  const paperBgVal            = s.paperBgColor || "#f5f6fa";
  const paperBgDisabled       = paperBgAuto ? "disabled" : "";
  const paperBgOpacity        = paperBgAuto ? "0.4" : "1";

  panel.innerHTML = `
    <summary class="chart-settings-panel__summary">Plot Settings</summary>
    <div class="chart-settings-controls">

      <div class="settings-divider">Typography</div>

      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="cs-font-size">Label font (px)</label>
        <input id="cs-font-size" type="number" class="chart-settings-input"
               min="7" max="20" step="1" value="${s.fontSize}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="cs-tick-font">Tick font (px)</label>
        <input id="cs-tick-font" type="number" class="chart-settings-input"
               min="6" max="16" step="1" value="${s.tickFontSize}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="cs-font-color">Font color</label>
        <div class="color-with-auto">
          <input id="cs-font-color" type="color" class="chart-settings-color"
                 value="${fontColorVal}" ${fontColorDisabled} style="opacity:${fontColorOpacity}">
          <label class="chart-settings-check">
            <input type="checkbox" id="cs-font-color-auto" ${fontColorAuto ? "checked" : ""}> Auto
          </label>
        </div>
      </div>

      <div class="settings-divider">Markers</div>

      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="cs-marker-size">Marker size</label>
        <input id="cs-marker-size" type="number" class="chart-settings-input"
               min="3" max="12" step="1" value="${Math.round(currentMarkerSize)}">
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Opacity</span>
        <div class="range-with-value">
          <input id="cs-opacity" type="range" class="chart-settings-range"
                 min="0.1" max="1.0" step="0.05" value="${s.opacity}">
          <span id="cs-opacity-val" class="chart-settings-range-val">${s.opacity.toFixed(2)}</span>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="cs-palette">Marker palette</label>
        <select id="cs-palette" class="chart-settings-select">
          <option value="blueRed"     ${s.palette === "blueRed"     ? "selected" : ""}>Blue / Red</option>
          <option value="greenOrange" ${s.palette === "greenOrange" ? "selected" : ""}>Green / Orange</option>
          <option value="tealAmber"   ${s.palette === "tealAmber"   ? "selected" : ""}>Teal / Amber</option>
          <option value="purpleGold"  ${s.palette === "purpleGold"  ? "selected" : ""}>Purple / Gold</option>
          <option value="indigoOrange" ${s.palette === "indigoOrange" ? "selected" : ""}>Indigo / Orange</option>
          <option value="crimsonCyan" ${s.palette === "crimsonCyan" ? "selected" : ""}>Crimson / Cyan</option>
        </select>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="cs-edge-width">Edge width</label>
        <input id="cs-edge-width" type="number" class="chart-settings-input"
               min="0" max="3" step="0.5" value="${s.edgeWidth}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="cs-edge-color">Edge color</label>
        <input id="cs-edge-color" type="color" class="chart-settings-color"
               value="${s.edgeColor}" ${edgeColorDisabled} style="opacity:${edgeColorOpacity}">
      </div>

      <div class="settings-divider">Figure</div>

      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="cs-height">Height (px)</label>
        <input id="cs-height" type="number" class="chart-settings-input"
               min="300" max="1200" step="50" value="${currentHeight}">
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Width (px)</span>
        <div class="width-control">
          <input id="cs-width" type="number" class="chart-settings-input"
                 min="400" max="1400" step="50" value="${s.maxWidth || 800}"
                 ${widthFull ? "disabled" : ""}>
          <label class="chart-settings-check">
            <input type="checkbox" id="cs-width-full" ${widthFull ? "checked" : ""}> Full
          </label>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="cs-plot-bg">Plot bg</label>
        <div class="color-with-auto">
          <input id="cs-plot-bg" type="color" class="chart-settings-color"
                 value="${plotBgVal}" ${plotBgDisabled} style="opacity:${plotBgOpacity}">
          <label class="chart-settings-check">
            <input type="checkbox" id="cs-plot-bg-auto" ${plotBgAuto ? "checked" : ""}> Auto
          </label>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="cs-paper-bg">Paper bg</label>
        <div class="color-with-auto">
          <input id="cs-paper-bg" type="color" class="chart-settings-color"
                 value="${paperBgVal}" ${paperBgDisabled} style="opacity:${paperBgOpacity}">
          <label class="chart-settings-check">
            <input type="checkbox" id="cs-paper-bg-auto" ${paperBgAuto ? "checked" : ""}> Auto
          </label>
        </div>
      </div>

      <div class="settings-divider">Gridlines</div>

      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Major grid</span>
        <div class="color-with-auto">
          <label class="chart-settings-check">
            <input type="checkbox" id="cs-major-grid" ${s.showMajorGrid ? "checked" : ""}> On
          </label>
          <input id="cs-major-grid-color" type="color" class="chart-settings-color"
                 value="${s.majorGridColor}">
          <div class="range-with-value">
            <input id="cs-major-grid-opacity" type="range" class="chart-settings-range"
                   min="0" max="1" step="0.05" value="${s.majorGridOpacity}">
            <span id="cs-major-grid-opacity-val" class="chart-settings-range-val">${s.majorGridOpacity.toFixed(2)}</span>
          </div>
        </div>
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Minor grid</span>
        <div class="color-with-auto">
          <label class="chart-settings-check">
            <input type="checkbox" id="cs-minor-grid" ${s.showMinorGrid ? "checked" : ""}> On
          </label>
          <input id="cs-minor-grid-color" type="color" class="chart-settings-color"
                 value="${s.minorGridColor}">
          <div class="range-with-value">
            <input id="cs-minor-grid-opacity" type="range" class="chart-settings-range"
                   min="0" max="1" step="0.05" value="${s.minorGridOpacity}">
            <span id="cs-minor-grid-opacity-val" class="chart-settings-range-val">${s.minorGridOpacity.toFixed(2)}</span>
          </div>
        </div>
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Cell shading</span>
        <label class="chart-settings-check">
          <input type="checkbox" id="cs-cell-shading" ${s.cellShading ? "checked" : ""}> On
        </label>
      </div>

    </div>
  `;
  return panel;
}

function _wirePanelEvents(panelEl) {
  const debounce = (fn, ms) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };
  const save = () => { _saveSettings(); _rerender(); };

  // ── Typography ──────────────────────────────────────────────────────────────
  panelEl.querySelector("#cs-font-size").addEventListener("input", debounce((e) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 7 && val <= 20) { _chartSettings.fontSize = val; save(); }
  }, 200));

  panelEl.querySelector("#cs-tick-font").addEventListener("input", debounce((e) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 6 && val <= 16) { _chartSettings.tickFontSize = val; save(); }
  }, 200));

  const fontColorInput = panelEl.querySelector("#cs-font-color");
  const fontColorAuto  = panelEl.querySelector("#cs-font-color-auto");
  fontColorAuto.addEventListener("change", () => {
    if (fontColorAuto.checked) {
      _chartSettings.fontColor  = null;
      fontColorInput.disabled   = true;
      fontColorInput.style.opacity = "0.4";
    } else {
      _chartSettings.fontColor  = fontColorInput.value;
      fontColorInput.disabled   = false;
      fontColorInput.style.opacity = "1";
    }
    save();
  });
  fontColorInput.addEventListener("input", (e) => {
    _chartSettings.fontColor = e.target.value; save();
  });

  // ── Markers ─────────────────────────────────────────────────────────────────
  panelEl.querySelector("#cs-marker-size").addEventListener("input", debounce((e) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 3 && val <= 12) { _chartSettings.markerSize = val; save(); }
  }, 200));

  const opacityInput = panelEl.querySelector("#cs-opacity");
  const opacityVal   = panelEl.querySelector("#cs-opacity-val");
  opacityInput.addEventListener("input", () => {
    const val = parseFloat(opacityInput.value);
    opacityVal.textContent     = val.toFixed(2);
    _chartSettings.opacity     = val;
    save();
  });

  panelEl.querySelector("#cs-palette").addEventListener("change", (e) => {
    _chartSettings.palette = e.target.value; save();
  });

  const edgeColorInput = panelEl.querySelector("#cs-edge-color");
  panelEl.querySelector("#cs-edge-width").addEventListener("input", debounce((e) => {
    const val = parseFloat(e.target.value);
    if (val >= 0 && val <= 3) {
      _chartSettings.edgeWidth           = val;
      const hasEdge                      = val > 0;
      edgeColorInput.disabled            = !hasEdge;
      edgeColorInput.style.opacity       = hasEdge ? "1" : "0.4";
      save();
    }
  }, 200));
  edgeColorInput.addEventListener("input", (e) => {
    _chartSettings.edgeColor = e.target.value; save();
  });

  // ── Figure ──────────────────────────────────────────────────────────────────
  panelEl.querySelector("#cs-height").addEventListener("input", debounce((e) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 300 && val <= 1200) { _chartSettings.height = val; save(); }
  }, 200));

  const widthInput        = panelEl.querySelector("#cs-width");
  const widthFullCheckbox = panelEl.querySelector("#cs-width-full");
  widthFullCheckbox.addEventListener("change", () => {
    if (widthFullCheckbox.checked) {
      widthInput.disabled     = true;
      _chartSettings.maxWidth = null;
    } else {
      widthInput.disabled     = false;
      const val = parseInt(widthInput.value, 10);
      _chartSettings.maxWidth = (val >= 400 && val <= 1400) ? val : 800;
    }
    save();
  });
  widthInput.addEventListener("input", debounce((e) => {
    if (!widthFullCheckbox.checked) {
      const val = parseInt(e.target.value, 10);
      if (val >= 400 && val <= 1400) { _chartSettings.maxWidth = val; save(); }
    }
  }, 200));

  const plotBgInput = panelEl.querySelector("#cs-plot-bg");
  const plotBgAuto  = panelEl.querySelector("#cs-plot-bg-auto");
  plotBgAuto.addEventListener("change", () => {
    if (plotBgAuto.checked) {
      _chartSettings.plotBgColor   = null;
      plotBgInput.disabled         = true;
      plotBgInput.style.opacity    = "0.4";
    } else {
      _chartSettings.plotBgColor   = plotBgInput.value;
      plotBgInput.disabled         = false;
      plotBgInput.style.opacity    = "1";
    }
    save();
  });
  plotBgInput.addEventListener("input", (e) => {
    _chartSettings.plotBgColor = e.target.value; save();
  });

  const paperBgInput = panelEl.querySelector("#cs-paper-bg");
  const paperBgAuto  = panelEl.querySelector("#cs-paper-bg-auto");
  paperBgAuto.addEventListener("change", () => {
    if (paperBgAuto.checked) {
      _chartSettings.paperBgColor  = null;
      paperBgInput.disabled        = true;
      paperBgInput.style.opacity   = "0.4";
    } else {
      _chartSettings.paperBgColor  = paperBgInput.value;
      paperBgInput.disabled        = false;
      paperBgInput.style.opacity   = "1";
    }
    save();
  });
  paperBgInput.addEventListener("input", (e) => {
    _chartSettings.paperBgColor = e.target.value; save();
  });

  // ── Gridlines ────────────────────────────────────────────────────────────────
  panelEl.querySelector("#cs-major-grid").addEventListener("change", (e) => {
    _chartSettings.showMajorGrid = e.target.checked; save();
  });
  panelEl.querySelector("#cs-major-grid-color").addEventListener("input", (e) => {
    _chartSettings.majorGridColor = e.target.value; save();
  });
  const majorOpacityInput = panelEl.querySelector("#cs-major-grid-opacity");
  const majorOpacityVal   = panelEl.querySelector("#cs-major-grid-opacity-val");
  majorOpacityInput.addEventListener("input", () => {
    const val = parseFloat(majorOpacityInput.value);
    majorOpacityVal.textContent        = val.toFixed(2);
    _chartSettings.majorGridOpacity    = val;
    save();
  });

  panelEl.querySelector("#cs-minor-grid").addEventListener("change", (e) => {
    _chartSettings.showMinorGrid = e.target.checked; save();
  });
  panelEl.querySelector("#cs-minor-grid-color").addEventListener("input", (e) => {
    _chartSettings.minorGridColor = e.target.value; save();
  });
  const minorOpacityInput = panelEl.querySelector("#cs-minor-grid-opacity");
  const minorOpacityVal   = panelEl.querySelector("#cs-minor-grid-opacity-val");
  minorOpacityInput.addEventListener("input", () => {
    const val = parseFloat(minorOpacityInput.value);
    minorOpacityVal.textContent        = val.toFixed(2);
    _chartSettings.minorGridOpacity    = val;
    save();
  });

  panelEl.querySelector("#cs-cell-shading").addEventListener("change", (e) => {
    _chartSettings.cellShading = e.target.checked;
    save();
  });
}

// ── Stats section (below chart) ───────────────────────────────────────────────

function _countColOutliers(vals) {
  if (vals.length < 4) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const q1  = sorted[Math.floor(sorted.length * 0.25)];
  const q3  = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  if (iqr === 0) return 0;
  const lo  = q1 - 1.5 * iqr;
  const hi  = q3 + 1.5 * iqr;
  return vals.filter(v => v < lo || v > hi).length;
}

function _buildStatsSection(columns, rows, fullStats, totalRows) {
  const section = el("div", { cls: "stats-section" });
  const statsHeader = el("div", { cls: "stats-section__header", text: "Summary Statistics" });
  section.appendChild(statsHeader);

  registerPrimer(
    "stats",
    statsHeader,
    "Reading the summary statistics",
    `<p><strong>μ ± σ</strong> (mean ± standard deviation) shows where values cluster and how spread out they are.
     For a normal distribution, ~68% of values fall within ±1σ of the mean.</p>
     <p><strong>Skewness</strong> measures distribution asymmetry. |skew| &lt; 1 is roughly symmetric;
     |skew| &gt; 1 suggests a heavy tail — consider a log-transform before training.</p>
     <p><strong>Card borders</strong>:
       Left border = null density (<span style="color:var(--color-success);font-weight:600">green</span> = none,
       <span style="color:var(--color-warning);font-weight:600">amber</span> = ≤10%,
       <span style="color:var(--color-danger);font-weight:600">red</span> = &gt;10%).
       Orange top border = |skew| &gt; 1 (skewed distribution — not an outlier indicator).
     </p>`
  );

  const legend = el("div", { cls: "stats-legend" });
  legend.innerHTML = `<span class="stats-legend__dot--skew"></span> Orange top border = |skew| &gt; 1 — skewed distribution (not outliers)`;
  section.appendChild(legend);

  const grid = el("div", { cls: "stats-grid" });
  const N = totalRows || rows.length;

  for (const col of columns) {
    const vals     = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
    const nullCount = rows.length - vals.length;

    const stats = fullStats && fullStats[col]
      ? fullStats[col]
      : vals.length === 0
        ? { min: NaN, max: NaN, mean: NaN, std: NaN, median: NaN, null_count: nullCount }
        : {
            min:        Math.min(...vals),
            max:        Math.max(...vals),
            mean:       mean(vals),
            std:        stdDev(vals),
            median:     median(vals),
            null_count: nullCount,
          };

    const skew         = skewness(vals);
    const outlierCount = _countColOutliers(vals);
    const nc       = stats.null_count ?? nullCount;
    const nullPct  = N > 0 ? ((nc / N) * 100).toFixed(1) : "0.0";
    const qualCls  = nc === 0 ? "stats-col-card--ok"
                   : parseFloat(nullPct) <= 10 ? "stats-col-card--warn"
                   : "stats-col-card--bad";
    const highSkew = skew !== null && Math.abs(skew) > 1;

    const card   = el("div", { cls: `stats-col-card ${qualCls}${highSkew ? " stats-col-card--skew" : ""}` });
    const nameEl = el("div", { cls: "stats-col-card__name", text: col });
    nameEl.title = col;

    // Primary tier: mean ± std  and  min … max
    const primary = el("div", { cls: "stat-tier stat-tier--primary" });
    const meanStd = `${formatNum(stats.mean)} ± ${formatNum(stats.std)}`;
    const range   = `${formatNum(stats.min)} … ${formatNum(stats.max)}`;
    primary.innerHTML = `
      <div class="stat-pair">
        <span class="stat-pair__key">μ ± σ</span>
        <span class="stat-pair__val" title="${meanStd}">${meanStd}</span>
      </div>
      <div class="stat-pair">
        <span class="stat-pair__key">range</span>
        <span class="stat-pair__val" title="${range}">${range}</span>
      </div>`;

    // Secondary tier: median, nulls %, skew
    const secondary  = el("div", { cls: "stat-tier stat-tier--secondary" });
    const nullsStr   = `${nc} / ${N} (${nullPct}%)`;
    const skewStr    = skew !== null ? formatNum(skew, 2) : "—";
    const medStr     = formatNum(stats.median);
    const skewTitle  = highSkew
      ? `${skewStr} — |skew| > 1, consider a log-transform before training`
      : skewStr;
    const skewValCls = highSkew ? " stat-pair__val--skew" : "";
    secondary.innerHTML = `
      <div class="stat-pair">
        <span class="stat-pair__key">median</span>
        <span class="stat-pair__val" title="${medStr}">${medStr}</span>
      </div>
      <div class="stat-pair">
        <span class="stat-pair__key">nulls</span>
        <span class="stat-pair__val" title="${nullsStr}">${nullsStr}</span>
      </div>
      <div class="stat-pair">
        <span class="stat-pair__key">skew</span>
        <span class="stat-pair__val${skewValCls}" title="${skewTitle}">${skewStr}${highSkew ? ' <span class="skew-badge">⚠</span>' : ''}</span>
      </div>`;

    card.appendChild(nameEl);
    card.appendChild(primary);
    card.appendChild(secondary);
    if (outlierCount > 0) {
      const outlierEl = el("div", { cls: "outlier-count-badge" });
      outlierEl.textContent = `${outlierCount} IQR outlier${outlierCount !== 1 ? "s" : ""}`;
      card.appendChild(outlierEl);
    }
    grid.appendChild(card);
  }

  section.appendChild(grid);
  return section;
}

// ── Input × Output Scatter Grid ──────────────────────────────────────────────

const _IO_KEY = "surrogate_data_io_settings";
const _IO_DEFAULTS = {
  fontSize:      10,
  fontColor:     null,
  markerSize:    5,
  markerColor:   "#3b5dd9",
  markerOpacity: 0.65,
  edgeWidth:     0,
  edgeColor:     "#000000",
  showTrendLine: true,
  chartHeight:   200,
  plotBgColor:   null,
  paperBgColor:  null,
};

function _loadIOSettings() {
  try {
    const raw = localStorage.getItem(_IO_KEY);
    if (raw) return { ..._IO_DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {}
  return { ..._IO_DEFAULTS };
}
function _saveIOSettings(s) {
  try { localStorage.setItem(_IO_KEY, JSON.stringify(s)); } catch (_) {}
}

/**
 * Build the Input × Output scatter grid section.
 * If no designation yet, renders a placeholder card instead.
 *
 * @param {HTMLElement} containerEl
 * @param {object[]}    rows       - Row data array.
 * @param {string[]}    inputCols  - Designated input columns.
 * @param {string[]}    outputCols - Designated output columns.
 * @param {string[]}    allColumns - All dataset columns (for fallback display).
 */
export function buildIOSection(containerEl, rows, inputCols, outputCols, allColumns) {
  const card = el("div", { cls: "card io-scatter-card" });
  card.appendChild(el("h3", { cls: "section-title", text: "Input × Output Relationships" }));
  containerEl.appendChild(card);

  // Placeholder when columns aren't designated yet
  if (!inputCols.length || !outputCols.length) {
    card.appendChild(el("p", {
      cls: "section-desc",
      text: "Complete Step 6 — Assign to designate input and output columns. The scatter grid will populate here.",
    }));
    return;
  }

  let ios = _loadIOSettings();

  // Pre-extract paired values for every (input, output) combination
  const pairs = {};
  for (const out of outputCols) {
    pairs[out] = {};
    for (const inp of inputCols) {
      const xVals = [], yVals = [];
      for (const row of rows) {
        const x = row[inp], y = row[out];
        if (x != null && isFinite(+x) && y != null && isFinite(+y)) {
          xVals.push(+x); yVals.push(+y);
        }
      }
      pairs[out][inp] = { xVals, yVals };
    }
  }

  // ── Settings panel ─────────────────────────────────────────────────────────
  const fontColorAuto  = ios.fontColor    === null;
  const fontColorVal   = ios.fontColor    || "#4b5478";
  const plotBgAuto     = ios.plotBgColor  === null;
  const plotBgVal      = ios.plotBgColor  || "#ffffff";
  const paperBgAuto    = ios.paperBgColor === null;
  const paperBgVal     = ios.paperBgColor || "#f5f6fa";

  const settingsPanel = document.createElement("details");
  settingsPanel.className = "chart-settings-panel";
  settingsPanel.innerHTML = `
    <summary class="chart-settings-panel__summary">Plot Settings</summary>
    <div class="chart-settings-controls">

      <div class="settings-divider">Typography</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="io-font-size">Font size (px)</label>
        <input id="io-font-size" type="number" class="chart-settings-input" min="7" max="20" step="1" value="${ios.fontSize}">
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Font color</span>
        <div class="color-with-auto">
          <input id="io-font-color" type="color" class="chart-settings-color"
                 value="${fontColorVal}" ${fontColorAuto ? "disabled" : ""} style="opacity:${fontColorAuto ? "0.4" : "1"}">
          <label class="chart-settings-check">
            <input type="checkbox" id="io-font-color-auto" ${fontColorAuto ? "checked" : ""}> Auto
          </label>
        </div>
      </div>

      <div class="settings-divider">Markers</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="io-marker-size">Marker size</label>
        <input id="io-marker-size" type="number" class="chart-settings-input" min="2" max="20" step="1" value="${ios.markerSize}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="io-marker-color">Marker color</label>
        <input id="io-marker-color" type="color" class="chart-settings-color" value="${ios.markerColor}">
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Opacity</span>
        <div class="range-with-value">
          <input id="io-marker-opacity" type="range" class="chart-settings-range" min="0.1" max="1.0" step="0.05" value="${ios.markerOpacity}">
          <span id="io-marker-opacity-val" class="chart-settings-range-val">${ios.markerOpacity.toFixed(2)}</span>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="io-edge-width">Edge width</label>
        <input id="io-edge-width" type="number" class="chart-settings-input" min="0" max="3" step="0.5" value="${ios.edgeWidth}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="io-edge-color">Edge color</label>
        <input id="io-edge-color" type="color" class="chart-settings-color" value="${ios.edgeColor}">
      </div>

      <div class="settings-divider">Figure</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="io-height">Chart height (px)</label>
        <input id="io-height" type="number" class="chart-settings-input" min="100" max="600" step="20" value="${ios.chartHeight}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="io-plot-bg">Plot bg</label>
        <div class="color-with-auto">
          <input id="io-plot-bg" type="color" class="chart-settings-color"
                 value="${plotBgVal}" ${plotBgAuto ? "disabled" : ""} style="opacity:${plotBgAuto ? "0.4" : "1"}">
          <label class="chart-settings-check">
            <input type="checkbox" id="io-plot-bg-auto" ${plotBgAuto ? "checked" : ""}> Auto
          </label>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="io-paper-bg">Paper bg</label>
        <div class="color-with-auto">
          <input id="io-paper-bg" type="color" class="chart-settings-color"
                 value="${paperBgVal}" ${paperBgAuto ? "disabled" : ""} style="opacity:${paperBgAuto ? "0.4" : "1"}">
          <label class="chart-settings-check">
            <input type="checkbox" id="io-paper-bg-auto" ${paperBgAuto ? "checked" : ""}> Auto
          </label>
        </div>
      </div>

      <div class="settings-divider">Options</div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Trend line</span>
        <label class="chart-settings-check">
          <input type="checkbox" id="io-trend-line" ${ios.showTrendLine ? "checked" : ""}> Show
        </label>
      </div>
    </div>
  `;
  card.appendChild(settingsPanel);

  // ── Output group tabs / chips ─────────────────────────────────────────────
  // Let user show/hide individual output groups
  let visibleOutputs = new Set(outputCols);

  const tabWrap = el("div", { cls: "io-tab-wrap" });
  const tabLabel = el("span", { cls: "io-tab-label", text: "Show outputs:" });
  tabWrap.appendChild(tabLabel);
  for (const out of outputCols) {
    const chip = el("button", { cls: "col-chip col-chip--selected", type: "button" });
    chip.textContent = out; chip.title = out; chip.dataset.out = out;
    chip.addEventListener("click", () => {
      if (visibleOutputs.has(out)) {
        if (visibleOutputs.size <= 1) return;
        visibleOutputs.delete(out);
        chip.classList.remove("col-chip--selected");
      } else {
        visibleOutputs.add(out);
        chip.classList.add("col-chip--selected");
      }
      _rebuildGroups();
    });
    tabWrap.appendChild(chip);
  }
  card.appendChild(tabWrap);

  // ── Output groups ─────────────────────────────────────────────────────────
  const groupsEl = el("div", { cls: "io-groups" });
  card.appendChild(groupsEl);

  const IO_INPUT_LIMIT = 6;

  // Per-output selected input set — default to first IO_INPUT_LIMIT inputs
  const selectedInputs = {};
  for (const out of outputCols) {
    selectedInputs[out] = new Set(inputCols.slice(0, IO_INPUT_LIMIT));
  }

  // One persistent chart div per (input, output) pair
  const chartEls = {};
  for (const out of outputCols) {
    chartEls[out] = {};
    for (const inp of inputCols) {
      const div = el("div", { cls: "io-scatter-chart" });
      div.dataset.inp = inp; div.dataset.out = out;
      chartEls[out][inp] = div;
    }
  }

  function _renderPair(inp, out) {
    const { xVals, yVals } = pairs[out][inp];
    renderIOScatter(chartEls[out][inp], xVals, yVals, inp, out, {
      markerSize:    ios.markerSize,
      markerColor:   ios.markerColor,
      markerOpacity: ios.markerOpacity,
      edgeWidth:     ios.edgeWidth,
      edgeColor:     ios.edgeColor,
      showTrendLine: ios.showTrendLine,
      fontSize:      ios.fontSize,
      fontColor:     ios.fontColor,
      height:        ios.chartHeight,
      plotBgColor:   ios.plotBgColor,
      paperBgColor:  ios.paperBgColor,
    });
  }

  function _rebuildGroups() {
    clearEl(groupsEl);
    for (const out of outputCols) {
      if (!visibleOutputs.has(out)) continue;
      const group = el("div", { cls: "io-output-group" });

      const groupHdr = el("div", { cls: "io-output-label" });
      groupHdr.textContent = `→ ${out}`;
      group.appendChild(groupHdr);

      // Input chip row — only shown when there are multiple inputs
      if (inputCols.length > 1) {
        const inpRow = el("div", { cls: "io-input-chip-row" });
        inpRow.appendChild(el("span", { cls: "io-tab-label", text: "Inputs:" }));

        for (const inp of inputCols) {
          const chip = el("button", {
            cls: `col-chip${selectedInputs[out].has(inp) ? " col-chip--selected" : ""}`,
            type: "button",
          });
          chip.textContent = inp; chip.title = inp;
          chip.addEventListener("click", () => {
            if (selectedInputs[out].has(inp)) {
              if (selectedInputs[out].size <= 1) return;
              selectedInputs[out].delete(inp);
            } else {
              selectedInputs[out].add(inp);
            }
            _rebuildGroups();
          });
          inpRow.appendChild(chip);
        }

        // "Show all" button when the limit hides some inputs
        if (inputCols.length > IO_INPUT_LIMIT && selectedInputs[out].size < inputCols.length) {
          const showAllBtn = el("button", { cls: "io-show-all-btn", type: "button" });
          showAllBtn.textContent = `Show all (${inputCols.length})`;
          showAllBtn.addEventListener("click", () => {
            inputCols.forEach(c => selectedInputs[out].add(c));
            _rebuildGroups();
          });
          inpRow.appendChild(showAllBtn);
        }

        group.appendChild(inpRow);
      }

      const grid = el("div", { cls: "io-scatter-grid" });
      for (const inp of inputCols) {
        if (!selectedInputs[out].has(inp)) continue;
        grid.appendChild(chartEls[out][inp]);
        _renderPair(inp, out);
      }
      group.appendChild(grid);
      groupsEl.appendChild(group);
    }
  }

  function _rerenderAll() {
    for (const out of outputCols) {
      if (!visibleOutputs.has(out)) continue;
      for (const inp of inputCols) {
        if (selectedInputs[out].has(inp)) _renderPair(inp, out);
      }
    }
  }

  // ── Settings wiring ────────────────────────────────────────────────────────
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const _g = id => settingsPanel.querySelector(`#${id}`);

  function _applyIOSettings() {
    ios = {
      fontSize:      parseInt(_g("io-font-size").value)      || 10,
      fontColor:     _g("io-font-color-auto").checked ? null : _g("io-font-color").value,
      markerSize:    parseInt(_g("io-marker-size").value)    || 5,
      markerColor:   _g("io-marker-color").value,
      markerOpacity: parseFloat(_g("io-marker-opacity").value),
      edgeWidth:     parseFloat(_g("io-edge-width").value),
      edgeColor:     _g("io-edge-color").value,
      showTrendLine: _g("io-trend-line").checked,
      chartHeight:   parseInt(_g("io-height").value)         || 200,
      plotBgColor:   _g("io-plot-bg-auto").checked  ? null : _g("io-plot-bg").value,
      paperBgColor:  _g("io-paper-bg-auto").checked ? null : _g("io-paper-bg").value,
    };
    _saveIOSettings(ios);
    _rerenderAll();
  }

  _g("io-marker-opacity").addEventListener("input", () => {
    _g("io-marker-opacity-val").textContent = parseFloat(_g("io-marker-opacity").value).toFixed(2);
    _applyIOSettings();
  });

  const _wireAuto = (chkId, colorId) => {
    _g(chkId).addEventListener("change", () => {
      const on = _g(chkId).checked;
      _g(colorId).disabled = on; _g(colorId).style.opacity = on ? "0.4" : "1";
      _applyIOSettings();
    });
  };
  _wireAuto("io-font-color-auto", "io-font-color");
  _wireAuto("io-plot-bg-auto",    "io-plot-bg");
  _wireAuto("io-paper-bg-auto",   "io-paper-bg");

  ["io-font-size","io-font-color","io-marker-size","io-marker-color",
   "io-edge-width","io-edge-color","io-height","io-plot-bg","io-paper-bg","io-trend-line"
  ].forEach(id => _g(id).addEventListener("change", debounce(_applyIOSettings, 150)));

  document.addEventListener("theme:changed", _rerenderAll);

  _rebuildGroups();
}

// ── Column Distributions (Histograms) ────────────────────────────────────────

const _HIST_KEY = "surrogate_data_histogram_settings";
const _HIST_DEFAULTS = {
  fontSize:     10,
  fontColor:    null,
  barColor:     "#3b5dd9",
  barOpacity:   0.75,
  edgeColor:    "#888888",
  edgeWidth:    0.5,
  nbins:        30,
  chartHeight:  200,
  logTransform: false,
  showMeanLine: false,
  plotBgColor:  null,
  paperBgColor: null,
};

function _loadHistSettings() {
  try {
    const raw = localStorage.getItem(_HIST_KEY);
    if (raw) return { ..._HIST_DEFAULTS, ...JSON.parse(raw) };
  } catch (_) {}
  return { ..._HIST_DEFAULTS };
}
function _saveHistSettings(s) {
  try { localStorage.setItem(_HIST_KEY, JSON.stringify(s)); } catch (_) {}
}

function _buildHistogramSection(containerEl, rows, columns) {
  if (!columns || columns.length < 1 || !rows || !rows.length) return;

  let hs = _loadHistSettings();

  // Pre-extract numeric values per column
  const colVals = {};
  for (const col of columns) {
    colVals[col] = rows.map(r => r[col]).filter(v => v != null && isFinite(+v)).map(Number);
  }
  const numericCols = columns.filter(c => colVals[c].length > 0);
  if (numericCols.length === 0) return;

  let selectedCols = [...numericCols];

  // ── Card ──────────────────────────────────────────────────────────────────
  const card = el("div", { cls: "card histogram-card" });
  card.appendChild(el("h3", { cls: "section-title", text: "Column Distributions" }));
  containerEl.appendChild(card);

  // ── Settings panel ─────────────────────────────────────────────────────────
  const fontColorAuto  = hs.fontColor    === null;
  const fontColorVal   = hs.fontColor    || "#4b5478";
  const plotBgAuto     = hs.plotBgColor  === null;
  const plotBgVal      = hs.plotBgColor  || "#ffffff";
  const paperBgAuto    = hs.paperBgColor === null;
  const paperBgVal     = hs.paperBgColor || "#f5f6fa";

  const settingsPanel = document.createElement("details");
  settingsPanel.className = "chart-settings-panel";
  settingsPanel.innerHTML = `
    <summary class="chart-settings-panel__summary">Plot Settings</summary>
    <div class="chart-settings-controls">

      <div class="settings-divider">Typography</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="hist-font-size">Font size (px)</label>
        <input id="hist-font-size" type="number" class="chart-settings-input" min="7" max="20" step="1" value="${hs.fontSize}">
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Font color</span>
        <div class="color-with-auto">
          <input id="hist-font-color" type="color" class="chart-settings-color"
                 value="${fontColorVal}" ${fontColorAuto ? "disabled" : ""} style="opacity:${fontColorAuto ? "0.4" : "1"}">
          <label class="chart-settings-check">
            <input type="checkbox" id="hist-font-color-auto" ${fontColorAuto ? "checked" : ""}> Auto
          </label>
        </div>
      </div>

      <div class="settings-divider">Bars</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="hist-bar-color">Bar color</label>
        <input id="hist-bar-color" type="color" class="chart-settings-color" value="${hs.barColor}">
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Bar opacity</span>
        <div class="range-with-value">
          <input id="hist-bar-opacity" type="range" class="chart-settings-range" min="0.1" max="1.0" step="0.05" value="${hs.barOpacity}">
          <span id="hist-bar-opacity-val" class="chart-settings-range-val">${hs.barOpacity.toFixed(2)}</span>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="hist-edge-width">Edge width</label>
        <input id="hist-edge-width" type="number" class="chart-settings-input" min="0" max="3" step="0.5" value="${hs.edgeWidth}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="hist-edge-color">Edge color</label>
        <input id="hist-edge-color" type="color" class="chart-settings-color" value="${hs.edgeColor}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="hist-nbins">Bin count</label>
        <input id="hist-nbins" type="number" class="chart-settings-input" min="5" max="200" step="5" value="${hs.nbins}">
      </div>

      <div class="settings-divider">Figure</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="hist-height">Chart height (px)</label>
        <input id="hist-height" type="number" class="chart-settings-input" min="100" max="600" step="20" value="${hs.chartHeight}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="hist-plot-bg">Plot bg</label>
        <div class="color-with-auto">
          <input id="hist-plot-bg" type="color" class="chart-settings-color"
                 value="${plotBgVal}" ${plotBgAuto ? "disabled" : ""} style="opacity:${plotBgAuto ? "0.4" : "1"}">
          <label class="chart-settings-check">
            <input type="checkbox" id="hist-plot-bg-auto" ${plotBgAuto ? "checked" : ""}> Auto
          </label>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="hist-paper-bg">Paper bg</label>
        <div class="color-with-auto">
          <input id="hist-paper-bg" type="color" class="chart-settings-color"
                 value="${paperBgVal}" ${paperBgAuto ? "disabled" : ""} style="opacity:${paperBgAuto ? "0.4" : "1"}">
          <label class="chart-settings-check">
            <input type="checkbox" id="hist-paper-bg-auto" ${paperBgAuto ? "checked" : ""}> Auto
          </label>
        </div>
      </div>

      <div class="settings-divider">Options</div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Log₁₀ transform</span>
        <label class="chart-settings-check">
          <input type="checkbox" id="hist-log-transform" ${hs.logTransform ? "checked" : ""}> On
        </label>
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Mean line</span>
        <label class="chart-settings-check">
          <input type="checkbox" id="hist-mean-line" ${hs.showMeanLine ? "checked" : ""}> Show
        </label>
      </div>
    </div>
  `;
  card.appendChild(settingsPanel);

  // ── Column chip selector ──────────────────────────────────────────────────
  const chipWrap = el("div", { cls: "col-selector-wrap" });
  const chipHdr  = el("div", { cls: "col-selector-header" });
  const countEl  = el("span", { cls: "col-selector-count" });
  const allBtn   = el("button", { cls: "col-selector-btn", type: "button", text: "All" });
  const noneBtn  = el("button", { cls: "col-selector-btn", type: "button", text: "None" });
  chipHdr.appendChild(countEl);
  chipHdr.appendChild(allBtn);
  chipHdr.appendChild(noneBtn);
  const chipRow = el("div", { cls: "col-selector-row" });

  function _refreshChips() {
    countEl.textContent = `Showing: ${selectedCols.length} / ${numericCols.length}`;
    chipRow.querySelectorAll(".col-chip").forEach(chip => {
      chip.classList.toggle("col-chip--selected", selectedCols.includes(chip.dataset.col));
    });
  }

  for (const col of numericCols) {
    const chip = el("button", { cls: "col-chip col-chip--selected", type: "button" });
    chip.textContent = col; chip.title = col; chip.dataset.col = col;
    chip.addEventListener("click", () => {
      const isSel = selectedCols.includes(col);
      if (isSel) {
        if (selectedCols.length <= 1) return;
        selectedCols = selectedCols.filter(c => c !== col);
      } else {
        selectedCols = [...selectedCols, col];
      }
      _refreshChips();
      _rebuildGrid();
    });
    chipRow.appendChild(chip);
  }
  allBtn.addEventListener("click",  () => { selectedCols = [...numericCols]; _refreshChips(); _rebuildGrid(); });
  noneBtn.addEventListener("click", () => { selectedCols = [numericCols[0]]; _refreshChips(); _rebuildGrid(); });

  chipWrap.appendChild(chipHdr);
  chipWrap.appendChild(chipRow);
  card.appendChild(chipWrap);
  _refreshChips();

  // ── Histogram grid ─────────────────────────────────────────────────────────
  const gridEl = el("div", { cls: "histogram-grid" });
  card.appendChild(gridEl);

  // One persistent div per column — moved into/out of gridEl on chip toggle
  const chartEls = {};
  for (const col of numericCols) {
    const wrap = el("div", { cls: "histogram-chart" });
    wrap.dataset.col = col;
    chartEls[col] = wrap;
  }

  function _renderCol(col) {
    renderColumnHistogram(chartEls[col], colVals[col], col, {
      logTransform: hs.logTransform, nbins: hs.nbins,
      barColor:     hs.barColor,     barOpacity:  hs.barOpacity,
      edgeColor:    hs.edgeColor,    edgeWidth:   hs.edgeWidth,
      fontSize:     hs.fontSize,     fontColor:   hs.fontColor,
      height:       hs.chartHeight,
      plotBgColor:  hs.plotBgColor,  paperBgColor: hs.paperBgColor,
      showMeanLine: hs.showMeanLine,
    });
  }

  function _rebuildGrid() {
    clearEl(gridEl);
    for (const col of selectedCols) {
      gridEl.appendChild(chartEls[col]);
      _renderCol(col);
    }
  }

  function _rerenderAll() {
    for (const col of selectedCols) _renderCol(col);
  }

  // ── Settings wiring ────────────────────────────────────────────────────────
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const _g = id => settingsPanel.querySelector(`#${id}`);

  function _applyHistSettings() {
    hs = {
      fontSize:     parseInt(_g("hist-font-size").value)   || 10,
      fontColor:    _g("hist-font-color-auto").checked ? null : _g("hist-font-color").value,
      barColor:     _g("hist-bar-color").value,
      barOpacity:   parseFloat(_g("hist-bar-opacity").value),
      edgeWidth:    parseFloat(_g("hist-edge-width").value),
      edgeColor:    _g("hist-edge-color").value,
      nbins:        parseInt(_g("hist-nbins").value)        || 30,
      chartHeight:  parseInt(_g("hist-height").value)       || 200,
      logTransform: _g("hist-log-transform").checked,
      showMeanLine: _g("hist-mean-line").checked,
      plotBgColor:  _g("hist-plot-bg-auto").checked  ? null : _g("hist-plot-bg").value,
      paperBgColor: _g("hist-paper-bg-auto").checked ? null : _g("hist-paper-bg").value,
    };
    _saveHistSettings(hs);
    _rerenderAll();
  }

  // Opacity range — live
  _g("hist-bar-opacity").addEventListener("input", () => {
    _g("hist-bar-opacity-val").textContent = parseFloat(_g("hist-bar-opacity").value).toFixed(2);
    _applyHistSettings();
  });

  // Auto-color toggles
  const _wireAuto = (chkId, colorId) => {
    _g(chkId).addEventListener("change", () => {
      const on = _g(chkId).checked;
      _g(colorId).disabled = on; _g(colorId).style.opacity = on ? "0.4" : "1";
      _applyHistSettings();
    });
  };
  _wireAuto("hist-font-color-auto", "hist-font-color");
  _wireAuto("hist-plot-bg-auto",    "hist-plot-bg");
  _wireAuto("hist-paper-bg-auto",   "hist-paper-bg");

  // All remaining inputs fire _applyHistSettings on change
  ["hist-font-size","hist-font-color","hist-bar-color","hist-edge-width","hist-edge-color",
   "hist-nbins","hist-height","hist-plot-bg","hist-paper-bg",
   "hist-log-transform","hist-mean-line"
  ].forEach(id => _g(id).addEventListener("change", debounce(_applyHistSettings, 150)));

  // Re-render on theme change
  document.addEventListener("theme:changed", _rerenderAll);

  // Initial render
  _rebuildGrid();
}

// ── Distance Correlation section ──────────────────────────────────────────────

function _buildDCorSection() {
  const card = el("div", { cls: "card dcor-card" });

  // ── Header ─────────────────────────────────────────────────────────────────
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Distance Correlation Heatmap</h2>
    <p class="section-desc">Measures non-linear dependence between every pair of columns.
    0 = independent, 1 = perfect dependence.</p>
  `;
  card.appendChild(header);

  registerPrimer(
    "dcor",
    header,
    "What is distance correlation?",
    `<p>Distance correlation (dCor) measures statistical dependence between any two variables
     without assuming linearity. A value of <strong>0</strong> means completely independent;
     <strong>1</strong> means perfect dependence — linear or not.</p>
     <p>Unlike Pearson's r, dCor detects curved relationships, clusters, and interactions.
     Two variables that score near 0 in Pearson but high in dCor are non-linearly related —
     common in aerodynamic and structural data.</p>
     <p><strong>Tips:</strong> High dCor between two inputs (≥ 0.9) suggests redundancy.
     High dCor between an input and an output confirms predictive power.</p>`
  );

  const contentWrap = el("div", { cls: "dcor-content" });
  card.appendChild(contentWrap);

  // ── Closure state ──────────────────────────────────────────────────────────
  let _resp           = null;
  let _selCols        = [];
  let _dcorFs         = null;    // null = inherit _chartSettings.fontSize
  let _dcorFontColor  = null;    // null = auto
  let _dcorAnnot      = null;    // null = use chart-function default (true)
  let _dcorCellFs     = null;    // null = use chart-function default
  let _dcorLabelFs    = null;    // null = use chart-function default
  let _dcorColorbarFs = null;    // null = use chart-function default
  let _dcorScale      = "Viridis";
  let _dcorHeight     = 500;     // 500 px default; user can override via height input
  let _plotEl         = null;

  function _rerender() {
    if (!_plotEl || !_resp) return;
    const cols = _selCols.filter(c => _resp.columns.includes(c));
    if (cols.length < 2) return;

    const subMatrix = {};
    for (const ca of cols) {
      subMatrix[ca] = {};
      for (const cb of cols) subMatrix[ca][cb] = _resp.matrix[ca]?.[cb] ?? 0;
    }

    renderDCorHeatmap(_plotEl, cols, subMatrix, {
      fontSize:         _dcorFs          !== null ? _dcorFs         : (_chartSettings.fontSize ?? 12),
      fontColor:        _dcorFontColor   !== null ? _dcorFontColor  : (_chartSettings.fontColor ?? null),
      showAnnotations:  _dcorAnnot       !== null ? _dcorAnnot      : undefined,
      colorscale:       _dcorScale,
      height:           _dcorHeight,
      cellFontSize:     _dcorCellFs      !== null ? _dcorCellFs     : undefined,
      labelFontSize:    _dcorLabelFs     !== null ? _dcorLabelFs    : undefined,
      colorbarFontSize: _dcorColorbarFs  !== null ? _dcorColorbarFs : undefined,
    });
    requestAnimationFrame(() => Plotly.Plots.resize(_plotEl));
  }

  // Auto-fetch immediately instead of waiting for a user click.
  (async () => {
    contentWrap.innerHTML = `<p class="text-muted text-sm" style="padding:var(--space-3) 0">Computing distance correlations…</p>`;

    const resp = await get("/api/data/dcor");
    _resp = resp;

    if (!resp.success) {
      contentWrap.innerHTML = `<p class="text-muted text-sm" style="padding:var(--space-3) 0">${resp.message || "Failed to compute dCor."}</p>`;
      return;
    }

    clearEl(contentWrap);
    _selCols = [...resp.columns];

    if (resp.truncated) {
      contentWrap.appendChild(el("div", {
        cls:  "limitation-notice",
        text: `Distance correlation computed on ${resp.n_rows.toLocaleString()} rows (2,000-row limit).`,
      }));
    }

    // ── Column chip row ────────────────────────────────────────────────────
    {
      const chipWrap = el("div", { cls: "col-selector-wrap" });
      const hdr      = el("div", { cls: "col-selector-header" });
      const countEl  = el("span", { cls: "col-selector-count" });
      const allBtn   = el("button", { cls: "col-selector-btn", type: "button", text: "All" });
      const clearBtn = el("button", { cls: "col-selector-btn", type: "button", text: "Clear" });
      hdr.appendChild(countEl);
      hdr.appendChild(allBtn);
      hdr.appendChild(clearBtn);

      const chipRow = el("div", { cls: "col-selector-row" });

      const refreshChips = () => {
        countEl.textContent = `Heatmap columns: ${_selCols.length} / ${resp.columns.length}`;
        chipRow.querySelectorAll(".col-chip").forEach(chip => {
          const sel = _selCols.includes(chip.dataset.col);
          chip.classList.toggle("col-chip--selected", sel);
          chip.disabled = !sel && _selCols.length >= 12;
        });
        clearBtn.disabled = _selCols.length <= 2;
      };

      for (const col of resp.columns) {
        const chip       = el("button", { cls: "col-chip col-chip--selected", type: "button" });
        chip.textContent = col;
        chip.title       = col;
        chip.dataset.col = col;
        chip.addEventListener("click", () => {
          const isSel = _selCols.includes(col);
          if (isSel) {
            if (_selCols.length <= 2) return;
            _selCols = _selCols.filter(c => c !== col);
          } else {
            if (_selCols.length >= 12) return;
            _selCols = [..._selCols, col];
          }
          refreshChips();
          _rerender();
        });
        chipRow.appendChild(chip);
      }

      allBtn.addEventListener("click", () => {
        _selCols = resp.columns.slice(0, 12);
        refreshChips(); _rerender();
      });
      clearBtn.addEventListener("click", () => {
        _selCols = _selCols.slice(0, 2);
        if (_selCols.length < 2) _selCols = resp.columns.slice(0, 2);
        refreshChips(); _rerender();
      });

      chipWrap.appendChild(hdr);
      chipWrap.appendChild(chipRow);
      contentWrap.appendChild(chipWrap);
      refreshChips();
    }

    // ── Plot settings ──────────────────────────────────────────────────────
    {
      const autoAnnot  = resp.columns.length <= 7;
      const autoHeight = Math.max(320, resp.columns.length * 48 + 100);
      _dcorAnnot  = null;
      // _dcorHeight stays at 500 (set at closure init); do not reset to null here

      const isDark         = document.documentElement.getAttribute("data-theme") === "dark";
      const fontColorAuto  = _dcorFontColor === null;
      const fontColorVal   = _dcorFontColor ?? (isDark ? "#8b94b3" : "#4b5478");
      const fontColorOpac  = fontColorAuto ? "0.4" : "1";

      const settingsPanel = document.createElement("details");
      settingsPanel.className = "chart-settings-panel";
      settingsPanel.innerHTML = `
        <summary class="chart-settings-panel__summary">Plot Settings</summary>
        <div class="chart-settings-controls">
          <div class="settings-divider">Typography</div>
          <div class="chart-settings-group">
            <label class="chart-settings-group__label" for="dcor-cs-font">Base font (px)</label>
            <input id="dcor-cs-font" type="number" class="chart-settings-input"
                   min="7" max="24" step="1" value="${_chartSettings.fontSize ?? 12}">
          </div>
          <div class="chart-settings-group">
            <label class="chart-settings-group__label" for="dcor-cs-cell-font">Cell value font (px)</label>
            <input id="dcor-cs-cell-font" type="number" class="chart-settings-input"
                   min="6" max="24" step="1" placeholder="auto" value="">
          </div>
          <div class="chart-settings-group">
            <label class="chart-settings-group__label" for="dcor-cs-label-font">Axis label font (px)</label>
            <input id="dcor-cs-label-font" type="number" class="chart-settings-input"
                   min="6" max="24" step="1" placeholder="auto" value="">
          </div>
          <div class="chart-settings-group">
            <label class="chart-settings-group__label" for="dcor-cs-colorbar-font">Colorbar font (px)</label>
            <input id="dcor-cs-colorbar-font" type="number" class="chart-settings-input"
                   min="6" max="24" step="1" placeholder="auto" value="">
          </div>
          <div class="chart-settings-group">
            <label class="chart-settings-group__label" for="dcor-cs-font-color">Font color</label>
            <div class="color-with-auto">
              <input id="dcor-cs-font-color" type="color" class="chart-settings-color"
                     value="${fontColorVal}" ${fontColorAuto ? "disabled" : ""}
                     style="opacity:${fontColorOpac}">
              <label class="chart-settings-check">
                <input type="checkbox" id="dcor-cs-font-color-auto" ${fontColorAuto ? "checked" : ""}> Auto
              </label>
            </div>
          </div>
          <div class="settings-divider">Figure</div>
          <div class="chart-settings-group">
            <label class="chart-settings-group__label" for="dcor-cs-height">Height (px)</label>
            <div class="width-control">
              <input id="dcor-cs-height" type="number" class="chart-settings-input"
                     min="200" max="1200" step="50" value="500">
              <label class="chart-settings-check">
                <input type="checkbox" id="dcor-cs-height-auto"> Auto
              </label>
            </div>
          </div>
          <div class="chart-settings-group">
            <label class="chart-settings-group__label" for="dcor-cs-scale">Color scale</label>
            <select id="dcor-cs-scale" class="chart-settings-select">
              <option value="Viridis" selected>Viridis</option>
              <option value="Blues">Blues</option>
              <option value="Thermal">Thermal</option>
              <option value="RdPu">Red-Purple</option>
            </select>
          </div>
          <div class="chart-settings-group">
            <span class="chart-settings-group__label">Cell values</span>
            <label class="chart-settings-check">
              <input type="checkbox" id="dcor-cs-annot" checked> Show
            </label>
          </div>
        </div>
      `;
      contentWrap.appendChild(settingsPanel);

      const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

      settingsPanel.querySelector("#dcor-cs-font").addEventListener("input", debounce((e) => {
        const v = parseInt(e.target.value, 10);
        if (v >= 7 && v <= 24) { _dcorFs = v; _rerender(); }
      }, 200));

      // Separate font size inputs — empty string means "use auto"
      const _wireDcorFont = (id, setter) => {
        settingsPanel.querySelector(`#${id}`).addEventListener("input", debounce((e) => {
          const raw = e.target.value.trim();
          const v   = parseInt(raw, 10);
          setter(raw === "" ? null : (isNaN(v) ? null : v));
          _rerender();
        }, 200));
      };
      _wireDcorFont("dcor-cs-cell-font",     v => { _dcorCellFs     = v; });
      _wireDcorFont("dcor-cs-label-font",    v => { _dcorLabelFs    = v; });
      _wireDcorFont("dcor-cs-colorbar-font", v => { _dcorColorbarFs = v; });

      const fontColorInput  = settingsPanel.querySelector("#dcor-cs-font-color");
      const fontColorAuto$  = settingsPanel.querySelector("#dcor-cs-font-color-auto");
      fontColorAuto$.addEventListener("change", () => {
        const isAuto = fontColorAuto$.checked;
        fontColorInput.disabled = isAuto;
        fontColorInput.style.opacity = isAuto ? "0.4" : "1";
        _dcorFontColor = isAuto ? null : fontColorInput.value;
        _rerender();
      });
      fontColorInput.addEventListener("input", debounce((e) => {
        if (!fontColorAuto$.checked) { _dcorFontColor = e.target.value; _rerender(); }
      }, 200));

      const heightInput = settingsPanel.querySelector("#dcor-cs-height");
      const heightAuto$ = settingsPanel.querySelector("#dcor-cs-height-auto");
      heightAuto$.addEventListener("change", () => {
        const isAuto = heightAuto$.checked;
        heightInput.disabled = isAuto;
        _dcorHeight = isAuto ? null : parseInt(heightInput.value, 10);
        _rerender();
      });
      heightInput.addEventListener("input", debounce((e) => {
        if (!heightAuto$.checked) {
          const v = parseInt(e.target.value, 10);
          if (v >= 200 && v <= 1200) { _dcorHeight = v; _rerender(); }
        }
      }, 200));

      settingsPanel.querySelector("#dcor-cs-scale").addEventListener("change", (e) => {
        _dcorScale = e.target.value; _rerender();
      });
      settingsPanel.querySelector("#dcor-cs-annot").addEventListener("change", (e) => {
        _dcorAnnot = e.target.checked; _rerender();
      });
    }

    // ── Plot element ───────────────────────────────────────────────────────
    _plotEl = el("div", { cls: "dcor-heatmap-wrap" });
    contentWrap.appendChild(_plotEl);

    requestAnimationFrame(() => _rerender());
  })();

  return card;
}

// ── 2D Scatter Plot section ───────────────────────────────────────────────────

const _SCATTER2D_KEY = "surrogate_data_scatter2d_settings";
const _SCATTER2D_DEFAULTS = {
  title: "", titlePosition: "left", plotTitleFontSize: 14, axisTitleFontSize: 12,
  legendPosition: "top right", legendFontSize: 10,
  legendBgColor: null, legendBorderColor: "#cccccc", legendBorderWidth: 0,
  fontSize: 11, tickFontSize: 9, fontColor: null,
  markerSize: 7, markerColor: "#3b5dd9",
  edgeColor: "#000000", edgeWidth: 0,
  includedOpacity: 0.75, excludedOpacity: 0.12,
  height: 380,
  plotBgColor: null, paperBgColor: null,
  plotBorderWidth: 0, plotBorderColor: "#cccccc",
  showMajorGrid: true, majorGridColor: "#cccccc", majorGridOpacity: 1.0,
  showMinorGrid: false, minorGridColor: "#e0e0e0", minorGridOpacity: 0.6,
};

function _loadScatter2DSettings() {
  try {
    const raw = localStorage.getItem(_SCATTER2D_KEY);
    if (raw) return { ..._SCATTER2D_DEFAULTS, ...JSON.parse(raw) };
  } catch (_) { /* ignore */ }
  return { ..._SCATTER2D_DEFAULTS };
}

function _saveScatter2DSettings(s) {
  try { localStorage.setItem(_SCATTER2D_KEY, JSON.stringify(s)); } catch (_) { /* ignore */ }
}

function _buildScatter2DSection(containerEl, rows, columns) {
  if (!columns || columns.length < 2 || !rows || !rows.length) return;

  let s2d = _loadScatter2DSettings();

  // Compute min/max for each numeric column once
  const colMins = {}, colMaxs = {};
  for (const col of columns) {
    const vals = rows.map(r => r[col]).filter(v => v != null && isFinite(+v)).map(Number);
    if (vals.length) { colMins[col] = Math.min(...vals); colMaxs[col] = Math.max(...vals); }
  }
  const numericCols = columns.filter(c => colMins[c] !== undefined);
  if (numericCols.length < 2) return;

  // Active filter state: [lo, hi] per column, initialised to full range
  const filterRanges = {};
  for (const col of numericCols) {
    if (colMins[col] !== colMaxs[col]) filterRanges[col] = [colMins[col], colMaxs[col]];
  }

  // ── Section card ─────────────────────────────────────────────────────────
  const section = el("div", { cls: "scatter2d-section" });
  section.innerHTML = `<h3 class="explore-subsection-title">2D Scatter Plot</h3>`;
  containerEl.appendChild(section);

  // ── Settings panel ───────────────────────────────────────────────────────
  const fontColorAuto  = s2d.fontColor   === null;
  const fontColorVal   = s2d.fontColor   || "#4b5478";
  const plotBgAuto     = s2d.plotBgColor  === null;
  const plotBgVal      = s2d.plotBgColor  || "#ffffff";
  const paperBgAuto    = s2d.paperBgColor === null;
  const paperBgVal     = s2d.paperBgColor || "#f5f6fa";
  const edgeOff        = s2d.edgeWidth === 0;

  const settingsPanel = document.createElement("details");
  settingsPanel.className = "chart-settings-panel";
  const legendBgAuto   = s2d.legendBgColor === null;
  const legendBgVal    = s2d.legendBgColor || "#ffffff";
  const legendBorderOff = s2d.legendBorderWidth === 0;
  const plotBorderOff  = s2d.plotBorderWidth === 0;

  settingsPanel.innerHTML = `
    <summary class="chart-settings-panel__summary">Plot Settings</summary>
    <div class="chart-settings-controls">

      <div class="settings-divider">Title</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-title">Title text</label>
        <input id="s2d-title" type="text" class="chart-settings-input" style="flex:1;min-width:0"
               placeholder="(none)" value="${s2d.title || ""}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-title-pos">Title position</label>
        <select id="s2d-title-pos" class="chart-settings-select">
          <option value="left"   ${s2d.titlePosition === "left"   ? "selected" : ""}>Left</option>
          <option value="center" ${s2d.titlePosition === "center" ? "selected" : ""}>Center</option>
          <option value="right"  ${s2d.titlePosition === "right"  ? "selected" : ""}>Right</option>
        </select>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-plot-title-font">Title font (px)</label>
        <input id="s2d-plot-title-font" type="number" class="chart-settings-input" min="8" max="36" step="1" value="${s2d.plotTitleFontSize}">
      </div>

      <div class="settings-divider">Typography</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-font-size">General font (px)</label>
        <input id="s2d-font-size" type="number" class="chart-settings-input" min="8" max="36" step="1" value="${s2d.fontSize}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-tick-font">Tick font (px)</label>
        <input id="s2d-tick-font" type="number" class="chart-settings-input" min="6" max="28" step="1" value="${s2d.tickFontSize}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-axis-title-font">Axis label font (px)</label>
        <input id="s2d-axis-title-font" type="number" class="chart-settings-input" min="8" max="36" step="1" value="${s2d.axisTitleFontSize}">
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Font color</span>
        <div class="color-with-auto">
          <input id="s2d-font-color" type="color" class="chart-settings-color"
                 value="${fontColorVal}" ${fontColorAuto ? "disabled" : ""} style="opacity:${fontColorAuto ? "0.4" : "1"}">
          <label class="chart-settings-check">
            <input type="checkbox" id="s2d-font-color-auto" ${fontColorAuto ? "checked" : ""}> Auto
          </label>
        </div>
      </div>

      <div class="settings-divider">Markers</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-marker-size">Marker size</label>
        <input id="s2d-marker-size" type="number" class="chart-settings-input" min="3" max="30" step="1" value="${s2d.markerSize}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-marker-color">Marker color</label>
        <input id="s2d-marker-color" type="color" class="chart-settings-color" value="${s2d.markerColor}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-edge-width">Edge width</label>
        <input id="s2d-edge-width" type="number" class="chart-settings-input" min="0" max="3" step="0.5" value="${s2d.edgeWidth}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-edge-color">Edge color</label>
        <input id="s2d-edge-color" type="color" class="chart-settings-color"
               value="${s2d.edgeColor}" ${edgeOff ? "disabled" : ""} style="opacity:${edgeOff ? "0.4" : "1"}">
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Incl. opacity</span>
        <div class="range-with-value">
          <input id="s2d-inc-opacity" type="range" class="chart-settings-range" min="0.1" max="1.0" step="0.05" value="${s2d.includedOpacity}">
          <span id="s2d-inc-opacity-val" class="chart-settings-range-val">${s2d.includedOpacity.toFixed(2)}</span>
        </div>
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Excl. opacity</span>
        <div class="range-with-value">
          <input id="s2d-exc-opacity" type="range" class="chart-settings-range" min="0.02" max="0.5" step="0.02" value="${s2d.excludedOpacity}">
          <span id="s2d-exc-opacity-val" class="chart-settings-range-val">${s2d.excludedOpacity.toFixed(2)}</span>
        </div>
      </div>

      <div class="settings-divider">Figure</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-height">Height (px)</label>
        <input id="s2d-height" type="number" class="chart-settings-input" min="200" max="900" step="50" value="${s2d.height}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-plot-bg">Plot bg</label>
        <div class="color-with-auto">
          <input id="s2d-plot-bg" type="color" class="chart-settings-color"
                 value="${plotBgVal}" ${plotBgAuto ? "disabled" : ""} style="opacity:${plotBgAuto ? "0.4" : "1"}">
          <label class="chart-settings-check">
            <input type="checkbox" id="s2d-plot-bg-auto" ${plotBgAuto ? "checked" : ""}> Auto
          </label>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-paper-bg">Paper bg</label>
        <div class="color-with-auto">
          <input id="s2d-paper-bg" type="color" class="chart-settings-color"
                 value="${paperBgVal}" ${paperBgAuto ? "disabled" : ""} style="opacity:${paperBgAuto ? "0.4" : "1"}">
          <label class="chart-settings-check">
            <input type="checkbox" id="s2d-paper-bg-auto" ${paperBgAuto ? "checked" : ""}> Auto
          </label>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-plot-border-width">Plot border</label>
        <div class="color-with-auto">
          <input id="s2d-plot-border-width" type="number" class="chart-settings-input"
                 min="0" max="4" step="1" value="${s2d.plotBorderWidth}" style="width:52px">
          <input id="s2d-plot-border-color" type="color" class="chart-settings-color"
                 value="${s2d.plotBorderColor}" ${plotBorderOff ? "disabled" : ""} style="opacity:${plotBorderOff ? "0.4" : "1"}">
        </div>
      </div>

      <div class="settings-divider">Legend</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-legend-pos">Position</label>
        <select id="s2d-legend-pos" class="chart-settings-select">
          <option value="top right"    ${s2d.legendPosition === "top right"    ? "selected" : ""}>Top Right</option>
          <option value="top left"     ${s2d.legendPosition === "top left"     ? "selected" : ""}>Top Left</option>
          <option value="bottom right" ${s2d.legendPosition === "bottom right" ? "selected" : ""}>Bottom Right</option>
          <option value="bottom left"  ${s2d.legendPosition === "bottom left"  ? "selected" : ""}>Bottom Left</option>
          <option value="top center"   ${s2d.legendPosition === "top center"   ? "selected" : ""}>Top Center</option>
          <option value="hidden"       ${s2d.legendPosition === "hidden"       ? "selected" : ""}>Hidden</option>
        </select>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-legend-font">Legend font (px)</label>
        <input id="s2d-legend-font" type="number" class="chart-settings-input" min="6" max="28" step="1" value="${s2d.legendFontSize}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-legend-bg">Legend bg</label>
        <div class="color-with-auto">
          <input id="s2d-legend-bg" type="color" class="chart-settings-color"
                 value="${legendBgVal}" ${legendBgAuto ? "disabled" : ""} style="opacity:${legendBgAuto ? "0.4" : "1"}">
          <label class="chart-settings-check">
            <input type="checkbox" id="s2d-legend-bg-auto" ${legendBgAuto ? "checked" : ""}> Auto
          </label>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="s2d-legend-border-width">Legend border</label>
        <div class="color-with-auto">
          <input id="s2d-legend-border-width" type="number" class="chart-settings-input"
                 min="0" max="4" step="1" value="${s2d.legendBorderWidth}" style="width:52px">
          <input id="s2d-legend-border-color" type="color" class="chart-settings-color"
                 value="${s2d.legendBorderColor}" ${legendBorderOff ? "disabled" : ""} style="opacity:${legendBorderOff ? "0.4" : "1"}">
        </div>
      </div>

      <div class="settings-divider">Gridlines</div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Major grid</span>
        <div class="color-with-auto">
          <label class="chart-settings-check">
            <input type="checkbox" id="s2d-major-grid" ${s2d.showMajorGrid ? "checked" : ""}> On
          </label>
          <input id="s2d-major-grid-color" type="color" class="chart-settings-color"
                 value="${s2d.majorGridColor}" ${!s2d.showMajorGrid ? "disabled" : ""} style="opacity:${s2d.showMajorGrid ? "1" : "0.4"}">
          <div class="range-with-value">
            <input id="s2d-major-grid-opacity" type="range" class="chart-settings-range"
                   min="0.1" max="1.0" step="0.05" value="${s2d.majorGridOpacity}" ${!s2d.showMajorGrid ? "disabled" : ""}>
            <span id="s2d-major-grid-opacity-val" class="chart-settings-range-val">${s2d.majorGridOpacity.toFixed(2)}</span>
          </div>
        </div>
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Minor grid</span>
        <div class="color-with-auto">
          <label class="chart-settings-check">
            <input type="checkbox" id="s2d-minor-grid" ${s2d.showMinorGrid ? "checked" : ""}> On
          </label>
          <input id="s2d-minor-grid-color" type="color" class="chart-settings-color"
                 value="${s2d.minorGridColor}" ${!s2d.showMinorGrid ? "disabled" : ""} style="opacity:${s2d.showMinorGrid ? "1" : "0.4"}">
          <div class="range-with-value">
            <input id="s2d-minor-grid-opacity" type="range" class="chart-settings-range"
                   min="0.1" max="1.0" step="0.05" value="${s2d.minorGridOpacity}" ${!s2d.showMinorGrid ? "disabled" : ""}>
            <span id="s2d-minor-grid-opacity-val" class="chart-settings-range-val">${s2d.minorGridOpacity.toFixed(2)}</span>
          </div>
        </div>
      </div>

    </div>
  `;
  section.appendChild(settingsPanel);

  // ── Axis selectors ───────────────────────────────────────────────────────
  const axisRow = el("div", { cls: "explore-controls-row" });
  axisRow.innerHTML = `
    <label class="explore-controls-row__label">X axis</label>
    <select id="s2d-x-axis" class="explore-select"></select>
    <label class="explore-controls-row__label" style="margin-left:var(--space-4)">Y axis</label>
    <select id="s2d-y-axis" class="explore-select"></select>
  `;
  section.appendChild(axisRow);

  const xSel = axisRow.querySelector("#s2d-x-axis");
  const ySel = axisRow.querySelector("#s2d-y-axis");
  numericCols.forEach((col, i) => {
    xSel.add(new Option(col, col, i === 0, i === 0));
    ySel.add(new Option(col, col, i === 1, i === 1));
  });

  // ── Chart (ABOVE filters) ────────────────────────────────────────────────
  const chartEl = el("div", { cls: "scatter2d-chart" });
  section.appendChild(chartEl);

  function _draw() {
    // Only pass ranges that have been narrowed from the column's full range.
    // Full-range entries would appear in the annotation box and inflate the
    // excluded count even though no points are actually filtered.
    const activeFilters = {};
    for (const [col, [lo, hi]] of Object.entries(filterRanges)) {
      if (lo > colMins[col] || hi < colMaxs[col]) activeFilters[col] = [lo, hi];
    }
    renderDataScatter2D(chartEl, rows, {
      xCol: xSel.value, yCol: ySel.value,
      filterRanges: activeFilters,
      ...s2d,
    });
  }

  _draw();
  document.addEventListener("theme:changed", _draw);
  xSel.addEventListener("change", _draw);
  ySel.addEventListener("change", _draw);

  // ── Filter panel (BELOW chart) ───────────────────────────────────────────
  const filterableCount = Object.keys(filterRanges).length;
  const filterDetails = document.createElement("details");
  filterDetails.className = "scatter2d-filter-panel";
  const filterSummary = el("summary", { cls: "scatter2d-filter-summary" });
  const filterBadge   = el("span",   { cls: "scatter2d-filter-badge", text: "0 active" });
  filterSummary.appendChild(document.createTextNode(`Filters (${filterableCount} column${filterableCount !== 1 ? "s" : ""})`));
  filterSummary.appendChild(filterBadge);
  filterDetails.appendChild(filterSummary);

  const filterGrid = el("div", { cls: "scatter2d-filter-grid" });
  filterDetails.appendChild(filterGrid);
  section.appendChild(filterDetails);

  // Track how many filters are currently narrowed from full range
  function _updateBadge() {
    let active = 0;
    for (const col of Object.keys(filterRanges)) {
      const [lo, hi] = filterRanges[col];
      if (lo > colMins[col] || hi < colMaxs[col]) active++;
    }
    filterBadge.textContent = `${active} active`;
    filterBadge.classList.toggle("scatter2d-filter-badge--active", active > 0);
  }

  // Build one filter card per numeric column with slider + number inputs
  for (const col of numericCols) {
    const lo = colMins[col], hi = colMaxs[col];
    if (lo === hi) continue;  // constant column — no range to filter
    const step = (hi - lo) / 500 || 0.0001;
    const dec  = step < 0.01 ? 4 : step < 0.1 ? 3 : step < 1 ? 2 : 1;

    const card   = el("div", { cls: "scatter2d-filter-item" });
    const header = el("div", { cls: "scatter2d-filter-item-header" });
    const label  = el("span", { cls: "scatter2d-filter-item-label" });
    label.textContent = col;
    label.title       = col;
    const resetBtn = el("button", { cls: "scatter2d-filter-reset", type: "button", text: "↺" });
    resetBtn.title = "Reset to full range";
    header.appendChild(label);
    header.appendChild(resetBtn);

    const controls = el("div", { cls: "scatter2d-filter-controls" });
    controls.innerHTML = `
      <input type="number" class="scatter2d-num" id="s2d-nlo-${col}"
             min="${lo}" max="${hi}" step="${step}" value="${lo.toFixed(dec)}">
      <input type="range"  class="scatter2d-slider" id="s2d-slo-${col}"
             min="${lo}" max="${hi}" step="${step}" value="${lo}">
      <input type="range"  class="scatter2d-slider" id="s2d-shi-${col}"
             min="${lo}" max="${hi}" step="${step}" value="${hi}">
      <input type="number" class="scatter2d-num" id="s2d-nhi-${col}"
             min="${lo}" max="${hi}" step="${step}" value="${hi.toFixed(dec)}">
    `;

    card.appendChild(header);
    card.appendChild(controls);
    filterGrid.appendChild(card);

    const nLo = controls.querySelector(`#s2d-nlo-${col}`);
    const nHi = controls.querySelector(`#s2d-nhi-${col}`);
    const sLo = controls.querySelector(`#s2d-slo-${col}`);
    const sHi = controls.querySelector(`#s2d-shi-${col}`);

    function _clamp(v, mn, mx) { return Math.min(Math.max(v, mn), mx); }

    function _sync(newLo, newHi) {
      newLo = _clamp(newLo, lo, hi);
      newHi = _clamp(newHi, lo, hi);
      if (newLo > newHi) newLo = newHi;
      filterRanges[col] = [newLo, newHi];
      sLo.value = newLo; sHi.value = newHi;
      nLo.value = newLo.toFixed(dec); nHi.value = newHi.toFixed(dec);
      _updateBadge();
      _draw();
    }

    sLo.addEventListener("input", () => _sync(parseFloat(sLo.value), filterRanges[col][1]));
    sHi.addEventListener("input", () => _sync(filterRanges[col][0], parseFloat(sHi.value)));
    nLo.addEventListener("change", () => _sync(parseFloat(nLo.value), filterRanges[col][1]));
    nHi.addEventListener("change", () => _sync(filterRanges[col][0], parseFloat(nHi.value)));
    resetBtn.addEventListener("click", () => _sync(lo, hi));
  }

  // ── Settings wiring ──────────────────────────────────────────────────────
  function _getEl(id) { return settingsPanel.querySelector(`#${id}`); }
  function _num(id)   { return parseFloat(_getEl(id).value) || 0; }
  function _str(id)   { return _getEl(id).value; }
  function _chk(id)   { return _getEl(id).checked; }

  function _applySettings() {
    const fontAuto        = _chk("s2d-font-color-auto");
    const plotBgAutoC     = _chk("s2d-plot-bg-auto");
    const paperBgAutoC    = _chk("s2d-paper-bg-auto");
    const legendBgAutoC   = _chk("s2d-legend-bg-auto");
    const plotBorderW     = _num("s2d-plot-border-width");
    const legendBorderW   = _num("s2d-legend-border-width");
    s2d = {
      title:              _str("s2d-title"),
      titlePosition:      _str("s2d-title-pos"),
      plotTitleFontSize:  _num("s2d-plot-title-font"),
      axisTitleFontSize:  _num("s2d-axis-title-font"),
      legendPosition:     _str("s2d-legend-pos"),
      legendFontSize:     _num("s2d-legend-font"),
      legendBgColor:      legendBgAutoC   ? null : _str("s2d-legend-bg"),
      legendBorderWidth:  legendBorderW,
      legendBorderColor:  _str("s2d-legend-border-color"),
      fontSize:           _num("s2d-font-size"),
      tickFontSize:       _num("s2d-tick-font"),
      fontColor:          fontAuto        ? null : _str("s2d-font-color"),
      markerSize:         _num("s2d-marker-size"),
      markerColor:        _str("s2d-marker-color"),
      edgeWidth:          _num("s2d-edge-width"),
      edgeColor:          _str("s2d-edge-color"),
      includedOpacity:    parseFloat(_str("s2d-inc-opacity")),
      excludedOpacity:    parseFloat(_str("s2d-exc-opacity")),
      height:             _num("s2d-height"),
      plotBgColor:        plotBgAutoC     ? null : _str("s2d-plot-bg"),
      paperBgColor:       paperBgAutoC    ? null : _str("s2d-paper-bg"),
      plotBorderWidth:    plotBorderW,
      plotBorderColor:    _str("s2d-plot-border-color"),
      showMajorGrid:      _chk("s2d-major-grid"),
      majorGridColor:     _str("s2d-major-grid-color"),
      majorGridOpacity:   parseFloat(_str("s2d-major-grid-opacity")),
      showMinorGrid:      _chk("s2d-minor-grid"),
      minorGridColor:     _str("s2d-minor-grid-color"),
      minorGridOpacity:   parseFloat(_str("s2d-minor-grid-opacity")),
    };
    _saveScatter2DSettings(s2d);
    _draw();
  }

  function _wireRange(id, valId) {
    const input = _getEl(id), span = _getEl(valId);
    if (!input || !span) return;
    input.addEventListener("input", () => { span.textContent = parseFloat(input.value).toFixed(2); _applySettings(); });
  }
  _wireRange("s2d-inc-opacity",        "s2d-inc-opacity-val");
  _wireRange("s2d-exc-opacity",        "s2d-exc-opacity-val");
  _wireRange("s2d-major-grid-opacity", "s2d-major-grid-opacity-val");
  _wireRange("s2d-minor-grid-opacity", "s2d-minor-grid-opacity-val");

  function _wireAutoToggle(chkId, colorId) {
    const chk = _getEl(chkId), color = _getEl(colorId);
    if (!chk || !color) return;
    chk.addEventListener("change", () => {
      color.disabled = chk.checked;
      color.style.opacity = chk.checked ? "0.4" : "1";
      _applySettings();
    });
  }
  _wireAutoToggle("s2d-font-color-auto",  "s2d-font-color");
  _wireAutoToggle("s2d-plot-bg-auto",     "s2d-plot-bg");
  _wireAutoToggle("s2d-paper-bg-auto",    "s2d-paper-bg");
  _wireAutoToggle("s2d-legend-bg-auto",   "s2d-legend-bg");

  function _wireGridToggle(chkId, colorId, opacityId) {
    const chk = _getEl(chkId), color = _getEl(colorId), op = _getEl(opacityId);
    if (!chk) return;
    chk.addEventListener("change", () => {
      if (color) { color.disabled = !chk.checked; color.style.opacity = chk.checked ? "1" : "0.4"; }
      if (op)    { op.disabled = !chk.checked; }
      _applySettings();
    });
  }
  _wireGridToggle("s2d-major-grid", "s2d-major-grid-color", "s2d-major-grid-opacity");
  _wireGridToggle("s2d-minor-grid", "s2d-minor-grid-color", "s2d-minor-grid-opacity");

  // Width → enable/disable linked color picker
  function _wireWidthColor(widthId, colorId) {
    _getEl(widthId).addEventListener("change", () => {
      const w = parseFloat(_getEl(widthId).value);
      const c = _getEl(colorId);
      c.disabled = w === 0; c.style.opacity = w === 0 ? "0.4" : "1";
      _applySettings();
    });
  }
  _wireWidthColor("s2d-edge-width",         "s2d-edge-color");
  _wireWidthColor("s2d-plot-border-width",   "s2d-plot-border-color");
  _wireWidthColor("s2d-legend-border-width", "s2d-legend-border-color");

  ["s2d-title","s2d-title-pos","s2d-plot-title-font","s2d-axis-title-font",
   "s2d-legend-pos","s2d-legend-font","s2d-legend-bg","s2d-legend-border-color",
   "s2d-font-size","s2d-tick-font","s2d-font-color",
   "s2d-marker-size","s2d-marker-color","s2d-edge-color",
   "s2d-height","s2d-plot-bg","s2d-paper-bg","s2d-plot-border-color",
   "s2d-major-grid-color","s2d-minor-grid-color"].forEach(id => {
    const el2 = _getEl(id);
    if (el2) el2.addEventListener("change", _applySettings);
  });
}

// ── Column selector (chip row) ────────────────────────────────────────────────

function _buildColumnSelector(columns, onchange) {
  const MAX_SPLOM = 12;
  const MIN_SPLOM = 2;

  const wrap = el("div", { cls: "col-selector-wrap" });

  const header    = el("div", { cls: "col-selector-header" });
  const countEl   = el("span", { cls: "col-selector-count" });
  const allBtn    = el("button", { cls: "col-selector-btn", text: "All" });
  allBtn.type     = "button";
  const clearBtn  = el("button", { cls: "col-selector-btn", text: "Clear" });
  clearBtn.type   = "button";
  header.appendChild(countEl);
  header.appendChild(allBtn);
  header.appendChild(clearBtn);

  const chipRow = el("div", { cls: "col-selector-row" });

  function refresh() {
    countEl.textContent = `Plot columns: ${_selectedCols.length} / ${MAX_SPLOM}`;
    chipRow.querySelectorAll(".col-chip").forEach((chip) => {
      const col      = chip.dataset.col;
      const selected = _selectedCols.includes(col);
      chip.classList.toggle("col-chip--selected", selected);
      chip.disabled  = !selected && _selectedCols.length >= MAX_SPLOM;
    });
    clearBtn.disabled = _selectedCols.length <= MIN_SPLOM;
  }

  for (const col of columns) {
    const chip      = el("button", { cls: "col-chip" });
    chip.type       = "button";
    chip.textContent = col;
    chip.title      = col;
    chip.dataset.col = col;

    chip.addEventListener("click", () => {
      const isSelected = _selectedCols.includes(col);
      if (isSelected) {
        if (_selectedCols.length <= MIN_SPLOM) return;
        _selectedCols = _selectedCols.filter(c => c !== col);
      } else {
        if (_selectedCols.length >= MAX_SPLOM) return;
        _selectedCols = [..._selectedCols, col];
      }
      refresh();
      onchange();
    });

    chipRow.appendChild(chip);
  }

  allBtn.addEventListener("click", () => {
    _selectedCols = columns.slice(0, MAX_SPLOM);
    refresh();
    onchange();
  });

  clearBtn.addEventListener("click", () => {
    _selectedCols = _selectedCols.slice(0, MIN_SPLOM);
    if (_selectedCols.length < MIN_SPLOM) _selectedCols = columns.slice(0, MIN_SPLOM);
    refresh();
    onchange();
  });

  wrap.appendChild(header);
  wrap.appendChild(chipRow);

  _selectorRefreshFn = refresh;
  refresh();
  return wrap;
}

/**
 * Update the column selector default selection when designation changes.
 * Called from main.js after the user confirms column roles.
 *
 * @param {string[]} inputCols  - Designated input column names.
 * @param {string[]} outputCols - Designated output column names.
 */
export function updateColumnSelectorRoles(inputCols, outputCols) {
  if (!_allColumns.length) return;
  const MAX_SPLOM = 12;
  const outCols   = (outputCols || []).filter(c => _allColumns.includes(c));
  const inCols    = (inputCols  || []).filter(c => _allColumns.includes(c));
  const rest      = _allColumns.filter(c => !outCols.includes(c) && !inCols.includes(c));
  _selectedCols   = [...outCols, ...inCols, ...rest].slice(0, MAX_SPLOM);
  _currentColumns = _selectedCols;
  if (_selectorRefreshFn) _selectorRefreshFn();
  _outlierIndices = detectOutliers(_currentRows, _currentColumns);
  // If the chart element is inside a hidden panel (display:none), rendering into it
  // produces a zero-width plot. Defer until notifyExploreVisible() is called.
  if (_chartEl && _chartEl.offsetParent !== null) {
    _rerender();
  } else {
    _rerenderPending = true;
  }
}

export function notifyExploreVisible() {
  if (_rerenderPending && _chartEl) {
    _rerenderPending = false;
    // Defer one frame so the browser commits layout after removing .hidden.
    requestAnimationFrame(() => _rerender());
  }
}
