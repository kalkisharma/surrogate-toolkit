// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/data_explorer.js
// Description: Data exploration view — full-dataset scatter matrix, per-column
//              stats below chart, outlier overlay, and expandable plot settings.
// =============================================================================

import { renderScatterMatrix } from "../charts.js";
import { registerPrimer, registerTooltip } from "../learning_mode.js";
import { mean, stdDev, median, skewness, detectOutliers, el, formatNum, clearEl } from "../utils.js";
import { get } from "../api.js";
import { showError } from "../notifications.js";

let _currentRows    = [];
let _currentColumns = [];
let _outlierIndices = new Set();
let _showOutliers   = false;
let _chartEl        = null;

// ── Chart settings ────────────────────────────────────────────────────────────

const _SETTINGS_KEY = "surrogate_chart_settings";

const _DEFAULT_SETTINGS = {
  fontSize:      11,
  tickFontSize:  9,
  markerSize:    null,      // null = auto-scale by row count
  height:        null,      // null = auto-scale by column count
  maxWidth:      null,      // null = full (unconstrained)
  showMajorGrid: true,
  showMinorGrid: false,
  palette:       "blueRed",
  opacity:       0.8,
  edgeColor:     "#000000",
  edgeWidth:     0,
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
  const displayedCount = Math.min(_currentColumns.length, 10);
  const autoMarkerSize = Math.max(4, Math.min(8, 400 / _currentRows.length));
  const autoHeight     = Math.max(400, displayedCount * 90);
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

  _currentRows    = plotRows;
  _currentColumns = columns;
  _outlierIndices = detectOutliers(plotRows, columns);

  // Pre-compute auto values needed by the settings panel and initial render
  const displayedCount = Math.min(columns.length, 10);
  const autoMarkerSize = Math.max(4, Math.min(8, 400 / plotRows.length));
  const autoHeight     = Math.max(400, displayedCount * 90);

  // ── Header ────────────────────────────────────────────────────────────────
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Data Exploration</h2>
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

  if (columns.length > 10) {
    containerEl.appendChild(el("div", {
      cls: "limitation-notice",
      html: `<strong>Note:</strong> Showing first 10 of ${columns.length} columns in the scatter matrix. Column selector coming in Phase 2.`,
    }));
  }

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
  const chartWrap = el("div", { cls: "explore-chart-wrap", id: "splom-container" });
  _chartEl = chartWrap;
  containerEl.appendChild(chartWrap);

  // ── Stats section (below chart) ───────────────────────────────────────────
  const statsEl = _buildStatsSection(columns, plotRows, usingFullStats ? _fullStats : null);
  containerEl.appendChild(statsEl);

  // ── Initial render ────────────────────────────────────────────────────────
  _applyWidth();
  renderScatterMatrix(chartWrap, columns, plotRows, {
    outlierIndices: _showOutliers ? _outlierIndices : new Set(),
    ..._chartSettings,
    markerSize: _chartSettings.markerSize !== null ? _chartSettings.markerSize : autoMarkerSize,
    height:     _chartSettings.height     !== null ? _chartSettings.height     : autoHeight,
  });

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

  const edgeColorDisabled = s.edgeWidth === 0 ? "disabled" : "";
  const edgeColorOpacity  = s.edgeWidth === 0 ? "0.4" : "1";
  const widthFull         = s.maxWidth === null;

  panel.innerHTML = `
    <summary class="chart-settings-panel__summary">Plot Settings</summary>
    <div class="chart-settings-controls">

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
        <label class="chart-settings-group__label" for="cs-edge-width">Edge width</label>
        <input id="cs-edge-width" type="number" class="chart-settings-input"
               min="0" max="3" step="0.5" value="${s.edgeWidth}">
      </div>

      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="cs-edge-color">Edge color</label>
        <input id="cs-edge-color" type="color" class="chart-settings-color"
               value="${s.edgeColor}" ${edgeColorDisabled}
               style="opacity:${edgeColorOpacity}">
      </div>

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
        <span class="chart-settings-group__label">Gridlines</span>
        <label class="chart-settings-check">
          <input type="checkbox" id="cs-major-grid" ${s.showMajorGrid ? "checked" : ""}> Major
        </label>
        <label class="chart-settings-check">
          <input type="checkbox" id="cs-minor-grid" ${s.showMinorGrid ? "checked" : ""}> Minor
        </label>
      </div>

      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="cs-palette">Marker palette</label>
        <select id="cs-palette" class="chart-settings-select">
          <option value="blueRed"     ${s.palette === "blueRed"     ? "selected" : ""}>Blue / Red</option>
          <option value="greenOrange" ${s.palette === "greenOrange" ? "selected" : ""}>Green / Orange</option>
          <option value="tealAmber"   ${s.palette === "tealAmber"   ? "selected" : ""}>Teal / Amber</option>
        </select>
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

  // Label font size
  panelEl.querySelector("#cs-font-size").addEventListener("input", debounce((e) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 7 && val <= 20) { _chartSettings.fontSize = val; _saveSettings(); _rerender(); }
  }, 200));

  // Tick font size
  panelEl.querySelector("#cs-tick-font").addEventListener("input", debounce((e) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 6 && val <= 16) { _chartSettings.tickFontSize = val; _saveSettings(); _rerender(); }
  }, 200));

  // Marker size
  panelEl.querySelector("#cs-marker-size").addEventListener("input", debounce((e) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 3 && val <= 12) { _chartSettings.markerSize = val; _saveSettings(); _rerender(); }
  }, 200));

  // Opacity range slider — live value display, immediate update
  const opacityInput = panelEl.querySelector("#cs-opacity");
  const opacityVal   = panelEl.querySelector("#cs-opacity-val");
  opacityInput.addEventListener("input", () => {
    const val = parseFloat(opacityInput.value);
    opacityVal.textContent = val.toFixed(2);
    _chartSettings.opacity = val;
    _saveSettings();
    _rerender();
  });

  // Edge width
  const edgeColorInput = panelEl.querySelector("#cs-edge-color");
  panelEl.querySelector("#cs-edge-width").addEventListener("input", debounce((e) => {
    const val = parseFloat(e.target.value);
    if (val >= 0 && val <= 3) {
      _chartSettings.edgeWidth = val;
      const hasEdge = val > 0;
      edgeColorInput.disabled      = !hasEdge;
      edgeColorInput.style.opacity = hasEdge ? "1" : "0.4";
      _saveSettings();
      _rerender();
    }
  }, 200));

  // Edge color
  edgeColorInput.addEventListener("input", (e) => {
    _chartSettings.edgeColor = e.target.value;
    _saveSettings();
    _rerender();
  });

  // Figure height
  panelEl.querySelector("#cs-height").addEventListener("input", debounce((e) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 300 && val <= 1200) { _chartSettings.height = val; _saveSettings(); _rerender(); }
  }, 200));

  // Width — Full checkbox + number input pair
  const widthInput       = panelEl.querySelector("#cs-width");
  const widthFullCheckbox = panelEl.querySelector("#cs-width-full");

  widthFullCheckbox.addEventListener("change", () => {
    if (widthFullCheckbox.checked) {
      widthInput.disabled      = true;
      _chartSettings.maxWidth  = null;
    } else {
      widthInput.disabled      = false;
      const val = parseInt(widthInput.value, 10);
      _chartSettings.maxWidth  = (val >= 400 && val <= 1400) ? val : 800;
    }
    _saveSettings();
    _rerender();
  });

  widthInput.addEventListener("input", debounce((e) => {
    if (!widthFullCheckbox.checked) {
      const val = parseInt(e.target.value, 10);
      if (val >= 400 && val <= 1400) { _chartSettings.maxWidth = val; _saveSettings(); _rerender(); }
    }
  }, 200));

  // Gridlines
  panelEl.querySelector("#cs-major-grid").addEventListener("change", (e) => {
    _chartSettings.showMajorGrid = e.target.checked; _saveSettings(); _rerender();
  });
  panelEl.querySelector("#cs-minor-grid").addEventListener("change", (e) => {
    _chartSettings.showMinorGrid = e.target.checked; _saveSettings(); _rerender();
  });

  // Palette
  panelEl.querySelector("#cs-palette").addEventListener("change", (e) => {
    _chartSettings.palette = e.target.value; _saveSettings(); _rerender();
  });
}

// ── Stats section (below chart) ───────────────────────────────────────────────

let _fullStats = null;

function _buildStatsSection(columns, rows, fullStats) {
  const section = el("div", { cls: "stats-section" });
  section.appendChild(el("div", { cls: "stats-section__header", text: "Summary Statistics" }));

  const grid = el("div", { cls: "stats-grid" });

  for (const col of columns) {
    const vals = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);

    const stats = fullStats && fullStats[col]
      ? fullStats[col]
      : {
          min:        Math.min(...vals),
          max:        Math.max(...vals),
          mean:       mean(vals),
          std:        stdDev(vals),
          median:     median(vals),
          null_count: rows.filter((r) => r[col] === null || r[col] === undefined).length,
        };

    const skew = skewness(vals);

    const card   = el("div", { cls: "stats-col-card" });
    const nameEl = el("div", { cls: "stats-col-card__name" });
    nameEl.textContent = col;
    nameEl.title       = col;

    const valGrid = el("div", { cls: "stat-col-values" });
    const pairs = [
      ["min",    formatNum(stats.min)],
      ["max",    formatNum(stats.max)],
      ["mean",   formatNum(stats.mean)],
      ["std",    formatNum(stats.std)],
      ["median", formatNum(stats.median)],
      ["nulls",  String(stats.null_count)],
      ["skew",   skew !== null ? formatNum(skew, 2) : "—"],
    ];
    for (const [key, val] of pairs) {
      const pair = el("div", { cls: "stat-pair" });
      pair.innerHTML = `<span class="stat-pair__key">${key}</span><span class="stat-pair__val" title="${val}">${val}</span>`;
      valGrid.appendChild(pair);
    }

    card.appendChild(nameEl);
    card.appendChild(valGrid);
    grid.appendChild(card);
  }

  section.appendChild(grid);
  return section;
}
