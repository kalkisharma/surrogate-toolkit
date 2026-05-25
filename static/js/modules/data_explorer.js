// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/data_explorer.js
// Version: 1.1.2
// Description: Data exploration view — full-dataset scatter matrix, per-column
//              stats below chart, outlier overlay, and expandable plot settings.
// =============================================================================

import { renderScatterMatrix, renderDCorHeatmap } from "../charts.js";
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
    markerSize: _chartSettings.markerSize !== null ? _chartSettings.markerSize : autoMarkerSize,
    height:     _chartSettings.height     !== null ? _chartSettings.height     : autoHeight,
  });
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

  // ── Stats section (below chart) ───────────────────────────────────────────
  const statsEl = _buildStatsSection(_allColumns, plotRows, usingFullStats ? _fullStats : null, totalRows);
  containerEl.appendChild(statsEl);

  // ── Distance Correlation heatmap (lazy — fetched on first expand) ─────────
  containerEl.appendChild(_buildDCorSection());

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
  let _dcorFontColor  = null;    // null = auto (inherit _chartSettings.fontColor)
  let _dcorAnnot      = null;    // null = auto (true when ≤ 7 cols selected)
  let _dcorScale      = "Viridis";
  let _dcorHeight     = null;    // null = auto from column count
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
      fontSize:        _dcorFs         !== null ? _dcorFs         : (_chartSettings.fontSize ?? 11),
      fontColor:       _dcorFontColor  !== null ? _dcorFontColor  : (_chartSettings.fontColor ?? null),
      showAnnotations: _dcorAnnot      !== null ? _dcorAnnot      : (cols.length <= 7),
      colorscale:      _dcorScale,
      height:          _dcorHeight,
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
      _dcorHeight = null;

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
            <label class="chart-settings-group__label" for="dcor-cs-font">Font size (px)</label>
            <input id="dcor-cs-font" type="number" class="chart-settings-input"
                   min="7" max="18" step="1" value="${_chartSettings.fontSize ?? 11}">
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
                     min="200" max="1200" step="50" value="${autoHeight}"
                     ${_dcorHeight === null ? "disabled" : ""}>
              <label class="chart-settings-check">
                <input type="checkbox" id="dcor-cs-height-auto" checked> Auto
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
              <input type="checkbox" id="dcor-cs-annot" ${autoAnnot ? "checked" : ""}> Show
            </label>
          </div>
        </div>
      `;
      contentWrap.appendChild(settingsPanel);

      const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

      settingsPanel.querySelector("#dcor-cs-font").addEventListener("input", debounce((e) => {
        const v = parseInt(e.target.value, 10);
        if (v >= 7 && v <= 18) { _dcorFs = v; _rerender(); }
      }, 200));

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
