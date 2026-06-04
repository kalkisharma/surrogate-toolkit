// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/input_screening.js
// Version: 1.2.0 (app v3.5.52)
// Description: Step 8 — Input Filtering. Correlation heatmap, VIF table with
//              3-tier multicollinearity indicators, Sobol ST overlay (when
//              interpretation cache is present), low-variance flags, input
//              toggle checkboxes, and optional PCA dimensionality reduction.
//              Writes selected input subset back to STATE via PUT /api/data/screen/apply.
// =============================================================================

import { post, put } from "../api.js";
import { registerPrimer } from "../learning_mode.js";
import { showError, showSuccess } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { renderDCorHeatmap, renderExplainedVarianceChart } from "../charts.js";
import { el, clearEl, escHtml } from "../utils.js";

// ── Module state ──────────────────────────────────────────────────────────────
let _lastResp    = null;
let _threshold   = 0.9;
let _cvThreshold = 0.01;
let _selected    = null;   // Set of currently selected input columns
let _pcaResp     = null;   // Last PCA preview response

// ── Correlation heatmap display settings (persisted across re-renders) ────────
let _corrHeatFs         = null;    // null = use chart default (12)
let _corrHeatFontColor  = null;    // null = auto
let _corrHeatAnnot      = null;    // null = use chart default (true)
let _corrHeatCellFs     = null;
let _corrHeatLabelFs    = null;
let _corrHeatColorbarFs = null;
let _corrHeatHeight     = 500;

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} containerEl
 * @param {string[]}    inputCols   — currently designated input columns
 */
export async function initScreening(containerEl, inputCols = []) {
  // Reset module-level analysis cache on every panel init. initScreening is only
  // called when panelDone["screen"] is false (new dataset, dataset switch, or
  // explicit panel invalidation), so clearing here prevents a stale previous
  // dataset's results from being shown via the _lastResp cache.
  _lastResp = null;
  _pcaResp  = null;
  _selected = null;

  clearEl(containerEl);

  if (inputCols.length === 0) {
    containerEl.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Step 8 — Filter Inputs</h2>
      </div>
      <p style="color:var(--color-text-muted);padding:var(--space-4) 0;">
        No input columns designated. Complete Step 6 — Assign first.
      </p>`;
    return;
  }

  // Header
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Step 8 — Filter Inputs</h2>
    <p class="section-desc">Identify and remove redundant or uninformative inputs before training.</p>`;
  containerEl.appendChild(header);

  registerPrimer("input_screening", header, "Why filter inputs?", `
    <p><strong>Correlated inputs</strong> carry redundant information — including both can
    destabilise some models and makes sensitivity analysis harder to interpret.
    If two inputs have |r| ≥ 0.9, keeping both adds little value.</p>
    <p><strong>VIF (Variance Inflation Factor)</strong> quantifies multicollinearity.
    VIF &lt; 5 is fine. VIF 5–10 warrants review. VIF ≥ 10 means the input is nearly
    predictable from the others — a strong candidate for removal.</p>
    <p><strong>Low-variance inputs</strong> (near-constant across all runs) contribute
    almost no signal. A coefficient of variation below 1% usually means the column
    was accidentally included or wasn't varied in the design.</p>
    <p>This step never removes columns automatically — you choose what to drop.
    You can also skip this step entirely and proceed to Step 9 — Model.</p>
  `);

  // Controls row
  const controlRow = el("div", { cls: "screen-control-row" });

  const thresholdWrap = el("div", { cls: "screen-threshold-wrap" });
  thresholdWrap.innerHTML = `
    <label class="hyperparam-label" for="screen-threshold">Correlation threshold</label>
    <div class="screen-slider-row">
      <input type="range" id="screen-threshold" class="screen-slider"
             min="0.5" max="1.0" step="0.05" value="${_threshold}">
      <span class="screen-threshold-val" id="screen-threshold-val">${_threshold.toFixed(2)}</span>
    </div>`;
  controlRow.appendChild(thresholdWrap);

  const analyzeBtn = el("button", { cls: "btn btn-primary", text: "Analyze →" });
  controlRow.appendChild(analyzeBtn);
  containerEl.appendChild(controlRow);

  // Threshold slider live-update
  containerEl.querySelector("#screen-threshold")?.addEventListener("input", (e) => {
    _threshold = parseFloat(e.target.value);
    const valEl = containerEl.querySelector("#screen-threshold-val");
    if (valEl) valEl.textContent = _threshold.toFixed(2);
  });

  // Results area
  const resultsDiv = el("div", { id: "screen-results" });
  containerEl.appendChild(resultsDiv);

  // Render cached results from a previous Analyze run
  if (_lastResp) {
    if (!_selected) _selected = new Set(_lastResp.input_columns);
    _renderResults(resultsDiv, _lastResp, containerEl);
  }

  analyzeBtn.addEventListener("click", async () => {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Analyzing…";
    showSpinner(analyzeBtn);
    const resp = await post("/api/data/screen", {
      threshold:    _threshold,
      cv_threshold: _cvThreshold,
    });
    hideSpinner(analyzeBtn);
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "Analyze →";
    if (!resp.success) {
      showError(resp.message || "Analysis failed.");
      return;
    }
    _lastResp = resp;
    _pcaResp  = null;
    // Reset selection to all, then pre-uncheck flagged
    _selected = new Set(resp.input_columns);
    _preUncheckFlagged(resp);
    _renderResults(resultsDiv, resp, containerEl);
  });
}

// ── Pre-uncheck logic ─────────────────────────────────────────────────────────

function _preUncheckFlagged(resp) {
  const corrFlagged = new Set(resp.flagged_pairs.map(p => p.col_b));
  const varFlagged  = new Set(resp.low_variance.map(v => v.col));
  const vifFlagged  = new Set(
    resp.vif
      ? Object.entries(resp.vif).filter(([, v]) => v >= 10).map(([k]) => k)
      : []
  );
  for (const col of [...corrFlagged, ...varFlagged, ...vifFlagged]) {
    _selected.delete(col);
  }
}

// ── VIF helpers ───────────────────────────────────────────────────────────────

function _vifTier(vif) {
  if (vif >= 10) return { cls: "vif-tier--red",   icon: "✗", label: "High (≥10)" };
  if (vif >= 5)  return { cls: "vif-tier--amber", icon: "⚠", label: "Moderate (5–10)" };
  return              { cls: "vif-tier--green",  icon: "✓", label: "OK (<5)" };
}

// ── Main results renderer ─────────────────────────────────────────────────────

function _renderResults(container, resp, rootEl) {
  clearEl(container);

  // Compute derived flagging sets
  const corrFlagged = new Set(resp.flagged_pairs.map(p => p.col_b));
  const varFlagged  = new Set(resp.low_variance.map(v => v.col));
  const vifFlagged  = new Set(
    resp.vif
      ? Object.entries(resp.vif).filter(([, v]) => v >= 10).map(([k]) => k)
      : []
  );

  // ── Correlation heatmap ───────────────────────────────────────────────────
  const heatSection = el("div", { cls: "screen-section" });
  heatSection.innerHTML = `<h3 class="screen-section-title">Distance Correlation Matrix</h3>`;
  container.appendChild(heatSection);

  // Settings panel (same controls as dCor heatmap in Explore)
  const _db = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const isDark0       = document.documentElement.getAttribute("data-theme") === "dark";
  const fcAuto0       = _corrHeatFontColor === null;
  const fcVal0        = _corrHeatFontColor ?? (isDark0 ? "#8b94b3" : "#4b5478");
  const hAutoChk0     = _corrHeatHeight === null;

  const corrSettingsEl = document.createElement("details");
  corrSettingsEl.className = "chart-settings-panel";
  corrSettingsEl.innerHTML = `
    <summary class="chart-settings-panel__summary">Plot Settings</summary>
    <div class="chart-settings-controls">
      <div class="settings-divider">Typography</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="corr-cs-font">Base font (px)</label>
        <input id="corr-cs-font" type="number" class="chart-settings-input"
               min="7" max="24" step="1" value="${_corrHeatFs ?? 12}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="corr-cs-cell-font">Cell value font (px)</label>
        <input id="corr-cs-cell-font" type="number" class="chart-settings-input"
               min="6" max="24" step="1" placeholder="auto" value="${_corrHeatCellFs ?? ""}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="corr-cs-label-font">Axis label font (px)</label>
        <input id="corr-cs-label-font" type="number" class="chart-settings-input"
               min="6" max="24" step="1" placeholder="auto" value="${_corrHeatLabelFs ?? ""}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="corr-cs-colorbar-font">Colorbar font (px)</label>
        <input id="corr-cs-colorbar-font" type="number" class="chart-settings-input"
               min="6" max="24" step="1" placeholder="auto" value="${_corrHeatColorbarFs ?? ""}">
      </div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="corr-cs-font-color">Font color</label>
        <div class="color-with-auto">
          <input id="corr-cs-font-color" type="color" class="chart-settings-color"
                 value="${fcVal0}" ${fcAuto0 ? "disabled" : ""} style="opacity:${fcAuto0 ? "0.4" : "1"}">
          <label class="chart-settings-check">
            <input type="checkbox" id="corr-cs-font-color-auto" ${fcAuto0 ? "checked" : ""}> Auto
          </label>
        </div>
      </div>
      <div class="settings-divider">Figure</div>
      <div class="chart-settings-group">
        <label class="chart-settings-group__label" for="corr-cs-height">Height (px)</label>
        <div class="width-control">
          <input id="corr-cs-height" type="number" class="chart-settings-input"
                 min="200" max="1200" step="50" value="${_corrHeatHeight ?? Math.max(280, resp.input_columns.length * 44 + 100)}"
                 ${hAutoChk0 ? "disabled" : ""}>
          <label class="chart-settings-check">
            <input type="checkbox" id="corr-cs-height-auto" ${hAutoChk0 ? "checked" : ""}> Auto
          </label>
        </div>
      </div>
      <div class="chart-settings-group">
        <span class="chart-settings-group__label">Cell values</span>
        <label class="chart-settings-check">
          <input type="checkbox" id="corr-cs-annot" ${_corrHeatAnnot !== false ? "checked" : ""}> Show
        </label>
      </div>
    </div>
  `;
  heatSection.appendChild(corrSettingsEl);

  const heatWrap = el("div", { cls: "screen-heatmap-wrap" });
  heatSection.appendChild(heatWrap);

  function _redrawCorrHeat() {
    renderDCorHeatmap(heatWrap, resp.input_columns, resp.dcor_matrix, {
      fontSize:         _corrHeatFs         !== null ? _corrHeatFs         : 12,
      fontColor:        _corrHeatFontColor  !== null ? _corrHeatFontColor  : undefined,
      showAnnotations:  _corrHeatAnnot      !== null ? _corrHeatAnnot      : undefined,
      height:           _corrHeatHeight     !== null ? _corrHeatHeight     : undefined,
      cellFontSize:     _corrHeatCellFs     !== null ? _corrHeatCellFs     : undefined,
      labelFontSize:    _corrHeatLabelFs    !== null ? _corrHeatLabelFs    : undefined,
      colorbarFontSize: _corrHeatColorbarFs !== null ? _corrHeatColorbarFs : undefined,
    });
  }
  _redrawCorrHeat();

  // Re-render on theme toggle
  document.addEventListener("theme:changed", _redrawCorrHeat);

  // Settings wiring
  const _g = id => corrSettingsEl.querySelector(`#${id}`);

  _g("corr-cs-font").addEventListener("input", _db((e) => {
    const v = parseInt(e.target.value, 10);
    if (v >= 7 && v <= 24) { _corrHeatFs = v; _redrawCorrHeat(); }
  }, 200));

  const _wireCorrFont = (id, setter) => {
    _g(id).addEventListener("input", _db((e) => {
      const raw = e.target.value.trim();
      const v   = parseInt(raw, 10);
      setter(raw === "" ? null : (isNaN(v) ? null : v));
      _redrawCorrHeat();
    }, 200));
  };
  _wireCorrFont("corr-cs-cell-font",     v => { _corrHeatCellFs     = v; });
  _wireCorrFont("corr-cs-label-font",    v => { _corrHeatLabelFs    = v; });
  _wireCorrFont("corr-cs-colorbar-font", v => { _corrHeatColorbarFs = v; });

  const fcInput = _g("corr-cs-font-color");
  const fcAuto$ = _g("corr-cs-font-color-auto");
  fcAuto$.addEventListener("change", () => {
    fcInput.disabled = fcAuto$.checked;
    fcInput.style.opacity = fcAuto$.checked ? "0.4" : "1";
    _corrHeatFontColor = fcAuto$.checked ? null : fcInput.value;
    _redrawCorrHeat();
  });
  fcInput.addEventListener("input", _db((e) => {
    if (!fcAuto$.checked) { _corrHeatFontColor = e.target.value; _redrawCorrHeat(); }
  }, 200));

  const hInput = _g("corr-cs-height");
  const hAuto$ = _g("corr-cs-height-auto");
  hAuto$.addEventListener("change", () => {
    hInput.disabled = hAuto$.checked;
    _corrHeatHeight = hAuto$.checked ? null : parseInt(hInput.value, 10);
    _redrawCorrHeat();
  });
  hInput.addEventListener("input", _db((e) => {
    if (!hAuto$.checked) {
      const v = parseInt(e.target.value, 10);
      if (v >= 200 && v <= 1200) { _corrHeatHeight = v; _redrawCorrHeat(); }
    }
  }, 200));

  _g("corr-cs-annot").addEventListener("change", (e) => {
    _corrHeatAnnot = e.target.checked; _redrawCorrHeat();
  });

  // ── Flagged pairs ─────────────────────────────────────────────────────────
  const pairsSection = el("div", { cls: "screen-section" });
  if (resp.flagged_pairs.length === 0) {
    pairsSection.innerHTML = `
      <h3 class="screen-section-title">Correlated Pairs</h3>
      <p class="screen-none-msg">No pairs exceed |r| ≥ ${resp.threshold.toFixed(2)}. No action needed.</p>`;
  } else {
    pairsSection.innerHTML = `
      <h3 class="screen-section-title">Correlated Pairs (|r| ≥ ${resp.threshold.toFixed(2)})</h3>
      <p class="screen-section-desc">For each flagged pair, keep the input that is more physically meaningful.
        The tool does not auto-remove.</p>`;
    const table = el("table", { cls: "results-table screen-pairs-table" });
    table.innerHTML = `
      <thead><tr>
        <th>Input A</th><th>Input B</th><th>|r|</th>
      </tr></thead>
      <tbody>
        ${resp.flagged_pairs.map(p => `
          <tr>
            <td>${escHtml(p.col_a)}</td>
            <td>${escHtml(p.col_b)}</td>
            <td><strong>${p.abs_r.toFixed(3)}</strong></td>
          </tr>`).join("")}
      </tbody>`;
    pairsSection.appendChild(table);
  }
  container.appendChild(pairsSection);

  // ── VIF table ─────────────────────────────────────────────────────────────
  if (resp.vif && Object.keys(resp.vif).length > 0) {
    _renderVifSection(container, resp);
  }

  // ── Low-variance flags ────────────────────────────────────────────────────
  const varSection = el("div", { cls: "screen-section" });
  if (resp.low_variance.length === 0) {
    varSection.innerHTML = `
      <h3 class="screen-section-title">Low-Variance Inputs</h3>
      <p class="screen-none-msg">No near-constant inputs detected (CV ≥ ${resp.cv_threshold}).</p>`;
  } else {
    varSection.innerHTML = `
      <h3 class="screen-section-title">Low-Variance Inputs (CV &lt; ${resp.cv_threshold})</h3>
      <p class="screen-section-desc">These inputs have almost no variation and contribute negligible signal.</p>`;
    const table = el("table", { cls: "results-table screen-pairs-table" });
    table.innerHTML = `
      <thead><tr><th>Input</th><th>Mean</th><th>Std</th><th>CV</th></tr></thead>
      <tbody>
        ${resp.low_variance.map(v => `
          <tr>
            <td>${escHtml(v.col)}</td>
            <td class="metric-secondary">${v.mean.toExponential(3)}</td>
            <td class="metric-secondary">${v.std.toExponential(3)}</td>
            <td><strong>${v.cv.toExponential(3)}</strong></td>
          </tr>`).join("")}
      </tbody>`;
    varSection.appendChild(table);
  }
  container.appendChild(varSection);

  // ── Input selector ────────────────────────────────────────────────────────
  const selectSection = el("div", { cls: "screen-section" });
  selectSection.innerHTML = `
    <h3 class="screen-section-title">Select Inputs for Training</h3>
    <p class="screen-section-desc">Uncheck inputs to exclude them from model training.
      Flagged inputs are pre-unchecked — override freely.</p>`;

  const grid = el("div", { cls: "screen-checkbox-grid" });

  for (const col of resp.input_columns) {
    const isCorrFlagged = corrFlagged.has(col);
    const isVarFlagged  = varFlagged.has(col);
    const isVifFlagged  = vifFlagged.has(col);
    const isFlagged     = isCorrFlagged || isVarFlagged || isVifFlagged;

    const rowEl = el("label", {
      cls: `screen-checkbox-row${isFlagged ? " screen-checkbox-row--flagged" : ""}`,
    });
    const cb = document.createElement("input");
    cb.type        = "checkbox";
    cb.dataset.col = col;
    cb.checked     = _selected.has(col);
    cb.addEventListener("change", () => {
      if (cb.checked) _selected.add(col);
      else            _selected.delete(col);
      _updateApplyBtn(applyBtn);
    });

    const lblSpan = el("span", { text: col });
    if (isFlagged) lblSpan.classList.add("screen-flagged-label");

    rowEl.appendChild(cb);
    rowEl.appendChild(document.createTextNode(" "));
    rowEl.appendChild(lblSpan);

    if (isCorrFlagged) {
      rowEl.appendChild(el("span", { cls: "screen-flag-tag", text: "corr" }));
    }
    if (isVarFlagged) {
      rowEl.appendChild(el("span", { cls: "screen-flag-tag", text: "low-var" }));
    }
    if (isVifFlagged) {
      rowEl.appendChild(el("span", { cls: "screen-flag-tag screen-flag-tag--vif", text: "vif" }));
    }

    grid.appendChild(rowEl);
  }
  selectSection.appendChild(grid);
  container.appendChild(selectSection);

  // ── Apply + skip ──────────────────────────────────────────────────────────
  const applyRow = el("div", { cls: "screen-apply-row" });
  const applyBtn = el("button", { cls: "btn btn-primary" });
  _updateApplyBtn(applyBtn);

  applyBtn.addEventListener("click", async () => {
    const cols = [..._selected];
    if (cols.length < 1) { showError("Select at least one input column."); return; }
    applyBtn.disabled    = true;
    applyBtn.textContent = "Applying…";
    const r = await put("/api/data/screen/apply", { mode: "columns", input_columns: cols });
    applyBtn.disabled = false;
    _updateApplyBtn(applyBtn);
    if (!r.success) { showError(r.message || "Apply failed."); return; }
    showSuccess(r.message || `${cols.length} inputs selected.`);
    rootEl.dispatchEvent(new CustomEvent("screen:applied", {
      detail: { input_columns: cols },
      bubbles: true,
    }));
  });

  applyRow.appendChild(applyBtn);
  applyRow.appendChild(el("p", {
    cls: "screen-skip-note",
    text: "Or skip this step — proceed directly to Step 9 — Model.",
  }));
  container.appendChild(applyRow);

  // ── PCA sub-section ───────────────────────────────────────────────────────
  if (resp.input_columns.length >= 2) {
    _renderPcaSection(container, resp, rootEl);
  }

  requestAnimationFrame(() => {
    container.querySelectorAll(".js-plotly-plot").forEach(p => Plotly.Plots.resize(p));
  });
}

// ── VIF section renderer ──────────────────────────────────────────────────────

function _renderVifSection(container, resp) {
  const hasSobol = resp.sobol_st && Object.keys(resp.sobol_st).length > 0;

  const sortedByVif = [...resp.input_columns].sort(
    (a, b) => (resp.vif[b] ?? 0) - (resp.vif[a] ?? 0)
  );

  const section = el("div", { cls: "screen-section" });
  section.innerHTML = `
    <h3 class="screen-section-title">Variance Inflation Factor (VIF)</h3>
    <p class="screen-section-desc">
      Measures multicollinearity across all inputs.
      <span class="vif-tier vif-tier--green">✓</span> &lt; 5 (OK) ·
      <span class="vif-tier vif-tier--amber">⚠</span> 5–10 (moderate) ·
      <span class="vif-tier vif-tier--red">✗</span> ≥ 10 (high — pre-unchecked).
      ${hasSobol ? "Sobol Sₜ from cached interpretation results." : ""}
    </p>`;

  const table = el("table", { cls: "results-table screen-vif-table" });
  const sobolHeader = hasSobol
    ? `<th title="Sobol total-order sensitivity (mean across all outputs)">Sobol Sₜ</th>`
    : "";
  table.innerHTML = `
    <thead><tr>
      <th>Input</th><th>VIF</th><th></th>${sobolHeader}
    </tr></thead>
    <tbody>
      ${sortedByVif.map(col => {
        const vif  = resp.vif[col] ?? 0;
        const tier = _vifTier(vif);
        const sobolCell = hasSobol
          ? `<td class="metric-secondary">${
              resp.sobol_st[col] != null ? resp.sobol_st[col].toFixed(3) : "—"
            }</td>`
          : "";
        return `<tr>
          <td>${escHtml(col)}</td>
          <td><strong>${vif.toFixed(2)}</strong></td>
          <td><span class="vif-tier ${tier.cls}" title="${tier.label}">${tier.icon}</span></td>
          ${sobolCell}
        </tr>`;
      }).join("")}
    </tbody>`;
  section.appendChild(table);
  container.appendChild(section);
}

// ── PCA sub-section ───────────────────────────────────────────────────────────

function _renderPcaSection(container, resp, rootEl) {
  const nInputs = resp.input_columns.length;

  const details = document.createElement("details");
  details.className = "screen-pca-wrap";

  const summary = document.createElement("summary");
  summary.className = "screen-pca-toggle";
  summary.textContent = "PCA Dimensionality Reduction (optional)";
  details.appendChild(summary);

  const body = el("div", { cls: "screen-pca-body" });
  body.innerHTML = `
    <p class="screen-section-desc">
      Principal Component Analysis projects your inputs into uncorrelated components, eliminating
      all multicollinearity at once. Use this when many inputs are correlated and individual
      filtering is insufficient.
      <strong>After applying PCA, the model and prediction steps operate in PC coordinates.</strong>
    </p>`;

  // n_components control
  const nRow = el("div", { cls: "screen-pca-control-row" });
  const nLbl = el("label", { cls: "hyperparam-label" });
  nLbl.setAttribute("for", "pca-n-components");
  nLbl.textContent = "Components";
  nRow.appendChild(nLbl);

  const nInput = document.createElement("input");
  nInput.type      = "number";
  nInput.id        = "pca-n-components";
  nInput.className = "global-header__input";
  nInput.min       = "1";
  nInput.max       = String(nInputs);
  nInput.value     = String(Math.min(nInputs, 3));
  nRow.appendChild(nInput);

  const previewBtn = el("button", { cls: "btn btn-secondary", text: "Preview PCA →" });
  nRow.appendChild(previewBtn);
  body.appendChild(nRow);

  const pcaResultsDiv = el("div", { cls: "screen-pca-results" });
  body.appendChild(pcaResultsDiv);

  const applyPcaBtn = el("button", {
    cls: "btn btn-primary screen-pca-apply-btn hidden",
    text: "Apply PCA →",
  });
  body.appendChild(applyPcaBtn);

  // Restore previous preview if available
  if (_pcaResp) {
    nInput.value = String(_pcaResp.n_components_selected);
    _renderPcaResults(pcaResultsDiv, _pcaResp, applyPcaBtn);
    details.open = true;
  }

  previewBtn.addEventListener("click", async () => {
    const n = parseInt(nInput.value, 10);
    if (isNaN(n) || n < 1 || n > nInputs) {
      showError(`Components must be between 1 and ${nInputs}.`);
      return;
    }
    previewBtn.disabled    = true;
    previewBtn.textContent = "Computing…";
    showSpinner(previewBtn);
    const r = await post("/api/data/screen/pca", { n_components: n });
    hideSpinner(previewBtn);
    previewBtn.disabled    = false;
    previewBtn.textContent = "Preview PCA →";
    if (!r.success) { showError(r.message || "PCA preview failed."); return; }
    _pcaResp = r;
    _renderPcaResults(pcaResultsDiv, r, applyPcaBtn);
    requestAnimationFrame(() => {
      pcaResultsDiv.querySelectorAll(".js-plotly-plot").forEach(p => Plotly.Plots.resize(p));
    });
  });

  applyPcaBtn.addEventListener("click", async () => {
    if (!_pcaResp) return;
    const n = _pcaResp.n_components_selected;
    applyPcaBtn.disabled    = true;
    applyPcaBtn.textContent = "Applying PCA…";
    const r = await put("/api/data/screen/apply", { mode: "pca", n_components: n });
    applyPcaBtn.disabled    = false;
    applyPcaBtn.textContent = "Apply PCA →";
    if (!r.success) { showError(r.message || "PCA apply failed."); return; }
    showSuccess(r.message || `PCA applied — ${n} component${n !== 1 ? "s" : ""}.`);
    rootEl.dispatchEvent(new CustomEvent("screen:applied", {
      detail: { input_columns: r.input_columns },
      bubbles: true,
    }));
  });

  details.appendChild(body);
  container.appendChild(details);
}

function _renderPcaResults(container, r, applyBtn) {
  clearEl(container);

  // Explained variance chart
  const chartWrap = el("div", { cls: "screen-pca-chart-wrap" });
  container.appendChild(chartWrap);
  renderExplainedVarianceChart(
    chartWrap,
    r.explained_variance_ratio,
    r.cumulative_variance,
    r.n_components_selected
  );

  // Loadings table — one row per component, top-3 inputs shown inline
  if (r.loadings && r.loadings.length > 0) {
    const tblWrap = el("div", { cls: "screen-pca-loadings-wrap" });
    tblWrap.innerHTML = `<p class="screen-section-desc">Top-3 input loadings per component (by |loading| magnitude).</p>`;
    const table = el("table", { cls: "results-table screen-vif-table" });
    table.innerHTML = `
      <thead><tr>
        <th>Component</th><th>Var %</th><th>Top Inputs</th>
      </tr></thead>
      <tbody>
        ${r.loadings.map(comp => {
          const topStr = comp.top_inputs
            .map(t => `${escHtml(t.col)} <span class="metric-secondary">(${t.loading.toFixed(3)})</span>`)
            .join(" · ");
          return `<tr>
            <td><strong>${escHtml(comp.component)}</strong></td>
            <td>${(comp.variance_ratio * 100).toFixed(1)}%</td>
            <td>${topStr}</td>
          </tr>`;
        }).join("")}
      </tbody>`;
    tblWrap.appendChild(table);
    container.appendChild(tblWrap);
  }

  // Summary line
  const cumLast = r.cumulative_variance[r.cumulative_variance.length - 1];
  const autoNote = r.n_components_auto && r.n_components_auto !== r.n_components_selected
    ? ` (auto-suggestion: ${r.n_components_auto} for ≥90% variance)`
    : "";
  const sumEl = el("p", { cls: "screen-section-desc" });
  sumEl.innerHTML = `<strong>${r.n_components_selected}</strong> component${r.n_components_selected !== 1 ? "s" : ""} ` +
    `explain <strong>${(cumLast * 100).toFixed(1)}%</strong> of total input variance.${escHtml(autoNote)}`;
  container.appendChild(sumEl);

  if (applyBtn) applyBtn.classList.remove("hidden");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _updateApplyBtn(btn) {
  const n = _selected ? _selected.size : 0;
  btn.disabled    = n < 1;
  btn.textContent = n > 0 ? `Apply Selection (${n} inputs) →` : "Apply Selection →";
}
