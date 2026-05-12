// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/data_explorer.js
// Description: Data exploration view — scatter plot matrix (via charts.js),
//              stats sidebar, and outlier overlay toggle.
// =============================================================================

import { renderScatterMatrix, updateScatterMatrixOutliers } from "../charts.js";
import { registerPrimer, registerTooltip } from "../learning_mode.js";
import { mean, stdDev, median, skewness, detectOutliers, el, formatNum, clearEl } from "../utils.js";
import { get } from "../api.js";
import { showError } from "../notifications.js";

let _currentRows = [];
let _currentColumns = [];
let _outlierIndices = new Set();
let _showOutliers = false;
let _chartEl = null;

/**
 * Initialise the data exploration view.
 *
 * @param {HTMLElement} containerEl - The view root element (inside #app).
 * @param {object} uploadResponse - The full response from POST /api/data/upload.
 */
export async function initExploration(containerEl, uploadResponse) {
  clearEl(containerEl);

  // Try to load full-dataset stats from the summary endpoint.
  // Falls back to preview data if /api/data/summary is unavailable.
  let rows = uploadResponse.preview.rows;
  let columns = uploadResponse.preview.columns;
  let totalRows = uploadResponse.preview.total_rows;
  let usingFullData = false;

  const summaryResp = await get("/api/data/summary");
  if (summaryResp.success && summaryResp.stats) {
    // Rebuild row-format data from per-column stats for the sidebar.
    // Scatter matrix still uses preview rows (spatial distribution sampling).
    _fullStats = summaryResp.stats;
    usingFullData = true;
  }

  _currentRows = rows;
  _currentColumns = columns;
  _outlierIndices = detectOutliers(rows, columns);

  // ── Layout ────────────────────────────────────────────────────────────────
  const header = el("div", { cls: "section-header" });
  header.innerHTML = `
    <h2 class="section-title">Data Exploration</h2>
    <p class="section-desc">
      ${totalRows.toLocaleString()} rows × ${columns.length} columns
      — showing ${rows.length} preview rows in scatter matrix
    </p>
  `;
  containerEl.appendChild(header);

  // Learning mode primer
  registerPrimer(
    "explore",
    header,
    "What am I looking at? — Data exploration explained",
    `<p>The scatter plot matrix shows every pair of variables plotted against each other.
     Patterns here reveal correlations, clusters, and outliers before any model is trained.
     The stats sidebar shows key summary statistics for each column.</p>
     <p><strong>Tip:</strong> Highly correlated column pairs (diagonal lines) may indicate
     redundant inputs — the Dimensionality Reduction step addresses this.</p>`
  );

  if (usingFullData) {
    const notice = el("div", {
      cls: "limitation-notice",
      text: "Scatter matrix shows preview rows only. Summary statistics reflect the full dataset.",
    });
    containerEl.appendChild(notice);
  } else {
    const notice = el("div", {
      cls: "limitation-notice",
      text: `Scatter matrix and statistics are computed from ${rows.length} preview rows. Full-dataset statistics will be available in Phase 2.`,
    });
    containerEl.appendChild(notice);
  }

  // ── Column cap warning ────────────────────────────────────────────────────
  if (columns.length > 10) {
    const capNotice = el("div", {
      cls: "limitation-notice",
      html: `<strong>Note:</strong> Showing first 10 of ${columns.length} columns in the scatter matrix. Use the column selector (Phase 2) to choose which columns to display.`,
    });
    containerEl.appendChild(capNotice);
  }

  // ── Controls ──────────────────────────────────────────────────────────────
  const controls = el("div", { cls: "explore-controls" });
  const outlierLabel = el("label", { cls: "explore-controls__label" });
  const outlierCheckbox = el("input", { type: "checkbox", id: "outlier-toggle" });
  outlierLabel.appendChild(outlierCheckbox);
  outlierLabel.appendChild(document.createTextNode(" Show outliers (IQR)"));
  controls.appendChild(outlierLabel);

  registerTooltip(
    outlierLabel,
    "Toggle IQR-based outlier highlighting",
    "Outliers are points outside Q1 − 1.5×IQR or Q3 + 1.5×IQR for any column. Highlighted in red on the chart."
  );

  if (_outlierIndices.size > 0) {
    const outlierCount = el("span", {
      cls: "text-muted text-sm",
      text: `${_outlierIndices.size} potential outlier row(s) detected`,
    });
    controls.appendChild(outlierCount);
  }

  containerEl.appendChild(controls);

  // ── Two-column layout ─────────────────────────────────────────────────────
  const layout = el("div", { cls: "explore-layout" });

  // Chart column
  const chartCol = el("div", { cls: "explore-chart" });
  const chartWrap = el("div", { cls: "explore-chart-wrap", id: "splom-container" });
  chartCol.appendChild(chartWrap);
  _chartEl = chartWrap;

  // Stats sidebar
  const sidebar = el("div", { cls: "explore-sidebar" });
  const statsCard = _buildStatsCard(columns, rows, usingFullData ? _fullStats : null);
  sidebar.appendChild(statsCard);

  layout.appendChild(chartCol);
  layout.appendChild(sidebar);
  containerEl.appendChild(layout);

  // ── Render chart ──────────────────────────────────────────────────────────
  const { capped } = renderScatterMatrix(chartWrap, columns, rows, {
    outlierIndices: _showOutliers ? _outlierIndices : new Set(),
  });

  // ── Outlier toggle handler ─────────────────────────────────────────────────
  outlierCheckbox.addEventListener("change", () => {
    _showOutliers = outlierCheckbox.checked;
    updateScatterMatrixOutliers(
      _chartEl,
      _currentRows,
      _showOutliers ? _outlierIndices : new Set()
    );
  });
}

// ── Stats sidebar builder ─────────────────────────────────────────────────────

let _fullStats = null;

function _buildStatsCard(columns, rows, fullStats) {
  const card = el("div", { cls: "stat-card" });
  const title = el("div", { cls: "stat-card__title", text: "Summary Statistics" });
  card.appendChild(title);

  const list = el("div", { cls: "stat-col-list" });

  for (const col of columns) {
    const vals = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);

    // Use full-dataset stats if available, else compute from preview
    const stats = fullStats && fullStats[col]
      ? fullStats[col]
      : {
          min:    Math.min(...vals),
          max:    Math.max(...vals),
          mean:   mean(vals),
          std:    stdDev(vals),
          median: median(vals),
          null_count: rows.filter((r) => r[col] === null || r[col] === undefined).length,
        };

    const skew = skewness(vals);

    const item = el("div", { cls: "stat-col-item" });
    const nameEl = el("div", { cls: "stat-col-name", text: col });

    const valGrid = el("div", { cls: "stat-col-values" });
    const pairs = [
      ["min",    formatNum(stats.min)],
      ["max",    formatNum(stats.max)],
      ["mean",   formatNum(stats.mean)],
      ["std",    formatNum(stats.std)],
      ["median", formatNum(stats.median)],
      ["nulls",  String(stats.null_count)],
      ["skew",   skew !== null ? formatNum(skew, 2) : "—"],
    ];
    for (const [key, val] of pairs) {
      const pair = el("div", { cls: "stat-pair" });
      pair.innerHTML = `<span class="stat-pair__key">${key}</span> <span class="stat-pair__val">${val}</span>`;
      valGrid.appendChild(pair);
    }

    item.appendChild(nameEl);
    item.appendChild(valGrid);
    list.appendChild(item);
  }

  card.appendChild(list);
  return card;
}
