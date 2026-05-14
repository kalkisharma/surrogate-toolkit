// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/main.js
// Version: 0.9.4
// Description: SPA entry point. Bootstraps global header (theme, level, cores,
//              learning mode), renders the upload view, and drives the workflow
//              panel router (sidebar + 8 lazy-init panels).
// =============================================================================

import { initLearningMode, registerPrimer } from "./learning_mode.js";
import { get, post, put } from "./api.js";
import { refreshState } from "./state.js";
import { showSuccess, showError, showWarning } from "./notifications.js";
import { showSpinner, hideSpinner } from "./loading.js";
import { initExploration, updateColumnSelectorRoles } from "./modules/data_explorer.js";
import { initCleaning } from "./modules/data_cleaning.js";
import { initDesignation } from "./modules/column_designation.js";
import { initNormalization } from "./modules/normalization.js";
import { initModelConfig } from "./modules/model_config.js";
import { initResults } from "./modules/results.js";
import { initPrediction } from "./modules/prediction.js";
import { el, clearEl, escHtml } from "./utils.js";

// ── Bootstrap ─────────────────────────────────────────────────────────────────

(async () => {
  const learningToggle = document.getElementById("learning-toggle");
  initLearningMode(learningToggle);
  _initGlobalHeader();
  await refreshState();
  renderUploadView();
})();

// ── Module state ──────────────────────────────────────────────────────────────

/** Stored so it can be removed before re-wiring when the active dataset changes. */
let _headerFileHandler = null;

// ── Views ─────────────────────────────────────────────────────────────────────

function getApp() {
  return document.getElementById("app");
}

/** Show or hide the global header "Load File" button. */
function _setLoadFileVisible(visible) {
  const btn = document.getElementById("header-load-file-btn");
  if (btn) btn.classList.toggle("hidden", !visible);
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
    <h2 class="section-title">Step 2 — Data Type</h2>
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
    1,
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

  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled    = true;
    confirmBtn.textContent = "Saving…";
    await put("/api/state/session", { data_type: selectedDataType });
    await refreshState();
    _renderExploration(uploadResponse);
  });
}

// ── Workflow exploration view ─────────────────────────────────────────────────

/** Render the workflow panel router (sidebar + 8 lazy-init panels) into #app. */
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
  let _currentNorm       = meta.normalization_method || null;

  // ── Layout skeleton ───────────────────────────────────────────────────────
  const layout    = el("div", { cls: "workflow-layout" });
  const sidebarEl = el("nav",  { cls: "workflow-sidebar", id: "workflow-sidebar",
    "aria-label": "Workflow steps" });
  const panelArea = el("div",  { cls: "workflow-panel-area" });
  layout.appendChild(sidebarEl);
  layout.appendChild(panelArea);
  app.appendChild(layout);

  // ── Panel containers ──────────────────────────────────────────────────────
  const STEP_KEYS   = ["upload", "preview", "explore", "clean", "designate", "normalize", "configure", "results", "predict"];
  const STEP_LABELS = { upload: "Upload", preview: "Preview", explore: "Explore", clean: "Clean",
                        designate: "Designate", normalize: "Normalize", configure: "Configure",
                        results: "Results", predict: "Predict" };
  const STEP_NUMS   = { upload: 1, preview: 2, explore: 3, clean: 4,
                        designate: 5, normalize: 6, configure: 7, results: 8, predict: 9 };

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
    upload: true, preview: true, explore: true, clean: true, designate: true,
    normalize: hasDesignation, configure: hasDesignation, results: false, predict: false,
  };
  const stepCompleted = {
    upload: true, preview: false, explore: false, clean: false,
    designate: hasDesignation, normalize: false, configure: false, results: false, predict: false,
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

      item.appendChild(numEl);
      item.appendChild(lblEl);
      item.appendChild(icnEl);
      sidebarEl.appendChild(item);

      if (!isLocked) item.addEventListener("click", () => activatePanel(key));
    }
  }

  // ── Panel activation ──────────────────────────────────────────────────────
  async function activatePanel(key) {
    if (!stepUnlocked[key]) return;
    _activeKey = key;
    for (const k of STEP_KEYS) panelEls[k].classList.toggle("hidden", k !== key);
    buildSidebar();
    put("/api/state/session", { active_tab: key }).catch(() => {});
    if (!panelDone[key]) {
      panelDone[key] = true;
      await _initPanel(key, _panelContent[key]);
    }
    if (key === "explore") {
      const splom = document.getElementById("splom-container");
      if (splom) Plotly.Plots.resize(splom);
    }
  }

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
      case "designate": _initDesignatePanel(container, key);      break;
      case "normalize": _initNormalizePanel(container, key);      break;
      case "configure": _initConfigurePanel(container, key);      break;
      case "results":   await _initResultsPanel(container, key);  break;
      case "predict":   await _initPredictPanel(container, key);  break;
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
      // Refresh clean panel itself to show updated stats
      await _initCleanPanel(container, key);
    };
    await initCleaning(container, onClean);
  }

  // ── Step 5 — Designate ────────────────────────────────────────────────────
  function _initDesignatePanel(container, key) {
    _subtitle(key);
    initDesignation(
      container,
      meta.columns || uploadResponse.preview.columns,
      meta.dtypes      || {},
      meta.null_counts  || {},
      meta.n_rows,
      _currentInputCols,
      _currentOutputCols,
      ({ input_columns, output_columns }) => {
        _currentInputCols  = input_columns;
        _currentOutputCols = output_columns;
        _currentNorm       = null;

        stepUnlocked["normalize"]  = true;
        stepUnlocked["configure"]  = true;
        stepCompleted["designate"] = true;
        buildSidebar();

        // Update SPLOM selector ordering if explore has been rendered
        updateColumnSelectorRoles(input_columns, output_columns);

        // Invalidate normalize and configure so they re-init with the new roles
        if (panelDone["normalize"]) { panelDone["normalize"] = false; clearEl(_panelContent["normalize"]); }
        if (panelDone["configure"]) { panelDone["configure"] = false; clearEl(_panelContent["configure"]); }

        activatePanel("normalize");
      },
    );
  }

  // ── Step 6 — Normalize ────────────────────────────────────────────────────
  function _initNormalizePanel(container, key) {
    clearEl(container);
    _subtitle(key);
    initNormalization(container, _currentNorm, _currentInputCols.length);
  }

  // ── Step 7 — Configure + Train ────────────────────────────────────────────
  function _initConfigurePanel(container, key) {
    clearEl(container);
    _subtitle(key);
    initModelConfig(container, async () => {
      stepUnlocked["results"] = true;
      buildSidebar();
      panelDone["results"] = false;
      clearEl(_panelContent["results"]);
      await activatePanel("results");
    });
  }

  // ── Step 8 — Results ──────────────────────────────────────────────────────
  async function _initResultsPanel(container, key) {
    clearEl(container);
    _subtitle(key);
    const hasResults = await initResults(container);
    if (hasResults) {
      stepCompleted["results"] = true;
      stepUnlocked["predict"]  = true;
      buildSidebar();
    }
  }

  // ── Step 9 — Predict ──────────────────────────────────────────────────────
  async function _initPredictPanel(container, key) {
    clearEl(container);
    _subtitle(key);
    await initPrediction(container);
  }

  // ── Check for existing trained model ─────────────────────────────────────
  const resultsCheck = await get("/api/model/results");
  if (resultsCheck.success && resultsCheck.results) {
    stepUnlocked["results"] = true;
    stepUnlocked["predict"] = true;
  }

  // ── Initial render ────────────────────────────────────────────────────────
  buildSidebar();
  await activatePanel("preview");
}

// ── Reusable helpers ──────────────────────────────────────────────────────────

/** Build a gate card with radio-button options. */
function _makeGate(number, title, options, onSelect) {
  const gate       = el("div", { cls: "gate-step" });
  const num        = el("div", { cls: "gate-step__number", text: String(number) });
  const titleEl    = el("div", { cls: "gate-step__title",  text: title });
  const optWrap    = el("div", { cls: "gate-options" });

  for (const opt of options) {
    const wrapper = el("div",   { cls: "gate-option" });
    const radio   = el("input", { type: "radio", name: `gate-${number}`, id: `gate-${number}-${opt.value}`, value: opt.value });
    const label   = el("label", { cls: "gate-option__label", for: `gate-${number}-${opt.value}` });
    label.innerHTML = opt.desc
      ? `${opt.label}<span class="gate-option__desc">${opt.desc}</span>`
      : opt.label;
    radio.addEventListener("change", () => { if (radio.checked) { gate.classList.add("completed"); onSelect(opt.value); } });
    wrapper.appendChild(radio);
    wrapper.appendChild(label);
    optWrap.appendChild(wrapper);
  }

  gate.appendChild(num);
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
    await put("/api/state/session", { active_dataset_key: select.value });
    await refreshState();
    const dsResp = await get("/api/data/datasets");
    const active = dsResp.datasets?.find((d) => d.key === select.value);
    if (active) {
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
      _renderExploration(uploadMeta);
      showSuccess(`Switched to "${active.filename}"`);
    }
    _refreshDatasetSwitcher();
  });

  switcher.appendChild(label);
  switcher.appendChild(select);

  // Insert before the theme toggle
  const themeBtn = document.getElementById("theme-toggle");
  nav.insertBefore(switcher, themeBtn);
}

/** Wire global header controls: theme, level, classification, cores, clear, load-file. */
function _initGlobalHeader() {
  const themeBtn = document.getElementById("theme-toggle");
  const levelSel = document.getElementById("level-select");
  const classSel = document.getElementById("classification-select");

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
    renderUploadView();
    showSuccess("Session cleared.");
  });

  // "Load File" button in header triggers the hidden file input
  const headerAddBtn   = document.getElementById("header-load-file-btn");
  const headerAddInput = document.getElementById("header-add-file-input");
  if (headerAddBtn && headerAddInput) {
    headerAddBtn.addEventListener("click", () => headerAddInput.click());
  }

  const storedTheme = localStorage.getItem("theme") || "light";
  _applyTheme(storedTheme, themeBtn);
  themeBtn.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const next   = isDark ? "light" : "dark";
    _applyTheme(next, themeBtn);
    localStorage.setItem("theme", next);
  });

  levelSel.addEventListener("change", async () => {
    await put("/api/state/session", { experience_level: levelSel.value });
    await refreshState();
  });

  const coresInput = document.getElementById("cores-input");
  const cpuCount   = navigator.hardwareConcurrency || 8;
  coresInput.max         = cpuCount;
  coresInput.placeholder = cpuCount;
  coresInput.title       = `Detected: ${cpuCount} logical processors`;

  coresInput.addEventListener("input", () => {
    const count = parseInt(coresInput.value, 10);
    if (!count || count < 1) return;
    const over = count > 4;
    coresInput.classList.toggle("input-caution", over);
    coresInput.title = over
      ? "⚠ More than 4 processors may violate head-node policies"
      : `Detected: ${cpuCount} logical processors`;
  });

  coresInput.addEventListener("change", async () => {
    const count = parseInt(coresInput.value, 10);
    if (!count || count < 1) return;
    await put("/api/state/session", {
      processor_count: count,
      processor_mode:  count > 1 ? "parallel" : "serial",
    });
    await refreshState();
  });
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
}
