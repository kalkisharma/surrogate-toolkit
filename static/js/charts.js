// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/charts.js
// Version: 0.9.4
// Description: Plotly wrapper — the ONLY file that calls Plotly.* methods.
//              All other modules import from here; never call Plotly directly.
//
// Pinned Plotly version: 2.35.2  (static/vendor/plotly.min.js)
// =============================================================================

// Maximum columns shown in scatter matrix before we cap for readability.
const SPLOM_MAX_COLS = 12;

function _hexToRgba(hex, opacity) {
  if (!hex || !hex.startsWith("#")) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

// Normal/outlier color pairs per palette, for light and dark themes.
const _PALETTES = {
  blueRed: {
    light: { normal: "rgba(59,93,217,0.75)",  outlier: "rgba(220,38,38,0.90)"  },
    dark:  { normal: "rgba(75,110,245,0.65)",  outlier: "rgba(239,68,68,0.85)"  },
  },
  greenOrange: {
    light: { normal: "rgba(22,163,74,0.75)",   outlier: "rgba(234,88,12,0.90)"  },
    dark:  { normal: "rgba(34,197,94,0.65)",   outlier: "rgba(251,146,60,0.85)" },
  },
  tealAmber: {
    light: { normal: "rgba(13,148,136,0.75)",  outlier: "rgba(217,119,6,0.90)"  },
    dark:  { normal: "rgba(20,184,166,0.65)",  outlier: "rgba(245,158,11,0.85)" },
  },
};

/**
 * Return theme- and palette-aware color values.
 * Called at render time so toggling theme between renders picks up correctly.
 *
 * @param {string} [palette="blueRed"]
 */
function _getThemeColors(palette = "blueRed") {
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const pal = _PALETTES[palette] || _PALETTES.blueRed;
  const { normal, outlier } = dark ? pal.dark : pal.light;
  return {
    normal,
    outlier,
    font: dark ? "#8b94b3" : "#4b5478",
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
 * @param {Set<number>} [options.outlierIndices]   - Row indices to colour as outliers.
 * @param {number}      [options.fontSize=11]      - Dimension label font size (px).
 * @param {number}      [options.tickFontSize=9]   - Axis tick number font size (px).
 * @param {number|null} [options.markerSize]       - null = auto-scale by row count.
 * @param {number|null} [options.height]           - null = auto-scale by column count.
 * @param {boolean}     [options.showMajorGrid=true]
 * @param {boolean}     [options.showMinorGrid=false]
 * @param {string}      [options.palette="blueRed"]
 * @param {number}      [options.opacity=0.8]          - Marker fill opacity (0.1–1.0).
 * @param {string}      [options.edgeColor="#000000"]   - Marker border colour (hex).
 * @param {number}      [options.edgeWidth=0]           - Marker border width (px).
 * @param {string}      [options.majorGridColor="#cccccc"]
 * @param {number}      [options.majorGridOpacity=1.0]
 * @param {string}      [options.minorGridColor="#e0e0e0"]
 * @param {number}      [options.minorGridOpacity=0.6]
 * @param {boolean}     [options.cellShading=false]        - Subtle theme-aware tint on each SPLOM cell.
 * @param {string|null} [options.plotBgColor=null]      - null = transparent (or cellShading tint).
 * @param {string|null} [options.paperBgColor=null]     - null = transparent.
 * @param {string|null} [options.fontColor=null]        - null = theme default.
 * @returns {{ capped: boolean, displayedColumns: string[], computedMarkerSize: number, computedHeight: number }}
 */
export function renderScatterMatrix(containerEl, columns, rows, options = {}) {
  const {
    outlierIndices   = new Set(),
    fontSize         = 11,
    tickFontSize     = 9,
    markerSize       = null,
    height           = null,
    showMajorGrid    = true,
    showMinorGrid    = false,
    palette          = "blueRed",
    opacity          = 0.8,
    edgeColor        = "#000000",
    edgeWidth        = 0,
    majorGridColor   = "#cccccc",
    majorGridOpacity = 1.0,
    minorGridColor   = "#e0e0e0",
    minorGridOpacity = 0.6,
    cellShading      = false,
    plotBgColor      = null,
    paperBgColor     = null,
    fontColor        = null,
  } = options;

  const displayedColumns = columns.slice(0, SPLOM_MAX_COLS);
  const capped = columns.length > SPLOM_MAX_COLS;

  if (!rows || rows.length === 0) {
    containerEl.innerHTML = '<p style="color:var(--color-text-muted);padding:2rem;text-align:center">No data to display.</p>';
    return { capped, displayedColumns, computedMarkerSize: 6, computedHeight: 400 };
  }

  const theme = _getThemeColors(palette);

  // Build per-column value arrays
  const colData = displayedColumns.map((col) => rows.map((r) => r[col] ?? null));

  // Point colours: palette normal for regular points, outlier red for flagged rows
  const colors = rows.map((_, i) =>
    outlierIndices.has(i) ? theme.outlier : theme.normal
  );

  const computedMarkerSize = markerSize !== null ? markerSize : Math.max(4, Math.min(8, 400 / rows.length));
  const computedHeight     = height     !== null ? height     : Math.max(400, displayedColumns.length * 90);

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const effectivePlotBg = plotBgColor !== null
    ? plotBgColor
    : cellShading
      ? (isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)")
      : "rgba(0,0,0,0)";

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
      size:    computedMarkerSize,
      opacity: opacity,
      line:    { width: edgeWidth, color: edgeColor },
    },
    diagonal:      { visible: true, type: "histogram" },
    showupperhalf: false,
    showlowerhalf: true,
  };

  // Enumerate axis keys for all SPLOM dimensions.
  // Plotly generates: xaxis, xaxis2, xaxis3, ... (first axis has no number suffix).
  const axisLayout = {};
  for (let i = 1; i <= displayedColumns.length; i++) {
    const xk = i === 1 ? "xaxis" : `xaxis${i}`;
    const yk = i === 1 ? "yaxis" : `yaxis${i}`;
    const axisOpts = {
      showgrid:  showMajorGrid,
      gridcolor: _hexToRgba(majorGridColor, majorGridOpacity),
      tickfont:  { size: tickFontSize },
      showline:  false,
      ...(showMinorGrid ? { minor: { showgrid: true, gridcolor: _hexToRgba(minorGridColor, minorGridOpacity) } } : {}),
    };
    axisLayout[xk] = axisOpts;
    axisLayout[yk] = { ...axisOpts };
  }

  const layout = {
    paper_bgcolor: paperBgColor || "rgba(0,0,0,0)",
    plot_bgcolor:  effectivePlotBg,
    font:     { color: fontColor || theme.font, family: "Inter, system-ui, sans-serif", size: fontSize },
    margin: {
      l: Math.max(50, tickFontSize * 6),
      b: Math.max(50, tickFontSize * 6),
      t: Math.max(30, fontSize * 3),
      r: 20,
    },
    height:   computedHeight,
    dragmode: "select",
    ...axisLayout,
  };

  const config = {
    responsive:             true,
    displayModeBar:         true,
    displaylogo:            false,
    modeBarButtonsToRemove: ["sendDataToCloud"],
  };

  // eslint-disable-next-line no-undef
  Plotly.newPlot(containerEl, [trace], layout, config);

  return { capped, displayedColumns, computedMarkerSize, computedHeight };
}

/**
 * Update the marker colours in an existing SPLOM (e.g. toggling outliers).
 * Uses Plotly.restyle for a cheap update that avoids re-rendering.
 *
 * @param {HTMLElement} containerEl
 * @param {object[]} rows
 * @param {Set<number>} outlierIndices
 * @param {string} [palette="blueRed"]
 */
export function updateScatterMatrixOutliers(containerEl, rows, outlierIndices, palette = "blueRed") {
  if (!containerEl._fullLayout) return;

  const theme = _getThemeColors(palette);
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

/**
 * Render a parity plot (y_true vs y_pred) for one output column.
 *
 * @param {HTMLElement} containerEl - Element to render into.
 * @param {number[]}    yTrue       - Actual test values.
 * @param {number[]}    yPred       - Predicted test values.
 * @param {string}      colName     - Output column name (used for axis labels).
 * @param {string}      [badgeCls="green"] - "green" | "amber" | "red" — sets point colour.
 */
export function renderParityPlot(containerEl, yTrue, yPred, colName, badgeCls = "green", opts = {}) {
  const isDark     = document.documentElement.getAttribute("data-theme") === "dark";
  const fontClr    = isDark ? "#8b94b3" : "#4b5478";
  const opac       = opts.opacity    ?? 0.70;
  const mSize      = opts.markerSize ?? 7;
  const height     = opts.height     ?? 300;
  const showGrid   = opts.showGrid   ?? true;
  const gridClr    = opts.gridColor  ?? (isDark ? "#2d3250" : "#e2e6f2");
  const fontSize   = opts.fontSize   ?? 11;
  const edgeWidth  = opts.edgeWidth  ?? 0;
  const edgeColor  = opts.edgeColor  ?? "#000000";

  const ptColor = badgeCls === "red"   ? `rgba(239,68,68,${opac})`
                : badgeCls === "amber" ? `rgba(245,158,11,${opac})`
                :                        `rgba(75,110,245,${opac})`;

  const mn = Math.min(...yTrue, ...yPred);
  const mx = Math.max(...yTrue, ...yPred);

  const scatter = {
    type: "scatter", mode: "markers",
    x: yTrue, y: yPred,
    name: "Test points",
    marker: { color: ptColor, size: mSize, line: { width: edgeWidth, color: edgeColor } },
  };
  const diagonal = {
    type: "scatter", mode: "lines",
    x: [mn, mx], y: [mn, mx],
    name: "Ideal",
    line: { color: isDark ? "#555e80" : "#c0c9e8", width: 1.5, dash: "dash" },
    showlegend: false,
  };

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor:  "rgba(0,0,0,0)",
    height,
    margin: { l: 52, r: 16, t: 36, b: 48 },
    font:   { color: fontClr, family: "Inter, system-ui, sans-serif", size: fontSize },
    xaxis:  { title: { text: `Actual — ${colName}`, font: { size: fontSize } }, gridcolor: gridClr, showgrid: showGrid },
    yaxis:  { title: { text: "Predicted", font: { size: fontSize } }, gridcolor: gridClr, showgrid: showGrid },
    showlegend: false,
  };

  // eslint-disable-next-line no-undef
  Plotly.newPlot(containerEl, [diagonal, scatter], layout, {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtons: [["toImage"]],
    toImageButtonOptions: { filename: `parity_${colName}`, scale: 2 },
  });
}

/**
 * Render a residual plot (y_true vs residual) for one output column.
 *
 * @param {HTMLElement} containerEl - Element to render into.
 * @param {number[]}    yTrue       - Actual test values (x-axis).
 * @param {number[]}    yPred       - Predicted test values.
 * @param {string}      colName     - Output column name.
 * @param {string}      [badgeCls="green"]
 */
export function renderResidualPlot(containerEl, yTrue, yPred, colName, badgeCls = "green", opts = {}) {
  const isDark     = document.documentElement.getAttribute("data-theme") === "dark";
  const fontClr    = isDark ? "#8b94b3" : "#4b5478";
  const opac       = opts.opacity    ?? 0.70;
  const mSize      = opts.markerSize ?? 7;
  const height     = opts.height     ?? 300;
  const showGrid   = opts.showGrid   ?? true;
  const gridClr    = opts.gridColor  ?? (isDark ? "#2d3250" : "#e2e6f2");
  const fontSize   = opts.fontSize   ?? 11;
  const edgeWidth  = opts.edgeWidth  ?? 0;
  const edgeColor  = opts.edgeColor  ?? "#000000";

  const ptColor    = badgeCls === "red"   ? `rgba(239,68,68,${opac})`
                   : badgeCls === "amber" ? `rgba(245,158,11,${opac})`
                   :                        `rgba(75,110,245,${opac})`;
  const residuals  = yTrue.map((v, i) => v - yPred[i]);
  const mn         = Math.min(...yTrue);
  const mx         = Math.max(...yTrue);

  const scatter = {
    type: "scatter", mode: "markers",
    x: yTrue, y: residuals,
    name: "Residual",
    marker: { color: ptColor, size: mSize, line: { width: edgeWidth, color: edgeColor } },
  };
  const zeroline = {
    type: "scatter", mode: "lines",
    x: [mn, mx], y: [0, 0],
    line: { color: isDark ? "#555e80" : "#c0c9e8", width: 1.5, dash: "dash" },
    showlegend: false,
  };

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor:  "rgba(0,0,0,0)",
    height,
    margin: { l: 52, r: 16, t: 36, b: 48 },
    font:   { color: fontClr, family: "Inter, system-ui, sans-serif", size: fontSize },
    xaxis:  { title: { text: `Actual — ${colName}`, font: { size: fontSize } }, gridcolor: gridClr, showgrid: showGrid },
    yaxis:  { title: { text: "Residual (actual − predicted)", font: { size: fontSize } }, gridcolor: gridClr, showgrid: showGrid },
    showlegend: false,
  };

  // eslint-disable-next-line no-undef
  Plotly.newPlot(containerEl, [zeroline, scatter], layout, {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtons: [["toImage"]],
    toImageButtonOptions: { filename: `residual_${colName}`, scale: 2 },
  });
}

/**
 * Render a combined parity + residual diagnostic figure (1×2 subplots, linked x-axes)
 * for one output column. Used by the results tab in place of the two separate plot functions.
 *
 * @param {HTMLElement} containerEl        - Single container for the combined figure.
 * @param {number[]}    yTrue              - Actual test values.
 * @param {number[]}    yPred              - Predicted test values.
 * @param {string}      colName            - Output column name (used for axis labels and filename).
 * @param {string}      [badgeCls="green"] - R² quality class: "green" | "amber" | "red".
 * @param {object}      [opts={}]          - Plot settings (mirrors _DEFAULT_RESULT_SETTINGS).
 */
export function renderOutputFigure(containerEl, yTrue, yPred, colName, badgeCls = "green", opts = {}) {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";

  const fontSize         = opts.fontSize         ?? 11;
  const tickFontSize     = opts.tickFontSize      ?? 9;
  const fontColor        = opts.fontColor         ?? null;
  const opac             = opts.opacity           ?? 0.70;
  const mSize            = opts.markerSize        ?? 7;
  const edgeWidth        = opts.edgeWidth         ?? 0;
  const edgeColor        = opts.edgeColor         ?? "#000000";
  const height           = opts.height            ?? 300;
  const plotBgColor      = opts.plotBgColor       ?? null;
  const paperBgColor     = opts.paperBgColor      ?? null;
  const showMajorGrid    = opts.showMajorGrid      ?? true;
  const majorGridColor   = opts.majorGridColor    ?? "#cccccc";
  const majorGridOpacity = opts.majorGridOpacity  ?? 1.0;
  const showMinorGrid    = opts.showMinorGrid      ?? false;
  const minorGridColor   = opts.minorGridColor    ?? "#e0e0e0";
  const minorGridOpacity = opts.minorGridOpacity  ?? 0.6;

  const fontClr         = fontColor     || (isDark ? "#8b94b3" : "#4b5478");
  const resolvedPaperBg = paperBgColor  || "rgba(0,0,0,0)";
  const resolvedPlotBg  = plotBgColor   || "rgba(0,0,0,0)";
  const refLineClr      = isDark ? "#555e80" : "#c0c9e8";

  const ptColor = badgeCls === "red"   ? `rgba(239,68,68,${opac})`
                : badgeCls === "amber" ? `rgba(245,158,11,${opac})`
                :                        `rgba(75,110,245,${opac})`;
  const marker  = { color: ptColor, size: mSize, line: { width: edgeWidth, color: edgeColor } };

  const [pMin, pMax] = [Math.min(...yTrue, ...yPred), Math.max(...yTrue, ...yPred)];
  const residuals    = yTrue.map((v, i) => v - yPred[i]);
  const [rMin, rMax] = [Math.min(...yTrue), Math.max(...yTrue)];

  const parityPts = { type: "scatter", mode: "markers", x: yTrue,        y: yPred,     marker, xaxis: "x",  yaxis: "y",  showlegend: false };
  const diagonal  = { type: "scatter", mode: "lines",   x: [pMin, pMax], y: [pMin, pMax], line: { color: refLineClr, width: 1.5, dash: "dash" }, xaxis: "x",  yaxis: "y",  showlegend: false };
  const residPts  = { type: "scatter", mode: "markers", x: yTrue,        y: residuals, marker, xaxis: "x2", yaxis: "y2", showlegend: false };
  const zeroLine  = { type: "scatter", mode: "lines",   x: [rMin, rMax], y: [0, 0],    line: { color: refLineClr, width: 1.5, dash: "dash" }, xaxis: "x2", yaxis: "y2", showlegend: false };

  const axisBase = {
    showgrid:   showMajorGrid,
    gridcolor:  _hexToRgba(majorGridColor, majorGridOpacity),
    tickfont:   { size: tickFontSize },
    automargin: true,
    ...(showMinorGrid ? { minor: { showgrid: true, gridcolor: _hexToRgba(minorGridColor, minorGridOpacity) } } : {}),
  };

  const layout = {
    paper_bgcolor: resolvedPaperBg,
    plot_bgcolor:  resolvedPlotBg,
    height,
    margin:  { t: 28, b: 20, l: 20, r: 20 },
    font:    { color: fontClr, family: "Inter, system-ui, sans-serif", size: fontSize },
    xaxis:   { ...axisBase, title: { text: `Actual — ${colName}`, font: { size: fontSize } }, domain: [0, 0.45] },
    yaxis:   { ...axisBase, title: { text: "Predicted",            font: { size: fontSize } } },
    xaxis2:  { ...axisBase, title: { text: `Actual — ${colName}`, font: { size: fontSize } }, domain: [0.55, 1], anchor: "y2", matches: "x" },
    yaxis2:  { ...axisBase, title: { text: "Residual (actual − predicted)", font: { size: fontSize } }, anchor: "x2" },
    showlegend: false,
  };

  // eslint-disable-next-line no-undef
  Plotly.newPlot(containerEl, [diagonal, parityPts, zeroLine, residPts], layout, {
    responsive: true,
    displayModeBar: true,
    displaylogo: false,
    modeBarButtons: [["toImage"]],
    toImageButtonOptions: { filename: `${colName}_diagnostics`, scale: 2 },
  });
}

/**
 * Render before/after box plots for each normalized input column.
 * One small Plotly chart per column (two box plots side by side), tiled in a grid.
 *
 * @param {HTMLElement} gridEl    - Container with class norm-hist-grid.
 * @param {object}      histData  - { before: {col: number[]}, after: {col: number[]} }
 * @param {string[]}    inputCols - Column names to render.
 * @param {string}      method    - "minmax" | "zscore" | "none"
 */
export function renderNormBoxPlots(gridEl, histData, inputCols, method) {
  const isDark    = document.documentElement.getAttribute("data-theme") === "dark";
  const fontClr   = isDark ? "#8b94b3" : "#4b5478";
  const gridClr   = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const beforeClr = isDark ? "rgba(100,120,200,0.55)" : "rgba(59,93,217,0.45)";
  const afterClr  = isDark ? "rgba(59,198,130,0.70)"  : "rgba(22,163,74,0.60)";
  const afterLabel = method === "minmax" ? "After [0,1]" : method === "zscore" ? "After (σ)" : "After";

  for (const col of inputCols) {
    const before = histData.before[col] ?? [];
    const after  = histData.after[col]  ?? [];

    const cell = document.createElement("div");
    cell.className = "norm-hist-cell";
    const titleEl = document.createElement("div");
    titleEl.className = "norm-hist-cell-title";
    titleEl.title = col;
    titleEl.textContent = col;
    cell.appendChild(titleEl);

    const plotDiv = document.createElement("div");
    cell.appendChild(plotDiv);
    gridEl.appendChild(cell);

    const traceBefore = {
      y: before, type: "box", name: "Before",
      marker: { color: beforeClr }, line: { color: beforeClr },
      boxmean: true, boxpoints: false,
    };
    const traceAfter = {
      y: after, type: "box", name: afterLabel,
      marker: { color: afterClr }, line: { color: afterClr },
      boxmean: true, boxpoints: false,
    };

    // eslint-disable-next-line no-undef
    Plotly.newPlot(plotDiv, [traceBefore, traceAfter], {
      height: 180,
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor:  "rgba(0,0,0,0)",
      margin: { t: 4, b: 28, l: 32, r: 4 },
      font:  { color: fontClr, family: "Inter, system-ui, sans-serif", size: 9 },
      xaxis: { showgrid: false, tickfont: { size: 9 } },
      yaxis: { showgrid: true, gridcolor: gridClr, tickfont: { size: 9 } },
      showlegend: false,
    }, { responsive: true, displayModeBar: false });
  }
}
