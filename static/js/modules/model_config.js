// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/model_config.js
// Version: 3.0.0
// Description: Step 7 — Configure Training. Lets users choose a model type,
//              train/test split, and cross-validation folds. Shows a per-model
//              hyperparameter section (kernel/alpha for GPR, trees/depth/features
//              for RF, regularization for Linear). Saves to POST /api/model/configure,
//              then initiates training via POST /api/model/train. Auto-tune
//              checkbox runs POST /api/model/tune (GridSearchCV) before training.
// =============================================================================

import { get, post } from "../api.js";
import { showError, showSuccess, showWarning } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { registerPrimer } from "../learning_mode.js";
import { el, clearEl } from "../utils.js";
import { renderModelComparisonTable } from "../charts.js";
import { runDecisionTree } from "./learning_guide.js";
import { getPath, getAvailableCores } from "../state.js";

const HYPERPARAM_DEFAULTS = {
  gpr:     { kernel: "rbf", alpha: 0.1, n_restarts: 10 },
  kriging: { kernel: "matern25", alpha: 0.1, n_restarts: 10 },
  rf:      { n_estimators: 100, max_depth: null, min_samples_leaf: 1, max_features: "sqrt" },
  rbf:     { kernel: "thin_plate_spline", smoothing: 0.001 },
  pce:     { order: 3 },
  linear:  { alpha: 1.0 },
};

const MODEL_TYPES = [
  {
    value: "gpr",
    label: "Gaussian Process (GPR)",
    desc:  "Best for small datasets (< 5 000 rows). Provides prediction uncertainty — ideal for active learning and design space exploration.",
  },
  {
    value: "kriging",
    label: "Kriging (Matérn GPR)",
    desc:  "GPR variant with Matérn or Rational Quadratic kernel — often fits rougher aerospace response surfaces better than the default RBF kernel. Same uncertainty estimates as GPR.",
  },
  {
    value: "rf",
    label: "Random Forest",
    desc:  "Handles larger datasets and non-linear relationships well. Robust to outliers. No built-in uncertainty estimate.",
  },
  {
    value: "rbf",
    label: "Radial Basis Function (RBF)",
    desc:  "Exact interpolation through training points. Very fast inference. Best for 1 000–10 000 rows with smooth, well-behaved responses. No native uncertainty.",
  },
  {
    value: "pce",
    label: "Polynomial Chaos Expansion (PCE)",
    desc:  "Explicit polynomial formula — fully interpretable. Provides exact Sobol sensitivity indices analytically (free from expansion coefficients). Best for smooth, low-dimensional problems.",
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

  const [configResp, datasetsResp] = await Promise.all([
    get("/api/model/config"),
    get("/api/data/datasets"),
  ]);
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
       <li><strong>GPR</strong> — small datasets (< 5 000 rows), uncertainty needed.</li>
       <li><strong>Kriging</strong> — GPR with Matérn kernel; often better for rougher aerospace responses.</li>
       <li><strong>Random Forest</strong> — larger datasets, non-linear.</li>
       <li><strong>RBF</strong> — fast exact interpolation, 1 000–10 000 rows, smooth responses.</li>
       <li><strong>PCE</strong> — polynomial formula; free sensitivity indices; best for smooth, low-dimensional problems.</li>
       <li><strong>Linear</strong> — fast baseline, interpretable.</li>
     </ul>
     <p>Not sure which to pick? Use <strong>Compare All Models</strong> at the bottom to train all types at once and see which fits best.</p>`
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

  // ── Model selection guide ─────────────────────────────────────────────────────
  const guideSection = el("div", { cls: "model-config-section" });
  const guideToggle  = el("button", { cls: "model-guide-toggle", text: "▸ Help me choose — interactive guide" });
  const guideBody    = el("div", { cls: "model-guide-body hidden" });
  let   _guideLoaded = false;

  guideToggle.addEventListener("click", () => {
    const open = !guideBody.classList.contains("hidden");
    guideBody.classList.toggle("hidden", open);
    guideToggle.textContent = (open ? "▸" : "▾") + " Help me choose — interactive guide";
    if (!open && !_guideLoaded) {
      _guideLoaded = true;
      runDecisionTree(guideBody, "model_selection");
    }
  });

  guideSection.appendChild(guideToggle);
  guideSection.appendChild(guideBody);
  form.appendChild(guideSection);

  // ── Hyperparameters ───────────────────────────────────────────────────────────
  const hyperparamOuter = el("div", { id: "hyperparam-outer" });
  form.appendChild(hyperparamOuter);

  function _renderHyperparams(modelType, hp) {
    clearEl(hyperparamOuter);
    const defs = HYPERPARAM_DEFAULTS[modelType] || {};
    const merged = Object.assign({}, defs, hp || {});

    if (modelType === "gpr") {
      const _lvl = document.body.dataset.experience || "beginner";
      const _showRQ = _lvl === "intermediate" || _lvl === "expert";
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
              ${_showRQ ? `<option value="rq" ${merged.kernel === "rq" ? "selected" : ""}>Rational Quadratic</option>` : ""}
            </select>
          </div>
          <div class="hyperparam-row">
            <span class="hyperparam-label">Noise level (alpha)</span>
            <input id="hp-alpha" type="number" class="hyperparam-input" step="any" min="0.0001" max="10" value="${merged.alpha ?? 0.1}">
            <span class="hyperparam-hint">0.0001 – 10 — higher = more noise tolerance</span>
          </div>
          <div class="hyperparam-row">
            <span class="hyperparam-label">Optimizer restarts</span>
            <input id="hp-restarts" type="number" class="hyperparam-input" min="1" max="50" step="1" value="${merged.n_restarts ?? 10}">
            <span class="hyperparam-hint">1 – 50 — more restarts find better kernel parameters, slower training</span>
          </div>
        </div>`;
    } else if (modelType === "kriging") {
      hyperparamOuter.innerHTML = `
        <div class="hyperparam-section">
          <div class="hyperparam-section-header">
            <span class="hyperparam-section-label">Hyperparameters</span>
            <button class="hyperparam-reset" id="hp-reset">Reset to defaults</button>
          </div>
          <div class="hyperparam-row">
            <span class="hyperparam-label">Kernel</span>
            <select id="hp-kernel" class="hyperparam-select">
              <option value="matern25" ${(merged.kernel ?? "matern25") === "matern25" ? "selected" : ""}>Matérn ν=2.5 (default)</option>
              <option value="matern15" ${merged.kernel === "matern15" ? "selected" : ""}>Matérn ν=1.5</option>
              <option value="rq"       ${merged.kernel === "rq"       ? "selected" : ""}>Rational Quadratic</option>
            </select>
          </div>
          <div class="hyperparam-row">
            <span class="hyperparam-label">Noise level (alpha)</span>
            <input id="hp-alpha" type="number" class="hyperparam-input" step="any" min="0.0001" max="10" value="${merged.alpha ?? 0.1}">
            <span class="hyperparam-hint">0.0001 – 10 — higher = more noise tolerance</span>
          </div>
          <div class="hyperparam-row">
            <span class="hyperparam-label">Optimizer restarts</span>
            <input id="hp-restarts" type="number" class="hyperparam-input" min="1" max="50" step="1" value="${merged.n_restarts ?? 10}">
            <span class="hyperparam-hint">1 – 50 — more restarts find better kernel parameters, slower training</span>
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
    } else if (modelType === "rbf") {
      hyperparamOuter.innerHTML = `
        <div class="hyperparam-section">
          <div class="hyperparam-section-header">
            <span class="hyperparam-section-label">Hyperparameters</span>
            <button class="hyperparam-reset" id="hp-reset">Reset to defaults</button>
          </div>
          <div class="hyperparam-row">
            <span class="hyperparam-label">Basis function</span>
            <select id="hp-rbf-kernel" class="hyperparam-select">
              <option value="thin_plate_spline"  ${(merged.kernel ?? "thin_plate_spline") === "thin_plate_spline" ? "selected" : ""}>Thin-plate spline (default)</option>
              <option value="multiquadric"        ${merged.kernel === "multiquadric"       ? "selected" : ""}>Multiquadric</option>
              <option value="inverse_multiquadric" ${merged.kernel === "inverse_multiquadric" ? "selected" : ""}>Inverse multiquadric</option>
              <option value="gaussian"            ${merged.kernel === "gaussian"           ? "selected" : ""}>Gaussian</option>
              <option value="cubic"               ${merged.kernel === "cubic"              ? "selected" : ""}>Cubic</option>
            </select>
          </div>
          <div class="hyperparam-row">
            <span class="hyperparam-label">Smoothing</span>
            <input id="hp-rbf-smoothing" type="number" class="hyperparam-input" step="any" min="0" max="10" value="${merged.smoothing ?? 0.001}">
            <span class="hyperparam-hint">0 = exact interpolation; > 0 = regularized</span>
          </div>
        </div>`;
    } else if (modelType === "pce") {
      hyperparamOuter.innerHTML = `
        <div class="hyperparam-section">
          <div class="hyperparam-section-header">
            <span class="hyperparam-section-label">Hyperparameters</span>
            <button class="hyperparam-reset" id="hp-reset">Reset to defaults</button>
          </div>
          <div class="hyperparam-row">
            <span class="hyperparam-label">Polynomial order</span>
            <select id="hp-pce-order" class="hyperparam-select">
              <option value="1" ${(merged.order ?? 3) === 1 ? "selected" : ""}>1 — linear</option>
              <option value="2" ${(merged.order ?? 3) === 2 ? "selected" : ""}>2 — quadratic</option>
              <option value="3" ${(merged.order ?? 3) === 3 ? "selected" : ""}>3 — cubic (default)</option>
              <option value="4" ${(merged.order ?? 3) === 4 ? "selected" : ""}>4</option>
              <option value="5" ${(merged.order ?? 3) === 5 ? "selected" : ""}>5</option>
            </select>
            <span class="hyperparam-hint">Higher order = more terms; needs more training data</span>
          </div>
        </div>`;
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

    // Auto-tune row — only for model types that support GridSearchCV
    const supportsAutoTune = !["rbf", "pce"].includes(modelType);
    const hpSection = hyperparamOuter.querySelector(".hyperparam-section");
    if (hpSection) {
      if (supportsAutoTune) {
        const autoRow = document.createElement("div");
        autoRow.className = "hyperparam-row hyperparam-autotune-row";
        autoRow.innerHTML = `
          <label class="chart-settings-check">
            <input type="checkbox" id="hp-autotune">
            Auto-tune with GridSearchCV
          </label>
          <span class="hyperparam-hint">Find best hyperparameters automatically — slower; see Cores recommendation below for ideal setting</span>
        `;
        const autoNote = document.createElement("div");
        autoNote.className = "hp-autotune-note";
        autoNote.textContent = "Hyperparameters will be found automatically via grid search.";
        hpSection.appendChild(autoRow);
        hpSection.appendChild(autoNote);

        autoRow.querySelector("#hp-autotune").addEventListener("change", (e) => {
          hyperparamOuter.classList.toggle("hp-autotune-active", e.target.checked);
        });
      } else {
        const noTuneNote = document.createElement("div");
        noTuneNote.className = "hp-autotune-note";
        noTuneNote.textContent = "Auto-tune is not available for this model type.";
        hpSection.appendChild(noTuneNote);
      }
    }
  }

  function _collectHyperparams() {
    const hp = {};
    if (selectedModel === "gpr") {
      const k = hyperparamOuter.querySelector("#hp-kernel");
      const a = hyperparamOuter.querySelector("#hp-alpha");
      const r = hyperparamOuter.querySelector("#hp-restarts");
      if (k) hp.kernel    = k.value;
      if (a) hp.alpha     = parseFloat(a.value) || 0.1;
      if (r) hp.n_restarts = parseInt(r.value, 10) || 10;
    } else if (selectedModel === "kriging") {
      const k = hyperparamOuter.querySelector("#hp-kernel");
      const a = hyperparamOuter.querySelector("#hp-alpha");
      const r = hyperparamOuter.querySelector("#hp-restarts");
      if (k) hp.kernel    = k.value;
      if (a) hp.alpha     = parseFloat(a.value) || 0.1;
      if (r) hp.n_restarts = parseInt(r.value, 10) || 10;
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
    } else if (selectedModel === "rbf") {
      const k = hyperparamOuter.querySelector("#hp-rbf-kernel");
      const s = hyperparamOuter.querySelector("#hp-rbf-smoothing");
      if (k) hp.kernel   = k.value;
      if (s) hp.smoothing = parseFloat(s.value) || 0.001;
    } else if (selectedModel === "pce") {
      const o = hyperparamOuter.querySelector("#hp-pce-order");
      if (o) hp.order = parseInt(o.value, 10) || 3;
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

  // ── Cores recommendation prompt ───────────────────────────────────────────────
  const coresPrompt = el("div", { cls: "cores-prompt", id: "train-cores-prompt" });
  form.appendChild(coresPrompt);

  function _updateCoresPrompt() {
    const avail      = getAvailableCores() || "?";
    const current    = parseInt(document.getElementById("cores-input")?.value || "1", 10);
    const activeKey  = getPath("datasets.active_dataset_key");
    const outCols    = getPath(`datasets._datasets.${activeKey}.metadata.output_columns`, []);
    const nOut       = outCols.length;
    const autoTuneOn = !!hyperparamOuter.querySelector("#hp-autotune")?.checked;

    let title, lines, na = false;

    if (autoTuneOn) {
      // GridSearchCV parallelises param_combinations × CV_folds fits.
      // GPR: 3 kernels × 4 alphas × 5 folds = 60. RF: ~360+.
      // Ideal = all available cores; fits (60–360+) always exceed typical core count.
      const gridFits = (selectedModel === "rf") ? "~360" : "~60";
      title = "Auto-Tune — GridSearchCV";
      lines = [
        `Ideal: <strong>${avail} cores</strong> — ${gridFits} hyperparameter × fold combinations run in parallel`,
        `Currently set to <strong>${current}</strong>`,
      ];
    } else if (selectedModel === "gpr" || selectedModel === "kriging") {
      const label = selectedModel.toUpperCase();
      if (nOut > 1) {
        title = `${label} — ${nOut} outputs detected`;
        lines = [
          `Ideal: <strong>${nOut} cores</strong> — each output trains as an independent model in parallel`,
          `Currently set to <strong>${current}</strong> &nbsp;·&nbsp; <strong>${avail}</strong> available on this machine`,
        ];
      } else {
        title = `${label} — single output`;
        lines = [
          `Ideal: <strong>1 core</strong> — sklearn's GPR runs optimizer restarts sequentially; cores only help when you have multiple output columns`,
          `<strong>${avail}</strong> available on this machine`,
        ];
        na = true;
      }
    } else if (selectedModel === "rf") {
      title = "Random Forest";
      lines = [
        `Ideal: <strong>up to 8 cores</strong> — trees are built in parallel across all estimators`,
        `Currently set to <strong>${current}</strong> &nbsp;·&nbsp; <strong>${avail}</strong> available on this machine`,
      ];
    } else {
      title = `${selectedModel ? selectedModel.toUpperCase() : "This model type"} — no parallelism`;
      lines = [`Cores do not affect training speed for this model type`];
      na = true;
    }

    coresPrompt.className = `cores-prompt${na ? " cores-prompt--na" : ""}`;
    coresPrompt.innerHTML = `
      <span class="cores-prompt__icon">⚡</span>
      <div class="cores-prompt__body">
        <p class="cores-prompt__title">${title}</p>
        ${lines.map(l => `<p class="cores-prompt__line">${l}</p>`).join("")}
      </div>`;
  }

  typeOptions.addEventListener("click", _updateCoresPrompt);
  hyperparamOuter.addEventListener("change", _updateCoresPrompt);
  document.getElementById("cores-input")?.addEventListener("change", _updateCoresPrompt);
  _updateCoresPrompt();

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

  function _formatBestParams(modelType, params) {
    if (modelType === "gpr") {
      const names = { rbf: "RBF", matern15: "Matérn ν=1.5", matern25: "Matérn ν=2.5" };
      return `kernel = ${names[params.kernel] || params.kernel}  ·  noise = ${params.alpha}`;
    }
    if (modelType === "kriging") {
      const names = { matern15: "Matérn ν=1.5", matern25: "Matérn ν=2.5", rq: "Rational Quadratic" };
      return `kernel = ${names[params.kernel] || params.kernel}  ·  noise = ${params.alpha}`;
    }
    if (modelType === "rf") {
      const depth = params.max_depth ?? "unlimited";
      const feat  = { sqrt: "√n", log2: "log₂n", "0.5": "50%" };
      return `trees = ${params.n_estimators}  ·  depth = ${depth}  ·  features = ${feat[params.max_features] || params.max_features}`;
    }
    return `alpha = ${params.alpha}`;
  }

  function _renderTuneResultCard(tuneResp) {
    const existing = statusDiv.querySelector(".tune-result-card");
    if (existing) existing.remove();
    const card = document.createElement("div");
    card.className = "tune-result-card";
    card.innerHTML = `
      <div class="tune-result-card__header">✓ Best params found — R² = ${tuneResp.best_cv_r2.toFixed(3)} (${tuneResp.n_candidates} combinations tested)</div>
      <div class="tune-result-card__params">${_formatBestParams(selectedModel, tuneResp.best_params)}</div>
    `;
    const tb = statusDiv.querySelector("#model-train-btn");
    statusDiv.insertBefore(card, tb);
  }

  // ── Compare All Models section ────────────────────────────────────────────────
  const compareSection = el("div", { cls: "model-config-section model-compare-section" });
  const compareLabelEl = el("div", { cls: "model-config-section-label" });
  compareLabelEl.textContent = "Compare all models";
  const compareDesc = el("p", { cls: "section-desc", text: "Train all 6 model types with default hyperparameters on the same data split and compare accuracy side-by-side." });
  const compareNote = el("p", { cls: "cores-prompt__line", text: "" });
  compareNote.innerHTML = `⚡ Trains 6 models sequentially — more cores speeds each individual model (GPR benefits most). Set Cores in the header before running.`;
  compareNote.style.cssText = "font-size:var(--text-xs);color:var(--color-text-muted);margin:var(--space-1) 0 var(--space-2)";
  const compareBtn = el("button", { cls: "btn btn-secondary", text: "Compare All Models", id: "model-compare-btn" });
  const compareResultsDiv = el("div", { id: "model-compare-results" });
  compareSection.appendChild(compareLabelEl);
  compareSection.appendChild(compareDesc);
  compareSection.appendChild(compareNote);
  compareSection.appendChild(compareBtn);
  compareSection.appendChild(compareResultsDiv);
  containerEl.appendChild(compareSection);

  compareBtn.addEventListener("click", async () => {
    compareBtn.disabled = true;
    compareBtn.textContent = "Comparing…";
    showSpinner(compareBtn);
    const resp = await post("/api/model/compare", {});
    hideSpinner(compareBtn);
    compareBtn.disabled = false;
    compareBtn.textContent = "Compare All Models";
    if (!resp.success) {
      showError(resp.message || "Comparison failed. Make sure data is loaded and columns are designated.");
      return;
    }
    renderModelComparisonTable(compareResultsDiv, resp);
  });

  // ── Ensemble Builder section ──────────────────────────────────────────────────
  const ensembleSection = el("div", { cls: "model-config-section ensemble-builder-section" });
  const ensLabelEl = el("div", { cls: "model-config-section-label" });
  ensLabelEl.textContent = "Train Ensemble (Experimental)";
  const ensDesc = el("p", { cls: "section-desc",
    text: "Combine multiple model types into a weighted ensemble. Requires at least 2 components." });
  ensembleSection.appendChild(ensLabelEl);
  ensembleSection.appendChild(ensDesc);

  registerPrimer(
    "ensemble-builder",
    ensLabelEl,
    "How does the ensemble work?",
    `<p>An ensemble combines predictions from multiple surrogate model types, each trained independently on the same data.</p>
     <p><strong>Equal</strong> — all components weighted equally (1/n each).</p>
     <p><strong>CV Performance</strong> — components weighted by their cross-validation R² score; better-fitting models receive higher weight.</p>
     <p><strong>Stacking</strong> — trains a Ridge meta-model on out-of-fold predictions to learn the optimal blend automatically.</p>
     <p>If a component fails to train (e.g., PCE on a high-dimensional dataset), it is excluded and the remaining components continue.</p>`
  );

  const checksLabel = el("div", { cls: "model-config-section-label", text: "Components" });
  const checksGrid  = el("div", { cls: "ensemble-component-checks" });
  const ENS_TYPES  = ["gpr", "kriging", "rf", "rbf", "pce", "linear"];
  const ENS_LABELS = { gpr: "GPR", kriging: "Kriging", rf: "Random Forest", rbf: "RBF", pce: "PCE", linear: "Linear" };
  for (const t of ENS_TYPES) {
    const lbl = document.createElement("label");
    lbl.className = "ensemble-check-label";
    lbl.innerHTML = `<input type="checkbox" class="ens-comp-check" value="${t}"${["gpr", "rf"].includes(t) ? " checked" : ""}> ${ENS_LABELS[t]}`;
    checksGrid.appendChild(lbl);
  }
  ensembleSection.appendChild(checksLabel);
  ensembleSection.appendChild(checksGrid);

  const stratRow   = el("div", { cls: "model-config-row" });
  const stratLabel = el("span", { cls: "hyperparam-label", text: "Strategy" });
  const stratSel   = el("select", { cls: "model-config-select", id: "ens-strategy-select" });
  for (const [val, lbl] of [
    ["cv_performance", "CV Performance (recommended)"],
    ["equal",          "Equal weights"],
    ["stacking",       "Stacking (meta-model)"],
  ]) {
    const opt = document.createElement("option");
    opt.value = val; opt.textContent = lbl;
    stratSel.appendChild(opt);
  }
  stratRow.appendChild(stratLabel);
  stratRow.appendChild(stratSel);
  ensembleSection.appendChild(stratRow);

  const ensNote = el("p", { cls: "" });
  ensNote.innerHTML = `⚡ Each component model trains independently — more cores speeds each one (GPR/Kriging benefit most from 8–10 cores).`;
  ensNote.style.cssText = "font-size:var(--text-xs);color:var(--color-text-muted);margin:var(--space-2) 0 var(--space-1)";
  ensembleSection.appendChild(ensNote);

  const ensTrainBtn  = el("button", { cls: "btn btn-primary", text: "Train Ensemble →", id: "ens-train-btn" });
  const ensStatusDiv = el("div", { cls: "ens-status-note", id: "ens-status-note" });
  ensembleSection.appendChild(ensTrainBtn);
  ensembleSection.appendChild(ensStatusDiv);
  containerEl.appendChild(ensembleSection);

  ensTrainBtn.addEventListener("click", async () => {
    const componentTypes = [...checksGrid.querySelectorAll(".ens-comp-check:checked")].map(c => c.value);
    if (componentTypes.length < 2) {
      showError("Select at least 2 components for the ensemble.");
      return;
    }
    const strategy = stratSel.value;
    const cv_folds = parseInt(cvSelect.value, 10) || 5;

    ensTrainBtn.disabled = true;
    ensTrainBtn.textContent = "Training Ensemble…";
    showSpinner(ensTrainBtn);
    ensStatusDiv.textContent = "";

    const resp = await post("/api/model/train_ensemble", { component_types: componentTypes, strategy, cv_folds });
    hideSpinner(ensTrainBtn);
    ensTrainBtn.disabled = false;
    ensTrainBtn.textContent = "Train Ensemble →";

    if (!resp.success) {
      showError(resp.message || "Ensemble training failed.");
      return;
    }
    if (resp.results?.warnings?.length) {
      for (const w of resp.results.warnings) showWarning(w, 10000);
    }
    const nActive = resp.results?.ensemble_components?.length ?? 0;
    const nFailed = resp.results?.ensemble_failed?.length ?? 0;
    ensStatusDiv.textContent = `Ensemble trained — ${nActive} active component${nActive !== 1 ? "s" : ""}${nFailed > 0 ? `, ${nFailed} excluded` : ""}.`;
    showSuccess("Ensemble trained successfully.");
    await onTrain(resp.results);
  });

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
        const autoTune = hyperparamOuter.querySelector("#hp-autotune")?.checked;
        trainBtn.disabled = true;

        if (autoTune) {
          trainBtn.textContent = "Auto-tuning…";
          showSpinner(trainBtn);
          const tuneResp = await post("/api/model/tune", {});
          hideSpinner(trainBtn);
          if (!tuneResp.success) {
            showError(tuneResp.message || "Auto-tune failed. Check your data and configuration.");
            trainBtn.disabled    = false;
            trainBtn.textContent = "Train Model →";
            return;
          }
          _renderTuneResultCard(tuneResp);
        }

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

  // ── Multi-Fidelity Training section ──────────────────────────────────────
  const mfSection  = el("div", { cls: "model-config-section mf-section" });
  const mfLabelEl  = el("div", { cls: "model-config-section-label" });
  mfLabelEl.textContent = "Multi-Fidelity Training (Experimental)";
  const mfDesc = el("p", { cls: "section-desc",
    text: "Fuse cheap low-fidelity and expensive high-fidelity simulation data to build a more accurate surrogate at lower total simulation cost." });
  mfSection.appendChild(mfLabelEl);
  mfSection.appendChild(mfDesc);

  registerPrimer(
    "mf-training",
    mfLabelEl,
    "How does multi-fidelity training work?",
    `<p>Multi-fidelity modeling combines two datasets: many cheap <strong>low-fidelity</strong>
     runs (e.g., a panel code) and fewer expensive <strong>high-fidelity</strong> runs
     (e.g., a CFD solver).</p>
     <p><strong>Bridge Correction</strong>: trains a surrogate on all LF data, then learns
     an RF error model on the difference (y_hf − LF_pred) at HF points.
     Final prediction = LF prediction + error correction.</p>
     <p><strong>Co-Kriging (Kennedy-O'Hagan)</strong>: models f_hf = ρ·f_lf + δ, where ρ is
     a scale factor and δ is a GPR correction. Provides uncertainty estimates.
     Slower than bridge correction.</p>
     <p>Both datasets must share the same input and output column names.</p>`
  );

  const allDatasets = (datasetsResp && datasetsResp.success ? datasetsResp.datasets : []) || [];
  const readyDatasets = allDatasets.filter(
    d => (d.input_columns && d.input_columns.length > 0) &&
         (d.output_columns && d.output_columns.length > 0)
  );

  if (readyDatasets.length < 2) {
    const note = el("p", { cls: "mf-unavailable-note",
      text: "Load and designate at least two datasets with matching input/output columns to enable multi-fidelity training." });
    mfSection.appendChild(note);
  } else {
    // LF selector
    const lfRow = el("div", { cls: "mf-selector-row" });
    const lfLbl = el("span", { cls: "hyperparam-label", text: "Low-fidelity dataset" });
    const lfSel = el("select", { cls: "model-config-select", id: "mf-lf-select" });
    for (const d of readyDatasets) {
      const opt = document.createElement("option");
      opt.value = d.key; opt.textContent = `${d.filename} (${d.n_rows.toLocaleString()} rows)`;
      lfSel.appendChild(opt);
    }
    lfRow.appendChild(lfLbl);
    lfRow.appendChild(lfSel);
    mfSection.appendChild(lfRow);

    // HF selector (default to second dataset)
    const hfRow = el("div", { cls: "mf-selector-row" });
    const hfLbl = el("span", { cls: "hyperparam-label", text: "High-fidelity dataset" });
    const hfSel = el("select", { cls: "model-config-select", id: "mf-hf-select" });
    for (let i = 0; i < readyDatasets.length; i++) {
      const d = readyDatasets[i];
      const opt = document.createElement("option");
      opt.value = d.key; opt.textContent = `${d.filename} (${d.n_rows.toLocaleString()} rows)`;
      if (i === 1) opt.selected = true;
      hfSel.appendChild(opt);
    }
    hfRow.appendChild(hfLbl);
    hfRow.appendChild(hfSel);
    mfSection.appendChild(hfRow);

    // Method selector
    const methodRow = el("div", { cls: "mf-selector-row" });
    const methodLbl = el("span", { cls: "hyperparam-label", text: "Method" });
    const methodSel = el("select", { cls: "model-config-select", id: "mf-method-select" });
    for (const [val, lbl] of [
      ["bridge",     "Bridge Correction (recommended)"],
      ["co_kriging", "Co-Kriging / Kennedy-O'Hagan"],
    ]) {
      const opt = document.createElement("option");
      opt.value = val; opt.textContent = lbl;
      methodSel.appendChild(opt);
    }
    methodRow.appendChild(methodLbl);
    methodRow.appendChild(methodSel);
    mfSection.appendChild(methodRow);

    // LF surrogate type for bridge
    const baseRow    = el("div", { cls: "mf-selector-row", id: "mf-base-row" });
    const baseLbl    = el("span", { cls: "hyperparam-label", text: "LF surrogate type" });
    const baseSel    = el("select", { cls: "model-config-select", id: "mf-base-select" });
    for (const [val, lbl] of [
      ["rf",      "Random Forest (recommended)"],
      ["gpr",     "Gaussian Process (GPR)"],
      ["kriging", "Kriging"],
      ["linear",  "Linear"],
    ]) {
      const opt = document.createElement("option");
      opt.value = val; opt.textContent = lbl;
      baseSel.appendChild(opt);
    }
    baseRow.appendChild(baseLbl);
    baseRow.appendChild(baseSel);
    mfSection.appendChild(baseRow);

    methodSel.addEventListener("change", () => {
      baseRow.style.display = methodSel.value === "bridge" ? "" : "none";
    });

    const mfNote = el("p", { cls: "" });
    mfNote.innerHTML = `⚡ Bridge trains an LF surrogate + an RF error model; Co-Kriging trains GPR models — both benefit from more cores. GPR/Kriging: up to 10 cores.`;
    mfNote.style.cssText = "font-size:var(--text-xs);color:var(--color-text-muted);margin:var(--space-2) 0 var(--space-1)";
    mfSection.appendChild(mfNote);

    const mfTrainBtn  = el("button", { cls: "btn btn-primary", text: "Train Multi-Fidelity →", id: "mf-train-btn" });
    const mfStatusDiv = el("div", { cls: "mf-status-note", id: "mf-status-note" });
    mfSection.appendChild(mfTrainBtn);
    mfSection.appendChild(mfStatusDiv);

    mfTrainBtn.addEventListener("click", async () => {
      const lf_key        = lfSel.value;
      const hf_key        = hfSel.value;
      const method        = methodSel.value;
      const base_model_type = baseSel.value;
      const cv_folds      = parseInt(cvSelect.value, 10) || 5;

      if (lf_key === hf_key) {
        showError("Low-fidelity and high-fidelity datasets must be different.");
        return;
      }

      mfTrainBtn.disabled = true;
      mfTrainBtn.textContent = "Training…";
      showSpinner(mfTrainBtn);
      mfStatusDiv.textContent = "";

      const resp = await post("/api/model/train_multifidelity", {
        lf_dataset_key: lf_key, hf_dataset_key: hf_key,
        method, base_model_type, cv_folds,
      });
      hideSpinner(mfTrainBtn);
      mfTrainBtn.disabled = false;
      mfTrainBtn.textContent = "Train Multi-Fidelity →";

      if (!resp.success) {
        showError(resp.message || "Multi-fidelity training failed.");
        return;
      }
      if (resp.results?.warnings?.length) {
        for (const w of resp.results.warnings) showWarning(w, 10000);
      }
      const methodLabel = method === "bridge" ? "Bridge Correction" : "Co-Kriging";
      mfStatusDiv.textContent = `${methodLabel} trained — LF: ${resp.results.n_train.toLocaleString()} rows, HF: ${resp.results.n_test.toLocaleString()} rows.`;
      showSuccess("Multi-fidelity model trained successfully.");
      await onTrain(resp.results);
    });
  }

  containerEl.appendChild(mfSection);
}
