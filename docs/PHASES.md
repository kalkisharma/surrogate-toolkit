# Surrogate Toolkit — Phase Documentation

**Last updated:** 2026-05-14
**Total phases:** 16 across 3 milestones
**See also:** `docs/DEVELOPER.md` (versioning), `docs/CHANGELOG.md` (release history)

---

## Milestone Map

| Milestone | Version | Phases | Theme | Status |
|---|---|---|---|---|
| **M1** | v1.0.0 | 1–5 | Full end-to-end surrogate workflow | ✅ Complete |
| **M2** | v2.0.0 | 6–11 | Advanced analysis & production readiness | 🔶 In progress — Phase 8 complete |
| **M3** | v3.0.0 | 12–16 | Teaching platform & advanced ML | 🔲 Not started |
| **M4** | v4.0.0 | TBD | Team deployment, auth, HPC integration | 🔲 Not defined |

---

## Milestone 1 — v1.0.0: Full End-to-End Surrogate Workflow

---

### Phase 1 — Load & Explore
**Status:** ✅ Complete | **Version:** v0.1.x – v0.3.x

**Purpose:** Give engineers a way to load CSV data and immediately understand its structure and quality before any processing begins.

**User story:** An engineer uploads a CSV of simulation results, sees a preview of the rows, explores pairwise scatter plots between all columns, reviews per-column statistics, and loads additional files into the same session.

**Scope:**
- CSV upload with file validation (size, row count, column count, encoding, headers)
- 10-row data preview table
- Scatter plot matrix (SPLOM) up to 12 columns with outlier highlighting, palette/theme support, and 26 chart settings
- Per-column summary statistics: mean, std, median, min, max, skewness, null count; quality border color (green/amber/red)
- Multi-file session: up to 5 datasets with LRU eviction; dataset switcher in header
- Learning mode primers and tooltips for all Phase 1 views

**Backend:**
- `POST /api/data/upload` — validate, ingest, compute summary stats cache, store in `_datasets`
- `GET /api/data/rows` — up to 2,000 rows for SPLOM
- `GET /api/data/summary` — per-column stats + cleaning_stats
- `GET /api/data/datasets` — all loaded datasets with metadata
- `PUT /api/state/session` — active_dataset_key switching

**Frontend:**
- `main.js` — SPA router, upload gate, dataset switcher
- `data_explorer.js` — SPLOM, column selector chips, settings panel, stats section
- `charts.js` — `renderScatterMatrix()`

**Dependencies:** None.

**Definition of done:**
- Upload a CSV → SPLOM renders with correct columns
- Switch between two loaded datasets → SPLOM and stats update
- Upload a file exceeding 500 MB → error toast shown, no crash
- Learning mode primers visible and expandable in all Phase 1 views

---

### Phase 2 — Data Cleaning
**Status:** ✅ Complete | **Version:** v0.5.0 – v0.5.1

**Purpose:** Give engineers tools to improve data quality before feature engineering and model training.

**User story:** An engineer reviews how many rows have missing values, duplicate rows, and statistical outliers. They choose how to handle each issue and apply a log-transform to skewed columns. They can reset all cleaning back to the original upload at any time.

**Scope:**
- Null handling: drop rows with any null, mean impute, median impute
- Outlier detection and removal: IQR-based (k=1.5), flag-only or drop-rows
- Duplicate row removal: exact match only
- Log-transform: log1p applied to columns where |skew| > 1.0
- Cleaning reset: restore clean DataFrame to raw upload
- Audit events: `cleaning_nulls`, `cleaning_outliers`, `cleaning_duplicates`, `cleaning_transform`, `cleaning_reset`
- Learning mode primers explaining each cleaning decision

**Backend:**
- `POST /api/data/clean/nulls`, `/outliers`, `/duplicates`, `/transform`, `/reset`
- `app/data/cleaning.py` — all cleaning functions (non-mutating)

**Frontend:**
- `data_cleaning.js` — cleaning cards, stat counters, strategy selectors

**Dependencies:** Phase 1 (uploaded dataset in STATE).

**Definition of done:**
- Apply null imputation → row count preserved, null_rows count drops to 0
- Drop outliers → row count decreases, outlier_rows count drops
- Apply log-transform → skew values decrease in summary stats
- Reset → clean DataFrame matches raw, all counts restored
- All cleaning operations appear in audit log

---

### Phase 3 — Feature Engineering
**Status:** ✅ Complete | **Version:** v0.4.x + v0.6.x (classification selector)

**Purpose:** Prepare the data for model training by telling the tool which columns are inputs, which are outputs, and how inputs should be scaled.

**User story:** An engineer designates each column as input, output, or unused. They review the Pearson correlation matrix to identify redundant inputs, choose a normalization method, and confirm the data classification label before proceeding to training.

**Scope:**
- Column designation: Input / Output / Unused; minimum 1 input, 1 output, no overlap
- Pearson correlation matrix: highlights pairs with |r| ≥ 0.90 as potential redundancies
- Normalization: None (passthrough), Min-Max (scale to [0,1]), Z-Score (mean=0, std=1)
- Data classification selector in global header: Unclassified / CUI / ITAR / EAR; persists to STATE
- Audit events: `designation`, `normalization`
- Learning mode primers for designation logic, normalization choice, correlation interpretation

**Backend:**
- `POST /api/data/designate` — validate and store column roles
- `GET /api/data/correlate` — Pearson matrix + high-correlation pair list
- `POST /api/data/normalize` — apply scaling; store scaler params in metadata
- `app/data/normalization.py`

**Frontend:**
- `column_designation.js` — designation table with role radio buttons
- `normalization.js` — method selector, status display

**Dependencies:** Phase 1 (uploaded dataset), Phase 2 (clean data).

**Definition of done:**
- Designate inputs and outputs → normalization and configure steps unlock
- Apply min-max normalization → normalized DataFrame stored, scaler params in metadata
- Correlation matrix shows amber highlight for |r| ≥ 0.90 pairs
- Classification label persists across dataset switches

---

### Phase 4 — Model Training & Validation
**Status:** ✅ Complete | **Version:** v0.6.x – v1.0.1

**Purpose:** Train a surrogate model on the prepared data, evaluate its accuracy, and give engineers the tools to tune it.

**User story:** An engineer selects a model type, sets training parameters, and optionally runs automated hyperparameter tuning. They train the model and review cross-validation metrics, test-set metrics, and parity/residual plots.

**Scope (built):**
- Training configuration: model type (GPR / RF / Linear), test split (0.05–0.50), CV folds (2–20)
- Model training: GPR (RBF kernel, alpha=0.1), RF (n_estimators=100), Linear (Ridge, alpha=1.0)
- Cross-validation: k-fold; per-output mean ± std for R², RMSE, MAE
- Test-set metrics: R², RMSE, MAE per output; color-coded badges
- Parity plots (actual vs. predicted) and residual plots (actual vs. error) per output
- Per-dataset surrogate session storage
- GPR large-dataset warning (>2,000 training rows)

**Scope (hyperparameter tuning — added v0.9.10 / v1.0.1):**
- GPR: manual kernel selector (RBF, Matérn ν=1.5, Matérn ν=2.5) + alpha; auto-tune grid search over all kernels × 4 alpha values
- RF: manual n_estimators, max_depth, min_samples_leaf, max_features; auto-tune grid search over all combinations
- Linear: manual Ridge alpha; auto-tune grid search over 5 alpha values
- Search method: sklearn GridSearchCV; best params stored in STATE, displayed in tune-result card
- UI: "Auto-tune with GridSearchCV" checkbox in configure panel; collapses manual fields when checked

**Backend:**
- `POST /api/model/tune` — run GridSearchCV; store best params in `config["hyperparams"]` and `config["auto_tune_result"]`; `get_param_grid()` on each model class

**Frontend:**
- `model_config.js` — auto-tune checkbox; two-step train flow (tune → display result card → train)

**Dependencies:** Phase 3 (designation + normalization).

**Definition of done:**
- Train GPR on 200-row dataset → CV metrics and parity plot render in < 30 seconds
- Auto-tune → best params displayed; trained model uses those params
- Switch datasets → trained model from previous dataset restored without retraining
- All 154 existing tests continue to pass; new tuning tests added

---

### Phase 5 — Prediction & Inference
**Status:** ✅ Complete | **Version:** v1.0.0

**Purpose:** Allow engineers to use a trained surrogate to get fast predictions for new design inputs without running a simulation.

**User story:** An engineer enters a new combination of input values and immediately gets predicted outputs. For larger studies, they upload a CSV of inputs and download predicted results.

**Scope:**
- Single-point prediction: auto-generated input form from designated input columns; min/max hints from training data range; predicted outputs displayed per column
- GPR uncertainty: predicted std shown alongside predicted mean (native to sklearn GPR, zero overhead)
- Out-of-range warning: flag inputs outside the training data range (extrapolation risk)
- Batch prediction: upload CSV of new inputs → validate → predict → download results CSV with outputs appended
- Batch size limit: MAX_BATCH_ROWS (10,000) for synchronous processing
- Audit events: `prediction_single`, `prediction_batch`
- Learning mode primer explaining prediction vs. simulation and extrapolation risk

**Backend:**
- `POST /api/predict/single` — validate inputs, apply normalization, run model.predict(), return predictions + GPR std + out-of-range flags
- `POST /api/predict/batch` — read multipart CSV, normalize, batch predict, return JSON rows + columns
- `app/api/prediction_api.py` — fully implemented with `_normalize_row()` and `_normalize_df_cols()` helpers

**Frontend:**
- `prediction.js` — fully implemented with single-point form, batch CSV upload/download, and learning mode primers
- Step 9 in sidebar (registered in `main.js` STEP_KEYS / STEP_LABELS / STEP_NUMS)

**Dependencies:** Phase 4 (trained model in STATE).

**Definition of done:**
- Enter valid inputs → prediction returns in < 1 second for all three model types
- Enter out-of-range input → amber warning shown alongside prediction
- Upload 1,000-row batch CSV → predictions returned and downloaded as CSV
- GPR model → std values shown; RF/Linear → std not shown
- `prediction_single` and `prediction_batch` audit events in STATE audit log

---

## Milestone 2 — v2.0.0: Advanced Analysis & Production Readiness

---

### Phase 6 — Design Space Optimization
**Status:** 🔲 Not started | **Version:** v1.1.x

**Purpose:** Use the trained surrogate as a fast proxy to find the best design inputs — replacing expensive simulation sweeps with near-instant surrogate queries.

**User story:** An engineer specifies an objective (minimize drag), sets input bounds (flight envelope), and runs the optimizer. For multi-objective problems, they get a Pareto front showing trade-off solutions between competing objectives.

**Scope:**
- Single-objective: minimize or maximize one output; scipy.optimize.differential_evolution; returns best inputs and predicted output value
- Multi-objective: two or more outputs with min/max direction; NSGA-II via pymoo; returns Pareto front
- Box constraints: min/max bounds per input (defaults to training data range)
- Inequality constraints: specify that a given output must be ≤ or ≥ a threshold
- Optimization confidence: flag solutions where GPR std is high
- New dependencies: `pymoo`
- Audit events: `optimization_single`, `optimization_multi`
- Learning mode primers explaining objective functions, Pareto fronts, and constraints in engineering terms

**Backend:**
- `POST /api/optimize/single` — differential_evolution; returns best_inputs, best_output, n_evaluations, warnings
- `POST /api/optimize/multi` — NSGA-II; returns pareto_inputs, pareto_outputs, n_generations
- New files: `app/api/optimization_api.py`, `app/ml/optimization/single_objective.py`, `app/ml/optimization/multi_objective.py`

**Frontend:**
- New module: `static/js/modules/optimization.js`
- Step 10 in sidebar
- `charts.js` — `renderParetoFront(containerEl, paretoOutputs, objNames)`

**Dependencies:** Phase 5 (prediction path; optimization uses the same model.predict()).

**Definition of done:**
- Single-objective minimize → best inputs within specified bounds
- Multi-objective → Pareto front rendered with correct trade-off shape for a known test problem
- Constraint violation at optimum → warning shown with flagged result
- pymoo added to requirements.txt and importable

---

### Phase 7 — Session Persistence
**Status:** 🔲 Not started | **Version:** v1.2.x

**Purpose:** Let engineers save their full session to disk and reload it later — so no work is lost to a server restart.

**User story:** An engineer saves a trained session to a `.surrogate` file. The next day they reload it and the full session — data, trained model, metrics, designations — is restored exactly as left.

**Scope:**
- Save project: serialize STATE to `.surrogate` file (zip of `state.json` + pickled model objects in `models/` subdirectory)
- Load project: unzip, deserialize JSON state, unpickle models, reinstate STATE, re-render active panel
- Project metadata: filename, creation date, surrogate version, classification label, dataset names
- Unsaved-changes warning: `beforeunload` prompt if tab closed with unsaved changes
- Compliance confirmation dialog: before saving CUI/ITAR/EAR sessions, modal requiring acknowledgment of data sensitivity
- Audit events: `project_saved`, `project_loaded`

**Backend:**
- `POST /api/state/save` — write `.surrogate` file
- `POST /api/state/load` — read `.surrogate` file; restore STATE
- `app/state/session.py` — implement `save_session()`, `load_session()`
- `app/state/project.py` — implement project file format, `read_project()`, `write_project()`
- `app/state/cleanup.py` — implement temp file cleanup on new session start

**Frontend:**
- Save / Load buttons in global header
- Compliance modal before save: `app/templates/components/modals/compliance_modal.html` (implement stub)
- `beforeunload` listener in `main.js`

**Dependencies:** Phase 4 (fitted models exist to serialize). Phase 5 recommended but not blocking.

**Definition of done:**
- Save trained session → `.surrogate` file created on disk
- Load in a fresh session → full STATE restored, sidebar shows correct completion state
- Load on incompatible app version → graceful error, not a crash
- Compliance dialog appears when saving CUI or ITAR session
- `project_saved` and `project_loaded` audit events written

---

### Phase 8 — Model Interpretation
**Status:** ✅ Complete | **Version:** v1.1.0

**Purpose:** Help engineers understand how much to trust their surrogate's predictions and which input variables are driving the outputs.

**User story:** An engineer wants to know: (1) if the model predicts CD = 0.025, what is the uncertainty on that number? (2) Of all the inputs, which ones actually matter?

**Scope:**

*Uncertainty Quantification:*
- GPR: native posterior std → ±1.96σ error bars on parity plots in Step 8 — Training Results
- RF: tree-variance 95% CI (percentile across all estimators, no refitting) — mean CI width shown in Interpret panel
- Linear: explanatory note; no native uncertainty

*Sensitivity Analysis:*
- Sobol global sensitivity (SALib): S1 (first-order) and ST (total-order) indices per input; N=512 Saltelli samples
- OAT: vary each input over its range (50 points) while holding all others at training median; dashed nominal line
- Tornado chart: horizontal bar chart sorted by ST descending, ST + S1 overlay
- Multi-output: user selects which output to analyze; results cached per output column
- Audit event: `sensitivity_analysis_run`

**Backend:**
- `app/ml/models/gpr_model.py` — `predict_std(X)` via `MultiOutputRegressor.estimators_[i].predict(X, return_std=True)`
- `app/ml/uncertainty/bootstrap.py` — `compute_uncertainty()` (GPR native + RF tree variance)
- `app/ml/sensitivity/global_sensitivity.py` — `SobolAnalyzer.analyze()` (SALib.sample.saltelli + SALib.analyze.sobol)
- `app/ml/sensitivity/one_at_a_time.py` — `OATAnalyzer.analyze()`
- `POST /api/model/interpret` — runs Sobol + OAT + uncertainty; caches per output
- `GET /api/model/interpret?output_col=X` — returns cached result
- `train` results dict extended: `test_inputs`, `test_stds`, `input_mins`, `input_maxs`; interpretation cache cleared on retrain

**Frontend:**
- `static/js/modules/interpretation.js` — new Step 11 module (Sobol tornado, OAT grid, uncertainty section)
- `static/js/charts.js` — `renderTornadoChart()`, `renderOATGrid()`; `renderOutputFigure` error-bar support via `opts.stds`
- `static/js/modules/results.js` — passes `stds` to `renderOutputFigure`
- `static/js/main.js` — Step 11 registered in STEP_KEYS/STEP_LABELS/STEP_NUMS; unlock logic in two places; `_initInterpretPanel`

**Dependencies:** Phase 4 (trained model). Phase 5 recommended (GPR uncertainty displayed in Results panel).

**Definition of done:** ✅
- Sobol analysis on multi-input problem → tornado + S1/ST table rendered
- OAT grid renders sorted by ST descending; dashed median line visible
- GPR: error bars appear on parity plot in Results; Interpret uncertainty section points back to Results
- RF: Interpret shows mean CI width from tree variance
- Linear: Interpret shows "not available" note
- Multi-output: output selector switches columns; each column cached independently
- Retrain clears interpretation cache; re-analysis computes fresh

---

### Phase 9 — Active Learning
**Status:** 🔲 Not started | **Version:** v1.4.x

**Purpose:** Help engineers decide which new simulations to run to improve the surrogate most efficiently.

**User story:** An engineer has 50 simulation samples. Instead of guessing where to run the next 10 simulations, they get specific recommendations — e.g., "run at Mach 0.85, AoA 12°, altitude 30,000 ft" because that region has high uncertainty and is poorly covered by existing samples.

**Scope:**

*Coverage Mode (space-filling):*
- Max-min distance criterion: recommend points that maximize minimum distance to existing training samples
- Candidate generation: Latin hypercube sampling (scipy.stats.qmc.LatinHypercube); select top N by max-min distance
- Output: table of N recommended input combinations + design space scatter visualization

*Objective Mode (exploitation/exploration):*
- Acquisition function: Expected Improvement (EI) or Upper Confidence Bound (UCB)
- Requires Phase 8 uncertainty estimates
- Output: table of N recommended points ranked by acquisition score + exploitation vs. exploration trade-off plot

*Shared:*
- Configurable N recommendations (default 10, max 50)
- History of up to 5 active learning rounds stored in STATE
- Audit event: `active_learning_recommendations`
- Learning mode primer explaining design of experiments, space-filling, exploitation vs. exploration

**Backend:**
- `app/ml/active_learning/coverage_mode.py` — implement CoverageRecommender
- `app/ml/active_learning/objective_mode.py` — implement ObjectiveRecommender (EI/UCB)
- `app/api/active_learning_api.py` — implement (currently 21-line stub)
- `POST /api/active/coverage`, `POST /api/active/objective`

**Frontend:**
- `active_learning.js` — implement (currently 9-line stub)
- Step 12 in sidebar
- `charts.js` — `renderDesignSpaceScatter()` — 2D scatter of existing samples + recommendations

**Dependencies:** Phase 4 (trained model + training data). Phase 8 required for objective mode (needs uncertainty estimates).

**Definition of done:**
- Coverage mode → 10 recommendations spread across input space, none duplicating training points
- Objective mode → recommendations cluster near predicted optimum for a known test function
- History of 3 consecutive rounds stored in STATE without collision

---

### Phase 10 — Multi-Dataset Comparison
**Status:** 🔲 Not started | **Version:** v1.5.x

**Purpose:** Compare surrogates trained on different datasets side by side — most commonly a cheap low-fidelity model against an expensive high-fidelity model.

**User story:** An engineer has two datasets: one from a fast panel code (low-fidelity, 500 runs) and one from a CFD solver (high-fidelity, 50 runs). Phase 10 compares their accuracy side by side and quantifies the systematic bias between them.

**Scope:**
- Side-by-side metrics table: R², RMSE, MAE for each loaded dataset's surrogate, per output column
- Bias analysis: at common input points, compute predicted output difference between the two surrogates; display as distribution + mean/std
- Error model: fit a surrogate (Linear or RF) to predict the systematic error (Δoutput) between fidelity levels — this bridge correction is the foundation for Phase 15
- Prediction comparison scatter: low-fidelity vs. high-fidelity predictions at common input points; diagonal = perfect agreement
- Requires at least two loaded datasets each with a trained surrogate
- Audit event: `comparison_run`

**Backend:**
- `app/api/comparison_api.py` — implement (currently 21-line stub)
- `GET /api/comparison/summary`, `POST /api/comparison/bias`, `POST /api/comparison/error_model`

**Frontend:**
- New module: `static/js/modules/comparison.js`
- Step 13 in sidebar
- `charts.js` — `renderComparisonScatter()`

**Dependencies:** Phase 4 on at least two datasets (two trained surrogates in STATE).

**Definition of done:**
- Two trained surrogates loaded → side-by-side metrics table renders correctly
- Bias analysis at 20 common points → mean bias and std computed correctly
- Error model trained → bridge correction predictions available in STATE for Phase 15

---

### Phase 11 — Export & Compliance
**Status:** 🔲 Not started | **Version:** v1.6.x – v1.9.x

**Purpose:** Generate compliance-ready documentation of the surrogate modeling workflow and enforce data classification requirements before any data leaves the tool.

**User story:** An engineer completes a surrogate study on ITAR-controlled data. They generate a PDF report documenting the full workflow with a classification watermark. The tool enforces explicit acknowledgment of the classification before any export is allowed.

**Sub-phase 11A — Report Generation:**
- HTML report: Jinja2 template with all workflow steps, metrics tables, charts (Plotly → SVG/PNG), classification watermark
- PDF export: HTML rendered to PDF via `weasyprint`; watermark on every page
- Report sections: session metadata, dataset summary, cleaning log, designation, normalization, model config, CV metrics, test metrics, parity/residual plots, sensitivity results (if Phase 8 done), optimization results (if Phase 6 done), full audit trail
- New dependencies: `weasyprint`

**Sub-phase 11B — Compliance Enforcement:**
- Hard export gate: modal requiring engineer to confirm classification label and acknowledge data handling policy
- Classification watermark on all exported files
- Export log: every export recorded with timestamp, classification label, acknowledgment, and output file hash
- ITAR/EAR: additional confirmation step stating export control restriction
- `app/compliance/classification.py` — implement classification rules and guidance
- `app/compliance/audit.py` — implement audit log export
- `app/security/file_validation.py` — implement strict file content validation

**Backend:**
- `app/api/export_api.py` — implement (currently 21-line stub)
- `POST /api/export/report/html`, `POST /api/export/report/pdf`, `POST /api/export/audit`

**Frontend:**
- New module: `static/js/modules/export.js`
- Step 14 in sidebar
- `app/templates/components/modals/compliance_modal.html` — full implementation (stub exists)
- Report templates: `app/templates/report/report_base.html`

**Dependencies:** Phase 4 minimum. All completed phases contribute sections to the report automatically.

**Definition of done:**
- HTML report generated → contains dataset summary, metrics table, parity plot images, classification watermark
- PDF generated → readable, correctly paginated, watermark on every page
- Export with ITAR classification → confirmation modal blocks export until confirmed
- Export log entry created in STATE with timestamp, classification, and file hash

---

## Milestone 3 — v3.0.0: Teaching Platform & Advanced ML

---

### Phase 12 — Experience Levels
**Status:** 🔲 Not started | **Version:** v2.1.x

**Purpose:** Allow the tool to adapt its interface to the engineer's experience level — less hand-holding as engineers grow, full control for experts.

**Scope:**

*Beginner (current state):*
- Learning mode primers visible and expandable; simplified controls; defaults pre-selected; all tooltips active

*Intermediate (new):*
- Primers collapsed by default (expandable on demand)
- Additional CV strategy options: stratified, leave-one-out (small datasets)
- GPR kernel selector: RBF (default), Matern 3/2, Matern 5/2, Rational Quadratic
- RF max_depth control exposed
- Training data size recommendation (warn if < 30 points for GPR)

*Expert (new):*
- Learning mode disabled by default
- All model hyperparameters directly editable (bypasses auto-tune)
- Read-only STATE JSON viewer
- Advanced cleaning options: winsorization, custom IQR multiplier
- No out-of-range warnings

**Backend:**
- `experience_level` and `PUT /api/state/session` already implemented — no new endpoints
- API endpoints use experience_level to gate validation strictness where appropriate

**Frontend:**
- Experience level selector already in global header (only Beginner functional today)
- All existing modules gain level-conditional rendering logic

**Dependencies:** All Milestone 1 and 2 modules built (level-conditional logic covers the full feature surface).

**Definition of done:**
- Switch to Intermediate → GPR kernel selector appears; primers collapse
- Switch to Expert → all primers hidden; raw hyperparameter fields appear
- Level persists across page reload

---

### Phase 13 — Guided Learning & Exercises
**Status:** 🔲 Not started | **Version:** v2.2.x

**Purpose:** Complete the teaching tool mandate with structured exercises, curated learning content, and progress tracking.

**User story:** A junior engineer opens the tool and selects "Exercise 1: Your First Surrogate." A guided workflow loads a synthetic dataset, walks through each phase with contextual explanations, and quizzes the engineer after each section.

**Scope:**

*Learning Content (populate all empty JSON files):*
- `glossary.json` — 40–60 terms with plain-language definitions
- `models.json` — description, strengths, weaknesses, and best-use guidance per model type
- `uncertainty.json` — prediction uncertainty, bootstrap, confidence intervals, when they matter
- `diagnostics.json` — how to read R², RMSE, MAE, parity plots, residual patterns
- `cv_strategies.json` — k-fold, leave-one-out, stratified — when to use each
- `sensitivity.json` — Sobol indices, tornado charts, first-order vs. total-order
- `active_learning.json` — design of experiments, space-filling, exploitation vs. exploration
- `decision_trees/model_selection.json` — flowchart: choose GPR vs. RF vs. Linear based on dataset size, smoothness, interpretability
- `decision_trees/cv_selection.json` — flowchart: choose fold count based on dataset size

*Exercise System:*
- Exercise format: JSON workflow script with steps, synthetic dataset, expected actions, explanatory text, quiz questions
- Synthetic datasets: 3–5 datasets (aerodynamics, structural, thermal) shipped as fixtures; no real program data
- Progress tracking: completed exercises stored in localStorage
- Exercise viewer: guided overlay highlighting the relevant UI step with contextual explanation
- Quiz component: 2–3 multiple-choice questions per phase; correct/incorrect feedback

**Backend:**
- `GET /api/learning/glossary`, `/models`, `/exercises`, `/exercise/<id>`

**Frontend:**
- New module: `static/js/modules/learning_guide.js` — exercise viewer, step highlighter, quiz renderer
- Step 15 in sidebar (visible in Beginner/Intermediate mode)
- Glossary panel accessible from global header "?" button

**Dependencies:** Phase 12 (experience levels; exercise content is level-aware).

**Definition of done:**
- All 8 learning JSON files populated with non-empty, accurate content
- Exercise 1 completes without errors using the synthetic dataset
- Quiz validation: correct = green feedback, incorrect = explanation shown
- Glossary returns definitions for at least 40 terms
- Completing Exercise 1 marks it done in localStorage on page reload

---

### Phase 14 — Advanced Surrogate Models
**Status:** 🔲 Not started | **Version:** v2.3.x

**Purpose:** Extend the available model types to cover complex aerospace response surfaces that GPR/RF/Linear cannot fit well.

**Scope:**

*New Model Types:*
- Kriging variants: Matern 3/2, Matern 5/2, Rational Quadratic kernels (sklearn GPR with explicit kernel objects)
- Radial Basis Functions (RBF): thin-plate spline, multiquadric (scipy.interpolate.RBFInterpolator)
- Polynomial Chaos Expansion (PCE): analytical representation with free sensitivity indices as a by-product (chaospy); best for smooth, well-behaved responses with known input distributions
- New dependencies: `chaospy`

*Model Selection Decision Tree:*
- `decision_trees/model_selection.json` — conditional logic: dataset size, smoothness, interpretability needs, multi-output count, computational budget
- Interactive guided flowchart in Intermediate/Expert mode

*Model Comparison:*
- "Compare models" option: train all available types on the same data; side-by-side metrics table ranked by test R²

**Backend:**
- `app/ml/models/kriging_model.py` — KrigingModel (extends BaseSurrogateModel)
- `app/ml/models/rbf_model.py` — RBFModel
- `app/ml/models/pce_model.py` — PCEModel
- `POST /api/model/compare` — train all types, return comparison metrics

**Frontend:**
- `model_config.js` — extended model type selector; kernel selector for Kriging (Intermediate/Expert)
- `charts.js` — `renderModelComparisonTable()`

**Dependencies:** Phase 4 (BaseSurrogateModel ABC all new models implement).

**Definition of done:**
- Kriging Matern 5/2 trains on 100-row dataset and returns R², RMSE, MAE
- PCE trains on a smooth test function and returns analytical sensitivity indices consistent with Phase 8 Sobol results
- Model comparison returns ranked results for all available types within 60 seconds on a 200-row dataset
- chaospy added to requirements.txt; imports cleanly

---

### Phase 15 — Multi-Fidelity Modeling
**Status:** 🔲 Not started | **Version:** v2.4.x

**Purpose:** Build a more accurate surrogate at lower simulation cost by fusing cheap low-fidelity data with expensive high-fidelity data.

**User story:** An engineer has 500 low-fidelity panel code runs and 30 high-fidelity CFD runs. Phase 15 fuses both — the resulting surrogate is as accurate as if 500 high-fidelity runs existed, but only 30 were needed.

**Scope:**
- Kennedy-O'Hagan co-kriging: high-fidelity response modeled as scaled low-fidelity surrogate plus a Gaussian correction term
- Bridge correction (simpler alternative): surrogate trained on (LF_prediction − HF_truth) at high-fidelity sample points; used to correct low-fidelity predictions anywhere
- Multi-fidelity workflow: user designates loaded datasets as Low / High / Neither; tool validates input columns match
- Validation: leave-one-out cross-validation on high-fidelity points (small sample size makes k-fold unreliable)
- Comparison to single-fidelity: multi-fidelity vs. high-fidelity-only accuracy displayed side-by-side (leverages Phase 10)

**Backend:**
- `app/ml/multi_fidelity/kennedy_ohagan.py` — KOCoKrigingModel
- `app/ml/multi_fidelity/bridge_correction.py` — BridgeCorrectionModel
- `POST /api/model/train_multifidelity`, `GET /api/model/multifidelity_results`

**Frontend:**
- Multi-fidelity mode toggle in model_config (visible when 2+ datasets with matching input columns are loaded)
- Fidelity designation dropdown per dataset
- Results extend Phase 4 results panel with multi-fidelity accuracy rows

**Dependencies:**
- Phase 4 (model infrastructure)
- Phase 10 (comparison infrastructure for side-by-side accuracy display)
- Phase 14 (co-kriging is a Kriging variant; requires KrigingModel compliance)

**Definition of done:**
- Bridge correction on a 2-fidelity test case → corrected LF predictions closer to HF truth than uncorrected LF
- Co-kriging on same test case → comparable or better accuracy than bridge correction
- Leave-one-out CV runs on 20-point HF dataset without error
- Multi-fidelity vs. high-fidelity-only comparison table renders in results panel

---

### Phase 16 — Ensemble Surrogates
**Status:** 🔲 Not started | **Version:** v2.5.x

**Purpose:** Combine multiple surrogate model types into a weighted ensemble more robust than any individual model.

**User story:** An engineer tries GPR (accurate but slow), RF (fast but noisy), and PCE (analytically tractable). The ensemble weights each by its cross-validation performance and combines predictions — more robust on complex, non-linear aerospace response surfaces where no single model type dominates.

**Scope:**
- Ensemble construction: train all selected component models; combine as weighted average
- Weighting strategies:
  - Equal weights (baseline)
  - CV-performance weights: weight each model by cross-validation R² normalized to sum to 1
  - Stacking: meta-model (Linear) trained on held-out component predictions to learn optimal weights
- Ensemble uncertainty: variance across component predictions as a free proxy for uncertainty
- Component model selection: checkbox list; minimum 2 required
- Ensemble vs. best single model: automatic comparison after training

**Backend:**
- `app/ml/ensemble/ensemble_model.py` — EnsembleSurrogateModel (extends BaseSurrogateModel; stores component models + weights)
- `app/ml/ensemble/stacking.py` — StackingEnsemble
- `POST /api/model/train_ensemble`

**Frontend:**
- "Build Ensemble" tab in model_config; component checkbox list, weighting strategy selector
- Results: ensemble metrics table + component weight bar chart + ensemble vs. best-single comparison
- `charts.js` — `renderEnsembleWeights()`

**Dependencies:**
- Phase 4 (model interface all components implement)
- Phase 14 recommended (more model types = more useful ensembles; Phase 16 works with GPR/RF/Linear alone)

**Definition of done:**
- 3-component ensemble (GPR + RF + Linear) trained → weighted prediction computed correctly
- CV-performance weighting → highest CV R² component receives highest weight
- Stacking → meta-model trained; stacking accuracy ≥ best single component on test set
- Ensemble uncertainty (variance across components) displayed alongside ensemble prediction

---

## Cross-Phase Dependencies

| Phase | Requires |
|---|---|
| Phase 2 | Phase 1 |
| Phase 3 | Phase 1, Phase 2 |
| Phase 4 | Phase 3 |
| Phase 5 | Phase 4 |
| Phase 6 | Phase 5 |
| Phase 7 | Phase 4 (Phase 5 recommended) |
| Phase 8 | Phase 4 (Phase 5 recommended) |
| Phase 9 | Phase 4; Phase 8 required for objective mode |
| Phase 10 | Phase 4 on ≥2 datasets |
| Phase 11 | Phase 4 minimum; all completed phases contribute report sections |
| Phase 12 | All Milestone 1 and 2 modules built |
| Phase 13 | Phase 12 |
| Phase 14 | Phase 4 |
| Phase 15 | Phase 4, Phase 10, Phase 14 |
| Phase 16 | Phase 4 (Phase 14 recommended) |

---

## New Dependencies by Phase

| Phase | New pip package | Reason |
|---|---|---|
| Phase 6 | `pymoo` | NSGA-II multi-objective optimization |
| Phase 8 | `SALib` | Sobol global sensitivity analysis |
| Phase 11 | `weasyprint` | HTML-to-PDF report rendering |
| Phase 14 | `chaospy` | Polynomial Chaos Expansion |
