# Developer Guide

> **New to the codebase?** Start with [`docs/CODEBASE_TOUR.md`](CODEBASE_TOUR.md) — a guided reading path with data flow diagrams (~90 min).

## Setup

### Prerequisites
- Python 3.9+ (Anaconda recommended — project tested on Python 3.9 Anaconda)
- conda or pip

### Install

```bash
# conda
conda env create -f environment.yml
conda activate surrogate-toolkit

# pip
python -m venv venv
venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

### Configure

```bash
cp .env.example .env
```

`.env` options:

| Variable           | Default        | Description                              |
|--------------------|----------------|------------------------------------------|
| `HOST`             | `127.0.0.1`    | Bind address                             |
| `PORT`             | `5000`         | Port                                     |
| `DEBUG`            | `false`        | Enable Flask debug mode (reload on save) |
| `FLASK_SECRET_KEY` | `dev-key-...`  | Session secret — change in production    |

### Run (development)

```bash
python run.py
```

Open `http://127.0.0.1:5000`.

### Run (production)

```bash
gunicorn "app:create_app()"
```

---

## Tests

```bash
python -m pytest tests/ -v
```

154 tests (65 unit, 89 integration). Target: 80%+ coverage on `app/data/ingestion.py`, `app/data/cleaning.py`, `app/api/data_api.py`, and `app/ml/`.

Test fixtures live in `tests/fixtures/`. They are synthetic — no real program data.

---

## Architecture

### Flask app factory

`app/__init__.py` exports `create_app()`. Entry point for both `run.py` (dev) and gunicorn (prod). Blueprints are registered in dependency order:

```
main (SPA shell) → state → data → model → predict → active → export → optimize → comparison
```

### STATE

`app/state/schema.py` defines the canonical `STATE` dict. The live `STATE` object is stored in `app.config['STATE']` so blueprints access it via `current_app.config['STATE']` without circular imports.

**Critical rules:**
- `STATE['datasets']['primary']['raw']` is written **once** on upload and **never modified**. All downstream processing writes to `primary['clean']`.
- When a user switches to a different dataset, the current surrogate session (trained model + results) is saved to `STATE['datasets']['_datasets'][key]['surrogate_session']` before the new dataset is mirrored into `primary`.
- The active dataset's model is always at `STATE['surrogate_sessions']['primary']['models']`.

**Thread safety:** STATE is a plain dict. The Flask dev server is single-threaded. gunicorn multi-worker mode gives each worker its own STATE — a shared backend (Redis, SQLite) is required for multi-worker deployments.

### Frontend (SPA)

Flask serves `index.html` at `GET /`. All navigation happens in JavaScript — no page reloads. The 404 handler returns `index.html` for non-API paths to support deep links.

**Module constraints:**
- Only `charts.js` calls `Plotly.*`
- Only `notifications.js` renders toasts
- Only `loading.js` renders spinners/skeletons

**Panel router:** `main.js` drives a 14-step sidebar workflow. Each step has a panel container div. Panels are lazy-initialized on first click and never re-initialized unless explicitly invalidated (e.g., after cleaning, the explore panel is reset via `panelDone["explore"] = false`).

### API endpoints

#### Data (`/api/data/`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/data/upload` | Validate and ingest a CSV; returns 10-row preview and metadata |
| `GET` | `/api/data/summary` | Per-column descriptive stats + cleaning_stats |
| `GET` | `/api/data/rows` | Up to 2,000 rows for the scatter matrix |
| `GET` | `/api/data/datasets` | All loaded datasets with metadata |
| `POST` | `/api/data/designate` | Set input/output/unused column roles |
| `GET` | `/api/data/correlate` | Pearson correlation matrix |
| `GET` | `/api/data/dcor` | Distance correlation matrix (max 12 cols) |
| `POST` | `/api/data/normalize` | Scale input columns (minmax or zscore) |
| `POST` | `/api/data/clean/nulls` | Handle missing values (drop, mean/median impute) |
| `POST` | `/api/data/clean/outliers` | Treat IQR outliers (keep or drop) |
| `GET` | `/api/data/clean/outlier_counts` | Preview outlier row counts before applying |
| `POST` | `/api/data/clean/undo` | Undo the last cleaning operation |
| `POST` | `/api/data/clean/duplicates` | Remove exact duplicate rows |
| `POST` | `/api/data/clean/reset` | Restore clean DataFrame to raw upload |
| `POST` | `/api/data/clean/transform` | Apply log(1+x) transform to selected columns |

#### State (`/api/state/`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/state/` | Full STATE snapshot (DataFrames replaced with metadata) |
| `PUT` | `/api/state/session` | Update session fields (level, cores, theme, active_tab, etc.) |
| `POST` | `/api/state/save` | Serialize STATE to a `.surrogate` file download |
| `POST` | `/api/state/load` | Restore STATE from a `.surrogate` file upload |
| `POST` | `/api/state/reset` | Clear all datasets and reset STATE to canonical defaults |

#### Model (`/api/model/`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/model/config` | Return current training configuration |
| `POST` | `/api/model/configure` | Save model type, test split, CV folds, hyperparameters |
| `POST` | `/api/model/tune` | Auto-tune hyperparameters via GridSearchCV |
| `POST` | `/api/model/train` | Train model, run CV, store results in STATE |
| `GET` | `/api/model/results` | Return stored training metrics from STATE |
| `POST` | `/api/model/interpret` | Run Sobol sensitivity + OAT curves + uncertainty for one output |
| `GET` | `/api/model/interpret` | Return cached interpretation result |

#### Prediction (`/api/predict/`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/predict/single` | Predict a single point; returns values + extrapolation warnings |
| `POST` | `/api/predict/batch` | Predict a batch (CSV upload or JSON array) |

#### Active Learning (`/api/active/`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/active/coverage` | Recommend next experiment points via uncertainty sampling |
| `POST` | `/api/active/objective` | Recommend next points via expected improvement (EI) |
| `GET` | `/api/active/history` | Return active learning recommendation history |

#### Optimization (`/api/optimize/`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/optimize/single` | Single-objective optimization via differential evolution |
| `POST` | `/api/optimize/multi` | Multi-objective Pareto front via NSGA-II (pymoo) |
| `GET` | `/api/optimize/history` | Last 5 optimization runs |

#### Comparison (`/api/comparison/`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/comparison/status` | List all datasets and whether each has a trained model |
| `POST` | `/api/comparison/run` | LHS-sampled side-by-side comparison of two surrogates |
| `POST` | `/api/comparison/error_model` | Fit linear model to Δ(output) as function of inputs |
| `GET` | `/api/comparison/results` | Return cached comparison result |

#### Export (`/api/export/`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/export/clean` | Download clean DataFrame as CSV |
| `GET` | `/api/export/normalized` | Download normalized DataFrame as CSV |
| `POST` | `/api/export/report` | Generate self-contained HTML analysis report |
| `GET` | `/api/export/audit` | Download export audit log as CSV |
| `GET` | `/api/export/log` | Return export log as JSON |

### Adding a new API endpoint

1. Add the route to the appropriate blueprint in `app/api/`
2. Register the blueprint in `app/__init__.py` if it's a new file
3. Add integration tests in `tests/integration/`
4. Add a corresponding JS call in `api.js` or the relevant module

### Adding a new sidebar step

1. Add the key to `STEP_KEYS`, `STEP_LABELS`, `STEP_NUMS` in `main.js`
2. Add `false` entries to `stepUnlocked` and `stepCompleted`
3. Add `case "key":` to the `_initPanel` switch with a new `_initXxxPanel` function
4. Wire up the unlock condition (after which earlier step does this become available?)
5. Create `static/js/modules/xxx.js` with an `export async function initXxx(containerEl)` entry point
6. Register learning mode primers with `registerPrimer()`
7. All charts go through `charts.js` — add new chart functions there, not in modules

---

## Configuration constants

All constants live in `config/settings.py`. Never hardcode values elsewhere.

---

## Versioning

This project uses an internal convention inspired by Semantic Versioning.
It is **not** strict SemVer — there are no API compatibility guarantees.

The project uses 16 phases across 3 milestones. See `docs/PHASES.md` for full phase definitions.

### Milestone map

| Milestone | Version | Phases | Theme | Status |
|---|---|---|---|---|
| **M1** | v1.0.0 | 1–5 | Full end-to-end surrogate workflow | ✅ Complete |
| **M2** | v2.0.0 | 6–11 | Advanced analysis & production readiness | ✅ Complete |
| **M3** | v3.0.0 | 12–16 | Teaching platform & advanced ML | ✅ Complete |
| **M4** | v4.0.0 | 17–20 | Team deployment, auth, HPC integration | 🔲 In progress |

### Phase → version map

| Phase | Name | Version | Status |
|---|---|---|---|
| Phase 1 | Load & Explore | v0.1.x – v0.3.x | ✅ Complete |
| Phase 2 | Data Cleaning | v0.5.x | ✅ Complete |
| Phase 3 | Feature Engineering | v0.4.x + v0.6.x | ✅ Complete |
| Phase 4 | Model Training & Validation | v0.6.x – v1.0.1 | ✅ Complete |
| Phase 5 | Prediction & Inference | v1.0.0 | ✅ Complete |
| Phase 6 | Design Space Optimization | v1.5.0 | ✅ Complete |
| Phase 7 | Session Persistence | v1.2.0 | ✅ Complete |
| Phase 8 | Model Interpretation | v1.1.0 | ✅ Complete |
| Phase 9 | Active Learning | v1.3.0 | ✅ Complete |
| Phase 10 | Multi-Dataset Comparison | v1.6.0 | ✅ Complete |
| Phase 11 | Export & Compliance | v1.4.0 | ✅ Complete |
| Phase 12 | Experience Levels | v2.4.0 | ✅ Complete |
| Phase 13 | Guided Learning & Reference Content | v3.0.0 | ✅ Complete (Phase 13A); 13B deferred to M4 |
| Phase 14 | Advanced Surrogate Models | v2.1.0 | ✅ Complete |
| Phase 15 | Multi-Fidelity Modeling | v2.3.0 | ✅ Complete |
| Phase 16 | Ensemble Surrogates | v2.2.0 | ✅ Complete |
| Phase 17 | Guided Exercises | v3.1.0 | 🔲 Not started |
| Phase 18 | Authentication | v3.2.0 | 🔲 Not started |
| Phase 19 | Surrogate Export & Sharing | v3.3.0 | 🔲 Not started |
| Phase 20 | HPC Integration | v4.0.0 | 🔲 Not started |

### Files to update on every version bump

Update **all** of the following — do not skip any:

1. `config/settings.py` — `VERSION = "x.y.z"`
2. Header block of every **changed** file — `VERSION: x.y.z`
3. `app/templates/index.html` — four locations:
   - Inline `<script>` — `var currentVer = "x.y.z";`
   - Header display span — `<span class="global-header__version">vx.y.z</span>`
   - CSS cache-busters — `?v=x.y.z` (×5 stylesheet links)
   - JS entry point cache-buster — `src="/static/js/main.js?v=x.y.z"`

---

## Coding standards

**Python files** must start with the standard header block (see any existing file) and the copyright/license notice.

**Type hints:** Python 3.9 compatibility required — use `Optional[X]` from `typing`, not `X | None` (PEP 604 union syntax requires Python 3.10+).

**Docstrings:** every function needs Args, Returns, Raises, Notes, Future sections.

**JS files** must start with the standard header comment block.

**Commit messages:**
```
vX.Y.Z — Short description

Longer explanation if needed.
```

---

## Branch strategy

```
main          # production-ready only
develop       # active development
  feature/xxx
  fix/xxx
hotfix/xxx
```

Pre-merge checklist:
- All tests pass
- Security Engineer sign-off for any new data handling code
- Compliance Officer sign-off if classification logic changed
- CHANGELOG.md updated
- Version bumped in ALL required locations (see Versioning above)
