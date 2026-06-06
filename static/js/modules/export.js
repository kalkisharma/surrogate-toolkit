// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/export.js
// Version: 1.2.1
// Description: Step 16 — Export & Compliance panel. Generates HTML analysis
//              reports with classification watermarks, downloads surrogate model
//              bundles, and exports the audit log.
// =============================================================================

import { get, post } from "../api.js";
import { registerPrimer } from "../learning_mode.js";
import { showSuccess, showError } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { el, clearEl, escHtml } from "../utils.js";

const SUPPORTED_CLASSIFICATIONS = ["Unclassified", "CUI", "ITAR", "EAR"];

const ITAR_WARNING = {
  ITAR: "ITAR — International Traffic in Arms Regulations. Unauthorized disclosure is prohibited by 22 U.S.C. §2778.",
  EAR:  "EAR — Export Administration Regulations. Check EAR Part 730–774 for licensing requirements before transfer.",
};

export async function initExport(containerEl) {
  clearEl(containerEl);

  const header = el("div", { cls: "section-header" });
  header.innerHTML = `<h2 class="section-title">Step 16 — Export &amp; Compliance</h2>
    <p class="section-desc">Generate a self-contained HTML analysis report, or download your trained surrogate model for use in your own Python scripts.</p>`;
  containerEl.appendChild(header);

  registerPrimer("export", header, "What does this report contain?", `
    <p>The report includes every workflow section you completed in this session:</p>
    <ul style="margin:var(--space-3) 0 0 var(--space-4);">
      <li><strong>Dataset summary</strong> — filename, row/column counts, missing value counts, column designation</li>
      <li><strong>Model results</strong> — type, hyperparameters, R², RMSE, MAE, CV metrics, parity plots</li>
      <li><strong>Sensitivity analysis</strong> — Sobol S₁/Sₜ table (if you ran Interpret)</li>
      <li><strong>Active learning</strong> — most recent recommendation table (if run)</li>
      <li><strong>Audit trail</strong> — timestamped log of all tool actions in this session</li>
    </ul>
    <p style="margin-top:var(--space-3);">The report is a self-contained HTML file. Open it in any browser, or use File → Print → Save as PDF for a static copy.</p>
  `);

  // ── Report configuration ─────────────────────────────────────────────────
  const configCard = el("div", { cls: "card export-config-card" });
  configCard.innerHTML = `<h3 class="section-subtitle" style="margin-bottom:var(--space-4);">Report Configuration</h3>`;

  // Classification selector
  const clsRow = el("div", { cls: "export-field-row" });
  const clsLbl = el("label", { cls: "hyperparam-label", text: "Classification:" });
  clsLbl.setAttribute("for", "export-cls-select");

  const clsSel = el("select", { cls: "model-config-select", id: "export-cls-select" });
  for (const cls of SUPPORTED_CLASSIFICATIONS) {
    const opt = document.createElement("option");
    opt.value = cls;
    opt.textContent = cls;
    clsSel.appendChild(opt);
  }

  // Pre-select from the header classification selector (already reflects session state)
  const sessionCls = document.getElementById("classification-select")?.value || "Unclassified";
  if (SUPPORTED_CLASSIFICATIONS.includes(sessionCls)) clsSel.value = sessionCls;

  clsRow.appendChild(clsLbl);
  clsRow.appendChild(clsSel);
  configCard.appendChild(clsRow);

  // ITAR/EAR confirmation row (shown/hidden dynamically)
  const itarRow = el("div", { cls: "export-itar-row hidden", id: "export-itar-row" });
  itarRow.innerHTML = `
    <div class="export-itar-warn" id="export-itar-text"></div>
    <label class="export-itar-label" id="export-itar-label">
      <input type="checkbox" id="export-itar-ack"> I confirm this export complies with applicable export control regulations and I am authorized to share this information.
    </label>`;
  configCard.appendChild(itarRow);
  containerEl.appendChild(configCard);

  // ── Action buttons ───────────────────────────────────────────────────────
  const btnRow = el("div", { cls: "export-btn-row" });

  const NUMPY_SUPPORTED = ["linear", "gpr"];

  const genBtn      = el("button", { cls: "btn btn-primary",   id: "export-gen-btn",       text: "Generate Report" });
  const modelBtn    = el("button", { cls: "btn btn-secondary", id: "export-model-btn",      text: "Download Model (.zip)" });
  const numpyBtn    = el("button", { cls: "btn btn-secondary", id: "export-numpy-btn",      text: "Export NumPy (.zip)" });
  const auditBtn    = el("button", { cls: "btn btn-secondary", text: "Download Audit Log" });

  btnRow.appendChild(genBtn);
  btnRow.appendChild(modelBtn);
  btnRow.appendChild(numpyBtn);
  btnRow.appendChild(auditBtn);
  containerEl.appendChild(btnRow);

  // Check whether a trained model exists to enable/disable the model buttons
  const modelResp = await get("/api/model/results");
  if (!modelResp.success) {
    modelBtn.disabled = true;
    modelBtn.title    = "Train a model in Step 9 — Model first.";
    numpyBtn.disabled = true;
    numpyBtn.title    = "Train a model in Step 9 — Model first.";
  } else {
    const modelType = modelResp.results?.model_type || "";
    if (!NUMPY_SUPPORTED.includes(modelType)) {
      numpyBtn.disabled = true;
      numpyBtn.title    = `NumPy-only export is not available for ${modelType.toUpperCase() || "this model type"}. Supported: Linear, GPR. Use the standard export instead.`;
    }
  }

  // ── Export history ───────────────────────────────────────────────────────
  const historyDiv = el("div", { id: "export-history" });
  containerEl.appendChild(historyDiv);
  _loadExportHistory(historyDiv);

  // ── Event wiring ─────────────────────────────────────────────────────────
  clsSel.addEventListener("change", () => _updateItarRow(clsSel, itarRow, genBtn));
  _updateItarRow(clsSel, itarRow, genBtn);

  genBtn.addEventListener("click", async () => {
    const cls = clsSel.value;
    const needsAck = cls === "ITAR" || cls === "EAR";
    const ackChecked = document.getElementById("export-itar-ack")?.checked;

    if (needsAck && !ackChecked) {
      showError("You must confirm export compliance before generating an export-controlled report.");
      return;
    }

    genBtn.disabled = true;
    showSpinner(genBtn);
    genBtn.textContent = "";

    try {
      const resp = await fetch("/api/export/report", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ classification: cls, acknowledged: needsAck ? true : false }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        showError(err.message || `Report generation failed (HTTP ${resp.status}).`);
        return;
      }

      // Trigger download
      const blob     = await resp.blob();
      const cd       = resp.headers.get("Content-Disposition") || "";
      const match    = cd.match(/filename=(.+)/);
      const filename = match ? match[1] : "surrogate_report.html";

      _downloadBlob(blob, filename);
      showSuccess("Report downloaded.");
      _loadExportHistory(historyDiv);
    } catch (err) {
      showError("Network error generating report. Check the console.");
      console.error(err);
    } finally {
      genBtn.disabled = false;
      hideSpinner(genBtn);
      genBtn.textContent = "Generate Report";
    }
  });

  modelBtn.addEventListener("click", async () => {
    const cls = clsSel.value;
    const needsAck = cls === "ITAR" || cls === "EAR";
    const ackChecked = document.getElementById("export-itar-ack")?.checked;

    if (needsAck && !ackChecked) {
      showError("You must confirm export compliance before downloading an export-controlled model.");
      return;
    }

    modelBtn.disabled    = true;
    modelBtn.textContent = "Preparing…";
    showSpinner(modelBtn);

    try {
      const resp = await fetch("/api/export/model", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ classification: cls, acknowledged: needsAck ? true : false }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        showError(err.message || `Model export failed (HTTP ${resp.status}).`);
        return;
      }

      const blob     = await resp.blob();
      const cd       = resp.headers.get("Content-Disposition") || "";
      const match    = cd.match(/filename=(.+)/);
      const filename = match ? match[1] : "surrogate_export.zip";

      _downloadBlob(blob, filename);
      showSuccess("Model bundle downloaded.");
      _loadExportHistory(historyDiv);
    } catch (err) {
      showError("Network error downloading model. Check the console.");
      console.error(err);
    } finally {
      modelBtn.disabled    = false;
      hideSpinner(modelBtn);
      modelBtn.textContent = "Download Model (.zip)";
    }
  });

  numpyBtn.addEventListener("click", async () => {
    const cls = clsSel.value;
    const needsAck = cls === "ITAR" || cls === "EAR";
    const ackChecked = document.getElementById("export-itar-ack")?.checked;

    if (needsAck && !ackChecked) {
      showError("You must confirm export compliance before downloading an export-controlled model.");
      return;
    }

    numpyBtn.disabled    = true;
    numpyBtn.textContent = "Preparing…";
    showSpinner(numpyBtn);

    try {
      const resp = await fetch("/api/export/model/numpy", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ classification: cls, acknowledged: needsAck ? true : false }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        showError(err.message || `NumPy export failed (HTTP ${resp.status}).`);
        return;
      }

      const blob     = await resp.blob();
      const cd       = resp.headers.get("Content-Disposition") || "";
      const match    = cd.match(/filename=(.+)/);
      const filename = match ? match[1] : "surrogate_numpy.zip";

      _downloadBlob(blob, filename);
      showSuccess("NumPy bundle downloaded. Open surrogate.py to get started.");
      _loadExportHistory(historyDiv);
    } catch (err) {
      showError("Network error downloading NumPy bundle. Check the console.");
      console.error(err);
    } finally {
      numpyBtn.disabled    = false;
      hideSpinner(numpyBtn);
      numpyBtn.textContent = "Export NumPy (.zip)";
    }
  });

  auditBtn.addEventListener("click", () => {
    window.location.href = "/api/export/audit";
  });
}


// ── Internal helpers ──────────────────────────────────────────────────────────

function _updateItarRow(clsSel, itarRow, genBtn) {
  const cls = clsSel.value;
  const needsAck = cls === "ITAR" || cls === "EAR";

  if (needsAck) {
    itarRow.classList.remove("hidden");
    const warnEl = document.getElementById("export-itar-text");
    if (warnEl) warnEl.textContent = ITAR_WARNING[cls];

    // Disable generate until acknowledged
    const ackBox = document.getElementById("export-itar-ack");
    genBtn.disabled = !ackBox?.checked;
    if (ackBox && !ackBox.dataset.wired) {
      ackBox.dataset.wired = "1";
      ackBox.addEventListener("change", () => { genBtn.disabled = !ackBox.checked; });
    }
  } else {
    itarRow.classList.add("hidden");
    const ackBox = document.getElementById("export-itar-ack");
    if (ackBox) ackBox.checked = false;
    genBtn.disabled = false;
  }
}

async function _loadExportHistory(container) {
  clearEl(container);
  const resp = await get("/api/export/log");
  if (!resp.success || !resp.log?.length) return;

  const section = el("div", { cls: "export-history-section" });
  section.innerHTML = `<h3 class="section-subtitle">Export History</h3>`;

  const table = document.createElement("table");
  table.className = "results-table export-history-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Timestamp (UTC)</th>
        <th>Filename</th>
        <th>Classification</th>
        <th>SHA-256</th>
      </tr>
    </thead>`;
  const tbody = document.createElement("tbody");

  const reversed = [...resp.log].reverse();
  for (const entry of reversed) {
    const tr = document.createElement("tr");
    const ts = (entry.timestamp || "").replace("T", " ").slice(0, 19);
    const hash = entry.file_hash ? entry.file_hash.slice(0, 12) + "…" : "—";
    tr.innerHTML = `
      <td class="metric-secondary">${escHtml(ts)}</td>
      <td>${escHtml(entry.filename || "—")}</td>
      <td><span class="export-cls-chip export-cls-chip--${(entry.classification || "").toLowerCase().replace(/\s/g, "")}">${escHtml(entry.classification || "—")}</span></td>
      <td class="metric-secondary" title="${escHtml(entry.file_hash || "")}">${hash}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  section.appendChild(table);
  container.appendChild(section);
}

function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
