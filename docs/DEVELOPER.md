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
- Version bumped in changed file headers
