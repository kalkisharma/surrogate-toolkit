// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/charts.js
// Description: Plotly wrapper — the ONLY file that calls Plotly.* methods.
//              All other modules import from here; never call Plotly directly.
//
// Pinned Plotly version: 2.35.2  (static/vendor/plotly.min.js)
// =============================================================================

// Maximum columns shown in scatter matrix before we cap for readability.
const SPLOM_MAX_COLS = 10;

/**
 * Return theme-aware color/font values for the scatter matrix.
 * Called at render time so toggling theme between renders picks up correctly.
 */
function _getThemeColors() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  return {
    normal:  dark ? "rgba(75,110,245,0.65)"  : "rgba(59,93,217,0.75)",
    outlier: dark ? "rgba(239,68,68,0.85)"   : "rgba(220,38,38,0.90)",
    font:    dark ? "#8b94b3"                : "#4b5478",
  };
}

/**
 * Render a scatter plot matrix (SPLOM) for the given data.
 *
 * If more than SPLOM_MAX_COLS columns are provided, only the first
 * SPLOM_MAX_COLS are shown. The caller is notified via the return value.
 *
 * @param {HTMLElement} containerEl - DOM element to render into.
 * @param {string[]} columns - Column names to include.
 * @param {object[]} rows - Array of row objects (preview or full data).
 * @param {object} [options]
 * @param {Set<number>} [options.outlierIndices] - Row indices to colour as outliers.
 * @returns {{ capped: boolean, displayedColumns: string[] }}
 */
export function renderScatterMatrix(containerEl, columns, rows, options = {}) {
  const displayedColumns = columns.slice(0, SPLOM_MAX_COLS);
  const capped = columns.length > SPLOM_MAX_COLS;

  if (!rows || rows.length === 0) {
    containerEl.innerHTML = '<p style="color:var(--color-text-muted);padding:2rem;text-align:center">No data to display.</p>';
    return { capped, displayedColumns };
  }

  const { outlierIndices = new Set() } = options;
  const theme = _getThemeColors();

  // Build per-column value arrays
  const colData = displayedColumns.map((col) => rows.map((r) => r[col] ?? null));

  // Point colours: accent for normal, error red for outliers
  const colors = rows.map((_, i) =>
    outlierIndices.has(i) ? theme.outlier : theme.normal
  );

  // Scale marker size by row count — larger dots for sparse datasets
  const markerSize = Math.max(4, Math.min(8, 400 / rows.length));

  // Truncate long column names so labels don't overlap in SPLOM cells
  const truncate = (name) => name.length > 9 ? name.slice(0, 8) + "…" : name;

  const trace = {
    type: "splom",
    dimensions: displayedColumns.map((col, i) => ({
      label:  truncate(col),
      values: colData[i],
    })),
    marker: {
      color:   colors,
      size:    markerSize,
      opacity: 0.8,
      line:    { width: 0 },
    },
    diagonal:      { visible: true },
    showupperhalf: false,
    showlowerhalf: true,
  };

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor:  "rgba(0,0,0,0)",
    font: { color: theme.font, family: "Inter, system-ui, sans-serif", size: 11 },
    margin:   { t: 20, b: 20, l: 20, r: 20 },
    height:   Math.max(400, displayedColumns.length * 90),
    dragmode: "select",
  };

  const config = {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["toImage", "sendDataToCloud"],
  };

  // eslint-disable-next-line no-undef
  Plotly.newPlot(containerEl, [trace], layout, config);

  return { capped, displayedColumns };
}

/**
 * Update the marker colours in an existing SPLOM (e.g. toggling outliers).
 * Uses Plotly.restyle for a cheap update that avoids re-rendering.
 *
 * @param {HTMLElement} containerEl
 * @param {object[]} rows
 * @param {Set<number>} outlierIndices
 */
export function updateScatterMatrixOutliers(containerEl, rows, outlierIndices) {
  if (!containerEl._fullLayout) return; // not yet rendered

  const theme = _getThemeColors();
  const colors = rows.map((_, i) =>
    outlierIndices.has(i) ? theme.outlier : theme.normal
  );

  // eslint-disable-next-line no-undef
  Plotly.restyle(containerEl, { "marker.color": [colors] }, [0]);
}

/**
 * Resize all Plotly charts inside containerEl to fit their container.
 * Call after layout changes (e.g. sidebar toggle).
 * @param {HTMLElement} [containerEl=document.body]
 */
export function relayout(containerEl = document.body) {
  // eslint-disable-next-line no-undef
  containerEl.querySelectorAll(".js-plotly-plot").forEach((div) => Plotly.Plots.resize(div));
}
