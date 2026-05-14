// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/results.js
// Version: 0.8.10
// Description: Step 7 — Training Results. Fetches GET /api/model/results and
//              renders per-output R², RMSE, MAE with R² colour coding, plus a
//              cross-validation summary and combined parity/residual diagnostic
//              figures (1×2 subplots, linked x-axes). Plot Settings panel mirrors
//              the Data Exploration settings with 16 user-controllable properties,
//              persisted to localStorage.
// =============================================================================

import { get } from "../api.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { registerPrimer } from "../learning_mode.js";
import { el, clearEl } from "../utils.js";
import { renderOutputFigure } from "../charts.js";

// R² thresholds — mirror config/settings.py constants
const R2_MINIMUM = 0.70;
const R2_CAUTION = 0.85;

// ── Plot settings (persisted to localStorage) ─────────────────────────────────

const _RESULT_SETTINGS_KEY = "surrogate_result_chart_settings";
const _DEFAULT_RESULT_SETTINGS = {
  // Typography
  fontSize:         11,
  tickFontSize:     9,
  fontColor:        null,    // null = auto (theme default)
  // Markers
  markerSize:       7,
  opacity:          0.70,
  edgeWidth:        0,
  edgeColor:        "#000000",
  // Figure
  height:           300,
  plotBgColor:      null,    // null = transparent
  paperBgColor:     null,    // null = transparent
  // Gridlines
  showMajorGrid:    true,
  majorGridColor:   "#cccccc",
  majorGridOpacity: 1.0,
  showMinorGrid:    false,
  minorGridColor:   "#e0e0e0",
  minorGridOpacity: 0.6,
};

let _resultSettings = { ..._DEFAULT_RESULT_SETTINGS };
let _plotItems = [];   // { figWrap, yTrue, yPred, colName, badgeCls } — cached for re-render

function _loadResultSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(_RESULT_SETTINGS_KEY) || "{}");
    _resultSettings = { ..._DEFAULT_RESULT_SETTINGS, ...stored };
  } catch { _resultSettings = { ..._DEFAULT_RESULT_SETTINGS }; }
}

function _saveResultSettings() {
  localStorage.setItem(_RESULT_SETTINGS_KEY, JSON.stringify(_resultSettings));
}

function _rerenderPlots() {
  for (const p of _plotItems) {
    p.figWrap.style.height    = `${_resultSettings.height}px`;
    p.figWrap.style.minHeight = `${_resultSettings.height}px`;
    renderOutputFigure(p.figWrap, p.yTrue, p.yPred, p.colName, p.badgeCls, _resultSettings);
  }
}

function _buildSettingsPanel() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";

  // Resolve display values for null (auto) color settings
  const fontColorVal  = _resultSettings.fontColor    !== null ? _resultSettings.fontColor    : (isDark ? "#8b94b3" : "#4b5478");
  const plotBgVal     = _resultSettings.plotBgColor  !== null ? _resultSettings.plotBgColor  : "#ffffff";
  const paperBgVal    = _resultSettings.paperBgColor !== null ? _resultSettings.paperBgColor : "#ffffff";
  const fontColorAuto = _resultSettings.fontColor    === null;
  const plotBgAuto    = _resultSettings.plotBgColor  === null;
  const paperBgAuto   = _resultSettings.paperBgColor === null;

  const details = document.createElement("details");
  details.className = "chart-settings-panel";
  details.innerHTML = `
    <summary class="chart-settings-panel__summary">Plot Settings</summary>
    <div class="chart-settings-controls">
      <div class="settings-divider">Typography</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="rs-font-size">Label font (px)</label>
        <input id="rs-font-size" type="number" class="chart-settings-input" min="7" max="20" step="1" value="${_resultSettings.fontSize}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="rs-tick-font">Tick font (px)</label>
        <input id="rs-tick-font" type="number" class="chart-settings-input" min="6" max="16" step="1" value="${_resultSettings.tickFontSize}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="rs-font-color">Font color</label>
        <div class="color-with-auto">
          <input id="rs-font-color" type="color" class="chart-settings-color" value="${fontColorVal}"${fontColorAuto ? " disabled" : ""}>
          <label class="chart-settings-check"><input type="checkbox" id="rs-font-color-auto"${fontColorAuto ? " checked" : ""}> Auto</label>
        </div>
      </div>
      <div class="settings-divider">Markers</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="rs-marker-size">Marker size (px)</label>
        <input id="rs-marker-size" type="number" class="chart-settings-input" min="3" max="12" step="1" value="${_resultSettings.markerSize}">
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Opacity</span>
        <div class="range-with-value">
          <input id="rs-opacity" type="range" class="chart-settings-range" min="0.1" max="1.0" step="0.05" value="${_resultSettings.opacity}">
          <span id="rs-opacity-val" class="chart-settings-range-val">${_resultSettings.opacity.toFixed(2)}</span>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="rs-edge-width">Edge width (px)</label>
        <input id="rs-edge-width" type="number" class="chart-settings-input" min="0" max="3" step="0.5" value="${_resultSettings.edgeWidth}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="rs-edge-color">Edge color</label>
        <input id="rs-edge-color" type="color" class="chart-settings-color" value="${_resultSettings.edgeColor}"${_resultSettings.edgeWidth === 0 ? " disabled" : ""}>
      </div>
      <div class="settings-divider">Figure</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="rs-height">Height (px)</label>
        <input id="rs-height" type="number" class="chart-settings-input" min="200" max="600" step="50" value="${_resultSettings.height}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="rs-plot-bg">Plot background</label>
        <div class="color-with-auto">
          <input id="rs-plot-bg" type="color" class="chart-settings-color" value="${plotBgVal}"${plotBgAuto ? " disabled" : ""}>
          <label class="chart-settings-check"><input type="checkbox" id="rs-plot-bg-auto"${plotBgAuto ? " checked" : ""}> Auto</label>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="rs-paper-bg">Paper background</label>
        <div class="color-with-auto">
          <input id="rs-paper-bg" type="color" class="chart-settings-color" value="${paperBgVal}"${paperBgAuto ? " disabled" : ""}>
          <label class="chart-settings-check"><input type="checkbox" id="rs-paper-bg-auto"${paperBgAuto ? " checked" : ""}> Auto</label>
        </div>
      </div>
      <div class="settings-divider">Gridlines</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label chart-settings-check" for="rs-major-grid">
          <input type="checkbox" id="rs-major-grid"${_resultSettings.showMajorGrid ? " checked" : ""}> Major grid
        </label>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="rs-major-grid-color">Major grid color</label>
        <input id="rs-major-grid-color" type="color" class="chart-settings-color" value="${_resultSettings.majorGridColor}"${!_resultSettings.showMajorGrid ? " disabled" : ""}>
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Major grid opacity</span>
        <div class="range-with-value">
          <input id="rs-major-grid-opacity" type="range" class="chart-settings-range" min="0" max="1" step="0.05" value="${_resultSettings.majorGridOpacity}"${!_resultSettings.showMajorGrid ? " disabled" : ""}>
          <span id="rs-major-grid-opacity-val" class="chart-settings-range-val">${_resultSettings.majorGridOpacity.toFixed(2)}</span>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label chart-settings-check" for="rs-minor-grid">
          <input type="checkbox" id="rs-minor-grid"${_resultSettings.showMinorGrid ? " checked" : ""}> Minor grid
        </label>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="rs-minor-grid-color">Minor grid color</label>
        <input id="rs-minor-grid-color" type="color" class="chart-settings-color" value="${_resultSettings.minorGridColor}"${!_resultSettings.showMinorGrid ? " disabled" : ""}>
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Minor grid opacity</span>
        <div class="range-with-value">
          <input id="rs-minor-grid-opacity" type="range" class="chart-settings-range" min="0" max="1" step="0.05" value="${_resultSettings.minorGridOpacity}"${!_resultSettings.showMinorGrid ? " disabled" : ""}>
          <span id="rs-minor-grid-opacity-val" class="chart-settings-range-val">${_resultSettings.minorGridOpacity.toFixed(2)}</span>
        </div>
      </div>
    </div>
  `;

  // ── Wire event listeners ───────────────────────────────────────────────────
  const fontSizeIn       = details.querySelector("#rs-font-size");
  const tickFontIn       = details.querySelector("#rs-tick-font");
  const fontColorIn      = details.querySelector("#rs-font-color");
  const fontColorAuto_   = details.querySelector("#rs-font-color-auto");
  const sizeIn           = details.querySelector("#rs-marker-size");
  const opacIn           = details.querySelector("#rs-opacity");
  const opacVal          = details.querySelector("#rs-opacity-val");
  const edgeWidthIn      = details.querySelector("#rs-edge-width");
  const edgeColorIn      = details.querySelector("#rs-edge-color");
  const heightIn         = details.querySelector("#rs-height");
  const plotBgIn         = details.querySelector("#rs-plot-bg");
  const plotBgAuto_      = details.querySelector("#rs-plot-bg-auto");
  const paperBgIn        = details.querySelector("#rs-paper-bg");
  const paperBgAuto_     = details.querySelector("#rs-paper-bg-auto");
  const majorGridChk     = details.querySelector("#rs-major-grid");
  const majorGridColorIn = details.querySelector("#rs-major-grid-color");
  const majorGridOpacIn  = details.querySelector("#rs-major-grid-opacity");
  const majorGridOpacVal = details.querySelector("#rs-major-grid-opacity-val");
  const minorGridChk     = details.querySelector("#rs-minor-grid");
  const minorGridColorIn = details.querySelector("#rs-minor-grid-color");
  const minorGridOpacIn  = details.querySelector("#rs-minor-grid-opacity");
  const minorGridOpacVal = details.querySelector("#rs-minor-grid-opacity-val");

  function _commit() { _saveResultSettings(); _rerenderPlots(); }

  // Typography
  fontSizeIn.addEventListener("change", () => {
    const v = parseInt(fontSizeIn.value, 10);
    if (!isNaN(v) && v >= 7 && v <= 20) { _resultSettings.fontSize = v; _commit(); }
  });
  tickFontIn.addEventListener("change", () => {
    const v = parseInt(tickFontIn.value, 10);
    if (!isNaN(v) && v >= 6 && v <= 16) { _resultSettings.tickFontSize = v; _commit(); }
  });
  fontColorAuto_.addEventListener("change", () => {
    _resultSettings.fontColor = fontColorAuto_.checked ? null : fontColorIn.value;
    fontColorIn.disabled = fontColorAuto_.checked;
    _commit();
  });
  fontColorIn.addEventListener("input", () => { _resultSettings.fontColor = fontColorIn.value; _commit(); });

  // Markers
  sizeIn.addEventListener("change", () => {
    const v = parseInt(sizeIn.value, 10);
    if (!isNaN(v) && v >= 3 && v <= 12) { _resultSettings.markerSize = v; _commit(); }
  });
  opacIn.addEventListener("input", () => {
    const v = parseFloat(opacIn.value);
    opacVal.textContent = v.toFixed(2);
    _resultSettings.opacity = v;
    _commit();
  });
  edgeWidthIn.addEventListener("change", () => {
    const v = parseFloat(edgeWidthIn.value);
    if (!isNaN(v) && v >= 0 && v <= 3) {
      _resultSettings.edgeWidth = v;
      edgeColorIn.disabled = v === 0;
      _commit();
    }
  });
  edgeColorIn.addEventListener("input", () => { _resultSettings.edgeColor = edgeColorIn.value; _commit(); });

  // Figure
  heightIn.addEventListener("change", () => {
    const v = parseInt(heightIn.value, 10);
    if (!isNaN(v) && v >= 200 && v <= 600) { _resultSettings.height = v; _commit(); }
  });
  plotBgAuto_.addEventListener("change", () => {
    _resultSettings.plotBgColor = plotBgAuto_.checked ? null : plotBgIn.value;
    plotBgIn.disabled = plotBgAuto_.checked;
    _commit();
  });
  plotBgIn.addEventListener("input", () => { _resultSettings.plotBgColor = plotBgIn.value; _commit(); });
  paperBgAuto_.addEventListener("change", () => {
    _resultSettings.paperBgColor = paperBgAuto_.checked ? null : paperBgIn.value;
    paperBgIn.disabled = paperBgAuto_.checked;
    _commit();
  });
  paperBgIn.addEventListener("input", () => { _resultSettings.paperBgColor = paperBgIn.value; _commit(); });

  // Gridlines
  majorGridChk.addEventListener("change", () => {
    _resultSettings.showMajorGrid = majorGridChk.checked;
    majorGridColorIn.disabled = !majorGridChk.checked;
    majorGridOpacIn.disabled  = !majorGridChk.checked;
    _commit();
  });
  majorGridColorIn.addEventListener("input", () => { _resultSettings.majorGridColor = majorGridColorIn.value; _commit(); });
  majorGridOpacIn.addEventListener("input", () => {
    const v = parseFloat(majorGridOpacIn.value);
    majorGridOpacVal.textContent = v.toFixed(2);
    _resultSettings.majorGridOpacity = v;
    _commit();
  });
  minorGridChk.addEventListener("change", () => {
    _resultSettings.showMinorGrid = minorGridChk.checked;
    minorGridColorIn.disabled = !minorGridChk.checked;
    minorGridOpacIn.disabled  = !minorGridChk.checked;
    _commit();
  });
  minorGridColorIn.addEventListener("input", () => { _resultSettings.minorGridColor = minorGridColorIn.value; _commit(); });
  minorGridOpacIn.addEventListener("input", () => {
    const v = parseFloat(minorGridOpacIn.value);
    minorGridOpacVal.textContent = v.toFixed(2);
    _resultSettings.minorGridOpacity = v;
    _commit();
  });

  return details;
}

/**
 * Render the training results card into containerEl.
 *
 * @param {HTMLElement} containerEl - Target card element.
 */
export async function initResults(containerEl) {
  clearEl(containerEl);
  showSpinner(containerEl);

  const resp = await get("/api/model/results");
  hideSpinner(containerEl);

  if (!resp.success) {
    containerEl.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Step 8 — Training Results</h2>
      </div>
      <p style="color: var(--color-text-muted); padding: var(--space-4) 0;">
        No results yet. Train a model in Step 7 to see metrics here.
      </p>`;
    return false;
  }

  const r = resp.results;
  _render(containerEl, r);
  return true;
}

// ── Internal renderer ──────────────────────────────────────────────────────────

function _render(containerEl, r) {
  clearEl(containerEl);
  _loadResultSettings();
  _plotItems = [];

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = el("div", { cls: "section-header" });
  const sourceNote = r.source_filename ? `<strong>${r.source_filename}</strong> — ` : "";
  header.innerHTML = `
    <h2 class="section-title">Step 8 — Training Results</h2>
    <p class="section-desc">
      ${sourceNote}Model trained on ${r.n_train.toLocaleString()} rows,
      evaluated on ${r.n_test.toLocaleString()} held-out rows.
      ${r.cv_results.n_folds}-fold cross-validation on the training set.
    </p>
  `;
  containerEl.appendChild(header);

  registerPrimer(
    "results",
    header,
    "How do I read these results?",
    `<p><strong>R² (R-squared)</strong> is the primary quality indicator.
     It ranges from 0 to 1 — a score of 1.0 means the model perfectly predicts
     every data point. A score below 0.70 is considered unacceptable for
     surrogate use; 0.85 or above is the target.</p>
     <p><strong>RMSE</strong> (Root Mean Square Error) and <strong>MAE</strong>
     (Mean Absolute Error) are both in the same units as your output column.
     Lower is better. RMSE penalises large individual errors more than MAE.</p>
     <p>The <strong>test set</strong> metrics (shown in the table) come from rows
     the model never saw during training — they represent real-world performance.
     The <strong>CV metrics</strong> are averages across the k training folds and
     are shown alongside their standard deviations to indicate consistency.</p>`
  );

  // GPR/size warnings
  if (r.warnings && r.warnings.length > 0) {
    const warnBox = el("div", { cls: "results-warning-box" });
    for (const w of r.warnings) {
      warnBox.appendChild(el("p", { cls: "results-warning-text", text: `⚠ ${w}` }));
    }
    containerEl.appendChild(warnBox);
  }

  // ── Test-set metrics table ───────────────────────────────────────────────────
  const testSection = el("div", { cls: "results-section" });
  const testTitle   = el("h3", { cls: "results-section-title", text: "Test Set Performance" });
  registerPrimer(
    "results-test",
    testTitle,
    "What is the test set?",
    `<p>Before training began, ${Math.round((r.n_test / (r.n_train + r.n_test)) * 100)}%
     of your rows were set aside and never shown to the model. These held-out rows are the
     <strong>test set</strong>. Evaluating on them gives an honest estimate of how the
     model performs on genuinely new data.</p>`
  );
  testSection.appendChild(testTitle);
  testSection.appendChild(_buildMetricsTable(r.test_metrics));
  containerEl.appendChild(testSection);

  // ── CV summary ───────────────────────────────────────────────────────────────
  const cvSection = el("div", { cls: "results-section" });
  const cvTitle   = el("h3", {
    cls:  "results-section-title",
    text: `${r.cv_results.n_folds}-Fold Cross-Validation (training set)`,
  });
  registerPrimer(
    "results-cv",
    cvTitle,
    "What is cross-validation?",
    `<p>Cross-validation divides the training set into ${r.cv_results.n_folds} equal parts.
     The model is trained ${r.cv_results.n_folds} times — each time one part is held out as
     a local validation set. The average score across all ${r.cv_results.n_folds} runs
     (± one standard deviation) is shown here.</p>
     <p>A low standard deviation means the model performs consistently across different
     subsets of the data — a good sign. A high standard deviation suggests the model
     may be sensitive to which rows it trains on.</p>`
  );
  cvSection.appendChild(cvTitle);
  cvSection.appendChild(_buildCVTable(r.cv_results.per_output));
  containerEl.appendChild(cvSection);

  // ── Diagnostic Figures ────────────────────────────────────────────────────
  if (r.test_actuals && r.test_predictions && r.output_columns) {
    const MAX_PLOT_OUTPUTS = 4;
    const outputs = r.output_columns;
    const shown   = outputs.slice(0, MAX_PLOT_OUTPUTS);

    const plotSection = el("div", { cls: "results-section parity-section" });
    const plotTitle   = el("h3", { cls: "results-section-title", text: "Parity & Residual Plots (test set)" });
    registerPrimer(
      "results-parity",
      plotTitle,
      "How do I read parity and residual plots?",
      `<p>A <strong>parity plot</strong> (left) shows actual values (x-axis) vs predicted
       values (y-axis). Points on the dashed diagonal line are perfect predictions — points
       far from the line represent large errors.</p>
       <p>A <strong>residual plot</strong> (right) shows actual values (x-axis) vs the
       error (actual − predicted). Ideally, residuals scatter randomly around zero with no
       visible pattern; a systematic pattern means the model is consistently wrong in some
       region of the input space. Both plots share the same x-axis — zooming on one
       updates the other.</p>`
    );
    plotSection.appendChild(plotTitle);
    plotSection.appendChild(_buildSettingsPanel());

    if (outputs.length > MAX_PLOT_OUTPUTS) {
      plotSection.appendChild(el("p", {
        cls:  "results-plot-note",
        text: `Showing ${MAX_PLOT_OUTPUTS} of ${outputs.length} outputs. Remaining outputs omitted for readability.`,
      }));
    }

    containerEl.appendChild(plotSection);

    shown.forEach((colName, j) => {
      const metric   = r.test_metrics.find(m => m.column === colName);
      const badgeCls = metric ? _r2Class(metric.r2) : "green";
      const yTrue    = r.test_actuals.map(row => row[j]);
      const yPred    = r.test_predictions.map(row => row[j]);

      const row     = el("div", { cls: "parity-row" });
      const label   = el("p",   { cls: "parity-col-label", text: colName });
      const figWrap = el("div", { cls: "output-figure-wrap" });

      figWrap.style.height    = `${_resultSettings.height}px`;
      figWrap.style.minHeight = `${_resultSettings.height}px`;

      row.appendChild(label);
      row.appendChild(figWrap);
      plotSection.appendChild(row);

      _plotItems.push({ figWrap, yTrue, yPred, colName, badgeCls });
      renderOutputFigure(figWrap, yTrue, yPred, colName, badgeCls, _resultSettings);
    });
  }
}

// ── Table builders ─────────────────────────────────────────────────────────────

function _buildMetricsTable(testMetrics) {
  const wrap  = el("div", { cls: "results-table-wrap" });
  const table = el("table", { cls: "results-table" });

  const thead = el("thead");
  thead.innerHTML = `
    <tr>
      <th>Output column</th>
      <th>R²</th>
      <th>RMSE</th>
      <th>MAE</th>
    </tr>`;
  table.appendChild(thead);

  const tbody = el("tbody");
  for (const m of testMetrics) {
    const tr  = el("tr");
    const r2c = _r2Class(m.r2);
    tr.innerHTML = `
      <td class="results-col-name">${m.column}</td>
      <td><span class="results-badge results-badge--${r2c}">${m.r2.toFixed(4)}</span></td>
      <td class="results-metric">${m.rmse.toFixed(4)}</td>
      <td class="results-metric">${m.mae.toFixed(4)}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function _buildCVTable(perOutput) {
  const wrap  = el("div", { cls: "results-table-wrap" });
  const table = el("table", { cls: "results-table" });

  const thead = el("thead");
  thead.innerHTML = `
    <tr>
      <th>Output column</th>
      <th>R² mean ± std</th>
      <th>RMSE mean ± std</th>
      <th>MAE mean ± std</th>
    </tr>`;
  table.appendChild(thead);

  const tbody = el("tbody");
  for (const m of perOutput) {
    const tr  = el("tr");
    const r2c = _r2Class(m.mean_r2);
    tr.innerHTML = `
      <td class="results-col-name">${m.column}</td>
      <td><span class="results-badge results-badge--${r2c}">${m.mean_r2.toFixed(4)}</span>
          <span class="results-std">± ${m.std_r2.toFixed(4)}</span></td>
      <td class="results-metric">${m.mean_rmse.toFixed(4)}
          <span class="results-std">± ${m.std_rmse.toFixed(4)}</span></td>
      <td class="results-metric">${m.mean_mae.toFixed(4)}
          <span class="results-std">± ${m.std_mae.toFixed(4)}</span></td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _r2Class(r2) {
  if (r2 >= R2_CAUTION)  return "green";
  if (r2 >= R2_MINIMUM)  return "amber";
  return "red";
}
