# Codebase Tour

**Audience:** Python / ML engineers reviewing the codebase for the first time.
**Time:** ~90 minutes to complete all four layers.
**Version:** v3.5.77 | **Last updated:** 2026-06-04

---

## What this is

A Flask single-page application (SPA). The server renders one HTML page (`index.html`) and then gets out of the way. All navigation, state display, and user interaction happen in JavaScript. Flask's only jobs are: serve the shell page, expose a JSON API, and hold the in-memory session STATE.

---

## Architecture — three layers

```
┌─────────────────────────────────────────────────────────────────┐
│  BROWSER  (static/js/)                                          │
│                                                                 │
│  main.js ──► panel router ──► modules/xxx.js (one per step)    │
│                                     │                           │
│                               api.js (fetch wrapper)           │
└─────────────────────────────────────────┬───────────────────────┘
                                          │  JSON over HTTP
┌─────────────────────────────────────────▼───────────────────────┐
│  FLASK API  (app/api/)                                          │
│                                                                 │
│  data_api.py   model_api.py   prediction_api.py   ...          │
│       │               │                                         │
│       ▼               ▼                                         │
│  app/data/      app/ml/models/                                  │
│  (ingestion,    (GPRModel, RFModel, LinearModel,                │
│   cleaning,      RBFModel, PCEModel)                            │
│   normalization) │                                              │
│                  ▼                                              │
│           app/ml/sensitivity/   app/ml/uncertainty/            │
└──────────────────────────┬──────────────────────────────────────┘
                           │  read / write
┌──────────────────────────▼──────────────────────────────────────┐
│  STATE  (app/state/schema.py)                                   │
│                                                                 │
│  One Python dict, stored in app.config['STATE'].               │
│  Single source of truth for every DataFrame, trained model,    │
│  config choice, audit event, and UI preference.                │
└─────────────────────────────────────────────────────────────────┘
```

---

## The five files that everything depends on

Read these first, in this order. Everything else makes sense after.

| # | File | Why it matters |
|---|---|---|
| 1 | `config/settings.py` | Every constant in one place. Skim it once — you'll recognise the names everywhere else. |
| 2 | `app/state/schema.py` | Defines the shape of STATE. The comments on `raw` immutability and the `_datasets` accumulator are load-bearing. |
| 3 | `app/__init__.py` | Flask factory. Blueprint registration order. Four error handlers. 200 lines, then you understand the server. |
| 4 | `app/ml/models/base_model.py` | The ABC that every surrogate implements: `fit()`, `predict()`, `cross_validate()`, `get_summary()`. Reading this tells you the contract before you look at any concrete model. |
| 5 | `static/js/main.js` | The panel router. Search for `STEP_KEYS`, `stepUnlocked`, `stepCompleted`, and the `_initPanel` switch. This is how the 16-step sidebar works. |

---

## Complete data flow: CSV → trained model → prediction

```
  User selects a CSV file
         │
         ▼
  [Browser] main.js → _handleFile()
         │  POST /api/data/upload (multipart FormData)
         ▼
  [Flask]  data_api.py → upload()
         │
         ▼
  app/data/ingestion.py → ingest_csv()
    • validates size, encoding, row/column counts
    • coerces columns to float where possible
    • computes per-column stats (mean, std, nulls, skew)
         │
         ▼
  STATE['datasets']['primary']['raw']     ← written once, NEVER modified
  STATE['datasets']['primary']['clean']   ← copy; all cleaning writes here
  STATE['datasets']['primary']['metadata']
         │
         │  User cleans data (optional)
         ▼
  POST /api/data/clean/nulls|outliers|duplicates|transform
  app/data/cleaning.py  (non-mutating — always returns new DataFrame)
  → STATE['primary']['clean'] updated
         │
         │  User designates columns and normalises
         ▼
  POST /api/data/designate  → metadata.input_columns / output_columns
  POST /api/data/normalize  → app/data/normalization.py
  → STATE['primary']['normalized']
         │
         │  User filters inputs (optional — Step 8)
         ▼
  PUT /api/data/screen/apply (mode="columns")
  → updates metadata.input_columns to the selected subset; clears trained model

  PUT /api/data/screen/apply (mode="pca")
  → fits PCA on normalized inputs; injects PC columns into normalized DataFrame
  → STATE['surrogate_sessions']['primary']['pca'] = {
        original_inputs, component_names, pca_object, n_components, ...
    }
  → metadata.input_columns updated to PC names ['PC1', 'PC2', ...]
  NOTE: the prediction pipeline checks for STATE[...]['pca'] and applies the
  transform automatically — raw physical inputs → PC space → model.predict()
         │
         │  User configures and trains
         ▼
  POST /api/model/configure → STATE['surrogate_sessions']['primary']['config']
  POST /api/model/train     → model_api.py → train()
         │
         ├─► picks model class from SUPPORTED_MODEL_TYPES:
         │     gpr     → GPRModel      (sklearn GaussianProcessRegressor, MultiOutputRegressor;
         │                              kernels: RBF, Matérn 1.5/2.5, Rational Quadratic)
         │     rf      → RFModel       (sklearn RandomForestRegressor, MultiOutputRegressor)
         │     rbf     → RBFModel      (scipy RBFInterpolator)
         │     pce     → PCEModel      (chaospy)
         │     linear  → LinearModel   (sklearn Ridge)
         │
         ├─► model.fit(X_train, y_train, input_cols, output_cols)
         ├─► model.cross_validate(X_train, y_train, cv_folds)
         ├─► y_pred_test = model.predict(X_test)
         │
         ▼
  STATE['surrogate_sessions']['primary']['models']['trained']  ← fitted model object
  STATE['surrogate_sessions']['primary']['models']['results']  ← metrics dict
         │
         │  User predicts
         ▼
  POST /api/predict/single  → prediction_api.py
    • applies same normalization scaler used during training
    • calls model.predict(X_new)
    • checks for extrapolation (value outside training range)
    → returns predicted outputs + out-of-range flags

  POST /api/predict/batch   → same pipeline on uploaded CSV rows
```

---

## Frontend flow: how a panel renders

```
  User clicks sidebar step (e.g. "Results")
         │
         ▼
  main.js → _navigate(key)
    • hides all panel divs, shows panelEls[key]
    • if panelDone[key] is false → calls _initPanel(key)
         │
         ▼
  _initPanel switch:
    case "results": await _initResultsPanel(container, key)
         │
         ▼
  _initResultsPanel → import { initResults } from "./modules/results.js"
    • calls GET /api/model/results via api.js
    • builds DOM (tables, badges, charts)
    • calls renderOutputFigure() from charts.js for parity/residual plots
         │
         ▼
  charts.js → Plotly.react(containerEl, traces, layout, config)
    ← only file in the codebase that calls Plotly.*
```

Key rules:
- Panels are **lazy-initialized** — `_initPanel` only runs once per panel per session (unless `panelDone[key] = false` is set to force a refresh, e.g. after retraining or re-normalization).
- All HTTP calls go through `api.js` — `get()`, `post()`, `put()`. Never `fetch()` directly in a module.
- All charts go through `charts.js`. Never `Plotly.*` in a module.
- All toasts go through `notifications.js`. Never `alert()` or inline DOM.

---

## Multi-dataset sessions

The STATE holds one "primary" slot (the active dataset) and a `_datasets` accumulator (all loaded datasets keyed by filename). Each dataset has its own trained model, results, interpretation cache, and PCA state. Switching datasets:

```
  User clicks dataset in switcher
         │
         ▼
  PUT /api/state/session { active_dataset_key: "filename.csv" }
         │
         ▼
  state_api.py → saves current primary surrogate session into
                 _datasets[old_key]['surrogate_session']
               → mirrors new dataset into STATE['datasets']['primary']
               → restores new dataset's surrogate session if it exists
         │
         ▼
  Frontend refreshes all panels (panelDone reset to false)
```

This means: **each dataset has its own trained model, results, and interpretation cache.** Training on dataset A and then switching to dataset B does not overwrite dataset A's model.

---

## Adding a new sidebar step (quick reference)

Full recipe is in `docs/DEVELOPER.md`. In brief:

1. Add the key to `STEP_KEYS`, `STEP_LABELS`, `STEP_NUMS` in `main.js`
2. Add `false` to `stepUnlocked` and `stepCompleted`
3. Add `case "key":` to the `_initPanel` switch
4. Create `static/js/modules/yourkey.js` with `export async function initYourKey(containerEl)`
5. Create `app/api/yourkey_api.py` Blueprint; register it in `app/__init__.py`
6. Wire the unlock condition (after which step does this become available?)
7. If the new step stores anything in STATE, document it in `docs/SCHEMA.md`

---

## Common gotchas for Python/ML engineers

**STATE is a plain dict, not a class.** There are no setters or validators. Writing to a wrong key silently creates a new key rather than raising. If something mysteriously has no effect, check that you're writing to the right nested path.

**`raw` is sacred.** `STATE['datasets']['primary']['raw']` is written once on upload. Any code that modifies it will break the reset and undo flows. Always read from `clean` or `normalized`.

**DataFrame serialization.** DataFrames cannot be JSON-serialized directly. The `GET /api/state/` endpoint uses `get_state_json_safe()` in `schema.py` which replaces DataFrames with `{"_type": "dataframe", "shape": [...], "columns": [...]}`. If you're adding a new API endpoint that returns data, serialize via `df.to_dict(orient="records")` or `df.values.tolist()`.

**Multi-output models.** All models wrap sklearn estimators in `MultiOutputRegressor` when there is more than one output column. `model._model` is the `MultiOutputRegressor`; `model._model.estimators_[i]` is the per-output estimator. This matters for GPR where `predict(X, return_std=True)` must be called on the inner estimator, not the outer wrapper.

**No page reloads.** The app is a SPA. Flask's 404 handler returns `index.html` for any non-`/api/` path so deep links work. If you navigate to `/` and the JS router shows a blank screen, check the browser console — a JS import error will prevent the router from booting.

---

## Recommended reading order

1. `README.md` — 5 min
2. `config/settings.py` — 10 min (all constants, now all commented)
3. `app/state/schema.py` — 15 min (understand STATE shape; read the inline comments)
4. `app/__init__.py` — 10 min (factory, blueprints, error handlers)
5. `app/data/ingestion.py` — 10 min (what happens to a CSV on upload)
6. `app/ml/models/base_model.py` → `gpr_model.py` — 15 min (model interface + one concrete example)
7. `app/api/model_api.py` — 15 min (how train/results/interpret endpoints work)
8. `static/js/main.js` — 10 min (search for `STEP_KEYS` to find the panel router)
9. `static/js/modules/results.js` — 10 min (a representative frontend module)
10. `tests/integration/test_full_workflow.py` — 10 min (end-to-end in code)
