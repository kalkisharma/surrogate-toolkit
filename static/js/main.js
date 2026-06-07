// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/main.js
// Version: 3.6.1
// Description: SPA entry point. Bootstraps global header (theme, level, cores,
//              learning mode, save/open), renders the upload view, and drives the
//              workflow panel router (sidebar + 16 lazy-init panels).
// =============================================================================

import { initLearningMode, registerPrimer } from "./learning_mode.js";
import { get, post, put } from "./api.js";
import { refreshState, getPath, getAvailableCores } from "./state.js";
import { showSuccess, showError, showWarning, getNotifLog, clearUnseen, clearLog } from "./notifications.js";
import { showSpinner, hideSpinner } from "./loading.js";
import { initExploration, updateColumnSelectorRoles, notifyExploreVisible, buildIOSection } from "./modules/data_explorer.js";
import { initCleaning } from "./modules/data_cleaning.js";
import { initDesignation } from "./modules/column_designation.js";
import { initNormalization } from "./modules/normalization.js";
import { initModelConfig } from "./modules/model_config.js";
import { initResults } from "./modules/results.js";
import { initPrediction } from "./modules/prediction.js";
import { initInterpretation } from "./modules/interpretation.js";
import { initSubset } from "./modules/data_subset.js";
import { initScreening } from "./modules/input_screening.js";
import { initActiveLearning } from "./modules/active_learning.js";
import { initOptimization } from "./modules/optimization.js";
import { initComparison } from "./modules/comparison.js";
import { initExport } from "./modules/export.js";
import { el, clearEl, escHtml } from "./utils.js";
import { openGuide, closeGuide, resetExercise } from "./modules/learning_guide.js";

// ── Exercise integration ──────────────────────────────────────────────────────
// Mutable reference to the current activatePanel closure — updated every time
// _renderExploration initialises a new panel set. This lets module-level event
// listeners reach the panel router without needing to be inside _renderExploration.
let _activatePanelFn = null;

document.addEventListener("exercise:navigate", (e) => {
  const { panel } = e.detail;
  if (_activatePanelFn && panel) _activatePanelFn(panel);
});

document.addEventListener("exercise:loaded", async (e) => {
  await _renderExploration(e.detail.result);
  await _refreshDatasetSwitcher();
});

// ── Experience level ──────────────────────────────────────────────────────────

// ── Bootstrap ─────────────────────────────────────────────────────────────────

(async () => {
  const learningToggle = document.getElementById("learning-toggle");
  initLearningMode(learningToggle);
  _initGlobalHeader();
  await refreshState();
  _updateCoresDisplay();
  // If STATE already has datasets (e.g. after loading a .surrogate file),
  // restore the exploration view without requiring a new upload.
  const datasetsResp = await get("/api/data/datasets");
  if (datasetsResp.success && datasetsResp.count > 0) {
    const active = datasetsResp.datasets.find(d => d.active) || datasetsResp.datasets[0];
    await _renderExploration(_buildUploadMetaFromDataset(active));
    if (datasetsResp.count > 1) _refreshDatasetSwitcher();
  } else {
    renderUploadView();
  }
})();

// ── Module state ──────────────────────────────────────────────────────────────

/** Stored so it can be removed before re-wiring when the active dataset changes. */
let _headerFileHandler = null;

/** True after any upload or training; cleared after save or load. */
let _hasUnsavedChanges = false;

// ── Views ─────────────────────────────────────────────────────────────────────

function getApp() {
  return document.getElementById("app");
}

/** Enable or disable the Project dropdown "Load CSV" button. */
function _setLoadFileVisible(visible) {
  const btn = document.getElementById("header-load-file-btn");
  if (btn) btn.disabled = !visible;
}

/** Render the entry / upload view into #app. */
function renderUploadView() {
  _setLoadFileVisible(false);
  const app = getApp();
  clearEl(app);

  const hero = el("div", { cls: "hero" });
  hero.innerHTML = `
    <div class="hero__badge">Surrogate Modeling Toolkit</div>
    <h1 class="hero__title">Build fast surrogate models from your data</h1>
    <p class="hero__subtitle">Upload your data. Normalize. Train. Validate. All on your machine.</p>
  `;
  app.appendChild(hero);
  registerPrimer(
    "entry",
    hero,
    "New to surrogate modeling? Start here",
    `<p>A <strong>surrogate model</strong> (also called a response surface or metamodel)
     is a fast, cheap mathematical approximation of an expensive simulation or experiment.
     You train it on a small set of known data points, then use it to predict outputs
     for new inputs in milliseconds instead of hours.</p>
     <p>Common uses: design space exploration, uncertainty analysis, optimization,
     sensitivity studies — anywhere you need many evaluations but can't afford to run
     the full model each time.</p>`
  );

  const uploadSection = el("div", { cls: "card", style: "max-width: 640px; margin: 0 auto;" });
  const uploadTitle   = el("div", { cls: "section-header" });
  uploadTitle.innerHTML = `
    <h2 class="section-title">Step 1 — Upload Your Data</h2>
    <p class="section-desc">CSV format. All columns must be numeric. Maximum 500 MB.</p>
  `;
  uploadSection.appendChild(uploadTitle);

  registerPrimer(
    "upload",
    uploadTitle,
    "What format should my CSV be in?",
    `<p>Your CSV should have one row per data point and one column per variable.
     The first row must be a header with column names.</p>
     <p><strong>Inputs</strong> go in the left columns, <strong>outputs</strong> on the right —
     but you'll define which is which in a later step.</p>
     <p>All values must be numeric (integers or decimals). String columns are flagged on upload.</p>`
  );

  const dropZone = el("div", { cls: "upload-zone", id: "drop-zone", role: "button",
    tabindex: "0", "aria-label": "Drop CSV file here or click to browse" });
  dropZone.innerHTML = `
    <div class="upload-zone__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="16 16 12 12 8 16"/>
        <line x1="12" y1="12" x2="12" y2="21"/>
        <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
      </svg>
    </div>
    <div class="upload-zone__title">Drag &amp; drop your CSV file here</div>
    <div class="upload-zone__subtitle">or</div>
    <label class="upload-zone__browse" for="file-input">Browse files</label>
    <input type="file" id="file-input" accept=".csv" style="display:none" aria-label="Choose CSV file">
  `;
  uploadSection.appendChild(dropZone);
  app.appendChild(uploadSection);

  const fileInput = uploadSection.querySelector("#file-input");
  let dropEnabled = true;
  _wireDropZone(dropZone, fileInput, uploadSection, (response) => {
    dropEnabled = false;
    _renderInlineGate(uploadSection, response);
  }, () => dropEnabled);
}

/**
 * Modal gate for additional file uploads.
 * Opens a <dialog> overlay; blocks interaction until the user selects a
 * data type and confirms, or cancels. The workflow view stays visible behind.
 */
function _renderAdditionalFileGate(app, uploadResponse) {
  const existing = document.getElementById("additional-gate");
  if (existing) { existing.close(); existing.remove(); }

  const dialog = document.createElement("dialog");
  dialog.id        = "additional-gate";
  dialog.className = "gate-modal";

  const meta = uploadResponse.metadata;
  dialog.innerHTML = `
    <div class="gate-modal__header">
      <strong class="gate-modal__filename">${escHtml(meta.filename)}</strong>
      <span class="gate-modal__subtitle">Select data type to continue</span>
    </div>
    <div class="gate-options gate-modal__options" id="ag-options"></div>
    <div class="gate-modal__actions">
      <button class="btn btn-primary" id="ag-confirm" disabled>Confirm →</button>
      <button class="btn btn-secondary" id="ag-cancel">Cancel</button>
    </div>
  `;

  let selectedType  = null;
  const confirmBtn  = dialog.querySelector("#ag-confirm");
  const optionsWrap = dialog.querySelector("#ag-options");

  for (const opt of [
    { value: "simulation",   label: "Simulation / CFD output" },
    { value: "experimental", label: "Experimental measurements" },
    { value: "mixed",        label: "Mixed / Unknown" },
  ]) {
    const wrapper = el("div", { cls: "gate-option" });
    const radio   = el("input", { type: "radio", name: "ag-type", id: `ag-${opt.value}`, value: opt.value });
    const label   = el("label", { cls: "gate-option__label", for: `ag-${opt.value}`, text: opt.label });
    radio.addEventListener("change", () => { selectedType = opt.value; confirmBtn.disabled = false; });
    wrapper.appendChild(radio);
    wrapper.appendChild(label);
    optionsWrap.appendChild(wrapper);
  }

  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled    = true;
    confirmBtn.textContent = "Saving…";
    await put("/api/state/session", { data_type: selectedType });
    await refreshState();
    dialog.close();
    dialog.remove();
    _renderExploration(uploadResponse);
    _refreshDatasetSwitcher();
  });

  const closeModal = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector("#ag-cancel").addEventListener("click", closeModal);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) closeModal(); });

  document.body.appendChild(dialog);
  dialog.showModal();
}

/** Replace the drop zone with a success row + inline data-type gate within the upload card. */
function _renderInlineGate(uploadSection, uploadResponse) {
  const meta = uploadResponse.metadata;

  const dz = uploadSection.querySelector("#drop-zone");
  if (dz) dz.remove();

  const successRow = el("div", { cls: "upload-success" });
  successRow.innerHTML = `
    <span class="upload-success__icon">✓</span>
    <span class="upload-success__text">
      <strong>${escHtml(meta.filename)}</strong>
      <span class="upload-success__meta">${meta.n_rows.toLocaleString()} rows · ${meta.n_cols} columns</span>
    </span>
  `;
  uploadSection.appendChild(successRow);

  const divider = el("hr", { cls: "divider", style: "margin: var(--space-5) 0 var(--space-4);" });
  uploadSection.appendChild(divider);

  const gateHeader = el("div", { cls: "section-header" });
  gateHeader.innerHTML = `
    <h2 class="section-title">Data Type</h2>
    <p class="section-desc">One question before we explore your data.</p>
  `;
  uploadSection.appendChild(gateHeader);

  let selectedDataType = null;
  const confirmBtn = el("button", {
    cls: "btn btn-primary",
    text: "Continue to Explore Data →",
    style: "margin-top: var(--space-5); width: 100%;",
  });
  confirmBtn.disabled = true;

  const gate1 = _makeGate(
    null,
    "What type of data are you working with?",
    [
      { value: "simulation",   label: "Simulation / CFD output",   desc: "Deterministic runs — values repeat identically each time." },
      { value: "experimental", label: "Experimental measurements", desc: "Measured data — expect natural variability and noise." },
      { value: "mixed",        label: "Mixed / Unknown",           desc: "Unsure? Pick this — you can always note it later." },
    ],
    (val) => { selectedDataType = val; confirmBtn.disabled = false; }
  );
  gate1.classList.add("active");
  uploadSection.appendChild(gate1);
  uploadSection.appendChild(confirmBtn);
  setTimeout(() => gateHeader.scrollIntoView({ behavior: "smooth", block: "start" }), 80);

  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled    = true;
    confirmBtn.textContent = "Saving…";
    await put("/api/state/session", { data_type: selectedDataType });
    await refreshState();
    _renderExploration(uploadResponse);
  });
}

// ── Workflow exploration view ─────────────────────────────────────────────────

/** Render the workflow panel router (sidebar + 15 lazy-init panels) into #app. */
async function _renderExploration(uploadResponse) {
  const app = getApp();
  clearEl(app);
  _setLoadFileVisible(true);

  // Re-wire the header "Load File" input for this dataset's upload flow.
  const headerAddInput = document.getElementById("header-add-file-input");
  if (headerAddInput) {
    if (_headerFileHandler) headerAddInput.removeEventListener("change", _headerFileHandler);
    _headerFileHandler = () => {
      if (!headerAddInput.files[0]) return;
      const file = headerAddInput.files[0];
      headerAddInput.value = "";
      _handleFile(file, document.getElementById("header-load-file-btn"), (resp) => {
        _renderAdditionalFileGate(app, resp);
      });
    };
    headerAddInput.addEventListener("change", _headerFileHandler);
  }

  const meta = uploadResponse.metadata;

  // Mutable cross-panel state — updated by designation callback
  let _currentInputCols  = meta.input_columns  || [];
  let _currentOutputCols = meta.output_columns || [];
  let _currentErrorCols  = meta.error_columns  || {};   // Phase 22B: {output_col: error_col}
  let _currentNorm       = meta.normalization_method || null;
  let _currentModelType  = null;   // set after training; drives Results sidebar badge

  // ── Layout skeleton ───────────────────────────────────────────────────────
  const layout    = el("div", { cls: "workflow-layout" });
  const sidebarEl = el("nav",  { cls: "workflow-sidebar", id: "workflow-sidebar",
    "aria-label": "Workflow steps" });
  const panelArea = el("div",  { cls: "workflow-panel-area" });
  layout.appendChild(sidebarEl);
  layout.appendChild(panelArea);
  app.appendChild(layout);

  // ── Panel containers ──────────────────────────────────────────────────────
  const STEP_KEYS   = ["upload", "preview", "explore", "clean", "subset", "designate", "normalize", "screen", "configure", "results", "predict", "optimize", "interpret", "active", "compare", "export"];
  const STEP_LABELS = { upload: "Upload", preview: "Preview", explore: "Explore", clean: "Clean",
                        subset: "Subset",
                        designate: "Assign", normalize: "Normalize", screen: "Filter", configure: "Model",
                        results: "Results", predict: "Predict", optimize: "Optimize",
                        interpret: "Interpret", active: "Sample", compare: "Compare", export: "Export" };
  const STEP_NUMS   = { upload: 1, preview: 2, explore: 3, clean: 4,
                        subset: 5,
                        designate: 6, normalize: 7, screen: 8, configure: 9, results: 10, predict: 11,
                        optimize: 12, interpret: 13, active: 14, compare: 15, export: 16 };

  const panelEls      = {};   // outer panel div — used only for .hidden toggling
  const _panelContent = {};   // inner content div — passed to modules; clearable
  const _panelSubEl   = {};   // inner subtitle div — stable; never cleared by modules
  const panelDone = {};
  for (const key of STEP_KEYS) {
    const p    = el("div", { cls: "workflow-panel hidden" });
    const sub  = el("div");
    const cont = el("div");
    p.appendChild(sub);
    p.appendChild(cont);
    panelArea.appendChild(p);
    panelEls[key]      = p;
    _panelContent[key] = cont;
    _panelSubEl[key]   = sub;
    panelDone[key]     = false;
  }

  // ── Step state ────────────────────────────────────────────────────────────
  const hasDesignation = _currentInputCols.length > 0;
  const stepUnlocked = {
    upload: true, preview: true, explore: true, clean: true, subset: true, designate: true,
    normalize: hasDesignation, screen: hasDesignation, configure: hasDesignation,
    results: false, predict: false, optimize: false,
    interpret: false, active: false, compare: false, export: hasDesignation,
  };
  const stepCompleted = {
    upload: true, preview: false, explore: false, clean: false, subset: false,
    designate: hasDesignation, normalize: false, screen: false, configure: false,
    results: false, predict: false, optimize: false,
    interpret: false, active: false, compare: false, export: false,
  };

  let _activeKey = "explore";

  // ── Sidebar ───────────────────────────────────────────────────────────────
  function buildSidebar() {
    clearEl(sidebarEl);

    const collapseBtn  = el("button", { cls: "sidebar-collapse-btn" });
    collapseBtn.type   = "button";
    collapseBtn.title  = "Toggle sidebar";
    collapseBtn.setAttribute("aria-label", "Toggle sidebar");
    collapseBtn.textContent = "‹";
    collapseBtn.addEventListener("click", () => {
      const collapsed = sidebarEl.classList.toggle("workflow-sidebar--collapsed");
      collapseBtn.textContent = collapsed ? "›" : "‹";
    });
    sidebarEl.appendChild(collapseBtn);

    const prepareDivider = el("div", { cls: "sidebar-group-divider sidebar-group-divider--first" });
    prepareDivider.innerHTML = `<span class="sidebar-group-label">Prepare</span>`;
    sidebarEl.appendChild(prepareDivider);

    for (const key of STEP_KEYS) {
      const isActive   = key === _activeKey;
      const isLocked   = !stepUnlocked[key];
      const isComplete = stepCompleted[key] && !isActive;

      let cls = "step-item";
      if (isActive)   cls += " step-item--active";
      if (isLocked)   cls += " step-item--locked";
      if (isComplete) cls += " step-item--complete";

      const item  = el("div", { cls });
      const numEl = el("span", { cls: "step-item__num",   text: String(STEP_NUMS[key]) });
      const lblEl = el("span", { cls: "step-item__label", text: STEP_LABELS[key] });
      const icnEl = el("span", { cls: "step-item__icon",
        text: isLocked ? "🔒" : isComplete ? "✓" : "" });

      if (key === "configure") {
        const divider = el("div", { cls: "sidebar-group-divider" });
        divider.innerHTML = `<span class="sidebar-group-label">Train</span>`;
        sidebarEl.appendChild(divider);
      }
      if (key === "predict") {
        const divider = el("div", { cls: "sidebar-group-divider" });
        divider.innerHTML = `<span class="sidebar-group-label">Tools</span>`;
        sidebarEl.appendChild(divider);
      }

      item.appendChild(numEl);
      item.appendChild(lblEl);
      if (key === "results" && _currentModelType) {
        const badgeEl = el("span", { cls: "step-item__model-badge",
          text: _currentModelType.toUpperCase() });
        item.appendChild(badgeEl);
      }
      item.appendChild(icnEl);
      sidebarEl.appendChild(item);

      if (!isLocked) item.addEventListener("click", () => activatePanel(key));
    }
  }

  // ── Panel activation ──────────────────────────────────────────────────────
  // Expose to module-level exercise:navigate listener
  _activatePanelFn = null;   // reset before redefining so the old closure is not reused mid-rebuild

  async function activatePanel(key) {
    if (!stepUnlocked[key]) return;
    _activeKey = key;
    for (const k of STEP_KEYS) panelEls[k].classList.toggle("hidden", k !== key);
    window.scrollTo({ top: 0, behavior: "instant" });
    buildSidebar();
    put("/api/state/session", { active_tab: key }).catch(() => {});
    if (!panelDone[key]) {
      panelDone[key] = true;
      await _initPanel(key, _panelContent[key]);
    }
    if (key === "explore") {
      notifyExploreVisible();
      const splom = document.getElementById("splom-container");
      if (splom) requestAnimationFrame(() => Plotly.Plots.resize(splom));
    }
  }

  // Register with module-level exercise:navigate listener
  _activatePanelFn = activatePanel;


  // ── Per-panel subtitle ────────────────────────────────────────────────────
  // Writes to the stable _panelSubEl[key] div — outside the content div that
  // modules can freely clearEl without touching the subtitle.
  function _subtitle(key) {
    clearEl(_panelSubEl[key]);
    const sub = el("p", { cls: "panel-file-meta" });
    sub.innerHTML = `<strong>${escHtml(meta.filename)}</strong> — ${meta.n_rows.toLocaleString()} rows × ${meta.n_cols} columns`;
    _panelSubEl[key].appendChild(sub);
  }

  // ── Panel dispatch ────────────────────────────────────────────────────────
  async function _initPanel(key, container) {
    switch (key) {
      case "upload":    _initUploadPanel(container, key);         break;
      case "preview":   _initPreviewPanel(container, key);        break;
      case "explore":   await _initExplorePanel(container, key);  break;
      case "clean":     await _initCleanPanel(container, key);    break;
      case "subset":    await _initSubsetPanel(container, key);   break;
      case "designate": _initDesignatePanel(container, key);         break;
      case "normalize": _initNormalizePanel(container, key);         break;
      case "screen":    await _initScreenPanel(container, key);      break;
      case "configure": _initConfigurePanel(container, key);         break;
      case "results":    await _initResultsPanel(container, key);    break;
      case "predict":    await _initPredictPanel(container, key);    break;
      case "optimize":   await _initOptimizePanel(container, key);         break;
      case "interpret":  await _initInterpretPanel(container, key);       break;
      case "active":     await _initActiveLearningPanel(container, key);  break;
      case "compare":    await _initComparePanel(container, key);         break;
      case "export":     await _initExportPanel(container, key);          break;
    }
  }

  // ── Step 1 — Upload (status panel; actual upload is the separate view) ────
  function _initUploadPanel(container, key) {
    _subtitle(key);
    const card = el("div", { cls: "card" });
    card.innerHTML = `
      <h2 class="section-title">Step 1 — Upload</h2>
      <p class="section-desc" style="margin-top:var(--space-3)">
        <strong>${escHtml(meta.filename)}</strong> is loaded
        (${meta.n_rows.toLocaleString()} rows × ${meta.n_cols} columns).
        Use <strong>+ Load File</strong> in the header to add a second dataset,
        or <strong>✕ Clear</strong> to reset and start over.
      </p>
    `;
    container.appendChild(card);
  }

  // ── Step 2 — Preview ──────────────────────────────────────────────────────
  function _initPreviewPanel(container, key) {
    _subtitle(key);
    const card  = el("div", { cls: "card" });
    const title = el("h3", { cls: "section-title",
      text: `Step 2 — Data Preview (first ${uploadResponse.preview.rows.length} rows)`,
      style: "margin-bottom: var(--space-4);" });
    card.appendChild(title);
    card.appendChild(_buildPreviewTable(uploadResponse.preview, meta.null_counts));
    container.appendChild(card);
  }

  // ── Step 3 — Explore ──────────────────────────────────────────────────────
  async function _initExplorePanel(container, key) {
    _subtitle(key);
    await initExploration(container, uploadResponse);
  }

  // ── Step 4 — Clean ────────────────────────────────────────────────────────
  async function _initCleanPanel(container, key) {
    clearEl(container);
    _subtitle(key);
    const onClean = async () => {
      // Invalidate explore so it re-fetches fresh data on next visit
      panelDone["explore"] = false;
      clearEl(_panelContent["explore"]);
      // Sync meta.null_counts and meta.n_rows so Assign panel shows live values
      const freshSummary = await get("/api/data/summary");
      if (freshSummary.success && freshSummary.stats) {
        const freshNulls = {};
        for (const [col, s] of Object.entries(freshSummary.stats)) {
          freshNulls[col] = s.null_count ?? 0;
        }
        meta.null_counts = freshNulls;
        meta.n_rows = freshSummary.n_rows ?? meta.n_rows;
      }
      // Refresh clean panel itself to show updated stats
      await _initCleanPanel(container, key);
    };
    await initCleaning(container, onClean);
  }

  // ── Step 5 — Subset ───────────────────────────────────────────────────────
  async function _initSubsetPanel(container, key) {
    clearEl(container);
    _subtitle(key);
    await initSubset(container);

    async function _refreshMeta() {
      const freshSummary = await get("/api/data/summary");
      if (freshSummary.success) {
        meta.n_rows = freshSummary.n_rows ?? meta.n_rows;
        const freshNulls = {};
        for (const [col, s] of Object.entries(freshSummary.stats || {})) {
          freshNulls[col] = s.null_count ?? 0;
        }
        meta.null_counts = freshNulls;
      }
      // Refresh subtitles for every panel that has already been initialized
      for (const k of STEP_KEYS) {
        if (panelDone[k]) _subtitle(k);
      }
      // Update header upload-success row count if present
      const uploadMeta = document.querySelector(".upload-success__meta");
      if (uploadMeta) {
        uploadMeta.textContent = `${meta.n_rows.toLocaleString()} rows · ${meta.n_cols} columns`;
      }
    }

    container.addEventListener("subset:committed", async () => {
      await _refreshMeta();
      // Invalidate explore and clean so they re-fetch on next visit
      panelDone["explore"] = false;
      panelDone["clean"]   = false;
      clearEl(_panelContent["explore"]);
      clearEl(_panelContent["clean"]);
      stepCompleted["subset"] = true;
      buildSidebar();
    }, { once: false });

    container.addEventListener("subset:undone", async () => {
      await _refreshMeta();
      // Invalidate explore and clean so they re-fetch fresh unsubsetted data
      panelDone["explore"] = false;
      panelDone["clean"]   = false;
      clearEl(_panelContent["explore"]);
      clearEl(_panelContent["clean"]);
      stepCompleted["subset"] = false;
      buildSidebar();
    }, { once: false });
  }

  // ── Step 6 — Designate ────────────────────────────────────────────────────
  function _initDesignatePanel(container, key) {
    _subtitle(key);
    const allCols   = meta.columns || uploadResponse.preview.columns || [];
    const ioWrap    = el("div");
    let _cachedRows = null;

    async function _renderIO(inputCols, outputCols) {
      if (!_cachedRows) {
        const resp  = await get("/api/data/rows");
        _cachedRows = resp.success ? (resp.rows || []) : [];
      }
      clearEl(ioWrap);
      buildIOSection(ioWrap, _cachedRows, inputCols, outputCols, allCols);
    }

    initDesignation(
      container,
      allCols,
      meta.dtypes      || {},
      meta.null_counts  || {},
      meta.n_rows,
      _currentInputCols,
      _currentOutputCols,
      ({ input_columns, output_columns, error_columns }) => {
        _currentInputCols  = input_columns;
        _currentOutputCols = output_columns;
        _currentErrorCols  = error_columns || {};
        _currentNorm       = null;

        stepUnlocked["normalize"]  = true;
        stepUnlocked["screen"]     = true;
        stepUnlocked["configure"]  = true;
        stepUnlocked["export"]     = true;
        stepCompleted["designate"] = true;
        buildSidebar();

        updateColumnSelectorRoles(input_columns, output_columns);

        if (panelDone["normalize"]) { panelDone["normalize"] = false; clearEl(_panelContent["normalize"]); }
        if (panelDone["configure"]) { panelDone["configure"] = false; clearEl(_panelContent["configure"]); }

        _renderIO(input_columns, output_columns).then(() => {
          ioWrap.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      },
      _currentErrorCols,
      meta.zero_variance_columns || [],
    );

    container.appendChild(ioWrap);
    if (_currentInputCols.length && _currentOutputCols.length) {
      _renderIO(_currentInputCols, _currentOutputCols);
    }
  }

  // ── Step 7 — Normalize ────────────────────────────────────────────────────
  function _initNormalizePanel(container, key) {
    clearEl(container);
    _subtitle(key);
    initNormalization(container, _currentNorm, _currentInputCols.length, (method) => {
      _currentNorm = method;
      stepCompleted["normalize"] = true;
      panelDone["configure"] = false;
      clearEl(_panelContent["configure"]);
      buildSidebar();
    });
  }

  // ── Step 8 — Screen Inputs ────────────────────────────────────────────────
  async function _initScreenPanel(container, key) {
    clearEl(container);
    _subtitle(key);
    await initScreening(container, _currentInputCols);
    // Listen for Apply — refresh input cols and mark step complete
    container.addEventListener("screen:applied", (e) => {
      _currentInputCols = e.detail.input_columns;
      stepCompleted["screen"] = true;
      // Clear results state — surrogate session was reset on server
      stepUnlocked["results"] = false;
      stepCompleted["results"] = false;
      _currentModelType = null;
      panelDone["results"] = false;
      panelDone["configure"] = false;
      clearEl(_panelContent["results"]);
      clearEl(_panelContent["configure"]);
      buildSidebar();
    }, { once: false });
  }

  // ── Step 9 — Configure + Train ────────────────────────────────────────────
  function _renderTrainSummary(container) {
    const card = el("div", { cls: "train-summary-card" });
    const normLabel = _currentNorm
      ? { minmax: "Min-Max", zscore: "Z-Score", log: "Log₁₀", none: "None" }[_currentNorm] ?? _currentNorm
      : "Not set";

    const items = [
      { label: "Rows",        value: (meta.n_rows ?? "—").toLocaleString() },
      { label: "Inputs",      value: _currentInputCols.length, list: _currentInputCols },
      { label: "Outputs",     value: _currentOutputCols.length, list: _currentOutputCols },
      { label: "Norm method", value: normLabel },
    ];

    for (const { label, value, list } of items) {
      const item = el("div", { cls: "train-summary-item" });
      item.appendChild(el("span", { cls: "train-summary-label", text: label }));
      item.appendChild(el("span", { cls: "train-summary-value", text: String(value) }));
      if (list && list.length) {
        item.appendChild(el("span", { cls: "train-summary-value--list", text: list.join(", ") }));
      }
      card.appendChild(item);
    }
    container.appendChild(card);
  }

  function _initConfigurePanel(container, key) {
    clearEl(container);
    _subtitle(key);
    _renderTrainSummary(container);
    const modelWrap = el("div");
    container.appendChild(modelWrap);
    initModelConfig(modelWrap, async () => {
      _hasUnsavedChanges = true;
      stepUnlocked["results"] = true;
      buildSidebar();
      panelDone["results"] = false;
      clearEl(_panelContent["results"]);
      await activatePanel("results");
    });
  }

  // ── Step 10 — Results ─────────────────────────────────────────────────────
  async function _initResultsPanel(container, key) {
    clearEl(container);
    _subtitle(key);
    const hasResults = await initResults(container);
    if (hasResults) {
      const rr = await get("/api/model/results");
      _currentModelType = rr.success ? (rr.results?.model_type || null) : null;
      stepCompleted["results"]   = true;
      stepUnlocked["predict"]    = true;
      stepUnlocked["optimize"]   = true;
      stepUnlocked["interpret"]  = true;
      stepUnlocked["active"]     = true;
      stepUnlocked["compare"]    = true;
      buildSidebar();
    }
  }

  // ── Step 11 — Predict ─────────────────────────────────────────────────────
  async function _initPredictPanel(container, key) {
    clearEl(container);
    _subtitle(key);
    await initPrediction(container);
  }

  // ── Step 12 — Optimize ───────────────────────────────────────────────────
  async function _initOptimizePanel(container, key) {
    clearEl(container);
    _subtitle(key);
    await initOptimization(container);
  }

  // ── Step 13 — Interpret ───────────────────────────────────────────────────
  async function _initInterpretPanel(container, key) {
    clearEl(container);
    _subtitle(key);
    await initInterpretation(container);
  }

  // ── Step 14 — Active Learning ─────────────────────────────────────────────
  async function _initActiveLearningPanel(container, key) {
    clearEl(container);
    _subtitle(key);
    await initActiveLearning(container);
  }

  // ── Step 15 — Compare ─────────────────────────────────────────────────────
  async function _initComparePanel(container, key) {
    clearEl(container);
    _subtitle(key);
    await initComparison(container);
  }

  // ── Step 16 — Export & Compliance ─────────────────────────────────────────
  async function _initExportPanel(container, key) {
    clearEl(container);
    _subtitle(key);
    await initExport(container);
  }

  // ── Check for existing trained model ─────────────────────────────────────
  const resultsCheck = await get("/api/model/results");
  if (resultsCheck.success && resultsCheck.results) {
    _currentModelType          = resultsCheck.results.model_type || null;
    stepUnlocked["results"]    = true;
    stepUnlocked["predict"]    = true;
    stepUnlocked["optimize"]   = true;
    stepUnlocked["interpret"]  = true;
    stepUnlocked["active"]     = true;
    stepUnlocked["compare"]    = true;
  }

  // ── Initial render ────────────────────────────────────────────────────────
  buildSidebar();
  await activatePanel("preview");
}

// ── Reusable helpers ──────────────────────────────────────────────────────────

/** Build a gate card with radio-button options. number may be null to suppress the badge. */
function _makeGate(number, title, options, onSelect) {
  const gate    = el("div", { cls: "gate-step" });
  const titleEl = el("div", { cls: "gate-step__title",  text: title });
  const optWrap = el("div", { cls: "gate-options" });
  const radioName = number != null ? `gate-${number}` : `gate-${title.slice(0, 8).replace(/\s/g, "")}`;

  if (number != null) {
    gate.appendChild(el("div", { cls: "gate-step__number", text: String(number) }));
  }

  for (const opt of options) {
    const wrapper = el("div",   { cls: "gate-option" });
    const radio   = el("input", { type: "radio", name: radioName, id: `${radioName}-${opt.value}`, value: opt.value });
    const label   = el("label", { cls: "gate-option__label", for: `${radioName}-${opt.value}` });
    label.innerHTML = opt.desc
      ? `${opt.label}<span class="gate-option__desc">${opt.desc}</span>`
      : opt.label;
    radio.addEventListener("change", () => { if (radio.checked) { gate.classList.add("completed"); onSelect(opt.value); } });
    wrapper.appendChild(radio);
    wrapper.appendChild(label);
    optWrap.appendChild(wrapper);
  }

  gate.appendChild(titleEl);
  gate.appendChild(optWrap);
  return gate;
}

/** Build the preview table from upload response data. */
function _buildPreviewTable(preview, nullCounts) {
  const wrap  = el("div",   { cls: "preview-table-wrap" });
  const table = el("table", { cls: "preview-table" });

  const thead     = el("thead");
  const headerRow = el("tr");
  for (const col of preview.columns) {
    const th = el("th");
    th.innerHTML = `${col}`;
    const nullCount = nullCounts?.[col] ?? 0;
    if (nullCount > 0) {
      th.appendChild(el("span", { cls: "null-indicator", text: `${nullCount} null(s)` }));
    }
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = el("tbody");
  for (const row of preview.rows) {
    const tr = el("tr");
    for (const col of preview.columns) {
      const val = row[col];
      const td  = el("td");
      if (val === null || val === undefined) {
        td.textContent = "null";
        td.classList.add("null-cell");
      } else {
        td.textContent = typeof val === "number" ? val.toPrecision(6) : String(val);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

/** Wire drag-and-drop and file input on the upload zone. */
function _wireDropZone(dropZone, fileInput, containerEl, onSuccess, isActive = () => true) {
  ["dragenter", "dragover", "dragleave", "drop"].forEach((evt) => {
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); });
    document.body.addEventListener(evt, (e) => e.preventDefault());
  });
  dropZone.addEventListener("dragenter", () => dropZone.classList.add("drag-over"));
  dropZone.addEventListener("dragover",  () => dropZone.classList.add("drag-over"));
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (e) => {
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file && isActive()) _handleFile(file, dropZone, onSuccess);
  });
  dropZone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
  dropZone.addEventListener("click", (e) => {
    if (!e.target.classList.contains("upload-zone__browse") && e.target.tagName !== "LABEL") fileInput.click();
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files[0] && isActive()) _handleFile(fileInput.files[0], dropZone, onSuccess);
    fileInput.value = "";
  });
}

/**
 * Fetch the loaded dataset list and update the switcher in the global header.
 * Shows the switcher only when 2+ datasets are loaded.
 */
async function _refreshDatasetSwitcher() {
  const resp = await get("/api/data/datasets");
  if (!resp.success) return;

  const nav      = document.querySelector(".global-header__controls");
  let   switcher = document.getElementById("dataset-switcher-group");

  if (resp.count < 2) {
    if (switcher) switcher.remove();
    return;
  }

  if (switcher) switcher.remove();
  switcher = el("div", { cls: "global-header__control-group", id: "dataset-switcher-group" });
  const label  = el("span",   { cls: "global-header__control-label", text: "Dataset" });
  const select = el("select", { cls: "global-header__select", id: "dataset-switcher",
    "aria-label": "Active dataset" });

  for (const ds of resp.datasets) {
    const typeLabel = ds.data_type ? ` — ${ds.data_type}` : "";
    const opt = el("option", { value: ds.key, text: `${ds.filename}${typeLabel}` });
    if (ds.active) opt.selected = true;
    select.appendChild(opt);
  }

  select.addEventListener("change", async () => {
    const targetKey = select.value;
    await put("/api/state/session", { active_dataset_key: targetKey });
    await refreshState();
    const dsResp = await get("/api/data/datasets");
    if (!dsResp.success) {
      showError("Could not load dataset list. Please try again.");
      return;
    }
    const active = dsResp.datasets?.find((d) => d.key === targetKey);
    if (active) {
      // Dismiss any active exercise overlay — it belongs to the previous dataset
      document.getElementById("ex-overlay")?.remove();
      const uploadMeta = {
        metadata: {
          filename:             active.filename,
          n_rows:               active.n_rows,
          n_cols:               active.n_cols,
          upload_timestamp:     new Date().toISOString(),
          null_counts:          active.null_counts          || {},
          dtypes:               active.dtypes               || {},
          coercion_warnings:    [],
          input_columns:        active.input_columns        || [],
          output_columns:       active.output_columns       || [],
          normalization_method: active.normalization_method || null,
          columns:              active.columns              || [],
        },
        preview: {
          columns:    active.columns      || [],
          rows:       active.preview_rows || [],
          total_rows: active.n_rows,
        },
      };
      await _renderExploration(uploadMeta);
      showSuccess(`Switched to "${active.filename}"`);
    }
    await _refreshDatasetSwitcher();
  });

  switcher.appendChild(label);
  switcher.appendChild(select);

  // Insert before the theme toggle
  const themeBtn = document.getElementById("theme-toggle");
  nav.insertBefore(switcher, themeBtn);
}

/** Wire global header controls: theme, classification, cores, clear, load-file. */
function _initGlobalHeader() {
  const themeBtn = document.getElementById("theme-toggle");
  const classSel = document.getElementById("classification-select");

  // ── Notification history panel ────────────────────────────────────────────────
  const notifBtn   = document.getElementById("notif-history-btn");
  const notifPanel = document.getElementById("notif-history-panel");
  const notifList  = document.getElementById("notif-history-list");
  const notifClear = document.getElementById("notif-history-clear");

  function _renderNotifLog() {
    if (!notifList) return;
    const log = getNotifLog();
    clearEl(notifList);
    if (log.length === 0) {
      notifList.appendChild(el("p", { cls: "notif-history__empty", text: "No notifications yet." }));
      return;
    }
    const ICONS_HIST = { success: "✓", error: "✕", warning: "⚠", info: "ℹ" };
    for (let i = log.length - 1; i >= 0; i--) {
      const entry = log[i];
      const row = el("div", { cls: "notif-history__entry" });
      const icon = el("span", { cls: `notif-history__icon notif-history__icon--${entry.type}`, text: ICONS_HIST[entry.type] || "•" });
      const body = el("div", { cls: "notif-history__content" });
      body.appendChild(el("div", { cls: "notif-history__message", text: entry.message }));
      const ts = entry.ts;
      const timeStr = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      body.appendChild(el("div", { cls: "notif-history__time", text: timeStr }));
      row.appendChild(icon);
      row.appendChild(body);
      notifList.appendChild(row);
    }
  }

  if (notifBtn && notifPanel) {
    notifBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = !notifPanel.classList.contains("hidden");
      notifPanel.classList.toggle("hidden", open);
      notifBtn.setAttribute("aria-expanded", String(!open));
      if (!open) {
        clearUnseen();
        _renderNotifLog();
      }
    });
    document.addEventListener("click", (e) => {
      if (!notifPanel.classList.contains("hidden") &&
          !notifPanel.contains(e.target) &&
          e.target !== notifBtn) {
        notifPanel.classList.add("hidden");
        notifBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  if (notifClear) {
    notifClear.addEventListener("click", () => {
      clearLog();
      _renderNotifLog();
    });
  }

  if (classSel) {
    classSel.addEventListener("change", async () => {
      await put("/api/state/session", { classification: classSel.value });
      await refreshState();
      showSuccess(`Classification set to ${classSel.value}.`);
    });
  }

  document.getElementById("clear-session-btn").addEventListener("click", async () => {
    if (!confirm("Clear all loaded datasets and return to the upload screen?")) return;
    await post("/api/state/reset", {});
    const switcher = document.getElementById("dataset-switcher-group");
    if (switcher) switcher.remove();
    projectMenuDropdown?.classList.add("hidden");
    projectMenuBtn?.setAttribute("aria-expanded", "false");
    resetExercise();
    closeGuide();
    renderUploadView();
    showSuccess("Session cleared.");
  });

  // "Load CSV" button (inside Project dropdown) triggers the hidden CSV file input
  const headerAddBtn   = document.getElementById("header-load-file-btn");
  const headerAddInput = document.getElementById("header-add-file-input");
  if (headerAddBtn && headerAddInput) {
    headerAddBtn.addEventListener("click", () => {
      projectMenuDropdown?.classList.add("hidden");
      projectMenuBtn?.setAttribute("aria-expanded", "false");
      headerAddInput.click();
    });
  }

  // ── Project ▾ dropdown ───────────────────────────────────────────────────────
  const projectMenuBtn      = document.getElementById("project-menu-btn");
  const projectMenuDropdown = document.getElementById("project-menu-dropdown");
  if (projectMenuBtn && projectMenuDropdown) {
    projectMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = !projectMenuDropdown.classList.contains("hidden");
      projectMenuDropdown.classList.toggle("hidden", open);
      projectMenuBtn.setAttribute("aria-expanded", String(!open));
    });
    document.addEventListener("click", (e) => {
      if (!projectMenuDropdown.classList.contains("hidden") &&
          !projectMenuDropdown.contains(e.target) &&
          e.target !== projectMenuBtn) {
        projectMenuDropdown.classList.add("hidden");
        projectMenuBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Save / Open project buttons
  const saveBtn       = document.getElementById("header-save-project-btn");
  const openBtn       = document.getElementById("header-open-project-btn");
  const openFileInput = document.getElementById("header-open-project-input");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      if (projectMenuDropdown) {
        projectMenuDropdown.classList.add("hidden");
        projectMenuBtn?.setAttribute("aria-expanded", "false");
      }
      _saveProject();
    });
  }
  if (openBtn && openFileInput) {
    openBtn.addEventListener("click", () => {
      if (document.getElementById("workflow-sidebar") &&
          !confirm("Opening a project will replace your current session. Continue?")) return;
      if (projectMenuDropdown) {
        projectMenuDropdown.classList.add("hidden");
        projectMenuBtn?.setAttribute("aria-expanded", "false");
      }
      openFileInput.click();
    });
    openFileInput.addEventListener("change", () => {
      const file = openFileInput.files[0];
      if (!file) return;
      openFileInput.value = "";
      _openProject(file);
    });
  }

  // Warn before tab close / navigation if there are unsaved changes
  window.addEventListener("beforeunload", (e) => {
    if (_hasUnsavedChanges) {
      e.preventDefault();
      return "";
    }
  });

  const storedTheme = localStorage.getItem("theme") || "light";
  _applyTheme(storedTheme, themeBtn);
  themeBtn.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const next   = isDark ? "light" : "dark";
    _applyTheme(next, themeBtn);
    localStorage.setItem("theme", next);
  });

  const guideBtn = document.getElementById("guide-btn");
  if (guideBtn) {
    guideBtn.addEventListener("click", () => openGuide("glossary"));
  }


  const stateViewerBtn = document.getElementById("state-viewer-btn");
  if (stateViewerBtn) {
    stateViewerBtn.addEventListener("click", async () => {
      const resp = await get("/api/state/");
      const overlay = el("div", { cls: "state-viewer-overlay" });
      overlay.innerHTML = `
        <div class="state-viewer-modal">
          <div class="state-viewer-header">
            <span>Session STATE (read-only)</span>
            <button class="state-viewer-close" aria-label="Close">✕</button>
          </div>
          <pre class="state-viewer-pre">${escHtml(JSON.stringify(resp.state || {}, null, 2))}</pre>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector(".state-viewer-close").addEventListener("click", () => overlay.remove());
      overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    });
  }

  const coresInput = document.getElementById("cores-input");

  coresInput.addEventListener("input", () => {
    const count = parseInt(coresInput.value, 10);
    if (!count || count < 1) return;
    const avail = getAvailableCores();
    const over  = count > avail;
    coresInput.classList.toggle("input-caution", over);
    coresInput.title = over
      ? `⚠ Exceeds ${avail} available processors`
      : `${avail} logical processors available`;
  });

  coresInput.addEventListener("change", async () => {
    const count = parseInt(coresInput.value, 10);
    if (!count || count < 1) return;
    await put("/api/state/session", {
      processor_count: count,
      processor_mode:  count > 1 ? "parallel" : "serial",
    });
    await refreshState();
    _updateCoresDisplay();
  });
}

function _updateCoresDisplay() {
  const avail      = getAvailableCores();
  const coresInput = document.getElementById("cores-input");
  const availSpan  = document.getElementById("cores-avail");
  if (!coresInput) return;
  coresInput.max         = avail;
  coresInput.placeholder = avail;
  coresInput.title       = `${avail} logical processors available on server`;
  if (availSpan) availSpan.textContent = `of ${avail} available`;
}

/** Build an uploadMeta object from a dataset entry returned by GET /api/data/datasets. */
function _buildUploadMetaFromDataset(ds) {
  return {
    metadata: {
      filename:             ds.filename,
      n_rows:               ds.n_rows,
      n_cols:               ds.n_cols,
      upload_timestamp:     ds.last_accessed || new Date().toISOString(),
      null_counts:          ds.null_counts          || {},
      dtypes:               ds.dtypes               || {},
      coercion_warnings:    [],
      input_columns:        ds.input_columns        || [],
      output_columns:       ds.output_columns       || [],
      normalization_method: ds.normalization_method || null,
      columns:              ds.columns              || [],
    },
    preview: {
      columns:    ds.columns      || [],
      rows:       ds.preview_rows || [],
      total_rows: ds.n_rows,
    },
  };
}

/** Save the current session to a .surrogate file, prompting for compliance if needed. */
async function _saveProject() {
  const classification = document.getElementById("classification-select")?.value || "Unclassified";

  if (classification !== "Unclassified") {
    const confirmed = await _showComplianceModal(classification);
    if (!confirmed) return;
  }

  const saveBtn = document.getElementById("header-save-project-btn");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }

  try {
    const resp = await fetch("/api/state/save", { method: "POST" });
    if (!resp.ok) {
      let msg = "Failed to save project.";
      try { msg = (await resp.json()).message || msg; } catch { /* empty */ }
      showError(msg);
      return;
    }

    const blob        = await resp.blob();
    const disposition = resp.headers.get("Content-Disposition") || "";
    const match       = disposition.match(/filename="([^"]+)"/);
    const filename    = match ? match[1] : "session.surrogate";

    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    _hasUnsavedChanges = false;
    showSuccess(`Saved as "${filename}"`);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "💾 Save"; }
  }
}

/** Show a compliance acknowledgment <dialog> and resolve true/false on user action. */
function _showComplianceModal(classification) {
  return new Promise((resolve) => {
    const isITAR = classification === "ITAR" || classification === "EAR";
    const color  = isITAR ? "var(--color-error)" : "var(--color-warning)";

    const dialog = document.createElement("dialog");
    dialog.className = "gate-modal compliance-modal";
    dialog.innerHTML = `
      <div class="gate-modal__header">
        <strong class="gate-modal__filename" style="color:${color}">${classification}</strong>
        <span class="gate-modal__subtitle">Classification Acknowledgment Required</span>
      </div>
      <div class="compliance-modal__body">
        <p>You are about to save a session containing <strong>${classification}</strong> data.</p>
        <p>By saving, you confirm this file will be:</p>
        <ul class="compliance-modal__list">
          <li>Stored only in approved locations for ${classification} data</li>
          <li>Shared only with personnel authorized to access ${classification} data</li>
          <li>Handled in accordance with program security requirements</li>
        </ul>
        ${isITAR ? `
        <div class="compliance-modal__itar-row">
          <label class="compliance-modal__itar-label">
            <input type="checkbox" id="compliance-itar-check">
            I acknowledge this project is subject to ${classification} export control restrictions and I will handle it accordingly.
          </label>
        </div>` : ""}
      </div>
      <div class="gate-modal__actions">
        <button id="compliance-confirm" class="btn btn-primary"${isITAR ? " disabled" : ""}>I Acknowledge, Save</button>
        <button id="compliance-cancel" class="btn btn-secondary">Cancel</button>
      </div>
    `;

    if (isITAR) {
      dialog.querySelector("#compliance-itar-check").addEventListener("change", (e) => {
        dialog.querySelector("#compliance-confirm").disabled = !e.target.checked;
      });
    }

    const close = (result) => { dialog.close(); dialog.remove(); resolve(result); };
    dialog.querySelector("#compliance-confirm").addEventListener("click", () => close(true));
    dialog.querySelector("#compliance-cancel").addEventListener("click",  () => close(false));
    dialog.addEventListener("click", (e) => { if (e.target === dialog) close(false); });

    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

/** Handle opening a .surrogate file: POST to load endpoint, then reload page. */
async function _openProject(file) {
  const openBtn = document.getElementById("header-open-project-btn");
  if (openBtn) { openBtn.disabled = true; openBtn.textContent = "Loading…"; }

  const fd = new FormData();
  fd.append("file", file);

  try {
    const resp = await fetch("/api/state/load", { method: "POST", body: fd });
    const data = await resp.json();

    if (!data.success) {
      showError(data.message || "Failed to load project.");
      return;
    }

    _hasUnsavedChanges = false;
    showSuccess(`Loaded — ${data.n_datasets} dataset(s) restored.`);
    setTimeout(() => window.location.reload(), 800);
  } catch {
    showError("Failed to load project.");
  } finally {
    if (openBtn) { openBtn.disabled = false; openBtn.textContent = "📂 Open"; }
  }
}

/** Apply theme to <html> and update toggle button label. */
function _applyTheme(theme, btn) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
    btn.textContent = "☀";
    btn.setAttribute("aria-label", "Switch to light mode");
    btn.title = "Switch to light mode";
  } else {
    document.documentElement.removeAttribute("data-theme");
    btn.textContent = "🌙";
    btn.setAttribute("aria-label", "Switch to dark mode");
    btn.title = "Switch to dark mode";
  }
  document.dispatchEvent(new CustomEvent("theme:changed"));
}

async function _handleFile(file, dropZone, onSuccess) {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    showError("Only .csv files are supported. Please select a CSV file.");
    return;
  }
  showSpinner(dropZone);
  const formData = new FormData();
  formData.append("file", file);
  const result = await post("/api/data/upload", formData);
  hideSpinner(dropZone);

  if (!result.success) {
    showError(result.message || "Upload failed. Please try again.");
    return;
  }

  await refreshState();
  showSuccess(`"${file.name}" loaded — ${result.preview.total_rows.toLocaleString()} rows × ${result.metadata.n_cols} columns`);

  if (result.metadata.coercion_warnings?.length) {
    for (const w of result.metadata.coercion_warnings) showWarning(w, 8000);
  }
  if (result.eviction_warnings?.length) {
    for (const w of result.eviction_warnings) showWarning(w, 10000);
  }

  await _refreshDatasetSwitcher();
  onSuccess(result);
  _hasUnsavedChanges = true;
}
