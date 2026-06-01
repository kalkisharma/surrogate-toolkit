// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/optimization.js
// Version: 1.0.0
// Description: Step 11 — Design Space Optimization. Single-objective via
//              differential_evolution; multi-objective via NSGA-II (pymoo).
// =============================================================================

import { get, post } from "../api.js";
import { registerPrimer } from "../learning_mode.js";
import { showError } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { renderParetoFront } from "../charts.js";
import { el, clearEl, escHtml } from "../utils.js";
import { getAvailableCores } from "../state.js";

export async function initOptimization(containerEl) {
  clearEl(containerEl);

  // ── Gate: require trained model ──────────────────────────────────────────
  const resultsResp = await get("/api/model/results");
  if (!resultsResp.success || !resultsResp.results) {
    containerEl.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Step 11 — Design Space Optimization</h2>
      </div>
      <p style="color:var(--color-text-muted);padding:var(--space-4) 0;">
        No trained model. Complete Step 8 — Model first.
      </p>`;
    return;
  }

  const results    = resultsResp.results;
  const inputCols  = results.input_columns  || [];
  const outputCols = results.output_columns || [];
  // Prefer original-space bounds (added in v3.4.5); fall back to normalized for
  // sessions that pre-date that field.
  const inputMins  = results.input_orig_mins ?? results.input_mins ?? {};
  const inputMaxs  = results.input_orig_maxs ?? results.input_maxs ?? {};

  // ── Header ───────────────────────────────────────────────────────────────
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `<h2 class="section-title">Step 11 — Design Space Optimization</h2>
    <p class="section-desc">Find the inputs that minimize or maximize a surrogate output. Single-objective uses differential evolution; multi-objective uses NSGA-II to find the Pareto front.</p>`;
  containerEl.appendChild(header);

  registerPrimer("optimization", header, "What is surrogate optimization?", `
    <p>Surrogate optimization uses your trained model as a fast proxy for expensive simulations, so the optimizer can evaluate thousands of candidate designs in seconds instead of running a full simulation each time.</p>
    <p><strong>Single-objective:</strong> Finds the one design that best minimizes or maximizes a single output (e.g., minimize drag). Uses differential evolution — a global search that avoids local minima.</p>
    <p><strong>Multi-objective:</strong> When two or more outputs trade off against each other (e.g., lower drag vs. higher lift), there is no single "best" solution — instead there is a <em>Pareto front</em>: the set of solutions where improving one objective requires sacrificing another. NSGA-II discovers this front in one run.</p>
    <p>Input bounds default to your training data range. You can tighten them to focus the search on a feasible flight envelope or manufacturing constraint.</p>
  `);

  // ── Cores prompt ─────────────────────────────────────────────────────────
  const avail = getAvailableCores() || "?";
  const current = parseInt(document.getElementById("cores-input")?.value || "1", 10);
  const optCoresPrompt = el("div", { cls: "cores-prompt" });
  optCoresPrompt.innerHTML = `
    <span class="cores-prompt__icon">⚡</span>
    <div class="cores-prompt__body">
      <p class="cores-prompt__title">Optimization — parallel candidate evaluation</p>
      <p class="cores-prompt__line">Ideal: <strong>4–8 cores</strong> — each candidate solution is evaluated against the surrogate in parallel per generation</p>
      <p class="cores-prompt__line">Currently set to <strong>${current}</strong> &nbsp;·&nbsp; <strong>${avail}</strong> available on this machine</p>
    </div>`;
  containerEl.appendChild(optCoresPrompt);

  // ── Tabs ─────────────────────────────────────────────────────────────────
  const tabBar = el("div", { cls: "al-tab-bar" });
  const tabSingle = el("button", { cls: "al-tab al-tab--active", text: "Single-Objective" });
  const tabMulti  = el("button", { cls: "al-tab", text: "Multi-Objective" });
  tabBar.appendChild(tabSingle);
  tabBar.appendChild(tabMulti);
  containerEl.appendChild(tabBar);

  const panelSingle = el("div", { cls: "opt-tab-panel" });
  const panelMulti  = el("div", { cls: "opt-tab-panel hidden" });
  containerEl.appendChild(panelSingle);
  containerEl.appendChild(panelMulti);

  tabSingle.addEventListener("click", () => _switchTab(tabSingle, tabMulti, panelSingle, panelMulti));
  tabMulti.addEventListener("click",  () => _switchTab(tabMulti, tabSingle, panelMulti, panelSingle));

  // ── Single-objective panel ───────────────────────────────────────────────
  _buildSinglePanel(panelSingle, inputCols, outputCols, inputMins, inputMaxs);

  // ── Multi-objective panel ────────────────────────────────────────────────
  _buildMultiPanel(panelMulti, inputCols, outputCols, inputMins, inputMaxs);
}


// ── Single-objective panel ────────────────────────────────────────────────────

function _buildSinglePanel(container, inputCols, outputCols, inputMins, inputMaxs) {
  // Objective row
  const objCard = el("div", { cls: "card opt-card" });
  objCard.innerHTML = `<h3 class="section-subtitle">Objective</h3>`;
  const objRow = el("div", { cls: "al-control-row" });

  const outField = el("div", { cls: "al-field" });
  const outLbl   = el("label", { cls: "hyperparam-label", text: "Output:" });
  const outSel   = el("select", { cls: "model-config-select", id: "opt-s-output" });
  for (const col of outputCols) {
    const opt = document.createElement("option");
    opt.value = col; opt.textContent = col;
    outSel.appendChild(opt);
  }
  outField.appendChild(outLbl);
  outField.appendChild(outSel);

  const dirField = el("div", { cls: "al-field" });
  const dirLbl   = el("label", { cls: "hyperparam-label", text: "Direction:" });
  const dirSel   = el("select", { cls: "model-config-select", id: "opt-s-direction" });
  ["minimize", "maximize"].forEach(d => {
    const o = document.createElement("option");
    o.value = d; o.textContent = d.charAt(0).toUpperCase() + d.slice(1);
    dirSel.appendChild(o);
  });
  dirField.appendChild(dirLbl);
  dirField.appendChild(dirSel);

  objRow.appendChild(outField);
  objRow.appendChild(dirField);
  objCard.appendChild(objRow);
  container.appendChild(objCard);

  // Bounds table
  const boundsCard = el("div", { cls: "card opt-card" });
  boundsCard.innerHTML = `<h3 class="section-subtitle">Input Bounds <span style="font-weight:400;color:var(--color-text-muted);font-size:var(--text-sm);">(defaults: training range)</span></h3>`;
  boundsCard.appendChild(_buildBoundsTable("s", inputCols, inputMins, inputMaxs));
  container.appendChild(boundsCard);

  // Constraints
  const constrCard = el("div", { cls: "card opt-card" });
  constrCard.innerHTML = `<h3 class="section-subtitle">Output Constraints <span style="font-weight:400;color:var(--color-text-muted);font-size:var(--text-sm);">(optional)</span></h3>`;
  const constrList = el("div", { id: "opt-s-constr-list" });
  const addConstrBtn = el("button", { cls: "btn btn-secondary opt-add-constr-btn", text: "+ Add Constraint" });
  addConstrBtn.addEventListener("click", () => _addConstraintRow(constrList, outputCols));
  constrCard.appendChild(constrList);
  constrCard.appendChild(addConstrBtn);
  container.appendChild(constrCard);

  // Run button + results
  const runBtn = el("button", { cls: "btn btn-primary opt-run-btn", id: "opt-s-run-btn", text: "Run Optimizer →" });
  container.appendChild(runBtn);
  const resultsDiv = el("div", { id: "opt-s-results" });
  container.appendChild(resultsDiv);

  runBtn.addEventListener("click", async () => {
    const bounds = _readBoundsTable("s", inputCols);
    const constraints = _readConstraints("opt-s-constr-list");

    runBtn.disabled = true;
    runBtn.textContent = "Optimizing…";
    showSpinner(runBtn);

    const resp = await post("/api/optimize/single", {
      output_col:   outSel.value,
      direction:    dirSel.value,
      bounds,
      constraints,
      n_population: 50,
      max_iter:     200,
    });

    hideSpinner(runBtn);
    runBtn.disabled = false;
    runBtn.textContent = "Run Optimizer →";

    if (!resp.success) {
      showError(resp.message || "Optimization failed.");
      return;
    }
    _renderSingleResults(resultsDiv, resp);
  });
}


// ── Multi-objective panel ─────────────────────────────────────────────────────

function _buildMultiPanel(container, inputCols, outputCols, inputMins, inputMaxs) {
  if (outputCols.length < 2) {
    container.innerHTML = `<p style="color:var(--color-text-muted);padding:var(--space-4) 0;">Multi-objective optimization requires at least 2 output columns. Your model has only 1.</p>`;
    return;
  }

  // Objectives table
  const objCard = el("div", { cls: "card opt-card" });
  objCard.innerHTML = `<h3 class="section-subtitle">Objectives</h3>`;
  const objTable = document.createElement("table");
  objTable.className = "results-table opt-obj-table";
  objTable.innerHTML = `<thead><tr><th>Output</th><th>Direction</th></tr></thead>`;
  const objTbody = document.createElement("tbody");
  for (const col of outputCols) {
    const tr = document.createElement("tr");
    const tdCol = document.createElement("td");
    tdCol.textContent = col;
    const tdDir = document.createElement("td");
    const sel = el("select", { cls: "model-config-select" });
    sel.dataset.col = col;
    sel.id = `opt-m-dir-${col}`;
    ["minimize", "maximize"].forEach(d => {
      const o = document.createElement("option");
      o.value = d; o.textContent = d.charAt(0).toUpperCase() + d.slice(1);
      sel.appendChild(o);
    });
    tdDir.appendChild(sel);
    tr.appendChild(tdCol);
    tr.appendChild(tdDir);
    objTbody.appendChild(tr);
  }
  objTable.appendChild(objTbody);
  objCard.appendChild(objTable);
  container.appendChild(objCard);

  // Bounds table
  const boundsCard = el("div", { cls: "card opt-card" });
  boundsCard.innerHTML = `<h3 class="section-subtitle">Input Bounds</h3>`;
  boundsCard.appendChild(_buildBoundsTable("m", inputCols, inputMins, inputMaxs));
  container.appendChild(boundsCard);

  // Algorithm settings
  const algoCard = el("div", { cls: "card opt-card" });
  algoCard.innerHTML = `<h3 class="section-subtitle">Algorithm Settings</h3>`;
  const algoRow = el("div", { cls: "al-control-row" });
  algoRow.innerHTML = `
    <div class="al-field">
      <label class="hyperparam-label" for="opt-m-pop">Population size:</label>
      <input type="number" class="model-config-input" id="opt-m-pop" value="100" min="20" max="500" step="10">
    </div>
    <div class="al-field">
      <label class="hyperparam-label" for="opt-m-gen">Generations:</label>
      <input type="number" class="model-config-input" id="opt-m-gen" value="100" min="10" max="500" step="10">
    </div>`;
  algoCard.appendChild(algoRow);
  container.appendChild(algoCard);

  // Run + results
  const runBtn = el("button", { cls: "btn btn-primary opt-run-btn", id: "opt-m-run-btn", text: "Run NSGA-II →" });
  container.appendChild(runBtn);
  const resultsDiv = el("div", { id: "opt-m-results" });
  container.appendChild(resultsDiv);

  runBtn.addEventListener("click", async () => {
    const objectives = outputCols.map(col => ({
      output_col: col,
      direction:  document.getElementById(`opt-m-dir-${col}`)?.value || "minimize",
    }));
    const bounds   = _readBoundsTable("m", inputCols);
    const pop_size = parseInt(document.getElementById("opt-m-pop")?.value || "100", 10);
    const n_gen    = parseInt(document.getElementById("opt-m-gen")?.value || "100", 10);

    runBtn.disabled = true;
    runBtn.textContent = "Running NSGA-II…";
    showSpinner(runBtn);

    const resp = await post("/api/optimize/multi", { objectives, bounds, pop_size, n_gen });

    hideSpinner(runBtn);
    runBtn.disabled = false;
    runBtn.textContent = "Run NSGA-II →";

    if (!resp.success) {
      showError(resp.message || "Multi-objective optimization failed.");
      return;
    }
    _renderMultiResults(resultsDiv, resp, outputCols);
  });
}


// ── Results renderers ─────────────────────────────────────────────────────────

function _renderSingleResults(container, resp) {
  clearEl(container);
  const wrap = el("div", { cls: "opt-results-wrap" });

  // Status row
  const statusRow = el("div", { cls: "opt-status-row" });
  const badge = el("span", {
    cls: "opt-badge " + (resp.converged ? "opt-badge--good" : "opt-badge--warn"),
    text: resp.converged ? "Converged" : "Did not converge",
  });
  const evals = el("span", { cls: "metric-secondary",
    text: `  ${resp.n_evaluations?.toLocaleString() || 0} evaluations` });
  statusRow.appendChild(badge);
  statusRow.appendChild(evals);
  wrap.appendChild(statusRow);

  // Warnings
  if (resp.warnings?.length) {
    const warnDiv = el("div", { cls: "opt-warnings" });
    for (const w of resp.warnings) {
      const chip = el("div", { cls: "opt-warning-chip" });
      chip.textContent = w;
      warnDiv.appendChild(chip);
    }
    wrap.appendChild(warnDiv);
  }

  // Best inputs table
  wrap.appendChild(_sectionHead("Best Inputs"));
  wrap.appendChild(_kvTable(resp.best_inputs, 4));

  // Predicted outputs table
  wrap.appendChild(_sectionHead("Predicted Outputs"));
  const target = resp.target_output;
  const direction = resp.direction;
  const outRows = Object.entries(resp.best_outputs || {}).map(([k, v]) => {
    const isTarget = k === target;
    return `<tr>
      <td>${escHtml(k)}</td>
      <td><strong>${Number(v).toPrecision(6)}</strong></td>
      <td>${isTarget ? `<span class="opt-badge opt-badge--good">${direction}</span>` : ""}</td>
    </tr>`;
  });
  const outTable = document.createElement("table");
  outTable.className = "results-table";
  outTable.innerHTML = `<thead><tr><th>Output</th><th>Value</th><th></th></tr></thead>
    <tbody>${outRows.join("")}</tbody>`;
  wrap.appendChild(outTable);

  container.appendChild(wrap);
}

function _renderMultiResults(container, resp, allOutputCols) {
  clearEl(container);
  const wrap = el("div", { cls: "opt-results-wrap" });

  const paretoOutputs = resp.pareto_outputs || [];
  const n = paretoOutputs.length;

  const summaryRow = el("div", { cls: "opt-status-row" });
  summaryRow.innerHTML = `<span class="opt-badge opt-badge--good">${n} Pareto solution${n !== 1 ? "s" : ""}</span>
    <span class="metric-secondary">&nbsp;${resp.n_gen} generations · pop ${resp.pop_size}</span>`;
  wrap.appendChild(summaryRow);

  if (!n) {
    wrap.innerHTML += `<p style="color:var(--color-text-muted);margin-top:var(--space-4);">No Pareto solutions found. Try increasing generations or population size.</p>`;
    container.appendChild(wrap);
    return;
  }

  const objCols = (resp.objectives || []).map(o => o.output_col);
  if (objCols.length >= 2) {
    // Axis selectors (if > 2 objectives)
    const chartWrap = el("div", { cls: "opt-pareto-wrap" });
    const chartEl   = el("div",  { cls: "opt-pareto-chart" });
    let xObj = objCols[0], yObj = objCols[1];

    const axisRow = el("div", { cls: "al-axis-row" });
    if (objCols.length > 2) {
      const mkSel = (defaultVal, id) => {
        const f = el("div", { cls: "al-field" });
        const lbl = el("label", { cls: "hyperparam-label", text: id.includes("x") ? "X axis:" : "Y axis:" });
        const sel = el("select", { cls: "model-config-select", id });
        for (const c of objCols) {
          const o = document.createElement("option");
          o.value = c; o.textContent = c;
          if (c === defaultVal) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener("change", () => {
          xObj = document.getElementById("opt-m-axis-x").value;
          yObj = document.getElementById("opt-m-axis-y").value;
          renderParetoFront(chartEl, paretoOutputs, xObj, yObj);
        });
        f.appendChild(lbl);
        f.appendChild(sel);
        return f;
      };
      axisRow.appendChild(mkSel(xObj, "opt-m-axis-x"));
      axisRow.appendChild(mkSel(yObj, "opt-m-axis-y"));
    }
    chartWrap.appendChild(axisRow);
    chartWrap.appendChild(chartEl);
    wrap.appendChild(chartWrap);

    renderParetoFront(chartEl, paretoOutputs, xObj, yObj);
    requestAnimationFrame(() => {
      const p = chartEl.querySelector(".js-plotly-plot");
      // eslint-disable-next-line no-undef
      if (p) Plotly.Plots.resize(p);
    });
  }

  // Solutions table
  wrap.appendChild(_sectionHead(`Pareto Solutions (${n})`));
  const inputCols  = resp.input_cols  || [];
  const tblHeaders = ["#", ...inputCols, ...objCols].map(h => `<th>${escHtml(h)}</th>`).join("");
  const tblRows = paretoOutputs.map((row, i) => {
    const inputVals = inputCols.map(c => {
      const v = resp.pareto_inputs[i]?.[c];
      return `<td>${v != null ? Number(v).toPrecision(5) : "—"}</td>`;
    }).join("");
    const outVals = objCols.map(c => {
      const v = row[c];
      return `<td>${v != null ? Number(v).toPrecision(5) : "—"}</td>`;
    }).join("");
    return `<tr><td>${i + 1}</td>${inputVals}${outVals}</tr>`;
  }).join("");

  const tbl = document.createElement("table");
  tbl.className = "results-table opt-solutions-table";
  tbl.innerHTML = `<thead><tr>${tblHeaders}</tr></thead><tbody>${tblRows}</tbody>`;
  const tblWrap = el("div", { cls: "al-table-wrap" });
  tblWrap.appendChild(tbl);
  wrap.appendChild(tblWrap);

  container.appendChild(wrap);
}


// ── DOM helpers ───────────────────────────────────────────────────────────────

function _switchTab(activeTab, inactiveTab, activePanel, inactivePanel) {
  activeTab.classList.add("al-tab--active");
  inactiveTab.classList.remove("al-tab--active");
  activePanel.classList.remove("hidden");
  inactivePanel.classList.add("hidden");
}

function _buildBoundsTable(prefix, inputCols, inputMins, inputMaxs) {
  const wrap = el("div", { cls: "opt-bounds-wrap" });
  const tbl  = document.createElement("table");
  tbl.className = "results-table opt-bounds-table";
  tbl.innerHTML = `<thead><tr><th>Input</th><th>Min</th><th>Max</th></tr></thead>`;
  const tbody = document.createElement("tbody");
  for (const col of inputCols) {
    const tr = document.createElement("tr");
    const minVal = inputMins[col] ?? 0;
    const maxVal = inputMaxs[col] ?? 1;
    tr.innerHTML = `
      <td>${escHtml(col)}</td>
      <td><input type="number" class="opt-bounds-input" id="opt-${prefix}-min-${col}" value="${Number(minVal).toPrecision(6)}" step="any"></td>
      <td><input type="number" class="opt-bounds-input" id="opt-${prefix}-max-${col}" value="${Number(maxVal).toPrecision(6)}" step="any"></td>`;
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  wrap.appendChild(tbl);
  return wrap;
}

function _readBoundsTable(prefix, inputCols) {
  const bounds = {};
  for (const col of inputCols) {
    const minEl = document.getElementById(`opt-${prefix}-min-${col}`);
    const maxEl = document.getElementById(`opt-${prefix}-max-${col}`);
    if (minEl && maxEl) bounds[col] = [parseFloat(minEl.value), parseFloat(maxEl.value)];
  }
  return bounds;
}

function _addConstraintRow(listEl, outputCols) {
  const row = el("div", { cls: "opt-constr-row" });
  row.innerHTML = `
    <select class="model-config-select opt-constr-col">${outputCols.map(c => `<option>${escHtml(c)}</option>`).join("")}</select>
    <select class="model-config-select opt-constr-op"><option value="&lt;=">≤</option><option value="&gt;=">≥</option></select>
    <input type="number" class="model-config-input opt-constr-val" placeholder="threshold" step="any">
    <button class="btn opt-constr-rm" title="Remove">✕</button>`;
  row.querySelector(".opt-constr-rm").addEventListener("click", () => row.remove());
  listEl.appendChild(row);
}

function _readConstraints(listId) {
  const listEl = document.getElementById(listId);
  if (!listEl) return [];
  return [...listEl.querySelectorAll(".opt-constr-row")].map(row => ({
    output_col: row.querySelector(".opt-constr-col")?.value,
    operator:   row.querySelector(".opt-constr-op")?.value,
    threshold:  parseFloat(row.querySelector(".opt-constr-val")?.value || "0"),
  })).filter(c => c.output_col && !isNaN(c.threshold));
}

function _kvTable(obj, precision = 4) {
  const tbl = document.createElement("table");
  tbl.className = "results-table";
  tbl.innerHTML = `<thead><tr><th>Variable</th><th>Value</th></tr></thead>`;
  const tbody = document.createElement("tbody");
  for (const [k, v] of Object.entries(obj || {})) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escHtml(k)}</td><td><strong>${Number(v).toPrecision(precision + 2)}</strong></td>`;
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  return tbl;
}

function _sectionHead(text) {
  const h = el("h3", { cls: "opt-section-head", text });
  return h;
}
