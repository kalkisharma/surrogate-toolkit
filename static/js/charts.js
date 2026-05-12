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
 * @param {boolean}     [options.showAxisLines=false]
 * @param {string}      [options.axisLineColor="#888888"]
 * @param {string|null} [options.plotBgColor=null]      - null = transparent.
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
    showAxisLines    = false,
    axisLineColor    = "#888888",
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
      showline:  showAxisLines,
      linecolor: axisLineColor,
      mirror:    showAxisLines ? "ticks" : false,
      ...(showMinorGrid ? { minor: { showgrid: true, gridcolor: _hexToRgba(minorGridColor, minorGridOpacity) } } : {}),
    };
    axisLayout[xk] = axisOpts;
    axisLayout[yk] = { ...axisOpts };
  }

  const layout = {
    paper_bgcolor: paperBgColor || "rgba(0,0,0,0)",
    plot_bgcolor:  plotBgColor  || "rgba(0,0,0,0)",
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
