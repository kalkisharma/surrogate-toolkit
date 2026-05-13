# Developer Guide

## Setup

### Prerequisites
- Python 3.11+
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

109 tests (43 unit, 66 integration). Target: 80%+ coverage on `app/data/ingestion.py`, `app/data/cleaning.py`, and `app/api/data_api.py`.

Test fixtures live in `tests/fixtures/`. They are synthetic — no real program data.

---

## Architecture

### Flask app factory

`app/__init__.py` exports `create_app()`. Entry point for both `run.py` (dev) and gunicorn (prod). Blueprints are registered in dependency order: main route → state API → data API.

### STATE

`app/state/schema.py` defines the canonical `STATE` dict. The live `STATE` object is stored in `app.config['STATE']` so blueprints access it via `current_app.config['STATE']` without circular imports.

**Critical rule:** `STATE['datasets']['primary']['raw']` is written exactly once on upload and never modified. All downstream processing writes to `STATE['datasets']['primary']['clean']`.

**Thread safety:** STATE is a plain dict. The Flask dev server is single-threaded — fine for Phase 1. gunicorn multi-worker mode gives each worker its own STATE. A shared backend (Redis, SQLite) is required for multi-worker deployments. Phase 2 concern.

### Frontend (SPA)

Flask serves `index.html` at `GET /`. All navigation happens in JavaScript — no page reloads. The 404 handler returns `index.html` for non-API paths to support deep links.

State sync: the frontend calls `GET /api/state/` after every mutating POST via `state.js:refreshState()`.

**Module constraints:**
- Only `charts.js` calls `Plotly.*`
- Only `notifications.js` renders toasts
- Only `loading.js` renders spinners/skeletons

### API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/data/upload` | Validate and ingest a CSV; returns 10-row preview |
| `GET` | `/api/data/summary` | Per-column descriptive stats + `cleaning_stats` |
| `GET` | `/api/data/rows` | Up to `MAX_PLOT_ROWS` (2,000) rows for the scatter matrix |
| `GET` | `/api/data/datasets` | All loaded datasets with metadata |
| `POST` | `/api/data/designate` | Set input/output/unused column roles |
| `GET` | `/api/data/correlate` | Pearson correlation matrix for clean data |
| `POST` | `/api/data/normalize` | Scale input columns (minmax or zscore) |
| `POST` | `/api/data/clean/nulls` | Handle missing values (drop, mean/median impute) |
| `POST` | `/api/data/clean/outliers` | Treat IQR outliers (keep or drop) |
| `POST` | `/api/data/clean/duplicates` | Remove exact duplicate rows |
| `POST` | `/api/data/clean/reset` | Restore clean DataFrame to original raw upload |
| `GET` | `/api/state/` | Full STATE snapshot |
| `PUT` | `/api/state/session` | Update session fields (level, cores, theme, etc.) |
| `POST` | `/api/state/reset` | Clear all loaded datasets and reset STATE |

### Adding a new API endpoint

1. Add the route to the appropriate blueprint in `app/api/`
2. Register the blueprint in `app/__init__.py` if it's a new file
3. Add integration tests in `tests/integration/test_api_endpoints.py`
4. Add a corresponding JS call in `api.js` or the relevant module

### Adding a new view

1. Add a render function in `main.js` or a new module under `static/js/modules/`
2. Register primers and tooltips with `learning_mode.js` using `registerPrimer()` and `registerTooltip()`
3. All Plotly charts go through `charts.js`

---

## Configuration constants

All constants live in `config/settings.py`. Never hardcode values elsewhere.

---

## Versioning

This project uses an internal convention inspired by Semantic Versioning.
It is **not** strict SemVer — there are no API compatibility guarantees.

The major version (`0`) stays at `0` during active development. It bumps to `1` when the first complete end-to-end surrogate modeling workflow is functional (Phase 3 complete). `2.0.0` is reserved for Phase 4/5 features or a significant architectural change.

### Scheme: 0.SUBPHASE.PATCH

| Number | When to increment | Reset? |
|--------|-------------------|--------|
| `MAJOR` | `0` → `1` when Phase 3 is complete (full end-to-end workflow). `1` → `2` for Phase 4/5 or major architectural change. | — |
| `SUBPHASE` (middle) | Each new development sub-phase batch ships | patch → 0 |
| `PATCH` (last) | Bug fixes, UX tweaks, hotfixes within a sub-phase | — |

### Phase → version map

| Phase / Sub-phase | Version range | Status |
|---|---|---|
| Phase 1 — Sub-phase 1 (scaffold, ingestion, exploration) | 0.1.x | ✅ Complete |
| Phase 1 — Sub-phase 2 (multi-file, stats, UX) | 0.2.x | ✅ Complete |
| Phase 1 — Sub-phase 3 (completion, caching, polish) | 0.3.x | ✅ Complete |
| Phase 2 — A-series (designation, correlation, normalization) | 0.4.x | ✅ Complete |
| Phase 2 — B-series (data cleaning) | 0.5.x | ✅ Complete |
| Phase 2 — C-series (log-transform patch + Phase 3 ramp-up) | 0.5.1 / 0.6.x | Planned |
| Phase 3 — model training, cross-validation, metrics | 0.7.x | Planned |
| Phase 3 — predictions, residual plots, parity plots | 0.8.x | Planned |
| **1.0.0 milestone** | Phase 3 complete: full end-to-end workflow (upload → clean → designate → normalize → train → validate → predict) | Planned |
| **2.0.0 milestone** | Phase 4/5 complete (active learning, export) or major architectural change | Reserved |

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

**Docstrings:** every function needs Args, Returns, Raises, Notes, Future sections.

**JS files** must start with the standard header comment block.

**Commit messages:**
```
[module] Short description (under 50 chars)

Longer explanation if needed.
Future: planned follow-up.
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
- All tests pass (80%+ coverage)
- Security Engineer sign-off for any new data handling code
- Compliance Officer sign-off if classification logic changed
- CHANGELOG.md updated
- Version bumped in ALL required locations (see ## Versioning above)
