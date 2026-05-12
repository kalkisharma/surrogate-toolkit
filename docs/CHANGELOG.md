# Changelog

All notable changes to the Surrogate Modeling Toolkit are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.2.4] — 2026-05-12

### Upload gate UX improvements

#### Changed

- **Drop zone disabled after first upload** — after the first file is accepted on the initial screen, the drop zone greys out (`upload-zone--queued` class, `pointer-events: none`) and its label changes to "1 file queued — make a selection below". The browse button is hidden. Further drops or file-picker selections are blocked via an `isActive()` guard passed to `_wireDropZone`. The zone is never re-enabled — once the user confirms the gate, `_renderExploration` replaces the entire view. This prevents a second upload from replacing the active dataset while the data-type gate is still open.
- **"Load another file" gate is now a modal overlay** — replaced the inline banner with a native `<dialog>` element using `showModal()`. The modal appears centered with a blurred backdrop; the underlying exploration view stays visible behind it. Backdrop click or Cancel dismisses the modal without further action. Confirm saves data type, closes the modal, and re-renders the exploration view. Focus is trapped inside the dialog automatically by the browser. No JS library required.

---

## [0.2.3] — 2026-05-12

### Bug fix

#### Fixed

- **Data Preview table disappears on dataset switch** — `preview_rows` (first 10 rows) were computed at upload time but not stored in `_datasets` metadata, so the switcher had no rows to pass to `_renderExploration`. Fix: `preview_rows` and `null_counts` are now stored in `ds_meta` at upload time; `GET /api/data/datasets` returns both fields per dataset; the switcher handler populates `uploadMeta.preview.rows` and `uploadMeta.metadata.null_counts` from the cached values, so the Data Preview table renders correctly on every switch.

---

## [0.2.2] — 2026-05-12

### Clear session

#### Added

- **"✕ Clear" button in global header** — appears at all times next to the theme toggle. Clicking prompts for confirmation, then calls `POST /api/state/reset`, removes the dataset switcher, returns to the upload screen, and shows a success toast.
- **`POST /api/state/reset` endpoint** — calls `reset_state()` (in-place `STATE.clear()` + deep-copy of canonical template), wiping all loaded datasets and session data. Logged via `app.logger.info()`.
- **2 new integration tests** — verify reset clears `_datasets` accumulator and removes the primary DataFrame so `/api/data/rows` returns a failure after reset.

---

## [0.2.1] — 2026-05-12

### Testing session bug fixes

#### Fixed

- **S4-1 — Cell shading replaces broken axis border** — "Axis border" toggle in Plot Settings removed (Plotly SPLOM silently ignores `showframe`/`linewidth` on inner cell edges). Replaced with "Cell shading" checkbox that applies a theme-aware `plot_bgcolor` tint (`rgba(0,0,0,0.04)` light / `rgba(255,255,255,0.04)` dark) to all SPLOM cells. The axis line color picker is removed; `cellShading` boolean is the new setting key in `localStorage`.
- **S6-1 — Inline gate now appears above the data preview** — `_renderAdditionalFileGate` previously inserted the compact gate above `#explore-section` (the SPLOM), which pushed it below the data preview table and required scrolling to find. Now inserts above `.preview-section` (data table) and auto-scrolls to the gate with `scrollIntoView({ behavior: "smooth" })`.
- **S6-2 — Dataset switch no longer clears the SPLOM** — `GET /api/data/datasets` was missing the `columns` field; the frontend fell back to `columns: []`, causing `initExploration` to render an empty chart. Backend now returns `"columns": m.get("columns", [])` per dataset. Frontend `_refreshDatasetSwitcher` switch handler uses `active.columns || []` when constructing the `uploadMeta` passed to `_renderExploration`.
- **S7-1 — Learning mode primer added to Summary Statistics** — `_buildStatsSection` now registers a primer anchored to the "Summary Statistics" header. Content covers μ±σ interpretation, skewness threshold (|skew| > 1 = heavy tail), and the null-border color legend (green / amber / red).

---

## [0.2.0] — 2026-05-12

### Multi-file loading + stats formatting

#### Added

- **Multi-file dataset loading** — uploading a second (or third…) CSV no longer replaces the first. Each file is stored in a new `_datasets` accumulator dict keyed by safe filename. The most recently uploaded file becomes the active dataset; all existing API endpoints (`/api/data/rows`, `/api/data/summary`) continue to serve the active dataset transparently via a `datasets.primary` mirror.
- **`GET /api/data/datasets`** — new endpoint returning all loaded datasets with key, filename, row/col counts, data type, memory footprint (bytes), and active flag.
- **Dataset switcher in global header** — appears automatically when 2+ datasets are loaded. Dropdown shows `filename — data_type` for each entry. Selecting a dataset calls `PUT /api/state/session` with the new `active_dataset_key`, mirrors the dataset to primary, and re-renders the exploration view.
- **"Load another file" button** — available in the exploration view summary bar. Opens a file picker; on selection, uploads the file and shows a compact inline gate above the current exploration view. The existing chart stays visible while the user selects the data type.
- **`active_dataset_key` in `PUT /api/state/session`** — switching the active dataset mirrors the selected `_datasets` entry to primary and logs the switch via `app.logger.info()`.
- **`data_type` annotated per dataset** — when the gate sets `data_type` via `PUT /api/state/session`, the active dataset's metadata is also updated. Shown in the switcher dropdown and in `GET /api/data/datasets`.
- **LRU eviction** — when either `MAX_DATASETS = 5` (count cap) or `MAX_DATASETS_MEMORY_MB = 2048` (memory budget) is exceeded, the least-recently-accessed dataset is dropped. Evictions emit a warning toast and are logged via `app.logger.info()`. Eviction warnings are included in the upload API response.
- **Memory tracking** — `df.memory_usage(deep=True).sum()` computed at upload time; stored as `memory_bytes` per dataset entry. Reported in `GET /api/data/datasets`.
- **`MAX_DATASETS` and `MAX_DATASETS_MEMORY_MB`** constants in `config/settings.py`.
- **7 new integration tests** for multi-file upload, dataset accumulation, active-key switching, 404 on unknown key, data_type per dataset, empty dataset list, and eviction response shape.

#### Changed

- **Summary statistics — two-tier layout** — stats cards reorganised from 7 flat rows into two groups:
  - *Primary* (bold): `μ ± σ` (mean ± std) and `range` (min … max).
  - *Secondary* (muted): `median`, `nulls` (shown as `n / N (x%)`), `skew`.
- **Stats card quality border** — left border color indicates data quality: green = 0% nulls, amber = 1–10%, red > 10%.
- **Column name styling** — larger font weight, bottom border separating name from stats rows.

---

## [0.1.10] — 2026-05-12

### Bug fix

#### Fixed

- **SPLOM axis border only appearing on matrix exterior edges** — `showline: true` + `mirror: "ticks"` only draw lines on the outer boundary of the full SPLOM grid, not around individual scatter cells. Fixed by adding `showframe: showAxisLines` and `linewidth: showAxisLines ? 1 : 0` to every axis entry in the axisLayout loop in `charts.js`. Each cell now receives a complete rectangular frame when "Axis border" is enabled.

---

## [0.1.9] — 2026-05-12

### Bug fixes, features, and accessibility

#### Fixed

- **Toast message text invisible in light mode** — `.toast__message` was set to `var(--color-text-primary)` (dark navy in light mode), but toast backgrounds are always dark. Changed to a fixed light color (`#e8ecf5`) so text is always readable regardless of theme.
- **Theme toggle does not re-render SPLOM** — `_applyTheme()` now dispatches `theme:changed` after updating the DOM attribute. `data_explorer.js` listens for this event and calls `_rerender()` so palette colors and font colors update immediately.
- **Stats crash on all-null column** — `_buildStatsSection` now guards `vals.length === 0` before calling `Math.min`/`Math.max`, returning `NaN` placeholders instead of throwing.

#### Added

- **Additional SPLOM color controls** — plot settings panel gains nine new controls grouped under labeled section dividers:
  - *Typography*: Font color picker with Auto checkbox (uses theme default when auto).
  - *Figure*: Plot background and paper background color pickers, each with Auto checkbox (transparent when auto).
  - *Gridlines*: Major grid color picker + opacity slider; minor grid color picker + opacity slider; axis border toggle + color picker.
- **`_hexToRgba(hex, opacity)` helper** in `charts.js` — converts hex colors to `rgba()` strings for Plotly gridline color + opacity support.

#### Changed

- **Settings panel grouped with labeled dividers** — controls reorganised into four sections (Typography / Markers / Figure / Gridlines) using a full-width `.settings-divider` flex item. Palette selector moved into the Markers group.
- **SPLOM diagonal cells show histograms** — `diagonal: { visible: true, type: "histogram" }` replaces the blank diagonal. Gives per-column distribution context without additional UI.
- **Primer `<details>` elements carry `aria-label`** — `registerPrimer()` sets `aria-label` to the summary text so screen readers announce the topic when navigating to a collapsed primer.

---

## [0.1.8] — 2026-05-12

### Bug fixes

#### Fixed

- **Summary statistics layout** — stats grid changed from `flex-wrap` (many narrow cards per row) to `grid-template-columns: repeat(4, 1fr)` (maximum 4 equal-width cards per row). Cards now fill the available width and are no longer compressed.

---

## [0.1.7] — 2026-05-12

### Bug fixes

#### Fixed

- **SPLOM label/tick clipping** — `layout.margin` in `charts.js` was fixed at 20 px on all sides, too small to accommodate axis tick numbers or dimension labels at any font size above the default. Margins are now computed dynamically: `l` and `b` scale with `tickFontSize` (`max(50, tickFontSize × 6)`); `t` scales with `fontSize` (`max(30, fontSize × 3)`); `r` stays at 20 px. Labels and tick numbers now have correct clearance at all font sizes.
- **Stats card number overflow** — stat values (e.g. `-123456.78`) could extend past the 180 px card boundary. Fixed by adding `min-width: 0` to `.stat-pair` (required for grid children to shrink) and `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` to `.stat-pair__val`. Full value remains accessible via hover tooltip (`title` attribute on each value span).

---

## [0.1.6] — 2026-05-12

### Explore view — full data, layout refactor, expanded plot controls

#### Added

- **`GET /api/data/rows`** — new endpoint returning up to `MAX_PLOT_ROWS = 2000` rows from the full ingested dataset. Used by the frontend to populate the SPLOM with real data instead of the 10-row upload preview. Returns `rows`, `columns`, `total_rows`, `shown_rows`, `truncated`. Truncation notice shown in the UI when total rows exceeds the limit.
- **`MAX_PLOT_ROWS = 2000`** constant in `config/settings.py`.
- **Marker opacity control** — range slider (0.10–1.00, step 0.05) with live numeric readout. Maps to `marker.opacity` in Plotly.
- **Marker edge width** — number input (0–3, step 0.5). Maps to `marker.line.width`.
- **Marker edge color** — color picker. Maps to `marker.line.color`. Greyed out (disabled) when edge width is 0.
- **Chart width control** — number input (400–1400 px, step 50) with a "Full" checkbox for unconstrained width. Sets CSS `max-width` on the chart container; Plotly `responsive: true` stays intact.
- **Save plot** — re-enabled Plotly's built-in camera/download button (previously suppressed via `modeBarButtonsToRemove`). Downloads the chart as PNG.
- **2 new integration tests** for `GET /api/data/rows` (no-data 400, after-upload 200 with correct shape).

#### Changed

- **Font size controls** — replaced S/M/L button groups with `<input type="number">`. Label font: 7–20 px. Tick font: 6–16 px. Both debounced 200 ms.
- **Summary statistics moved below chart** — removed the right sidebar. Stats now appear as a flex-wrap row of fixed-width (180 px) per-column cards beneath the chart. Frees the chart to use full container width.
- **Explore layout** — `explore-layout` flex row and sidebar removed from the view. Chart wrap and stats section are now direct children of the view root.
- **Outlier detection** — now runs on all fetched rows (up to 2,000) instead of the 10-row preview. IQR detection is more representative of the actual dataset distribution.

---

## [0.1.5] — 2026-05-12

### Plot settings panel

#### Added

- **Expandable plot settings panel** — a `<details>`/`<summary>` panel inserted between the outlier controls and the scatter matrix. Collapsed by default; click "Plot Settings ▸" to expand. Settings are persisted to `localStorage` under `surrogate_chart_settings` and restored on page reload.
- **Label font size** — S / M / L button group (9 / 11 / 13 px) controlling the dimension label text in the SPLOM.
- **Tick font size** — S / M / L button group (7 / 9 / 11 px) controlling the axis tick number text independently from dimension labels.
- **Marker size** — number input (3–12, step 1); pre-filled with the auto-scaled value computed from row count. Updates on input with 200 ms debounce.
- **Figure height** — number input (300–1200 px, step 50); pre-filled with the auto-scaled value computed from column count. Updates on input with 200 ms debounce.
- **Major gridlines** — checkbox, on by default.
- **Minor gridlines** — checkbox, off by default.
- **Marker palette** — select dropdown: Blue/Red (default), Green/Orange, Teal/Amber. Each palette has distinct light-mode and dark-mode colour pairs for normal and outlier markers.

#### Changed

- **`charts.js`** — `_PALETTES` constant defines three named colour pairs (normal/outlier) for light and dark themes. `_getThemeColors(palette)` accepts palette name. `renderScatterMatrix()` expanded options: `fontSize`, `tickFontSize`, `markerSize`, `height`, `showMajorGrid`, `showMinorGrid`, `palette`. Axis keys enumerated explicitly so tick font and grid settings apply to all SPLOM cells. Returns `computedMarkerSize` and `computedHeight` for panel pre-fill. `updateScatterMatrixOutliers()` accepts optional `palette` argument.
- **`data_explorer.js`** — outlier toggle now calls full `renderScatterMatrix()` with current settings (not `updateScatterMatrixOutliers`) so palette and size remain consistent on toggle.

---

## [0.1.4] — 2026-05-12

### Pair plot (SPLOM) cleanup

#### Changed

- **Theme-aware colors** — `charts.js` now calls `_getThemeColors()` at render time so scatter matrix marker and font colors adapt to the active theme. Normal points use a stronger blue in light mode (`rgba(59,93,217,0.75)`) and a softer blue in dark mode (`rgba(75,110,245,0.65)`); outlier red similarly adjusted per theme. `updateScatterMatrixOutliers` also reads theme colors so a restyle after a theme toggle picks up the correct palette.
- **Upper half hidden** — `showupperhalf: false` removes the redundant mirror triangles from the SPLOM, halving visual noise and making the lower-half cells larger.
- **Marker size scaled by row count** — size is now `Math.max(4, Math.min(8, 400 / rows.length))`, giving larger dots for sparse datasets and smaller dots for dense ones. Replaces the fixed `size: 4`.
- **Marker opacity** — added `marker.opacity: 0.8` for slight transparency, reducing overplotting on dense datasets.
- **Label truncation** — column names longer than 9 characters are truncated to 8 characters with a `…` suffix so dimension labels do not overlap in SPLOM cells.

---

## [0.1.3] — 2026-05-12

### Bug fixes

#### Changed

- **Light mode guaranteed on version update** — inline script in `index.html` now checks stored `app_version` against the current version. On mismatch (first install or upgrade), any stored theme preference is cleared and light mode becomes the default. Engineers who prefer dark mode can re-toggle after each update.
- **Version logged on startup** — `create_app()` in `app/__init__.py` now calls `app.logger.info(f"Surrogate Toolkit v{VERSION} starting")`, which appears in all deployment modes (dev server and gunicorn). Closes the production audit trace gap identified in team review.

---

## [0.1.2] — 2026-05-12

### Bug fixes and improvements

#### Fixed

- **Theme toggle** — removed stale `@import url("variables.css")` from `main.css`. The `@import` fetched the file without the `?v=` cache-buster, causing the old dark-as-`:root` version to override the new light palette and making the toggle appear non-functional.

#### Changed

- **Cores — number input** — replaced the fixed 1–8 dropdown with a free-text `<input type="number">`. `navigator.hardwareConcurrency` detects the machine's logical CPU count and sets it as the max and placeholder. Border turns amber when value exceeds 4 (head-node warning threshold). Hover tooltip confirms detected count or shows warning if over threshold.
- **Launch banner** — `python run.py` now prints a formatted version banner to the console before Flask output:
  ```
  ══════════════════════════════════════════
    Surrogate Toolkit  v0.1.2
    http://127.0.0.1:5000
    Debug: off
  ══════════════════════════════════════════
  ```

---

## [0.1.1] — 2026-05-12

### Sub-Phase 1 — UX/UI refinements

#### Changed

- **Home screen copy** — headline lowercased to sentence case; subtitle shortened to four-step summary (`Upload your data. Normalize. Train. Validate. All on your machine.`)
- **Global header** — replaced the old `#learning-status-bar` (only visible when learning mode was on) with a permanent `#global-header` always visible at the top. Header contains: app name/version, Level selector (Beginner active; Intermediate and Expert disabled with Phase 2 label), Cores selector (1–8, ⚠ on options >4), theme toggle, learning mode button.
- **Gate questionnaire** — removed experience level and processor count from the sequential upload flow. Upload now asks only one question (data type) before showing the Continue button. Experience level and processor count are configurable at any time via the global header.
- **Theme** — light mode is now the default (`:root` palette in `variables.css`). Dark mode is opt-in via the theme toggle button; preference is persisted to `localStorage`. Dark palette moved to `[data-theme="dark"]` CSS selector.
- **Data preview table** — added `min-width: 0; overflow: hidden` to `.preview-section.card` so the existing `overflow-x: auto` on `.preview-table-wrap` takes effect. Wide tables now scroll horizontally instead of overflowing.

#### Added

- `docs/ui_designer_handoff.md` — six pair plot readability issues documented for UI Designer: font sizes, marker size, label overlap, color contrast (light mode), diagonal histograms, axis units. Prioritized for Phase 2.

#### Known limitations carried forward

- Scatter matrix uses 10-row preview only (full-dataset chart endpoint deferred)
- Learning mode state not persisted to backend (JS state only)
- No Vite bundling (ES modules served directly)
- STATE is a plain dict — not thread-safe for multi-worker gunicorn deployments
- Pair plot readability: 6 open issues documented in `docs/ui_designer_handoff.md`
- Data cleaning, normalization, model training, active learning: Phase 2+

---

## [0.1.0] — 2026-05-11

### Phase 1 — Initial build

#### Added

**Project scaffold**
- Full folder structure per spec: `app/`, `config/`, `static/`, `tests/`, `docs/`
- All stub Python/JS/CSS/JSON files with standard headers and license notices
- `requirements.txt`, `environment.yml`, `.env.example`, `.gitignore`
- Synthetic test fixtures: `sample_clean.csv` (500×10), `sample_dirty.csv` (505×10), `sample_edge.csv` (10×2), and edge case CSVs

**Backend**
- `config/settings.py` — single source of truth for all constants
- `app/state/schema.py` — canonical STATE dict (full spec structure), `reset_state()`, `get_state()`, `get_state_json_safe()`
- `run.py` — Flask development entry point, reads from `.env`
- `app/__init__.py` — `create_app()` factory with blueprint registration, STATE init, global error handlers (413/404/405/500), SPA deep-link support
- `app/data/ingestion.py` — 12-step CSV validation pipeline (size, extension, encoding, headers, duplicates, row/column counts, float coercion, null tolerance)
- `app/api/data_api.py` — `POST /api/data/upload`, `GET /api/data/summary`
- `app/api/state_api.py` — `GET /api/state/`, `PUT /api/state/session`
- `app/routes/main.py` — `GET /` serving SPA shell

**Frontend**
- `static/css/variables.css` — design tokens (dark theme)
- `static/css/main.css` — global reset, layout, components
- `static/css/notifications.css`, `loading.css`, `learning_mode.css`
- `static/js/api.js` — fetch wrapper (FormData + JSON, network error handling)
- `static/js/state.js` — client-side STATE cache with `refreshState()`, `getPath()`
- `static/js/notifications.js` — centralised toast system (success/error/warning/info)
- `static/js/loading.js` — spinner overlay, inline progress bar, skeleton screens
- `static/js/utils.js` — math helpers (mean, std, median, skewness, IQR outlier detection), DOM helpers
- `static/js/charts.js` — Plotly 2.35.2 wrapper; only file that calls `Plotly.*`
- `static/js/learning_mode.js` — toggle, status bar, collapsible primers, expanded tooltips with viewport-edge flip
- `static/js/modules/data_explorer.js` — scatter matrix, stats sidebar, outlier toggle
- `static/js/main.js` — SPA entry: upload view, three sequential gates, preview table, navigation to exploration view
- `app/templates/index.html` — SPA shell

**Tests — 43 passing**
- `tests/unit/test_ingestion.py` — 24 unit tests covering every validation step
- `tests/integration/test_api_endpoints.py` — 19 integration tests covering upload happy path, all error cases, state endpoint, summary endpoint, session update

#### Fixed
- Pandas auto-renames duplicate column headers (e.g. `x,x` → `x,x.1`) before our duplicate check runs. Fixed by reading the raw header line via Python's `csv` module before pandas processes the file.

#### Known limitations (Phase 2 backlog)
- Scatter matrix uses 10-row preview only (full-dataset chart endpoint deferred)
- Learning mode state not persisted to backend (JS state only)
- No Vite bundling (ES modules served directly)
- STATE is a plain dict — not thread-safe for multi-worker gunicorn deployments
- Experience levels: beginner only in MVP; intermediate/expert deferred
- Data cleaning, normalization, model training, active learning: Phase 2+
