// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/model_config.js
// Version: 0.9.10
// Description: Step 7 — Configure Training. Lets users choose a model type,
//              train/test split, and cross-validation folds. Shows a per-model
//              hyperparameter section (kernel/alpha for GPR, trees/depth/features
//              for RF, regularization for Linear). Saves to POST /api/model/configure,
//              then initiates training via POST /api/model/train.
// =============================================================================

import { get, post } from "../api.js";
import { showError, showSuccess, showWarning } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { registerPrimer } from "../learning_mode.js";
import { el, clearEl } from "../utils.js";

const HYPERPARAM_DEFAULTS = {
  gpr:    { kernel: "rbf", alpha: 0.1 },
  rf:     { n_estimators: 100, max_depth: null, min_samples_leaf: 1, max_features: "sqrt" },
  linear: { alpha: 1.0 },
};

const MODEL_TYPES = [
  {
    value: "gpr",
    label: "Gaussian Process (GPR)",
    desc:  "Best for small datasets (< 5 000 rows). Provides prediction uncertainty — ideal for active learning and design space exploration.",
  },
  {
    value: "rf",
    label: "Random Forest",
    desc:  "Handles larger datasets and non-linear relationships well. Robust to outliers. No built-in uncertainty estimate.",
  },
  {
    value: "linear",
    label: "Linear (Ridge)",
    desc:  "Fastest to train. Good baseline and interpretable. Best when the relationship between inputs and outputs is roughly linear.",
  },
];

/**
 * Render the training configuration card into containerEl.
 *
 * @param {HTMLElement} containerEl - Target card element.
 * @param {Function}    onTrain     - Called after a successful train with the
 *                                    results object from POST /api/model/train.
 */
export async function initModelConfig(containerEl, onTrain) {
  clearEl(containerEl);
  showSpinner(containerEl);

  const configResp = await get("/api/model/config");
  hideSpinner(containerEl);

  if (!configResp.success) {
    showError("Could not load training configuration. Reload the page and try again.");
    return;
  }

  const saved = configResp.config || {};

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Step 7 — Configure Training</h2>
    <p class="section-desc">Choose a model type and evaluation strategy. You can change these any time before training.</p>
  `;
  containerEl.appendChild(header);

  registerPrimer(
    "model-config",
    header,
    "Which model should I choose?",
    `<p>A <strong>surrogate model</strong> learns the mapping from your input columns to
     your output columns. The right choice depends on your dataset size and what you
     plan to do with the model.</p>
     <p><strong>Gaussian Process (GPR)</strong> — gives you a mean prediction AND an
     uncertainty estimate at each point. Very useful for deciding where to run your
     next simulation. Best below ~5 000 training rows due to cubic scaling.</p>
     <p><strong>Random Forest</strong> — an ensemble of decision trees. Handles
     non-linear inputs well and scales to large datasets. Does not natively produce
     uncertainty — you would use the spread across trees as a proxy.</p>
     <p><strong>Linear (Ridge)</strong> — a fast, interpretable baseline. Useful
     for confirming that GPR or RF aren't just fitting noise; if linear does almost
     as well, your design space may be simpler than expected.</p>`
  );

  const form = el("div", { cls: "model-config-form" });
  containerEl.appendChild(form);

  // ── Model type ───────────────────────────────────────────────────────────────
  const typeSection = el("div", { cls: "model-config-section" });
  const typeLabelEl = el("div", { cls: "model-config-section-label" });
  typeLabelEl.textContent = "Model type";

  typeSection.appendChild(typeLabelEl);

  registerPrimer(
    "model-type-select",
    typeLabelEl,
    "What does each model type mean?",
    `<p>See the card-level primer for a full description. In short:</p>
     <ul>
       <li><strong>GPR</strong> — small datasets, uncertainty needed.</li>
       <li><strong>Random Forest</strong> — larger datasets, non-linear.</li>
       <li><strong>Linear</strong> — fast baseline, interpretable.</li>
     </ul>`
  );

  const typeOptions = el("div", { cls: "model-type-options" });
  let selectedModel = saved.model_type || "gpr";

  for (const mt of MODEL_TYPES) {
    const opt   = el("div", { cls: "model-type-option" + (mt.value === selectedModel ? " model-type-option--selected" : "") });
    opt.dataset.value = mt.value;
    opt.innerHTML = `
      <label class="model-type-option-inner">
        <input type="radio" name="model-type" value="${mt.value}"
               class="model-type-radio" ${mt.value === selectedModel ? "checked" : ""}>
        <div>
          <div class="model-type-option-label">${mt.label}</div>
          <div class="model-type-option-desc">${mt.desc}</div>
        </div>
      </label>
    `;
    opt.addEventListener("click", () => {
      selectedModel = mt.value;
      opt.querySelector("input").checked = true;
      typeOptions.querySelectorAll(".model-type-option").forEach(
        (o) => o.classList.toggle("model-type-option--selected", o.dataset.value === mt.value)
      );
    });
    typeOptions.appendChild(opt);
  }

  typeSection.appendChild(typeOptions);
  form.appendChild(typeSection);

  // ── Hyperparameters ───────────────────────────────────────────────────────────
  const hyperparamOuter = el("div", { id: "hyperparam-outer" });
  form.appendChild(hyperparamOuter);

  function _renderHyperparams(modelType, hp) {
    clearEl(hyperparamOuter);
    const defs = HYPERPARAM_DEFAULTS[modelType] || {};
    const merged = Object.assign({}, defs, hp || {});

    if (modelType === "gpr") {
      hyperparamOuter.innerHTML = `
        <div class="hyperparam-section">
          <div class="hyperparam-section-header">
            <span class="hyperparam-section-label">Hyperparameters</span>
            <button class="hyperparam-reset" id="hp-reset">Reset to defaults</button>
          </div>
          <div class="hyperparam-row">
            <span class="hyperparam-label">Kernel</span>
            <select id="hp-kernel" class="hyperparam-select">
              <option value="rbf"      ${merged.kernel === "rbf"      ? "selected" : ""}>RBF (default)</option>
              <option value="matern15" ${merged.kernel === "matern15" ? "selected" : ""}>Matérn ν=1.5</option>
              <option value="matern25" ${merged.kernel === "matern25" ? "selected" : ""}>Matérn ν=2.5</option>
            </select>
          </div>
          <div class="hyperparam-row">
            <span class="hyperparam-label">Noise level (alpha)</span>
            <input id="hp-alpha" type="number" class="hyperparam-input" step="any" min="0.0001" max="10" value="${merged.alpha ?? 0.1}">
            <span class="hyperparam-hint">0.0001 – 10 — higher = more noise tolerance</span>
          </div>
        </div>`;
    } else if (modelType === "rf") {
      const depthUnlimited = merged.max_depth == null;
      hyperparamOuter.innerHTML = `
        <div class="hyperparam-section">
          <div class="hyperparam-section-header">
            <span class="hyperparam-section-label">Hyperparameters</span>
            <button class="hyperparam-reset" id="hp-reset">Reset to defaults</button>
          </div>
          <div class="hyperparam-row">
            <span class="hyperparam-label">Estimators (trees)</span>
            <input id="hp-n-est" type="number" class="hyperparam-input" min="10" max="500" step="10" value="${merged.n_estimators ?? 100}">
            <span class="hyperparam-hint">10 – 500</span>
          </div>
          <div class="hyperparam-row">
            <span class="hyperparam-label">Max depth</span>
            <input id="hp-max-depth" type="number" class="hyperparam-input" min="1" max="30" step="1"
                   value="${merged.max_depth ?? 10}" ${depthUnlimited ? "disabled" : ""}>
            <label class="chart-settings-check">
              <input type="checkbox" id="hp-depth-unlimited" ${depthUnlimited ? "checked" : ""}> Unlimited
            </label>
          </div>
          <div class="hyperparam-row">
            <span class="hyperparam-label">Min samples / leaf</span>
            <input id="hp-min-leaf" type="number" class="hyperparam-input" min="1" max="20" step="1" value="${merged.min_samples_leaf ?? 1}">
            <span class="hyperparam-hint">1 – 20</span>
          </div>
          <div class="hyperparam-row">
            <span class="hyperparam-label">Max features</span>
            <select id="hp-max-feat" class="hyperparam-select">
              <option value="sqrt" ${(merged.max_features || "sqrt") === "sqrt" ? "selected" : ""}>√n (sqrt, default)</option>
              <option value="log2" ${merged.max_features === "log2" ? "selected" : ""}>log₂n</option>
              <option value="0.5"  ${String(merged.max_features) === "0.5" ? "selected" : ""}>50%</option>
            </select>
          </div>
        </div>`;
      hyperparamOuter.querySelector("#hp-depth-unlimited").addEventListener("change", (e) => {
        hyperparamOuter.querySelector("#hp-max-depth").disabled = e.target.checked;
      });
    } else if (modelType === "linear") {
      hyperparamOuter.innerHTML = `
        <div class="hyperparam-section">
          <div class="hyperparam-section-header">
            <span class="hyperparam-section-label">Hyperparameters</span>
            <button class="hyperparam-reset" id="hp-reset">Reset to defaults</button>
          </div>
          <div class="hyperparam-row">
            <span class="hyperparam-label">Regularization (alpha)</span>
            <input id="hp-linear-alpha" type="number" class="hyperparam-input" step="any" min="0" max="100" value="${merged.alpha ?? 1.0}">
            <span class="hyperparam-hint">0 = no regularization; 1.0 = default Ridge</span>
          </div>
        </div>`;
    }

    const resetBtn = hyperparamOuter.querySelector("#hp-reset");
    if (resetBtn) resetBtn.addEventListener("click", () => _renderHyperparams(modelType, {}));
  }

  function _collectHyperparams() {
    const hp = {};
    if (selectedModel === "gpr") {
      const k = hyperparamOuter.querySelector("#hp-kernel");
      const a = hyperparamOuter.querySelector("#hp-alpha");
      if (k) hp.kernel = k.value;
      if (a) hp.alpha  = parseFloat(a.value) || 0.1;
    } else if (selectedModel === "rf") {
      const n  = hyperparamOuter.querySelector("#hp-n-est");
      const d  = hyperparamOuter.querySelector("#hp-max-depth");
      const du = hyperparamOuter.querySelector("#hp-depth-unlimited");
      const ml = hyperparamOuter.querySelector("#hp-min-leaf");
      const mf = hyperparamOuter.querySelector("#hp-max-feat");
      if (n)  hp.n_estimators    = parseInt(n.value, 10) || 100;
      if (du) hp.max_depth       = du.checked ? null : (parseInt(d.value, 10) || null);
      if (ml) hp.min_samples_leaf = parseInt(ml.value, 10) || 1;
      if (mf) hp.max_features    = mf.value;
    } else if (selectedModel === "linear") {
      const a = hyperparamOuter.querySelector("#hp-linear-alpha");
      if (a) hp.alpha = parseFloat(a.value) || 1.0;
    }
    return hp;
  }

  _renderHyperparams(selectedModel, saved.hyperparams || {});

  // Re-render hyperparams when model type changes
  typeOptions.querySelectorAll(".model-type-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      _renderHyperparams(opt.dataset.value, {});
    });
  });

  // ── Test split ───────────────────────────────────────────────────────────────
  const splitSection = el("div", { cls: "model-config-section" });
  const splitLabelEl = el("div", { cls: "model-config-section-label" });
  splitLabelEl.textContent = "Test split";

  const splitRow = el("div", { cls: "model-config-row" });
  const splitInput = el("input", {
    type: "number", cls: "model-config-input", id: "test-split-input",
    min: "0.05", max: "0.50", step: "0.05",
  });
  splitInput.value = saved.test_split ?? 0.20;
  const splitHint = el("span", { cls: "model-config-hint", text: "fraction held out for testing (0.05 – 0.50)" });

  splitRow.appendChild(splitInput);
  splitRow.appendChild(splitHint);
  splitSection.appendChild(splitLabelEl);
  registerPrimer(
    "test-split",
    splitLabelEl,
    "What is a train/test split?",
    `<p>Before training, the dataset is divided into two parts:</p>
     <ul>
       <li><strong>Training set</strong> — the rows the model learns from.</li>
       <li><strong>Test set</strong> — rows held back and never seen during training.
           Used to measure how well the model generalises to new data.</li>
     </ul>
     <p>A 20% test split means 80% of rows train the model and 20% evaluate it.
     For small datasets (< 100 rows), consider 10–15%. For large datasets
     (> 1 000 rows), 20–25% is typical.</p>`
  );
  splitSection.appendChild(splitRow);
  form.appendChild(splitSection);

  // ── CV folds ─────────────────────────────────────────────────────────────────
  const cvSection = el("div", { cls: "model-config-section" });
  const cvLabelEl = el("div", { cls: "model-config-section-label" });
  cvLabelEl.textContent = "Cross-validation folds";

  const cvRow = el("div", { cls: "model-config-row" });
  const cvSelect = el("select", { cls: "model-config-select", id: "cv-folds-select" });
  for (const k of [3, 5, 10]) {
    const opt = document.createElement("option");
    opt.value       = k;
    opt.textContent = `${k}-fold`;
    if (k === (saved.cv_folds ?? 5)) opt.selected = true;
    cvSelect.appendChild(opt);
  }

  cvRow.appendChild(cvSelect);
  cvSection.appendChild(cvLabelEl);
  registerPrimer(
    "cv-folds",
    cvLabelEl,
    "What is k-fold cross-validation?",
    `<p>Cross-validation gives a more reliable estimate of model performance than a
     single train/test split. The training set is divided into <em>k</em> equal
     parts (folds). The model is trained <em>k</em> times, each time holding one
     fold out as a local validation set and training on the remaining <em>k−1</em>.</p>
     <p>The final CV score is the average across all <em>k</em> runs. 5-fold is the
     standard default — it balances computational cost against estimate reliability.
     Use 3-fold for very small datasets or slow models. Use 10-fold for the most
     reliable estimate when you can afford the extra compute.</p>`
  );
  cvSection.appendChild(cvRow);
  form.appendChild(cvSection);

  // ── Save button ───────────────────────────────────────────────────────────────
  const saveBtn = el("button", {
    cls:  "btn btn-primary",
    text: "Save Configuration",
    id:   "model-config-save-btn",
  });
  form.appendChild(saveBtn);

  // ── Status section (shown after first save) ──────────────────────────────────
  const statusDiv = el("div", { cls: "model-config-status", id: "model-config-status" });
  statusDiv.style.display = "none";
  containerEl.appendChild(statusDiv);

  // ── Event handlers ────────────────────────────────────────────────────────────
  saveBtn.addEventListener("click", async () => {
    const test_split = parseFloat(splitInput.value);
    const cv_folds   = parseInt(cvSelect.value, 10);

    if (isNaN(test_split) || test_split < 0.05 || test_split > 0.50) {
      showError("Test split must be between 0.05 and 0.50.");
      return;
    }

    saveBtn.disabled = true;
    const resp = await post("/api/model/configure", {
      model_type:  selectedModel,
      test_split,
      cv_folds,
      hyperparams: _collectHyperparams(),
    });
    saveBtn.disabled = false;

    if (resp.success) {
      const typeLabel = MODEL_TYPES.find((m) => m.value === resp.config.model_type)?.label || resp.config.model_type;
      showSuccess(`Configuration saved — ${typeLabel}, ${Math.round(resp.config.test_split * 100)}% test split, ${resp.config.cv_folds}-fold CV.`);

      statusDiv.style.display = "";
      statusDiv.innerHTML = `
        <div class="model-config-status-saved">
          <span class="model-config-status-icon">✓</span>
          <span>Configuration saved.</span>
        </div>
      `;

      // ── Train button ───────────────────────────────────────────────────────
      let trainBtn = containerEl.querySelector("#model-train-btn");
      if (!trainBtn) {
        trainBtn = el("button", {
          cls:  "btn btn-primary model-config-train-btn",
          text: "Train Model →",
          id:   "model-train-btn",
        });
        statusDiv.appendChild(trainBtn);
      }

      trainBtn.onclick = async () => {
        trainBtn.disabled    = true;
        trainBtn.textContent = "Training…";
        showSpinner(trainBtn);

        const trainResp = await post("/api/model/train", {});
        hideSpinner(trainBtn);
        trainBtn.disabled    = false;
        trainBtn.textContent = "Train Model →";

        if (!trainResp.success) {
          showError(trainResp.message || "Training failed. Check your data and configuration.");
          return;
        }

        if (trainResp.results?.warnings?.length) {
          for (const w of trainResp.results.warnings) {
            showWarning(w, 10000);
          }
        }

        showSuccess("Model trained successfully.");
        await onTrain(trainResp.results);
      };
    } else {
      showError(resp.message || "Failed to save configuration.");
    }
  });
}
