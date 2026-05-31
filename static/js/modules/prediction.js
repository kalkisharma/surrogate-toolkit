// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/prediction.js
// Version: 1.0.0
// Description: Step 9 — Prediction & Inference. Single-point prediction
//              (form → POST /api/predict/single) and batch prediction
//              (CSV upload → POST /api/predict/batch → CSV download).
//              Reads trained model metadata from GET /api/model/results.
// =============================================================================

import { get, post } from "../api.js";
import { showError, showSuccess } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { registerPrimer } from "../learning_mode.js";
import { el, clearEl } from "../utils.js";

/**
 * Render the prediction card into containerEl.
 *
 * @param {HTMLElement} containerEl - Target card element.
 */
export async function initPrediction(containerEl) {
  clearEl(containerEl);
  showSpinner(containerEl);

  const resp = await get("/api/model/results");
  hideSpinner(containerEl);

  if (!resp.success) {
    const header = el("div", { cls: "section-header" });
    header.innerHTML = `
      <h2 class="section-title">Step 9 — Prediction</h2>
      <p class="section-desc" style="color: var(--color-text-muted);">
        No trained model yet. Complete Step 7 — Configure Training to use prediction here.
      </p>`;
    containerEl.appendChild(header);
    return;
  }

  _render(containerEl, resp.results);
}

// ── Internal renderer ──────────────────────────────────────────────────────────

function _render(containerEl, r) {
  clearEl(containerEl);

  // When PCA was applied, show original physical column names (not PC1/PC2/…).
  // The backend accepts original values and applies the stored PCA transform internally.
  const pcaApplied = r.pca_applied && r.pca_original_inputs?.length > 0;
  const inputCols  = pcaApplied ? r.pca_original_inputs : r.input_columns;
  const inputMeans = pcaApplied ? (r.pca_original_input_means || {}) : (r.input_means || {});
  const inputMins  = pcaApplied ? (r.pca_original_input_mins  || {}) : (r.input_mins  || {});
  const inputMaxs  = pcaApplied ? (r.pca_original_input_maxs  || {}) : (r.input_maxs  || {});
  const outputCols = r.output_columns;
  const modelLabel = r.model_type.toUpperCase();

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Step 9 — Prediction</h2>
    <p class="section-desc">Query the trained ${modelLabel} surrogate for new input values.</p>
  `;
  containerEl.appendChild(header);

  registerPrimer(
    "prediction",
    header,
    "What is prediction?",
    `<p>Now that your surrogate is trained, you can evaluate it on any set of input
     values without running the original simulation or experiment.</p>
     <p><strong>Single-point</strong> — enter one row of values and get predicted
     outputs instantly. Good for sanity-checking the model at a known design point.</p>
     <p><strong>Batch</strong> — upload a CSV with many input rows and download a
     CSV with predicted outputs appended. This is the production use case: evaluating
     the surrogate across a full design grid in seconds.</p>`
  );

  // ── PCA notice ───────────────────────────────────────────────────────────────
  if (pcaApplied) {
    const notice = el("div", { cls: "prediction-pca-notice" });
    notice.innerHTML = `<strong>PCA active</strong> — enter original physical inputs below.
      The ${r.input_columns.length}-component PCA transform is applied automatically before prediction.`;
    containerEl.appendChild(notice);
  }

  // ── Single-point section ─────────────────────────────────────────────────────
  const spSection = el("div", { cls: "results-section" });
  const spTitle   = el("h3", { cls: "results-section-title", text: "Single-Point Prediction" });
  spSection.appendChild(spTitle);

  registerPrimer(
    "prediction-single",
    spTitle,
    "How do I use single-point prediction?",
    `<p>Enter one numeric value for each input column, then click
     <strong>Run Prediction</strong>. The surrogate evaluates its learned mapping
     and returns the predicted outputs immediately — no simulation runs.</p>
     <p>If a prediction looks wrong, check whether your inputs are inside the
     training data range. Extrapolation (values outside the range the model was
     trained on) reduces accuracy.</p>`
  );

  containerEl.appendChild(spSection);

  // Input form
  const form   = el("div", { cls: "prediction-form" });
  const inputs = {};

  function _resetToMeans() {
    for (const col of inputCols) {
      const m = inputMeans[col];
      inputs[col].value = m !== undefined ? parseFloat(m.toPrecision(4)) : "";
    }
  }

  for (const col of inputCols) {
    const row   = el("div", { cls: "prediction-input-row" });
    const label = el("label", {
      cls: "prediction-input-label",
      for: `pred-in-${col}`,
      text: col,
    });
    const inp = el("input", {
      type: "number",
      cls:  "prediction-input-field",
      id:   `pred-in-${col}`,
      step: "any",
    });
    const mean = inputMeans[col];
    if (mean !== undefined) inp.value = parseFloat(mean.toPrecision(4));
    const lo = inputMins[col], hi = inputMaxs[col];
    if (lo !== undefined && hi !== undefined) {
      inp.title = `Training range: ${parseFloat(lo.toPrecision(4))} – ${parseFloat(hi.toPrecision(4))}`;
    }
    inputs[col] = inp;
    row.appendChild(label);
    row.appendChild(inp);
    form.appendChild(row);
  }

  const btnRow   = el("div", { cls: "prediction-btn-row" });
  const runBtn   = el("button", { cls: "btn btn-primary",   text: "Run Prediction →", id: "sp-run-btn" });
  const resetBtn = el("button", { cls: "btn btn-secondary", text: "Reset to means",   id: "sp-reset-btn" });
  btnRow.appendChild(runBtn);
  btnRow.appendChild(resetBtn);
  form.appendChild(btnRow);
  spSection.appendChild(form);

  resetBtn.addEventListener("click", _resetToMeans);

  const spResults = el("div", { cls: "prediction-results" });
  spResults.style.display = "none";
  spSection.appendChild(spResults);

  runBtn.addEventListener("click", async () => {
    const inputValues = {};
    for (const col of inputCols) {
      const v = parseFloat(inputs[col].value);
      if (isNaN(v)) {
        showError(`Enter a numeric value for "${col}".`);
        inputs[col].focus();
        return;
      }
      inputValues[col] = v;
    }

    runBtn.disabled    = true;
    runBtn.textContent = "Predicting…";

    // Show computing placeholder so the user sees the update cycle start
    spResults.style.display = "";
    spResults.innerHTML = `<p class="prediction-computing">Computing…</p>`;

    const resp = await post("/api/predict/single", { inputs: inputValues });
    runBtn.disabled    = false;
    runBtn.textContent = "Run Prediction →";

    if (!resp.success) {
      spResults.style.display = "none";
      showError(resp.message || "Prediction failed.");
      return;
    }

    spResults.innerHTML = `
      <div class="results-table-wrap">
        <table class="results-table">
          <thead><tr><th>Output column</th><th>Predicted value</th></tr></thead>
          <tbody>
            ${Object.entries(resp.predictions).map(([col, val]) => `
              <tr>
                <td class="results-col-name">${col}</td>
                <td class="results-metric">${val.toPrecision(6)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  });

  // ── Batch section ────────────────────────────────────────────────────────────
  const batchSection = el("div", { cls: "results-section" });
  const batchTitle   = el("h3", { cls: "results-section-title", text: "Batch Prediction (CSV)" });
  batchSection.appendChild(batchTitle);

  registerPrimer(
    "prediction-batch",
    batchTitle,
    "How do I run batch prediction?",
    `<p>Upload a CSV where each row is one set of input values to evaluate.
     The file must have column headers matching the model's input columns:
     <strong>${inputCols.join(", ")}</strong>.</p>
     <p>The downloaded CSV includes your original input columns plus a new column
     for each predicted output: <strong>${outputCols.join(", ")}</strong>.</p>
     <p>Extra columns in your CSV (not in the input list) are ignored — only
     the required input columns are passed to the model.</p>`
  );

  containerEl.appendChild(batchSection);

  const batchDesc = el("p", { cls: "section-desc", style: "margin-bottom: var(--space-4);" });
  batchDesc.innerHTML = `Required columns: <code class="prediction-code">${inputCols.join(", ")}</code>`;
  batchSection.appendChild(batchDesc);

  const batchFileInput = el("input", {
    type:   "file",
    id:     "batch-file-input",
    accept: ".csv",
    cls:    "prediction-batch-file",
  });
  const batchFileLabel = el("label", {
    cls:  "btn btn-secondary",
    for:  "batch-file-input",
    text: "Choose CSV…",
  });
  const batchFileName = el("span", {
    cls:  "prediction-batch-filename",
    text: "No file chosen",
  });
  const batchRunBtn = el("button", {
    cls:  "btn btn-primary",
    text: "Run Batch Prediction →",
    id:   "batch-run-btn",
  });
  batchRunBtn.disabled = true;

  const batchRow = el("div", { cls: "prediction-batch-row" });
  batchRow.appendChild(batchFileLabel);
  batchRow.appendChild(batchFileName);
  batchRow.appendChild(batchRunBtn);
  batchSection.appendChild(batchFileInput);
  batchSection.appendChild(batchRow);

  const batchResults = el("div", { cls: "prediction-results" });
  batchResults.style.display = "none";
  batchSection.appendChild(batchResults);

  batchFileInput.addEventListener("change", () => {
    const file = batchFileInput.files[0];
    batchFileName.textContent = file ? file.name : "No file chosen";
    batchRunBtn.disabled = !file;
  });

  batchRunBtn.addEventListener("click", async () => {
    const file = batchFileInput.files[0];
    if (!file) return;

    batchRunBtn.disabled    = true;
    batchRunBtn.textContent = "Running…";

    const formData = new FormData();
    formData.append("file", file);

    const resp = await post("/api/predict/batch", formData);
    batchRunBtn.disabled    = false;
    batchRunBtn.textContent = "Run Batch Prediction →";

    if (!resp.success) {
      showError(resp.message || "Batch prediction failed.");
      return;
    }

    batchResults.style.display = "";
    clearEl(batchResults);

    const summary = el("p", { cls: "section-desc" });
    summary.textContent = `${resp.n_rows.toLocaleString()} row(s) predicted.`;
    batchResults.appendChild(summary);

    const dlBtn = el("button", { cls: "btn btn-secondary prediction-dl-btn", text: "⬇ Download CSV" });
    dlBtn.addEventListener("click", () => _downloadBatchCSV(resp));
    batchResults.appendChild(dlBtn);

    showSuccess(`Batch prediction complete — ${resp.n_rows.toLocaleString()} row(s).`);
  });
}

// ── CSV download ──────────────────────────────────────────────────────────────

function _downloadBatchCSV(resp) {
  const { rows, columns, classification, model_type } = resp;

  const lines = [];
  if (classification && classification !== "Unclassified") {
    lines.push(`# Classification: ${classification}`);
  }
  lines.push(columns.join(","));
  for (const row of rows) {
    lines.push(columns.map(c => (row[c] !== undefined && row[c] !== null ? row[c] : "")).join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `predictions_${model_type}_${classification}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
