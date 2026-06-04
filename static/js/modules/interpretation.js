// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/interpretation.js
// Version: 1.1.1
// Description: Step 13 — Model Interpretation. Sobol global sensitivity
//              tornado chart + S1/ST table, OAT response curve grid, and
//              prediction uncertainty summary.
// =============================================================================

import { get, post } from "../api.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { showError } from "../notifications.js";
import { registerPrimer } from "../learning_mode.js";
import { el, clearEl } from "../utils.js";
import { renderTornadoChart, renderOATGrid } from "../charts.js";

// ── Module state ──────────────────────────────────────────────────────────────

let _lastResp       = null;
let _selectedOutput = null;

// ── Public entry point ────────────────────────────────────────────────────────

export async function initInterpretation(containerEl) {
  clearEl(containerEl);
  showSpinner(containerEl);

  const resultsResp = await get("/api/model/results");
  hideSpinner(containerEl);

  if (!resultsResp.success) {
    containerEl.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Step 13 — Model Interpretation</h2>
      </div>
      <p style="color:var(--color-text-muted);padding:var(--space-4) 0;">
        No trained model. Complete Step 9 — Model first.
      </p>`;
    return;
  }

  const results    = resultsResp.results;
  const outputCols = results.output_columns;

  // Header + learning-mode primer
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Step 13 — Model Interpretation</h2>
    <p class="section-desc">Understand which inputs drive your outputs and how confident the model is.</p>
  `;
  containerEl.appendChild(header);
  registerPrimer("interpretation", header, "What does sensitivity analysis tell me?", `
    <p><strong>Sobol sensitivity indices</strong> measure how much of the output variance
    is explained by each input.</p>
    <p><strong>S₁ (First-order index)</strong> — fraction of variance due to that input alone.</p>
    <p><strong>Sₜ (Total-order index)</strong> — includes interactions with all other inputs.
    Always ≥ S₁.</p>
    <p>A high Sₜ means the input is important (directly or through interactions).
    A low S₁ but high Sₜ means the input mainly matters through its interactions with others.</p>
    <p><strong>OAT curves</strong> show how the output changes when you vary one input while
    holding all others at their median value.</p>
  `);

  // Output selector — shown only for multi-output models
  if (!_selectedOutput || !outputCols.includes(_selectedOutput)) {
    _selectedOutput = outputCols[0];
  }

  const controlRow = el("div", { cls: "interpret-control-row" });
  if (outputCols.length > 1) {
    const lbl = el("label", { cls: "hyperparam-label" });
    lbl.textContent = "Analyze output:";
    lbl.setAttribute("for", "interpret-output-select");
    const sel = el("select", { cls: "model-config-select", id: "interpret-output-select" });
    for (const col of outputCols) {
      const opt = document.createElement("option");
      opt.value       = col;
      opt.textContent = col;
      if (col === _selectedOutput) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => { _selectedOutput = sel.value; });
    controlRow.appendChild(lbl);
    controlRow.appendChild(sel);
  }

  const analyzeBtn = el("button", { cls: "btn btn-primary", id: "interpret-analyze-btn" });
  analyzeBtn.textContent = "Analyze →";
  controlRow.appendChild(analyzeBtn);
  containerEl.appendChild(controlRow);

  const resultsDiv = el("div", { id: "interpret-results" });
  containerEl.appendChild(resultsDiv);

  // Load cached result if available
  const cached = await get(`/api/model/interpret?output_col=${encodeURIComponent(_selectedOutput)}`);
  if (cached.success) {
    _lastResp = cached;
    _renderInterpResults(resultsDiv, cached);
  }

  analyzeBtn.addEventListener("click", async () => {
    analyzeBtn.disabled    = true;
    analyzeBtn.textContent = "Analyzing…";
    showSpinner(analyzeBtn);

    const resp = await post("/api/model/interpret", {
      output_col: _selectedOutput,
      n_samples:  512,
    });

    hideSpinner(analyzeBtn);
    analyzeBtn.disabled    = false;
    analyzeBtn.textContent = "Analyze →";

    if (!resp.success) {
      showError(resp.message || "Analysis failed.");
      return;
    }
    _lastResp = resp;
    _renderInterpResults(resultsDiv, resp);
  });
}

// ── Internal renderers ────────────────────────────────────────────────────────

function _renderInterpResults(container, resp) {
  clearEl(container);

  // Sort inputs by ST descending — shared order for both sections.
  const sortedCols = [...resp.input_cols].sort(
    (a, b) => (resp.sensitivity.ST[b] ?? 0) - (resp.sensitivity.ST[a] ?? 0)
  );

  _renderSensitivitySection(container, resp, sortedCols);
  _renderOATSection(container, resp, sortedCols);
  _renderUncertaintySection(container, resp);

  requestAnimationFrame(() => {
    container.querySelectorAll(".js-plotly-plot").forEach(p => Plotly.Plots.resize(p));
  });
}

function _renderSensitivitySection(container, resp, sortedCols) {
  const section = el("div", { cls: "interpret-section" });

  const hdr = el("div", { cls: "section-subheader" });
  hdr.innerHTML = `
    <h3>Sensitivity Analysis — ${resp.output_col}</h3>
    <p class="section-desc">Sobol indices · ${resp.sensitivity.n_evaluations.toLocaleString()} model evaluations</p>
  `;
  section.appendChild(hdr);

  const tornadoEl = el("div", { cls: "interpret-chart-wrap" });
  section.appendChild(tornadoEl);
  renderTornadoChart(tornadoEl, sortedCols, resp.sensitivity.ST, resp.sensitivity.S1);
  requestAnimationFrame(() => {
    const p = tornadoEl.querySelector(".js-plotly-plot");
    if (p) Plotly.Plots.resize(p);
  });

  section.appendChild(_buildSensitivityTable(resp.sensitivity, sortedCols));
  container.appendChild(section);
}

function _buildSensitivityTable(sensitivity, sortedCols) {
  const wrap = el("div", { cls: "sensitivity-table-wrap" });
  wrap.innerHTML = `
    <table class="results-table sensitivity-table">
      <thead><tr>
        <th>Input</th><th>S₁</th><th>S₁ ±</th><th>Sₜ</th><th>Sₜ ±</th>
      </tr></thead>
      <tbody>
        ${sortedCols.map(col => `
          <tr>
            <td>${col}</td>
            <td>${(sensitivity.S1[col] ?? 0).toFixed(3)}</td>
            <td class="metric-secondary">±${(sensitivity.S1_conf[col] ?? 0).toFixed(3)}</td>
            <td><strong>${(sensitivity.ST[col] ?? 0).toFixed(3)}</strong></td>
            <td class="metric-secondary">±${(sensitivity.ST_conf[col] ?? 0).toFixed(3)}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
  return wrap;
}

function _renderOATSection(container, resp, sortedCols) {
  const section = el("div", { cls: "interpret-section" });
  section.innerHTML = `
    <div class="section-subheader">
      <h3>One-at-a-Time Response — ${resp.output_col}</h3>
      <p class="section-desc">Each input varied min→max; all others held at training median.
      Dashed line = nominal value.</p>
    </div>`;
  const grid = el("div", { cls: "norm-hist-grid" });
  section.appendChild(grid);
  renderOATGrid(grid, resp.oat, sortedCols, { outputCol: resp.output_col });
  requestAnimationFrame(() => {
    grid.querySelectorAll(".js-plotly-plot").forEach(p => Plotly.Plots.resize(p));
  });
  container.appendChild(section);
}

function _renderUncertaintySection(container, resp) {
  const section = el("div", { cls: "interpret-section" });
  section.innerHTML = `
    <div class="section-subheader">
      <h3>Prediction Uncertainty — ${resp.output_col}</h3>
    </div>`;

  let content = "";
  const unc = resp.uncertainty;

  if (resp.model_type === "gpr") {
    content = `<p class="interpret-unc-note">GPR provides native uncertainty estimates.
      95% confidence intervals are shown as error bars on the parity plot in
      <strong>Step 10 — Training Results</strong>.</p>`;
  } else if (unc && unc.method === "rf_tree_variance") {
    const widths   = unc.ci_upper.map((u, i) => u - unc.ci_lower[i]);
    const meanWidth = widths.reduce((a, b) => a + b, 0) / widths.length;
    content = `<p class="interpret-unc-note">Random Forest uncertainty from tree variance (95% CI).</p>
      <p class="interpret-unc-note">Mean CI width on test set:
      <strong>${meanWidth.toFixed(4)}</strong></p>`;
  } else {
    content = `<p class="interpret-unc-note">Linear models do not provide native uncertainty
      estimates. Consider using GPR or Random Forest if prediction intervals are required.</p>`;
  }

  section.innerHTML += content;
  container.appendChild(section);
}
