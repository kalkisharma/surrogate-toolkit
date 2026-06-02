// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/results.js
// Version: 3.5.35
// Description: Step 9 — Training Results. Fetches GET /api/model/results and
//              renders per-output R², RMSE, MAE with R² colour coding, plus a
//              cross-validation summary and combined parity/residual diagnostic
//              figures (1×2 subplots, linked x-axes). When multiple training
//              runs exist, a run-selector dropdown at the top lets the user
//              switch the full results view to any prior run.
// =============================================================================

import { get, post } from "../api.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { registerPrimer } from "../learning_mode.js";
import { el, clearEl, debounce } from "../utils.js";
import { renderOutputFigure, renderEnsembleWeights,
         renderScatterExplorer, renderContourExplorer } from "../charts.js";

// R² thresholds — mirror config/settings.py constants
const R2_MINIMUM = 0.70;
const R2_CAUTION = 0.85;

// ── Plot settings (persisted to localStorage) ─────────────────────────────────

const _RESULT_SETTINGS_KEY = "surrogate_result_chart_settings";
const _DEFAULT_RESULT_SETTINGS = {
  // Typography
  fontSize:              11,
  tickFontSize:          9,
  fontColor:             null,    // null = auto (theme default)
  // Markers
  markerSize:            7,
  opacity:               0.70,
  edgeWidth:             0,
  edgeColor:             "#000000",
  // Figure — metrics parity plots
  height:                300,
  plotBgColor:           null,    // null = transparent
  paperBgColor:          null,    // null = transparent
  // Gridlines
  showMajorGrid:         true,
  majorGridColor:        "#cccccc",
  majorGridOpacity:      1.0,
  showMinorGrid:         false,
  minorGridColor:        "#e0e0e0",
  minorGridOpacity:      0.6,
};

let _resultSettings = { ..._DEFAULT_RESULT_SETTINGS };
let _plotItems = [];   // { figWrap, yTrue, yPred, colName, badgeCls } — cached for re-render

// ── Scatter plot settings (persisted independently) ───────────────────────────

const _SCATTER_SETTINGS_KEY = "surrogate_scatter_settings";
const _DEFAULT_SCATTER_SETTINGS = {
  fontSize:         11,
  tickFontSize:     9,
  fontColor:        null,
  markerSize:       7,
  opacity:          0.70,
  edgeWidth:        0,
  edgeColor:        "#000000",
  height:           360,
  plotBgColor:      null,
  paperBgColor:     null,
  showMajorGrid:    true,
  majorGridColor:   "#cccccc",
  majorGridOpacity: 1.0,
  showMinorGrid:    false,
  minorGridColor:   "#e0e0e0",
  minorGridOpacity: 0.6,
};
let _scatterSettings = { ..._DEFAULT_SCATTER_SETTINGS };

function _loadScatterSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(_SCATTER_SETTINGS_KEY) || "{}");
    _scatterSettings = { ..._DEFAULT_SCATTER_SETTINGS, ...stored };
  } catch { _scatterSettings = { ..._DEFAULT_SCATTER_SETTINGS }; }
}
function _saveScatterSettings() {
  localStorage.setItem(_SCATTER_SETTINGS_KEY, JSON.stringify(_scatterSettings));
}

// ── Contour plot settings (persisted independently) ───────────────────────────

const _CONTOUR_SETTINGS_KEY = "surrogate_contour_settings";
const _DEFAULT_CONTOUR_SETTINGS = {
  fontSize:         11,
  tickFontSize:     9,
  fontColor:        null,
  height:           420,
  plotBgColor:      null,
  paperBgColor:     null,
  showMajorGrid:    true,
  majorGridColor:   "#cccccc",
  majorGridOpacity: 1.0,
  showMinorGrid:    false,
  minorGridColor:   "#e0e0e0",
  minorGridOpacity: 0.6,
};
let _contourSettings = { ..._DEFAULT_CONTOUR_SETTINGS };

function _loadContourSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(_CONTOUR_SETTINGS_KEY) || "{}");
    _contourSettings = { ..._DEFAULT_CONTOUR_SETTINGS, ...stored };
  } catch { _contourSettings = { ..._DEFAULT_CONTOUR_SETTINGS }; }
}
function _saveContourSettings() {
  localStorage.setItem(_CONTOUR_SETTINGS_KEY, JSON.stringify(_contourSettings));
}

// Stored callbacks so theme listener can trigger explore chart re-render without re-fetching data.
let _drawExploreScatter = null;
let _drawExploreContour = null;

// Re-render all Results charts when the theme changes.
document.addEventListener("theme:changed", () => {
  _rerenderPlots();
  _drawExploreScatter?.();
  _drawExploreContour?.();
});

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
    renderOutputFigure(p.figWrap, p.yTrue, p.yPred, p.colName, p.badgeCls,
      { ..._resultSettings, stds: p.stds ?? null });
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
        <input id="rs-font-size" type="number" class="chart-settings-input" min="7" max="40" step="1" value="${_resultSettings.fontSize}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="rs-tick-font">Tick font (px)</label>
        <input id="rs-tick-font" type="number" class="chart-settings-input" min="6" max="32" step="1" value="${_resultSettings.tickFontSize}">
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
    if (!isNaN(v) && v >= 7 && v <= 40) { _resultSettings.fontSize = v; _commit(); }
  });
  tickFontIn.addEventListener("change", () => {
    const v = parseInt(tickFontIn.value, 10);
    if (!isNaN(v) && v >= 6 && v <= 32) { _resultSettings.tickFontSize = v; _commit(); }
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
        <h2 class="section-title">Step 9 — Training Results</h2>
      </div>
      <p style="color: var(--color-text-muted); padding: var(--space-4) 0;">
        No results yet. Train a model in Step 8 — Model to see metrics here.
      </p>`;
    return false;
  }

  const runs = resp.runs || [];

  // Backward compat: no runs list yet (pre-v0.9.9 session), fall back to single result.
  if (runs.length === 0) {
    _render(containerEl, resp.results);
    return true;
  }

  // With multiple runs, render a selector dropdown above the results view.
  if (runs.length > 1) {
    const selectorRow = el("div", { cls: "results-run-selector" });
    const label = el("label", { cls: "results-run-selector__label" });
    label.setAttribute("for", "results-run-select");
    label.textContent = "Run:";

    const select = el("select", { cls: "results-run-select" });
    select.id = "results-run-select";

    for (let i = runs.length - 1; i >= 0; i--) {
      const run = runs[i];
      const outputs = (run.output_columns || []).join(", ") || "?";
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `Run ${run.run} — ${run.model_type.toUpperCase()} — ${outputs}${i === runs.length - 1 ? " (current)" : ""}`;
      if (i === runs.length - 1) opt.selected = true;
      select.appendChild(opt);
    }

    selectorRow.appendChild(label);
    selectorRow.appendChild(select);
    containerEl.appendChild(selectorRow);

    const contentEl = el("div", { cls: "results-run-content" });
    containerEl.appendChild(contentEl);

    _render(contentEl, runs[runs.length - 1]);

    select.addEventListener("change", () => {
      const idx = parseInt(select.value, 10);
      _render(contentEl, runs[idx]);
    });
  } else {
    _render(containerEl, runs[0]);
  }

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
    <h2 class="section-title">Step 9 — Training Results</h2>
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

  // PCA info banner
  if (r.pca_applied && r.pca_original_inputs) {
    const pcaInfo = el("div", { cls: "results-pca-notice" });
    pcaInfo.innerHTML = `<strong>PCA active</strong> — ${r.input_columns.length} components trained on
      ${r.pca_original_inputs.length} original inputs
      (${r.pca_original_inputs.join(", ")}).
      Predictions accept original physical inputs; the transform is applied automatically.`;
    containerEl.appendChild(pcaInfo);
  }

  // Normalization-not-applied warning
  if (r.normalization_warning) {
    const normWarn = el("div", { cls: "results-warning-box results-warning-box--norm" });
    normWarn.appendChild(el("p", { cls: "results-warning-text",
      text: "⚠ Normalization was not applied — model trained on raw data. Results may be unreliable. Return to Step 6 — Normalize, click Apply, then retrain." }));
    containerEl.appendChild(normWarn);
  }

  // Phase 22E: noise weighting indicator
  if (r.noise_active) {
    const sigma = (r.noise_mean_sigma ?? 0).toFixed(4);
    const noiseBox = el("div", { cls: "results-noise-notice" });
    let noiseHtml = `<strong>Noise weighting active</strong> — mean σ = ${sigma}.
      High-uncertainty observations were down-weighted during training.`;
    if (r.model_type === "gpr") {
      noiseHtml += " GPR posterior uncertainty reflects per-point noise (±1.96σ in confidence bands).";
    }
    noiseHtml += " <em>Note: cross-validation used uniform alpha — noise weighting applies to the final model only.</em>";
    noiseBox.innerHTML = noiseHtml;
    containerEl.appendChild(noiseBox);
  }

  // GPR/size warnings
  if (r.warnings && r.warnings.length > 0) {
    const warnBox = el("div", { cls: "results-warning-box" });
    for (const w of r.warnings) {
      warnBox.appendChild(el("p", { cls: "results-warning-text", text: `⚠ ${w}` }));
    }
    containerEl.appendChild(warnBox);
  }

  // ── Tab bar: Metrics | Explore ────────────────────────────────────────────
  const tabBar = el("div", { cls: "results-tab-bar" });
  const metricsBtn = el("button", { cls: "results-tab-btn active", text: "Metrics" });
  const exploreBtn = el("button", { cls: "results-tab-btn", text: "Explore" });
  tabBar.appendChild(metricsBtn);
  tabBar.appendChild(exploreBtn);
  containerEl.appendChild(tabBar);

  const metricsPane = el("div", { cls: "results-tab-pane" });
  const explorePane = el("div", { cls: "results-tab-pane hidden" });
  containerEl.appendChild(metricsPane);
  containerEl.appendChild(explorePane);

  let exploreInited = false;
  metricsBtn.addEventListener("click", () => {
    metricsBtn.classList.add("active");   exploreBtn.classList.remove("active");
    metricsPane.classList.remove("hidden"); explorePane.classList.add("hidden");
  });
  exploreBtn.addEventListener("click", () => {
    exploreBtn.classList.add("active");   metricsBtn.classList.remove("active");
    explorePane.classList.remove("hidden"); metricsPane.classList.add("hidden");
    if (!exploreInited) { exploreInited = true; _initExploreTab(explorePane, r); }
  });

  // ── Multi-fidelity comparison (shown for bridge_correction / co_kriging) ─────
  if (r.mf_comparison) {
    const mfSection = el("div", { cls: "results-section" });
    const methodLabel = r.mf_comparison.method === "bridge" ? "Bridge Correction" : "Co-Kriging (K-O)";
    const cvLabel     = r.mf_comparison.cv_type === "loo" ? "LOO-CV" : r.mf_comparison.cv_type;
    const mfTitle = el("h3", { cls: "results-section-title", text: "Multi-Fidelity Comparison" });
    const mfDesc  = el("p", { cls: "section-desc",
      text: `${methodLabel}  ·  LF: ${r.mf_comparison.n_lf.toLocaleString()} rows  ·  HF: ${r.mf_comparison.n_hf.toLocaleString()} rows  ·  ${cvLabel} R²` });
    mfSection.appendChild(mfTitle);
    mfSection.appendChild(mfDesc);
    mfSection.appendChild(_buildMFComparisonTable(r.mf_comparison));
    metricsPane.appendChild(mfSection);
  }

  // ── Ensemble breakdown (shown instead of CV table for ensemble models) ───────
  if (r.model_type === "ensemble") {
    const ensSection = el("div", { cls: "results-section" });
    const ensTitle   = el("h3", { cls: "results-section-title", text: "Ensemble Composition" });
    const stratLabel = { equal: "Equal weights", cv_performance: "CV Performance", stacking: "Stacking (meta-model)" };
    const stratDesc  = el("p", { cls: "section-desc",
      text: `Strategy: ${stratLabel[r.ensemble_strategy] || r.ensemble_strategy}  ·  ${r.ensemble_components.length} active component${r.ensemble_components.length !== 1 ? "s" : ""}` });
    ensSection.appendChild(ensTitle);
    ensSection.appendChild(stratDesc);

    if (r.ensemble_failed && r.ensemble_failed.length > 0) {
      const warnBox = el("div", { cls: "results-warning-box" });
      for (const f of r.ensemble_failed) {
        warnBox.appendChild(el("p", { cls: "results-warning-text",
          text: `⚠ ${f.model_type} excluded: ${f.error}` }));
      }
      ensSection.appendChild(warnBox);
    }

    const weightChart = el("div", { cls: "ensemble-weight-chart" });
    ensSection.appendChild(weightChart);
    renderEnsembleWeights(
      weightChart,
      r.ensemble_components,
      r.ensemble_weights  || {},
      r.ensemble_cv_r2    || {},
      r.ensemble_failed   || [],
    );
    requestAnimationFrame(() => {
      const p = weightChart.querySelector(".js-plotly-plot");
      if (p) Plotly.Plots.resize(p); // eslint-disable-line no-undef
    });

    ensSection.appendChild(_buildEnsembleTable(r));
    metricsPane.appendChild(ensSection);
  }

  // ── Model configuration card ─────────────────────────────────────────────────
  const configSection = el("div", { cls: "results-section results-config-card" });
  const configTitle   = el("h3", { cls: "results-section-title", text: "Model Configuration" });
  configSection.appendChild(configTitle);
  const configRows = [
    ["Model type",  r.model_type.toUpperCase()],
    ["Test split",  `${Math.round(r.test_split * 100)}%`],
    ["CV folds",    r.cv_folds ?? r.cv_results?.n_folds ?? "—"],
  ];
  if (r.hyperparams?.kernel) configRows.splice(1, 0, ["Kernel", r.hyperparams.kernel]);
  if (r.hyperparams?.alpha  != null) configRows.splice(2, 0, ["Alpha (noise)", r.hyperparams.alpha]);
  if (r.pca_applied) configRows.push(["Preprocessing", `PCA — ${r.input_columns.length} components`]);
  const configGrid = el("div", { cls: "results-config-grid" });
  for (const [label, value] of configRows) {
    const cell = el("div", { cls: "results-config-cell" });
    cell.appendChild(el("span", { cls: "results-config-label", text: label }));
    cell.appendChild(el("span", { cls: "results-config-value", text: String(value) }));
    configGrid.appendChild(cell);
  }
  configSection.appendChild(configGrid);
  metricsPane.appendChild(configSection);

  // ── ARD kernel length scales (GPR/Kriging only) ──────────────────────────────
  if (r.kernel_length_scales) {
    const lsSection = el("div", { cls: "results-section results-config-card" });
    const lsTitle = el("h3", { cls: "results-section-title", text: "ARD Kernel Length Scales" });
    lsSection.appendChild(lsTitle);
    const lsNote = el("small");
    lsNote.textContent = "Smaller = input varies quickly relative to others (higher influence). Sorted ascending.";
    lsSection.appendChild(lsNote);
    const outputs = Object.keys(r.kernel_length_scales);
    for (const outCol of outputs) {
      if (outputs.length > 1) {
        const outLabel = el("p", { cls: "results-config-label" });
        outLabel.textContent = outCol;
        outLabel.style.marginTop = "0.5rem";
        lsSection.appendChild(outLabel);
      }
      const lsGrid = el("div", { cls: "results-config-grid" });
      const sorted = Object.entries(r.kernel_length_scales[outCol]).sort((a, b) => a[1] - b[1]);
      for (const [inp, val] of sorted) {
        const cell = el("div", { cls: "results-config-cell" });
        cell.appendChild(el("span", { cls: "results-config-label", text: inp }));
        cell.appendChild(el("span", { cls: "results-config-value", text: Number(val).toFixed(4) }));
        lsGrid.appendChild(cell);
      }
      lsSection.appendChild(lsGrid);
    }
    metricsPane.appendChild(lsSection);
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
  metricsPane.appendChild(testSection);

  // ── CV summary (skipped for ensemble — breakdown shown above instead) ────────
  if (r.model_type === "ensemble") { /* no-op */ }
  else {
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
  metricsPane.appendChild(cvSection);
  } // end else (non-ensemble CV section)

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

    metricsPane.appendChild(plotSection);

    shown.forEach((colName, j) => {
      const metric   = r.test_metrics.find(m => m.column === colName);
      const badgeCls = metric ? _r2Class(metric.r2) : "green";
      const yTrue    = r.test_actuals.map(row => row[j]);
      const yPred    = r.test_predictions.map(row => row[j]);
      const stds     = r.test_stds ? r.test_stds.map(row => row[j]) : null;

      const row     = el("div", { cls: "parity-row" });
      const label   = el("p",   { cls: "parity-col-label", text: colName });
      const figWrap = el("div", { cls: "output-figure-wrap" });

      figWrap.style.height    = `${_resultSettings.height}px`;
      figWrap.style.minHeight = `${_resultSettings.height}px`;

      row.appendChild(label);
      row.appendChild(figWrap);
      plotSection.appendChild(row);

      _plotItems.push({ figWrap, yTrue, yPred, colName, badgeCls, stds });
      renderOutputFigure(figWrap, yTrue, yPred, colName, badgeCls,
        { ..._resultSettings, stds });
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

function _buildMFComparisonTable(mfComp) {
  const wrap  = el("div", { cls: "results-table-wrap" });
  const table = el("table", { cls: "results-table mf-comparison-table" });
  const cvLbl = mfComp.cv_type === "loo" ? "LOO-CV" : mfComp.cv_type;

  const thead = el("thead");
  thead.innerHTML = `
    <tr>
      <th>Output</th>
      <th>MF R² (${cvLbl})</th>
      <th>HF-only R² (${cvLbl})</th>
      <th>Improvement</th>
    </tr>`;
  table.appendChild(thead);

  const tbody = el("tbody");
  for (const m of (mfComp.per_output || [])) {
    const improvement = m.mf_r2 - m.hf_only_r2;
    const improvCls   = improvement > 0.01  ? "mf-improve--positive"
                      : improvement < -0.01 ? "mf-improve--negative"
                      : "";
    const tr = el("tr");
    tr.innerHTML = `
      <td class="results-col-name">${m.column}</td>
      <td><span class="results-badge results-badge--${_r2Class(m.mf_r2)}">${m.mf_r2.toFixed(3)}</span></td>
      <td><span class="results-badge results-badge--${_r2Class(m.hf_only_r2)}">${m.hf_only_r2.toFixed(3)}</span></td>
      <td class="${improvCls}">${improvement >= 0 ? "+" : ""}${improvement.toFixed(3)}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function _buildEnsembleTable(r) {
  const wrap  = el("div", { cls: "results-table-wrap" });
  const table = el("table", { cls: "results-table ensemble-comp-table" });

  const thead = el("thead");
  thead.innerHTML = `
    <tr>
      <th>Component</th>
      <th>Weight</th>
      <th>CV R²</th>
      <th>Status</th>
    </tr>`;
  table.appendChild(thead);

  const tbody = el("tbody");
  for (const modelType of (r.ensemble_components || [])) {
    const weight = r.ensemble_weights ? r.ensemble_weights[modelType] : null;
    const cvR2   = r.ensemble_cv_r2   ? r.ensemble_cv_r2[modelType]   : null;
    const tr = el("tr");
    tr.innerHTML = `
      <td class="results-col-name">${modelType.toUpperCase()}</td>
      <td class="results-metric">${weight != null ? (weight * 100).toFixed(1) + "%" : "—"}</td>
      <td>${cvR2 != null ? `<span class="results-badge results-badge--${_r2Class(cvR2)}">${cvR2.toFixed(3)}</span>` : "—"}</td>
      <td><span class="ensemble-status ensemble-status--active">Active</span></td>
    `;
    tbody.appendChild(tr);
  }
  for (const f of (r.ensemble_failed || [])) {
    const tr = el("tr", { cls: "ensemble-comp-failed" });
    tr.innerHTML = `
      <td class="results-col-name">${f.model_type.toUpperCase()}</td>
      <td class="results-metric">—</td>
      <td>—</td>
      <td><span class="ensemble-status ensemble-status--excluded" title="${f.error}">Excluded</span></td>
    `;
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

// ── Scatter plot settings panel (ss-) ─────────────────────────────────────────

function _buildScatterSettingsPanel() {
  const s = _scatterSettings;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const fontColorAuto = s.fontColor    === null;
  const fontColorVal  = s.fontColor    !== null ? s.fontColor    : (isDark ? "#8b94b3" : "#4b5478");
  const plotBgAuto    = s.plotBgColor  === null;
  const plotBgVal     = s.plotBgColor  !== null ? s.plotBgColor  : "#ffffff";
  const paperBgAuto   = s.paperBgColor === null;
  const paperBgVal    = s.paperBgColor !== null ? s.paperBgColor : "#ffffff";

  const details = document.createElement("details");
  details.className = "chart-settings-panel";
  details.innerHTML = `
    <summary class="chart-settings-panel__summary">Scatter Plot Settings</summary>
    <div class="chart-settings-controls">
      <div class="settings-divider">Typography</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ss-font-size">Label font (px)</label>
        <input id="ss-font-size" type="number" class="chart-settings-input" min="7" max="40" step="1" value="${s.fontSize}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ss-tick-font">Tick font (px)</label>
        <input id="ss-tick-font" type="number" class="chart-settings-input" min="6" max="32" step="1" value="${s.tickFontSize}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ss-font-color">Font color</label>
        <div class="color-with-auto">
          <input id="ss-font-color" type="color" class="chart-settings-color" value="${fontColorVal}"${fontColorAuto ? " disabled" : ""} style="opacity:${fontColorAuto ? "0.4" : "1"}">
          <label class="chart-settings-check"><input type="checkbox" id="ss-font-color-auto"${fontColorAuto ? " checked" : ""}> Auto</label>
        </div>
      </div>
      <div class="settings-divider">Markers</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ss-marker-size">Marker size (px)</label>
        <input id="ss-marker-size" type="number" class="chart-settings-input" min="3" max="16" step="1" value="${s.markerSize}">
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Opacity</span>
        <div class="range-with-value">
          <input id="ss-opacity" type="range" class="chart-settings-range" min="0.1" max="1.0" step="0.05" value="${s.opacity}">
          <span id="ss-opacity-val" class="chart-settings-range-val">${s.opacity.toFixed(2)}</span>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ss-edge-width">Edge width (px)</label>
        <input id="ss-edge-width" type="number" class="chart-settings-input" min="0" max="3" step="0.5" value="${s.edgeWidth}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ss-edge-color">Edge color</label>
        <input id="ss-edge-color" type="color" class="chart-settings-color" value="${s.edgeColor}"${s.edgeWidth === 0 ? " disabled" : ""}>
      </div>
      <div class="settings-divider">Figure</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ss-height">Height (px)</label>
        <input id="ss-height" type="number" class="chart-settings-input" min="200" max="800" step="50" value="${s.height}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ss-plot-bg">Plot background</label>
        <div class="color-with-auto">
          <input id="ss-plot-bg" type="color" class="chart-settings-color" value="${plotBgVal}"${plotBgAuto ? " disabled" : ""}>
          <label class="chart-settings-check"><input type="checkbox" id="ss-plot-bg-auto"${plotBgAuto ? " checked" : ""}> Auto</label>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ss-paper-bg">Paper background</label>
        <div class="color-with-auto">
          <input id="ss-paper-bg" type="color" class="chart-settings-color" value="${paperBgVal}"${paperBgAuto ? " disabled" : ""}>
          <label class="chart-settings-check"><input type="checkbox" id="ss-paper-bg-auto"${paperBgAuto ? " checked" : ""}> Auto</label>
        </div>
      </div>
      <div class="settings-divider">Gridlines</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label chart-settings-check" for="ss-major-grid">
          <input type="checkbox" id="ss-major-grid"${s.showMajorGrid ? " checked" : ""}> Major grid
        </label>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ss-major-grid-color">Major grid color</label>
        <input id="ss-major-grid-color" type="color" class="chart-settings-color" value="${s.majorGridColor}"${!s.showMajorGrid ? " disabled" : ""}>
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Major grid opacity</span>
        <div class="range-with-value">
          <input id="ss-major-grid-opacity" type="range" class="chart-settings-range" min="0" max="1" step="0.05" value="${s.majorGridOpacity}"${!s.showMajorGrid ? " disabled" : ""}>
          <span id="ss-major-grid-opacity-val" class="chart-settings-range-val">${s.majorGridOpacity.toFixed(2)}</span>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label chart-settings-check" for="ss-minor-grid">
          <input type="checkbox" id="ss-minor-grid"${s.showMinorGrid ? " checked" : ""}> Minor grid
        </label>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ss-minor-grid-color">Minor grid color</label>
        <input id="ss-minor-grid-color" type="color" class="chart-settings-color" value="${s.minorGridColor}"${!s.showMinorGrid ? " disabled" : ""}>
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Minor grid opacity</span>
        <div class="range-with-value">
          <input id="ss-minor-grid-opacity" type="range" class="chart-settings-range" min="0" max="1" step="0.05" value="${s.minorGridOpacity}"${!s.showMinorGrid ? " disabled" : ""}>
          <span id="ss-minor-grid-opacity-val" class="chart-settings-range-val">${s.minorGridOpacity.toFixed(2)}</span>
        </div>
      </div>
    </div>
  `;

  function _commit() { _saveScatterSettings(); _drawExploreScatter?.(); }

  // Typography
  details.querySelector("#ss-font-size").addEventListener("change", () => {
    const v = parseInt(details.querySelector("#ss-font-size").value, 10);
    if (!isNaN(v) && v >= 7 && v <= 40) { _scatterSettings.fontSize = v; _commit(); }
  });
  details.querySelector("#ss-tick-font").addEventListener("change", () => {
    const v = parseInt(details.querySelector("#ss-tick-font").value, 10);
    if (!isNaN(v) && v >= 6 && v <= 32) { _scatterSettings.tickFontSize = v; _commit(); }
  });
  const ssFontColorIn   = details.querySelector("#ss-font-color");
  const ssFontColorAuto = details.querySelector("#ss-font-color-auto");
  ssFontColorAuto.addEventListener("change", () => {
    _scatterSettings.fontColor = ssFontColorAuto.checked ? null : ssFontColorIn.value;
    ssFontColorIn.disabled = ssFontColorAuto.checked;
    ssFontColorIn.style.opacity = ssFontColorAuto.checked ? "0.4" : "1";
    _commit();
  });
  ssFontColorIn.addEventListener("input", () => { _scatterSettings.fontColor = ssFontColorIn.value; _commit(); });

  // Markers
  details.querySelector("#ss-marker-size").addEventListener("change", () => {
    const v = parseInt(details.querySelector("#ss-marker-size").value, 10);
    if (!isNaN(v) && v >= 3 && v <= 16) { _scatterSettings.markerSize = v; _commit(); }
  });
  const ssOpacIn  = details.querySelector("#ss-opacity");
  const ssOpacVal = details.querySelector("#ss-opacity-val");
  ssOpacIn.addEventListener("input", () => {
    const v = parseFloat(ssOpacIn.value);
    ssOpacVal.textContent = v.toFixed(2);
    _scatterSettings.opacity = v;
    _commit();
  });
  const ssEdgeWidthIn = details.querySelector("#ss-edge-width");
  const ssEdgeColorIn = details.querySelector("#ss-edge-color");
  ssEdgeWidthIn.addEventListener("change", () => {
    const v = parseFloat(ssEdgeWidthIn.value);
    if (!isNaN(v) && v >= 0 && v <= 3) {
      _scatterSettings.edgeWidth = v;
      ssEdgeColorIn.disabled = v === 0;
      _commit();
    }
  });
  ssEdgeColorIn.addEventListener("input", () => { _scatterSettings.edgeColor = ssEdgeColorIn.value; _commit(); });

  // Figure
  details.querySelector("#ss-height").addEventListener("change", () => {
    const v = parseInt(details.querySelector("#ss-height").value, 10);
    if (!isNaN(v) && v >= 200 && v <= 800) { _scatterSettings.height = v; _commit(); }
  });
  const ssPlotBgIn   = details.querySelector("#ss-plot-bg");
  const ssPlotBgAuto = details.querySelector("#ss-plot-bg-auto");
  ssPlotBgAuto.addEventListener("change", () => {
    _scatterSettings.plotBgColor = ssPlotBgAuto.checked ? null : ssPlotBgIn.value;
    ssPlotBgIn.disabled = ssPlotBgAuto.checked;
    _commit();
  });
  ssPlotBgIn.addEventListener("input", () => { _scatterSettings.plotBgColor = ssPlotBgIn.value; _commit(); });
  const ssPaperBgIn   = details.querySelector("#ss-paper-bg");
  const ssPaperBgAuto = details.querySelector("#ss-paper-bg-auto");
  ssPaperBgAuto.addEventListener("change", () => {
    _scatterSettings.paperBgColor = ssPaperBgAuto.checked ? null : ssPaperBgIn.value;
    ssPaperBgIn.disabled = ssPaperBgAuto.checked;
    _commit();
  });
  ssPaperBgIn.addEventListener("input", () => { _scatterSettings.paperBgColor = ssPaperBgIn.value; _commit(); });

  // Gridlines
  const ssMajorGridChk     = details.querySelector("#ss-major-grid");
  const ssMajorGridColorIn = details.querySelector("#ss-major-grid-color");
  const ssMajorGridOpacIn  = details.querySelector("#ss-major-grid-opacity");
  const ssMajorGridOpacVal = details.querySelector("#ss-major-grid-opacity-val");
  ssMajorGridChk.addEventListener("change", () => {
    _scatterSettings.showMajorGrid = ssMajorGridChk.checked;
    ssMajorGridColorIn.disabled = !ssMajorGridChk.checked;
    ssMajorGridOpacIn.disabled  = !ssMajorGridChk.checked;
    _commit();
  });
  ssMajorGridColorIn.addEventListener("input", () => { _scatterSettings.majorGridColor = ssMajorGridColorIn.value; _commit(); });
  ssMajorGridOpacIn.addEventListener("input", () => {
    const v = parseFloat(ssMajorGridOpacIn.value);
    ssMajorGridOpacVal.textContent = v.toFixed(2);
    _scatterSettings.majorGridOpacity = v;
    _commit();
  });
  const ssMinorGridChk     = details.querySelector("#ss-minor-grid");
  const ssMinorGridColorIn = details.querySelector("#ss-minor-grid-color");
  const ssMinorGridOpacIn  = details.querySelector("#ss-minor-grid-opacity");
  const ssMinorGridOpacVal = details.querySelector("#ss-minor-grid-opacity-val");
  ssMinorGridChk.addEventListener("change", () => {
    _scatterSettings.showMinorGrid = ssMinorGridChk.checked;
    ssMinorGridColorIn.disabled = !ssMinorGridChk.checked;
    ssMinorGridOpacIn.disabled  = !ssMinorGridChk.checked;
    _commit();
  });
  ssMinorGridColorIn.addEventListener("input", () => { _scatterSettings.minorGridColor = ssMinorGridColorIn.value; _commit(); });
  ssMinorGridOpacIn.addEventListener("input", () => {
    const v = parseFloat(ssMinorGridOpacIn.value);
    ssMinorGridOpacVal.textContent = v.toFixed(2);
    _scatterSettings.minorGridOpacity = v;
    _commit();
  });

  return details;
}

// ── Contour plot settings panel (ct-) ─────────────────────────────────────────

function _buildContourSettingsPanel() {
  const s = _contourSettings;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const fontColorAuto = s.fontColor    === null;
  const fontColorVal  = s.fontColor    !== null ? s.fontColor    : (isDark ? "#8b94b3" : "#4b5478");
  const plotBgAuto    = s.plotBgColor  === null;
  const plotBgVal     = s.plotBgColor  !== null ? s.plotBgColor  : "#ffffff";
  const paperBgAuto   = s.paperBgColor === null;
  const paperBgVal    = s.paperBgColor !== null ? s.paperBgColor : "#ffffff";

  const details = document.createElement("details");
  details.className = "chart-settings-panel";
  details.innerHTML = `
    <summary class="chart-settings-panel__summary">Contour Plot Settings</summary>
    <div class="chart-settings-controls">
      <div class="settings-divider">Typography</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ct-font-size">Label font (px)</label>
        <input id="ct-font-size" type="number" class="chart-settings-input" min="7" max="40" step="1" value="${s.fontSize}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ct-tick-font">Tick font (px)</label>
        <input id="ct-tick-font" type="number" class="chart-settings-input" min="6" max="32" step="1" value="${s.tickFontSize}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ct-font-color">Font color</label>
        <div class="color-with-auto">
          <input id="ct-font-color" type="color" class="chart-settings-color" value="${fontColorVal}"${fontColorAuto ? " disabled" : ""} style="opacity:${fontColorAuto ? "0.4" : "1"}">
          <label class="chart-settings-check"><input type="checkbox" id="ct-font-color-auto"${fontColorAuto ? " checked" : ""}> Auto</label>
        </div>
      </div>
      <div class="settings-divider">Figure</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ct-height">Height (px)</label>
        <input id="ct-height" type="number" class="chart-settings-input" min="200" max="800" step="50" value="${s.height}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ct-plot-bg">Plot background</label>
        <div class="color-with-auto">
          <input id="ct-plot-bg" type="color" class="chart-settings-color" value="${plotBgVal}"${plotBgAuto ? " disabled" : ""}>
          <label class="chart-settings-check"><input type="checkbox" id="ct-plot-bg-auto"${plotBgAuto ? " checked" : ""}> Auto</label>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ct-paper-bg">Paper background</label>
        <div class="color-with-auto">
          <input id="ct-paper-bg" type="color" class="chart-settings-color" value="${paperBgVal}"${paperBgAuto ? " disabled" : ""}>
          <label class="chart-settings-check"><input type="checkbox" id="ct-paper-bg-auto"${paperBgAuto ? " checked" : ""}> Auto</label>
        </div>
      </div>
      <div class="settings-divider">Gridlines</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label chart-settings-check" for="ct-major-grid">
          <input type="checkbox" id="ct-major-grid"${s.showMajorGrid ? " checked" : ""}> Major grid
        </label>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ct-major-grid-color">Major grid color</label>
        <input id="ct-major-grid-color" type="color" class="chart-settings-color" value="${s.majorGridColor}"${!s.showMajorGrid ? " disabled" : ""}>
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Major grid opacity</span>
        <div class="range-with-value">
          <input id="ct-major-grid-opacity" type="range" class="chart-settings-range" min="0" max="1" step="0.05" value="${s.majorGridOpacity}"${!s.showMajorGrid ? " disabled" : ""}>
          <span id="ct-major-grid-opacity-val" class="chart-settings-range-val">${s.majorGridOpacity.toFixed(2)}</span>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label chart-settings-check" for="ct-minor-grid">
          <input type="checkbox" id="ct-minor-grid"${s.showMinorGrid ? " checked" : ""}> Minor grid
        </label>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="ct-minor-grid-color">Minor grid color</label>
        <input id="ct-minor-grid-color" type="color" class="chart-settings-color" value="${s.minorGridColor}"${!s.showMinorGrid ? " disabled" : ""}>
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Minor grid opacity</span>
        <div class="range-with-value">
          <input id="ct-minor-grid-opacity" type="range" class="chart-settings-range" min="0" max="1" step="0.05" value="${s.minorGridOpacity}"${!s.showMinorGrid ? " disabled" : ""}>
          <span id="ct-minor-grid-opacity-val" class="chart-settings-range-val">${s.minorGridOpacity.toFixed(2)}</span>
        </div>
      </div>
    </div>
  `;

  function _commit() { _saveContourSettings(); _drawExploreContour?.(); }

  // Typography
  details.querySelector("#ct-font-size").addEventListener("change", () => {
    const v = parseInt(details.querySelector("#ct-font-size").value, 10);
    if (!isNaN(v) && v >= 7 && v <= 40) { _contourSettings.fontSize = v; _commit(); }
  });
  details.querySelector("#ct-tick-font").addEventListener("change", () => {
    const v = parseInt(details.querySelector("#ct-tick-font").value, 10);
    if (!isNaN(v) && v >= 6 && v <= 32) { _contourSettings.tickFontSize = v; _commit(); }
  });
  const ctFontColorIn   = details.querySelector("#ct-font-color");
  const ctFontColorAuto = details.querySelector("#ct-font-color-auto");
  ctFontColorAuto.addEventListener("change", () => {
    _contourSettings.fontColor = ctFontColorAuto.checked ? null : ctFontColorIn.value;
    ctFontColorIn.disabled = ctFontColorAuto.checked;
    ctFontColorIn.style.opacity = ctFontColorAuto.checked ? "0.4" : "1";
    _commit();
  });
  ctFontColorIn.addEventListener("input", () => { _contourSettings.fontColor = ctFontColorIn.value; _commit(); });

  // Figure
  details.querySelector("#ct-height").addEventListener("change", () => {
    const v = parseInt(details.querySelector("#ct-height").value, 10);
    if (!isNaN(v) && v >= 200 && v <= 800) { _contourSettings.height = v; _commit(); }
  });
  const ctPlotBgIn   = details.querySelector("#ct-plot-bg");
  const ctPlotBgAuto = details.querySelector("#ct-plot-bg-auto");
  ctPlotBgAuto.addEventListener("change", () => {
    _contourSettings.plotBgColor = ctPlotBgAuto.checked ? null : ctPlotBgIn.value;
    ctPlotBgIn.disabled = ctPlotBgAuto.checked;
    _commit();
  });
  ctPlotBgIn.addEventListener("input", () => { _contourSettings.plotBgColor = ctPlotBgIn.value; _commit(); });
  const ctPaperBgIn   = details.querySelector("#ct-paper-bg");
  const ctPaperBgAuto = details.querySelector("#ct-paper-bg-auto");
  ctPaperBgAuto.addEventListener("change", () => {
    _contourSettings.paperBgColor = ctPaperBgAuto.checked ? null : ctPaperBgIn.value;
    ctPaperBgIn.disabled = ctPaperBgAuto.checked;
    _commit();
  });
  ctPaperBgIn.addEventListener("input", () => { _contourSettings.paperBgColor = ctPaperBgIn.value; _commit(); });

  // Gridlines
  const ctMajorGridChk     = details.querySelector("#ct-major-grid");
  const ctMajorGridColorIn = details.querySelector("#ct-major-grid-color");
  const ctMajorGridOpacIn  = details.querySelector("#ct-major-grid-opacity");
  const ctMajorGridOpacVal = details.querySelector("#ct-major-grid-opacity-val");
  ctMajorGridChk.addEventListener("change", () => {
    _contourSettings.showMajorGrid = ctMajorGridChk.checked;
    ctMajorGridColorIn.disabled = !ctMajorGridChk.checked;
    ctMajorGridOpacIn.disabled  = !ctMajorGridChk.checked;
    _commit();
  });
  ctMajorGridColorIn.addEventListener("input", () => { _contourSettings.majorGridColor = ctMajorGridColorIn.value; _commit(); });
  ctMajorGridOpacIn.addEventListener("input", () => {
    const v = parseFloat(ctMajorGridOpacIn.value);
    ctMajorGridOpacVal.textContent = v.toFixed(2);
    _contourSettings.majorGridOpacity = v;
    _commit();
  });
  const ctMinorGridChk     = details.querySelector("#ct-minor-grid");
  const ctMinorGridColorIn = details.querySelector("#ct-minor-grid-color");
  const ctMinorGridOpacIn  = details.querySelector("#ct-minor-grid-opacity");
  const ctMinorGridOpacVal = details.querySelector("#ct-minor-grid-opacity-val");
  ctMinorGridChk.addEventListener("change", () => {
    _contourSettings.showMinorGrid = ctMinorGridChk.checked;
    ctMinorGridColorIn.disabled = !ctMinorGridChk.checked;
    ctMinorGridOpacIn.disabled  = !ctMinorGridChk.checked;
    _commit();
  });
  ctMinorGridColorIn.addEventListener("input", () => { _contourSettings.minorGridColor = ctMinorGridColorIn.value; _commit(); });
  ctMinorGridOpacIn.addEventListener("input", () => {
    const v = parseFloat(ctMinorGridOpacIn.value);
    ctMinorGridOpacVal.textContent = v.toFixed(2);
    _contourSettings.minorGridOpacity = v;
    _commit();
  });

  return details;
}

// ── Explore tab ────────────────────────────────────────────────────────────────

async function _initExploreTab(pane, r) {
  clearEl(pane);
  showSpinner(pane);
  const resp = await get("/api/model/explore/scatter");
  hideSpinner(pane);

  if (!resp.success) {
    pane.innerHTML = `<p style="color:var(--color-text-muted);padding:var(--space-4) 0;">No explore data available.</p>`;
    return;
  }

  _loadScatterSettings();
  _loadContourSettings();

  const data = resp;

  // ── SCATTER SECTION ─────────────────────────────────────────────────────────
  const scatterSection = el("div", { cls: "explore-section" });
  const scatterTitle = el("h3", { cls: "results-section-title", text: "Scatter Plot" });
  registerPrimer("explore-scatter", scatterTitle, "How do I use the scatter plot?", `
    <p>Set the <strong>X axis</strong> to any input column and the <strong>Y axis</strong> to any output.</p>
    <p>Circles show <strong>actual</strong> values (from your test set). Crosses show the
    <strong>model's prediction</strong> at each test point. The color encodes a third variable —
    try setting it to <strong>Residual</strong> to instantly spot where the model is least accurate.</p>
    <p>The <strong>input range filters</strong> below the controls hide data points outside a given range,
    letting you focus on a subregion of the design space.</p>
  `);
  scatterSection.appendChild(scatterTitle);
  scatterSection.appendChild(_buildScatterSettingsPanel());

  // Controls row
  const scCtrl = el("div", { cls: "explore-controls-row" });

  const xSel = _makeExploreSelect("X axis:", data.input_columns, data.input_columns[0]);

  // Y axis: raw output columns + residuals
  const yOpts = [], yLabels = [];
  for (const col of data.output_columns) {
    yOpts.push(col);              yLabels.push(col);
    yOpts.push(`${col}__residual`); yLabels.push(`${col} — residual`);
  }
  const ySel = _makeExploreSelectLabeled("Y axis:", yOpts, yLabels, yOpts[0]);

  // Color options: residual for each output + all inputs
  const colorOpts = [], colorLabels = [];
  for (const col of data.output_columns) {
    colorOpts.push(`${col}__residual`);
    colorLabels.push(`${col} — residual`);
  }
  for (const col of data.input_columns) {
    colorOpts.push(col);
    colorLabels.push(col);
  }
  const colorSel = _makeExploreSelectLabeled("Color:", colorOpts, colorLabels, colorOpts[0]);

  const scColorscaleSel = _makeExploreSelect("Scale:", ["Viridis","Plasma","RdBu","Inferno","Hot"], "Viridis");

  scCtrl.appendChild(xSel.wrap);
  scCtrl.appendChild(ySel.wrap);
  scCtrl.appendChild(colorSel.wrap);
  scCtrl.appendChild(scColorscaleSel.wrap);
  scatterSection.appendChild(scCtrl);

  // Range filter panel
  const filterPanel = el("div", { cls: "explore-filter-panel" });
  scatterSection.appendChild(filterPanel);

  // Chart
  const scatterChart = el("div", { cls: "explore-chart-wrap" });
  scatterSection.appendChild(scatterChart);
  pane.appendChild(scatterSection);

  // State
  const filterRanges = {};

  function rebuildFilterPanel() {
    clearEl(filterPanel);
    Object.keys(filterRanges).forEach(k => delete filterRanges[k]);
    const xCol = xSel.select.value;
    const fixedInputs = data.input_columns.filter(c => c !== xCol);
    if (fixedInputs.length === 0) return;
    const filterTitle = el("p", { cls: "explore-filter-label", text: "Input range filters:" });
    filterPanel.appendChild(filterTitle);
    const grid = el("div", { cls: "explore-filter-grid" });
    filterPanel.appendChild(grid);
    for (const col of fixedInputs) {
      const mn = data.input_mins[col] ?? 0;
      const mx = data.input_maxs[col] ?? 1;
      filterRanges[col] = [mn, mx];
      grid.appendChild(_buildRangeFilter(col, mn, mx, (lo, hi) => {
        filterRanges[col] = [lo, hi];
        drawScatter();
      }));
    }
  }

  function drawScatter() {
    renderScatterExplorer(scatterChart, data, {
      xCol:        xSel.select.value,
      yCol:        ySel.select.value,
      colorKey:    colorSel.select.value,
      colorscale:  scColorscaleSel.select.value,
      filterRanges,
      ..._scatterSettings,
    });
    requestAnimationFrame(() => {
      const p = scatterChart.querySelector(".js-plotly-plot");
      if (p) Plotly.Plots.resize(p); // eslint-disable-line no-undef
    });
  }

  _drawExploreScatter = drawScatter;

  xSel.select.addEventListener("change", () => { rebuildFilterPanel(); drawScatter(); });
  ySel.select.addEventListener("change", drawScatter);
  colorSel.select.addEventListener("change", drawScatter);
  scColorscaleSel.select.addEventListener("change", drawScatter);
  rebuildFilterPanel();
  drawScatter();

  // ── CONTOUR SECTION ─────────────────────────────────────────────────────────
  const contourSection = el("div", { cls: "explore-section" });
  const contourTitle = el("h3", { cls: "results-section-title", text: "2D Contour Plot" });
  registerPrimer("explore-contour", contourTitle, "How do I use the contour plot?", `
    <p>Set the <strong>X and Y axes</strong> to any two input columns. The model is evaluated
    on a grid of (X, Y) combinations while all other inputs are held at the values set by the
    sliders below.</p>
    <p>The <strong>color</strong> shows the predicted output value at each grid point — darker
    or lighter regions reveal where the surrogate predicts high or low output.</p>
    <p>The plot auto-regenerates 500 ms after you change any control. Increase the
    <strong>grid resolution</strong> for smoother contours at the cost of a longer compute time.</p>
  `);
  contourSection.appendChild(contourTitle);
  contourSection.appendChild(_buildContourSettingsPanel());

  const coCtrl = el("div", { cls: "explore-controls-row" });
  const cxSel  = _makeExploreSelect("X axis:", data.input_columns,  data.input_columns[0]);
  const cyOpts = data.input_columns;
  const cySel  = _makeExploreSelect("Y axis:", cyOpts, cyOpts[Math.min(1, cyOpts.length - 1)]);

  // Output: raw output columns + residuals
  const coOutputOpts = [], coOutputLabels = [];
  for (const col of data.output_columns) {
    coOutputOpts.push(col);              coOutputLabels.push(col);
    coOutputOpts.push(`${col}__residual`); coOutputLabels.push(`${col} — residual`);
  }
  const coOutSel = _makeExploreSelectLabeled("Output:", coOutputOpts, coOutputLabels, coOutputOpts[0]);
  const gridSel  = _makeExploreSelect("Grid:", ["25", "50", "100"], "50");
  const coColorscaleSel = _makeExploreSelect("Scale:", ["Plasma","Viridis","RdBu","Inferno","Hot"], "Plasma");

  coCtrl.appendChild(cxSel.wrap);
  coCtrl.appendChild(cySel.wrap);
  coCtrl.appendChild(coOutSel.wrap);
  coCtrl.appendChild(gridSel.wrap);
  coCtrl.appendChild(coColorscaleSel.wrap);
  contourSection.appendChild(coCtrl);

  // Fixed-input sliders
  const fixedPanel = el("div", { cls: "explore-fixed-panel" });
  contourSection.appendChild(fixedPanel);

  // Contour chart + spinner overlay wrapper
  const contourWrap = el("div", { cls: "explore-chart-outer" });
  const contourChart = el("div", { cls: "explore-chart-wrap" });
  const contourSpinner = el("div", { cls: "explore-chart-spinner hidden" });
  contourSpinner.textContent = "Computing…";
  contourWrap.appendChild(contourChart);
  contourWrap.appendChild(contourSpinner);
  contourSection.appendChild(contourWrap);
  pane.appendChild(contourSection);

  // Fixed-value state
  const fixedVals = {};

  function rebuildFixedPanel() {
    clearEl(fixedPanel);
    Object.keys(fixedVals).forEach(k => delete fixedVals[k]);
    const xCol = cxSel.select.value;
    const yCol = cySel.select.value;
    const remaining = data.input_columns.filter(c => c !== xCol && c !== yCol);
    if (remaining.length === 0) return;
    const fixedTitle = el("p", { cls: "explore-filter-label", text: "Fixed input values:" });
    fixedPanel.appendChild(fixedTitle);
    const grid = el("div", { cls: "explore-filter-grid" });
    fixedPanel.appendChild(grid);
    for (const col of remaining) {
      const mn  = data.input_mins[col]  ?? 0;
      const mx  = data.input_maxs[col]  ?? 1;
      const mid = (mn + mx) / 2;
      fixedVals[col] = mid;
      grid.appendChild(_buildFixedSlider(col, mn, mx, mid, debounce(val => {
        fixedVals[col] = val;
        drawContour();
      }, 500)));
    }
  }

  const drawContourDebounced = debounce(drawContour, 500);

  async function drawContour() {
    const xCol = cxSel.select.value;
    const yCol = cySel.select.value;
    if (xCol === yCol) {
      // eslint-disable-next-line no-undef
      if (contourChart.querySelector(".js-plotly-plot")) Plotly.purge(contourChart);
      contourChart.innerHTML = `<p style="color:var(--color-text-muted);padding:var(--space-4) 0;">X and Y axes must be different columns.</p>`;
      return;
    }

    contourSpinner.classList.remove("hidden");
    const result = await post("/api/model/explore/contour", {
      x_col:        xCol,
      y_col:        yCol,
      output_col:   coOutSel.select.value,
      fixed_inputs: { ...fixedVals },
      n_grid:       parseInt(gridSel.select.value, 10),
    });
    contourSpinner.classList.add("hidden");

    if (!result.success) return;
    renderContourExplorer(contourChart, result, {
      colorscale: coColorscaleSel.select.value,
      ..._contourSettings,
    });
    requestAnimationFrame(() => {
      const p = contourChart.querySelector(".js-plotly-plot");
      if (p) Plotly.Plots.resize(p); // eslint-disable-line no-undef
    });
  }

  _drawExploreContour = drawContour;

  cxSel.select.addEventListener("change", () => { rebuildFixedPanel(); drawContourDebounced(); });
  cySel.select.addEventListener("change", () => { rebuildFixedPanel(); drawContourDebounced(); });
  coOutSel.select.addEventListener("change", drawContourDebounced);
  gridSel.select.addEventListener("change", drawContourDebounced);
  coColorscaleSel.select.addEventListener("change", drawContourDebounced);

  rebuildFixedPanel();
  drawContour();
}

// ── Explore UI helpers ─────────────────────────────────────────────────────────

function _makeExploreSelect(labelText, values, defaultVal) {
  const wrap = el("div", { cls: "explore-ctrl-group" });
  const lbl  = el("label", { cls: "explore-ctrl-label", text: labelText });
  const sel  = el("select", { cls: "model-config-select explore-select" });
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    if (v === defaultVal) opt.selected = true;
    sel.appendChild(opt);
  }
  wrap.appendChild(lbl);
  wrap.appendChild(sel);
  return { wrap, select: sel };
}

function _makeExploreSelectLabeled(labelText, values, labels, defaultVal) {
  const wrap = el("div", { cls: "explore-ctrl-group" });
  const lbl  = el("label", { cls: "explore-ctrl-label", text: labelText });
  const sel  = el("select", { cls: "model-config-select explore-select" });
  values.forEach((v, i) => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = labels[i] || v;
    if (v === defaultVal) opt.selected = true;
    sel.appendChild(opt);
  });
  wrap.appendChild(lbl);
  wrap.appendChild(sel);
  return { wrap, select: sel };
}

function _buildRangeFilter(col, mn, mx, onChange) {
  const step = (mx - mn) / 200 || 0.001;
  const wrap = el("div", { cls: "explore-range-filter" });
  wrap.innerHTML = `
    <span class="explore-range-label">${col}</span>
    <div class="explore-range-inputs">
      <label class="explore-range-sublabel">Min</label>
      <input type="range" class="explore-range-slider" data-role="min"
             min="${mn}" max="${mx}" step="${step}" value="${mn}">
      <span class="explore-range-val" data-role="min-val">${mn.toFixed(3)}</span>
      <label class="explore-range-sublabel">Max</label>
      <input type="range" class="explore-range-slider" data-role="max"
             min="${mn}" max="${mx}" step="${step}" value="${mx}">
      <span class="explore-range-val" data-role="max-val">${mx.toFixed(3)}</span>
    </div>`;
  let lo = mn, hi = mx;
  wrap.querySelector('[data-role="min"]').addEventListener("input", e => {
    lo = parseFloat(e.target.value);
    if (lo > hi) { lo = hi; e.target.value = lo; }
    wrap.querySelector('[data-role="min-val"]').textContent = lo.toFixed(3);
    onChange(lo, hi);
  });
  wrap.querySelector('[data-role="max"]').addEventListener("input", e => {
    hi = parseFloat(e.target.value);
    if (hi < lo) { hi = lo; e.target.value = hi; }
    wrap.querySelector('[data-role="max-val"]').textContent = hi.toFixed(3);
    onChange(lo, hi);
  });
  return wrap;
}

function _buildFixedSlider(col, mn, mx, defaultVal, onChange) {
  const step = (mx - mn) / 200 || 0.001;
  const wrap = el("div", { cls: "explore-fixed-slider" });
  wrap.innerHTML = `
    <span class="explore-range-label">${col}</span>
    <div class="explore-range-inputs">
      <input type="range" class="explore-range-slider" data-role="fixed"
             min="${mn}" max="${mx}" step="${step}" value="${defaultVal}">
      <span class="explore-range-val" data-role="fixed-val">${defaultVal.toFixed(3)}</span>
    </div>`;
  wrap.querySelector('[data-role="fixed"]').addEventListener("input", e => {
    const val = parseFloat(e.target.value);
    wrap.querySelector('[data-role="fixed-val"]').textContent = val.toFixed(3);
    onChange(val);
  });
  return wrap;
}
