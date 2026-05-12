# Changelog

All notable changes to the Surrogate Modeling Toolkit are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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
