// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/active_learning.js
// Version: 1.0.1
// Description: Step 13 — Active Learning. Coverage mode (max-min distance)
//              and objective mode (EI / UCB) recommendation panels with design
//              space scatter, recommendation table, CSV export, and history.
// =============================================================================

import { get, post } from "../api.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { showError, showSuccess } from "../notifications.js";
import { registerPrimer } from "../learning_mode.js";
import { el, clearEl } from "../utils.js";
import { renderDesignSpaceScatter } from "../charts.js";

// ── Module state ──────────────────────────────────────────────────────────────

let _lastResult      = null;
let _activeMode      = "coverage";   // "coverage" | "objective"
let _axisX           = 0;
let _axisY           = 1;

// ── Public entry point ────────────────────────────────────────────────────────

export async function initActiveLearning(containerEl) {
  clearEl(containerEl);
  showSpinner(containerEl);

  const resultsResp = await get("/api/model/results");
  hideSpinner(containerEl);

  if (!resultsResp.success) {
    containerEl.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Step 13 — Active Learning</h2>
      </div>
      <p style="color:var(--color-text-muted);padding:var(--space-4) 0;">
        No trained model. Complete Step 8 — Model first.
      </p>`;
    return;
  }

  const results    = resultsResp.results;
  const inputCols  = results.input_columns;
  const outputCols = results.output_columns;
  const modelType  = results.model_type;
  const hasUQ      = modelType === "gpr" || modelType === "rf";

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Step 13 — Active Learning</h2>
    <p class="section-desc">Get recommendations for where to run your next simulations.</p>
  `;
  containerEl.appendChild(header);
  registerPrimer("active_learning", header, "What is active learning?", `
    <p><strong>Active learning</strong> uses the trained surrogate to recommend the
    most informative new simulation points — so each new run improves the model as
    much as possible.</p>
    <p><strong>Coverage mode</strong> finds points in unexplored regions of the
    design space, maximising the minimum distance to any existing training sample.
    Use this when you want better coverage regardless of the output behaviour.</p>
    <p><strong>Objective mode</strong> uses an acquisition function to balance
    <em>exploitation</em> (run near the predicted optimum) with
    <em>exploration</em> (run where uncertainty is high).
    <strong>EI</strong> (Expected Improvement) automatically balances both.
    <strong>UCB</strong> (Upper Confidence Bound) lets you tune the balance with κ.</p>
  `);

  // ── Mode tabs ────────────────────────────────────────────────────────────────
  const tabs = el("div", { cls: "al-tabs" });
  const tabCoverage  = el("button", { cls: "al-tab al-tab--active", text: "Coverage" });
  const tabObjective = el("button", {
    cls: `al-tab${hasUQ ? "" : " al-tab--disabled"}`,
    text: hasUQ ? "Objective" : "Objective (GPR/RF only)",
  });
  tabCoverage.dataset.mode  = "coverage";
  tabObjective.dataset.mode = "objective";
  if (!hasUQ) tabObjective.disabled = true;
  tabs.appendChild(tabCoverage);
  tabs.appendChild(tabObjective);
  containerEl.appendChild(tabs);

  // ── Controls panel ────────────────────────────────────────────────────────────
  const controlsDiv = el("div", { cls: "al-controls" });
  containerEl.appendChild(controlsDiv);

  // ── Results area ──────────────────────────────────────────────────────────────
  const resultsDiv = el("div", { id: "al-results" });
  containerEl.appendChild(resultsDiv);

  // ── History ────────────────────────────────────────────────────────────────────
  const historyDiv = el("div", { id: "al-history" });
  containerEl.appendChild(historyDiv);

  // ── Render controls for active mode ──────────────────────────────────────────
  function renderControls() {
    clearEl(controlsDiv);
    if (_activeMode === "coverage") {
      _buildCoverageControls(controlsDiv, inputCols, resultsDiv, historyDiv);
    } else {
      _buildObjectiveControls(controlsDiv, inputCols, outputCols, resultsDiv, historyDiv);
    }
  }

  // Tab switching
  [tabCoverage, tabObjective].forEach(tab => {
    tab.addEventListener("click", () => {
      if (tab.disabled) return;
      _activeMode = tab.dataset.mode;
      tabCoverage.classList.toggle("al-tab--active",  _activeMode === "coverage");
      tabObjective.classList.toggle("al-tab--active", _activeMode === "objective");
      renderControls();
    });
  });

  renderControls();

  // Load history on init
  _loadHistory(historyDiv, inputCols);
}

// ── Coverage controls ─────────────────────────────────────────────────────────

function _buildCoverageControls(container, inputCols, resultsDiv, historyDiv) {
  const row = el("div", { cls: "al-control-row" });

  const nInput = _makeNInput(10);
  row.appendChild(_makeField("Recommendations:", nInput));

  const runBtn = el("button", { cls: "btn btn-primary", text: "Run Coverage →" });
  row.appendChild(runBtn);
  container.appendChild(row);

  runBtn.addEventListener("click", async () => {
    const n = Math.min(Math.max(parseInt(nInput.value) || 10, 1), 50);
    runBtn.disabled = true; runBtn.textContent = "Running…"; showSpinner(runBtn);
    const resp = await post("/api/active/coverage", { n_recommendations: n });
    hideSpinner(runBtn); runBtn.disabled = false; runBtn.textContent = "Run Coverage →";
    if (!resp.success) { showError(resp.message || "Coverage analysis failed."); return; }
    _lastResult = resp;
    _renderResults(resultsDiv, resp, inputCols);
    _loadHistory(historyDiv, inputCols);
  });
}

// ── Objective controls ────────────────────────────────────────────────────────

function _buildObjectiveControls(container, inputCols, outputCols, resultsDiv, historyDiv) {
  const row = el("div", { cls: "al-control-row" });

  // N
  const nInput = _makeNInput(10);
  row.appendChild(_makeField("Recommendations:", nInput));

  // Output
  const outSel = el("select", { cls: "model-config-select" });
  for (const col of outputCols) {
    const opt = document.createElement("option");
    opt.value = col; opt.textContent = col;
    outSel.appendChild(opt);
  }
  row.appendChild(_makeField("Output:", outSel));

  // Direction
  const dirSel = el("select", { cls: "model-config-select" });
  [["minimize", "Minimize"], ["maximize", "Maximize"]].forEach(([v, l]) => {
    const o = document.createElement("option"); o.value = v; o.textContent = l;
    dirSel.appendChild(o);
  });
  row.appendChild(_makeField("Direction:", dirSel));

  // Acquisition
  const acqSel = el("select", { cls: "model-config-select" });
  [["EI", "EI — Expected Improvement"], ["UCB", "UCB — Upper Confidence Bound"]].forEach(([v, l]) => {
    const o = document.createElement("option"); o.value = v; o.textContent = l;
    acqSel.appendChild(o);
  });
  row.appendChild(_makeField("Acquisition:", acqSel));

  // Kappa (UCB only)
  const kappaWrap  = el("div", { cls: "al-field", style: "display:none" });
  const kappaLabel = el("label", { cls: "hyperparam-label", text: "κ (UCB):" });
  const kappaInput = el("input", { cls: "model-config-input", type: "number",
    value: "2", min: "0.1", max: "10", step: "0.1" });
  kappaWrap.appendChild(kappaLabel);
  kappaWrap.appendChild(kappaInput);
  row.appendChild(kappaWrap);

  acqSel.addEventListener("change", () => {
    kappaWrap.style.display = acqSel.value === "UCB" ? "" : "none";
  });

  const runBtn = el("button", { cls: "btn btn-primary", text: "Run Objective →" });
  row.appendChild(runBtn);
  container.appendChild(row);

  runBtn.addEventListener("click", async () => {
    const n     = Math.min(Math.max(parseInt(nInput.value) || 10, 1), 50);
    const kappa = parseFloat(kappaInput.value) || 2.0;
    runBtn.disabled = true; runBtn.textContent = "Running…"; showSpinner(runBtn);
    const resp = await post("/api/active/objective", {
      n_recommendations: n,
      output_col:  outSel.value,
      direction:   dirSel.value,
      acquisition: acqSel.value,
      kappa,
    });
    hideSpinner(runBtn); runBtn.disabled = false; runBtn.textContent = "Run Objective →";
    if (!resp.success) { showError(resp.message || "Objective analysis failed."); return; }
    _lastResult = resp;
    _renderResults(resultsDiv, resp, inputCols);
    _loadHistory(historyDiv, inputCols);
  });
}

// ── Results rendering ─────────────────────────────────────────────────────────

function _renderResults(container, resp, inputCols) {
  clearEl(container);

  const section = el("div", { cls: "interpret-section" });

  // Subtitle
  const subtitle = resp.mode === "coverage"
    ? `Coverage — ${resp.n_recommendations} recommendations · ${resp.n_training} training points`
    : `Objective (${resp.acquisition}, ${resp.direction} ${resp.output_col}) — ${resp.n_recommendations} recommendations`;
  const hdr = el("div", { cls: "section-subheader" });
  hdr.innerHTML = `<h3>Recommendations</h3><p class="section-desc">${subtitle}</p>`;
  section.appendChild(hdr);

  // Scatter plot (with axis selectors if > 2 inputs)
  if (inputCols.length >= 2) {
    const scatterWrap = el("div", { cls: "al-scatter-wrap" });

    if (inputCols.length > 2) {
      const axisRow = el("div", { cls: "al-axis-row" });
      axisRow.appendChild(_makeAxisSelector("X axis:", inputCols, _axisX, (i) => {
        _axisX = i; _rerenderScatter(scatterEl, resp, inputCols);
      }));
      axisRow.appendChild(_makeAxisSelector("Y axis:", inputCols, _axisY, (i) => {
        _axisY = i; _rerenderScatter(scatterEl, resp, inputCols);
      }));
      scatterWrap.appendChild(axisRow);
    }

    const scatterEl = el("div", { cls: "al-scatter-plot" });
    scatterWrap.appendChild(scatterEl);
    section.appendChild(scatterWrap);

    // Build X_train rows for scatter (we have bounds, reconstruct from resp.recommendations context)
    // We need training data — fetch from model results
    _fetchTrainAndRenderScatter(scatterEl, resp, inputCols);
  }

  // Recommendation table
  section.appendChild(_buildRecommendationTable(resp));

  container.appendChild(section);
}

async function _fetchTrainAndRenderScatter(scatterEl, resp, inputCols) {
  const modelResp = await get("/api/model/results");
  if (!modelResp.success) return;

  // We need the raw training X values. Re-fetch from data endpoint.
  const dataResp = await get("/api/data/rows");
  if (!dataResp.success) return;

  const X_train = dataResp.rows.map(row => inputCols.map(col => row[col] ?? 0));
  _rerenderScatter(scatterEl, resp, inputCols, X_train);
}

function _rerenderScatter(scatterEl, resp, inputCols, X_train) {
  const xIdx = Math.min(_axisX, inputCols.length - 1);
  const yIdx = Math.min(_axisY, inputCols.length - 1);
  if (xIdx === yIdx) return;
  renderDesignSpaceScatter(scatterEl, X_train || [], resp.recommendations, inputCols, {
    axisX: xIdx, axisY: yIdx,
  });
  requestAnimationFrame(() => {
    const p = scatterEl.querySelector(".js-plotly-plot");
    if (p) Plotly.Plots.resize(p);
  });
}

function _buildRecommendationTable(resp) {
  const isObjective  = resp.mode === "objective";
  const inputCols    = resp.input_cols;

  // CSV export button
  const csvBtn = el("button", { cls: "btn btn-secondary al-csv-btn", text: "Copy as CSV" });
  csvBtn.addEventListener("click", () => _copyRecsAsCSV(resp));

  const wrap = el("div", { cls: "al-table-wrap" });
  wrap.appendChild(csvBtn);

  const table = el("table", { cls: "results-table al-rec-table" });
  const headCols = ["Rank", ...inputCols, resp.score_label];
  if (isObjective) headCols.push(`Predicted (${resp.output_col})`, "Uncertainty (±)");

  const thead = el("thead");
  const headerRow = el("tr");
  headCols.forEach(h => {
    const th = el("th"); th.textContent = h; headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = el("tbody");
  for (const rec of resp.recommendations) {
    const tr = el("tr");
    _td(tr, rec._rank);
    for (const col of inputCols) _td(tr, _fmt(rec[col]));
    _td(tr, _fmt(rec._score));
    if (isObjective) {
      _td(tr, _fmt(rec._predicted));
      const unc = rec._uncertainty > 0 ? _fmt(rec._uncertainty) : "—";
      _td(tr, unc, "metric-secondary");
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// ── History ───────────────────────────────────────────────────────────────────

async function _loadHistory(container, inputCols) {
  clearEl(container);
  const resp = await get("/api/active/history");
  if (!resp.success || resp.count === 0) return;

  const section = el("div", { cls: "interpret-section" });
  const hdr = el("div", { cls: "section-subheader" });
  hdr.innerHTML = `<h3>History</h3><p class="section-desc">Previous active learning rounds (most recent first).</p>`;
  section.appendChild(hdr);

  for (const [i, entry] of resp.history.entries()) {
    const ts    = new Date(entry.timestamp).toLocaleString();
    const label = entry.mode === "coverage"
      ? `Coverage — ${entry.n_recommendations} recs`
      : `Objective (${entry.acquisition}, ${entry.direction} ${entry.output_col || ""}) — ${entry.n_recommendations} recs`;

    const details = document.createElement("details");
    details.className = "al-history-item";
    if (i === 0) details.open = true;

    const summary = document.createElement("summary");
    summary.className = "al-history-summary";
    summary.textContent = `${label} · ${ts}`;
    details.appendChild(summary);

    const inner = el("div", { cls: "al-history-body" });
    inner.appendChild(_buildRecommendationTable(entry));
    details.appendChild(inner);
    section.appendChild(details);
  }

  container.appendChild(section);
}

// ── Utility helpers ───────────────────────────────────────────────────────────

function _makeNInput(defaultVal) {
  const inp = el("input", { cls: "model-config-input", type: "number",
    value: String(defaultVal), min: "1", max: "50" });
  inp.style.width = "70px";
  return inp;
}

function _makeField(labelText, inputEl) {
  const wrap = el("div", { cls: "al-field" });
  const lbl  = el("label", { cls: "hyperparam-label", text: labelText });
  wrap.appendChild(lbl);
  wrap.appendChild(inputEl);
  return wrap;
}

function _makeAxisSelector(labelText, inputCols, currentIdx, onChange) {
  const wrap = el("div", { cls: "al-field" });
  const lbl  = el("label", { cls: "hyperparam-label", text: labelText });
  const sel  = el("select", { cls: "model-config-select" });
  inputCols.forEach((col, i) => {
    const opt = document.createElement("option");
    opt.value = i; opt.textContent = col;
    if (i === currentIdx) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", () => onChange(parseInt(sel.value)));
  wrap.appendChild(lbl);
  wrap.appendChild(sel);
  return wrap;
}

function _td(tr, text, extraCls) {
  const td = el("td");
  if (extraCls) td.className = extraCls;
  td.textContent = text;
  tr.appendChild(td);
}

function _fmt(val) {
  if (val === null || val === undefined) return "—";
  return typeof val === "number" ? val.toPrecision(5) : String(val);
}

function _copyRecsAsCSV(resp) {
  const cols = ["rank", ...resp.input_cols, "score"];
  if (resp.mode === "objective") cols.push("predicted", "uncertainty");
  const rows = [cols.join(",")];
  for (const rec of resp.recommendations) {
    const vals = [rec._rank, ...resp.input_cols.map(c => rec[c] ?? "")];
    vals.push(rec._score ?? "");
    if (resp.mode === "objective") {
      vals.push(rec._predicted ?? "", rec._uncertainty ?? "");
    }
    rows.push(vals.join(","));
  }
  navigator.clipboard.writeText(rows.join("\n"))
    .then(() => showSuccess("Recommendations copied to clipboard."))
    .catch(() => showError("Copy failed — check browser clipboard permissions."));
}
