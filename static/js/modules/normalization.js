// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/normalization.js
// Version: 0.9.10
// Description: Normalization step — lets users pick a scaling method for input
//              columns and applies it via POST /api/data/normalize.
//              Gated: rendered only after column designation is confirmed.
//              Includes a settings panel for box plot display, a 5-row sample
//              table showing before/after values, and a CSV download button.
// =============================================================================

import { post } from "../api.js";
import { showError, showSuccess } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { registerPrimer } from "../learning_mode.js";
import { el, clearEl } from "../utils.js";
import { renderNormBoxPlots } from "../charts.js";

const METHODS = [
  { value: "none",   label: "None (passthrough)",        desc: "No scaling — use raw values." },
  { value: "minmax", label: "Min-Max  [0, 1]",           desc: "Scales each input column to [0, 1]. Preserves shape; sensitive to outliers." },
  { value: "zscore", label: "Z-Score  (μ=0, σ=1)",       desc: "Standardizes to zero mean and unit variance. Suitable for GPR." },
];

// ── Box plot settings (persisted to localStorage) ─────────────────────────────

const _BOX_SETTINGS_KEY = "norm_box_settings";
const _BOX_DEFAULT_SETTINGS = {
  cellHeight:   180,
  opacity:      0.7,
  showPoints:   false,
  showMean:     true,
  fontSize:     9,
  fontColor:    null,
  plotBgColor:  null,
  paperBgColor: null,
};

let _boxSettings = { ..._BOX_DEFAULT_SETTINGS };
try {
  const saved = JSON.parse(localStorage.getItem(_BOX_SETTINGS_KEY) || "null");
  if (saved && typeof saved === "object") _boxSettings = { ..._BOX_DEFAULT_SETTINGS, ...saved };
} catch { /* ignore corrupt localStorage */ }

// ── State for settings-triggered re-render ────────────────────────────────────

let _lastHistGrid  = null;
let _lastHistData  = null;
let _lastInputCols = null;
let _lastMethod    = null;

function _saveBoxSettings() {
  localStorage.setItem(_BOX_SETTINGS_KEY, JSON.stringify(_boxSettings));
}

function _rerenderBoxPlots() {
  if (!_lastHistGrid || !_lastHistData || !_lastInputCols) return;
  clearEl(_lastHistGrid);
  renderNormBoxPlots(_lastHistGrid, _lastHistData, _lastInputCols, _lastMethod, _boxSettings);
  requestAnimationFrame(() => {
    _lastHistGrid.querySelectorAll(".js-plotly-plot").forEach(p => Plotly.Plots.resize(p));
  });
}

// ── Settings panel ────────────────────────────────────────────────────────────

function _renderBoxSettingsPanel(parentEl) {
  const s = _boxSettings;
  const isDark        = document.documentElement.getAttribute("data-theme") === "dark";
  const fontColorVal  = s.fontColor    !== null ? s.fontColor    : (isDark ? "#8b94b3" : "#4b5478");
  const fontColorAuto = s.fontColor    === null;
  const plotBgVal     = s.plotBgColor  !== null ? s.plotBgColor  : "#ffffff";
  const plotBgAuto    = s.plotBgColor  === null;
  const paperBgVal    = s.paperBgColor !== null ? s.paperBgColor : "#ffffff";
  const paperBgAuto   = s.paperBgColor === null;

  const details = document.createElement("details");
  details.className = "chart-settings-panel";
  details.innerHTML = `
    <summary class="chart-settings-panel__summary">Plot Settings</summary>
    <div class="chart-settings-controls">

      <div class="settings-divider">Typography</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="bs-font-size">Font (px)</label>
        <input id="bs-font-size" type="number" class="chart-settings-input" min="6" max="16" step="1" value="${s.fontSize}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="bs-font-color">Font color</label>
        <div class="color-with-auto">
          <input id="bs-font-color" type="color" class="chart-settings-color" value="${fontColorVal}"${fontColorAuto ? " disabled" : ""}>
          <label class="chart-settings-check"><input type="checkbox" id="bs-font-color-auto"${fontColorAuto ? " checked" : ""}> Auto</label>
        </div>
      </div>

      <div class="settings-divider">Box Display</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="bs-height">Cell height (px)</label>
        <input id="bs-height" type="number" class="chart-settings-input" min="100" max="400" step="10" value="${s.cellHeight}">
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Opacity</span>
        <div class="range-with-value">
          <input id="bs-opacity" type="range" class="chart-settings-range" min="0.1" max="1.0" step="0.05" value="${s.opacity}">
          <span id="bs-opacity-val" class="chart-settings-range-val">${s.opacity.toFixed(2)}</span>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-check"><input type="checkbox" id="bs-show-points"${s.showPoints ? " checked" : ""}> Show outlier points</label>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-check"><input type="checkbox" id="bs-show-mean"${s.showMean ? " checked" : ""}> Show mean diamond</label>
      </div>

      <div class="settings-divider">Background</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="bs-plot-bg">Plot background</label>
        <div class="color-with-auto">
          <input id="bs-plot-bg" type="color" class="chart-settings-color" value="${plotBgVal}"${plotBgAuto ? " disabled" : ""}>
          <label class="chart-settings-check"><input type="checkbox" id="bs-plot-bg-auto"${plotBgAuto ? " checked" : ""}> Auto</label>
        </div>
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="bs-paper-bg">Paper background</label>
        <div class="color-with-auto">
          <input id="bs-paper-bg" type="color" class="chart-settings-color" value="${paperBgVal}"${paperBgAuto ? " disabled" : ""}>
          <label class="chart-settings-check"><input type="checkbox" id="bs-paper-bg-auto"${paperBgAuto ? " checked" : ""}> Auto</label>
        </div>
      </div>

    </div>
  `;
  parentEl.appendChild(details);

  let _debounceTimer = null;
  function debouncedRerender() {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => { _saveBoxSettings(); _rerenderBoxPlots(); }, 200);
  }

  // Typography
  details.querySelector("#bs-font-size").addEventListener("input", () => {
    const v = parseInt(details.querySelector("#bs-font-size").value, 10);
    if (!isNaN(v) && v >= 6 && v <= 16) { _boxSettings.fontSize = v; debouncedRerender(); }
  });
  const fontColorIn    = details.querySelector("#bs-font-color");
  const fontColorAuto_ = details.querySelector("#bs-font-color-auto");
  fontColorAuto_.addEventListener("change", () => {
    _boxSettings.fontColor  = fontColorAuto_.checked ? null : fontColorIn.value;
    fontColorIn.disabled    = fontColorAuto_.checked;
    debouncedRerender();
  });
  fontColorIn.addEventListener("input", () => { _boxSettings.fontColor = fontColorIn.value; debouncedRerender(); });

  // Box display
  details.querySelector("#bs-height").addEventListener("input", () => {
    const v = parseInt(details.querySelector("#bs-height").value, 10);
    if (!isNaN(v) && v >= 100 && v <= 400) { _boxSettings.cellHeight = v; debouncedRerender(); }
  });
  const opacIn = details.querySelector("#bs-opacity");
  const opacVal = details.querySelector("#bs-opacity-val");
  opacIn.addEventListener("input", () => {
    _boxSettings.opacity = parseFloat(opacIn.value);
    opacVal.textContent  = _boxSettings.opacity.toFixed(2);
    debouncedRerender();
  });
  details.querySelector("#bs-show-points").addEventListener("change", (e) => {
    _boxSettings.showPoints = e.target.checked; _saveBoxSettings(); _rerenderBoxPlots();
  });
  details.querySelector("#bs-show-mean").addEventListener("change", (e) => {
    _boxSettings.showMean = e.target.checked; _saveBoxSettings(); _rerenderBoxPlots();
  });

  // Background
  const plotBgIn    = details.querySelector("#bs-plot-bg");
  const plotBgAuto_ = details.querySelector("#bs-plot-bg-auto");
  plotBgAuto_.addEventListener("change", () => {
    _boxSettings.plotBgColor = plotBgAuto_.checked ? null : plotBgIn.value;
    plotBgIn.disabled        = plotBgAuto_.checked;
    debouncedRerender();
  });
  plotBgIn.addEventListener("input", () => { _boxSettings.plotBgColor = plotBgIn.value; debouncedRerender(); });
  const paperBgIn    = details.querySelector("#bs-paper-bg");
  const paperBgAuto_ = details.querySelector("#bs-paper-bg-auto");
  paperBgAuto_.addEventListener("change", () => {
    _boxSettings.paperBgColor = paperBgAuto_.checked ? null : paperBgIn.value;
    paperBgIn.disabled        = paperBgAuto_.checked;
    debouncedRerender();
  });
  paperBgIn.addEventListener("input", () => { _boxSettings.paperBgColor = paperBgIn.value; debouncedRerender(); });
}

// ── Sample table ──────────────────────────────────────────────────────────────

function _renderSampleTable(parentEl, sampleRows, inputCols, method) {
  const section = el("div", { cls: "norm-sample-section" });
  const title = el("div", {
    cls:  "norm-sample-section__title",
    text: "Sample values (first 5 rows) — input columns only",
  });
  section.appendChild(title);

  const grid = el("div", { cls: "norm-sample-grid" });
  const afterLabel = method === "minmax" ? "After [0, 1]" : method === "zscore" ? "After (σ)" : "After";

  for (const [groupLabel, rows] of [["Before", sampleRows.before], [afterLabel, sampleRows.after]]) {
    const wrap = document.createElement("div");

    const tableLabel = el("div", { cls: "norm-sample-table-label", text: groupLabel });
    wrap.appendChild(tableLabel);

    const table = document.createElement("table");
    table.className = "norm-sample-table";

    // Header
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const rowNumTh = document.createElement("th");
    rowNumTh.textContent = "#";
    rowNumTh.style.textAlign = "left";
    headerRow.appendChild(rowNumTh);
    for (const col of inputCols) {
      const th = document.createElement("th");
      th.textContent = col;
      th.title = col;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement("tbody");
    for (let i = 0; i < rows.length; i++) {
      const tr = document.createElement("tr");
      const rowNumTd = document.createElement("td");
      rowNumTd.textContent = i + 1;
      rowNumTd.style.textAlign = "left";
      rowNumTd.style.color = "var(--color-text-muted)";
      tr.appendChild(rowNumTd);
      for (const col of inputCols) {
        const td = document.createElement("td");
        const v = rows[i][col];
        td.textContent = (v == null || v !== v) ? "—" : Number(v).toFixed(4);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    grid.appendChild(wrap);
  }

  section.appendChild(grid);
  parentEl.appendChild(section);
}

// ── Public init ───────────────────────────────────────────────────────────────

/**
 * Render the normalization section into containerEl.
 *
 * @param {HTMLElement} containerEl    - Target card element.
 * @param {string}      currentMethod  - Current normalization method from metadata (null if none applied).
 * @param {number}      nInputs        - Number of designated input columns.
 */
export function initNormalization(containerEl, currentMethod, nInputs) {
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Step 6 — Normalization</h2>
    <p class="section-desc">Scale input columns before training. Outputs are left unchanged.</p>
  `;
  containerEl.appendChild(header);

  registerPrimer(
    "normalization",
    header,
    "Why normalize inputs?",
    `<p>Many surrogate models (especially GPR) are sensitive to the scale of input variables.
     If one input ranges 0–1,000 and another 0–1, the model may over-weight the larger variable.</p>
     <p><strong>Min-Max</strong> scales each column to [0, 1]. Good when you know the physical range
     of each variable is meaningful.</p>
     <p><strong>Z-Score</strong> centers each column at zero with unit standard deviation.
     Better when the distribution shape matters more than the raw range.</p>
     <p><strong>None</strong> — skip normalization when inputs are already on comparable scales.</p>`
  );

  // ── Status display ──────────────────────────────────────────────────────────
  if (currentMethod && currentMethod !== "none") {
    const statusEl = el("div", { cls: "norm-status" });
    statusEl.innerHTML = `
      <span class="norm-status__icon">✓</span>
      <span class="norm-status__text">
        <strong>${currentMethod === "minmax" ? "Min-Max" : "Z-Score"}</strong> normalization
        applied to ${nInputs} input column${nInputs !== 1 ? "s" : ""}.
        Re-apply below to change method.
      </span>
    `;
    containerEl.appendChild(statusEl);
  }

  // ── Method selector ─────────────────────────────────────────────────────────
  let selectedMethod = currentMethod || "none";
  const optionsWrap  = el("div", { cls: "norm-options" });

  for (const m of METHODS) {
    const wrapper = el("div", { cls: "norm-option" });
    const radioId = `norm-${m.value}`;
    const radio   = el("input", { type: "radio", name: "norm-method", id: radioId, value: m.value });
    radio.checked = selectedMethod === m.value;
    radio.addEventListener("change", () => { if (radio.checked) selectedMethod = m.value; });

    const lbl = el("label", { cls: "norm-option__label", for: radioId });
    lbl.innerHTML = `<span class="norm-option__name">${m.label}</span><span class="norm-option__desc">${m.desc}</span>`;
    wrapper.appendChild(radio);
    wrapper.appendChild(lbl);
    optionsWrap.appendChild(wrapper);
  }
  containerEl.appendChild(optionsWrap);

  // ── Apply button ────────────────────────────────────────────────────────────
  const applyBtn = el("button", {
    cls:   "btn btn-primary",
    text:  "Apply Normalization →",
    style: "margin-top: var(--space-5);",
  });

  applyBtn.addEventListener("click", async () => {
    applyBtn.disabled    = true;
    applyBtn.textContent = "Applying…";
    showSpinner(containerEl);

    const resp = await post("/api/data/normalize", { method: selectedMethod });

    hideSpinner(containerEl);
    applyBtn.disabled    = false;
    applyBtn.textContent = "Apply Normalization →";

    if (!resp.success) {
      showError(resp.message || "Normalization failed.");
      return;
    }

    const label = METHODS.find(m => m.value === selectedMethod)?.label ?? selectedMethod;
    showSuccess(`${label} normalization applied to ${resp.n_columns} input column${resp.n_columns !== 1 ? "s" : ""}.`);

    // Refresh the status display inline
    const existing = containerEl.querySelector(".norm-status");
    if (existing) existing.remove();
    if (selectedMethod !== "none") {
      const statusEl = el("div", { cls: "norm-status" });
      statusEl.innerHTML = `
        <span class="norm-status__icon">✓</span>
        <span class="norm-status__text">
          <strong>${selectedMethod === "minmax" ? "Min-Max" : "Z-Score"}</strong> normalization
          applied to ${resp.n_columns} input column${resp.n_columns !== 1 ? "s" : ""}.
          Re-apply below to change method.
        </span>
      `;
      containerEl.insertBefore(statusEl, optionsWrap);
    }

    // Remove previous viz section if re-applying
    const existingHist = containerEl.querySelector(".norm-hist-section");
    if (existingHist) existingHist.remove();

    if (resp.hist_data && resp.input_columns?.length) {
      const histSection = el("div", { cls: "norm-hist-section" });
      const histTitle   = el("div", {
        cls:  "norm-hist-section-title",
        text: "Before (blue) vs. after (green) scaling — input columns only",
      });
      histSection.appendChild(histTitle);

      // Settings panel
      _renderBoxSettingsPanel(histSection);

      // Box plot grid
      const histGrid = el("div", { cls: "norm-hist-grid" });
      histSection.appendChild(histGrid);

      // Store for settings-triggered re-render
      _lastHistGrid  = histGrid;
      _lastHistData  = resp.hist_data;
      _lastInputCols = resp.input_columns;
      _lastMethod    = selectedMethod;

      renderNormBoxPlots(histGrid, resp.hist_data, resp.input_columns, selectedMethod, _boxSettings);
      requestAnimationFrame(() => {
        histGrid.querySelectorAll(".js-plotly-plot").forEach(p => Plotly.Plots.resize(p));
      });

      // Sample value table
      if (resp.sample_rows && resp.input_columns?.length) {
        _renderSampleTable(histSection, resp.sample_rows, resp.input_columns, selectedMethod);
      }

      // Download button
      const dlBtn = el("button", {
        cls:  "btn btn-secondary btn-sm",
        text: "⬇ Download normalized CSV",
      });
      dlBtn.style.marginTop = "var(--space-4)";
      dlBtn.addEventListener("click", () => { window.location.href = "/api/export/normalized"; });
      histSection.appendChild(dlBtn);

      containerEl.appendChild(histSection);
    }
  });

  containerEl.appendChild(applyBtn);
}
