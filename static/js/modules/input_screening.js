// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/input_screening.js
// Version: 1.0.0
// Description: Step 7 — Input Screening. Correlation heatmap, flagged-pair
//              table, low-variance flags, and input toggle checkboxes.
//              Writes selected input subset back to STATE via PUT /api/data/screen/apply.
// =============================================================================

import { post, put } from "../api.js";
import { registerPrimer } from "../learning_mode.js";
import { showError, showSuccess } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { renderCorrelationHeatmap } from "../charts.js";
import { el, clearEl, escHtml } from "../utils.js";

// ── Module state ──────────────────────────────────────────────────────────────
let _lastResp    = null;
let _threshold   = 0.9;
let _cvThreshold = 0.01;
let _selected    = null;   // Set of currently selected input columns

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * @param {HTMLElement} containerEl
 * @param {string[]}    inputCols   — currently designated input columns
 */
export async function initScreening(containerEl, inputCols = []) {
  clearEl(containerEl);

  if (inputCols.length === 0) {
    containerEl.innerHTML = `
      <div class="section-header">
        <h2 class="section-title">Step 7 — Screen Inputs</h2>
      </div>
      <p style="color:var(--color-text-muted);padding:var(--space-4) 0;">
        No input columns designated. Complete Step 5 — Assign first.
      </p>`;
    return;
  }

  // Header
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Step 7 — Screen Inputs</h2>
    <p class="section-desc">Identify and remove redundant or uninformative inputs before training.</p>`;
  containerEl.appendChild(header);

  registerPrimer("input_screening", header, "Why screen inputs?", `
    <p><strong>Correlated inputs</strong> carry redundant information — including both can
    destabilise some models and makes sensitivity analysis harder to interpret.
    If two inputs have |r| ≥ 0.9, keeping both adds little value.</p>
    <p><strong>Low-variance inputs</strong> (near-constant across all runs) contribute
    almost no signal. A coefficient of variation below 1% usually means the column
    was accidentally included or wasn't varied in the design.</p>
    <p>This step never removes columns automatically — you choose what to drop.
    You can also skip this step entirely and proceed to Step 8 — Model.</p>
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
    _selected = _selected || new Set(_lastResp.input_columns);
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
    _selected = new Set(resp.input_columns);
    _renderResults(resultsDiv, resp, containerEl);
  });
}

// ── Internal renderers ────────────────────────────────────────────────────────

function _renderResults(container, resp, rootEl) {
  clearEl(container);

  // ── Correlation heatmap ───────────────────────────────────────────────────
  const heatSection = el("div", { cls: "screen-section" });
  heatSection.innerHTML = `<h3 class="screen-section-title">Correlation Matrix</h3>`;
  const heatWrap = el("div", { cls: "screen-heatmap-wrap" });
  heatSection.appendChild(heatWrap);
  container.appendChild(heatSection);
  renderCorrelationHeatmap(heatWrap, resp.input_columns, resp.correlation_matrix, resp.threshold);

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

  const flaggedByCorr = new Set(resp.flagged_pairs.map(p => p.col_b));
  const flaggedByVar  = new Set(resp.low_variance.map(v => v.col));
  const flaggedCols   = new Set([...flaggedByCorr, ...flaggedByVar]);

  const grid = el("div", { cls: "screen-checkbox-grid" });
  const checkboxes = [];

  for (const col of resp.input_columns) {
    const isFlagged = flaggedCols.has(col);
    // On first render after Analyze, pre-uncheck flagged; preserve user choices on re-render
    if (!_selected.has(col) && isFlagged) {
      // already excluded — leave as-is
    }

    const rowEl = el("label", { cls: `screen-checkbox-row${isFlagged ? " screen-checkbox-row--flagged" : ""}` });
    const cb    = document.createElement("input");
    cb.type    = "checkbox";
    cb.dataset.col = col;
    cb.checked = _selected.has(col);
    cb.addEventListener("change", () => {
      if (cb.checked) _selected.add(col);
      else            _selected.delete(col);
      _updateApplyBtn(applyBtn);
    });
    checkboxes.push(cb);

    const lblSpan = el("span", { text: col });
    if (isFlagged) lblSpan.classList.add("screen-flagged-label");

    rowEl.appendChild(cb);
    rowEl.appendChild(document.createTextNode(" "));
    rowEl.appendChild(lblSpan);

    if (isFlagged) {
      const tag = el("span", { cls: "screen-flag-tag",
        text: flaggedByCorr.has(col) ? "corr" : "low-var" });
      rowEl.appendChild(tag);
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
    const r = await put("/api/data/screen/apply", { input_columns: cols });
    applyBtn.disabled = false;
    _updateApplyBtn(applyBtn);
    if (!r.success) { showError(r.message || "Apply failed."); return; }
    showSuccess(r.message || `${cols.length} inputs selected.`);
    // Bubble up to main.js _initScreenPanel listener
    rootEl.dispatchEvent(new CustomEvent("screen:applied", {
      detail: { input_columns: cols },
      bubbles: true,
    }));
  });

  applyRow.appendChild(applyBtn);
  const skipNote = el("p", { cls: "screen-skip-note",
    text: "Or skip this step — proceed directly to Step 8 — Model." });
  applyRow.appendChild(skipNote);
  container.appendChild(applyRow);

  requestAnimationFrame(() => {
    container.querySelectorAll(".js-plotly-plot").forEach(p => Plotly.Plots.resize(p));
  });
}

function _updateApplyBtn(btn) {
  const n = _selected ? _selected.size : 0;
  btn.disabled     = n < 1;
  btn.textContent  = n > 0 ? `Apply Selection (${n} inputs) →` : "Apply Selection →";
}
