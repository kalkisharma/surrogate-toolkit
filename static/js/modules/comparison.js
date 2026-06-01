// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/comparison.js
// Version: 1.0.0
// Description: Step 14 — Multi-Dataset Comparison panel.
//              Side-by-side metrics, bias analysis (Δ = B − A),
//              prediction scatter, and linear error model fitting.
// =============================================================================

import { get, post } from "../api.js";
import { showError, showWarning } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { el, clearEl, escHtml } from "../utils.js";
import { renderComparisonScatter, renderBiasHistogram } from "../charts.js";
import { registerPrimer } from "../learning_mode.js";

// ── Module state ──────────────────────────────────────────────────────────────
let _lastResp = null;
let _keyA     = null;
let _keyB     = null;

// ── Public entry point ────────────────────────────────────────────────────────

export async function initComparison(containerEl) {
  clearEl(containerEl);

  // Try loading cached result first
  const cached = await get("/api/comparison/results");
  if (cached.success) {
    _lastResp = cached;
    _keyA     = cached.dataset_a;
    _keyB     = cached.dataset_b;
  }

  // Always fetch current status (dataset list may have changed)
  showSpinner(containerEl);
  const statusResp = await get("/api/comparison/status");
  hideSpinner(containerEl);

  if (!statusResp.success) {
    _renderNoDataGate(containerEl);
    return;
  }

  const datasets   = statusResp.datasets || [];
  const withModels = datasets.filter(d => d.has_model);

  if (datasets.length < 2 || withModels.length < 2) {
    _renderPrereqChecklist(containerEl, datasets);
    return;
  }

  _renderPanel(containerEl, datasets, withModels);
}

// ── Panel layout ──────────────────────────────────────────────────────────────

function _renderPanel(containerEl, datasets, withModels) {
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Step 14 — Multi-Dataset Comparison</h2>
    <p class="section-desc">Compare two trained surrogates side-by-side: accuracy metrics, prediction agreement, and bias (Δ = B − A).</p>
  `;
  containerEl.appendChild(header);

  registerPrimer("comparison", header, "What does this comparison show?", `
    <p><strong>Side-by-side metrics</strong> — R², RMSE, and MAE for each model on its own test set.
       A lower RMSE or higher R² means that model fits its data better.</p>
    <p><strong>Prediction scatter</strong> — both models evaluated at the same LHS-sampled input points.
       Points near the 1:1 diagonal mean the models agree; scatter off the diagonal reveals disagreement.</p>
    <p><strong>Bias histogram (Δ = B − A)</strong> — distribution of Model B minus Model A predictions.
       A mean near zero means the models are globally consistent.
       A non-zero mean indicates systematic bias.</p>
    <p><strong>Error model</strong> — linear regression fit to Δ as a function of inputs.
       A high R² means the bias is spatially structured (concentrated in a particular region of the input space).</p>
  `);

  // ── Selector row ──────────────────────────────────────────────────────────
  const selectorCard = el("div", { cls: "card comparison-selector-card" });
  selectorCard.innerHTML = `<h3 class="section-subheader-inline">Select datasets to compare</h3>`;

  const selRow = el("div", { cls: "comparison-sel-row" });

  // Dataset A selector
  const selAWrap = el("div", { cls: "comparison-sel-group" });
  const selALbl  = el("label", { cls: "hyperparam-label", for: "cmp-sel-a", text: "Model A" });
  const selA     = el("select", { cls: "model-config-select", id: "cmp-sel-a" });
  withModels.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.key;
    opt.textContent = `${d.filename} (${d.model_type || "?"})`;
    if (d.key === _keyA || (!_keyA && d.active)) opt.selected = true;
    selA.appendChild(opt);
  });
  selAWrap.appendChild(selALbl);
  selAWrap.appendChild(selA);

  // Dataset B selector
  const selBWrap = el("div", { cls: "comparison-sel-group" });
  const selBLbl  = el("label", { cls: "hyperparam-label", for: "cmp-sel-b", text: "Model B" });
  const selB     = el("select", { cls: "model-config-select", id: "cmp-sel-b" });
  withModels.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.key;
    opt.textContent = `${d.filename} (${d.model_type || "?"})`;
    if (d.key === _keyB) opt.selected = true;
    selB.appendChild(opt);
  });
  // Default B to second dataset
  if (!_keyB && selB.options.length > 1) selB.selectedIndex = 1;

  selBWrap.appendChild(selBLbl);
  selBWrap.appendChild(selB);

  // n_samples selector
  const nWrap = el("div", { cls: "comparison-sel-group" });
  const nLbl  = el("label", { cls: "hyperparam-label", for: "cmp-n-samples", text: "LHS samples" });
  const nSel  = el("select", { cls: "model-config-select", id: "cmp-n-samples" });
  [100, 200, 500, 1000].forEach(n => {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = n.toLocaleString();
    if (n === 200) opt.selected = true;
    nSel.appendChild(opt);
  });
  nWrap.appendChild(nLbl);
  nWrap.appendChild(nSel);

  const runBtn = el("button", { cls: "btn btn-primary", id: "cmp-run-btn", text: "Compare →" });

  selRow.appendChild(selAWrap);
  selRow.appendChild(selBWrap);
  selRow.appendChild(nWrap);
  selRow.appendChild(runBtn);
  selectorCard.appendChild(selRow);
  containerEl.appendChild(selectorCard);

  // ── Results container ─────────────────────────────────────────────────────
  const resultsDiv = el("div", { id: "cmp-results" });
  containerEl.appendChild(resultsDiv);

  // Render cached result if available
  if (_lastResp) {
    _renderResults(resultsDiv, _lastResp);
  }

  // ── Run handler ───────────────────────────────────────────────────────────
  runBtn.addEventListener("click", async () => {
    const a = selA.value;
    const b = selB.value;
    if (a === b) {
      showWarning("Select two different datasets to compare.");
      return;
    }

    runBtn.disabled   = true;
    runBtn.textContent = "Running…";
    showSpinner(runBtn);

    const resp = await post("/api/comparison/run", {
      dataset_a: a,
      dataset_b: b,
      n_samples: parseInt(nSel.value, 10),
    });

    hideSpinner(runBtn);
    runBtn.disabled   = false;
    runBtn.textContent = "Compare →";

    if (!resp.success) {
      showError(resp.message || "Comparison failed.");
      return;
    }

    _keyA     = a;
    _keyB     = b;
    _lastResp = resp;
    _renderResults(resultsDiv, resp);
  });
}

// ── Results rendering ─────────────────────────────────────────────────────────

function _renderResults(container, resp) {
  clearEl(container);

  const labelA = resp.dataset_a;
  const labelB = resp.dataset_b;
  const typeA  = resp.model_type_a ? `(${resp.model_type_a.toUpperCase()})` : "";
  const typeB  = resp.model_type_b ? `(${resp.model_type_b.toUpperCase()})` : "";

  // ── Summary badge row ─────────────────────────────────────────────────────
  const badge = el("div", { cls: "cmp-summary-badge-row" });
  badge.innerHTML = `
    <span class="metric-badge metric-badge--neutral">${resp.common_outputs.length} common output${resp.common_outputs.length !== 1 ? "s" : ""}</span>
    <span class="metric-badge metric-badge--neutral">${resp.common_inputs.length} common input${resp.common_inputs.length !== 1 ? "s" : ""}</span>
    <span class="metric-badge metric-badge--neutral">${resp.n_samples.toLocaleString()} LHS samples</span>
  `;
  container.appendChild(badge);

  // ── Metrics table ─────────────────────────────────────────────────────────
  if (Object.keys(resp.metrics_a).length > 0 || Object.keys(resp.metrics_b).length > 0) {
    const metricsSection = el("div", { cls: "cmp-section" });
    metricsSection.innerHTML = `
      <div class="section-subheader">
        <h3>Test Metrics (each model on its own test set)</h3>
        <p class="section-desc">Metrics come from each model's held-out test set, not the LHS samples.</p>
      </div>
    `;
    metricsSection.appendChild(_buildMetricsTable(resp, labelA, typeA, labelB, typeB));
    container.appendChild(metricsSection);
  }

  // ── Per-output scatter + bias ─────────────────────────────────────────────
  for (const outCol of resp.common_outputs) {
    const outData = resp.outputs[outCol];
    if (!outData) continue;

    const section = el("div", { cls: "cmp-section" });
    const hdr     = el("div", { cls: "section-subheader" });
    hdr.innerHTML = `<h3>${escHtml(outCol)}</h3>${_biasSummaryHtml(outData)}`;
    section.appendChild(hdr);

    const chartRow = el("div", { cls: "cmp-chart-row" });

    // Scatter
    const scatterEl = el("div", { cls: "cmp-chart-cell" });
    chartRow.appendChild(scatterEl);
    renderComparisonScatter(scatterEl, outData.y_a, outData.y_b, outCol,
      `${labelA} ${typeA}`, `${labelB} ${typeB}`);

    // Bias histogram
    const histEl = el("div", { cls: "cmp-chart-cell" });
    chartRow.appendChild(histEl);
    renderBiasHistogram(histEl, outData.delta, outCol);

    section.appendChild(chartRow);
    container.appendChild(section);
  }

  // ── Error model section ───────────────────────────────────────────────────
  if (resp.common_outputs.length > 0) {
    const errSection = el("div", { cls: "cmp-section" });
    errSection.innerHTML = `
      <div class="section-subheader">
        <h3>Bias Error Model</h3>
        <p class="section-desc">Fit a linear model to Δ(output) as a function of common inputs.
          A high R² means the bias is spatially structured — concentrated in a specific input region.</p>
      </div>
    `;

    const errControlRow = el("div", { cls: "comparison-sel-row" });
    const errSelWrap    = el("div", { cls: "comparison-sel-group" });
    const errLbl        = el("label", { cls: "hyperparam-label", for: "cmp-err-out", text: "Output" });
    const errSel        = el("select", { cls: "model-config-select", id: "cmp-err-out" });
    for (const col of resp.common_outputs) {
      const opt = document.createElement("option");
      opt.value = col;
      opt.textContent = col;
      errSel.appendChild(opt);
    }
    errSelWrap.appendChild(errLbl);
    errSelWrap.appendChild(errSel);

    const errBtn = el("button", { cls: "btn btn-secondary", text: "Fit Error Model" });
    errControlRow.appendChild(errSelWrap);
    errControlRow.appendChild(errBtn);
    errSection.appendChild(errControlRow);

    const errResults = el("div", { id: "cmp-err-results", cls: "cmp-err-results" });
    errSection.appendChild(errResults);

    errBtn.addEventListener("click", async () => {
      errBtn.disabled   = true;
      errBtn.textContent = "Fitting…";
      showSpinner(errBtn);

      const r = await post("/api/comparison/error_model", { output_col: errSel.value });

      hideSpinner(errBtn);
      errBtn.disabled   = false;
      errBtn.textContent = "Fit Error Model";

      if (!r.success) {
        showError(r.message || "Error model fitting failed.");
        return;
      }

      _renderErrorModel(errResults, r);
    });

    container.appendChild(errSection);
  }

  // Two-frame resize
  requestAnimationFrame(() => {
    container.querySelectorAll(".js-plotly-plot").forEach(p => {
      // eslint-disable-next-line no-undef
      Plotly.Plots.resize(p);
    });
  });
}

// ── Sub-renderers ──────────────────────────────────────────────────────────────

function _buildMetricsTable(resp, labelA, typeA, labelB, typeB) {
  const wrap = el("div", { cls: "results-table-wrap" });
  const cols = resp.common_outputs.filter(c => resp.metrics_a[c] || resp.metrics_b[c]);

  if (cols.length === 0) {
    wrap.innerHTML = `<p class="section-desc">No test metrics available.</p>`;
    return wrap;
  }

  let rows = "";
  for (const col of cols) {
    const ma = resp.metrics_a[col] || {};
    const mb = resp.metrics_b[col] || {};

    const r2A = ma.r2  != null ? ma.r2.toFixed(4)   : "—";
    const r2B = mb.r2  != null ? mb.r2.toFixed(4)   : "—";
    const rmA = ma.rmse != null ? ma.rmse.toFixed(4) : "—";
    const rmB = mb.rmse != null ? mb.rmse.toFixed(4) : "—";
    const maA = ma.mae  != null ? ma.mae.toFixed(4)  : "—";
    const maB = mb.mae  != null ? mb.mae.toFixed(4)  : "—";

    // Highlight winner (higher R² is better; lower RMSE is better)
    const r2Cls   = (ma.r2  != null && mb.r2  != null) ? (ma.r2  >= mb.r2  ? "cmp-winner" : "") : "";
    const r2ClsB  = (ma.r2  != null && mb.r2  != null) ? (mb.r2  >  ma.r2  ? "cmp-winner" : "") : "";
    const rmCls   = (ma.rmse != null && mb.rmse != null) ? (ma.rmse <= mb.rmse ? "cmp-winner" : "") : "";
    const rmClsB  = (ma.rmse != null && mb.rmse != null) ? (mb.rmse <  ma.rmse ? "cmp-winner" : "") : "";

    rows += `
      <tr>
        <td>${escHtml(col)}</td>
        <td class="${r2Cls}">${r2A}</td><td class="${r2ClsB}">${r2B}</td>
        <td class="${rmCls}">${rmA}</td><td class="${rmClsB}">${rmB}</td>
        <td>${maA}</td><td>${maB}</td>
      </tr>`;
  }

  wrap.innerHTML = `
    <table class="results-table cmp-metrics-table">
      <thead>
        <tr>
          <th rowspan="2">Output</th>
          <th colspan="2">R²</th>
          <th colspan="2">RMSE</th>
          <th colspan="2">MAE</th>
        </tr>
        <tr>
          <th>A ${typeA}</th><th>B ${typeB}</th>
          <th>A ${typeA}</th><th>B ${typeB}</th>
          <th>A ${typeA}</th><th>B ${typeB}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="cmp-table-note">Bold = better performer. Metrics from each model's own test set.</p>
  `;
  return wrap;
}

function _biasSummaryHtml(outData) {
  const mean     = outData.delta_mean.toFixed(4);
  const std      = outData.delta_std.toFixed(4);
  const pct      = outData.pct_bias != null ? ` (${outData.pct_bias.toFixed(1)}% of mean A)` : "";
  const sign     = outData.delta_mean >= 0 ? "+" : "";
  const badgeCls = Math.abs(outData.delta_mean) < outData.delta_std * 0.5
    ? "metric-badge--good"
    : (Math.abs(outData.delta_mean) < outData.delta_std ? "metric-badge--caution" : "metric-badge--warn");
  return `<p class="section-desc">
    Mean Δ = <span class="${badgeCls.replace("metric-badge--", "cmp-bias-")} cmp-bias-inline">${sign}${mean}${pct}</span>
    &nbsp;·&nbsp; σ = ${std}
  </p>`;
}

function _renderErrorModel(container, resp) {
  clearEl(container);

  const r2Cls = resp.r2 > 0.5 ? "metric-badge--warn" : resp.r2 > 0.2 ? "metric-badge--caution" : "metric-badge--good";
  const r2Msg = resp.r2 > 0.5
    ? "Bias is spatially structured — Model B differs from A more in certain input regions."
    : resp.r2 > 0.2
      ? "Weak spatial structure — bias varies somewhat across the input space."
      : "Bias is spatially uniform — the models disagree by roughly the same amount everywhere.";

  let coefRows = "";
  const sortedCoefs = Object.entries(resp.coefficients).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  for (const [col, coef] of sortedCoefs) {
    const sign = coef >= 0 ? "+" : "";
    coefRows += `<tr><td>${escHtml(col)}</td><td>${sign}${coef.toFixed(5)}</td></tr>`;
  }

  container.innerHTML = `
    <div class="cmp-err-summary">
      <span class="metric-badge ${r2Cls}">R² = ${resp.r2.toFixed(3)}</span>
      <span class="cmp-err-msg">${r2Msg}</span>
    </div>
    <table class="results-table cmp-coef-table">
      <thead><tr><th>Input</th><th>Coefficient (effect on Δ)</th></tr></thead>
      <tbody>
        ${coefRows}
        <tr class="cmp-intercept-row"><td><em>Intercept</em></td><td>${resp.intercept >= 0 ? "+" : ""}${resp.intercept.toFixed(5)}</td></tr>
      </tbody>
    </table>
  `;
}

// ── Gate ──────────────────────────────────────────────────────────────────────

function _renderPrereqChecklist(containerEl, datasets) {
  const hasTwo   = datasets.length >= 2;
  const modelled = datasets.filter(d => d.has_model);

  const row = (done, label) => `
    <div class="compare-prereq-row">
      <span class="compare-prereq-icon ${done ? "compare-prereq-icon--done" : ""}">${done ? "✓" : "✗"}</span>
      <span class="compare-prereq-label ${done ? "" : "compare-prereq-label--pending"}">${label}</span>
    </div>`;

  const datasetRows = hasTwo
    ? datasets.map(d => row(d.has_model,
        `<strong>${escHtml(d.filename)}</strong> — ${d.has_model ? "model trained" : "no trained model yet"}`
      )).join("")
    : row(false, "Load a second dataset via <strong>+ Load</strong> in the header");

  containerEl.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">Step 14 — Multi-Dataset Comparison</h2>
    </div>
    <div class="compare-prereq-card">
      <p class="compare-prereq-title">Complete these steps to enable comparison:</p>
      ${row(hasTwo, "Two datasets loaded")}
      ${datasetRows}
    </div>`;
}
