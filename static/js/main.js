// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/main.js
// Version: 0.6.0
// Description: SPA entry point. Bootstraps global header (theme, level, cores,
//              learning mode), renders the upload view, handles the single data-
//              type gate, and navigates to the exploration view.
// =============================================================================

import { initLearningMode, registerPrimer, registerTooltip } from "./learning_mode.js";
import { get, post, put } from "./api.js";
import { refreshState } from "./state.js";
import { showSuccess, showError, showWarning } from "./notifications.js";
import { showSpinner, hideSpinner } from "./loading.js";
import { initExploration } from "./modules/data_explorer.js";
import { initCleaning } from "./modules/data_cleaning.js";
import { initDesignation } from "./modules/column_designation.js";
import { initNormalization } from "./modules/normalization.js";
import { initModelConfig } from "./modules/model_config.js";
import { el, clearEl } from "./utils.js";

// ── Bootstrap ─────────────────────────────────────────────────────────────────

(async () => {
  const learningToggle = document.getElementById("learning-toggle");
  initLearningMode(learningToggle);
  _initGlobalHeader();

  await refreshState();
  renderUploadView();
})();

// ── Views ─────────────────────────────────────────────────────────────────────

function getApp() {
  return document.getElementById("app");
}

/** Render the entry / upload view into #app. */
function renderUploadView() {
  const app = getApp();
  clearEl(app);

  // ── Hero section ──────────────────────────────────────────────────────────
  const hero = el("div", { cls: "hero" });
  hero.innerHTML = `
    <div class="hero__badge">Surrogate Modeling Toolkit</div>
    <h1 class="hero__title">Build fast surrogate models from your data</h1>
    <p class="hero__subtitle">Upload your data. Normalize. Train. Validate. All on your machine.</p>
  `;

  // Learning mode primer for the entry screen
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

  app.appendChild(hero);

  // ── Upload zone ───────────────────────────────────────────────────────────
  const uploadSection = el("div", { cls: "card", style: "max-width: 640px; margin: 0 auto;" });

  const uploadTitle = el("div", { cls: "section-header" });
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
    <div class="upload-zone__icon" aria-hidden="true">📁</div>
    <div class="upload-zone__title">Drag &amp; drop your CSV file here</div>
    <div class="upload-zone__subtitle">or</div>
    <label class="upload-zone__browse" for="file-input">Browse files</label>
    <input type="file" id="file-input" accept=".csv" style="display:none" aria-label="Choose CSV file">
  `;
  uploadSection.appendChild(dropZone);
  app.appendChild(uploadSection);

  // ── Wire upload events ────────────────────────────────────────────────────
  const fileInput = uploadSection.querySelector("#file-input");
  let dropEnabled = true;
  _wireDropZone(dropZone, fileInput, uploadSection, (response) => {
    dropEnabled = false;
    dropZone.classList.add("upload-zone--queued");
    dropZone.querySelector(".upload-zone__title").textContent = "1 file queued — make a selection below";
    dropZone.querySelector(".upload-zone__subtitle").textContent = "";
    const browseLabel = dropZone.querySelector(".upload-zone__browse");
    if (browseLabel) browseLabel.style.display = "none";
    _renderGates(app, response);
  }, () => dropEnabled);
}

/**
 * Modal gate for additional file uploads (from the exploration view).
 * Opens a <dialog> overlay; blocks interaction until the user selects a
 * data type and confirms, or cancels. The underlying exploration view stays
 * visible behind the backdrop.
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
      <strong class="gate-modal__filename">${meta.filename}</strong>
      <span class="gate-modal__subtitle">Select data type to continue</span>
    </div>
    <div class="gate-options gate-modal__options" id="ag-options"></div>
    <div class="gate-modal__actions">
      <button class="btn btn-primary" id="ag-confirm" disabled>Confirm →</button>
      <button class="btn btn-secondary" id="ag-cancel">Cancel</button>
    </div>
  `;

  let selectedType = null;
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
  // Backdrop click dismisses
  dialog.addEventListener("click", (e) => { if (e.target === dialog) closeModal(); });

  document.body.appendChild(dialog);
  dialog.showModal();
}

/** Render the single data-type gate after a successful upload. */
function _renderGates(app, uploadResponse) {
  // Append gate below the upload section (don't clear — keep the zone visible)
  const gatesSection = el("div", { cls: "gates-container", id: "gates-container",
    style: "max-width: 640px; margin: var(--space-8) auto 0;" });

  const gatesHeader = el("div", { cls: "section-header" });
  gatesHeader.innerHTML = `
    <h2 class="section-title">Step 2 — Data Type</h2>
    <p class="section-desc">One question before we explore your data.</p>
  `;
  gatesSection.appendChild(gatesHeader);

  let selectedDataType = null;

  const confirmBtn = el("button", {
    cls: "btn btn-primary",
    text: "Continue to Explore Data →",
    style: "margin-top: var(--space-6); width: 100%;",
  });
  confirmBtn.disabled = true;

  // ── Gate 1: Data type ─────────────────────────────────────────────────────
  const gate1 = _makeGate(
    1,
    "What type of data are you working with?",
    [
      { value: "simulation",   label: "Simulation / CFD output" },
      { value: "experimental", label: "Experimental measurements" },
      { value: "mixed",        label: "Mixed / Unknown" },
    ],
    (val) => {
      selectedDataType = val;
      confirmBtn.disabled = false;
    }
  );
  gate1.classList.add("active");
  gatesSection.appendChild(gate1);

  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Saving…";

    await put("/api/state/session", { data_type: selectedDataType });
    await refreshState();
    _renderExploration(uploadResponse);
  });

  gatesSection.appendChild(confirmBtn);
  app.appendChild(gatesSection);
}

/** Render the data preview and exploration view. */
async function _renderExploration(uploadResponse) {
  const app = getApp();
  clearEl(app);

  // ── File summary bar ──────────────────────────────────────────────────────
  const summaryBar = el("div", {
    cls: "preview-header",
    style: "margin-bottom: var(--space-6);",
  });
  const meta = uploadResponse.metadata;
  summaryBar.innerHTML = `
    <div>
      <h2 class="section-title">Data Explorer</h2>
      <p class="preview-meta">
        <strong>${meta.filename}</strong>
        — ${meta.n_rows.toLocaleString()} rows × ${meta.n_cols} columns
        &nbsp;·&nbsp; uploaded ${new Date(meta.upload_timestamp).toLocaleTimeString()}
      </p>
    </div>
    <div style="display:flex;gap:var(--space-3);">
      <input type="file" id="add-file-input" accept=".csv" style="display:none" aria-label="Load additional CSV">
      <button class="btn btn-secondary" id="add-file-btn">+ Load another file</button>
      <button class="btn btn-secondary" id="back-btn">← Upload new file</button>
    </div>
  `;
  app.appendChild(summaryBar);
  summaryBar.querySelector("#back-btn").addEventListener("click", renderUploadView);

  // "Load another file" — uploads without clearing the current exploration view
  const addFileInput = summaryBar.querySelector("#add-file-input");
  summaryBar.querySelector("#add-file-btn").addEventListener("click", () => addFileInput.click());
  addFileInput.addEventListener("change", () => {
    if (!addFileInput.files[0]) return;
    const file = addFileInput.files[0];
    addFileInput.value = "";
    _handleFile(file, summaryBar.querySelector("#add-file-btn"), (response) => {
      _renderAdditionalFileGate(app, response);
    });
  });

  // ── Data preview table ────────────────────────────────────────────────────
  const previewSection = el("div", { cls: "preview-section card",
    style: "margin-bottom: var(--space-6);" });
  const previewTitle = el("h3", {
    cls: "section-title",
    text: `Data Preview — first ${uploadResponse.preview.rows.length} rows`,
    style: "margin-bottom: var(--space-4);",
  });
  previewSection.appendChild(previewTitle);
  previewSection.appendChild(_buildPreviewTable(uploadResponse.preview, meta.null_counts));
  app.appendChild(previewSection);

  // ── Exploration module ────────────────────────────────────────────────────
  const exploreSection = el("div", { cls: "card", id: "explore-section" });
  app.appendChild(exploreSection);
  await initExploration(exploreSection, uploadResponse);

  // ── Data cleaning ─────────────────────────────────────────────────────────
  const cleanCard = el("div", { cls: "card", id: "cleaning-section",
    style: "margin-top: var(--space-6);" });
  app.appendChild(cleanCard);

  const onClean = async () => {
    // Re-render exploration with fresh data from server, then refresh cleaning summary.
    clearEl(exploreSection);
    await initExploration(exploreSection, uploadResponse);
    await initCleaning(cleanCard, onClean);
  };
  await initCleaning(cleanCard, onClean);

  // ── Column designation ────────────────────────────────────────────────────
  const meta2         = uploadResponse.metadata;
  const designCard    = el("div", { cls: "card", id: "designation-section",
    style: "margin-top: var(--space-6);" });
  app.appendChild(designCard);

  // Normalization card — hidden until designation is confirmed
  const normCard = el("div", { cls: "card hidden", id: "normalization-section",
    style: "margin-top: var(--space-6);" });
  app.appendChild(normCard);

  // Training config card — hidden until designation is confirmed
  const trainConfigCard = el("div", { cls: "card hidden", id: "model-config-section",
    style: "margin-top: var(--space-6);" });
  app.appendChild(trainConfigCard);

  const initInputs  = meta2.input_columns  || [];
  const initOutputs = meta2.output_columns || [];
  const currentNorm = meta2.normalization_method || null;

  // If designation already exists, render normalization and training config immediately
  if (initInputs.length > 0) {
    normCard.classList.remove("hidden");
    initNormalization(normCard, currentNorm, initInputs.length);
    trainConfigCard.classList.remove("hidden");
    initModelConfig(trainConfigCard, () => {});
  }

  initDesignation(
    designCard,
    meta2.columns || uploadResponse.preview.columns,
    meta2.dtypes || {},
    meta2.null_counts || {},
    meta2.n_rows,
    initInputs,
    initOutputs,
    ({ input_columns }) => {
      // Reveal normalization and training config on first designation confirmation
      normCard.classList.remove("hidden");
      clearEl(normCard);
      initNormalization(normCard, null, input_columns.length);
      trainConfigCard.classList.remove("hidden");
      clearEl(trainConfigCard);
      initModelConfig(trainConfigCard, () => {});
      normCard.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  );
}

// ── Reusable helpers ──────────────────────────────────────────────────────────

/** Build a gate card with radio-button options. */
function _makeGate(number, title, options, onSelect) {
  const gate = el("div", { cls: "gate-step" });

  const num = el("div", { cls: "gate-step__number", text: String(number) });
  const titleEl = el("div", { cls: "gate-step__title", text: title });
  const optionsWrap = el("div", { cls: "gate-options" });

  for (const opt of options) {
    const wrapper = el("div", { cls: "gate-option" });
    const radio = el("input", {
      type: "radio",
      name: `gate-${number}`,
      id: `gate-${number}-${opt.value}`,
      value: opt.value,
    });
    const label = el("label", {
      cls: "gate-option__label",
      for: `gate-${number}-${opt.value}`,
      text: opt.label,
    });

    radio.addEventListener("change", () => {
      if (radio.checked) {
        gate.classList.add("completed");
        onSelect(opt.value);
      }
    });

    wrapper.appendChild(radio);
    wrapper.appendChild(label);
    optionsWrap.appendChild(wrapper);
  }

  gate.appendChild(num);
  gate.appendChild(titleEl);
  gate.appendChild(optionsWrap);
  return gate;
}

/** Build the preview table from upload response data. */
function _buildPreviewTable(preview, nullCounts) {
  const wrap = el("div", { cls: "preview-table-wrap" });
  const table = el("table", { cls: "preview-table" });

  const thead = el("thead");
  const headerRow = el("tr");
  for (const col of preview.columns) {
    const th = el("th");
    th.innerHTML = `${col}`;
    const nullCount = nullCounts?.[col] ?? 0;
    if (nullCount > 0) {
      const indicator = el("span", {
        cls: "null-indicator",
        text: `${nullCount} null(s)`,
      });
      th.appendChild(indicator);
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
      const td = el("td");
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
  // Prevent browser from opening the file on drag
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

  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput.click();
  });

  dropZone.addEventListener("click", (e) => {
    if (!e.target.classList.contains("upload-zone__browse") &&
        e.target.tagName !== "LABEL") {
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0] && isActive()) _handleFile(fileInput.files[0], dropZone, onSuccess);
    fileInput.value = ""; // reset so same file can be re-uploaded
  });
}

/**
 * Fetch the loaded dataset list and update the switcher in the global header.
 * Shows the switcher only when 2+ datasets are loaded.
 */
async function _refreshDatasetSwitcher() {
  const resp = await get("/api/data/datasets");
  if (!resp.success) return;

  const nav = document.querySelector(".global-header__controls");
  let switcher = document.getElementById("dataset-switcher-group");

  if (resp.count < 2) {
    if (switcher) switcher.remove();
    return;
  }

  // Build or rebuild the switcher control group
  if (switcher) switcher.remove();
  switcher = el("div", { cls: "global-header__control-group", id: "dataset-switcher-group" });
  const label = el("span", { cls: "global-header__control-label", text: "Dataset" });
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
    const activeDs = resp.datasets.find((d) => d.key === select.value);
    if (activeDs) {
      const dsResp = await get("/api/data/datasets");
      const active = dsResp.datasets?.find((d) => d.key === select.value);
      if (active) {
        // Re-render exploration with refreshed data
        const uploadMeta = {
          metadata: {
            filename:             active.filename,
            n_rows:               active.n_rows,
            n_cols:               active.n_cols,
            upload_timestamp:     new Date().toISOString(),
            null_counts:          active.null_counts    || {},
            dtypes:               active.dtypes         || {},
            coercion_warnings:    [],
            input_columns:        active.input_columns  || [],
            output_columns:       active.output_columns || [],
            normalization_method: active.normalization_method || null,
            columns:              active.columns || [],
          },
          preview: {
            columns:    active.columns     || [],
            rows:       active.preview_rows || [],
            total_rows: active.n_rows,
          },
        };
        _renderExploration(uploadMeta);
        showSuccess(`Switched to "${active.filename}"`);
      }
    }
    _refreshDatasetSwitcher();
  });

  switcher.appendChild(label);
  switcher.appendChild(select);

  // Insert before the theme toggle
  const themeBtn = document.getElementById("theme-toggle");
  nav.insertBefore(switcher, themeBtn);
}

/** Wire global header controls: theme toggle, level select, classification, cores, clear session. */
function _initGlobalHeader() {
  const themeBtn  = document.getElementById("theme-toggle");
  const levelSel  = document.getElementById("level-select");
  const classSel  = document.getElementById("classification-select");
  if (classSel) {
    classSel.addEventListener("change", async () => {
      await put("/api/state/session", { classification: classSel.value });
      await refreshState();
      showSuccess(`Classification set to ${classSel.value}.`);
    });
  }

  // Clear session
  document.getElementById("clear-session-btn").addEventListener("click", async () => {
    if (!confirm("Clear all loaded datasets and return to the upload screen?")) return;
    await post("/api/state/reset", {});
    const switcher = document.getElementById("dataset-switcher-group");
    if (switcher) switcher.remove();
    renderUploadView();
    showSuccess("Session cleared.");
  });

  // Apply stored theme on load (default: light)
  const storedTheme = localStorage.getItem("theme") || "light";
  _applyTheme(storedTheme, themeBtn);

  themeBtn.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const next = isDark ? "light" : "dark";
    _applyTheme(next, themeBtn);
    localStorage.setItem("theme", next);
  });

  levelSel.addEventListener("change", async () => {
    await put("/api/state/session", { experience_level: levelSel.value });
    await refreshState();
  });

  // Cores — number input; max and placeholder set from detected CPU count
  const coresInput = document.getElementById("cores-input");
  const cpuCount = navigator.hardwareConcurrency || 8;
  coresInput.max = cpuCount;
  coresInput.placeholder = cpuCount;
  coresInput.title = `Detected: ${cpuCount} logical processors`;

  coresInput.addEventListener("input", () => {
    const count = parseInt(coresInput.value, 10);
    if (!count || count < 1) return;
    const over = count > 4;
    coresInput.classList.toggle("input-caution", over);
    coresInput.title = over
      ? `⚠ More than 4 processors may violate head-node policies`
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
    for (const w of result.metadata.coercion_warnings) {
      showWarning(w, 8000);
    }
  }
  if (result.eviction_warnings?.length) {
    for (const w of result.eviction_warnings) {
      showWarning(w, 10000);
    }
  }

  await _refreshDatasetSwitcher();
  onSuccess(result);
}
