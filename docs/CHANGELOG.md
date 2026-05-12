# Changelog

All notable changes to the Surrogate Modeling Toolkit are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

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
