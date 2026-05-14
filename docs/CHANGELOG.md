# Changelog

All notable changes to the Surrogate Modeling Toolkit are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## Milestone Map

| Milestone | Version | Phases | Theme | Status |
|---|---|---|---|---|
| **M1** | v1.0.0 | 1–5 | Full end-to-end surrogate workflow | 🔶 Phases 1–4 done; Phase 5 not started |
| **M2** | v2.0.0 | 6–11 | Advanced analysis & production readiness | 🔲 Not started |
| **M3** | v3.0.0 | 12–16 | Teaching platform & advanced ML | 🔲 Not started |
| **M4** | v4.0.0 | TBD | Team deployment, auth, HPC integration | 🔲 Not defined |

See `docs/PHASES.md` for full phase definitions.

---

## [0.8.8] — 2026-05-13

### Combined diagnostic figure + full plot settings parity (v0.8.8)

#### Changed

- **Combined parity/residual subplot figure** — each output column now renders as a single Plotly figure containing a 1×2 subplot grid (parity left, residual right) instead of two independent figures. X-axes are linked: zooming or panning to a specific actual-value range on the parity plot mirrors on the residual plot. Single camera button per output exports `<colname>_diagnostics.png` at 2× scale.
- **Full plot settings parity with Data Exploration** — Plot Settings panel expanded from 8 to 16 controls, matching the explore tab's Typography / Markers / Figure / Gridlines structure. New controls: tick font size, font color (+ Auto), plot background (+ Auto), paper background (+ Auto), major grid opacity, minor grid on/off + color + opacity.
- **Font size → `automargin: true`** — all four axes in the combined figure use Plotly's `automargin` to automatically expand margins and prevent label/tick overlap at any font size. Replaces the previous fixed margins.

#### Added

- `renderOutputFigure()` in `charts.js` — new export; accepts full 16-field opts object; used by `results.js` in place of the separate `renderParityPlot` / `renderResidualPlot` calls.
- `.output-figure-wrap` CSS class — full-width container for the combined figure with card background and rounded corners.

#### Files changed

- `static/js/charts.js` — new `renderOutputFigure()` function
- `static/js/modules/results.js` — 16-field settings, expanded panel, single `figWrap` per output
- `static/css/main.css` — `.output-figure-wrap`
- `config/settings.py` — VERSION bump

---

## [0.8.7] — 2026-05-13

### Results plot settings — font size, edge controls, save as PNG (v0.8.7)

#### Added

- **Font size control** — number input (7–20 px, default 11) in the Figure section of the Plot Settings panel. Applies to axis title text and tick labels on all parity/residual plots simultaneously.
- **Edge width control** — number input (0–3 px, step 0.5, default 0) in the Markers section. Setting to 0 disables (and grays out) the edge color picker.
- **Edge color control** — color picker in the Markers section, disabled when edge width is 0.
- **Save as PNG** — camera icon (always visible, top-right corner of each plot) using Plotly's built-in `toImage` modebar button at 2× scale. Filename pre-filled: `parity_<colname>.png` or `residual_<colname>.png`.

#### Files changed

- `static/js/modules/results.js` — 3 new settings fields, 4 new controls + event handlers in `_buildSettingsPanel()`
- `static/js/charts.js` — `fontSize`, `edgeWidth`, `edgeColor` opts in both render functions; Plotly config updated to `displayModeBar: true` with `modeBarButtons: [['toImage']]`, `toImageButtonOptions: { scale: 2, filename }`
- `config/settings.py` — VERSION bump

---

## [0.8.6] — 2026-05-13

### Results tab plot settings panel (v0.8.6)

#### Added

- **Plot Settings panel on results tab** — a collapsible `<details>` panel (same visual pattern as the explore tab) appears above the parity/residual plots. Controls: marker size (3–12 px), marker opacity (0.1–1.0 slider), plot height (200–600 px), show/hide gridlines, grid color. Settings persist to localStorage under `"surrogate_result_chart_settings"` and are restored on next visit. Point color (red/amber/green by R² quality) is intentionally not user-overridable.
- `renderParityPlot()` and `renderResidualPlot()` in `charts.js` now accept an optional `opts` parameter (`{ markerSize, opacity, height, showGrid, gridColor }`) — backwards-compatible; all existing callers continue to work with defaults.

#### Files changed

- `static/js/modules/results.js` — settings state, `_buildSettingsPanel()`, `_rerenderPlots()`, settings passed to chart calls
- `static/js/charts.js` — `opts` parameter on both render functions
- `config/settings.py` — VERSION bump

---

## [0.8.5] — 2026-05-13

### Results tab polish — overlap fix + table/plot refinements (v0.8.5)

#### Fixed

- **Parity and residual plots overlapping** — Plotly's `responsive: true` combined with no explicit height on `.parity-plot-wrap` caused SVG canvases to overflow their containers, overlapping adjacent output rows and the metrics table below. Fixed by adding `height: 300px; min-height: 300px` to `.parity-plot-wrap` (bounding the responsive resize) and matching `height: 300` in both `renderParityPlot()` and `renderResidualPlot()` in `charts.js`.

#### Changed

- **Metrics table** — added card border (`border: 1px solid var(--color-border); border-radius: var(--radius-md)`) to `.results-table-wrap`; header row now has `background: var(--color-bg-subtle)` to distinguish it from data rows; even rows get subtle alternating shading; metric values are right-aligned; badges are vertically centered.
- **Parity/residual plot layout** — increased gap between plots from `space-4` to `space-5`; increased row separator margin from `space-5` to `space-6`; each plot container now has a card background and rounded corners for a clean visual boundary.

#### Files changed

- `static/js/charts.js` — `height: 280` → `height: 300` in `renderParityPlot()` and `renderResidualPlot()`
- `static/css/main.css` — `.parity-plot-wrap` height + card treatment; `.parity-plots` gap; `.parity-row` margin; `.results-table-wrap` card border; `.results-table th` background; alternating row shading; `.results-metric` text-align; `.results-badge` vertical-align
- `config/settings.py` — VERSION bump

---

## [0.8.4] — 2026-05-13

### Phase documentation + header corrections (v0.8.4)

#### Added

- **`docs/PHASES.md`** — full documentation for all 16 phases across 3 milestones. Each phase includes: purpose, user story, complete feature scope, backend components (new files and API endpoints), frontend components, dependencies, and definition of done. Covers Phases 1–5 (M1), Phases 6–11 (M2), and Phases 12–16 (M3). Four new pip dependencies identified: `pymoo` (Phase 6), `SALib` (Phase 8), `weasyprint` (Phase 11), `chaospy` (Phase 14).

#### Changed

- **`docs/DEVELOPER.md`** — versioning table rewritten to reflect the full 16-phase / 3-milestone structure. Milestone map added. Phase→version map updated with all phases and their version bands.
- **`docs/CHANGELOG.md`** — milestone map added at the top of the file for quick orientation.
- **`config/settings.py` header** — corrected stale `VERSION: 0.7.0` header to `VERSION: 0.8.4`.
- **`app/__init__.py` header** — corrected stale `VERSION: 0.6.0` header to `VERSION: 0.8.4`.
- **`app/templates/index.html`** — version bumped to 0.8.4 (8 locations: inline script, version span, 5 CSS cache-busters, JS entry point cache-buster).

#### Files changed

- `docs/PHASES.md` — new file, 16 phase definitions
- `docs/DEVELOPER.md` — versioning section rewritten
- `docs/CHANGELOG.md` — milestone map added
- `config/settings.py` — header + VERSION constant corrected
- `app/__init__.py` — header corrected
- `app/templates/index.html` — version bump (8 locations)

---

## [0.8.3] — 2026-05-12

### Per-dataset surrogate session storage (v0.8.3)

#### Fixed

- **Results tab locked after switching datasets, even after prior training** — the surrogate session (trained model + config) was a single global slot that was cleared on every dataset switch with no way to restore it. Switching back to a previously-trained dataset always required retraining. Fixed by storing a `surrogate_session` entry (`models`, `config`) inside each `_datasets[key]` entry. The switch handler now saves the outgoing session to `_datasets[prev_key]` and restores from `_datasets[new_key]` — if the new dataset was previously trained, its model and results are immediately available; if not, `GET /api/model/results` correctly returns `NO_TRAINED_MODEL` and the Results step stays locked.
- **Upload path bug — new file upload didn't clear the surrogate session** — `POST /api/data/upload` changed `active_dataset_key` directly (bypassing `PUT /api/state/session`), so the old model's surrogate session was never cleared. The Results step on the new file's exploration view would appear unlocked, showing the previous dataset's model. Fixed: the upload handler now saves the outgoing session and resets the surrogate session for the newly uploaded file (same save/restore pattern as the switch handler).

#### Files changed

- `app/api/state_api.py` — replace "clear on switch" with "save outgoing / restore incoming" surrogate session logic
- `app/api/data_api.py` — add `surrogate_session` to each `ds_entry` at upload; save outgoing session before changing `active_dataset_key`; clear surrogate session for new uploads; add `DEFAULT_CV_FOLDS, DEFAULT_TEST_SPLIT` to imports
- `config/settings.py` — `VERSION = "0.8.3"`
- `app/templates/index.html` — version bump (8 locations)

---

## [0.8.2] — 2026-05-12

### Dataset-switching correctness fixes (v0.8.2)

#### Fixed

- **Results always showed latest model, not the active dataset's model** — `surrogate_sessions["primary"]["models"]` was a single global slot with no dataset identity. Switching datasets left the previous model's results in STATE. `PUT /api/state/session` now clears `models` and resets `config` to defaults when switching datasets, so `GET /api/model/results` correctly returns `NO_TRAINED_MODEL` for a freshly switched dataset.
- **Training config persisted across dataset switch** — model type, test split, and CV folds set for dataset A were silently inherited by dataset B. Config is now cleared alongside models on switch.
- **Results step unlocked with stale data** — `_renderExploration` pre-checked `GET /api/model/results` and unlocked Step 8 even when the cached results belonged to a different dataset. Resolved as a consequence of the STATE fix above.
- **Results panel showed no source filename** — the Step 8 header never named the dataset the model was trained on. `POST /api/model/train` now stores `source_filename` in the results dict; `results.js` renders it as the first token of the description line.
- **Results completion checkmark set unconditionally** — `stepCompleted["results"] = true` fired even when `initResults` rendered the "no results yet" placeholder. `initResults` now returns `true`/`false`; the checkmark is only set on a successful result.
- **Step number mismatch** — the results panel inner title read "Step 7" while the sidebar numbers it as Step 8. Corrected to "Step 8 — Training Results".

#### Files changed

- `app/api/state_api.py` — clear `surrogate_sessions["primary"]["models"]` and reset `config` on dataset switch; import `DEFAULT_CV_FOLDS`, `DEFAULT_TEST_SPLIT`
- `app/api/model_api.py` — add `source_filename` to results dict
- `static/js/modules/results.js` — display `source_filename` in header; return `true`/`false` from `initResults`; fix "Step 7" → "Step 8"
- `static/js/main.js` — `stepCompleted["results"]` conditional on `initResults` return value
- `config/settings.py` — `VERSION = "0.8.2"`
- `app/templates/index.html` — version bump (8 locations)

---

## [0.8.1] — 2026-05-12

### Phase 3 — Parity & Residual Plots (v0.8.1)

#### Added

- **Parity plots (test set)** — per-output scatter of actual vs predicted values. A dashed diagonal shows the ideal 1:1 line. Point colour inherits the R² badge colour (green ≥ 0.85, amber ≥ 0.70, red < 0.70).
- **Residual plots (test set)** — per-output scatter of actual vs residual (actual − predicted). A dashed zero line shows the ideal no-error baseline.
- **Plot section in Step 7** — parity + residual plots rendered in a two-column grid per output, below the CV table. Shows up to 4 outputs; a note appears when more are present. Learning mode primer explains both chart types.
- **`test_actuals` / `test_predictions` arrays in train response** — `POST /api/model/train` now includes raw test-set arrays (shape: n_test × n_outputs) in the results dict and STATE, enabling client-side plot rendering without an extra API round-trip.
- **`renderParityPlot()` / `renderResidualPlot()`** added to `static/js/charts.js` — both accept `containerEl, yTrue, yPred, colName, badgeCls`; use `Plotly.newPlot` with `displayModeBar: false`; height 280px; transparent background.

#### Files changed

- `app/api/model_api.py` — added `test_actuals` / `test_predictions` to `results` dict in `train()`
- `static/js/charts.js` — added `renderParityPlot`, `renderResidualPlot`
- `static/js/modules/results.js` — import and render parity/residual plot section after CV table
- `static/css/main.css` — added `.parity-section`, `.parity-row`, `.parity-col-label`, `.parity-plots`, `.parity-plot-wrap`, `.results-plot-note`
- `config/settings.py` — `VERSION = "0.8.1"`
- `app/templates/index.html` — version bump (8 locations)

---

## [0.8.0] — 2026-05-12

### Phase 3 — Sidebar Layout + Panel Router (v0.8.0)

#### Added

- **Left sidebar navigation** — 200px fixed sidebar with 8 step items (number · label · status icon). Steps unlock sequentially: Upload/Preview/Explore always accessible; Designate unlocks after upload; Normalize/Configure unlock after designation; Results unlocks after training. Sidebar is sticky within the viewport.
- **Collapsible sidebar** — "‹" toggle button collapses sidebar to 52px icon-only mode, maximising content area on small screens. Arrow reverses on collapse/expand.
- **Single-panel router** — clicking a sidebar step shows exactly one panel at a time. Panels are lazy-initialised on first activation and cached (Plotly charts not re-rendered on revisit). `panelDone` dict prevents double-init.
- **Step completion indicators** — sidebar step items show a green checkmark (✓) when the step is complete and a lock (🔒) when locked. Active step highlighted with accent background and left border.
- **Active tab persistence** — every panel switch writes `active_tab` to `state["ui"]` via `PUT /api/state/session`. Field already existed in `_CANONICAL_STATE`; no schema change required.
- **Panel subtitles** — each panel shows a one-line metadata subtitle (filename, rows × cols) beneath the step title, replacing the old standalone summary bar card.
- **"+ Load File" in global header** — the "Load another file" action is now a persistent header button, visible whenever a dataset is loaded. Previously lived in the per-view summary bar.
- **Panel invalidation** — re-designating columns (Step 4) invalidates Normalize (Step 5) and Configure (Step 6) panels (`panelDone` cleared, DOM wiped) so they re-init with the updated column lists.
- **Cross-panel column state** — `_currentInputCols`, `_currentOutputCols`, `_currentNorm` mutable closure variables updated by designation/normalization callbacks and shared by all panel init functions.

#### Changed

- `main.js` — `_renderExploration()` completely rewritten as a sidebar + panel router. "← Upload new file" button removed (sidebar Step 1 replaces it and `✕ Clear` covers the full-reset case).
- `index.html` — `#header-load-file-btn` and `#header-add-file-input` moved into `<header>`. All 8 version strings bumped to 0.8.0.
- `main.css` — added `.workflow-layout`, `.workflow-sidebar`, `.workflow-sidebar--collapsed`, `.workflow-panel-area`, `.sidebar-collapse-btn`, `.step-item` variants, `.panel-file-meta`.

#### Files changed

- `static/js/main.js`
- `static/css/main.css`
- `app/templates/index.html`
- `config/settings.py` — `VERSION = "0.8.0"`

---

## [0.7.1] — 2026-05-12

### Phase 3 — Column Selector UX Patch (v0.7.1)

#### Changed

- **Column selector always visible** — the SPLOM column selector now appears for every dataset regardless of column count. Previously hidden for datasets with ≤ 10 columns.
- **Chip/tag row UI** — replaced the `<details>` checkbox-grid panel with a compact pill-chip row. Each chip toggles a column on/off. Selected chips highlight in the accent colour. Chips wrap to multiple lines for wide datasets. Takes ~40–80px of vertical space vs the old 200–300px scrollable grid.
- **"All" and "Clear" buttons** — "All" selects all columns up to the cap; "Clear" reduces selection to the minimum 2 columns.
- **Cap raised: 10 → 12** — `SPLOM_MAX_COLS` in `charts.js` raised from 10 to 12. The selector cap matches.
- **Minimum selection: 2** — users can select any subset from 2 to 12 columns. Previously the selector forced exactly 10 selected (all or nothing behaviour was broken for small datasets).
- **Smart default after designation** — when the user confirms column roles (Step 4), the SPLOM reorders its default selection to show output columns first, then input columns, then remaining. Updates live via `updateColumnSelectorRoles()` export called from `main.js`.
- **Smart default on load** — when `initExploration` is called with an `uploadResponse` that already carries `input_columns`/`output_columns` (e.g. after dataset switch), the initial chip selection uses the same outputs-first ordering.

#### Files changed

- `static/js/modules/data_explorer.js` — chip selector, `updateColumnSelectorRoles` export, smart default logic
- `static/js/charts.js` — `SPLOM_MAX_COLS` 10 → 12
- `static/js/main.js` — import `updateColumnSelectorRoles`; designation callback passes `output_columns` and calls `updateColumnSelectorRoles`
- `static/css/main.css` — replaced old `.col-selector-panel/grid/item/label` with `.col-selector-wrap`, `.col-selector-header`, `.col-selector-count`, `.col-selector-btn`, `.col-selector-row`, `.col-chip`, `.col-chip--selected`
- `config/settings.py` — `VERSION = "0.7.1"`
- `app/templates/index.html` — version bump (8 locations)

---

## [0.7.0] — 2026-05-12

### Phase 3 — A-Series: Model Training & Metrics (v0.7.0)

#### Added

- **Model training pipeline** — `POST /api/model/train` trains the configured surrogate model. Selects normalized data if available, falls back to clean. Runs k-fold cross-validation on the training set, fits the final model on the full training set, and evaluates on the held-out test set. Stores model and results in STATE.
- **Three surrogate model classes** — all implemented from the `BaseSurrogateModel` ABC:
  - **`GPRModel`** (`app/ml/models/gpr_model.py`) — Gaussian Process Regression wrapped in `MultiOutputRegressor` (one GPR per output column). Kernel: RBF, `alpha=0.1`, `normalize_y=True`.
  - **`RFModel`** (`app/ml/models/rf_model.py`) — `RandomForestRegressor(n_estimators=100)`. Handles multi-output natively.
  - **`LinearModel`** (`app/ml/models/linear_model.py`) — `Ridge(alpha=1.0)`. Fast, interpretable baseline.
  - All models: non-mutating inputs, always return 2D predictions `(n_samples, n_outputs)`.
- **`BaseSurrogateModel`** (`app/ml/models/base_model.py`) — abstract base class requiring `fit()`, `predict()`, `get_summary()`. `get_summary()` returns a JSON-serializable dict used by `get_state_json_safe()`.
- **`compute_metrics(y_true, y_pred, output_columns)`** (`app/ml/validation/diagnostics.py`) — computes R², RMSE, MAE per output column. Returns list of dicts.
- **`run_cross_validation(model, X, y, ...)`** (`app/ml/validation/cross_validation.py`) — k-fold CV using deep copies of the model per fold. Returns per-output mean ± std for R², RMSE, MAE.
- **`GET /api/model/results`** — returns stored training results from STATE. Returns 404 `NO_TRAINED_MODEL` if no model has been trained.
- **Step 7 — Training Results card** (`static/js/modules/results.js`) — fetches `GET /api/model/results` and renders a test-set metrics table and a CV summary table. R² badges colour-coded: green ≥ 0.85, amber 0.70–0.85, red < 0.70. Learning mode primers on both tables. Appears automatically after training completes and on page re-render if results exist.
- **"Train Model →" button in Step 6** — appended to the config status div after a successful `POST /api/model/configure`. Triggers `POST /api/model/train` with a spinner and `showWarning` for GPR-on-large-dataset warning. Calls `onTrain()` on success, which reveals the results card.
- **`get_state_json_safe()` extended** — now replaces model objects via duck-typing (`hasattr get_summary`). Eliminates the deep-copy-before-walk (avoids deep-copying large Random Forest objects needlessly).
- **GPR large-dataset warning** — if GPR is selected and the training set exceeds 2,000 rows, a warning is included in the train response and surfaced as `showWarning` in the UI.
- **Error codes for training** — `NO_CLEAN_DATA` (422), `DESIGNATION_REQUIRED` (422), `CONFIG_REQUIRED` (422), `NO_TRAINED_MODEL` (404).
- **27 new tests** — 17 unit tests (`test_models.py`: fit/predict/get_summary for each model, multi-output, source-not-mutated, predict-before-fit, `compute_metrics` happy path and errors); 10 integration tests for `POST /api/model/train` and `GET /api/model/results` (error cases + happy paths + STATE safety + audit event + multi-output). 3 end-to-end tests in `test_full_workflow.py` (linear full pipeline, RF full pipeline, normalised-data selection). **Total: 154 tests (65 unit, 89 integration).**

#### Changed

- `model_config.js` — `onConfigure` callback renamed to `onTrain`; `initModelConfig` now accepts `onTrain(results)` called after successful training.
- `main.js` — imports `initResults`; adds `resultsCard` to the exploration view; `onTrain` reveals and populates `resultsCard`; on re-render with existing designation, checks `GET /api/model/results` and shows results if a trained model exists.
- `app/api/model_api.py` — added `POST /api/model/train` and `GET /api/model/results` routes; imports `sklearn.model_selection.train_test_split`, `app.ml.models`, `app.ml.validation`.

---

## [0.6.0] — 2026-05-12

### Phase 2 — C-Series: Training Configuration (v0.6.0)

#### Added

- **Step 6 — Configure Training card (C1)** — appears in the exploration view after designation is confirmed (same trigger as Step 5 Normalization; normalization is optional and does not gate this step). New module: `static/js/modules/model_config.js`.
  - **Model type** — radio buttons with one-line descriptions: Gaussian Process (GPR), Random Forest, Linear (Ridge).
  - **Test split** — number input, 0.05–0.50, default 0.20.
  - **CV folds** — select: 3-fold / 5-fold / 10-fold, default 5.
  - **"Save Configuration"** → `POST /api/model/configure`. On success: shows `✓ Configuration saved` status and a note that model training is available in the next update. Pre-fills existing config on re-render.
  - Learning mode primers for all three controls.
- **`GET /api/model/config`** — returns current training config (`model_type`, `test_split`, `cv_folds`) from `state["surrogate_sessions"]["primary"]["config"]`. Returns defaults until first save.
- **`POST /api/model/configure`** — validates and saves training config. Validation: `model_type` in `["gpr", "rf", "linear"]`; `test_split` in [0.05, 0.50]; `cv_folds` integer in [2, 20]. Appends `model_configure` audit event. Error codes: `UNKNOWN_MODEL_TYPE`, `INVALID_TEST_SPLIT`, `INVALID_CV_FOLDS` (all 422).
- **`app/api/model_api.py`** — new blueprint registered at `/api/model`. Was a TODO stub.
- **STATE schema extended** — `state["surrogate_sessions"]["primary"]["config"]` added to `_CANONICAL_STATE` with defaults `{model_type: null, test_split: 0.20, cv_folds: 5}`.
- **New settings constants** — `SUPPORTED_MODEL_TYPES`, `TEST_SPLIT_MIN/MAX`, `CV_FOLDS_MIN/MAX`.
- **7 new integration tests** for `GET /api/model/config` and `POST /api/model/configure` (default state, happy path, persist check, three validation errors, audit event). Total: 127 (48 unit, 79 integration).

---

## [0.5.1] — 2026-05-12

### Phase 2 — Log-Transform Patch (v0.5.1)

#### Added

- **Log-transform card (B7)** — fourth cleaning card in Step 3. Displays columns with `|skew| > 1.0` (`LOG_TRANSFORM_SKEW_THRESHOLD`) as pre-checked checkboxes with their skew values. "Apply log-transform" button sends `POST /api/data/clean/transform` with the selected column list.
- **`POST /api/data/clean/transform`** — new endpoint in `app/api/data_api.py`. Accepts `{"columns": [...]}`, validates column names and rejects any column with values ≤ −1 (log1p undefined), applies `numpy.log1p` via `apply_log_transform()`, writes result via `_apply_clean()`, and appends a `cleaning_transform` audit event.
- **`apply_log_transform(df, columns)`** — new function in `app/data/cleaning.py`. Non-mutating; raises `ValueError` for unknown columns or values ≤ −1. Returns `(result_df, n_columns_transformed)`.
- **Skew in summary stats** — `GET /api/data/summary` now returns `skew` per column in each column's stats dict (both upload-time cache and post-cleaning live-compute paths). Requires ≥3 non-null values; `None` otherwise.
- **`LOG_TRANSFORM_SKEW_THRESHOLD = 1.0`** — added to `config/settings.py`.
- **11 new tests** — 5 unit tests for `apply_log_transform` (basic, source-not-mutated, zero-safe, negative-values-rejected, unknown-column); 6 integration tests for `/clean/transform` and skew-in-summary. Total test count: 120 (48 unit, 72 integration).

---

## [0.5.0] — 2026-05-12

### Phase 2 — B-Series: Data Cleaning (v0.5.0)

#### Added

- **Data cleaning section (B1)** — new "Step 3: Data Cleaning" card renders between the Exploration view and Column Designation. Displays actionable prompts: rows with missing values (count + %), duplicate rows detected, and IQR outlier rows detected. Counts sourced from `GET /api/data/summary` (extended response — no new round-trip). Recommended UI order: nulls → duplicates → outliers. New module: `static/js/modules/data_cleaning.js`.
- **Missing value handling (B2)** — `POST /api/data/clean/nulls` with `strategy`: `drop_rows` (removes any row with ≥1 null), `mean_impute` (fills each null with the column mean), `median_impute` (fills each null with the column median). Impute strategies preserve row count. `drop_rows` is rejected with 422 `INSUFFICIENT_ROWS` if result would have fewer than `MIN_ROWS` (5) rows.
- **Outlier treatment (B3)** — `POST /api/data/clean/outliers` with `strategy`: `keep` (flag only — no-op on the DataFrame), `drop_rows` (removes rows flagged as IQR outliers in any column). IQR multiplier is `IQR_OUTLIER_MULTIPLIER = 1.5` (from `settings.py`). NaN values are excluded from quartile computation via `dropna()` to avoid threshold distortion. `drop_rows` subject to same `MIN_ROWS` guard as null cleaning. Winsorize deferred to post-designation phase (would corrupt output columns if applied here).
- **Duplicate row removal (B4)** — `POST /api/data/clean/duplicates` removes exact duplicate rows using `pandas.DataFrame.drop_duplicates()`. Returns `rows_removed` count.
- **Cleaning reset (B5)** — `POST /api/data/clean/reset` restores `primary["clean"]` to a deep copy of `primary["raw"]` (undo all cleaning). Summary stats cache is invalidated so the next GET /api/data/summary reflects restored counts.
- **Audit trail (B6)** — all cleaning operations append timestamped events via `append_audit_event()`: `cleaning_nulls`, `cleaning_outliers`, `cleaning_duplicates`, `cleaning_reset`. Each event includes `dataset`, `strategy`, and before/after row counts.
- **`GET /api/data/summary` extended** — response now includes `cleaning_stats: { null_rows, duplicate_rows, outlier_rows }`. Computed from the live `primary["clean"]` DataFrame on every call (not cached, since cleaning changes these counts).
- **`app/data/cleaning.py` implemented** — was a TODO stub. Now provides: `compute_cleaning_stats()`, `handle_nulls()`, `handle_outliers()`, `remove_duplicates()`, and shared `_outlier_mask()` helper. All functions are non-mutating.
- **38 new tests** — 19 unit tests for `cleaning.py` (stats, null handling, outlier handling, deduplication — including source-not-mutated invariants); 19 integration tests for all cleaning endpoints plus audit trail. Total test count: 109 (43 unit, 66 integration).

#### Changed

- **Step renumbering** — Column Designation relabelled "Step 4" (was Step 3). Normalization relabelled "Step 5" (was Step 4). Data Cleaning is now Step 3.
- `config/settings.py` — added `IQR_OUTLIER_MULTIPLIER = 1.5`, `CLEANING_STRATEGIES_NULL`, `CLEANING_STRATEGIES_OUTLIER`. Version bumped to `0.5.0`.
- `app/api/data_api.py` — added `_no_data_error()`, `_get_active_ds()`, `_apply_clean()` private helpers to reduce duplication across cleaning routes. Added `UNKNOWN_STRATEGY` and `CLEAN_ERROR` to `_ERROR_HTTP_STATUS`.

---

## [0.4.0] — 2026-05-12

### Phase 2 — Core Data Preparation (v0.4.0)

#### Added

- **Column designation (A1)** — new "Step 3" section below stats. Renders a table of all columns with dtype, null %, and a radio-button role selector (Input / Output / Unused). "Quick-select" helpers available. `POST /api/data/designate` validates ≥1 input, ≥1 output, no overlap, valid column names; stores designation in `_datasets` metadata per-dataset. Designation is preserved on dataset switch. New module: `static/js/modules/column_designation.js`.
- **Correlation matrix (A2)** — `GET /api/data/correlate` computes Pearson correlation on `primary["clean"]` using `df.corr()`, caches result in `_datasets[key]["metadata"]["correlation_matrix"]`, and returns the matrix plus high-correlation pairs where `|r| ≥ 0.90` (`CORRELATION_WARNING_THRESHOLD`).
- **Normalization (A3)** — new "Step 4" section revealed after designation. Options: None (passthrough), Min-Max (scales inputs to [0, 1]), Z-Score (mean=0, std=1). Applied only to designated input columns; `primary["clean"]` is never mutated. `POST /api/data/normalize` writes `primary["normalized"]`; scaler params stored in `metadata.normalization_params` for Phase 4 inverse transform. `app/data/normalization.py` implemented (was a TODO stub). Dataset switch now mirrors `normalized` DataFrame to `primary["normalized"]`. New module: `static/js/modules/normalization.js`.
- **Audit trail (A4)** — `append_audit_event(state, event_type, detail)` added to `app/state/schema.py`. Respects `MAX_AUDIT_EVENTS = 1000` cap. Events captured at: upload, dataset switch, session reset, data-type confirm, column designation, normalization. Schema: `{timestamp (ISO 8601 UTC), event_type, detail}`.
- **Skew flag (A5 / P1)** — stats cards in the exploration view show an amber top-border (`stats-col-card--skew`) and amber skew value (`stat-pair__val--skew`) when `|skew| > 1`. Tooltip reads: "consider a log-transform before training". `_buildStatsSection` in `data_explorer.js`.
- **Classification selector (A6 / P4)** — `<select id="classification-select">` added to global header (label: "Class"). Options: Unclassified / CUI / ITAR / EAR. On change: `PUT /api/state/session { classification }` + success toast. Session-level; not affected by dataset switch. `PUT /api/state/session` already accepted `classification` — only frontend wiring was needed.
- **SPLOM column selector for >10-column datasets (A7 / P6)** — when a dataset has more than 10 columns, a collapsible checkbox panel appears above the scatter matrix. Users select up to 10 columns; SPLOM re-renders on change (same debounce pattern as plot settings). Selection stored in `_selectedCols` module-level state; cleared on dataset switch. Replaces the Phase 1 limitation notice.
- **17 new integration tests** — designate (happy path, no data, no inputs, no outputs, overlap, persisted in datasets endpoint); correlate (no data, after upload, cached); normalize (no data, no designation, minmax, zscore, unknown method); audit (upload, designation, normalization events).

#### Changed

- `GET /api/data/datasets` now returns `dtypes`, `input_columns`, `output_columns`, `normalization_method` per dataset — required by frontend to restore designation state on dataset switch.
- Upload response `metadata` now includes `dtypes`, `input_columns: []`, `output_columns: []`, `normalization_method: null` — consistent with the datasets endpoint shape.
- `PUT /api/state/session` dataset switch now mirrors `primary["normalized"]` in addition to `raw` and `clean`.
- `data_explorer.js` module vars reorganized: `_allColumns` and `_selectedCols` added alongside existing vars; `_buildColumnSelector` replaces the old "Column selector coming in Phase 2" limitation notice.

---

## [0.3.0] — 2026-05-12

### Phase 1 completion release

#### Added

- **Summary stats cached at upload time (R1)** — `POST /api/data/upload` now computes `min`, `max`, `mean`, `std`, `median`, and `null_count` for every column at ingest time and stores the result in `_datasets[key]["metadata"]["summary_stats"]`. `GET /api/data/summary` serves from this cache on every subsequent call, skipping pandas recomputation entirely. Falls back to live computation if the cache is absent (e.g., legacy datasets pre-v0.3.0).
- **Overwrite warning on same-filename upload (R5)** — if a file with the same `secure_filename()` is uploaded while one already exists in the session, an `eviction_warnings` entry is included in the upload response: `"'filename.csv' replaced an existing upload with the same filename."` The frontend surfaces this as an amber toast via the existing eviction-warning path.
- **Loading spinner in data exploration (R4)** — `initExploration` now calls `showSpinner(containerEl)` immediately after clearing the container, before the two async fetches (`/api/data/rows`, `/api/data/summary`). `hideSpinner` is called once both fetches resolve. Prevents a blank `#explore-section` during network flight.

#### Changed

- **`/api/data/rows` uses `primary["clean"]` (R2)** — previously read from `primary["raw"]`; now reads from `primary["clean"]`. `raw` and `clean` are identical today, but Phase 2 filtering/normalization will write to `clean` only. Aligned now at zero risk.
- **`_fullStats` moved to module-level block (R3)** — `let _fullStats = null;` relocated from the inline "Stats section" comment block to the top-of-module variable cluster alongside `_currentRows`, `_currentColumns`, `_outlierIndices`, `_showOutliers`, and `_chartEl`. Code organization only; no behavior change.
- **README updated to Phase 1 — v0.3.0 (R6)** — "What it does (Phase 1 — v0.2.1)" heading updated to `v0.3.0`.

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
