// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/data_subset.js
// Version: 1.2.0
// Description: Step 5 — Subset. Per-column range filters that permanently
//              slice the clean DataFrame via POST /api/data/subset. Excluded
//              points are shown dimmed in a sticky live 2D scatter preview.
//              Settings panel mirrors the Explore 2D scatter controls exactly.
// =============================================================================

import { renderDataScatter2D } from "../charts.js";
import { get, post } from "../api.js";
import { showSuccess, showError, showWarning } from "../notifications.js";
import { showSpinner, hideSpinner } from "../loading.js";
import { el, clearEl } from "../utils.js";

const _S2D_KEY = "surrogate_subset_scatter_settings";
const _S2D_DEFAULTS = {
  title:             "",
  titlePosition:     "center",
  plotTitleFontSize: 14,
  axisTitleFontSize: 12,
  legendPosition:    "top right",
  legendFontSize:    10,
  legendBgColor:     null,
  legendBorderColor: "#cccccc",
  legendBorderWidth: 0,
  fontSize:          11,
  tickFontSize:       9,
  fontColor:         null,
  markerSize:         6,
  markerColor:       "#3b5dd9",
  edgeColor:         "#000000",
  edgeWidth:          0,
  includedOpacity:   0.75,
  excludedOpacity:   0.12,
  height:            380,
  plotBgColor:       null,
  paperBgColor:      null,
  plotBorderWidth:    0,
  plotBorderColor:   "#cccccc",
  showMajorGrid:     true,
  majorGridColor:    "#cccccc",
  majorGridOpacity:  1.0,
  showMinorGrid:     false,
  minorGridColor:    "#e0e0e0",
  minorGridOpacity:  0.6,
};

function _loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(_S2D_KEY) || "{}");
    return { ..._S2D_DEFAULTS, ...s };
  } catch { return { ..._S2D_DEFAULTS }; }
}
function _saveSettings(s) {
  try { localStorage.setItem(_S2D_KEY, JSON.stringify(s)); } catch {}
}

export async function initSubset(containerEl) {
  clearEl(containerEl);

  // ── Fetch current clean data ───────────────────────────────────────────────
  const [summaryResp, rowsResp] = await Promise.all([
    get("/api/data/summary"),
    get("/api/data/rows"),
  ]);

  if (!summaryResp.success || !rowsResp.success) {
    showError("Failed to load dataset for Subset step.");
    return;
  }

  const stats     = summaryResp.stats   || {};
  const allCols   = summaryResp.columns || [];
  const rows      = rowsResp.rows       || [];
  const totalRows = summaryResp.n_rows;

  const numericCols = allCols.filter(col => {
    const s = stats[col];
    return s && s.min != null && s.max != null && s.min !== s.max;
  });

  const colMins = {}, colMaxs = {}, colStep = {}, colDec = {};
  for (const col of numericCols) {
    colMins[col] = stats[col].min;
    colMaxs[col] = stats[col].max;
    const range  = colMaxs[col] - colMins[col];
    colStep[col] = range / 500 || 0.0001;
    const s      = colStep[col];
    colDec[col]  = s < 0.01 ? 4 : s < 0.1 ? 3 : s < 1 ? 2 : 1;
  }

  const filterRanges = {};
  for (const col of numericCols) filterRanges[col] = [colMins[col], colMaxs[col]];

  let s2d = _loadSettings();

  // ── Card ───────────────────────────────────────────────────────────────────
  const card = el("div", { cls: "card" });

  const titleRow   = el("div", { cls: "subset-title-row" });
  const titleEl    = el("h3", { cls: "section-title", text: "Step 5 — Subset" });
  const rowCountEl = el("span", { cls: "subset-row-count" });
  rowCountEl.textContent = `${totalRows.toLocaleString()} rows`;
  titleRow.appendChild(titleEl);
  titleRow.appendChild(rowCountEl);
  card.appendChild(titleRow);

  const descEl = el("p", { cls: "section-desc" });
  descEl.textContent =
    "Set per-column value ranges to keep only the rows you want. "
    + "All conditions apply simultaneously (AND logic). "
    + "Click Commit to permanently apply the subset to the dataset.";
  card.appendChild(descEl);
  containerEl.appendChild(card);

  // ── Main two-column grid ───────────────────────────────────────────────────
  const hasChart = numericCols.length >= 2;
  const mainGrid = el("div", { cls: hasChart ? "subset-main-grid" : "subset-main-grid subset-main-grid--single" });
  card.appendChild(mainGrid);

  // Left column: filter section (always) + settings panel (only if chart)
  const leftCol = el("div", { cls: "subset-left-col" });
  mainGrid.appendChild(leftCol);

  // ── Filter section ─────────────────────────────────────────────────────────
  const filterSection = el("div", { cls: "subset-filter-section" });

  const filterHeader = el("div", { cls: "subset-filter-header" });
  const filterTitle  = el("span", { cls: "subset-filter-title", text: "Range Filters" });
  const previewCount = el("span", { cls: "subset-preview-count" });
  previewCount.textContent = `Would keep: ${totalRows.toLocaleString()} / ${totalRows.toLocaleString()} rows`;
  const resetAllBtn  = el("button", { cls: "btn btn--ghost btn--sm", type: "button", text: "Reset All" });
  filterHeader.appendChild(filterTitle);
  filterHeader.appendChild(previewCount);
  filterHeader.appendChild(resetAllBtn);
  filterSection.appendChild(filterHeader);

  const filterList = el("div", { cls: "subset-filter-list" });
  filterSection.appendChild(filterList);
  leftCol.appendChild(filterSection);

  // ── Right column + settings (only when chart is possible) ─────────────────
  let chartEl = null;
  let xCol = numericCols[0] || null;
  let yCol = numericCols[1] || numericCols[0] || null;
  let settingsPanel = null;

  if (hasChart) {
    // Settings panel — exact chart-settings-panel format matching Explore 2D scatter
    const fontColorAuto   = s2d.fontColor        === null;
    const fontColorVal    = s2d.fontColor         || "#4b5478";
    const plotBgAuto      = s2d.plotBgColor       === null;
    const plotBgVal       = s2d.plotBgColor       || "#ffffff";
    const paperBgAuto     = s2d.paperBgColor      === null;
    const paperBgVal      = s2d.paperBgColor      || "#f5f6fa";
    const legendBgAuto    = s2d.legendBgColor      === null;
    const legendBgVal     = s2d.legendBgColor      || "#ffffff";
    const edgeOff         = s2d.edgeWidth         === 0;
    const plotBorderOff   = s2d.plotBorderWidth   === 0;
    const legendBorderOff = s2d.legendBorderWidth === 0;

    settingsPanel = document.createElement("details");
    settingsPanel.className = "chart-settings-panel";

    settingsPanel.innerHTML = `
      <summary class="chart-settings-panel__summary">Plot Settings</summary>
      <div class="chart-settings-controls subset-settings-scroll">

        <div class="settings-divider">Title</div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-title">Title text</label>
          <input id="ss-title" type="text" class="chart-settings-input" style="flex:1;min-width:0"
                 placeholder="(none)" value="${s2d.title || ""}">
        </div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-title-pos">Title position</label>
          <select id="ss-title-pos" class="chart-settings-select">
            <option value="left"   ${s2d.titlePosition === "left"   ? "selected" : ""}>Left</option>
            <option value="center" ${s2d.titlePosition === "center" ? "selected" : ""}>Center</option>
            <option value="right"  ${s2d.titlePosition === "right"  ? "selected" : ""}>Right</option>
          </select>
        </div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-plot-title-font">Title font (px)</label>
          <input id="ss-plot-title-font" type="number" class="chart-settings-input" min="8" max="36" step="1" value="${s2d.plotTitleFontSize}">
        </div>

        <div class="settings-divider">Typography</div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-font-size">General font (px)</label>
          <input id="ss-font-size" type="number" class="chart-settings-input" min="8" max="36" step="1" value="${s2d.fontSize}">
        </div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-tick-font">Tick font (px)</label>
          <input id="ss-tick-font" type="number" class="chart-settings-input" min="6" max="28" step="1" value="${s2d.tickFontSize}">
        </div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-axis-title-font">Axis label font (px)</label>
          <input id="ss-axis-title-font" type="number" class="chart-settings-input" min="8" max="36" step="1" value="${s2d.axisTitleFontSize}">
        </div>
        <div class="chart-settings-group">
          <span class="chart-settings-group__label">Font color</span>
          <div class="color-with-auto">
            <input id="ss-font-color" type="color" class="chart-settings-color"
                   value="${fontColorVal}" ${fontColorAuto ? "disabled" : ""} style="opacity:${fontColorAuto ? "0.4" : "1"}">
            <label class="chart-settings-check">
              <input type="checkbox" id="ss-font-color-auto" ${fontColorAuto ? "checked" : ""}> Auto
            </label>
          </div>
        </div>

        <div class="settings-divider">Markers</div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-marker-size">Marker size</label>
          <input id="ss-marker-size" type="number" class="chart-settings-input" min="3" max="30" step="1" value="${s2d.markerSize}">
        </div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-marker-color">Marker color</label>
          <input id="ss-marker-color" type="color" class="chart-settings-color" value="${s2d.markerColor}">
        </div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-edge-width">Edge width</label>
          <input id="ss-edge-width" type="number" class="chart-settings-input" min="0" max="3" step="0.5" value="${s2d.edgeWidth}">
        </div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-edge-color">Edge color</label>
          <input id="ss-edge-color" type="color" class="chart-settings-color"
                 value="${s2d.edgeColor}" ${edgeOff ? "disabled" : ""} style="opacity:${edgeOff ? "0.4" : "1"}">
        </div>
        <div class="chart-settings-group">
          <span class="chart-settings-group__label">Incl. opacity</span>
          <div class="range-with-value">
            <input id="ss-inc-opacity" type="range" class="chart-settings-range" min="0.1" max="1.0" step="0.05" value="${s2d.includedOpacity}">
            <span id="ss-inc-opacity-val" class="chart-settings-range-val">${s2d.includedOpacity.toFixed(2)}</span>
          </div>
        </div>
        <div class="chart-settings-group">
          <span class="chart-settings-group__label">Excl. opacity</span>
          <div class="range-with-value">
            <input id="ss-exc-opacity" type="range" class="chart-settings-range" min="0.02" max="0.5" step="0.02" value="${s2d.excludedOpacity}">
            <span id="ss-exc-opacity-val" class="chart-settings-range-val">${s2d.excludedOpacity.toFixed(2)}</span>
          </div>
        </div>

        <div class="settings-divider">Figure</div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-height">Height (px)</label>
          <input id="ss-height" type="number" class="chart-settings-input" min="200" max="900" step="50" value="${s2d.height}">
        </div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-plot-bg">Plot bg</label>
          <div class="color-with-auto">
            <input id="ss-plot-bg" type="color" class="chart-settings-color"
                   value="${plotBgVal}" ${plotBgAuto ? "disabled" : ""} style="opacity:${plotBgAuto ? "0.4" : "1"}">
            <label class="chart-settings-check">
              <input type="checkbox" id="ss-plot-bg-auto" ${plotBgAuto ? "checked" : ""}> Auto
            </label>
          </div>
        </div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-paper-bg">Paper bg</label>
          <div class="color-with-auto">
            <input id="ss-paper-bg" type="color" class="chart-settings-color"
                   value="${paperBgVal}" ${paperBgAuto ? "disabled" : ""} style="opacity:${paperBgAuto ? "0.4" : "1"}">
            <label class="chart-settings-check">
              <input type="checkbox" id="ss-paper-bg-auto" ${paperBgAuto ? "checked" : ""}> Auto
            </label>
          </div>
        </div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-plot-border-width">Plot border</label>
          <div class="color-with-auto">
            <input id="ss-plot-border-width" type="number" class="chart-settings-input"
                   min="0" max="4" step="1" value="${s2d.plotBorderWidth}" style="width:52px">
            <input id="ss-plot-border-color" type="color" class="chart-settings-color"
                   value="${s2d.plotBorderColor}" ${plotBorderOff ? "disabled" : ""} style="opacity:${plotBorderOff ? "0.4" : "1"}">
          </div>
        </div>

        <div class="settings-divider">Legend</div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-legend-pos">Position</label>
          <select id="ss-legend-pos" class="chart-settings-select">
            <option value="top right"    ${s2d.legendPosition === "top right"    ? "selected" : ""}>Top Right</option>
            <option value="top left"     ${s2d.legendPosition === "top left"     ? "selected" : ""}>Top Left</option>
            <option value="bottom right" ${s2d.legendPosition === "bottom right" ? "selected" : ""}>Bottom Right</option>
            <option value="bottom left"  ${s2d.legendPosition === "bottom left"  ? "selected" : ""}>Bottom Left</option>
            <option value="top center"   ${s2d.legendPosition === "top center"   ? "selected" : ""}>Top Center</option>
            <option value="hidden"       ${s2d.legendPosition === "hidden"       ? "selected" : ""}>Hidden</option>
          </select>
        </div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-legend-font">Legend font (px)</label>
          <input id="ss-legend-font" type="number" class="chart-settings-input" min="6" max="28" step="1" value="${s2d.legendFontSize}">
        </div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-legend-bg">Legend bg</label>
          <div class="color-with-auto">
            <input id="ss-legend-bg" type="color" class="chart-settings-color"
                   value="${legendBgVal}" ${legendBgAuto ? "disabled" : ""} style="opacity:${legendBgAuto ? "0.4" : "1"}">
            <label class="chart-settings-check">
              <input type="checkbox" id="ss-legend-bg-auto" ${legendBgAuto ? "checked" : ""}> Auto
            </label>
          </div>
        </div>
        <div class="chart-settings-group">
          <label class="chart-settings-group__label" for="ss-legend-border-width">Legend border</label>
          <div class="color-with-auto">
            <input id="ss-legend-border-width" type="number" class="chart-settings-input"
                   min="0" max="4" step="1" value="${s2d.legendBorderWidth}" style="width:52px">
            <input id="ss-legend-border-color" type="color" class="chart-settings-color"
                   value="${s2d.legendBorderColor}" ${legendBorderOff ? "disabled" : ""} style="opacity:${legendBorderOff ? "0.4" : "1"}">
          </div>
        </div>

        <div class="settings-divider">Gridlines</div>
        <div class="chart-settings-group">
          <span class="chart-settings-group__label">Major grid</span>
          <div class="color-with-auto">
            <label class="chart-settings-check">
              <input type="checkbox" id="ss-major-grid" ${s2d.showMajorGrid ? "checked" : ""}> On
            </label>
            <input id="ss-major-grid-color" type="color" class="chart-settings-color"
                   value="${s2d.majorGridColor}" ${!s2d.showMajorGrid ? "disabled" : ""} style="opacity:${s2d.showMajorGrid ? "1" : "0.4"}">
            <div class="range-with-value">
              <input id="ss-major-grid-opacity" type="range" class="chart-settings-range"
                     min="0.1" max="1.0" step="0.05" value="${s2d.majorGridOpacity}" ${!s2d.showMajorGrid ? "disabled" : ""}>
              <span id="ss-major-grid-opacity-val" class="chart-settings-range-val">${s2d.majorGridOpacity.toFixed(2)}</span>
            </div>
          </div>
        </div>
        <div class="chart-settings-group">
          <span class="chart-settings-group__label">Minor grid</span>
          <div class="color-with-auto">
            <label class="chart-settings-check">
              <input type="checkbox" id="ss-minor-grid" ${s2d.showMinorGrid ? "checked" : ""}> On
            </label>
            <input id="ss-minor-grid-color" type="color" class="chart-settings-color"
                   value="${s2d.minorGridColor}" ${!s2d.showMinorGrid ? "disabled" : ""} style="opacity:${s2d.showMinorGrid ? "1" : "0.4"}">
            <div class="range-with-value">
              <input id="ss-minor-grid-opacity" type="range" class="chart-settings-range"
                     min="0.1" max="1.0" step="0.05" value="${s2d.minorGridOpacity}" ${!s2d.showMinorGrid ? "disabled" : ""}>
              <span id="ss-minor-grid-opacity-val" class="chart-settings-range-val">${s2d.minorGridOpacity.toFixed(2)}</span>
            </div>
          </div>
        </div>

      </div>
    `;
    leftCol.appendChild(settingsPanel);

    // Right column: sticky preview header + chart
    const rightCol = el("div", { cls: "subset-right-col" });
    mainGrid.appendChild(rightCol);

    const previewHeader = el("div", { cls: "subset-preview-header" });
    const previewTitle  = el("span", { cls: "subset-filter-title", text: "Live Preview" });
    const axesRow = el("div", { cls: "subset-axes-row" });
    const xLabel  = el("label", { cls: "subset-axis-label", text: "X" });
    const xSel    = el("select", { cls: "explore-select subset-axis-sel" });
    const yLabel  = el("label", { cls: "subset-axis-label", text: "Y" });
    const ySel    = el("select", { cls: "explore-select subset-axis-sel" });
    for (const col of numericCols) {
      xSel.appendChild(new Option(col, col));
      ySel.appendChild(new Option(col, col));
    }
    if (numericCols[1]) ySel.value = numericCols[1];
    axesRow.appendChild(xLabel); axesRow.appendChild(xSel);
    axesRow.appendChild(yLabel); axesRow.appendChild(ySel);
    previewHeader.appendChild(previewTitle);
    previewHeader.appendChild(axesRow);
    rightCol.appendChild(previewHeader);

    chartEl = el("div", { cls: "subset-chart" });
    rightCol.appendChild(chartEl);

    xSel.addEventListener("change", () => { xCol = xSel.value; _drawPreview(); });
    ySel.addEventListener("change", () => { yCol = ySel.value; _drawPreview(); });

    // ── Settings wiring ──────────────────────────────────────────────────────
    function _getEl(id) { return settingsPanel.querySelector(`#${id}`); }
    function _num(id)   { return parseFloat(_getEl(id).value) || 0; }
    function _str(id)   { return _getEl(id).value; }
    function _chk(id)   { return _getEl(id).checked; }

    function _applySettings() {
      const fontAuto      = _chk("ss-font-color-auto");
      const plotBgAutoC   = _chk("ss-plot-bg-auto");
      const paperBgAutoC  = _chk("ss-paper-bg-auto");
      const legendBgAutoC = _chk("ss-legend-bg-auto");
      const plotBorderW   = _num("ss-plot-border-width");
      const legendBorderW = _num("ss-legend-border-width");
      s2d = {
        title:             _str("ss-title"),
        titlePosition:     _str("ss-title-pos"),
        plotTitleFontSize: _num("ss-plot-title-font"),
        axisTitleFontSize: _num("ss-axis-title-font"),
        legendPosition:    _str("ss-legend-pos"),
        legendFontSize:    _num("ss-legend-font"),
        legendBgColor:     legendBgAutoC   ? null : _str("ss-legend-bg"),
        legendBorderWidth: legendBorderW,
        legendBorderColor: _str("ss-legend-border-color"),
        fontSize:          _num("ss-font-size"),
        tickFontSize:      _num("ss-tick-font"),
        fontColor:         fontAuto        ? null : _str("ss-font-color"),
        markerSize:        _num("ss-marker-size"),
        markerColor:       _str("ss-marker-color"),
        edgeWidth:         _num("ss-edge-width"),
        edgeColor:         _str("ss-edge-color"),
        includedOpacity:   parseFloat(_str("ss-inc-opacity")),
        excludedOpacity:   parseFloat(_str("ss-exc-opacity")),
        height:            _num("ss-height"),
        plotBgColor:       plotBgAutoC     ? null : _str("ss-plot-bg"),
        paperBgColor:      paperBgAutoC    ? null : _str("ss-paper-bg"),
        plotBorderWidth:   plotBorderW,
        plotBorderColor:   _str("ss-plot-border-color"),
        showMajorGrid:     _chk("ss-major-grid"),
        majorGridColor:    _str("ss-major-grid-color"),
        majorGridOpacity:  parseFloat(_str("ss-major-grid-opacity")),
        showMinorGrid:     _chk("ss-minor-grid"),
        minorGridColor:    _str("ss-minor-grid-color"),
        minorGridOpacity:  parseFloat(_str("ss-minor-grid-opacity")),
      };
      _saveSettings(s2d);
      _drawPreview();
    }

    function _wireRange(id, valId) {
      const input = _getEl(id), span = _getEl(valId);
      if (!input || !span) return;
      input.addEventListener("input", () => {
        span.textContent = parseFloat(input.value).toFixed(2);
        _applySettings();
      });
    }
    _wireRange("ss-inc-opacity",        "ss-inc-opacity-val");
    _wireRange("ss-exc-opacity",        "ss-exc-opacity-val");
    _wireRange("ss-major-grid-opacity", "ss-major-grid-opacity-val");
    _wireRange("ss-minor-grid-opacity", "ss-minor-grid-opacity-val");

    function _wireAutoToggle(chkId, colorId) {
      const chk = _getEl(chkId), color = _getEl(colorId);
      if (!chk || !color) return;
      chk.addEventListener("change", () => {
        color.disabled = chk.checked;
        color.style.opacity = chk.checked ? "0.4" : "1";
        _applySettings();
      });
    }
    _wireAutoToggle("ss-font-color-auto",  "ss-font-color");
    _wireAutoToggle("ss-plot-bg-auto",     "ss-plot-bg");
    _wireAutoToggle("ss-paper-bg-auto",    "ss-paper-bg");
    _wireAutoToggle("ss-legend-bg-auto",   "ss-legend-bg");

    function _wireGridToggle(chkId, colorId, opacityId) {
      const chk = _getEl(chkId), color = _getEl(colorId), op = _getEl(opacityId);
      if (!chk) return;
      chk.addEventListener("change", () => {
        if (color) { color.disabled = !chk.checked; color.style.opacity = chk.checked ? "1" : "0.4"; }
        if (op)    { op.disabled = !chk.checked; }
        _applySettings();
      });
    }
    _wireGridToggle("ss-major-grid", "ss-major-grid-color", "ss-major-grid-opacity");
    _wireGridToggle("ss-minor-grid", "ss-minor-grid-color", "ss-minor-grid-opacity");

    function _wireWidthColor(widthId, colorId) {
      _getEl(widthId).addEventListener("change", () => {
        const w = parseFloat(_getEl(widthId).value);
        const c = _getEl(colorId);
        c.disabled = w === 0; c.style.opacity = w === 0 ? "0.4" : "1";
        _applySettings();
      });
    }
    _wireWidthColor("ss-edge-width",          "ss-edge-color");
    _wireWidthColor("ss-plot-border-width",    "ss-plot-border-color");
    _wireWidthColor("ss-legend-border-width",  "ss-legend-border-color");

    ["ss-title","ss-title-pos","ss-plot-title-font","ss-axis-title-font",
     "ss-legend-pos","ss-legend-font","ss-legend-bg","ss-legend-border-color",
     "ss-font-size","ss-tick-font","ss-font-color",
     "ss-marker-size","ss-marker-color","ss-edge-color",
     "ss-height","ss-plot-bg","ss-paper-bg","ss-plot-border-color",
     "ss-major-grid-color","ss-minor-grid-color"].forEach(id => {
      const inputEl = _getEl(id);
      if (inputEl) inputEl.addEventListener("change", _applySettings);
    });
  }

  // ── Action row + status bar ────────────────────────────────────────────────
  const actionRow = el("div", { cls: "subset-action-row" });
  const commitBtn = el("button", { cls: "btn btn--primary", type: "button", text: "Commit Subset" });
  const undoBtn   = el("button", { cls: "btn btn--ghost",   type: "button", text: "Undo" });
  undoBtn.disabled = true;
  actionRow.appendChild(commitBtn);
  actionRow.appendChild(undoBtn);
  card.appendChild(actionRow);

  const statusBar = el("div", { cls: "subset-status hidden" });
  card.appendChild(statusBar);

  // ── Build filter rows ──────────────────────────────────────────────────────
  function _clamp(v, mn, mx) { return Math.min(Math.max(v, mn), mx); }

  for (const col of numericCols) {
    const lo   = colMins[col];
    const hi   = colMaxs[col];
    const step = colStep[col];
    const dec  = colDec[col];
    const uid  = col.replace(/[^a-z0-9]/gi, "_");

    const rowEl  = el("div", { cls: "subset-filter-row" });
    const hdrEl  = el("div", { cls: "subset-filter-row-header" });
    const lblEl  = el("span", { cls: "subset-filter-row-label" });
    lblEl.textContent = col; lblEl.title = col;
    const rstBtn = el("button", { cls: "subset-filter-reset-btn", type: "button", text: "↺" });
    rstBtn.title = "Reset to full range";
    hdrEl.appendChild(lblEl);
    hdrEl.appendChild(rstBtn);

    const ctrlsEl = el("div", { cls: "subset-filter-row-controls" });
    ctrlsEl.innerHTML = `
      <span class="subset-filter-val" id="sub-vlo-${uid}">${lo.toFixed(dec)}</span>
      <div class="subset-filter-sliders">
        <input type="range" class="subset-slider" id="sub-slo-${uid}"
               min="${lo}" max="${hi}" step="${step}" value="${lo}">
        <input type="range" class="subset-slider" id="sub-shi-${uid}"
               min="${lo}" max="${hi}" step="${step}" value="${hi}">
      </div>
      <span class="subset-filter-val subset-filter-val--right" id="sub-vhi-${uid}">${hi.toFixed(dec)}</span>
      <div class="subset-filter-num-pair">
        <input type="number" class="subset-num" id="sub-nlo-${uid}"
               min="${lo}" max="${hi}" step="${step}" value="${lo.toFixed(dec)}" aria-label="Min ${col}">
        <span class="subset-num-sep">–</span>
        <input type="number" class="subset-num" id="sub-nhi-${uid}"
               min="${lo}" max="${hi}" step="${step}" value="${hi.toFixed(dec)}" aria-label="Max ${col}">
      </div>
    `;

    rowEl.appendChild(hdrEl);
    rowEl.appendChild(ctrlsEl);
    filterList.appendChild(rowEl);

    const vLo = ctrlsEl.querySelector(`#sub-vlo-${uid}`);
    const vHi = ctrlsEl.querySelector(`#sub-vhi-${uid}`);
    const sLo = ctrlsEl.querySelector(`#sub-slo-${uid}`);
    const sHi = ctrlsEl.querySelector(`#sub-shi-${uid}`);
    const nLo = ctrlsEl.querySelector(`#sub-nlo-${uid}`);
    const nHi = ctrlsEl.querySelector(`#sub-nhi-${uid}`);

    const _sync = (newLo, newHi) => {
      newLo = _clamp(newLo, colMins[col], colMaxs[col]);
      newHi = _clamp(newHi, colMins[col], colMaxs[col]);
      if (newLo > newHi) newLo = newHi;
      filterRanges[col] = [newLo, newHi];
      const d = colDec[col];
      sLo.value = newLo;  sHi.value = newHi;
      nLo.value = newLo.toFixed(d); nHi.value = newHi.toFixed(d);
      vLo.textContent = newLo.toFixed(d); vHi.textContent = newHi.toFixed(d);
      const isActive = newLo > colMins[col] || newHi < colMaxs[col];
      rowEl.classList.toggle("subset-filter-row--active", isActive);
      _updatePreviewCount();
      _drawPreview();
    };

    sLo.addEventListener("input",  () => _sync(parseFloat(sLo.value), filterRanges[col][1]));
    sHi.addEventListener("input",  () => _sync(filterRanges[col][0],  parseFloat(sHi.value)));
    nLo.addEventListener("change", () => _sync(parseFloat(nLo.value), filterRanges[col][1]));
    nHi.addEventListener("change", () => _sync(filterRanges[col][0],  parseFloat(nHi.value)));
    rstBtn.addEventListener("click", () => _sync(colMins[col], colMaxs[col]));
  }

  resetAllBtn.addEventListener("click", () => {
    for (const col of numericCols) {
      filterRanges[col] = [colMins[col], colMaxs[col]];
      const uid = col.replace(/[^a-z0-9]/gi, "_");
      const row = filterList.querySelector(`#sub-slo-${uid}`)?.closest(".subset-filter-row");
      const sLo = filterList.querySelector(`#sub-slo-${uid}`);
      const sHi = filterList.querySelector(`#sub-shi-${uid}`);
      const nLo = filterList.querySelector(`#sub-nlo-${uid}`);
      const nHi = filterList.querySelector(`#sub-nhi-${uid}`);
      const vLo = filterList.querySelector(`#sub-vlo-${uid}`);
      const vHi = filterList.querySelector(`#sub-vhi-${uid}`);
      const d   = colDec[col];
      if (sLo) { sLo.value = colMins[col]; sHi.value = colMaxs[col]; }
      if (nLo) { nLo.value = colMins[col].toFixed(d); nHi.value = colMaxs[col].toFixed(d); }
      if (vLo) { vLo.textContent = colMins[col].toFixed(d); vHi.textContent = colMaxs[col].toFixed(d); }
      if (row) row.classList.remove("subset-filter-row--active");
    }
    _updatePreviewCount();
    _drawPreview();
  });

  // ── Preview helpers ────────────────────────────────────────────────────────
  function _activeFilters() {
    const active = {};
    for (const [col, [lo, hi]] of Object.entries(filterRanges)) {
      if (lo > colMins[col] || hi < colMaxs[col]) active[col] = [lo, hi];
    }
    return active;
  }

  function _countIncluded() {
    const af = _activeFilters();
    if (Object.keys(af).length === 0) return rows.length;
    return rows.filter(row =>
      Object.entries(af).every(([col, [lo, hi]]) => {
        const v = row[col];
        if (v == null || !isFinite(v)) return true;
        return v >= lo && v <= hi;
      })
    ).length;
  }

  function _updatePreviewCount() {
    const kept  = _countIncluded();
    const total = rows.length;
    previewCount.textContent = `Would keep: ${kept.toLocaleString()} / ${total.toLocaleString()} rows`;
    previewCount.classList.toggle("subset-preview-count--warn", total > 0 && kept / total < 0.1);
  }

  function _drawPreview() {
    if (!chartEl || !xCol || !yCol) return;
    renderDataScatter2D(chartEl, rows, {
      xCol,
      yCol,
      filterRanges: _activeFilters(),
      ...s2d,
    });
  }

  // ── Status bar helper ──────────────────────────────────────────────────────
  function _showStatus(type, msg) {
    statusBar.className = "subset-status";
    if (type === "ok") {
      statusBar.innerHTML = `<span class="subset-status-icon">✓</span> ${msg}`;
    } else if (type === "error") {
      statusBar.innerHTML = `<span class="subset-status-icon subset-status-icon--error">✗</span> ${msg}`;
      statusBar.classList.add("subset-status--error");
    } else {
      statusBar.innerHTML = `<span class="subset-status-icon subset-status-icon--warn">⚠</span> ${msg}`;
      statusBar.classList.add("subset-status--warn");
    }
  }

  const _themeHandler = () => _drawPreview();
  document.addEventListener("theme:changed", _themeHandler);

  // ── Commit ─────────────────────────────────────────────────────────────────
  commitBtn.addEventListener("click", async () => {
    const conditions = {};
    for (const col of numericCols) {
      const [lo, hi] = filterRanges[col];
      if (lo > colMins[col] || hi < colMaxs[col]) {
        conditions[col] = { lo, hi };
      }
    }

    if (Object.keys(conditions).length === 0) {
      _showStatus("warn",
        "No filters applied — all rows would be kept. "
        + "Adjust at least one range before committing."
      );
      showWarning("No filters applied — adjust at least one range before committing.");
      return;
    }

    commitBtn.disabled    = true;
    commitBtn.textContent = "Committing…";
    showSpinner("Applying subset…");
    const resp = await post("/api/data/subset", { conditions });
    hideSpinner();
    commitBtn.disabled    = false;
    commitBtn.textContent = "Commit Subset";

    if (!resp.success) {
      _showStatus("error", resp.message || "Subset failed — check the server log.");
      showError(resp.message || "Subset failed.");
      return;
    }

    showSuccess(
      `Subset applied — kept ${resp.rows_after.toLocaleString()} of `
      + `${resp.rows_before.toLocaleString()} rows.`
    );

    if (resp.zero_variance_columns?.length) {
      showWarning(
        `Zero-variance columns after subset: ${resp.zero_variance_columns.join(", ")}. `
        + "Consider removing them in Filter."
      );
    }

    rowCountEl.textContent = `${resp.rows_after.toLocaleString()} rows (subset active)`;
    rowCountEl.classList.add("subset-row-count--active");

    _showStatus("ok",
      `Subset committed — ${resp.rows_removed.toLocaleString()} rows removed, `
      + `${resp.rows_after.toLocaleString()} rows remain.`
      + (resp.zero_variance_columns?.length
        ? ` Zero-variance: ${resp.zero_variance_columns.join(", ")}`
        : "")
    );

    undoBtn.disabled = false;

    containerEl.dispatchEvent(new CustomEvent("subset:committed", {
      bubbles: true,
      detail: { rows_after: resp.rows_after, rows_before: resp.rows_before },
    }));
  });

  // ── Undo ───────────────────────────────────────────────────────────────────
  undoBtn.addEventListener("click", async () => {
    undoBtn.disabled    = true;
    undoBtn.textContent = "Undoing…";
    showSpinner("Undoing subset…");
    const resp = await post("/api/data/subset/undo", {});
    hideSpinner();
    undoBtn.textContent = "Undo";

    if (!resp.success) {
      undoBtn.disabled = false;
      showError(resp.message || "Undo failed.");
      return;
    }

    document.removeEventListener("theme:changed", _themeHandler);
    showSuccess(`Subset undone — restored ${resp.rows_restored.toLocaleString()} rows.`);
    containerEl.dispatchEvent(new CustomEvent("subset:undone", { bubbles: true }));
    await initSubset(containerEl);
  });

  // ── Initial render ─────────────────────────────────────────────────────────
  _updatePreviewCount();
  _drawPreview();
}
