# UI Designer Handoff — Pair Plot Readability

**Status:** Open — Phase 2 task  
**Assigned to:** UI Designer  
**Raised by:** Engineering team, Sub-Phase 1 review (2026-05-11)  
**Context:** The Phase 1 scatter matrix uses Plotly SPLOM (Splom trace via `charts.js:renderScatterMatrix()`). Six readability issues were identified during first-use review. No code changes are made here — this document specifies requirements for the Phase 2 redesign.

---

## Issues

### 1. Font sizes too small

**What:** Axis tick labels and dimension labels render at Plotly's default SPLOM font size. At 10 columns (the current cap), cells are ~100×100 px and labels are unreadable at normal viewing distance.

**Recommendation:** Set `layout.font.size` to at least 10px and dimension label font to 11px. Consider increasing the overall chart height (currently `height: 500` in `charts.js`) to give each cell more room. May need responsive sizing based on column count.

---

### 2. Marker size too small for sparse datasets

**What:** Markers are rendered at `size: 4` (`charts.js:renderScatterMatrix()`). On datasets with fewer than ~100 rows, individual points are barely visible against the grid lines.

**Recommendation:** Scale `marker.size` by `Math.max(4, Math.min(8, 400 / n_rows))` so sparse datasets get larger dots. Cap at 8 to avoid overlap on dense datasets.

---

### 3. Dimension label overlap on long column names

**What:** Plotly SPLOM renders dimension labels as diagonal text within the fixed cell width. Column names longer than ~6 characters begin to overlap adjacent labels. There is no built-in ellipsis or wrapping support.

**Recommendation:** Truncate dimension labels to 8 characters with an ellipsis before passing to the SPLOM trace: `name.length > 8 ? name.slice(0, 7) + "…" : name`. Full column names should still appear in hover text. Alternatively, render the SPLOM with a larger `width` so cells have more horizontal space.

---

### 4. Color contrast insufficient in light mode

**What:** The current outlier color (`rgba(239,68,68,0.8)`) and normal point color (`rgba(75,110,245,0.55)`) were chosen against the dark background (`#0f1117`). In light mode (`#f5f7fb` base), the blue points have low contrast and the red outliers appear washed out.

**Recommendation:** Define a theme-aware color pair:
- Light mode: normal → `rgba(59,93,217,0.7)`, outlier → `rgba(220,38,38,0.85)`
- Dark mode: keep current values (they were designed for dark)

`charts.js` should read `document.documentElement.dataset.theme` to select the correct pair before building the trace. The `learning:enabled` / `learning:disabled` custom events pattern can be extended with a `theme:changed` event dispatched from `_applyTheme()` in `main.js`.

---

### 5. Diagonal cells show scatter instead of distribution

**What:** In a standard SPLOM, diagonal cells show the univariate distribution of each variable (histogram or KDE). Plotly SPLOM does not natively support this — the diagonal shows scatter (same variable on both axes), which is a straight line and wastes space.

**Recommendation:** Overlay a separate histogram trace per variable on each diagonal cell using `xaxis` / `yaxis` domain offsets, or use the `splom` trace's `diagonal.visible: false` and replace diagonal cells with individual `histogram` traces positioned to match the SPLOM grid. This is significant layout work — scope as a dedicated Phase 2 story.

---

### 6. No axis units in SPLOM labels

**What:** Plotly SPLOM dimension labels show only column names. There is no mechanism to append units (e.g., `Cl` vs `Cl [—]`, `Mach` vs `Mach [—]`, `CD [counts]`). Engineers working with aerodynamic or structural data need units visible in the chart.

**Recommendation:** Add an optional `units` map to the data summary response (`GET /api/data/summary`) in Phase 2. If the user defines units (post-normalization step), append them to the dimension label string: `name + (unit ? " [" + unit + "]" : "")`. Until the units feature exists, this is blocked.

---

## Priority order for Phase 2

| # | Issue | Effort | Impact |
|---|---|---|---|
| 1 | Color contrast (light mode) | Low | High |
| 2 | Marker size scaling | Low | Medium |
| 3 | Font sizes | Low | High |
| 4 | Label truncation | Low | Medium |
| 5 | Diagonal histograms | High | High |
| 6 | Axis units | Medium (backend + frontend) | Medium |
