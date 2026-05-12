// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/data_explorer.js
// Description: Data exploration view — scatter plot matrix (via charts.js),
//              stats sidebar, outlier overlay toggle, and plot settings panel.
// =============================================================================

import { renderScatterMatrix } from "../charts.js";
import { registerPrimer, registerTooltip } from "../learning_mode.js";
import { mean, stdDev, median, skewness, detectOutliers, el, formatNum, clearEl } from "../utils.js";
import { get } from "../api.js";
import { showError } from "../notifications.js";

let _currentRows = [];
let _currentColumns = [];
let _outlierIndices = new Set();
let _showOutliers = false;
let _chartEl = null;

// ── Chart settings ────────────────────────────────────────────────────────────

const _SETTINGS_KEY = "surrogate_chart_settings";

const _DEFAULT_SETTINGS = {
  fontSize:      11,
  tickFontSize:  9,
  markerSize:    null,   // null = auto-scale by row count
  height:        null,   // null = auto-scale by column count
  showMajorGrid: true,
  showMinorGrid: false,
  palette:       "blueRed",
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

function _rerender() {
  if (!_chartEl || !_currentRows.length) return;
  const displayedCount = Math.min(_currentColumns.length, 10);
  const autoMarkerSize = Math.max(4, Math.min(8, 400 / _currentRows.length));
  const autoHeight     = Math.max(400, displayedCount * 90);
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

  // Try to load full-dataset stats from the summary endpoint.
  // Falls back to preview data if /api/data/summary is unavailable.
  let rows = uploadResponse.preview.rows;
  let columns = uploadResponse.preview.columns;
  let totalRows = uploadResponse.preview.total_rows;
  let usingFullData = false;

  const summaryResp = await get("/api/data/summary");
  if (summaryResp.success && summaryResp.stats) {
    _fullStats = summaryResp.stats;
    usingFullData = true;
  }

  _currentRows = rows;
  _currentColumns = columns;
  _outlierIndices = detectOutliers(rows, columns);

  // Pre-compute auto values used by both the settings panel and initial render
  const displayedCount = Math.min(columns.length, 10);
  const autoMarkerSize = Math.max(4, Math.min(8, 400 / rows.length));
  const autoHeight     = Math.max(400, displayedCount * 90);

  // ── Layout ────────────────────────────────────────────────────────────────
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Data Exploration</h2>
    <p class="section-desc">
      ${totalRows.toLocaleString()} rows × ${columns.length} columns
      — showing ${rows.length} preview rows in scatter matrix
    </p>
  `;
  containerEl.appendChild(header);

  // Learning mode primer
  registerPrimer(
    "explore",
    header,
    "What am I looking at? — Data exploration explained",
    `<p>The scatter plot matrix shows every pair of variables plotted against each other.
     Patterns here reveal correlations, clusters, and outliers before any model is trained.
     The stats sidebar shows key summary statistics for each column.</p>
     <p><strong>Tip:</strong> Highly correlated column pairs (diagonal lines) may indicate
     redundant inputs — the Dimensionality Reduction step addresses this.</p>`
  );

  if (usingFullData) {
    const notice = el("div", {
      cls: "limitation-notice",
      text: "Scatter matrix shows preview rows only. Summary statistics reflect the full dataset.",
    });
    containerEl.appendChild(notice);
  } else {
    const notice = el("div", {
      cls: "limitation-notice",
      text: `Scatter matrix and statistics are computed from ${rows.length} preview rows. Full-dataset statistics will be available in Phase 2.`,
    });
    containerEl.appendChild(notice);
  }

  // ── Column cap warning ────────────────────────────────────────────────────
  if (columns.length > 10) {
    const capNotice = el("div", {
      cls: "limitation-notice",
      html: `<strong>Note:</strong> Showing first 10 of ${columns.length} columns in the scatter matrix. Use the column selector (Phase 2) to choose which columns to display.`,
    });
    containerEl.appendChild(capNotice);
  }

  // ── Controls ──────────────────────────────────────────────────────────────
  const controls = el("div", { cls: "explore-controls" });
  const outlierLabel = el("label", { cls: "explore-controls__label" });
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
    const outlierCount = el("span", {
      cls: "text-muted text-sm",
      text: `${_outlierIndices.size} potential outlier row(s) detected`,
    });
    controls.appendChild(outlierCount);
  }

  containerEl.appendChild(controls);

  // ── Plot settings panel ───────────────────────────────────────────────────
  const panelEl = _renderSettingsPanel(
    _chartSettings.markerSize !== null ? _chartSettings.markerSize : autoMarkerSize,
    _chartSettings.height     !== null ? _chartSettings.height     : autoHeight
  );
  containerEl.appendChild(panelEl);

  // ── Two-column layout ─────────────────────────────────────────────────────
  const layout = el("div", { cls: "explore-layout" });

  // Chart column
  const chartCol = el("div", { cls: "explore-chart" });
  const chartWrap = el("div", { cls: "explore-chart-wrap", id: "splom-container" });
  chartCol.appendChild(chartWrap);
  _chartEl = chartWrap;

  // Stats sidebar
  const sidebar = el("div", { cls: "explore-sidebar" });
  const statsCard = _buildStatsCard(columns, rows, usingFullData ? _fullStats : null);
  sidebar.appendChild(statsCard);

  layout.appendChild(chartCol);
  layout.appendChild(sidebar);
  containerEl.appendChild(layout);

  // ── Render chart ──────────────────────────────────────────────────────────
  renderScatterMatrix(chartWrap, columns, rows, {
    outlierIndices: _showOutliers ? _outlierIndices : new Set(),
    ..._chartSettings,
    markerSize: _chartSettings.markerSize !== null ? _chartSettings.markerSize : autoMarkerSize,
    height:     _chartSettings.height     !== null ? _chartSettings.height     : autoHeight,
  });

  // ── Outlier toggle handler ─────────────────────────────────────────────────
  // Full re-render so palette and marker size apply correctly alongside outlier state.
  outlierCheckbox.addEventListener("change", () => {
    _showOutliers = outlierCheckbox.checked;
    _rerender();
  });

  // ── Settings panel event wiring ───────────────────────────────────────────
  _wirePanelEvents(panelEl);
}

// ── Settings panel ────────────────────────────────────────────────────────────

function _renderSettingsPanel(currentMarkerSize, currentHeight) {
  const s = _chartSettings;

  const fontBtns = (target, values, labels) =>
    values.map((v, i) =>
      `<button class="font-size-btn${s[target] === v ? " active" : ""}" data-target="${target}" data-value="${v}">${labels[i]}</button>`
    ).join("");

  const panel = document.createElement("details");
  panel.className = "chart-settings-panel";
  panel.innerHTML = `
    <summary class="chart-settings-panel__summary">Plot Settings</summary>
    <div class="chart-settings-controls">
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Label font</span>
        <div class="font-size-btn-group">
          ${fontBtns("fontSize", [9, 11, 13], ["S", "M", "L"])}
        </div>
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Tick font</span>
        <div class="font-size-btn-group">
          ${fontBtns("tickFontSize", [7, 9, 11], ["S", "M", "L"])}
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="cs-marker-size">Marker size</label>
        <input id="cs-marker-size" type="number" class="chart-settings-input"
               min="3" max="12" step="1" value="${Math.round(currentMarkerSize)}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="cs-height">Height (px)</label>
        <input id="cs-height" type="number" class="chart-settings-input"
               min="300" max="1200" step="50" value="${currentHeight}">
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
  // Font size buttons (label font and tick font share the same handler via data-target)
  panelEl.querySelectorAll(".font-size-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.target;
      const value  = parseInt(btn.dataset.value, 10);
      btn.closest(".font-size-btn-group")
         .querySelectorAll(".font-size-btn")
         .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      _chartSettings[target] = value;
      _saveSettings();
      _rerender();
    });
  });

  // Marker size — debounced so rapid typing doesn't thrash the chart
  const markerInput = panelEl.querySelector("#cs-marker-size");
  let markerTimer;
  markerInput.addEventListener("input", () => {
    clearTimeout(markerTimer);
    markerTimer = setTimeout(() => {
      const val = parseInt(markerInput.value, 10);
      if (val >= 3 && val <= 12) {
        _chartSettings.markerSize = val;
        _saveSettings();
        _rerender();
      }
    }, 200);
  });

  // Figure height — debounced
  const heightInput = panelEl.querySelector("#cs-height");
  let heightTimer;
  heightInput.addEventListener("input", () => {
    clearTimeout(heightTimer);
    heightTimer = setTimeout(() => {
      const val = parseInt(heightInput.value, 10);
      if (val >= 300 && val <= 1200) {
        _chartSettings.height = val;
        _saveSettings();
        _rerender();
      }
    }, 200);
  });

  panelEl.querySelector("#cs-major-grid").addEventListener("change", (e) => {
    _chartSettings.showMajorGrid = e.target.checked;
    _saveSettings();
    _rerender();
  });

  panelEl.querySelector("#cs-minor-grid").addEventListener("change", (e) => {
    _chartSettings.showMinorGrid = e.target.checked;
    _saveSettings();
    _rerender();
  });

  panelEl.querySelector("#cs-palette").addEventListener("change", (e) => {
    _chartSettings.palette = e.target.value;
    _saveSettings();
    _rerender();
  });
}

// ── Stats sidebar builder ─────────────────────────────────────────────────────

let _fullStats = null;

function _buildStatsCard(columns, rows, fullStats) {
  const card = el("div", { cls: "stat-card" });
  const title = el("div", { cls: "stat-card__title", text: "Summary Statistics" });
  card.appendChild(title);

  const list = el("div", { cls: "stat-col-list" });

  for (const col of columns) {
    const vals = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);

    // Use full-dataset stats if available, else compute from preview
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

    const item = el("div", { cls: "stat-col-item" });
    const nameEl = el("div", { cls: "stat-col-name", text: col });

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
      pair.innerHTML = `<span class="stat-pair__key">${key}</span> <span class="stat-pair__val">${val}</span>`;
      valGrid.appendChild(pair);
    }

    item.appendChild(nameEl);
    item.appendChild(valGrid);
    list.appendChild(item);
  }

  card.appendChild(list);
  return card;
}
