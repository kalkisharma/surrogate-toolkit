// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/charts.js
// Version: 2.5.0
// Description: Plotly wrapper — the ONLY file that calls Plotly.* methods.
//              All other modules import from here; never call Plotly directly.
//
// Pinned Plotly version: 2.35.2  (static/vendor/plotly.min.js)
// =============================================================================

// Maximum columns shown in scatter matrix before we cap for readability.
const SPLOM_MAX_COLS = 12;

// Explicit colorscale arrays extracted from the vendored Plotly build (v2.35.2).
// Using arrays instead of named strings bypasses Plotly's case-sensitive registry lookup.
const _COLORSCALES = {
  Viridis: [[0,"rgb(68,1,84)"],[0.13,"rgb(71,44,122)"],[0.25,"rgb(59,81,139)"],[0.38,"rgb(44,113,142)"],[0.5,"rgb(33,144,141)"],[0.63,"rgb(39,173,129)"],[0.75,"rgb(92,200,99)"],[0.88,"rgb(170,220,50)"],[1,"rgb(253,231,37)"]],
  Plasma:  [[0,"rgb(13,8,135)"],[0.13,"rgb(75,3,161)"],[0.25,"rgb(125,3,168)"],[0.38,"rgb(168,34,150)"],[0.5,"rgb(203,70,121)"],[0.63,"rgb(229,107,93)"],[0.75,"rgb(248,148,65)"],[0.88,"rgb(253,195,40)"],[1,"rgb(240,249,33)"]],
  RdBu:    [[0,"rgb(5,10,172)"],[0.35,"rgb(106,137,247)"],[0.5,"rgb(190,190,190)"],[0.6,"rgb(220,170,132)"],[0.7,"rgb(230,145,90)"],[1,"rgb(178,10,28)"]],
  Inferno: [[0,"rgb(0,0,4)"],[0.13,"rgb(31,12,72)"],[0.25,"rgb(85,15,109)"],[0.38,"rgb(136,34,106)"],[0.5,"rgb(186,54,85)"],[0.63,"rgb(227,89,51)"],[0.75,"rgb(249,140,10)"],[0.88,"rgb(249,201,50)"],[1,"rgb(252,255,164)"]],
  Hot:     [[0,"rgb(0,0,0)"],[0.3,"rgb(230,0,0)"],[0.6,"rgb(255,210,0)"],[1,"rgb(255,255,255)"]],
};

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
      b: Math.max(72, tickFontSize * 8),
      t: Math.max(30, fontSize * 3),
      r: 20,
    },
    height:   computedHeight,
    dragmode: "select",
    ...axisLayout,
  };

  const config = {
    // responsive: false — the SPLOM container uses an explicit style.height set by _rerender().
    // Plotly's built-in ResizeObserver (responsive:true) reads the padded *parent* clientHeight
    // instead of the element's inline height, causing incorrect sizing whenever the panel
    // transitions from display:none to visible. Manual resize is handled by activatePanel()
    // and the window-resize listener in data_explorer.js.
    responsive:             false,
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
  if (opts.stds && opts.stds.length === yTrue.length) {
    parityPts.error_y = {
      type: "data",
      array: opts.stds.map(s => s * 1.96),
      symmetric: true,
      visible: true,
      color: "rgba(99,102,241,0.35)",
      thickness: 1.2,
      width: 3,
    };
  }
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
 * Render a distance correlation heatmap.
 *
 * @param {HTMLElement} containerEl - Element to render into.
 * @param {string[]}    columns     - Column names (x and y axes).
 * @param {object}      matrix      - { col: { col: float } } — symmetric dCor matrix.
 * @param {object}      [options]
 * @param {number}      [options.fontSize=11]           - Axis label font size.
 * @param {string|null} [options.fontColor=null]        - null = theme default.
 * @param {string}      [options.colorscale="Viridis"]  - Plotly named colorscale.
 * @param {boolean}     [options.showAnnotations]       - Show cell values; auto-off above 7 cols.
 * @param {number|null} [options.height=null]           - null = auto from column count.
 */
export function renderDCorHeatmap(containerEl, columns, matrix, options = {}) {
  const isDark      = document.documentElement.getAttribute("data-theme") === "dark";
  const fontClr     = isDark ? "#8b94b3" : "#4b5478";
  const fontSize    = options.fontSize       ?? 11;
  const fontColor   = options.fontColor      ?? fontClr;
  const colorscale  = options.colorscale     ?? "Viridis";
  const showAnnot   = options.showAnnotations ?? (columns.length <= 7);
  const height      = options.height         ?? Math.max(320, columns.length * 48 + 100);

  // Scale annotation font down gracefully for many columns (min 7px)
  const annotFontSize = Math.max(7, fontSize - Math.max(0, columns.length - 5));

  // Per-colorscale annotation text: white on dark cells, dark on light cells.
  // Blues/RdPu are light at low end → need dark text for low values.
  // Viridis/Thermal are dark at low end → need white text for low values.
  const lightAtLow = colorscale === "Blues" || colorscale === "RdPu";
  const _annotColor = (val) =>
    lightAtLow ? (val > 0.5 ? "#ffffff" : fontColor)
               : (val < 0.5 ? "#ffffff" : fontColor);

  const z     = columns.map(r => columns.map(c => matrix[r]?.[c] ?? 0));
  const zText = z.map(row => row.map(v => v.toFixed(2)));

  const trace = {
    type:          "heatmap",
    x:             columns,
    y:             columns,
    z,
    colorscale,
    zmin:          0,
    zmax:          1,
    hovertemplate: "%{y} — %{x}: %{z:.3f}<extra></extra>",
    showscale:     true,
    colorbar: {
      thickness: 14,
      len:       0.8,
      tickfont:  { size: Math.max(8, fontSize - 1), color: fontColor },
    },
  };

  const annotations = showAnnot
    ? zText.flatMap((row, ri) =>
        row.map((val, ci) => ({
          x:         columns[ci],
          y:         columns[ri],
          text:      val,
          showarrow: false,
          font:      { size: annotFontSize, color: _annotColor(parseFloat(val)) },
        }))
      )
    : [];

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor:  "rgba(0,0,0,0)",
    height,
    margin:      { t: 20, b: 100, l: 100, r: 70 },
    font:        { color: fontColor, family: "Inter, system-ui, sans-serif", size: fontSize },
    xaxis:       { tickangle: -40, tickfont: { size: Math.max(8, fontSize - 1) }, automargin: true },
    yaxis:       { tickfont: { size: Math.max(8, fontSize - 1) }, automargin: true },
    annotations,
  };

  // eslint-disable-next-line no-undef
  Plotly.newPlot(containerEl, [trace], layout, {
    responsive:           true,
    displayModeBar:       true,
    displaylogo:          false,
    modeBarButtons:       [["toImage"]],
    toImageButtonOptions: { filename: "dcor_heatmap", scale: 2 },
  });
}

/**
 * Render a Pearson |r| correlation heatmap for input screening.
 * Cells that meet or exceed `threshold` are shown with a red border annotation.
 *
 * @param {HTMLElement} containerEl
 * @param {string[]}    labels      - Input column names (x and y axes)
 * @param {object}      matrix      - dict[col][col] → |r| value (−1 to 1)
 * @param {number}      [threshold=0.9] - Flag threshold; highlighted in annotations
 * @param {object}      [options={}]
 */
export function renderCorrelationHeatmap(containerEl, labels, matrix, threshold = 0.9, options = {}) {
  const isDark     = document.documentElement.getAttribute("data-theme") === "dark";
  const fontColor  = options.fontColor ?? (isDark ? "#8b94b3" : "#4b5478");
  const fontSize   = options.fontSize  ?? 11;
  const showAnnot  = options.showAnnotations ?? (labels.length <= 12);
  const height     = options.height ?? Math.max(280, labels.length * 44 + 100);
  const annotSize  = Math.max(7, fontSize - Math.max(0, labels.length - 6));

  // Build z matrix from absolute values for display
  const z     = labels.map(r => labels.map(c => Math.abs(matrix[r]?.[c] ?? 0)));
  const zText = z.map(row => row.map(v => v.toFixed(2)));

  const colorscale = [
    [0,   isDark ? "#1e2333" : "#f5f7fb"],
    [0.5, "rgba(245,158,11,0.55)"],
    [1,   "rgba(239,68,68,0.9)"],
  ];

  const trace = {
    type:          "heatmap",
    x:             labels,
    y:             labels,
    z,
    colorscale,
    zmin:          0,
    zmax:          1,
    hovertemplate: "%{y} vs %{x}: |r| = %{z:.3f}<extra></extra>",
    showscale:     true,
    colorbar: {
      title:     { text: "|r|", font: { size: fontSize, color: fontColor } },
      thickness: 14,
      len:       0.8,
      tickfont:  { size: Math.max(8, fontSize - 1), color: fontColor },
      tickvals:  [0, 0.5, 1],
      ticktext:  ["0", "0.5", "1"],
    },
  };

  const annotations = showAnnot
    ? zText.flatMap((row, ri) =>
        row.map((val, ci) => {
          const v     = parseFloat(val);
          const above = v >= threshold;
          return {
            x:         labels[ci],
            y:         labels[ri],
            text:      val,
            showarrow: false,
            font:      { size: annotSize, color: above ? "#ffffff" : fontColor,
                         weight: above ? 700 : 400 },
          };
        })
      )
    : [];

  const layout = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor:  "rgba(0,0,0,0)",
    height,
    margin:      { t: 20, b: 100, l: 100, r: 70 },
    font:        { color: fontColor, family: "Inter, system-ui, sans-serif", size: fontSize },
    xaxis:       { tickangle: -40, tickfont: { size: Math.max(8, fontSize - 1) }, automargin: true },
    yaxis:       { tickfont: { size: Math.max(8, fontSize - 1) }, automargin: true },
    annotations,
    shapes: labels.flatMap((r, ri) =>
      labels.map((c, ci) => {
        const v = Math.abs(matrix[r]?.[c] ?? 0);
        return v >= threshold && ri !== ci
          ? { type: "rect", xref: "x", yref: "y",
              x0: ci - 0.5, x1: ci + 0.5, y0: ri - 0.5, y1: ri + 0.5,
              line: { color: "rgba(239,68,68,0.8)", width: 2 }, fillcolor: "rgba(0,0,0,0)" }
          : null;
      }).filter(Boolean)
    ),
  };

  Plotly.react(containerEl, [trace], layout,
    { responsive: true, displayModeBar: false, staticPlot: false });
}

/**
 * Render before/after box plots for each normalized input column.
 * One small Plotly chart per column (two box plots side by side), tiled in a grid.
 *
 * @param {HTMLElement} gridEl    - Container with class norm-hist-grid.
 * @param {object}      histData  - { before: {col: number[]}, after: {col: number[]} }
 * @param {string[]}    inputCols - Column names to render.
 * @param {string}      method    - "minmax" | "zscore" | "none"
 * @param {object}      [settings={}] - Optional display settings from box plot settings panel.
 */
export function renderNormBoxPlots(gridEl, histData, inputCols, method, settings = {}) {
  const isDark      = document.documentElement.getAttribute("data-theme") === "dark";
  const fontClr     = isDark ? "#8b94b3" : "#4b5478";
  const gridClr     = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const beforeBase  = isDark ? "100,120,200" : "59,93,217";
  const afterBase   = isDark ? "59,198,130"  : "22,163,74";
  const afterLabel  = method === "minmax" ? "After [0,1]" : method === "zscore" ? "After (σ)" : "After";

  const cellHeight = settings.cellHeight  ?? 180;
  const opacity    = settings.opacity     ?? 0.7;
  const boxpoints  = settings.showPoints ? "outliers" : false;
  const boxmean    = settings.showMean    ?? true;
  const fontSize   = settings.fontSize    ?? 9;
  const fontColor  = settings.fontColor   ?? fontClr;
  const plotBg     = settings.plotBgColor  != null ? settings.plotBgColor  : "rgba(0,0,0,0)";
  const paperBg    = settings.paperBgColor != null ? settings.paperBgColor : "rgba(0,0,0,0)";
  const beforeClr  = `rgba(${beforeBase},${opacity})`;
  const afterClr   = `rgba(${afterBase},${opacity})`;

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
      boxmean, boxpoints,
    };
    const traceAfter = {
      y: after, type: "box", name: afterLabel,
      marker: { color: afterClr }, line: { color: afterClr },
      boxmean, boxpoints,
    };

    // eslint-disable-next-line no-undef
    Plotly.newPlot(plotDiv, [traceBefore, traceAfter], {
      height: cellHeight,
      paper_bgcolor: paperBg,
      plot_bgcolor:  plotBg,
      margin: { t: 4, b: 28, l: 32, r: 12 },
      font:  { color: fontColor, family: "Inter, system-ui, sans-serif", size: fontSize },
      xaxis: { showgrid: false, tickfont: { size: fontSize } },
      yaxis: { showgrid: true, gridcolor: gridClr, tickfont: { size: fontSize } },
      showlegend: false,
    }, { responsive: true, displayModeBar: false });
  }
}

/**
 * Render a Sobol sensitivity tornado chart (horizontal bar, ST + S1 overlay).
 *
 * @param {HTMLElement} containerEl - Element to render into.
 * @param {string[]}    inputCols   - Input column names (already sorted by caller or internally).
 * @param {object}      stValues    - { colName: ST float } total-order indices.
 * @param {object}      s1Values    - { colName: S1 float } first-order indices.
 * @param {object}      [options]
 */
export function renderTornadoChart(containerEl, inputCols, stValues, s1Values, options = {}) {
  const { fontSize = 13, fontColor = null, plotBgColor = null, paperBgColor = null } = options;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const _fc   = fontColor    ?? (isDark ? "#8b94b3" : "#4b5478");
  const _pb   = plotBgColor  ?? "rgba(0,0,0,0)";
  const _ppb  = paperBgColor ?? "rgba(0,0,0,0)";

  // Sort by ST descending
  const order = [...inputCols].sort((a, b) => (stValues[b] ?? 0) - (stValues[a] ?? 0));
  const stArr = order.map(c => stValues[c] ?? 0);
  const s1Arr = order.map(c => s1Values[c] ?? 0);

  const traces = [
    { type: "bar", orientation: "h", name: "Sₜ (Total)",       x: stArr, y: order,
      marker: { color: "rgba(99,102,241,0.85)" } },
    { type: "bar", orientation: "h", name: "S₁ (First-order)", x: s1Arr, y: order,
      marker: { color: "rgba(167,170,247,0.75)" } },
  ];

  const height = Math.max(280, order.length * 38 + 100);
  const layout = {
    barmode:       "overlay",
    height,
    margin:        { t: 16, b: 50, l: Math.max(...order.map(s => s.length)) * 7 + 16, r: 20 },
    xaxis:         { title: "Sensitivity index", range: [0, Math.max(...stArr, 0.05) + 0.05],
                     gridcolor: "rgba(128,128,128,0.2)", zeroline: false,
                     color: _fc, tickfont: { size: fontSize - 1 } },
    yaxis:         { color: _fc, tickfont: { size: fontSize - 1 }, automargin: true },
    font:          { size: fontSize, color: _fc },
    plot_bgcolor:  _pb,
    paper_bgcolor: _ppb,
    showlegend:    true,
    legend:        { x: 1, xanchor: "right", y: 1, font: { size: fontSize - 1 } },
  };

  // eslint-disable-next-line no-undef
  Plotly.react(containerEl, traces, layout, {
    responsive: true, displayModeBar: true, displaylogo: false,
    modeBarButtons: [["toImage"]],
    toImageButtonOptions: { filename: "tornado_chart", scale: 2 },
  });

  return { order };
}

/**
 * Render a tiled grid of OAT response line charts — one cell per input column.
 *
 * @param {HTMLElement} gridEl      - Container element; cells are appended to it.
 * @param {object}      oatData     - OAT response dict keyed by input column name.
 * @param {string[]}    sortedCols  - Column names in desired render order (ST-descending).
 * @param {object}      [options]
 */
export function renderOATGrid(gridEl, oatData, sortedCols, options = {}) {
  const { fontSize = 12, fontColor = null, plotBgColor = null, paperBgColor = null,
          cellHeight = 220, outputCol = null } = options;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const _fc  = fontColor    ?? (isDark ? "#8b94b3" : "#4b5478");
  const _pb  = plotBgColor  ?? "rgba(0,0,0,0)";
  const _ppb = paperBgColor ?? "rgba(0,0,0,0)";

  for (const col of sortedCols) {
    const d = oatData[col];
    if (!d) continue;

    const cell = document.createElement("div");
    cell.style.height = cellHeight + "px";
    gridEl.appendChild(cell);

    const medianX = d.median;
    const yMin    = Math.min(...d.y);
    const yMax    = Math.max(...d.y);

    const traces = [
      { type: "scatter", mode: "lines", x: d.x, y: d.y,
        line: { color: "rgba(99,102,241,0.9)", width: 2 } },
      { type: "scatter", mode: "lines",
        x: [medianX, medianX], y: [yMin, yMax],
        line: { dash: "dot", color: "rgba(128,128,128,0.6)", width: 1.5 },
        showlegend: false },
    ];

    const layout = {
      height:        cellHeight,
      title:         { text: col, font: { size: fontSize, color: _fc }, x: 0.05 },
      margin:        { t: 32, b: 52, l: 56, r: 8 },
      xaxis:         { title: { text: col, font: { size: fontSize - 1 } },
                       color: _fc, tickfont: { size: fontSize - 2 }, gridcolor: "rgba(128,128,128,0.15)" },
      yaxis:         { title: outputCol ? { text: outputCol, font: { size: fontSize - 1 } } : undefined,
                       color: _fc, tickfont: { size: fontSize - 2 }, gridcolor: "rgba(128,128,128,0.15)" },
      font:          { size: fontSize, color: _fc },
      plot_bgcolor:  _pb,
      paper_bgcolor: _ppb,
      showlegend:    false,
    };

    // eslint-disable-next-line no-undef
    Plotly.newPlot(cell, traces, layout, { responsive: true, displayModeBar: false });
  }
}

/**
 * Design space scatter: training samples (grey) + recommended points (purple stars).
 *
 * @param {HTMLElement} containerEl   - Target div; Plotly renders into it.
 * @param {number[][]}  X_train       - Training rows as array-of-arrays (n × n_features).
 * @param {object[]}    recommendations - Recommendation objects from active learning API.
 * @param {string[]}    inputCols     - Input column names in order.
 * @param {object}      [options]
 * @param {number}      [options.axisX=0]   - Index of the column shown on X axis.
 * @param {number}      [options.axisY=1]   - Index of the column shown on Y axis.
 * @param {string|null} [options.fontColor=null]
 * @param {string|null} [options.plotBgColor=null]
 * @param {string|null} [options.paperBgColor=null]
 */
/**
 * Render a Pareto front scatter plot for multi-objective optimization results.
 *
 * @param {HTMLElement} containerEl
 * @param {object[]}    paretoOutputs - Array of {output_col: value, ...} per solution
 * @param {string}      xObj          - Output column name for x-axis
 * @param {string}      yObj          - Output column name for y-axis
 * @param {object}      [options]
 */
export function renderParetoFront(containerEl, paretoOutputs, xObj, yObj, options = {}) {
  const { fontSize = 12, fontColor = null, plotBgColor = null, paperBgColor = null } = options;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const _fc    = fontColor    ?? (isDark ? "#8b94b3" : "#4b5478");
  const _pb    = plotBgColor  ?? "rgba(0,0,0,0)";
  const _ppb   = paperBgColor ?? "rgba(0,0,0,0)";

  const n = paretoOutputs.length;
  const x = paretoOutputs.map(r => r[xObj]);
  const y = paretoOutputs.map(r => r[yObj]);

  const trace = {
    type: "scatter", mode: "markers",
    name: "Pareto solution",
    x, y,
    marker: {
      color: paretoOutputs.map((_, i) => i / Math.max(n - 1, 1)),
      colorscale: "Viridis",
      size: 9,
      showscale: true,
      colorbar: {
        title: { text: "Solution #", font: { size: fontSize - 1 } },
        thickness: 12,
        len: 0.75,
        tickfont: { size: fontSize - 2, color: _fc },
        titlefont: { size: fontSize - 1, color: _fc },
      },
      line: { width: 0.5, color: "rgba(0,0,0,0.3)" },
    },
    hovertemplate: `${xObj}: %{x:.4g}<br>${yObj}: %{y:.4g}<extra></extra>`,
  };

  const layout = {
    height: 370,
    margin: { t: 16, b: 55, l: 65, r: 90 },
    xaxis: {
      title: { text: xObj, font: { size: fontSize } },
      color: _fc, gridcolor: "rgba(128,128,128,0.18)", zeroline: false,
    },
    yaxis: {
      title: { text: yObj, font: { size: fontSize } },
      color: _fc, gridcolor: "rgba(128,128,128,0.18)", zeroline: false,
    },
    font:          { size: fontSize, color: _fc },
    plot_bgcolor:  _pb,
    paper_bgcolor: _ppb,
    showlegend:    false,
  };

  // eslint-disable-next-line no-undef
  Plotly.react(containerEl, [trace], layout, {
    responsive: true, displayModeBar: true, displaylogo: false,
    modeBarButtons: [["toImage"]],
    toImageButtonOptions: { filename: "pareto_front", scale: 2 },
  });
}

export function renderDesignSpaceScatter(containerEl, X_train, recommendations, inputCols, options = {}) {
  const { axisX = 0, axisY = 1, fontSize = 12,
          fontColor = null, plotBgColor = null, paperBgColor = null } = options;

  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const _fc    = fontColor    ?? (isDark ? "#8b94b3" : "#4b5478");
  const _pb    = plotBgColor  ?? "rgba(0,0,0,0)";
  const _ppb   = paperBgColor ?? "rgba(0,0,0,0)";

  const xCol   = inputCols[axisX];
  const yCol   = inputCols[axisY];

  const trainTrace = {
    type: "scatter", mode: "markers", name: "Training data",
    x: X_train.map(r => r[axisX]),
    y: X_train.map(r => r[axisY]),
    marker: { color: isDark ? "rgba(180,180,200,0.45)" : "rgba(100,100,120,0.35)", size: 7 },
    hovertemplate: `${xCol}: %{x:.4g}<br>${yCol}: %{y:.4g}<extra>Training</extra>`,
  };

  const recHover = recommendations.map(r => {
    const scoreLabel = r._predicted !== undefined
      ? `Predicted: ${r._predicted.toFixed(4)}<br>Uncertainty: ±${r._uncertainty?.toFixed(4) ?? "N/A"}`
      : `Score: ${r._score?.toFixed(4) ?? ""}`;
    return `Rank ${r._rank}<br>${xCol}: ${r[xCol]?.toFixed(4)}<br>${yCol}: ${r[yCol]?.toFixed(4)}<br>${scoreLabel}`;
  });

  const recTrace = {
    type: "scatter", mode: "markers+text", name: "Recommended",
    x: recommendations.map(r => r[xCol]),
    y: recommendations.map(r => r[yCol]),
    text: recommendations.map(r => String(r._rank)),
    textposition: "top center",
    textfont: { size: fontSize - 1, color: _fc },
    marker: { color: "rgba(99,102,241,0.9)", size: 12, symbol: "star",
              line: { color: "rgba(99,102,241,1)", width: 1 } },
    hovertext: recHover,
    hoverinfo: "text",
  };

  const layout = {
    height: 380,
    margin: { t: 16, b: 50, l: 60, r: 16 },
    xaxis: { title: { text: xCol, font: { size: fontSize } },
             color: _fc, gridcolor: "rgba(128,128,128,0.18)", zeroline: false },
    yaxis: { title: { text: yCol, font: { size: fontSize } },
             color: _fc, gridcolor: "rgba(128,128,128,0.18)", zeroline: false },
    font:          { size: fontSize, color: _fc },
    plot_bgcolor:  _pb,
    paper_bgcolor: _ppb,
    showlegend:    true,
    legend:        { x: 1, xanchor: "right", y: 1, font: { size: fontSize - 1 } },
  };

  // eslint-disable-next-line no-undef
  Plotly.react(containerEl, [trainTrace, recTrace], layout, {
    responsive: true, displayModeBar: true, displaylogo: false,
    modeBarButtons: [["toImage"]],
    toImageButtonOptions: { filename: "design_space_scatter", scale: 2 },
  });
}

/**
 * Render a scatter plot of Model A predictions vs Model B predictions.
 *
 * @param {HTMLElement} containerEl
 * @param {number[]}    yA          - Model A predictions
 * @param {number[]}    yB          - Model B predictions
 * @param {string}      outputCol
 * @param {string}      labelA
 * @param {string}      labelB
 * @param {object}      [options]
 */
export function renderComparisonScatter(containerEl, yA, yB, outputCol, labelA, labelB, options = {}) {
  const { fontSize = 12, fontColor = null, plotBgColor = null, paperBgColor = null } = options;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const _fc  = fontColor    ?? (isDark ? "#8b94b3" : "#4b5478");
  const _pb  = plotBgColor  ?? "rgba(0,0,0,0)";
  const _ppb = paperBgColor ?? "rgba(0,0,0,0)";

  const allVals = [...yA, ...yB];
  const vMin    = Math.min(...allVals);
  const vMax    = Math.max(...allVals);
  const pad     = (vMax - vMin) * 0.05 || 0.1;

  const scatterTrace = {
    type: "scatter", mode: "markers", name: "Samples",
    x: yA, y: yB,
    marker: { color: "rgba(99,102,241,0.65)", size: 6,
              line: { width: 0.5, color: "rgba(99,102,241,0.9)" } },
    hovertemplate: `${labelA}: %{x:.4g}<br>${labelB}: %{y:.4g}<extra></extra>`,
  };

  const diagTrace = {
    type: "scatter", mode: "lines", name: "1:1 line",
    x: [vMin - pad, vMax + pad], y: [vMin - pad, vMax + pad],
    line: { dash: "dash", color: "rgba(128,128,128,0.55)", width: 1.5 },
    showlegend: true,
    hoverinfo: "skip",
  };

  const layout = {
    height: 320,
    margin: { t: 30, b: 55, l: 65, r: 16 },
    title:  { text: outputCol, font: { size: fontSize + 1, color: _fc }, x: 0.05 },
    xaxis:  { title: { text: labelA, font: { size: fontSize } }, color: _fc,
              gridcolor: "rgba(128,128,128,0.18)", zeroline: false,
              range: [vMin - pad, vMax + pad] },
    yaxis:  { title: { text: labelB, font: { size: fontSize } }, color: _fc,
              gridcolor: "rgba(128,128,128,0.18)", zeroline: false,
              range: [vMin - pad, vMax + pad] },
    font:          { size: fontSize, color: _fc },
    plot_bgcolor:  _pb,
    paper_bgcolor: _ppb,
    showlegend:    true,
    legend:        { x: 1, xanchor: "right", y: 0, font: { size: fontSize - 1 } },
  };

  // eslint-disable-next-line no-undef
  Plotly.react(containerEl, [scatterTrace, diagTrace], layout, {
    responsive: true, displayModeBar: true, displaylogo: false,
    modeBarButtons: [["toImage"]],
    toImageButtonOptions: { filename: `comparison_scatter_${outputCol}`, scale: 2 },
  });
}

/**
 * Render a histogram of Δ = B − A (bias distribution) for one output.
 *
 * @param {HTMLElement} containerEl
 * @param {number[]}    delta       - Array of (B - A) values
 * @param {string}      outputCol
 * @param {object}      [options]
 */
export function renderBiasHistogram(containerEl, delta, outputCol, options = {}) {
  const { fontSize = 12, fontColor = null, plotBgColor = null, paperBgColor = null } = options;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const _fc  = fontColor    ?? (isDark ? "#8b94b3" : "#4b5478");
  const _pb  = plotBgColor  ?? "rgba(0,0,0,0)";
  const _ppb = paperBgColor ?? "rgba(0,0,0,0)";

  const meanDelta = delta.reduce((a, b) => a + b, 0) / delta.length;

  const histTrace = {
    type: "histogram", x: delta, name: "Δ = B − A",
    nbinsx: 30,
    marker: { color: "rgba(99,102,241,0.75)", line: { width: 0.5, color: "rgba(99,102,241,1)" } },
    hovertemplate: "Δ: %{x:.4g}<br>Count: %{y}<extra></extra>",
  };

  const meanLine = {
    type: "scatter", mode: "lines", name: `Mean Δ = ${meanDelta.toFixed(4)}`,
    x: [meanDelta, meanDelta], y: [0, delta.length / 3],
    line: { dash: "dot", color: "rgba(239,68,68,0.85)", width: 2 },
    showlegend: true,
    hoverinfo: "skip",
  };

  const layout = {
    height: 260,
    margin: { t: 30, b: 50, l: 55, r: 16 },
    title:  { text: `Bias: ${outputCol}`, font: { size: fontSize + 1, color: _fc }, x: 0.05 },
    xaxis:  { title: { text: "Δ (B − A)", font: { size: fontSize } }, color: _fc,
              gridcolor: "rgba(128,128,128,0.18)", zeroline: true,
              zerolinecolor: "rgba(128,128,128,0.4)", zerolinewidth: 1 },
    yaxis:  { title: { text: "Count", font: { size: fontSize } }, color: _fc,
              gridcolor: "rgba(128,128,128,0.18)" },
    font:          { size: fontSize, color: _fc },
    plot_bgcolor:  _pb,
    paper_bgcolor: _ppb,
    showlegend:    true,
    legend:        { x: 1, xanchor: "right", y: 1, font: { size: fontSize - 1 } },
    barmode:       "overlay",
  };

  // eslint-disable-next-line no-undef
  Plotly.react(containerEl, [histTrace, meanLine], layout, {
    responsive: true, displayModeBar: true, displaylogo: false,
    modeBarButtons: [["toImage"]],
    toImageButtonOptions: { filename: `bias_histogram_${outputCol}`, scale: 2 },
  });
}

/**
 * Render a model comparison table (no Plotly — pure DOM table).
 *
 * Shows one row per model type with training time and per-output R², RMSE, MAE.
 * The best R² value for each output column is highlighted in green.
 * Failed model runs are shown with an error note instead of metrics.
 *
 * @param {HTMLElement} containerEl - Target element (cleared before render).
 * @param {object}      compResp    - Response from POST /api/model/compare:
 *   { comparison: [...], output_columns: [...], n_train: int, n_test: int }
 */
/**
 * Render a horizontal bar chart of ensemble component weights.
 *
 * Shows one bar per component sorted by weight descending. Failed/excluded
 * components are shown as gray zero-weight bars with an "excluded" label.
 *
 * @param {HTMLElement} containerEl   - Target element (cleared before render).
 * @param {string[]}    components    - Component model types included (ordered).
 * @param {object}      weights       - {model_type: float} — weights summing to 1.
 * @param {object}      cvR2          - {model_type: float} — CV R² per component.
 * @param {object[]}    failed        - [{model_type, error}, ...] excluded components.
 * @param {object}      [options]
 */
export function renderEnsembleWeights(containerEl, components, weights, cvR2, failed, options = {}) {
  const { fontSize = 12, fontColor = null, plotBgColor = null, paperBgColor = null } = options;
  const theme = _getThemeColors();
  const _fc   = fontColor    ?? theme.font;
  const _pb   = plotBgColor  ?? "rgba(0,0,0,0)";
  const _ppb  = paperBgColor ?? "rgba(0,0,0,0)";

  const MODEL_LABELS = {
    gpr: "GPR", kriging: "Kriging", rf: "Random Forest",
    rbf: "RBF", pce: "PCE", linear: "Linear",
  };

  // Build sorted bars (included components, descending weight)
  const included = [...components].sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));
  const excluded = (failed || []).map(f => f.model_type);

  const allTypes  = [...included, ...excluded];
  const allNames  = allTypes.map(mt => MODEL_LABELS[mt] || mt);
  const allWeights = allTypes.map(mt => weights[mt] ?? 0);
  const allCvR2   = allTypes.map(mt => cvR2[mt] ?? 0);
  const colors    = allTypes.map((mt, i) =>
    i < included.length ? "rgba(99,102,241,0.80)" : "rgba(160,160,160,0.40)"
  );
  const customdata = allTypes.map((mt, i) => ({
    cv_r2:    allCvR2[i].toFixed(3),
    excluded: i >= included.length,
  }));

  const trace = {
    type:        "bar",
    orientation: "h",
    x: allWeights,
    y: allNames,
    marker: { color: colors },
    customdata,
    hovertemplate: "<b>%{y}</b><br>Weight: %{x:.3f}<br>CV R²: %{customdata.cv_r2}<extra></extra>",
  };

  const height = Math.max(200, allTypes.length * 40 + 80);
  const layout = {
    height,
    margin:  { t: 16, b: 50, l: 120, r: 20 },
    xaxis:   { title: "Weight", range: [0, Math.max(...allWeights) + 0.05],
               color: _fc, tickfont: { size: fontSize - 1 },
               gridcolor: "rgba(128,128,128,0.18)" },
    yaxis:   { color: _fc, tickfont: { size: fontSize - 1 }, automargin: true },
    font:    { size: fontSize, color: _fc },
    plot_bgcolor:  _pb,
    paper_bgcolor: _ppb,
    showlegend: false,
  };

  // eslint-disable-next-line no-undef
  Plotly.react(containerEl, [trace], layout, {
    responsive: true, displayModeBar: true, displaylogo: false,
    modeBarButtons: [["toImage"]],
    toImageButtonOptions: { filename: "ensemble_weights", scale: 2 },
  });
}

export function renderModelComparisonTable(containerEl, compResp) {
  containerEl.innerHTML = "";

  const { comparison, output_columns: outputCols, n_train, n_test } = compResp;
  if (!comparison || comparison.length === 0) return;

  const MODEL_LABELS = {
    gpr:     "GPR",
    kriging: "Kriging",
    rf:      "Random Forest",
    rbf:     "RBF",
    pce:     "PCE",
    linear:  "Linear",
  };

  // Find best R² per output column (among successful runs)
  const bestR2 = {};
  for (const col of outputCols) {
    let best = -Infinity;
    for (const entry of comparison) {
      if (!entry.success) continue;
      const m = (entry.metrics || []).find((x) => x.column === col);
      if (m && m.r2 > best) best = m.r2;
    }
    bestR2[col] = best;
  }

  // Summary line
  const summary = document.createElement("p");
  summary.className = "section-desc";
  summary.textContent = `${comparison.length} models trained — ${n_train.toLocaleString()} train / ${n_test.toLocaleString()} test rows. Best R² per output highlighted.`;
  containerEl.appendChild(summary);

  // Table
  const wrap = document.createElement("div");
  wrap.className = "sensitivity-table-wrap";
  wrap.style.overflowX = "auto";

  const table = document.createElement("table");
  table.className = "results-table model-cmp-table";

  // Header
  const thead = document.createElement("thead");
  const hRow = document.createElement("tr");
  const headers = ["Model", "Time (s)"];
  for (const col of outputCols) {
    headers.push(`${col} R²`, `${col} RMSE`);
  }
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    hRow.appendChild(th);
  }
  thead.appendChild(hRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement("tbody");
  for (const entry of comparison) {
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.textContent = MODEL_LABELS[entry.model_type] || entry.model_type;
    tr.appendChild(tdName);

    if (!entry.success) {
      const tdTime = document.createElement("td");
      tdTime.textContent = "—";
      tr.appendChild(tdTime);
      const tdErr = document.createElement("td");
      tdErr.colSpan = outputCols.length * 2;
      tdErr.className = "metric-secondary";
      tdErr.textContent = entry.error || "Failed";
      tr.appendChild(tdErr);
    } else {
      const tdTime = document.createElement("td");
      tdTime.textContent = entry.train_time_s.toFixed(2);
      tr.appendChild(tdTime);

      for (const col of outputCols) {
        const m = (entry.metrics || []).find((x) => x.column === col);
        const r2   = m ? m.r2   : null;
        const rmse = m ? m.rmse : null;

        const tdR2 = document.createElement("td");
        if (r2 !== null) {
          tdR2.textContent = r2.toFixed(3);
          if (Math.abs(r2 - bestR2[col]) < 1e-9) {
            tdR2.style.color = "var(--color-success, #16a34a)";
            tdR2.style.fontWeight = "600";
          }
        } else {
          tdR2.textContent = "—";
        }
        tr.appendChild(tdR2);

        const tdRmse = document.createElement("td");
        tdRmse.className = "metric-secondary";
        tdRmse.textContent = rmse !== null ? rmse.toExponential(3) : "—";
        tr.appendChild(tdRmse);
      }
    }

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  containerEl.appendChild(wrap);
}

/**
 * Bar chart (per-component explained variance) + cumulative line.
 * Used by the PCA preview in Step 7 — Filter Inputs.
 *
 * @param {HTMLElement} containerEl
 * @param {number[]}    explainedRatio    - per-component explained variance ratios (0–1)
 * @param {number[]}    cumulativeVariance - cumulative explained variance (0–1)
 * @param {number}      nComponents       - number of components (for x-axis labelling)
 */
export function renderExplainedVarianceChart(containerEl, explainedRatio, cumulativeVariance, nComponents) {
  const isDark  = document.documentElement.getAttribute("data-theme") === "dark";
  const fontClr = isDark ? "#8b94b3" : "#4b5478";
  const plotBg  = isDark ? "#1e2130" : "#ffffff";

  const labels = explainedRatio.map((_, i) => `PC${i + 1}`);
  const pctArr = explainedRatio.map(v => v * 100);
  const cumArr = cumulativeVariance.map(v => v * 100);

  const traces = [
    {
      type: "bar", name: "Per-component",
      x: labels, y: pctArr,
      marker: { color: "rgba(99,102,241,0.8)" },
    },
    {
      type: "scatter", mode: "lines+markers", name: "Cumulative",
      x: labels, y: cumArr,
      line:   { color: "rgba(245,158,11,0.9)", width: 2 },
      marker: { size: 6 },
    },
    {
      type: "scatter", mode: "lines", name: "90% threshold",
      x: [labels[0], labels[labels.length - 1]], y: [90, 90],
      line: { dash: "dot", color: "rgba(128,128,128,0.45)", width: 1.5 },
    },
  ];

  const layout = {
    height: 250,
    margin: { t: 12, b: 44, l: 52, r: 16 },
    xaxis: {
      title: "Component", color: fontClr,
      tickfont: { size: 11 }, gridcolor: "rgba(128,128,128,0.15)",
    },
    yaxis: {
      title: "Variance (%)", range: [0, 106],
      color: fontClr, tickfont: { size: 11 }, gridcolor: "rgba(128,128,128,0.15)",
    },
    font:          { size: 12, color: fontClr },
    plot_bgcolor:  plotBg,
    paper_bgcolor: plotBg,
    showlegend:    true,
    legend:        { x: 1, xanchor: "right", y: 1, font: { size: 11 } },
    bargap:        0.3,
  };

  Plotly.react(containerEl, traces, layout, {
    responsive: true, displayModeBar: false,
  });
}

// ── Design Space Explorer charts ──────────────────────────────────────────────

/**
 * Render the scatter explorer plot.
 *
 * @param {HTMLElement} containerEl
 * @param {Object}      data         - API response from GET /api/model/explore/scatter.
 * @param {Object}      opts
 * @param {string}      opts.xCol        - Input column for x-axis.
 * @param {string}      opts.yCol        - Output column for y-axis.
 * @param {string}      opts.colorKey    - Column key for color (e.g. "y1__residual" or "x2").
 * @param {string}      opts.colorscale  - Plotly colorscale name (default "Viridis").
 * @param {Object}      opts.filterRanges - {col: [min, max]} — client-side row filter.
 */
export function renderScatterExplorer(containerEl, data, opts = {}) {
  const {
    xCol, yCol, colorKey, colorscale = "Viridis", filterRanges = {},
    fontSize = 11, tickFontSize = 9, fontColor = null,
    markerSize = 7, opacity = 0.75, edgeWidth = 0, edgeColor = "#000000",
    height = 360, plotBgColor = null, paperBgColor = null,
    showMajorGrid = true, majorGridColor = "#cccccc", majorGridOpacity = 1.0,
    showMinorGrid = false, minorGridColor = "#e0e0e0", minorGridOpacity = 0.6,
  } = opts;
  const isDark   = document.documentElement.getAttribute("data-theme") === "dark";
  const fontClr  = fontColor !== null ? fontColor : (isDark ? "#8b94b3" : "#4b5478");
  const plotBg   = plotBgColor  !== null ? plotBgColor  : "rgba(0,0,0,0)";
  const paperBg  = paperBgColor !== null ? paperBgColor : "rgba(0,0,0,0)";

  // Filter rows by active input ranges (all inputs except the x-axis column)
  const filtered = data.rows.filter(row =>
    data.input_columns.every(col => {
      if (col === xCol) return true;
      const range = filterRanges[col];
      if (!range) return true;
      return row[col] >= range[0] && row[col] <= range[1];
    })
  );

  const xVals = filtered.map(r => r[xCol]);

  // Dual trace (actual + predicted) only when yCol is a raw output column.
  // For residual/derived Y columns (e.g. y1__residual), show a single trace.
  const hasDualTrace = filtered.length > 0 && (`${yCol}__actual` in filtered[0]);
  const yLabel = yCol.replace(/__residual$/, " residual").replace(/__actual$/, " actual").replace(/__predicted$/, " predicted");

  const rawColorKey = colorKey || (hasDualTrace ? `${yCol}__residual` : yCol);
  const colorVals = filtered.map(r => r[rawColorKey] ?? 0);
  const cLabel    = rawColorKey.replace(/__/g, " ").replace(/predicted/, "pred").replace(/residual/, "resid");

  const cMin = Math.min(...colorVals);
  const cMax = Math.max(...colorVals);

  const gridClr = showMajorGrid ? _hexToRgba(majorGridColor, majorGridOpacity) : "rgba(0,0,0,0)";
  const cs = _COLORSCALES[colorscale] ?? colorscale;

  const markerBase = {
    color: colorVals, colorscale: cs, autocolorscale: false, cmin: cMin, cmax: cMax,
    colorbar: { title: { text: cLabel, side: "right" }, thickness: 14, len: 0.75, tickfont: { size: tickFontSize } },
  };

  const axisBase = {
    showgrid: showMajorGrid, gridcolor: gridClr, automargin: true,
    tickfont: { size: tickFontSize }, zerolinecolor: gridClr,
    ...(showMinorGrid ? { minor: { showgrid: true, gridcolor: _hexToRgba(minorGridColor, minorGridOpacity) } } : {}),
  };

  let traces;
  if (hasDualTrace) {
    const actualEdge = edgeWidth > 0 ? { width: edgeWidth, color: edgeColor } : {};
    traces = [
      {
        type: "scatter", mode: "markers", name: "Actual",
        x: xVals, y: filtered.map(r => r[`${yCol}__actual`]),
        marker: { ...markerBase, symbol: "circle", size: markerSize, showscale: false, opacity,
          ...(edgeWidth > 0 ? { line: actualEdge } : {}) },
      },
      {
        type: "scatter", mode: "markers", name: "Predicted",
        x: xVals, y: filtered.map(r => r[`${yCol}__predicted`]),
        marker: { ...markerBase, symbol: "cross", size: markerSize + 2, line: { width: 2, color: "rgba(0,0,0,0.3)" }, showscale: true, opacity },
      },
    ];
  } else {
    const singleEdge = edgeWidth > 0 ? { line: { width: edgeWidth, color: edgeColor } } : {};
    traces = [
      {
        type: "scatter", mode: "markers", name: yLabel,
        x: xVals, y: filtered.map(r => r[yCol] ?? 0),
        marker: { ...markerBase, symbol: "circle", size: markerSize, showscale: true, opacity, ...singleEdge },
      },
    ];
  }

  // eslint-disable-next-line no-undef
  Plotly.react(containerEl, traces, {
    paper_bgcolor: paperBg, plot_bgcolor: plotBg,
    height, margin: { t: 24, b: 48, l: 56, r: 80 },
    font: { color: fontClr, family: "Inter, system-ui, sans-serif", size: fontSize },
    xaxis: { ...axisBase, title: { text: xCol,   font: { size: fontSize } } },
    yaxis: { ...axisBase, title: { text: yLabel, font: { size: fontSize } } },
    showlegend: hasDualTrace,
    legend: { orientation: "h", x: 0, y: 1.08, font: { size: Math.max(9, fontSize - 1) } },
  }, {
    responsive: true, displayModeBar: true, displaylogo: false,
    modeBarButtons: [["toImage", "zoom2d", "pan2d", "resetScale2d"]],
    toImageButtonOptions: { filename: `scatter_${xCol}_vs_${yCol}`, scale: 2 },
  });
}

/**
 * Render the 2D contour explorer plot.
 *
 * @param {HTMLElement} containerEl
 * @param {Object}      result - Response from POST /api/model/explore/contour.
 * @param {Object|string} opts - Settings object (or colorscale string for backward compat).
 */
export function renderContourExplorer(containerEl, result, opts = {}) {
  const o = typeof opts === "string" ? { colorscale: opts } : opts;
  const {
    colorscale = "Plasma",
    fontSize = 11, tickFontSize = 9, fontColor = null,
    height = 420, plotBgColor = null, paperBgColor = null,
    showMajorGrid = true, majorGridColor = "#cccccc", majorGridOpacity = 1.0,
    showMinorGrid = false, minorGridColor = "#e0e0e0", minorGridOpacity = 0.6,
  } = o;
  const isDark  = document.documentElement.getAttribute("data-theme") === "dark";
  const fontClr = fontColor !== null ? fontColor : (isDark ? "#8b94b3" : "#4b5478");
  const plotBg  = plotBgColor  !== null ? plotBgColor  : "rgba(0,0,0,0)";
  const paperBg = paperBgColor !== null ? paperBgColor : "rgba(0,0,0,0)";
  const gridClr = showMajorGrid ? _hexToRgba(majorGridColor, majorGridOpacity) : "rgba(0,0,0,0)";

  const cs = _COLORSCALES[colorscale] ?? colorscale;
  const coLabel = (result.output_col || "").replace(/__/g, " ").replace(/residual/, "resid");

  const trace = {
    type: "contour",
    x: result.x_vals,
    y: result.y_vals,
    z: result.z_grid,
    colorscale: cs, autocolorscale: false,
    colorbar: {
      title:     { text: coLabel, side: "right" },
      thickness: 14, len: 0.75, tickfont: { size: tickFontSize },
    },
    contours:  { coloring: "heatmap", showlabels: true, labelfont: { size: tickFontSize, color: "white" } },
    line:      { smoothing: 1.2 },
    hovertemplate: `${result.x_col}: %{x:.3f}<br>${result.y_col}: %{y:.3f}<br>${coLabel}: %{z:.4f}<extra></extra>`,
  };

  const axisBase = {
    showgrid: showMajorGrid, gridcolor: gridClr, automargin: true, tickfont: { size: tickFontSize },
    ...(showMinorGrid ? { minor: { showgrid: true, gridcolor: _hexToRgba(minorGridColor, minorGridOpacity) } } : {}),
  };

  // eslint-disable-next-line no-undef
  Plotly.react(containerEl, [trace], {
    paper_bgcolor: paperBg, plot_bgcolor: plotBg,
    height, margin: { t: 24, b: 48, l: 56, r: 80 },
    font: { color: fontClr, family: "Inter, system-ui, sans-serif", size: fontSize },
    xaxis: { ...axisBase, title: { text: result.x_col, font: { size: fontSize } } },
    yaxis: { ...axisBase, title: { text: result.y_col, font: { size: fontSize } } },
  }, {
    responsive: true, displayModeBar: true, displaylogo: false,
    modeBarButtons: [["toImage", "zoom2d", "pan2d", "resetScale2d"]],
    toImageButtonOptions: { filename: `contour_${result.x_col}_${result.y_col}_${result.output_col}`, scale: 2 },
  });
}
