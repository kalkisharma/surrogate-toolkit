# Changelog

All notable changes to the Surrogate Modeling Toolkit are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## Milestone Map

| Milestone | Version | Phases | Theme | Status |
|---|---|---|---|---|
| **M1** | v1.0.0 | 1–5 | Full end-to-end surrogate workflow | ✅ Complete |
| **M2** | v2.0.0 | 6–11 | Advanced analysis & production readiness | ✅ Complete |
| **M3** | v3.0.0 | 12–16 | Teaching platform & advanced ML | ✅ Complete — Phases 12 & 13 delivered; 14, 15, 16 complete |
| **M4** | v4.0.0 | 17–25 | Team deployment, auth, HPC integration | 🔲 In progress — Phases 17–21 complete |

See `docs/PHASES.md` for full phase definitions.

---

## [3.5.64] — 2026-06-04

### Added — Input × Output scatter grid in Step 3 — Explore
- New **Input × Output Relationships** card after Column Distributions, before dCor heatmap
- `renderIOScatter()` in `charts.js` — scatter with optional linear regression trend line, hover tooltips, save/zoom/pan mode bar
- `_buildIOSection()` in `data_explorer.js`: grouped by output column, output chip tabs to show/hide groups, 3-col responsive grid, settings panel, placeholder when not yet designated, localStorage persistence, theme re-render

## [3.5.63] — 2026-06-04

### Fixed — Histogram mode bar with save-plot button
- `displayModeBar: "hover"` + `toImage`/zoom/pan/reset buttons on each histogram chart

## [3.5.62] — 2026-06-04

### Added — Column Distributions (Histograms) in Step 3 — Explore
- New **Column Distributions** card appears between Summary Statistics and the Distance Correlation heatmap
- `renderColumnHistogram(containerEl, vals, col, opts)` added to `charts.js` — single-column Plotly histogram with log₁₀ transform, mean-line overlay, and full theme awareness
- `_buildHistogramSection(containerEl, rows, columns)` in `data_explorer.js` — responsive 3-column grid (2-col at ≤1100px, 1-col at ≤640px) with:
  - Column chip selector (All / None + per-chip toggle)
  - Collapsible Plot Settings panel: Typography, Bars (color, opacity, edge, bins), Figure (height, plot/paper bg), Options (log transform, mean line)
  - Settings persisted in localStorage key `surrogate_data_histogram_settings`
  - Re-renders on theme toggle

---

## [3.5.61] — 2026-06-04

### Fixed — Subset commit/undo row count propagation
- **Panel subtitles**: after commit or undo, re-render the `filename — N rows × M cols` subtitle for every already-initialized panel so Steps 5, 6, and any other visited step immediately show the correct row count
- **Upload header**: update the `.upload-success__meta` span (top of page) with the new row count after commit/undo
- **Undo**: added `subset:undone` listener in `_initSubsetPanel` (was missing entirely); undoing a subset now refreshes `meta.n_rows`, all panel subtitles, and marks `stepCompleted["subset"] = false` in the sidebar
- **404 on `/api/model/results`**: clarified this is expected probe behavior on page load (checks for in-memory model); handled gracefully by `if (resultsCheck.success && ...)` check; cosmetic console noise only

---

## [3.5.60] — 2026-06-04

### Fixed — Subset commit spinner crash
- `showSpinner` / `hideSpinner` expect a DOM element; code was passing a string `"Applying subset…"` causing a `TypeError: el.querySelector is not a function` that silently aborted the commit handler and left the button permanently disabled
- Fixed both commit and undo handlers to pass `card` (the panel card element)
- Fixed `hideSpinner()` call in the catch block that had no argument, causing a second uncaught rejection

---

## [3.5.59] — 2026-06-04

### Fixed — Subset commit robustness + scrollable filter grid
- **Commit handler**: wrapped POST call and success-path UI updates in `try/catch`; any unexpected exception now restores the button, hides the spinner, and shows an error in the status bar instead of leaving the UI stuck at "Committing…"
- **Diagnostic logging**: added `console.log("[Subset] POST response:", resp)` and `console.warn/error` calls so commit failures are visible in the browser DevTools console
- **Filter scroll**: filter section now wraps in a `.subset-filter-scroll` container (`max-height: 420px; overflow-y: auto`) so the chart stays in view while scrolling through many filter cards

---

## [3.5.58] — 2026-06-04

### Changed — Subset step full-width layout (v1.4.0)
- **Layout**: replaced two-column grid with full-width stacked layout — Plot Settings → chart → filter grid
- **Commit/Undo buttons**: now live in the title row (always visible at top of card, never below the fold)
- **Status bar**: immediately below title row so feedback is always visible without scrolling
- **Filter grid**: 3-column CSS grid replacing the old single-column filter list; responsive (2-col at ≤900px, 1-col at ≤600px)
- **Input/Output grouping**: filters separated into "Inputs (N)" and "Outputs (N)" sections when columns are designated; falls back to "Variables" before designation
- **CSS**: removed stale two-column grid rules (`.subset-main-grid`, `.subset-left-col`, `.subset-right-col`, `.subset-right-header`, `.subset-right-btngroup`, `.subset-filter-list`, `.subset-filter-row`, `.subset-action-row`); added `.subset-filter-grid`, `.subset-filter-card`, `.subset-filter-card--active`, `.subset-section-header`, `.subset-controls-row`, `.subset-title-left`, `.subset-title-right`

---

## [3.5.57] — 2026-06-04

### Changed — Subset step layout redesign
- **Commit button**: moved into sticky right column header (always visible beside chart); Undo adjacent; no more scrolling to reach them
- **Chart**: min-height 340px → 420px; right column 40/60 split gives chart substantially more width
- **Settings panel**: moved below chart in right column (full 60% width, better proportioned); max-height 320px scroll when expanded
- **Commit robustness**: try/catch wraps POST call — network errors now restore button and show clear status-bar message instead of leaving button permanently grayed
- **No-filter warning**: shown in status bar only (removed duplicate showWarning call)
- **Filter section**: left column only, scrolls independently of chart

## [3.5.56] — 2026-06-04

### Changed — Subset step UX overhaul
- **Layout**: two-column grid replaces single-column; filter list on left, live chart pinned sticky on right — chart stays visible while scrolling through filters
- **Settings panel**: replaced custom compact grid with full `chart-settings-panel` format matching Explore 2D Scatter (Title, Typography, Markers, Figure, Legend, Gridlines sections); settings controls scrollable via `max-height: 420px; overflow-y: auto`
- **Commit button**: loading state (`Committing…`, disabled) while POST is in flight; errors and warnings shown in prominent status bar below button (not toast-only)
- **Filter values**: font-size increased from `0.6875rem` to `0.75rem` for legibility
- **Sliders**: gap between lo/hi sliders increased from `3px` to `8px` to eliminate overlap
- **Status bar**: new `subset-status--error` and `subset-status--warn` variants with color-coded border/background

## [3.5.54] — 2026-06-03

### Added — Step 5: Subset

New workflow step between Clean (4) and Assign (now 6) that allows users to permanently filter the dataset by per-column value ranges before training.

#### Added

- **`app/api/data_api.py`** — Two new routes:
  - `POST /api/data/subset` — applies per-column `{lo, hi}` range conditions (AND logic) to the clean DataFrame using the `_apply_clean()` helper. Stores conditions in `metadata["subset_conditions"]` for traceability. Returns rows_before/after/removed and any zero-variance columns introduced by the slice.
  - `POST /api/data/subset/undo` — restores the clean DataFrame from the one-level undo snapshot (same mechanism as clean undo).
- **`static/js/modules/data_subset.js`** *(new)* — `initSubset(containerEl)` module:
  - Fetches summary (column min/max) and rows from existing endpoints.
  - Renders a per-column range filter grid (reuses `scatter2d-filter-*` CSS classes).
  - Live "Would keep N / M rows" counter computed client-side from slider state.
  - 2D scatter preview with axis selectors — included points at full opacity, excluded points at 12% opacity (same `renderDataScatter2D` used by Explore).
  - Commit button: POSTs narrowed conditions only (full-range columns omitted). Fires `subset:committed` event so main.js can invalidate Explore/Clean panels.
  - Undo button: calls undo endpoint and re-initialises the panel against the restored data.
- **`static/js/main.js`** — Inserted `"subset"` into `STEP_KEYS` between `"clean"` and `"designate"`. All downstream steps renumbered: Assign=6, Normalize=7, Filter=8, Model=9, Results=10, Predict=11, Optimize=12, Interpret=13, Sample=14, Compare=15, Export=16. Added `_initSubsetPanel()` wrapper and `subset:committed` handler that invalidates Explore/Clean panel cache.
- **`static/css/main.css`** — New `.subset-*` rule set (title row, row-count badge, status bar, filter section header, preview section, axis selectors, action row).

#### Changed (step renumbering)

- **`app/api/data_api.py`** — "Complete Step 5 — Assign first" → "Step 6".
- **`app/api/model_api.py`** — "Step 8 — Model" → "Step 9" in four error messages; "Steps 4–5" → "Steps 4–6"; "Step 5 for it" → "Step 6 for it".
- **`app/api/active_learning_api.py`** — "Step 8 — Model" → "Step 9".
- **`app/ml/export/bundle.py`** — "Step 8 — Model" → "Step 9".
- **`app/learning/exercises/*.json`** (11 files), **`app/learning/decision_trees/model_selection.json`** — All step-number references in exercise instruction text updated to match new numbering.

---

## [3.5.53] — 2026-06-03

### Full codebase team review — 6 fixes

#### Fixed

- **`charts.js`** — Removed dead `renderCorrelationHeatmap` export (Pearson heatmap replaced by `renderDCorHeatmap` in v3.5.52; old function was never deleted, risking accidental future import of the wrong heatmap).
- **`active_learning_api.py`, `model_api.py`** — Corrected step numbers in three API error messages that directed users to the wrong sidebar step after the Filter step was inserted as Step 7 in the 15-step workflow. Configure/Model is now Step 8; messages previously read Step 6 or Step 7.
- **`model_api.py`, `data_api.py`, `settings.py`** — Extracted two hardcoded `0.95` magic numbers into named constants in `settings.py`: `CI_CONFIDENCE = 0.95` (GPR uncertainty interval level) and `PCA_VARIANCE_THRESHOLD = 0.95` (auto n_components cumulative variance target). Both API files now import and use these constants.
- **`state_api.py`** — `PUT /api/state/session` now validates the `classification` field against `SUPPORTED_CLASSIFICATIONS` before writing to STATE, returning HTTP 400 `INVALID_CLASSIFICATION` for any value not in the list (e.g. `"SECRET"`). Previously any arbitrary string could be persisted and appear in the compliance banner and exported reports.
- **`bridge_correction.py`** — Added `predict_std()` to `BridgeCorrectionModel` returning zeros of the correct shape. Bridge correction has no mechanism for calibrated uncertainty, but the method was missing entirely — any downstream caller treating multi-fidelity models uniformly would have hit `AttributeError`. Zeros are explicit and safe.
- **`settings.py`** — Synced file header version comment from stale `3.5.48` to `3.5.52`.

#### Changed

- **`README.md`** — Corrected step count from 14 to 15; added missing Filter step (Step 7); updated step names and descriptions to match current sidebar (Explore now mentions distance correlation heatmap and 2D scatter; Results mentions NRMSE and timing); renumbered steps 8–15.
- **`main.js`** — Fixed stale panel count comment (8 → 15).

---

## [3.5.52] — 2026-06-03

### Q1–Q4 UX improvements: SPLOM label truncation, Results config additions, dCor in Filter, 2D scatter export filters

#### Changed

- **`charts.js`** — SPLOM label truncation (`_PALETTES` + `renderScatterMatrix`): max visible characters now computed as `Math.max(6, Math.round(110 / fontSize))` so that reducing font size through Plot Settings exposes more characters per label, and increasing font size constrains the label to prevent overflow. Previously the truncation was fixed at a constant regardless of font size.
- **`charts.js`** — Added 3 new marker palette entries to `_PALETTES`: **Purple / Gold** (`purpleGold`), **Indigo / Orange** (`indigoOrange`), and **Crimson / Cyan** (`crimsonCyan`), each with distinct light-mode and dark-mode rgba values. Palette selector now offers 6 choices.
- **`charts.js`** — `renderDataScatter2D()`: when `excluded.length > 0` and `filterRanges` is non-empty, a semi-transparent annotation box is added to the chart showing active filter ranges (one line per filtered column, toPrecision(4), JetBrains Mono font). Export filename gets a `_filtered` suffix and `scale: 2` is set in `toImageButtonOptions` so the exported PNG is double resolution. This makes filter context self-documenting in saved images.
- **`data_explorer.js`** — Palette `<select>` updated with three additional `<option>` elements for the new palettes.
- **`data_explorer.js`** — Distance Correlation heatmap default height changed from `null` (lazy-compute via `Math.max(320, cols * 48 + 100)`) to `500` px so the heatmap renders at a consistent, readable height on first load without waiting for the user to manually adjust.
- **`data_explorer.js`** — `_buildScatter2DSection()`: settings panel, axis selectors, per-column range filter sliders, and chart container with `renderDataScatter2D()` integration.
- **`model_api.py`** — Training response now includes: `n_jobs` (core count used), `n_restarts` (GPR optimizer restarts, if applicable), `cv_time_s` (CV wall time), `fit_time_s` (final fit wall time), `test_time_s` (test evaluation wall time).
- **`results.js`** — Model Configuration card: added "Cores" row (from `n_jobs`) and "Optimizer restarts" row (from `n_restarts`, only shown when present). CV results section: timing note `"CV time: N s"` added below table. Test set section: timing note `"Evaluation time: N s"` added below table.
- **`data_api.py`** — Screen endpoint (`/api/data/screen`) now returns `dcor_matrix` (distance correlation) instead of `correlation_matrix` (Pearson). Distance correlation captures non-linear dependence — more appropriate than Pearson for engineering physics data. The endpoint reuses the dCor matrix already cached in STATE from the Explore step; if absent (dataset loaded without an Explore pass), it computes inline on up to `MAX_PLOT_ROWS` rows and caches the result.
- **`input_screening.js`** — Import updated to `renderDCorHeatmap`; `_redrawCorrHeat()` now calls `renderDCorHeatmap` with `resp.dcor_matrix`. Section heading changed from "Correlation Matrix" to "Distance Correlation Matrix". The dCor heatmap chart already includes a built-in Plotly camera icon for PNG export.
- **`main.css`** — Added `.scatter2d-section` card styles.

---

## [3.5.51] — 2026-06-03

### Results tables aesthetic improvements (5-finding team review)

#### Changed

- **`results.js`** — Output column name font size raised from `text-xs` (12px) to `text-sm` (14px) to match the metric values in the same row; the column name is the primary identifier and should not be smaller than what it labels.
- **`results.js`** — Test set table RMSE column replaced by **NRMSE** (normalized RMSE = RMSE ÷ training output range), expressed as a percentage with green/amber/red badge (< 10% green, < 25% amber, ≥ 25% red). Gives users a scale-independent quality signal comparable to R².
- **`results.js`** — CV table RMSE and MAE values now wrapped in a neutral pill badge so all metric columns have consistent visual weight, matching the R² badge treatment.
- **`results.js`** — CV table column headers simplified from `"R² mean ± std"` / `"RMSE mean ± std"` / `"MAE mean ± std"` to `"R²"` / `"RMSE"` / `"MAE"`, matching the test set table. A caption note below the table reads "Values shown as mean ± std across CV folds."
- **`results.js`** — Added `_fmt()` adaptive number formatter: values in 0.001–9999 range keep 4 decimal places; values outside that range use `toExponential(2)` to avoid `0.0000` truncation or noisy large-number decimals. Applied to RMSE and MAE in both tables; R² retains `toFixed(4)`.
- **`main.css`** — Zebra striping updated to `var(--color-row-stripe)` (theme-aware). Row hover state added using `var(--color-row-hover)` (indigo tint, matching Results panel accent color).
- **`main.css`** — Added `.results-badge--neutral` and `.results-table-note` CSS classes.
- **`variables.css`** — Added `--color-row-stripe` and `--color-row-hover` tokens with light and dark mode values.
- **`model_api.py`** — `output_range` (training output max − min) added to each test metric dict so the frontend can compute NRMSE without an extra API call.

---

## [3.5.50] — 2026-06-03

### Fix: GPR tune endpoint still generating ConvergenceWarning via get_param_grid()

#### Fixed

- **`gpr_model.py`** — `get_param_grid()` was constructing RBF and Matern kernels without `length_scale_bounds`, so GridSearchCV (used by the Tune endpoint) still triggered ARD `ConvergenceWarning` on every kernel candidate that pushed a length scale to the sklearn default upper bound of `1e5`. Applied the same `length_scale_bounds=(1e-3, 1e10)` fix as v3.5.49, completing the fix across all three kernel construction sites (`fit()`, `build_estimator()`, `get_param_grid()`).

---

## [3.5.49] — 2026-06-03

### Fix: GPR ARD ConvergenceWarning — length_scale upper bound raised to 1e10

#### Fixed

- **`gpr_model.py`** — ARD length scale optimizer was hitting sklearn's default upper bound of `1e5`, generating `ConvergenceWarning` for every input dimension the optimizer identified as irrelevant to a given output. The warning is benign (the model still finds a good solution) but noisy and technically indicates the optimizer couldn't confirm convergence. Raised `length_scale_bounds` to `(1e-3, 1e10)` on all ARD kernels (RBF, Matern 1.5, Matern 2.5). At `1e10` no dimension hits the bound on any tested dataset, eliminating all warnings.

---

## [3.5.48] — 2026-06-03

### Fix: GPR multi-output fit slow at high core counts on Windows (threading backend)

#### Fixed

- **`gpr_model.py`** — `MultiOutputRegressor.fit()` now uses `joblib.parallel_backend("threading")` instead of the default loky (process) backend. On Windows, loky spawns a fresh Python worker process per output column, paying 2–3 s of import overhead per process before any GPR math begins. For a 4-output model the spawn cost alone reached ~9 s, making 16-core training 2.8× *slower* than single-core. Threads share the parent process's imports with zero spawn overhead; the actual GPR fit for 4 outputs now takes ~0.35 s regardless of core count.
- **`gpr_model.py`** — `effective_mor_jobs` is now capped to `min(n_jobs, n_outputs)` so no idle worker threads are spawned when the output count is smaller than the requested core count.

---

## [3.5.47] — 2026-06-03

### Fix: filter step state not fully saved or cleared on dataset switch

#### Fixed

- **`data_api.py`** — `removed_inputs`, `n_inputs`, and `n_outputs` were missing from the `workflow_meta` snapshot saved on dataset switch. Switching back to a previously filtered dataset lost which inputs had been dropped by the screen step.
- **`data_api.py`** — `removed_inputs`, `n_inputs`, and `n_outputs` were not explicitly reset when loading a brand-new dataset, leaving stale column names from the previous session visible in the filter panel.
- **`data_api.py`** — `_clear_surrogate()` (called inside `screen_apply` when the filter step invalidates the trained model) overwrote the entire `surrogate_session` dict with only `{models, config}`, discarding any `pca` and `workflow_meta` that had been saved during an earlier dataset switch. Now merges with `**existing` so those fields survive.

---

## [3.5.46] — 2026-06-03

### Full workflow state save/restore on dataset switch

#### Changed

- **`data_api.py`** — Dataset switch now saves and restores the complete surrogate workflow state per dataset: `models`, `config`, `pca`, and `workflow_meta` (input/output columns, removed inputs, normalization method, PCA applied flag, clean row count). Previously only `models` and `config` were saved, so designation, normalization, and filter/PCA progress were lost when switching away from a dataset and then back.

#### Fixed

- **`data_api.py`** — Loading a new primary dataset now explicitly resets all workflow fields (`input_columns`, `output_columns`, `removed_inputs`, `normalization_method`, `pca_applied`, `surrogate.pca`) so stale state from the previous dataset never contaminates the new one. Previously these fields were left in place because `primary["metadata"].update(ds_meta)` only sets keys present in the new dataset's metadata dict.

---

## [3.5.45] — 2026-06-03

### Fix: stale PCA state KeyError when training after loading a new dataset

#### Fixed

- **`model_api.py`** — When a session with PCA applied was followed by loading a new dataset (without clearing the session), the train route tried to compute `_orig_df[col].mean()` for columns in the old PCA's `original_inputs` that didn't exist in the new dataset, raising `KeyError`. Fix: validate that all `original_inputs` columns exist in `_orig_df` before treating `_pca_applied` as `True`; if any are missing the PCA block is skipped gracefully.

---

## [3.5.44] — 2026-06-03

### Fix: GPR training speed regression at Cores > 1 (single-output models)

#### Fixed

- **`gpr_model.py`** — `MultiOutputRegressor` parallelises across outputs only. Passing `n_jobs=16` for a single-output model caused joblib's loky backend to spawn 16 worker processes on Windows (each re-importing Python + sklearn), adding ~14 s of overhead to both the final fit and test evaluation. Fix: `effective_mor_jobs = min(self._n_jobs, n_outputs)`. Single-output GPR now always builds with `n_jobs=1` (in-process, no spawn overhead); multi-output GPR uses the user's Cores setting up to the number of outputs.

---

## [3.5.43] — 2026-06-02

### BLAS-aware parallel CV, cores recommendation, and n_rows_clean fixes

#### Added

- **`cross_validation.py`** — `_probe_threadpoolctl()`: cached probe that runs `threadpool_limits` inside a real worker thread and stores the result for the process lifetime. On Anaconda/Windows, `EnumProcessModuleEx` returns `None` for some DLL version strings during DLL enumeration inside joblib workers, causing `AttributeError`. The probe detects this and falls back to serial CV (serial with full BLAS is faster than 5 parallel workers × 16 uncontrolled BLAS threads = 80 threads on 16 cores).
- **`cross_validation.py`** — `_fit_fold()` now calls `fold_model.set_n_jobs(n_jobs_per_fold)` so each fold runs its own model single-threaded. `n_blas_limit = max(1, n_cpus // active_folds)` caps BLAS threads per fold when parallel is safe. `prefer="threads"` on `Parallel` avoids loky process-spawn overhead.
- **`base_model.py`** — `set_n_jobs(n)` no-op added to the base class so all subclasses inherit it safely.
- **`gpr_model.py`** / **`rf_model.py`** — `set_n_jobs(n)` overrides: GPR updates `self._n_jobs` (picked up when `MultiOutputRegressor` is built in `fit()`); RF calls `self._model.set_params(n_jobs=n)`.
- **`model_api.py`** — `_recommend_cores(state)`: computes `(n_cores, reason)` from model type, n_rows, cv_folds, n_outputs, and available processors. Returned in `get_config()` as `recommended_cores` / `recommended_cores_reason`.
- **`model_config.js`** — `_computeRecommendation()` and `_updateCoresPrompt()`: client-side cores card shows recommended cores, plain-English rationale, current setting, and an **Apply** button that writes the recommendation to the header cores input and fires `change` to persist it to session state.
- **`settings.py`** — `GPR_PARALLEL_ROW_THRESHOLD = 200`.
- **`main.css`** — `.cores-prompt__apply` button style.

#### Fixed

- **`cross_validation.py`** — `n_jobs` parameter added to `run_cross_validation` signature; `prefer="threads"` eliminated loky process-spawn overhead on parallel CV.
- **`model_api.py`** — `hp.get("n_restarts", 10)` → `hp.get("n_restarts", 2)` in `_make_model`.
- **`model_config.js`** — `HYPERPARAM_DEFAULTS.n_restarts` and all fallback literals changed from `10` → `2`; metadata path corrected from `datasets._datasets.${activeKey}.metadata` to `datasets.primary.metadata`; `refreshState()` added to `initModelConfig` `Promise.all` so the cores card reads current state on panel open.
- **`data_api.py`** — `_apply_clean()` now mirrors `n_rows_clean` to `state["datasets"]["primary"]["metadata"]` (was only written to the keyed dataset); same mirror added to undo handler and upload initialization.
- **`learning_api.py`** — `start_exercise()` initialises `primary.metadata.n_rows_clean` from `n_rows_original` when cleaning is skipped (exercises without a Clean step left it `None`, causing the cores card to show "0 rows").

---

## [3.5.42] — 2026-06-02

### Fix PCA state serialization + parallel CV thread backend

#### Fixed

- **`schema.py`** — `get_state_json_safe()` `_safe()` walker now handles NumPy arrays (`ndarray`) and scalar types (`integer`, `floating`, `bool_`) so PCA output (e.g., `input_means` stored as `np.ndarray`) serialises without `TypeError: Object of type ndarray is not JSON serializable`.
- **`cross_validation.py`** — `prefer="threads"` added to `joblib.Parallel`; eliminates loky worker-process spawning for CV folds (threads share the parent process's already-imported sklearn/numpy, avoiding repeated import overhead on Windows).

---

## [3.5.41] — 2026-06-02

### GPR training performance: parallel CV folds, lower n_restarts, train time metric

#### Changed

- **`cross_validation.py`** — `run_cross_validation` accepts `n_jobs` parameter; folds run in parallel via `joblib.Parallel` capped at `min(n_jobs, n_folds)` workers.
- **`gpr_model.py`** — `n_restarts` default lowered from `10` → `2`; reduces kernel optimizer restarts per fold from 10 to 2 (4× faster CV with minimal accuracy loss on well-conditioned datasets).
- **`model_api.py`** — `n_jobs` forwarded to `run_cross_validation`; `n_outputs` passed for future per-output parallelism.
- **`results.js`** — Training time displayed in the results panel header.

---

## [3.5.40] — 2026-06-02

### Fix dCor colorscale + Pearson heatmap height default

#### Fixed

- **`charts.js`** — `renderDCorHeatmap` and `renderCorrelationHeatmap`: replaced named Plotly colorscale strings (`"RdPu"`, `"Blues"`) with explicit `[[stop, color], ...]` arrays extracted from the vendored Plotly 2.35.2 build. Named strings are unsupported in the vendored JS build and rendered as the default colorscale.
- **`input_screening.js`** — `_corrHeatHeight` default set to `500` so the Pearson heatmap renders at a readable height on first load instead of the auto-scale formula.

---

## [3.5.39] — 2026-06-02

### Data explorer legend visibility + heatmap contrast fix + unified heatmap settings

#### Changed

- **`charts.js`** — `renderDataScatter2D`: legend `showlegend` always true for the "Included" trace (previously only shown when excluded points existed, causing the legend box to disappear on unfiltered data).
- **`input_screening.js`** — Pearson correlation heatmap now shares the full settings panel (font sizes, gridlines, bg colors) with the dCor heatmap via unified settings wiring.
- **`charts.js`** — `renderDCorHeatmap` and `renderCorrelationHeatmap` accept `titleFontSize` option for independent heatmap title sizing.

---

## [3.5.38] — 2026-06-02

### 2D scatter & dCor settings: title font, border/legend controls, heatmap font sizes

#### Added

- **`charts.js`** — `renderDataScatter2D`: `title`, `titlePosition`, `plotTitleFontSize`, `axisTitleFontSize`, `legendPosition`, `legendFontSize`, `legendBgColor`, `legendBorderColor`, `legendBorderWidth`, `plotBorderWidth`, `plotBorderColor` options.
- **`data_explorer.js`** — 2D scatter settings panel extended with Title, Legend, and Plot Border sections.

#### Fixed

- **`charts.js`** — dCor heatmap: axis tick font size and colorbar font size now use `tickFontSize` option correctly.

---

## [3.5.37] — 2026-06-02

### 2D scatter & dCor polish: filters below chart, title/legend, font limits

#### Changed

- **`data_explorer.js`** — 2D scatter section: filter panel moved below the chart (axis selectors → chart → filters); per-column filter cards use dual range sliders + number inputs with live sync; "Filters (N columns)" `<details>` element with active-count badge.
- **`charts.js`** — `renderDataScatter2D` accepts `title` and `legendPosition` options; hover templates show column name and value.
- **`main.css`** — Scatter2D filter panel, filter grid, filter item, badge, slider, and number input styles.

---

## [3.5.36] — 2026-06-02

### Data Exploration enhancements: 3 new palettes, dCor height 500 px, 2D scatter section

#### Added

- **`charts.js`** — Three new marker palettes in `_PALETTES`: `purpleGold`, `indigoOrange`, `crimsonCyan` (light and dark variants for each).
- **`charts.js`** — `renderDataScatter2D(containerEl, rows, opts)`: standalone 2D scatter with dual included/excluded traces, per-column range filter support, full layout options (font sizes, marker color/size/opacity, edge, gridlines, bg colors).
- **`data_explorer.js`** — Three new `<option>` elements in SPLOM settings palette selector: Purple / Gold, Indigo / Orange, Crimson / Cyan.
- **`data_explorer.js`** — `_buildScatter2DSection(containerEl, rows, columns)`: card section below the dCor heatmap with X/Y axis dropdowns, full settings panel (Typography, Markers, Figure, Gridlines), per-column range filter sliders that dim excluded points live, and `localStorage` settings persistence.
- **`main.css`** — `.scatter2d-section` card styles and all filter row/slider/badge styles.

#### Changed

- **`data_explorer.js`** — `_dcorHeight` default changed from `null` (auto-scale) to `500` so the distance correlation heatmap renders at a consistent height on first load.

---

## [3.5.35] — 2026-06-02

### PHASES.md — Phase 22 scoped (Per-Observation Noise) + milestone renumber

#### Added — PHASES.md

- **Phase 22 — Per-Observation Noise (Heteroscedastic Inputs)** — full scope defined across 5 sub-phases:
  - 22A: Ingestion & Schema — detect `_std`/`_err`/`_uncertainty` companion columns; prefix match against output column names; store σ² with zero floor; NaN substitution; add `error_columns` to state schema
  - 22B: Designate Panel — auto-label "Output Error"; allow demotion to "unused"; tooltip explaining 1σ assumption and internal squaring
  - 22C: Normalization — scale error columns by same factor as paired output (min-max: divide by range; z-score: divide by output std); no shift; division-by-zero guard
  - 22D: Model Training — GPR `alpha=noise_array` (rigorous); RF/Linear `sample_weight=1/σ²` normalized to max=1.0 (weighted approx); `noise_array is None` guard preserves all existing behavior
  - 22E: Display & Active Learning (independent) — "noise weighting active" indicator; mean σ sanity check; GPR uncertainty band note; HTML report section; coverage mode flags high-σ dense regions
- No new pip packages — sklearn natively supports `alpha=array` and `sample_weight`

#### Changed — PHASES.md

- Phase renumber: Auth → Phase 23 (v3.7.0), Sharing → Phase 24 (v3.8.0), HPC → Phase 25 (v4.0.0)
- Total phases: 24 → 25; M4 phases: 17–24 → 17–25
- Cross-phase dependency table updated for all renumbered phases
- New dependencies table updated: Phase 22 (none), Phase 23 (Flask-Login/bcrypt), Phase 25 (celery/redis)

---

## [3.5.34] — 2026-06-01

### Exercise fixes (ex_06–ex_10) + codebase header cleanup

#### Changed — Exercises

- **ex_06_pca_filter** — Added missing Clean skip step (step 3); renumbered steps to 11 total. All VIF and PCA content verified accurate.
- **ex_07_multifidelity** — Added Clean + Filter skip steps for both LF and HF datasets (4 new steps); corrected LF RF R² expectation from "0.90–0.94" to "0.95–0.98" (actual ≈ 0.97); renumbered to 15 total steps.
- **ex_08_model_selection** — Added Clean + Filter skip steps; renumbered to 10 total steps. All Linear/RF/GPR R² claims verified accurate (0.60 / 0.97 / 0.99).
- **ex_09_alpha_regularization** — Added Clean + Filter skip steps; corrected alpha baseline mean from 0.88 to 0.91; changed overfit demo from alpha=0.01 to alpha=0.001 (actual dramatic CV collapse only occurs at 0.001, not 0.01); updated quiz text and auto-tune expected range from 0.2–0.4 to 0.05–0.15; renumbered to 10 total steps.
- **ex_10_optimization** — Added Clean + Filter skip steps; updated configure step to recommend Auto-Tune or Matérn 2.5 with alpha=0.05 for cd (default RBF alpha=0.1 gives cd R²≈0.68; Matérn achieves 0.97); added cd recovery path to results step; renumbered to 10 total steps.

#### Changed — Codebase headers

- Replaced `kalki.j.sharma@lmco.com` with `kalkijsharma@gmail.com` across all 95 Python and Markdown files.
- Removed "Licensed for internal use by Lockheed Martin employees only." and "See LICENSE.md for full terms." lines from all file headers and `scripts/gen_stubs.py` template — no LICENSE.md exists and no LM affiliation applies.
- Updated `README.md` License section accordingly.

---

## [3.5.33] — 2026-06-01

### Sidebar "Workflow" group label for Steps 1–9

#### Added

- `main.js` — "Workflow" group divider inserted above Step 1 in the sidebar, matching the existing "Tools" divider above Step 10. Makes the two-tier sidebar structure (sequential pipeline vs. post-training tools) immediately readable.
- `main.css` — `.sidebar-group-divider--first` modifier removes the border-top and top margin so the Workflow label sits flush at the top of the step list without a floating separator line. Hidden automatically in collapsed sidebar via existing `.workflow-sidebar--collapsed .sidebar-group-label { display: none }` rule.

---

## [3.5.32] — 2026-06-01

### Exercise overlay: collapsible panel + toast repositioning

#### Added

- `learning_guide.js` — exercise overlay body (`instruction + quiz + nav`) wrapped in `.ex-overlay__body` div. Collapse button (▼/▲) added to the header; clicking toggles `.ex-overlay--collapsed` which hides the body, shrinking the panel to a thin title bar. `exercise-active` class added to `<body>` when overlay opens, removed when it closes (close button, Finish, or `resetExercise()`).
- `main.css` — `.ex-overlay__body`, `.ex-overlay__collapse`, `.ex-overlay--collapsed` styles. Collapsed state hides body and removes gap so only the header strip remains visible.
- `notifications.css` — `body.exercise-active #notification-container` override moves toasts to `top: var(--space-6); bottom: auto` (top-right) when exercise is active, eliminating the bottom-right stack collision with the exercise panel.

---

## [3.5.31] — 2026-06-01

### Extrapolation warning in prediction panel

#### Added

- `prediction.js` — inline extrapolation warning rendered below each input field when the typed value falls outside the training range. Amber for values within 10% of the range span beyond the boundary; red for values more than 10% beyond. Warning fires on every keystroke and on initial render. Uses existing `inputMins`/`inputMaxs` already returned by the results API.
- `main.css` — `.prediction-extrap-warn`, `.prediction-extrap-warn--amber`, `.prediction-extrap-warn--red` styles. `flex-wrap: wrap` added to `.prediction-input-row` so the warning spans the full row width below the input field.
- `ex_01_basic_gpr.json` step 9 instruction updated to reference the red warning that now actually appears.

#### Notes

- `EXTRAPOLATION_CAUTION_THRESHOLD` and `EXTRAPOLATION_WARNING_THRESHOLD` in `settings.py` were previously dead code; the 0.1 (10%) boundary is now used by the frontend. The 1.25 threshold is preserved in settings for a future server-side implementation.

---

## [3.5.30] — 2026-06-01

### Fix: RationalQuadratic kernel always isotropic in auto-tune

#### Fixed

- `gpr_model.py` v1.4.1 — `RationalQuadratic` kernel is now always constructed without `length_scale` (isotropic) in all three locations: `fit()`, `build_estimator()`, and `get_param_grid()`. ARD `RationalQuadratic(length_scale=np.ones(n_features))` causes a scipy optimizer bounds shape mismatch (`(2,) vs (3,)`) in older conda environments and was causing ~20/80 auto-tune fits to fail with `ValueError`.

---

## [3.5.29] — 2026-06-01

### PCE underdetermined training guard

#### Added

- `model_api.py` v3.1.0 — PCE training now validates that `n_train ≥ C(n_inputs + order, order)` (number of polynomial terms) before calling `model.fit()`. Returns `PCE_UNDERDETERMINED` (HTTP 422) with a clear message when the condition fails. Emits a caution warning when `n_train < 2 × n_terms` (fit is possible but potentially noise-sensitive).
- `math.comb` imported (stdlib, no new dependency).
- `PCE_UNDERDETERMINED` added to `_ERROR_HTTP_STATUS` map.

---

## [3.5.28] — 2026-06-01

### Merge Kriging into GPR — unified kernel selector

#### Changed

- **`gpr_model.py`** — GPR now supports four kernels: RBF (default), Matérn ν=1.5, Matérn ν=2.5, Rational Quadratic. All use ARD (one length scale per input). `get_param_grid()` includes all four kernels for auto-tune. `build_estimator()` and `fit()` both handle the `"rq"` kernel name.
- **`kriging_model.py`** — Reduced to a 2-line backward-compatibility alias (`KrigingModel = GPRModel`). Existing `.surrogate` project files that contain pickled `KrigingModel` instances load without `ImportError`.
- **`model_api.py`** v3.0.0 — `_make_model()` Kriging case removed; `_convert_best_params()` Kriging case merged into GPR (RQ detection now in GPR path); all `("gpr", "kriging")` tuple checks collapsed to `"gpr"`.
- **`bootstrap.py`** — `"kriging"` removed from `predict_std` dispatch tuple; `"co_kriging"` (Kennedy-O'Hagan) preserved.
- **`ensemble_model.py`** — `_create_component` Kriging case removed; old `"kriging"` type strings in ensemble configs map to `GPRModel` transparently via the alias.
- **`config/settings.py`** v3.5.28 — `"kriging"` removed from `SUPPORTED_MODEL_TYPES`.
- **`model_config.js`** — Kriging removed from model type selector, ensemble component list, and multi-fidelity LF base model selector. GPR description updated to mention all four kernels.

#### Content

- **`app/learning/models.json`** — Kriging entry removed; GPR entry updated with full kernel description and ARD mention.
- **`app/learning/glossary.json`** — Kriging, ARD, and Optimizer Restarts entries updated to reflect unified model.
- **`app/learning/decision_trees/model_selection.json`** — Four nodes updated: `very_small_rough` now recommends GPR Matérn 1.5; `medium_low_gpr`, `medium_low_smooth`, `medium_mid_gpr` updated to reference kernel selector rather than switching to Kriging.
- **`app/learning/decision_trees/kernel_selection.json`** — Restructured: GPR/Kriging branch removed; single smoothness question now covers all four kernels in one unified flow.
- **`exercises/ex_04_sensitivity.json`**, **`ex_08_model_selection.json`**, **`ex_10_optimization.json`** — "try Kriging" references updated to "switch GPR kernel".
- **`docs/CODEBASE_TOUR.md`** — Model list updated; `KrigingModel` removed as a separate entry.

---

## [3.5.27] — 2026-05-31

### ARD auto-tune fix + fitted kernel length scales in Results panel

#### Fixed

- `gpr_model.py` / `kriging_model.py` — `get_param_grid()` was generating isotropic (scalar) kernel instances while `fit()` used ARD (array) instances. Fixed: `build_estimator(n_features)` now stores `self._n_features`; `get_param_grid()` uses it to build ARD arrays matching what `fit()` produces. `RationalQuadratic` in Kriging auto-tune also updated to use ARD `length_scale` array.

#### Added

- `gpr_model.py` / `kriging_model.py` — `get_kernel_info()` returns fitted ARD length scales per input per output after training.
- `model_api.py` — Extracts `kernel_length_scales` from `get_kernel_info()` after GPR/Kriging training; included in results dict.
- `results.js` — ARD Kernel Length Scales card in Results metrics pane (GPR/Kriging only); sorted ascending so most influential input appears first.

---

## [3.5.26] — 2026-05-31

### Guide and exercise accuracy fixes + deterministic quiz shuffle

#### Fixed (content — commit 1)

- `ex_09` step 5: "Underfit the noise floor" → "Overfit the noise" (alpha=0.01 causes overfitting, not underfitting).
- `ex_08` step 8: "same RBF-equivalent kernel" → "default Matérn 2.5 kernel" (Kriging has no RBF option).
- `equations.json` Z-Score note: removed "Preferred for GPR"; added balanced note explaining both scaling methods work with GPR.
- `active_learning.json` EI formula: added minimization/maximization direction clarification.
- `models.json` RBF weakness: "Runge phenomenon" (wrong term) → "oscillation artifacts between training points"; `avoid_when` expanded with noise warning.
- `models.json` PCE strength: "Sobol sensitivity indices" → "first-order Sobol sensitivity indices (S₁)".
- `glossary.json` PCE: clarified to first-order Sobol indices (S₁) derived from polynomial coefficients.
- `ex_01` / `ex_07` step 2: added missing `keywords: []` field (absent key risked JS runtime error).

#### Added (commit 2)

- `learning_guide.js` — `_shuffleOptions()`: deterministic Fisher-Yates shuffle keyed on exercise ID + step number breaks "correct answer is always B" pattern without modifying 47 JSON files. Saved answers persist as original JSON indices; shuffle is stable on page reload.

---

## [3.5.25] — 2026-05-31

### Fix ex_10 R² thresholds for cl/cd ratio output

#### Fixed

- `ex_10` steps 4–5: `cl_cd` is a derived ratio (cl/cd) — small errors in the direct quantities compound in the quotient, making it harder to fit than `cl` or `cd`. Expected R² for `cl_cd` corrected to > 0.85 (steps 4) and fallback threshold lowered to R² < 0.80 (step 5).

---

## [3.5.24] — 2026-05-31

### Redesign ex_08 and ex_09 around demonstrable contrasts

#### Changed

- **ex_08** (renamed from `ex_08_kernel_comparison` → `ex_08_model_selection`): Retired GPR-RBF vs Matérn contrast (sklearn MLE compensation made R² gap < 0.02 and unreliable). New exercise uses gaussian-hill + linear response (y = 3·exp(−r²/1.5) + x₁ + 0.5·x₂; n=150; σ=0.08) giving stable contrast: Linear R²≈0.60, RF≈0.97, GPR≈0.99. New dataset: `model_comparison_2d.csv`.
- **ex_09** (renamed from `ex_09_hyperparameter_tuning` → `ex_09_alpha_regularization`): Old exercise broken (both kernels fit at R²=0.97; alpha=0.5 was catastrophic at R²=0.29). New exercise: alpha sweep on noisy experimental data (σ=0.25). New dataset: `alpha_noisy_2d.csv`.
- Deleted stale datasets: `kernel_oscillatory_2d.csv`, `hyperparameter_damped_2d.csv`.

---

## [3.5.23] — 2026-05-30

### Ex_08 dataset redesigned for clear kernel contrast

#### Changed

- `kernel_oscillatory_2d.csv` replaced: 200-row sin/cos dataset was too dense for kernel assumptions to engage (all models ~0.98–0.99 R²). New dataset: 80 rows, higher-frequency (sin(5x₁)+cos(4x₂)+0.3x₁x₂), where RBF over-smoothing is visible. Updated `ex_08` step instructions and quiz options to match.

---

## [3.5.22] — 2026-05-30

### Fix clear session not fully clearing

#### Fixed

- `main.js` — Settings dropdown, exercise overlay (`#ex-overlay`), and Learning Guide modal now explicitly closed on Clear Session. Previously the click-outside handler missed the settings button (it's inside the dropdown); the overlay and guide modal were not wired to the clear event.

---

## [3.5.21] — 2026-05-30

### Exercise audit + 3 new exercises + panel step number fixes

#### Fixed

- `model_config.js`, `prediction.js`, `optimization.js`, `comparison.js` — Panel step labels corrected to match router `STEP_NUMS` (e.g. "Step 7" → "Step 8 — Model").
- `ex_02`, `ex_05`, `ex_06`, `ex_07` — Missing `keywords` arrays added to relevant steps.

#### Added

- `ex_08_kernel_comparison.json` — GPR-RBF vs Matérn vs Kriging vs RBF surrogate on oscillatory 2D response; 8 steps.
- `ex_09_hyperparameter_tuning.json` — Diagnose S-curve residual pattern; fix via kernel guide; compare manual vs auto-tune; 7 steps.
- `ex_10_optimization.json` — Single and multi-objective optimization on 2-output aerodynamic dataset; Pareto front, knee point, constrained selection; 8 steps.
- New datasets: `kernel_oscillatory_2d.csv`, `hyperparameter_damped_2d.csv`, `aero_pareto_2d.csv`.

---

## [3.5.20] — 2026-05-30

### Active learning scatter coordinate space mismatch

#### Fixed

- `active_learning.js` — Non-PCA sessions were plotting normalized (0–1) training coordinates against denormalized (physical-scale) recommendations. Fixed: uses clean df for non-PCA and normalized df for PCA so both series share the same coordinate space.
- `active_learning.js` — "Loading scatter..." placeholder persisted below Plotly canvas after render; now explicitly removed before `Plotly.react`.

---

## [3.5.19] — 2026-05-30

### Active learning scatter + data_api crash fixes

#### Fixed

- `active_learning.js` — Scatter blank after PCA: stale `_axisX/_axisY` indices clamped to same value after input count shrank; now deduplicates at `_renderResults` entry. Training markers disappeared on axis change: `_cachedXTrain` moved to module level; axis callbacks call `_rerenderScatter` only when data is ready.
- `data_api.py` — `/api/data/rows` crash: `'or'` operator on DataFrame raises `ValueError`; replaced with explicit `is not None` guard.
- `ex_06` step 10: instruction and quiz updated to reflect that predict panel shows physical variable fields and applies PCA transform automatically.

---

## [3.5.18] — 2026-05-30

### Ex_06 quiz fix + auto-tune cores hint fix

#### Fixed

- `ex_06` step 9: Quiz question removed hardcoded R² values (0.91/0.89) that users' actual results may not match; reworded as a general comparison scenario.
- `model_config.js` — Auto-tune cores hint updated to reference the Cores prompt in the header instead of a generic instruction.

---

## [3.5.17] — 2026-05-30

### Fix auto-tune crash + specific cores recommendation

#### Fixed

- `model_api.py` / `gpr_model.py` / `kriging_model.py` — Auto-tune `TypeError` (None passed to GridSearchCV): GPR/Kriging build `self._model` lazily in `fit()` once `n_features` is known (ARD length-scale arrays require input count). Added `build_estimator(n_features)` to both models; `tune` endpoint calls it before `GridSearchCV` when the method exists.
- `model_config.js` — Auto-tune cores prompt now shows actual available core count (`avail`) rather than hardcoded "8–16 cores".

---

## [3.5.16] — 2026-05-29

### Keyword underline + click-to-define in exercise steps

#### Added

- `learning_guide.js` — `_annotateKeywords()` (TreeWalker text-node injection) underlines glossary terms in exercise step instructions and quiz text. Clicking a term opens a popover with the glossary definition and category. Popover dismissed on click-outside or Escape.
- `keywords[]` arrays added to relevant steps across all 7 exercises.
- `learning_mode.css` — `.kw-link`, `.kw-popover` styles.

---

## [3.5.15] — 2026-05-29

### Guide content audit + new guides

#### Fixed

- `models.json` — Stale "Intermediate/Expert mode" reference removed from Kriging entry.

#### Added

- `models.json` — Multi-Fidelity Surrogate and Ensemble Surrogate entries added.
- `glossary.json` — 6 new terms: Heteroscedasticity, UCB, Acquisition Function, ARD, Bayesian Optimization, Optimizer Restarts.
- `app/learning/optimization.json` — New Surrogate-Based Optimization topic (6 sections: single/multi-objective, Pareto front, constraints, cores, when not to optimize).
- `app/learning/decision_trees/kernel_selection.json` — Kernel & Hyperparameter Guide decision tree (kernel choice, n_restarts, alpha calibration for GPR and Kriging); wired into Topics nav and API route.

---

## [3.5.14] — 2026-05-29

### Expose n_restarts as editable hyperparameter for GPR/Kriging

#### Added

- `model_config.js` — n_restarts input (1–50) in GPR and Kriging hyperparameter panels; flows through `_collectHyperparams()` → API → `GaussianProcessRegressor(n_restarts_optimizer=...)`.

---

## [3.5.13] — 2026-05-29

### Fix GPR train crash + correct single-output cores prompt

#### Fixed

- `gpr_model.py` / `kriging_model.py` — Removed `n_jobs` from `GaussianProcessRegressor` constructor (sklearn GPR does not accept that argument — `TypeError` on train). Reverted to `n_jobs` on `MultiOutputRegressor` only, which is correct for multi-output parallelism.
- `model_config.js` — Single-output GPR/Kriging cores prompt corrected to "1 core — sklearn runs restarts sequentially; cores only help with multiple outputs".

---

## [3.5.12] — 2026-05-29

### Fix GPR/Kriging n_jobs + complete cores recommendations

#### Fixed

- `gpr_model.py` / `kriging_model.py` — Multi-output GPR: `n_jobs` on `MultiOutputRegressor` parallelises across outputs (correct); each internal GPR uses `n_jobs=1` to avoid N×10 process overcommit.
- `model_config.js` — Cores recommendations added for auto-tune (GridSearchCV), Compare All Models, Train Ensemble, and Train Multi-Fidelity sections.

---

## [3.5.11] — 2026-05-28

### Retire experience levels + Cores to header with contextual prompts

#### Changed

- Experience level selector (Beginner/Intermediate/Expert) removed from header and all CSS gates retired; all features now visible to all users.
- Cores input moved to global header (always visible). Contextual cores prompt appears below the hyperparameter panel, specific to the selected model type and output count.

---

## [3.5.10] — 2026-05-30

### Active learning coverage scatter fixes

#### Fixed

- `active_learning.js` — `X_train` now cached in module closure so axis-selector re-renders retain all training dots and preserve the full coordinate range.
- `active_learning.js` — Last coverage result restored on panel re-init so recommendation markers persist after navigating away and returning.
- `active_learning.js` — Loading placeholder shown while scatter data fetches; prevents blank chart flash.
- `main.css` — `.al-scatter-loading` style added.

---

## [3.5.9] — 2026-05-30

### PCA visibility in results panel + predict NameError fix

#### Fixed

- `prediction_api.py` — NameError `'input_cols'` → `'user_cols'` in audit event after PCA predict refactor.

#### Added

- `results.js` — PCA info banner in Results metrics tab: lists original input column names and component count retained. Model Configuration card shows "Preprocessing: PCA — N components."
- `main.css` — `.results-pca-notice` banner style (matches predict panel banner).

---

## [3.5.8] — 2026-05-30

### Fix active learning scatter collapse after PCA

#### Fixed

- `data_api.py` — Added `?source=working` query parameter to `GET /api/data/rows`. When `source=working`, the endpoint returns the normalized + PCA-transformed DataFrame instead of the raw clean DataFrame. After PCA apply, `input_columns` contain PC names that are not present in the clean DataFrame, so training points were collapsing to (0,0). Active learning scatter now requests `?source=working` to align training-point coordinates with recommendation coordinates, which are also in PC space.
- `active_learning.js` — `_fetchTrainAndRenderScatter` uses `?source=working` parameter.

---

## [3.5.7] — 2026-05-30

### Predict panel uses original physical inputs after PCA

#### Fixed / Changed

- `prediction_api.py` — After PCA apply, the Predict panel previously exposed PC1/PC2/PC3 fields with no physical meaning to the engineer. Now `_get_predict_cols()` detects `pca_applied`; `_pca_transform_row()` / `_pca_transform_df()` apply normalization + PCA internally. Engineers enter original column names (velocity, mach, span…); the backend handles the full transform chain automatically.
- `model_api.py` — Results dict extended with `pca_applied`, `pca_original_inputs`, `pca_original_input_means`, `pca_original_input_mins`, `pca_original_input_maxs` (all from the unnormalized clean DataFrame).
- `prediction.js` — Uses `pca_original_inputs` when `pca_applied`; shows a PCA notice banner; adds training-range tooltip to each input field.
- `main.css` — `.prediction-pca-notice` banner style.

---

## [3.5.6] — 2026-05-30

### Exercise 6 fixes + PCA input_means KeyError

#### Fixed

- `model_api.py` `POST /api/model/train` — `input_means` was reading from `_clean` (original columns) instead of the current working DataFrame. After PCA apply, the working DataFrame has PC columns; reading from `_clean` raised `KeyError 'PC1'`. Fixed to read from `df` (PCA-transformed).
- `pca_correlated_6d.csv` — Regenerated: `aspect_ratio = 2.5 × span + noise` so VIF for span/AR is ~20; velocity/mach dynamic_q group yields VIF > 1000. Previous generation had insufficient correlation structure.
- `ex_06_pca_filter.json` — Quiz values corrected to match regenerated dataset (VIF ≈ 145 → 40, PCA variance claim 94% → >99%).

---

## [3.5.5] — 2026-05-30

### Exercise 5 fixes — axis-change scatter bug + sparse R² warning

#### Fixed

- `active_learning.js` — X_train was not cached in the axis-selector closure; changing the scatter X-axis discarded training point data and collapsed all markers. `X_train` now captured once at load and reused on re-render.

#### Changed

- `ex_05_active_learning.json` step 4 — Instruction now explicitly warns that R² 0.4–0.7 is expected for a 50-row sparse dataset; prevents beginner confusion when the model appears to underperform.

---

## [3.5.4] — 2026-05-29

### Exercise 4 fixes + GPR/Kriging ARD kernels + n_jobs multi-output parallelism

#### Fixed

- `app/learning/datasets/ishigami_5d.csv` — Regenerated with 300-row Latin Hypercube sample (was 200 random uniform rows); range corrected to [−π, π] per the Ishigami function definition.
- `ex_04_sensitivity.json` — Quiz questions rewritten to remove forward references to steps not yet completed; R² acceptance threshold lowered to 0.85; OAT step wording clarified; answer indices A/C corrected to 1/3.

#### Added

- `gpr_model.py` / `kriging_model.py` — **ARD (Automatic Relevance Determination) kernels**: per-dimension length-scales are now built and fitted during `model.fit()`, allowing the GP to automatically down-weight uninformative inputs. `n_restarts_optimizer` raised to 10 for robust kernel optimization. `n_jobs` threaded through `MultiOutputRegressor` for parallel multi-output fitting.
- `model_api.py` — Passes `n_jobs` (from session Cores setting) to `GPRModel` and `KrigingModel` constructors.
- `state_api.py` — `GET /api/state/` response now includes `available_cores` (`os.cpu_count()`).
- `state.js` — `getAvailableCores()` exported; updated by `refreshState`.
- `main.js` — `_updateCoresDisplay()` reads server core count, shows "of N available" hint next to the Cores input.
- `charts.js` — OAT y-axis: `automargin`, `exponentformat="e"`, left margin 64px.

---

## [3.5.3] — 2026-05-29

### Learning Guide — Symbols tab, Equations tab, rich HTML rendering

#### Added

- **Symbols tab** in Learning Guide modal — `app/learning/symbols.json`; searchable reference table of Greek letters, math notation, subscripts/superscripts, and abbreviations. `GET /api/learning/symbols`.
- **Equations tab** in Learning Guide modal — `app/learning/equations.json`; 10 curated equations with HTML-rendered formulas, where-clauses, and engineering notes. `GET /api/learning/equations`.
- `learning_api.py` — Two new endpoints: `GET /api/learning/symbols`, `GET /api/learning/equations`.
- `learning_guide.js` — Two new tabs wired up; tab switcher extended; `_renderSymbols()` and `_renderEquations()` renderers added with live search for Symbols tab.
- `learning_mode.css` / `main.css` — Symbols table styles, Equations card styles, sub/sup/code inline styles for primer body.

#### Fixed

- Rich HTML rendering across all guide content: topic section bodies, glossary definitions, model descriptions, exercise instructions, and quiz content now render `<sub>`, `<sup>`, `<code>`, `<strong>` tags correctly instead of escaping them as plain text.
- Primer bullet alignment — `ul`, `li`, `p` spacing added to `.primer__body` so multi-paragraph primers no longer collapse to a single run-on block.

---

## [3.5.2] — 2026-05-29

### Normalize/train data-quality guards

#### Fixed

- `data_api.py` `POST /api/data/normalize` — NaN and Inf values in `sample_rows` are now sanitized to `null` before `jsonify`, preventing an "unreadable response (HTTP 200)" crash when the clean DataFrame contained infinite values from a log-transform on zero-valued columns.
- `model_api.py` `POST /api/model/train` — X and y arrays are validated for NaN/Inf before being passed to sklearn. Returns a 422 with a list of offending column names instead of an unhandled 500.

#### Added

- `normalization.js` — `onApplied` callback fires after a successful normalize response.
- `main.js` — `onApplied` wired to set `stepCompleted["normalize"]` and update `_currentNorm`, so the sidebar shows a green check immediately after normalization succeeds without requiring a page interaction.

---

## [3.5.1] — 2026-05-28

### Clean step — fix stale null counts in Assign + clarify Keep option

#### Fixed

- `main.js` — `onClean` handler now re-fetches `GET /api/data/summary` after any cleaning operation and syncs `meta.null_counts` and `meta.n_rows` on the active dataset. The Assign panel (column designation) was previously showing pre-cleaning null counts when the user navigated there after applying null imputation.

#### Changed

- `data_cleaning.js` — "Keep (flag only)" strategy description rewritten to clarify it is a no-op: outliers are already visible in the scatter matrix by default and no rows are dropped. Removes prior ambiguous wording that implied visual highlighting was applied.

---

## [3.5.0] — 2026-05-27

### Phase 21 (partial) — Clean panel: per-column null breakdown + outlier status line

#### Added

- `data_cleaning.js` — Null card now shows a per-column breakdown: which columns contain missing values and how many, so engineers know exactly where to focus before choosing a strategy.
- `data_cleaning.js` — Outlier card shows a live "N rows still flagged — click Apply to continue" status line after each drop, updating the checklist count in place without a full panel reload.
- `main.css` — `.clean-null-cols`, `.clean-outlier-status` styles.

---

## [3.4.9] — 2026-05-27

### Exercise 2 fixes + quiz/config card contrast

#### Fixed

- `ex_02_model_selection.json` step 2 — Scatter instruction rewritten; model type primer added before the quiz question.
- `ex_02_model_selection.json` step 5 — CV R² quiz rewritten to distinguish cross-validation R² from training R² (a common beginner confusion).
- `ex_02_model_selection.json` step 6 — "Configure" step name corrected to "Model"; quiz correct answer updated to GPR > RF > Linear (was incorrectly GPR ≈ RF).
- `main.css` — Quiz correct/incorrect colors darkened for light-mode contrast (`#15803d` / `#b91c1c`).
- `main.css` — Results configuration card uses surface background + border; was invisible in light mode.

---

## [3.4.8] — 2026-05-27

### Phase 21 — Exercise walkthrough polish & training guardrails

#### Added

- `results.js` — **Normalization warning banner**: yellow banner shown in Results when the trained model used raw (un-normalized) data. Message: "Normalization was not applied — results may be unreliable. Return to the Normalize step and click Apply, then retrain."
- `results.js` — **Model configuration summary card** alongside metrics: model type, kernel, alpha, test split fraction, k-fold count. Gives engineers an at-a-glance record of what they trained.

#### Changed

- `ex_01_basic_gpr.json` step 5 (Normalize) — Instruction rewritten in plain language: explains why Min-Max is chosen over Z-Score for bounded inputs; adds explicit "Click Apply before moving to the next step" prompt.
- `ex_01_basic_gpr.json` step 6 (Configure) — Beginner-friendly GPR preface added before the quiz: briefly explains what GPR is and why it suits smooth, low-sample datasets.
- `ex_01_basic_gpr.json` step 7 (Results) — Overfitting/underfitting defined inline in learning-mode primer.
- `notifications.css` — Light-mode toast variants added with high-contrast text on tinted backgrounds; green success toast text previously hard to read against the green background.
- `gpr_model.py` — `n_restarts_optimizer` raised from 0 to 5 to reduce degenerate kernel fits on training sets with complex structure.
- `docs/PHASES.md` — Phase 21 defined; Phases 22–24 (Authentication, Sharing, HPC) renumbered from 21–23.

---

## [3.4.7] — 2026-05-26

### Exercises tab — numbered cards, difficulty + topic filters

#### Added

- `learning_guide.js` — Exercise cards now show a two-digit number badge (`01`–`07`) so the intro text's "complete exercises 1–3 first" instruction is actionable.
- `learning_guide.js` — Filter bar above the exercise list: **Difficulty** row (All / Beginner / Intermediate chips) and **Topic** row (All + one chip per unique tag). Filters are AND-combined; hiding cards is client-side with no server round-trip.
- `learning_guide.js` — Each card footer now shows topic tag chips so the category is visible without opening the filter.
- `learning_guide.js` — `_titleCase` helper for display-formatting tag strings.
- `main.css` — `.ex-card__num`, `.ex-card__tags`, `.ex-card__tag`, `.ex-filter-bar`, `.ex-filter-row`, `.ex-filter-label`, `.ex-filter-chip`, `.ex-filter-chip--active` styles.
- `learning_api.py` `GET /api/learning/exercises` — `tags` array added to each exercise summary; sourced from new `tags` field in each exercise JSON.

#### Changed

- All 7 exercise JSON files — added `tags` field:
  - `ex_01`: `["full workflow", "GPR"]`
  - `ex_02`: `["model selection", "GPR", "Random Forest", "Linear"]`
  - `ex_03`: `["data cleaning"]`
  - `ex_04`: `["sensitivity analysis"]`
  - `ex_05`: `["active learning"]`
  - `ex_06`: `["input filtering", "PCA"]`
  - `ex_07`: `["multi-fidelity"]`

---

## [3.4.6] — 2026-05-26

### Interpret OAT fix + Residual-Guided Active Learning

#### Fixed

- `model_api.py` `POST /api/model/interpret` — OAT response curves (one-at-a-time sensitivity) now show original-space input values on the x-axis. `OATAnalyzer` operates on normalized `X_train` and previously returned `x`, `median`, `min`, and `max` fields in normalized space; these are now denormalized via `_denorm_value` immediately after the analyzer call before the payload is returned to the client.

#### Added

- `app/ml/active_learning/residual_mode.py` — New `ResidualRecommender` class. Scores Latin Hypercube candidates by `Σ_t |residual_t| · exp(−‖c − t‖² / 2h²)` where `h` is the median pairwise distance between test points. Greedy selection picks high-score candidates in descending order, skipping near-duplicates. Works for all model types (no uncertainty estimate required).
- `active_learning_api.py` `POST /api/active/residual` — New endpoint for residual-guided mode. Reads `test_inputs`, `test_actuals`, and `test_predictions` from stored results, computes per-test-point absolute residuals for the selected `output_col`, and calls `ResidualRecommender`. Denormalized via `_denorm_recommendations` before response.
- `active_learning.js` — New **Residual** tab in Step 13. Always enabled (unlike Objective which requires GPR/RF). Output selector lets user choose which output column's residuals to target. History labels, results subtitle, and learning primer updated for residual mode.

---

## [3.4.5] — 2026-05-26

### Optimization + Active Learning — original-space values throughout

#### Fixed

- `optimization_api.py` — Input bounds table now shows physical (pre-normalization) units. `_default_bounds` reads from the clean DataFrame instead of the normalized results dict. User-supplied bounds are converted to normalized space before passing to `differential_evolution` / NSGA-II, then results are denormalized: `best_inputs` (single-objective) and `pareto_inputs` (multi-objective) are now in original space.
- `active_learning_api.py` — Recommendation coordinates for both Coverage and Objective modes are now denormalized to original space before the response is returned. The scatter's training data already came from `/api/data/rows` (clean df) so this aligns the two data sources.
- `model_api.py` `GET /api/model/results` — augmented with `input_orig_mins` and `input_orig_maxs` fields (original-space bounds from clean DataFrame). Existing `input_mins`/`input_maxs` (normalized) are preserved for backward compatibility.

#### Changed

- `optimization.js` — bounds table defaults now use `input_orig_mins`/`input_orig_maxs` with fallback to `input_mins`/`input_maxs` for pre-v3.4.5 sessions.
- `optimization_api.py` — Added `_denorm_value`, `_norm_value`, `_get_norm_context` helpers.
- `active_learning_api.py` — Added `_denorm_recommendations` helper.

---

## [3.4.4] — 2026-05-26

### Explore tab — original-space input values

#### Changed

- `model_api.py` `GET /api/model/explore/scatter` — input column values in `rows` are now **denormalized to original space** before being sent to the client. `input_mins` and `input_maxs` are now read from the clean (pre-normalization) DataFrame instead of the results dict, so range filter sliders always display the physical units the user uploaded.
- `model_api.py` `POST /api/model/explore/contour` — `fixed_inputs` values are now expected in original space; the backend applies the forward normalization transform internally before building the prediction grid. Returned `x_vals` and `y_vals` are in original space so contour axis labels show physical units. The residual interpolation path (scipy griddata) remains in normalized space for consistency with stored `test_inputs`.

#### Added

- `model_api.py` — three helper functions near the Design Space Explorer section: `_denorm_value(v, col, params)`, `_norm_value(v, col, params)`, `_original_bounds(input_cols, state)`. All explorer routes use these instead of inline arithmetic.

---

## [3.4.3] — 2026-05-26

### Explore tab — independent plot settings, residual Y/output options, fixed colorscales

#### Added

- `results.js` — Scatter and Contour plots each have their **own independent** Plot Settings panel (`_buildScatterSettingsPanel` prefix `ss-`, `_buildContourSettingsPanel` prefix `ct-`), stored in separate localStorage keys (`surrogate_scatter_settings`, `surrogate_contour_settings`). Panels are placed directly within each chart section.
- Scatter **Y axis** dropdown now includes `{col} — residual` options alongside raw output columns, enabling single-trace residual scatter plots without the actual/predicted overlay.
- Contour **Output** dropdown now includes `{col} — residual` options. Backend `explore_contour` handles residual columns via `scipy.interpolate.griddata` on test-set residuals (actual − predicted), interpolated onto the 2D contour grid.
- `charts.js` — `_COLORSCALES` map: explicit `[[stop, "rgb(...)"], ...]` arrays for Viridis, Plasma, RdBu, Inferno, and Hot, bypassing Plotly's case-sensitive internal name lookup. Resolves Plasma/Inferno/RdBu showing wrong colors.
- Scatter color options simplified: removed `__actual` and `__predicted` keys; retained only `{col} — residual` + all input columns.

#### Changed

- Typography font size upper limits doubled in **all** plot settings panels (Metrics `rs-`, Scatter `ss-`, Contour `ct-`): label font max 20 → 40, tick font max 16 → 32.
- `charts.js` `renderScatterExplorer` — dual/single-trace logic unified: if `yCol` has `__actual` key in data it shows actual+predicted overlay; otherwise renders single trace using `r[yCol]` directly (supports residual columns).
- `charts.js` both renderers now set `autocolorscale: false` and resolve colorscale through `_COLORSCALES` lookup before passing to Plotly.

---

## [3.4.2] — 2026-05-26

### Explore tab — Plot Settings panel + theme-aware colorbar fix

#### Added

- `results.js` Explore tab: full **Plot Settings** `<details>` panel (typography, marker size/opacity/edge, scatter/contour height, plot/paper background, major/minor gridlines) — mirrors the SPLOM settings panel in Step 3 — Explore.
- Module-level `theme:changed` listener in `results.js` re-renders Metrics parity plots and Explore scatter/contour immediately on light/dark toggle, fixing stale colorbar and axis label colors.

#### Changed

- `charts.js` `renderScatterExplorer` — extended `opts` to accept the full settings object (fontSize, tickFontSize, fontColor, markerSize, opacity, edgeWidth/edgeColor, height, plotBgColor, paperBgColor, showMajorGrid/Color/Opacity, showMinorGrid/Color/Opacity). Hardcoded defaults remain the same.
- `charts.js` `renderContourExplorer` — same settings extension; `colorscale` is now part of `opts` (string backward compat preserved).

---

## [3.4.1] — 2026-05-26

### Phase 20 — Design Space Explorer

#### Added

- `GET /api/model/explore/scatter` — returns test-set rows with actual values, model predictions, and residuals for all input/output columns. Response is flat row-oriented JSON keyed as `{col}`, `{col}__actual`, `{col}__predicted`, `{col}__residual`.
- `POST /api/model/explore/contour` — accepts `{x_col, y_col, output_col, fixed_inputs, n_grid}`; generates an N×N meshgrid, calls `model.predict()`, returns `{x_vals, y_vals, z_grid}`. Grid resolution capped at 100. Fixed inputs default to midpoint of training range.
- `results.js` — "Metrics | Explore" tab bar added below the section header. Existing metrics/CV/parity content moved into Metrics pane. Explore pane lazy-initialises on first click.
- Explore tab — **Scatter view**: X (input), Y (output), Color (predicted/actual/residual/any input), colorscale selector, dual-handle min/max range filter per non-X input column. Both actual (circle) and predicted (cross) traces rendered; color applied to both.
- Explore tab — **Contour view**: X and Y (inputs), output column, grid resolution, colorscale selector, discrete-value slider per remaining input. Auto-regenerates 500 ms after any control change; spinner overlay shown during computation.
- `charts.js` — `renderScatterExplorer()` and `renderContourExplorer()` added. Both use `Plotly.react` for efficient in-place updates.
- `utils.js` — `debounce(fn, ms)` utility added.
- `main.css` — Results tab bar (`.results-tab-bar`, `.results-tab-btn`), explore section layout, filter grid, range slider, fixed slider, chart wrapper, and spinner overlay styles added.
- `tests/unit/test_explore_api.py` — 22 new unit tests. Coverage: scatter 404 when no model, response structure, column keys, residual arithmetic, n_points/rows match, input_mins/maxs; contour 404/400 validation, grid shape at default/custom/capped N, z_grid float type, fixed_inputs affect output, multi-output. Test suite grows from 207 → 229.

---

## [3.4.0] — 2026-05-26

### Phase 19 — Model Export Bundle

#### Added

- `app/ml/export/bundle.py` — `build_export_bundle(state)` assembles a self-contained surrogate export ZIP in memory. Bundle contains: `model.joblib` (fitted surrogate), `pipeline.json` (input/output columns, normalization params, sklearn version, PCA flag), `pca.joblib` (only when PCA was applied in Step 7 — Filter), `surrogate.py` (ready-to-use Python wrapper with `predict(X_raw)`), and `README.txt` (column names, quick-start example, requirements).
- `POST /api/export/model` — new route in `export_api.py`. Builds the bundle, records the compliance audit entry, writes a `model_exported` audit event, and streams the ZIP as `application/zip`. Requires the same ITAR/EAR acknowledgment gate as the HTML report.
- `export.js` — "Download Model (.zip)" button added to Step 15 — Export alongside the existing "Generate Report" button. Button is disabled with tooltip if no trained model exists. Wires the same compliance acknowledgment flow as the report button.
- `tests/unit/test_export_bundle.py` — 21 new unit tests. Coverage: ValueError when no model, return type and filename format, required zip files, `pipeline.json` keys and values, `surrogate.py` valid Python, README column names, `predict()` shape and numerical correctness against direct model, wrong column count raises `ValueError`, DataFrame input with named columns, GPR and RF model types, PCA mode (pca.joblib present, original columns exposed, predict shape), no-norm passthrough. Test suite grows from 186 → 207.

#### Fixed

- `export.js` header and panel title showed stale "Step 13" (pre-Phase 18 number). Corrected to "Step 15".

---

## [3.3.2] — 2026-05-25

### Phase 8 plan review — code quality, test coverage, and dependency fixes

#### Fixed

- `interpretation.js` panel title and gate message referenced stale step numbers ("Step 11", "Step 7") left over from before Phase 18 inserted the Filter step. Corrected to "Step 12 — Model Interpretation" and "Step 8 — Model".
- `active_learning.js` same issue — both rendered h2 titles showed "Step 12" and gate message referenced "Step 7". Corrected to "Step 13 — Active Learning" and "Step 8 — Model".
- `model_api.py` interpret endpoint error message referenced "Step 7" for the same reason. Corrected to "Step 8 — Model".
- `data_api.py` had an unreachable `return jsonify(...)` block (dead code) after the `UNKNOWN_MODE` fallthrough in `apply_filter()`, and a redundant `import numpy as np` inside the `correlation_matrix` function body. Both removed.
- `global_sensitivity.py` used the deprecated `from SALib.sample import saltelli` import. The `saltelli` module was slated for removal before SALib 1.5.1 (our minimum pin); 1.5.2 was installed and still emitting 9 deprecation warnings per test run. Updated to `from SALib.sample import sobol as sobol_sample`.

#### Added

- `tests/unit/test_uncertainty.py` — 32 new unit tests for `SobolAnalyzer`, `OATAnalyzer`, and `compute_uncertainty`. Coverage includes: required return keys and types, n_evaluations formula, PCE analytical shortcut bypass, single-input edge case, OAT range and length contracts, constant-column edge case, GPR/RF/kriging CI shape and ordering, None/empty X_test guards, linear model returning null triple, multi-output index selection. Test suite grows from 154 → 186.

#### Removed

- `app/ml/uncertainty/intervals.py` — unimplemented stub with no callers. Created alongside `bootstrap.py` during scaffolding but never defined or used.

---

## [3.3.1] — 2026-05-25

### Parallel Processing — Cores setting wired up and documented

#### Fixed

- `GridSearchCV` in Auto-Tune was hardcoded to `n_jobs=-1` (all available cores), ignoring the session Cores setting and silently violating HPC head-node policies when users left the default value of 1. Now reads `session.processor_count` and passes it as `n_jobs`; default remains 1 (serial).
- RF training (`RandomForestRegressor`) similarly ignored the Cores setting; `n_jobs` is now threaded from the session through `_make_model` into `RFModel` so tree fitting runs in parallel when a user sets Cores > 1 on an allocated compute node.

#### Changed

- Settings dropdown now shows a three-line explanatory hint below the Cores input: what it parallelises, that 1 is the safe head-node default, and when to increase it.
- `RFModel.__init__` accepts an `n_jobs` parameter (default 1) instead of hardcoding.
- `_make_model()` accepts `n_jobs` and forwards it to `RFModel`.

---

## [3.3.0] — 2026-05-23

### Phase 18 — Input Filtering (completion) + Learning content expansion

#### Added

- **PCA sub-section** in Filter panel (collapsible `<details>`) — user picks `n_components`, previews explained-variance bar/line chart (`renderExplainedVarianceChart`), inspects per-component top-3 loadings table, then applies. Fitted PCA object stored in STATE; prediction and results steps operate in PC coordinate space after apply.
- **2 new synthetic datasets** in `app/learning/datasets/`:
  - `pca_correlated_6d.csv` — 150 rows; 6 aerodynamic inputs with two correlated groups (velocity/q/Mach, span/aspect_ratio); designed for VIF > 100 demonstration
  - `multifidelity_lf.csv` / `multifidelity_hf.csv` — 200/30 rows; 3-input polynomial + sinusoidal interaction term at different fidelity levels
- **2 new exercises** in `app/learning/exercises/`:
  - `ex_06_pca_filter.json` — 10 steps, intermediate; VIF identification + PCA apply + GPR on PC coordinates
  - `ex_07_multifidelity.json` — 11 steps, intermediate; LF/HF dataset pair, Bridge Correction in Compare step
- **3 new learning topics** in `app/learning/`:
  - `input_filtering.json` — 6 sections: why filter, Pearson r, VIF, low-variance, PCA, manual vs PCA decision guide
  - `multifidelity.json` — 6 sections: what is MF, when to use, Bridge Correction, Co-Kriging, dataset prep, results interpretation
  - `model_troubleshooting.json` — 6 sections: reading diagnostic signals, wrong model, insufficient data, high dimensionality, data quality, quick checklist
- **4 new glossary terms**: VIF, Multicollinearity, Principal Component Analysis, Explained Variance Ratio
- **New data_cleaning.json section**: "VIF — Catching Multicollinearity Pairwise Correlation Misses"
- **Multi-dataset exercise support** — `start_exercise` in `learning_api.py` ingests all `"datasets"` array entries on exercise start; secondary datasets appear in dataset switcher without changing active dataset
- Learning guide `_TOPICS` updated with `input_filtering`, `multifidelity`, `model_troubleshooting`

#### Fixed

- **`ValueError: The truth value of a DataFrame is ambiguous`** in `/api/data/screen` — four `or` patterns on DataFrames replaced with explicit `is not None` checks throughout `data_api.py`
- **Filter step staying locked after designation** — `stepUnlocked["screen"]` was missing from the designation callback block in `main.js`; added alongside the other step unlocks

---

## [3.2.0] — 2026-05-22

### Phase 18 — Input Filtering (core implementation)

#### Added

- **Step 7 — Filter** inserted between Normalize (Step 6) and Model (Step 8). All downstream steps renumber: Model→8, Results→9, Predict→10, Optimize→11, Interpret→12, Active→13, Compare→14, Export→15.
- **Correlation analysis** — Pearson |r| heatmap (`renderCorrelationHeatmap`) + flagged-pairs table; threshold slider (default 0.90); user selects which of each correlated pair to retain
- **VIF table** — Variance Inflation Factor for each input (inverse correlation matrix; OLS fallback for singular matrices). Three-tier coloring: ✓ < 5, ⚠ 5–10, ✗ ≥ 10 (pre-unchecked). Sorted by VIF descending. Optional Sobol Sₜ column when Phase 12 interpretation cache is present.
- **Low-variance flags** — inputs with coefficient of variation below threshold listed as drop candidates
- **Input toggle checkboxes** — full input list; corr-, low-var-, and VIF-flagged inputs pre-unchecked; user overrides freely. Flag tags (`corr`, `low-var`, `vif`) shown on each row.
- **Apply (columns mode)** — writes selected input set to STATE; clears surrogate session
- `POST /api/data/screen`, `POST /api/data/screen/pca`, `PUT /api/data/screen/apply` endpoints
- `input_screening.js` (~310 lines) — Filter panel module
- `model_selection.json` decision tree: hint added to medium-dataset node ("If you applied PCA in Step 7 — Filter, count PC components retained")
- `screen:applied` event in main.js updates `_currentInputCols` and clears downstream results

#### Changed

- Sidebar step label "Screen" → "Filter"; step renamed throughout codebase (`screen` key unchanged)
- Auto-selection permanently removed from scope — VIF/Sobol flags are suggestions only; engineer decides

---

## [3.1.0] — 2026-05-21

### Phase 17 — Guided Exercises (M4 Phase 1)

#### Added

- **5 synthetic datasets** in `app/learning/datasets/` — analytically generated with NumPy, no real program data:
  - `simple_quadratic.csv` — 100 rows, 2 inputs, smooth quadratic response (beginner exercise)
  - `nonlinear_response.csv` — 150 rows, 3 inputs, sin/cos nonlinearity (model selection exercise)
  - `dirty_data.csv` — 120 rows with 8 nulls, 3 outliers, skewed column (cleaning exercise)
  - `ishigami_5d.csv` — 200 rows, 5 inputs (3 active + 2 noise), classic Sobol benchmark (sensitivity exercise)
  - `sparse_4d.csv` — 50 rows, 4 inputs, Gaussian bump response (active learning exercise)

- **5 exercise JSON files** in `app/learning/exercises/` — step-by-step guided workflows with advisory quiz questions:
  - `ex_01_basic_gpr.json` — "Your First GPR Surrogate" — 8 steps, beginner, ~15 min
  - `ex_02_model_selection.json` — "Choosing the Right Model" — 7 steps, intermediate, ~20 min
  - `ex_03_data_cleaning.json` — "Cleaning a Messy Dataset" — 7 steps, beginner, ~15 min
  - `ex_04_sensitivity.json` — "Sensitivity Analysis — Ishigami Function" — 8 steps, intermediate, ~25 min
  - `ex_05_active_learning.json` — "Active Learning — Where to Sample Next" — 7 steps, intermediate, ~20 min

- **4 new API endpoints** in `app/api/learning_api.py`:
  - `GET /api/learning/exercises` — list exercises with metadata and per-session progress
  - `GET /api/learning/exercises/<id>` — full exercise definition (steps + quizzes)
  - `POST /api/learning/exercises/<id>/start` — auto-inject synthetic dataset via normal ingestion pipeline
  - `POST /api/learning/exercises/progress` — record step completion and quiz answer in STATE

- **Exercises tab** in Learning Guide modal (`static/js/modules/learning_guide.js`) — exercise cards with difficulty badge, estimated time, step progress, and status (not started / in progress / complete)

- **Exercise runner overlay** — floating card anchored bottom-right above the workflow. Shows step instruction, quiz card, navigation buttons, and step-progress dots. Dispatches `exercise:navigate` events to advance the panel router.

- **Advisory quiz component** — non-blocking: answer selection reveals correct/incorrect colour + explanation, "Next" button always available

- **`exercise_progress` key** in `STATE['session']` (`app/state/schema.py`) — dict keyed by exercise id, each entry stores `steps_completed`, `quiz_answers`, `started_at`, `completed_at`. Persists via Phase 7 save/load.

- **Exercise CSS** — `.ex-card`, `.ex-badge`, `.ex-overlay`, `.ex-quiz`, `.ex-dot` rules appended to `static/css/main.css`

- **`exercise:navigate` event listener** in `main.js` — advances the panel router when the exercise overlay requests a panel transition

#### Changed

- `app/state/schema.py` — added `exercise_progress: {}` to `_CANONICAL_STATE['session']`
- `app/api/learning_api.py` — added exercise endpoints; added `numpy`, `werkzeug`, `flask.current_app`, `request` imports; added serialisation helpers
- `static/js/modules/learning_guide.js` — fourth "Exercises" tab added; `post` import added; module-level `_activeExercise` state added

---

## [3.0.0] — 2026-05-19

### Phase 13A — Learning Content (M3 complete) (v3.0.0)

#### Added

- **10 learning content JSON files** in `app/learning/` — fully populated with expert-authored content:
  - `glossary.json` — 50 terms across 11 categories (Core Concepts, Model Types, Metrics, Diagnostics, Validation, Training, Data Preparation, Sensitivity Analysis, Active Learning, Optimization, Multi-Fidelity)
  - `models.json` — 7 model entries (GPR, Kriging, RF, RBF, PCE, Linear, Ensemble) with strengths, weaknesses, best-for, and avoid-when
  - `diagnostics.json` — R², RMSE, MAE, parity plot, residual plot, CV vs test metrics, GPR error bars
  - `uncertainty.json` — GPR native posterior, RF tree variance, Linear/RBF none, co-kriging, ensemble proxy, extrapolation
  - `cv_strategies.json` — why CV, k-fold, LOO, GPR-specific guidance, CV vs test score, multi-fidelity CV
  - `sensitivity.json` — Sobol variance decomposition, S₁/Sₜ interpretation, Saltelli sampling, OAT analysis, tornado chart, surrogate accuracy caveat
  - `active_learning.json` — space-filling vs goal-directed, LHS, EI acquisition, UCB, when active learning cannot help
  - `data_cleaning.json` — why clean, missing values, IQR outlier detection, log-transform, duplicates, correlation
  - `decision_trees/model_selection.json` — 16-node interactive guide walking through dataset size, dimensionality, smoothness, uncertainty needs
  - `decision_trees/cv_selection.json` — 12-node interactive guide for fold count selection by dataset size and model type
- **`app/api/learning_api.py`** — new Flask Blueprint at `/api/learning` with four read-only endpoints: `GET /glossary`, `GET /models`, `GET /content/<topic>`, `GET /guide/<guide_name>`
- **`static/js/modules/learning_guide.js`** — full learning guide modal (three tabs: Glossary with live search, Model Guide with collapsible cards, Topics with sidebar nav + section reader + interactive decision trees)
- **"? Guide" button** in global header (all experience levels) — opens the learning guide modal
- **Model selection decision tree** collapsible in Step 7 — Configure Training (Intermediate/Expert only, `level-intermediate-up` gate)

#### Changed

- `app/__init__.py` — registers `learning_api` Blueprint at `/api/learning`
- `app/templates/index.html` — "? Guide" button added to header nav
- `static/js/main.js` — imports `openGuide` from `learning_guide.js`; wires "? Guide" button click handler
- `static/js/modules/model_config.js` — imports `runDecisionTree`; adds collapsible guide section after model type selection
- `static/css/main.css` — learning guide modal styles (`.lg-*`), model guide toggle styles (`.model-guide-*`)
- `config/settings.py` — VERSION → `"3.0.0"`

---

## [2.4.0] — 2026-05-19

### Phase 12 — Experience Levels (v2.4.0)

#### Added

- **Experience level selector** fully enabled — Intermediate and Expert options are now live (previously labelled "(Phase 3)" and disabled).
- **`_applyExperienceLevel(level)`** in `main.js` — sets `data-experience` on `<body>` for CSS-driven conditional rendering; called on page load (restores from STATE) and on selector change.
- **CSS level gates** (`main.css`) — `.level-intermediate-up` hidden in Beginner; `.level-expert-only` hidden in Beginner and Intermediate; no JS logic scattered across modules.
- **Primer behaviour per level** — Intermediate: primers always visible (not dependent on learning mode toggle); Expert: primers and the Learning Mode button hidden entirely.
- **Rational Quadratic kernel option** for GPR in Intermediate and Expert mode (`model_config.js`).
- **GPR/Kriging small-dataset warning** — `train()` emits a warning when training set has < 30 rows for GP models.
- **Custom IQR multiplier** (Expert) — number input (0.5–5.0, default 1.5) in the outlier cleaning card; passed to `POST /api/data/clean/outliers`. Backend: `handle_outliers()` and `_outlier_mask()` in `cleaning.py` accept optional `iqr_multiplier`; `data_api.py` validates and clamps to [0.5, 5.0].
- **STATE JSON viewer** (Expert) — `{ }` button in global header opens a read-only modal showing the full serialised session STATE. Dismissed by clicking the overlay or the ✕ button.

#### Changed

- `app/templates/index.html` — level selector options enabled; STATE viewer button added.
- `config/settings.py` — VERSION → `"2.4.0"`.

---

## [2.3.1] — 2026-05-19

### Patch — Multi-Fidelity Bug Fixes (v2.3.1)

#### Fixed

- **F1 — cv_label mismatch** (`model_api.py`): `train_multifidelity` was setting `cv_label = "loo"` even for `co_kriging`, which always uses k-fold (capped at 5). `cv_label` now mirrors the splitter logic in `_mf_loo_r2()` — co_kriging always shows `{k}-fold`, bridge follows LOO/k-fold based on `n_hf ≤ 30`.
- **F2 — ρ clamp** (`kennedy_ohagan.py`): OLS estimate for ρ is now clamped to [0.01, 10.0] via `np.clip` to prevent degenerate predictions when LF and HF are poorly correlated. A warning is emitted in `train_multifidelity` if any ρ hits the boundary.
- **F3 — slow LOO warning** (`model_api.py`): `train_multifidelity` now emits a warning when `method == "bridge"` and the base model is a GP (`gpr` or `kriging`) and `n_hf > 10`, alerting the user that each CV fold refits the LF GP.

---

## [2.3.0] — 2026-05-19

### Phase 15 — Multi-Fidelity Modeling (v2.3.0)

#### Added

- **BridgeCorrectionModel** (`app/ml/multi_fidelity/bridge_correction.py`) — trains a LF surrogate on full LF data, then fits an RF error model on residuals (y_hf − LF_pred) at HF points. Final prediction = LF prediction + RF correction.
- **KOCoKrigingModel** (`app/ml/multi_fidelity/kennedy_ohagan.py`) — simplified Kennedy-O'Hagan co-kriging: f_hf = ρ·f_lf + δ, where ρ is estimated via OLS per output and δ is an independent GPR correction. Provides `predict_std()` for combined uncertainty propagation.
- **`POST /api/model/train_multifidelity`** — trains the selected MF model; validates matching input/output columns across LF/HF datasets; runs LOO-CV (n_hf ≤ 30) or k-fold comparison against HF-only RF baseline; stores in same STATE slot as any trained model.
- **`_mf_loo_r2()` / `_hf_only_loo_r2()`** — private helpers for multi-fidelity LOO/k-fold CV comparison. Bridge uses LOO when n_hf ≤ 30; K-O uses k-fold (capped at 5) due to GPR training cost.
- **Multi-Fidelity Training section** in Step 7 Configure Training — LF/HF dataset selectors (pre-filtered to datasets with designations), method dropdown (Bridge/Co-Kriging), LF surrogate type selector (bridge only), "Train Multi-Fidelity →" button.
- **Multi-Fidelity Comparison table** in Step 8 Training Results — shows MF R² vs HF-only RF R² side-by-side with improvement delta per output column.
- `app/ml/multi_fidelity/__init__.py` updated from stub.
- `app/ml/uncertainty/bootstrap.py` — `"co_kriging"` added alongside `"gpr"` and `"kriging"` for `predict_std()` path.
- Multi-fidelity CSS: `.mf-section`, `.mf-selector-row`, `.mf-comparison-table`, `.mf-improve--positive/negative`.

#### Changed

- `config/settings.py` — VERSION → `"2.3.0"`.

---

## [2.2.0] — 2026-05-19

### Phase 16 — Ensemble Surrogates (v2.2.0)

#### Added

- **EnsembleSurrogateModel** (`app/ml/ensemble/ensemble_model.py`) — wraps any combination of the 6 supported model types; three weighting strategies: `equal` (1/n), `cv_performance` (CV R² normalized), `stacking` (Ridge meta-model trained on OOF predictions). Failed components are excluded gracefully. `predict_std()` returns std across component predictions as a free uncertainty proxy.
- **`app/ml/ensemble/stacking.py`** — thin re-export wrapper for standalone stacking imports.
- **`POST /api/model/train_ensemble`** — trains an ensemble with user-selected components and strategy; stores result in the same STATE slot as any trained model; returns `ensemble_components`, `ensemble_weights`, `ensemble_cv_r2`, `ensemble_failed` alongside standard test metrics.
- **`renderEnsembleWeights()`** in `charts.js` — horizontal bar chart sorted by weight, gray bars for excluded components.
- **Ensemble Builder** section in Step 7 Configure Training — component checkboxes (GPR, Kriging, RF, RBF, PCE, Linear; at least 2 required), strategy dropdown, "Train Ensemble →" button, post-train status note.
- **Ensemble breakdown** section in Step 8 Training Results — weight chart + component table (weight %, CV R², active/excluded status); CV table suppressed for ensemble (replaced by breakdown).
- `app/ml/ensemble/__init__.py` updated; `app/ml/ensemble/stacking.py` created.

#### Changed

- `results.js` — `_buildEnsembleTable()` added; ensemble breakdown shown before test metrics for `model_type === "ensemble"`; standard CV section skipped for ensemble.
- `model_config.js` — Ensemble Builder section appended after Compare All Models.
- `main.css` — ensemble builder and results styles added.
- `config/settings.py` — VERSION → `"2.2.0"`.

---

## [2.1.0] — 2026-05-18

### Phase 14 — Advanced Surrogate Models (v2.1.0)

#### Added

- **KrigingModel** (`app/ml/models/kriging_model.py`) — sklearn GPR with Matérn ν=1.5, Matérn ν=2.5, or Rational Quadratic kernel; identical interface to GPRModel including `predict_std()` for native uncertainty. Auto-tune via GridSearchCV over all 3 kernels × 4 alpha values.
- **RBFModel** (`app/ml/models/rbf_model.py`) — `scipy.interpolate.RBFInterpolator`, one interpolator per output; kernels: thin-plate spline, multiquadric, inverse multiquadric, Gaussian, cubic. Exact interpolation at training points (smoothing=0) with regularization option. Auto-tune not supported.
- **PCEModel** (`app/ml/models/pce_model.py`) — Polynomial Chaos Expansion via `chaospy`; order 1–5; uniform distributions over training ranges; Legendre basis. `get_sensitivity()` returns exact analytical Sobol S1/ST indices — no Monte Carlo needed. Auto-tune not supported.
- **`POST /api/model/compare`** — trains all 6 model types with default hyperparameters on the same train/test split; returns side-by-side R², RMSE, MAE, and training time per output; does not change the trained model in STATE.
- **`renderModelComparisonTable()`** in `charts.js` — DOM table showing all model results with best R² highlighted in green.
- **Compare All Models** button in Step 7 Configure Training panel; calls `/api/model/compare` and renders comparison table inline.
- `chaospy>=4.3` added to `requirements.txt`.

#### Changed

- `SUPPORTED_MODEL_TYPES` in `config/settings.py` extended to `["gpr", "kriging", "rf", "rbf", "pce", "linear"]`.
- `model_config.js` — 3 new model type radio cards (Kriging, RBF, PCE) with matching hyperparameter sections; auto-tune disabled for RBF/PCE (shows "not available" note).
- `app/ml/uncertainty/bootstrap.py` — `compute_uncertainty()` now covers `"kriging"` alongside `"gpr"` (both have native `predict_std()`).
- `app/api/model_api.py` — `_make_model()` handles all 6 types; `tune()` guards for empty param_grid; `train()` computes `test_stds` for kriging; `_convert_best_params()` handles Kriging/RQ kernel.

#### Dependencies

- `chaospy>=4.3` (new) — PCE expansion and analytical sensitivity indices

---

## [1.6.0] — 2026-05-15

### Phase 10 — Multi-Dataset Comparison (v1.6.0)

#### Added

- **Step 13 — Compare** sidebar panel, unlocked after column designation; Export moves to Step 14.
- **`GET /api/comparison/status`** — lists all loaded datasets with their model type and whether a trained model exists.
- **`POST /api/comparison/run`** — LHS-samples the intersection of both models' input spaces, runs both surrogates on the same points, and returns: side-by-side test metrics (R², RMSE, MAE), per-output prediction arrays `y_a`/`y_b`, bias vectors `Δ = B − A`, and summary statistics (mean Δ, std Δ, % of mean A).
- **`POST /api/comparison/error_model`** — fits a `LinearRegression` to `Δ(output)` as a function of common inputs; reports R² and per-input coefficients. A high R² means bias is spatially structured.
- **`GET /api/comparison/results`** — returns the cached most-recent comparison without re-running.
- **Comparison scatter** (`renderComparisonScatter` in `charts.js`) — Model A vs Model B predictions on shared LHS inputs; 1:1 diagonal reference line.
- **Bias histogram** (`renderBiasHistogram` in `charts.js`) — distribution of Δ = B − A per output; mean shown as dotted line.
- **Test metrics table** — side-by-side R²/RMSE/MAE with green highlighting of the better-performing model.
- **Non-common input handling** — when models have different input sets, non-common inputs are held at their training median; only common inputs are varied in the LHS design.
- **`app/api/comparison_api.py`** — full implementation replacing the stub.
- **`static/js/modules/comparison.js`** — Step 13 panel module.
- Learning mode primer explaining metrics comparison, bias, and the error model.

#### Changed

- `app/__init__.py` — registered `comparison_api` blueprint at `/api/comparison`.
- `static/js/main.js` — "compare" registered as step 13; "export" renumbered to step 14; stepUnlocked/stepCompleted extended; unlock on designation; `_initComparePanel`.
- `static/js/charts.js` — added `renderComparisonScatter`, `renderBiasHistogram`.
- `static/css/main.css` — comparison panel styles.
- `config/settings.py` — VERSION → 1.6.0.

---

## [1.5.0] — 2026-05-15

### Phase 6 — Design Space Optimization (v1.5.0)

#### Added

- **Step 10 — Optimize** sidebar panel, unlocked after training results. Fills the gap between Predict (9) and Interpret (11).
- **Single-objective** (`POST /api/optimize/single`) — `scipy.optimize.differential_evolution` finds the input combination that minimizes or maximizes a chosen output. Supports per-input bounds (defaults to training range) and optional inequality constraints on other outputs. Flags high GPR uncertainty (> 10% of predicted value) at the optimum.
- **Multi-objective** (`POST /api/optimize/multi`) — NSGA-II via `pymoo` finds the Pareto front across two or more output objectives. Each objective can be independently set to minimize or maximize. Returns all non-dominated solutions.
- **`GET /api/optimize/history`** — last 5 optimization runs from STATE.
- **Pareto front chart** (`renderParetoFront` in `charts.js`) — Viridis-colored scatter of Pareto solutions; axis selectors when > 2 objectives.
- **Constraint rows** in single-objective UI — add/remove output inequality constraints (output col + ≤/≥ + threshold); violated constraints shown as warning chips on results.
- **`app/ml/optimization/single_objective.py`** — `SingleObjectiveOptimizer`.
- **`app/ml/optimization/multi_objective.py`** — `MultiObjectiveOptimizer` (NSGA-II); raises `ImportError` with install instructions if pymoo is missing.
- **`app/api/optimization_api.py`** — full single, multi, and history routes.
- Learning mode primer explaining objective functions, Pareto fronts, and the exploration/exploitation trade-off in engineering terms.

#### Changed

- `requirements.txt` — added `pymoo>=0.6.1`.
- `app/__init__.py` — registered `optimization_api` blueprint at `/api/optimize`.
- `static/js/main.js` — "optimize" registered as step 10 in STEP_KEYS/LABELS/NUMS; stepUnlocked/stepCompleted extended; unlock in two places; `_initOptimizePanel`.
- `static/js/charts.js` — added `renderParetoFront`.
- `config/settings.py` — VERSION → 1.5.0.

---

## [1.4.0] — 2026-05-15

### Phase 11 — Export & Compliance (v1.4.0)

#### Added

- **Step 13 — Export** sidebar panel, unlocked after column designation (so a dataset-only report is available even without a trained model).
- **`POST /api/export/report`** — generates a self-contained HTML analysis report. Sections included automatically based on completed workflow steps: dataset summary, column designation, normalization, model metrics + parity plots (Plotly-rendered), Sobol sensitivity table, active learning recommendations, and audit trail. Returns as a file download.
- **`GET /api/export/audit`** — downloads the export log as a CSV attachment.
- **`GET /api/export/log`** — returns the export log as JSON for the history table in the panel.
- **Classification watermark** — watermark banner at top and bottom of every generated report; ITAR/EAR banners use red styling; CUI uses blue; Unclassified uses green.
- **ITAR/EAR confirmation gate** — when ITAR or EAR classification is selected, the panel shows an explicit acknowledgment checkbox. The Generate button is disabled until checked.
- **Export history table** — last N exports shown with timestamp, filename, classification label, and truncated SHA-256 hash.
- **`app/compliance/classification.py`** — `requires_confirmation()`, `get_watermark_text()`, `get_banner_text()`, `CLASSIFICATION_GUIDANCE` dict.
- **`app/compliance/audit.py`** — `record_export()`, `set_file_hash()`, `get_export_log()`, `format_audit_csv()`.
- **`app/report/generator.py`** — `build_report_data()` collects all available STATE sections into a flat dict for the Jinja2 template. Handles missing sections gracefully.
- **`app/templates/report/report_base.html`** — Jinja2 template producing a professional standalone HTML report with embedded Plotly parity charts.

#### Changed

- `app/api/export_api.py` — added `POST /report`, `GET /audit`, `GET /log` routes; imports compliance and report modules; reads classification from `state["compliance"]["classification"]` (replacing Flask session cookie).
- `static/js/main.js` — Step 13 registered in STEP_KEYS/STEP_LABELS/STEP_NUMS (export=13); `export` unlocked in stepUnlocked at designation; `_initExportPanel` added; import `initExport`.
- `config/settings.py` — VERSION → 1.4.0.

---

## [1.3.0] — 2026-05-15

### Phase 9 — Active Learning (v1.3.0)

#### Added

- **Step 12 — Active** sidebar panel, unlocked after training results.
- **Coverage mode** (`POST /api/active/coverage`) — generates N space-filling recommendations using greedy max-min distance over a Latin Hypercube candidate pool (2,000 points). Selects points that maximise the minimum distance to any existing training sample.
- **Objective mode** (`POST /api/active/objective`) — acquisition-function guided recommendations using **Expected Improvement (EI)** or **Upper Confidence Bound (UCB)**; supports minimize/maximize direction; GPR/RF provide uncertainty, Linear falls back to prediction-only ranking.
- **`GET /api/active/history`** — returns stored active learning rounds (most recent first).
- **Design space scatter** (`renderDesignSpaceScatter`) — training samples (grey) + recommended points (purple stars, numbered); axis selectors when inputs > 2.
- **Recommendation table** — rank, all input values, score, predicted output + uncertainty (objective mode); Copy as CSV button.
- **History accordion** — last 5 rounds stored in STATE, shown collapsible below results.
- **`CoverageRecommender`** in `app/ml/active_learning/coverage_mode.py`.
- **`ObjectiveRecommender`** in `app/ml/active_learning/objective_mode.py`.
- **`app/api/active_learning_api.py`** — fully implemented with coverage, objective, and history routes.
- Objective tab disabled with explanatory label when model type is Linear (no uncertainty).
- Learning mode primer explaining space-filling, EI, UCB, and exploitation/exploration trade-off.

#### Changed

- `app/__init__.py` — registered `active_learning_api` blueprint at `/api/active`.
- `static/js/main.js` — Step 12 registered in STEP_KEYS/STEP_LABELS/STEP_NUMS; stepUnlocked/stepCompleted extended; unlock in two places; `_initActiveLearningPanel`.
- `static/js/charts.js` — added `renderDesignSpaceScatter`.

---

## [1.2.0] — 2026-05-14

### Phase 7 — Session Persistence (v1.2.0)

#### Added

- **💾 Save / 📂 Open buttons** in the global header — always visible, no step gating.
- **`.surrogate` file format** — ZIP archive containing:
  - `meta.json` — surrogate version, save date, classification, dataset names
  - `state.json` — full SESSION STATE with DataFrames replaced by `{"_ref": "..."}` path refs
  - `data/<name>.parquet` — DataFrames serialized as Parquet (efficient, type-preserving)
  - `models/<name>.pkl` — fitted surrogate model objects serialized with Pickle (protocol 4)
- **`POST /api/state/save`** — serializes STATE → returns `.surrogate` file as download.
- **`POST /api/state/load`** — accepts `.surrogate` upload → restores STATE in-place → frontend reloads.
- **`app/state/project.py`** — `write_project()` / `read_project()` serialization core.
- **`app/state/session.py`** — `save_session()` / `load_session()` thin wrappers.
- **`app/state/cleanup.py`** — `cleanup_temp_files()` removes stale `.surrogate` temp files.
- **Compliance acknowledgment modal** — shown before saving CUI sessions (informational); ITAR/EAR sessions require an explicit checkbox confirmation before the download proceeds.
- **Session restore on page load** — if STATE has datasets on boot (e.g. after project load + page reload), the exploration view is rendered automatically instead of the upload screen.
- **Unsaved-changes tracking** — `_hasUnsavedChanges` flag set on upload and training; `window.beforeunload` shows browser "Changes may not be saved" dialog if dirty.

#### Changed

- `static/js/main.js` — bootstrap IIFE checks `GET /api/data/datasets` on load and restores exploration view if datasets exist; Save/Open handlers wired in `_initGlobalHeader`; `_hasUnsavedChanges` marked dirty after upload and after training callback.
- `app/api/state_api.py` — two new routes: `POST /api/state/save`, `POST /api/state/load`.

---

## [1.1.0] — 2026-05-14

### Phase 8 — Model Interpretation (v1.1.0)

#### Added

- **Step 11 — Interpret** sidebar panel, unlocked after training results are available.
  - **Sobol global sensitivity** (SALib): Saltelli sampling + Sobol analysis yields S1 (first-order) and ST (total-order) indices per input column.  Tornado horizontal bar chart (ST + S1 overlay, sorted by ST descending) and an S1/ST/confidence table.
  - **OAT curves**: One-at-a-time response grid — each input varied min→max while all others are held at training-data median; dashed line marks the nominal value.  Grid sorted by ST descending for consistency with the tornado chart.
  - **Uncertainty section**: GPR → note pointing to parity-plot error bars in Step 8; RF → tree-variance 95% CI mean width on test set; Linear → explanatory note.
  - Output selector dropdown for multi-output models; per-output result caching in STATE (`models_dict["interpretation"][output_col]`); cache cleared on retrain.
- **GPR parity-plot error bars** — ±1.96σ error bars on parity scatter trace using native GPR posterior std.  `test_stds` (shape: n_test × n_outputs) stored in train results; `test_stds=null` for RF and Linear.
- **`GPRModel.predict_std(X)`** — returns posterior std from each `MultiOutputRegressor` estimator via `GaussianProcessRegressor.predict(X, return_std=True)`.
- **`SobolAnalyzer.analyze()`** in `app/ml/sensitivity/global_sensitivity.py`.
- **`OATAnalyzer.analyze()`** in `app/ml/sensitivity/one_at_a_time.py`.
- **`compute_uncertainty()`** in `app/ml/uncertainty/bootstrap.py`.
- **`POST /api/model/interpret`** — runs Sobol + OAT + uncertainty for a given output column; caches result per output.
- **`GET /api/model/interpret?output_col=X`** — returns cached interpretation result.
- **`test_inputs`**, **`test_stds`**, **`input_mins`**, **`input_maxs`** fields added to train results dict.
- **`renderTornadoChart`** and **`renderOATGrid`** exported from `static/js/charts.js`.
- **`static/js/modules/interpretation.js`** — new Step 11 module.
- **SALib>=1.5.1** added to `requirements.txt`.

#### Changed

- `static/js/charts.js`: `renderOutputFigure` now accepts `opts.stds` — when present, adds `error_y` Plotly error bars to the parity scatter trace.
- `static/js/modules/results.js`: `_rerenderPlots` and the per-output forEach loop now pass `stds` through to `renderOutputFigure`.
- `static/js/main.js`: STEP_KEYS/STEP_LABELS/STEP_NUMS extended for Step 11; stepUnlocked/stepCompleted initialised with `interpret`; `_initResultsPanel` unlocks interpret on results completion; initial page load check unlocks interpret if results exist.

---

## [1.0.1] — 2026-05-14

### Phase 4 close — GridSearchCV auto-tune (v1.0.1)

#### Added

- **Auto-tune with GridSearchCV** — "Auto-tune with GridSearchCV" checkbox in Step 7 — Configure Training.
  - When checked, manual hyperparameter fields collapse and Train runs a two-step flow: `POST /api/model/tune` first, then `POST /api/model/train`.
  - A "Best params found" card appears between the steps showing the winning combination and its mean CV R².
  - GPR searches 3 kernels × 4 alpha values (12 candidates). RF searches 3 estimator counts × 3 depths × 3 min-leaf values × 2 feature strategies (54 candidates). Linear searches 5 Ridge alpha values.
  - CV is capped at 5 folds during tuning for speed; any cv_folds value > 5 is silently clamped.
  - Best params are written to `config["hyperparams"]` so the subsequent `/train` call uses them automatically; `config["auto_tune_result"]` stores the full summary for audit purposes.
  - `model_autotune` audit event recorded.
  - Each model class now exposes `get_param_grid()` (abstract in `BaseSurrogateModel`).
  - `_convert_best_params()` helper converts sklearn `best_params_` (with `estimator__` prefixes and kernel objects) back to our string-based hyperparams dict.

#### Updated

- **`docs/PHASES.md`** — Phase 4 status → ✅ Complete; Phase 5 status → ✅ Complete (prediction was fully implemented in v1.0.0 but docs were stale); M1 milestone map → ✅ Complete.

---

## [1.0.0] — 2026-05-14 (patch 2)

### UX polish — SPLOM overflow, dCor heatmap, card order, gate badge (v1.0.0 patch 2)

#### Fixed

- **Upload gate "1" badge** — `_makeGate` now takes an optional number; passing `null` suppresses the circular step badge. The inline upload gate passes `null` since only one question is asked; the badge remains available for any future multi-step gate flow.
- **SPLOM overflows card bottom and right edge** — `chartInner` nested div separates the Plotly container from `explore-chart-wrap`'s card padding so height math is correct. `overflow: hidden` re-added safely now that `margin.b` fix (v0.9.10) keeps x-axis labels within the SVG. Two-frame `requestAnimationFrame` defers the initial `Plotly.newPlot` call until the browser has committed the container height, eliminating the first-load squish.
- **Clean tab card height disparity** — card order swapped: Missing Values → Duplicates → **Log-Transform** → **Outlier Rows**. The expandable outlier checklist card is now last so the three compact cards sit at the same height in the grid.

#### Improved

- **dCor heatmap readability** — default colorscale changed from Blues to **Viridis** (better perceptual contrast across 0→1). Annotation text color is now colorscale-aware: white text on dark cells, dark text on light cells (threshold direction inverts for Blues/Red-Purple vs Viridis/Thermal). Annotation font scales down gracefully for many columns (min 7 px), and auto-hides above 7 columns selected.
- **dCor column control** — chip row above the heatmap (reuses SPLOM `.col-chip` CSS) lets the user include or exclude any fetched column without triggering a new API call. "All" / "Clear" buttons included; minimum 2 columns enforced.
- **dCor plot settings** — collapsible settings panel below the chip row: font size, colorscale selector (Viridis / Blues / Thermal / Red-Purple), and annotation toggle (Show cell values checkbox).

---

## [1.0.0] — 2026-05-14

### M1 milestone — Distance Correlation Heatmap (v1.0.0)

#### Added

- **Distance Correlation Heatmap (Explore step)** — a collapsible "Distance Correlation Heatmap" section now appears below Summary Statistics in the Explore panel.
  - Rendered on first expand (lazy — no fetch on page load); shows "Computing…" while the server calculates.
  - Backend: new `app/data/stats.py` implements `_dcor(x, y)` (pure numpy, Székely/Rizzo double-centering, O(n²)) and `compute_dcor_matrix(df, cols)` (symmetric, rows aligned by dropping any NaN). New `GET /api/data/dcor` endpoint in `data_api.py` — caps at 2,000 rows and 12 columns, caches per-dataset in `metadata["dcor_matrix"]`, cache invalidated by any cleaning operation (`_apply_clean`).
  - Frontend: `renderDCorHeatmap(containerEl, columns, matrix, options)` in `charts.js` renders a Plotly annotated heatmap with Blues colorscale 0→1; annotation text color inverts to white for cells above 0.6 for legibility. `_buildDCorSection()` in `data_explorer.js` builds the `<details>` element with lazy toggle listener; reuses `_chartSettings` for font options. Truncation notice shown when row cap was applied.
  - Learning mode primer registered on summary element: explains dCor vs Pearson, what 0/1 mean, and tips for spotting input redundancy and predictive power.

#### Updated

- Milestone Map: **M1 is complete** — `v1.0.0` reached with hyperparameter tuning (v0.9.10) and dCor heatmap.

---

## [0.9.10] — 2026-05-14

### Hyperparameter tuning + UI polish (v0.9.10)

#### Fixed

- **Pair plot x-axis labels crowded at card bottom** — increased Plotly `margin.b` in `renderScatterMatrix` from `Math.max(50, tickFontSize × 6)` to `Math.max(72, tickFontSize × 8)`, giving x-axis dimension labels + tick marks the same breathing room as the left side. Also removed `overflow: hidden` from `.explore-chart-wrap` (added last batch to fix the background strip) which was clipping labels at the SVG edge — the real fix for that issue was the `min-height` removal, not `overflow: hidden`.
- **Outlier card stretching cleaning grid** — wrapped the per-column outlier checklist in a `<details>` collapsible element (`outlier-checklist-details`). The card now opens at the same compact height as the Missing Values and Duplicate Rows cards; the checklist expands on demand. Summary label shows "Columns (N with outliers)" count.

#### Added

- **Hyperparameter tuning** — each model type now exposes key hyperparameters in Step 7 — Configure Training:
  - **GPR:** kernel (RBF, Matérn ν=1.5, Matérn ν=2.5) and noise level (alpha, 0.0001–10).
  - **RF:** number of estimators (10–500), max depth (integer or unlimited toggle), min samples per leaf (1–20), max features (√n, log₂n, 50%).
  - **Linear (Ridge):** regularization strength (alpha, 0 = OLS, 1.0 = default Ridge).
  - "Reset to defaults" resets all hyperparameters for the current model. The hyperparameter section re-renders when the model type is changed.
  - `POST /api/model/configure` now accepts an optional `hyperparams` dict; stored in `config["hyperparams"]` in STATE. `POST /api/model/train` passes them to `_make_model`, which forwards to each model constructor. Hyperparameters are included in the stored results payload (`results["hyperparams"]`) and therefore in each run's full `runs` entry.
  - `GPRModel`, `RFModel`, and `LinearModel` constructors now accept explicit hyperparam arguments (with sensible defaults).
- **Box plot settings: Typography + Background** — normalization box plot settings panel now has Typography (font size, font color with Auto toggle) and Background (plot bg, paper bg with Auto toggles) sections, matching the explore SPLOM settings panel. `renderNormBoxPlots` in `charts.js` now uses `settings.fontSize`, `settings.fontColor`, `settings.plotBgColor`, and `settings.paperBgColor`.

---

## [0.9.9] — 2026-05-14

### UX polish batch — box plots, sample table, per-column outliers, undo, header, model history, cleaning grid, SPLOM overflow, run selector (v0.9.9)

#### Fixed

- **Box plots initial render squish (normalization)** — added `requestAnimationFrame` resize after `renderNormBoxPlots` in both the initial render path and `_rerenderBoxPlots`, matching the same fix applied to the SPLOM in v0.9.8.
- **Sample table unreadable with 5+ input columns** — `.norm-sample-grid > div` now has `overflow-x: auto` so each Before/After sub-table scrolls independently. Column headers and cells get `min-width: 80px` to prevent collapse.
- **Cleaning grid cards stretched by tall outlier card** — `.cleaning-grid` now has `align-items: start`. CSS grid was defaulting to `stretch`, causing the Missing Values and Duplicate Rows cards to expand to match the height of the taller Outlier Rows card (which grew with the new checklist). Each card now sizes to its own content.
- **SPLOM background extending past bottom of container** — `.explore-chart-wrap` had `min-height: 500px`, which overrode the JS-computed pixel height when the chart was shorter than 500px (e.g., 4 columns → 400px), leaving ~100px of empty surface-coloured background below the chart. Removed `min-height: 500px` and added `overflow: hidden`. The container now matches the JS-set height exactly.

#### Added

- **Per-parameter outlier removal** — the Outlier Rows card now shows a per-column checklist of IQR outlier counts (fetched from new `GET /api/data/clean/outlier_counts`). Columns with zero outliers are shown dimmed and unchecked. "Select All" / "Clear All" links. The `POST /api/data/clean/outliers` endpoint and `handle_outliers` service function both accept an optional `columns` list; omitting it preserves the original all-columns behaviour. `_recordOp` label includes selected column count.
- **One-level undo** — `_apply_clean` now snapshots `ds["clean"]` into `ds["clean_prev"]` before every cleaning operation (`save_prev=False` skips this on reset). New `POST /api/data/clean/undo` endpoint restores from `clean_prev` and deletes the snapshot. "↩ Undo Last" button appears in the cleaning summary card after any operation; clicking it restores the previous state, pops the last `_cleaningOps` entry, and triggers `onClean()` so the Explore SPLOM refreshes.
- **Header settings dropdown** — Level, Class, and Cores controls moved into a `⚙ Settings` popover dropdown, leaving only action buttons (Load File, Clear, Theme, Learning) in the header bar. Dropdown closes on outside click.
- **Results run selector** — each training run now stores its complete results payload in `models_dict["runs"]` (one entry per run, capped at `MAX_MODEL_HISTORY = 10`; full `results` dict plus `run` number). `GET /api/model/results` returns `"runs"` alongside `"results"`. When 2+ runs exist, a `Run:` selector dropdown appears at the top of the Results step; selecting a run re-renders the full view (metrics tables, parity plot, residual plot) for that run. The compact `<details>` history table is replaced by this full-fidelity selector.

---

## [0.9.8] — 2026-05-14

### Explore visualization fixes — SPLOM resize, stats legend, outlier counts, box plot layout (v0.9.8)

#### Fixed

- **SPLOM initial vertical squish** — `responsive: true` caused Plotly to re-measure the container before the browser had reflowed the panel. Added `requestAnimationFrame(() => Plotly.Plots.resize(chartWrap))` immediately after the initial `renderScatterMatrix` call so the resize runs after the first paint, giving the correct dimensions.
- **Box plots horizontally squished / data overlapping / whisker line overflowing** — `.norm-hist-grid` was a flex-wrap container; cells could collapse below 240px with many columns, causing Plotly to squish both box traces together. Switched to `display: grid` with `minmax(260px, 1fr)` columns so every cell is always at least 260px wide. Increased the Plotly right margin from `r: 4` to `r: 12` to prevent whisker lines from clipping at the cell edge.

#### Added

- **Stats legend line** — a small "orange top border = |skew| > 1 (skewed distribution — not outliers)" note now appears below the Summary Statistics header, resolving user confusion between the skewness warning and outlier detection.
- **Per-column IQR outlier count badge** — each stats card now shows an "N IQR outlier(s)" count below the secondary stats row when the column has outlier values (IQR ×1.5 rule). `_countColOutliers(vals)` computes this per-column, independent of the cross-column `detectOutliers` used for the scatter matrix overlay.
- **Stats primer updated** — the tooltip for "Reading the summary statistics" now explicitly describes the card border scheme including the orange top border for skewness.

---

## [0.9.7] — 2026-05-14

### UI polish — filename consistency, post-upload routing, step numbering, results table alignment (v0.9.7)

#### Fixed

- **Filename missing on 5 of 9 panels** — modules that call `clearEl(containerEl)` at startup were erasing the subtitle (`filename — rows × cols`) added by main.js before the module was invoked. Fixed by splitting each panel into a stable subtitle div + a content div. `_subtitle(key)` now writes to the subtitle div; modules can freely clearEl their content div without touching the subtitle. All 9 panels now show the filename consistently.
- **After upload, tool routed to Explore (Step 3) instead of Preview (Step 2)** — changed `activatePanel("explore")` → `activatePanel("preview")` in the initial render call.
- **Step numbering off by one (Steps 3–7)** — `STEP_NUMS` in main.js correctly defines Clean=4, Designate=5, Normalize=6, Configure=7. The module section titles were all one lower. Corrected in every module file. Preview and Explore panels also now show their step numbers ("Step 2 — Data Preview", "Step 3 — Data Exploration").
- **Results table columns misaligned across Test Set and CV tables** — without `table-layout: fixed`, each table sized columns independently (auto-layout), causing the stacked tables to be visually misaligned. Added `table-layout: fixed` with consistent column widths (32% output name, equal thirds for the three metric columns). Both tables now stack with pixel-accurate column alignment.

#### Files changed

- `static/js/main.js` — two-div panel structure; `_subtitle(key)` to stable subtitle area; all `_init*Panel` key param; post-upload routing fix; Preview/Explore step number titles
- `static/js/modules/data_explorer.js` — "Step 3 — Data Exploration"
- `static/js/modules/data_cleaning.js` — "Step 4 — Data Cleaning"
- `static/js/modules/column_designation.js` — "Step 5 — Column Designation"
- `static/js/modules/normalization.js` — "Step 6 — Normalization"
- `static/js/modules/model_config.js` — "Step 7 — Configure Training"
- `static/js/modules/results.js` — file header and cross-reference step numbers corrected
- `static/css/main.css` — `.results-table` fixed layout + column widths; `.results-col-name` overflow handling
- `config/settings.py` — VERSION bump
- `app/templates/index.html` — version references updated

---

## [0.9.6] — 2026-05-14

### Data verification — cleaning summary, box plot settings, sample table, CSV download (v0.9.6)

#### Added

- **Cumulative cleaning summary card** — after each cleaning operation (drop nulls, impute, remove duplicates, drop outliers, log-transform), a persistent card appears below the cleaning controls showing all operations with before/removed/after row counts and a bold totals row. Survives panel re-renders; clears on "Undo all". Download cleaned CSV button calls `GET /api/export/clean`.
- **Box plot settings panel** — a `<details>` settings panel appears above the normalization box plots with four controls: cell height (100–400px), opacity (range slider), show outlier points (checkbox), show mean diamond (checkbox). Settings persist to localStorage (`norm_box_settings`) and trigger an immediate re-render on change. Follows the same pattern as the SPLOM settings panel.
- **5-row sample value table in Normalize step** — after normalization, a side-by-side "Before / After" table shows the first 5 rows for all input columns (values rounded to 4 decimal places). Allows direct visual confirmation that values were transformed correctly. Input columns only — output columns are unaffected by normalization.
- **CSV download endpoints** — `GET /api/export/clean` and `GET /api/export/normalized` return the active dataset's cleaned or normalized DataFrame as an attachment. When classification is set to CUI/ITAR/EAR, a `# Classification: <level>` comment line is prepended as the first line of the file.

#### Files changed

- `static/js/modules/data_cleaning.js` — `_cleaningOps` accumulator; `_recordOp()` + `_renderCleaningSummary()` helpers; each handler updated to call `_recordOp`; reset handler clears ops; summary card appended to container
- `static/js/modules/normalization.js` — `_BOX_DEFAULT_SETTINGS` + localStorage loading; `_renderBoxSettingsPanel()`; `_renderSampleTable()`; download button; all module-level state for re-render on settings change
- `static/js/charts.js` — `renderNormBoxPlots` accepts `settings = {}` param; applies `cellHeight`, `opacity`, `boxpoints`, `boxmean`; opacity now baked into rgba color strings
- `app/api/data_api.py` — normalize response now includes `sample_rows: { before: [...], after: [...] }` (first 5 rows per input column)
- `app/api/export_api.py` — implemented `GET /api/export/clean` and `GET /api/export/normalized`; classification header prepended for non-Unclassified sessions
- `app/__init__.py` — `export_bp` registered at `/api/export`
- `static/css/main.css` — `.norm-sample-*` and `.cleaning-summary-*` styles added
- `config/settings.py` — VERSION bump
- `app/templates/index.html` — version references updated

---

## [0.9.5] — 2026-05-14

### Code review fixes — primer, NaN, escaping, active-dataset consistency (v0.9.5)

#### Fixed

- **Entry learning primer silently failing since v0.1** — `registerPrimer("entry", hero, ...)` was called before `app.appendChild(hero)`, so `hero.parentNode` was null and the primer insert was a no-op. Beginner-mode users on the upload page have never seen "New to surrogate modeling? Start here." Fixed by swapping the call order.
- **Normalize route always used primary dataset's clean DataFrame** — `clean_df = state["datasets"]["primary"]["clean"]` was hardcoded. If a secondary dataset was active, normalization operated on the wrong data. Changed to `ds["clean"]` (the already-resolved active dataset object).
- **NaN values passed through in box-plot payload** — `[v for v in col if v is not None]` does not filter `float('nan')` (pandas NaN). Changed to `col.dropna().tolist()`.
- **`meta.filename` injected unsanitised into innerHTML** — filenames containing `<`, `>`, or `&` would corrupt markup. Added `escHtml()` to `utils.js` and applied it at all four insertion points in `main.js`.

#### Changed

- `_renderInlineGate` — removed unused `app` parameter (left over from old `_renderGates` design).
- CHANGELOG milestone map updated: M1 now reflects Phase 5 complete; v1.0.0 pending hyperparameter tuning and dCor heatmap.

#### Files changed

- `static/js/utils.js` — new `escHtml()` export
- `static/js/main.js` — `escHtml` import + applied at 4 filename sites; entry primer after `appendChild`; `_renderInlineGate` signature cleanup
- `app/api/data_api.py` — normalize route uses `ds["clean"]`; NaN filter uses `dropna().tolist()`
- `docs/CHANGELOG.md` — milestone map corrected
- `config/settings.py` — VERSION bump

---

## [0.9.4] — 2026-05-14

### SPLOM overlap fix, normalization box plots (v0.9.4)

#### Fixed

- **SPLOM overlaps summary statistics on initial render** — `.explore-chart-wrap` CSS has `min-height: 500px`, which the browser used to position the stats section below the chart. Plotly then rendered an SVG taller than 500px inside the wrap, overflowing into the stats section until Plotly's responsive resize corrected it. Fix: `chartWrap.style.height = autoHeight + "px"` is now set explicitly before `renderScatterMatrix`, giving the browser the correct layout height from frame one. Same fix applied in `_rerender()` so height stays accurate when column selection changes.

#### Changed

- **Normalization visualization: histograms → box plots** — before/after histograms replaced with side-by-side vertical box plots (Before in blue, After in green) per input column. Box plots show median, quartile range, and whiskers — more compact and directly communicates scale change without requiring many bins to be readable.

#### Files changed

- `static/js/modules/data_explorer.js` — explicit height set on `chartWrap` before Plotly render; same in `_rerender()`
- `static/js/charts.js` — `renderNormHistograms` replaced by `renderNormBoxPlots`
- `static/js/modules/normalization.js` — updated import and call site
- `config/settings.py` — VERSION bump

---

## [0.9.3] — 2026-05-14

### Upload page polish, SPLOM resize fix, normalization histograms, R² contrast (v0.9.3)

#### Added

- **Before/after normalization histograms** — after applying normalization, the Normalize step renders a compact grid of Plotly histogram overlays (blue = before, green = after) for every input column. Shows distribution shape change at a glance; output columns omitted since they are unchanged. Backend returns column arrays (capped at 500 rows) in the normalize response.
- **Inline data-type gate** — after a successful upload the drop zone is replaced in-place with a compact success row (`✓ filename · N rows · M columns`) and the Step 2 data-type question, all within the same card. The gate no longer appends a separate section below the upload card, eliminating the scroll requirement on most screen sizes.
- **Gate option descriptors** — each data-type radio option now shows a brief plain-English descriptor below the label ("Deterministic runs — values repeat identically each time.", etc.).
- **Hero gradient background** — subtle `linear-gradient(180deg, accent-soft 0%, transparent 60%)` behind the hero section gives the entry page visual depth.
- **SVG upload icon** — replaces the 📁 emoji in the drop zone with a clean SVG cloud-upload arrow that scales correctly at any resolution and respects the accent color.

#### Fixed

- **Pair plot squished after navigating away from Explore** — Plotly's `responsive: true` mode could recalculate dimensions against a stale layout when the Explore panel transitioned from `display: none` back to visible. `activatePanel()` now calls `Plotly.Plots.resize()` on `#splom-container` whenever the Explore tab becomes active.
- **R² badge green too bright in light mode** — `.results-badge--green` text was `#22c55e` (~2.2:1 contrast on white). Light mode now uses `#15803d` (~4.6:1, passes WCAG AA). Dark mode retains the original bright green.

#### Changed

- Hero top/bottom padding reduced from 64 px (`--space-16`) to 40 px (`--space-10`).
- Upload zone vertical padding reduced from 64 px to 40 px.

#### Files changed

- `static/js/main.js` — `_renderInlineGate()` replaces `_renderGates()`; `activatePanel()` SPLOM resize; `_makeGate()` descriptor support; SVG upload icon
- `static/js/modules/normalization.js` — imports `renderNormHistograms`; renders histogram section after apply
- `static/js/charts.js` — new `renderNormHistograms()` export
- `static/css/main.css` — hero padding + gradient; upload zone padding + icon; `.upload-success` styles; `.gate-option__desc`; `.norm-hist-*` styles; `.results-badge--green` light-mode contrast fix
- `app/api/data_api.py` — normalize route returns `hist_data` + `input_columns`
- `config/settings.py` — VERSION bump

---

## [0.9.2] — 2026-05-14

### Bug fixes — normalization-prediction mismatch, dead code (v0.9.2)

#### Fixed

- **Prediction inputs not normalized before inference (critical)** — `prediction_api.py` was passing raw user inputs directly to `model.predict()`. If the user had applied minmax or zscore normalization before training, the model expected scaled values and predictions were systematically wrong. Added `_normalize_row()` (single-point) and `_normalize_df_cols()` (batch) helpers that read `normalization_method` and `normalization_params` from `state["datasets"]["primary"]["metadata"]` and apply the same per-column transform used during training before calling `model.predict()`. Sessions with no normalization are unaffected.
- **`input_means` shown in original data scale** — `input_means` was computed from `X_train` (already normalized). The prediction form now pre-fills with means from the clean (pre-normalization) DataFrame so users see their original data's scale. Normalization is applied transparently at inference time.
- **Dead code in `data_api.py`** — removed `clean_df = ds["raw"]` (line 796), which was immediately overwritten and never used.

#### Files changed

- `app/api/prediction_api.py` — `_normalize_row()`, `_normalize_df_cols()` helpers; both routes read normalization metadata and apply transform before prediction
- `app/api/model_api.py` — `input_means` now from clean DataFrame, not `X_train`
- `app/api/data_api.py` — dead assignment removed
- `config/settings.py` — VERSION bump

---

## [0.9.1] — 2026-05-14

### Prediction UX fixes — update feedback, mean defaults, reset button (v0.9.1)

#### Fixed

- **Prediction results don't update visually after first run** — replaced `clearEl + multi-step appendChild` with a single `spResults.innerHTML` assignment for atomic DOM update. Added a "Computing…" placeholder that appears immediately on click so the user sees the update cycle start, then resolves to the new result table when the response arrives.

#### Added

- **Input means as default values** — `input_means` dict (keyed by column name) is now computed from `X_train` during training (`X_train.mean(axis=0)`) and stored in the results dict. Prediction input fields are pre-filled with those means (4 significant figures) on first render.
- **Reset to means button** — "Reset to means" button beside "Run Prediction →" restores all input fields to their training-set mean values.

#### Files changed

- `app/api/model_api.py` — add `input_means` to results dict
- `static/js/modules/prediction.js` — mean defaults, reset button, Computing placeholder, innerHTML update
- `static/css/main.css` — `.prediction-btn-row`, `.prediction-computing`
- `config/settings.py` — VERSION bump

---

## [0.9.0] — 2026-05-14

### Phase 5 — Prediction & Inference (v0.9.0)

#### Added

- **Step 9 — Predict** — new sidebar step, unlocked after a model is trained. Two sections in one card:
  - **Single-point prediction** — input form with one numeric field per input column; "Run Prediction →" fires `POST /api/predict/single` and displays a results table with predicted output values.
  - **Batch prediction (CSV)** — file picker for an input-only CSV; "Run Batch Prediction →" fires `POST /api/predict/batch` and presents a "⬇ Download CSV" button. The downloaded file contains the original input columns plus predicted output columns. When the session classification is not Unclassified, a `# Classification: <label>` comment is prepended to the file.
- **`POST /api/predict/single`** — validates inputs against trained model's `input_columns`; returns `{ predictions: { col: float }, model_type }`.
- **`POST /api/predict/batch`** — accepts multipart CSV; validates required columns; returns JSON rows (frontend handles download). Handles: `NO_FILE`, `INVALID_CSV`, `MISSING_CSV_COLUMNS`, `NON_NUMERIC_CSV`.
- **Learning primers** — three primers: section-level ("What is prediction?"), single-point ("How do I use single-point prediction?"), batch ("How do I run batch prediction?").
- **Prediction CSS** — `.prediction-form`, `.prediction-input-row`, `.prediction-input-label`, `.prediction-input-field`, `.prediction-batch-row`, `.prediction-batch-filename`, `.prediction-code` in `main.css`.

#### Files changed

- `app/api/prediction_api.py` — full implementation (was stub)
- `static/js/modules/prediction.js` — full implementation (was stub)
- `app/__init__.py` — register prediction blueprint at `/api/predict`
- `static/js/main.js` — Step 9 in router; import `initPrediction`; unlock on training completion
- `static/css/main.css` — prediction UI styles
- `config/settings.py` — VERSION bump

---

## [0.8.11] — 2026-05-13

### Bug fix — Configure tab learning primers (v0.8.11)

#### Fixed

- **Test split and k-fold primers invisible** — `registerPrimer` was called on `splitLabelEl` and `cvLabelEl` before either element had been appended to a parent node. `registerPrimer` checks `anchorEl.parentNode` at entry and returns silently if null, so no dropdown was created. Same root cause as the v0.8.10 plot-render timing bug. Fixed by moving all three field-level `registerPrimer` calls to after their respective `appendChild` calls (`typeSection`, `splitSection`, `cvSection`).

#### Files changed

- `static/js/modules/model_config.js` — reordered `registerPrimer` calls after `appendChild` for model-type, test-split, and cv-folds labels
- `config/settings.py` — VERSION bump

---

## [0.8.10] — 2026-05-13

### Bug fixes — R² alignment, plot render timing, primer consolidation (v0.8.10)

#### Fixed

- **R² column alignment** — R² data cells were left-aligned (badge, no `results-metric` class) while the header was right-aligned. Added `.results-table td:not(:first-child) { text-align: right; }` so all non-name data cells match their headers.
- **Plots squished on initial render** — `renderOutputFigure()` was called before `containerEl.appendChild(plotSection)`, so Plotly measured a 0-height off-DOM container and compressed the figure. Moved the `appendChild` call to before the `forEach` loop; rerenders were already correct.
- **Log-transform primer consolidation** — removed the card-level `registerPrimer("cleaning_logtransform", ...)` added in v0.8.9 and merged the log-transform explanation into the existing section-level "Why clean data before training?" primer, where null, duplicates, and outliers are already covered.

#### Files changed

- `static/js/modules/results.js` — moved `containerEl.appendChild(plotSection)` before render loop
- `static/js/modules/data_cleaning.js` — merged log-transform paragraph into existing primer; removed card-level primer
- `static/css/main.css` — extended alignment rule to `td:not(:first-child)`
- `config/settings.py` — VERSION bump

---

## [0.8.9] — 2026-05-13

### Bug fixes — log-transform primer, table alignment, dark mode header (v0.8.9)

#### Fixed

- **Log-transform learning primer** — Clean tab's "Log-Transform (Skew)" card now registers a learning-mode primer on the card title. Primer explains skewness, what `log(1+x)` does, and when not to apply it (negative values).
- **Results table header alignment** — column headers for numeric columns (all but the first) are now right-aligned to match the right-aligned metric values below them. Added `.results-table th:not(:first-child) { text-align: right; }`.
- **Results table overflow conflict** — `.results-table-wrap` had both `overflow-x: auto` and `overflow: hidden`; the shorthand overrode the x direction. Changed to `overflow-y: hidden` so horizontal scrolling works correctly on narrow viewports.
- **Dark mode table header background** — `--color-bg-subtle` was used in `.results-table th` but never defined in `variables.css`, so the browser always fell back to `#f5f7fb` (near-white) even in dark mode. Defined in both light (`#f5f7fb`) and dark (`#252b3b`) theme sections.

#### Files changed

- `static/js/modules/data_cleaning.js` — `registerPrimer("cleaning_logtransform", ...)` in `_buildTransformCard()`
- `static/css/main.css` — table header alignment rule; overflow fix on `.results-table-wrap`
- `static/css/variables.css` — `--color-bg-subtle` defined for light and dark modes
- `config/settings.py` — VERSION bump

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
