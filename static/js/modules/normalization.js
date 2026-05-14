// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/normalization.js
// Version: 0.5.0
// Description: Normalization step — lets users pick a scaling method for input
//              columns and applies it via POST /api/data/normalize.
//              Gated: rendered only after column designation is confirmed.
// =============================================================================

import { post } from "../api.js";
import { showError, showSuccess } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { registerPrimer } from "../learning_mode.js";
import { el } from "../utils.js";
import { renderNormBoxPlots } from "../charts.js";

const METHODS = [
  { value: "none",   label: "None (passthrough)",        desc: "No scaling — use raw values." },
  { value: "minmax", label: "Min-Max  [0, 1]",           desc: "Scales each input column to [0, 1]. Preserves shape; sensitive to outliers." },
  { value: "zscore", label: "Z-Score  (μ=0, σ=1)",       desc: "Standardizes to zero mean and unit variance. Suitable for GPR." },
];

/**
 * Render the normalization section into containerEl.
 *
 * @param {HTMLElement} containerEl    - Target card element.
 * @param {string}      currentMethod  - Current normalization method from metadata (null if none applied).
 * @param {number}      nInputs        - Number of designated input columns.
 */
export function initNormalization(containerEl, currentMethod, nInputs) {
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Step 5 — Normalization</h2>
    <p class="section-desc">Scale input columns before training. Outputs are left unchanged.</p>
  `;
  containerEl.appendChild(header);

  registerPrimer(
    "normalization",
    header,
    "Why normalize inputs?",
    `<p>Many surrogate models (especially GPR) are sensitive to the scale of input variables.
     If one input ranges 0–1,000 and another 0–1, the model may over-weight the larger variable.</p>
     <p><strong>Min-Max</strong> scales each column to [0, 1]. Good when you know the physical range
     of each variable is meaningful.</p>
     <p><strong>Z-Score</strong> centers each column at zero with unit standard deviation.
     Better when the distribution shape matters more than the raw range.</p>
     <p><strong>None</strong> — skip normalization when inputs are already on comparable scales.</p>`
  );

  // ── Status display ──────────────────────────────────────────────────────────
  if (currentMethod && currentMethod !== "none") {
    const statusEl = el("div", { cls: "norm-status" });
    statusEl.innerHTML = `
      <span class="norm-status__icon">✓</span>
      <span class="norm-status__text">
        <strong>${currentMethod === "minmax" ? "Min-Max" : "Z-Score"}</strong> normalization
        applied to ${nInputs} input column${nInputs !== 1 ? "s" : ""}.
        Re-apply below to change method.
      </span>
    `;
    containerEl.appendChild(statusEl);
  }

  // ── Method selector ─────────────────────────────────────────────────────────
  let selectedMethod = currentMethod || "none";
  const optionsWrap  = el("div", { cls: "norm-options" });

  for (const m of METHODS) {
    const wrapper = el("div", { cls: "norm-option" });
    const radioId = `norm-${m.value}`;
    const radio   = el("input", { type: "radio", name: "norm-method", id: radioId, value: m.value });
    radio.checked = selectedMethod === m.value;
    radio.addEventListener("change", () => { if (radio.checked) selectedMethod = m.value; });

    const lbl = el("label", { cls: "norm-option__label", for: radioId });
    lbl.innerHTML = `<span class="norm-option__name">${m.label}</span><span class="norm-option__desc">${m.desc}</span>`;
    wrapper.appendChild(radio);
    wrapper.appendChild(lbl);
    optionsWrap.appendChild(wrapper);
  }
  containerEl.appendChild(optionsWrap);

  // ── Apply button ────────────────────────────────────────────────────────────
  const applyBtn = el("button", {
    cls:   "btn btn-primary",
    text:  "Apply Normalization →",
    style: "margin-top: var(--space-5);",
  });

  applyBtn.addEventListener("click", async () => {
    applyBtn.disabled    = true;
    applyBtn.textContent = "Applying…";
    showSpinner(containerEl);

    const resp = await post("/api/data/normalize", { method: selectedMethod });

    hideSpinner(containerEl);
    applyBtn.disabled    = false;
    applyBtn.textContent = "Apply Normalization →";

    if (!resp.success) {
      showError(resp.message || "Normalization failed.");
      return;
    }

    const label = METHODS.find(m => m.value === selectedMethod)?.label ?? selectedMethod;
    showSuccess(`${label} normalization applied to ${resp.n_columns} input column${resp.n_columns !== 1 ? "s" : ""}.`);

    // Refresh the status display inline
    const existing = containerEl.querySelector(".norm-status");
    if (existing) existing.remove();
    if (selectedMethod !== "none") {
      const statusEl = el("div", { cls: "norm-status" });
      statusEl.innerHTML = `
        <span class="norm-status__icon">✓</span>
        <span class="norm-status__text">
          <strong>${selectedMethod === "minmax" ? "Min-Max" : "Z-Score"}</strong> normalization
          applied to ${resp.n_columns} input column${resp.n_columns !== 1 ? "s" : ""}.
          Re-apply below to change method.
        </span>
      `;
      containerEl.insertBefore(statusEl, optionsWrap);
    }

    // Before/after histograms
    const existingHist = containerEl.querySelector(".norm-hist-section");
    if (existingHist) existingHist.remove();
    if (resp.hist_data && resp.input_columns?.length) {
      const histSection = el("div", { cls: "norm-hist-section" });
      const histTitle   = el("div", { cls: "norm-hist-section-title",
        text: "Before (blue) vs. after (green) scaling — input columns only" });
      const histGrid    = el("div", { cls: "norm-hist-grid" });
      histSection.appendChild(histTitle);
      histSection.appendChild(histGrid);
      containerEl.appendChild(histSection);
      renderNormBoxPlots(histGrid, resp.hist_data, resp.input_columns, selectedMethod);
    }
  });

  containerEl.appendChild(applyBtn);
}
