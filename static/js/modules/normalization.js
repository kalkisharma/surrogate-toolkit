// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/normalization.js
// Version: 0.9.6
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
  cellHeight: 180,
  opacity:    0.7,
  showPoints: false,
  showMean:   true,
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
}

// ── Settings panel ────────────────────────────────────────────────────────────

function _renderBoxSettingsPanel(parentEl) {
  const details = document.createElement("details");
  details.className = "chart-settings-panel";

  const summary = document.createElement("summary");
  summary.className = "chart-settings-panel__summary";
  summary.textContent = "Plot Settings";
  details.appendChild(summary);

  const controls = document.createElement("div");
  controls.className = "chart-settings-controls";

  // Cell height
  const heightGroup = document.createElement("div");
  heightGroup.className = "chart-settings-group";
  const heightLabel = document.createElement("span");
  heightLabel.className = "chart-settings-group__label";
  heightLabel.textContent = "Cell Height (px)";
  const heightInput = document.createElement("input");
  heightInput.type = "number";
  heightInput.className = "chart-settings-input";
  heightInput.min = 100;
  heightInput.max = 400;
  heightInput.step = 10;
  heightInput.value = _boxSettings.cellHeight;
  heightGroup.appendChild(heightLabel);
  heightGroup.appendChild(heightInput);
  controls.appendChild(heightGroup);

  // Opacity
  const opacityGroup = document.createElement("div");
  opacityGroup.className = "chart-settings-group";
  const opacityLabel = document.createElement("span");
  opacityLabel.className = "chart-settings-group__label";
  opacityLabel.textContent = "Opacity";
  const opacityWrap = document.createElement("div");
  opacityWrap.className = "range-with-value";
  const opacityRange = document.createElement("input");
  opacityRange.type = "range";
  opacityRange.className = "chart-settings-range";
  opacityRange.min = 0.1;
  opacityRange.max = 1.0;
  opacityRange.step = 0.05;
  opacityRange.value = _boxSettings.opacity;
  const opacityVal = document.createElement("span");
  opacityVal.className = "chart-settings-range-val";
  opacityVal.textContent = _boxSettings.opacity.toFixed(2);
  opacityWrap.appendChild(opacityRange);
  opacityWrap.appendChild(opacityVal);
  opacityGroup.appendChild(opacityLabel);
  opacityGroup.appendChild(opacityWrap);
  controls.appendChild(opacityGroup);

  // Show outlier points
  const pointsGroup = document.createElement("div");
  pointsGroup.className = "chart-settings-group";
  const pointsLabel = document.createElement("label");
  pointsLabel.className = "chart-settings-check";
  const pointsCb = document.createElement("input");
  pointsCb.type = "checkbox";
  pointsCb.checked = _boxSettings.showPoints;
  pointsLabel.appendChild(pointsCb);
  pointsLabel.appendChild(document.createTextNode(" Show outlier points"));
  pointsGroup.appendChild(pointsLabel);
  controls.appendChild(pointsGroup);

  // Show mean diamond
  const meanGroup = document.createElement("div");
  meanGroup.className = "chart-settings-group";
  const meanLabel = document.createElement("label");
  meanLabel.className = "chart-settings-check";
  const meanCb = document.createElement("input");
  meanCb.type = "checkbox";
  meanCb.checked = _boxSettings.showMean;
  meanLabel.appendChild(meanCb);
  meanLabel.appendChild(document.createTextNode(" Show mean diamond"));
  meanGroup.appendChild(meanLabel);
  controls.appendChild(meanGroup);

  details.appendChild(controls);
  parentEl.appendChild(details);

  // Event handlers — debounced for range/number inputs, immediate for checkboxes
  let _debounceTimer = null;
  function debouncedRerender() {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => { _saveBoxSettings(); _rerenderBoxPlots(); }, 200);
  }

  heightInput.addEventListener("input", () => {
    const v = parseInt(heightInput.value, 10);
    if (!isNaN(v) && v >= 100 && v <= 400) {
      _boxSettings.cellHeight = v;
      debouncedRerender();
    }
  });

  opacityRange.addEventListener("input", () => {
    _boxSettings.opacity = parseFloat(opacityRange.value);
    opacityVal.textContent = _boxSettings.opacity.toFixed(2);
    debouncedRerender();
  });

  pointsCb.addEventListener("change", () => {
    _boxSettings.showPoints = pointsCb.checked;
    _saveBoxSettings();
    _rerenderBoxPlots();
  });

  meanCb.addEventListener("change", () => {
    _boxSettings.showMean = meanCb.checked;
    _saveBoxSettings();
    _rerenderBoxPlots();
  });
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
    <h2 class="section-title">Step 5 — Normalization</h2>
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
