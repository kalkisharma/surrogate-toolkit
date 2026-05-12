# Surrogate Modeling Toolkit

A dual-purpose surrogate modeling tool for engineers and their teams.

**Practical tool** — load analytical or test data, train validated surrogate models (GPR, Random Forest, Linear), and use them for fast predictions and design space exploration.

**Teaching tool** — junior engineers learn surrogate modeling concepts through guided workflows, contextual explanations, and a learning mode toggle.

---

## Quickstart

```bash
# 1. Create environment
conda env create -f environment.yml
conda activate surrogate-toolkit

# or with pip:
pip install -r requirements.txt

# 2. Configure (optional)
cp .env.example .env
# Edit .env to change HOST, PORT, or enable DEBUG

# 3. Run
python run.py
```

Open `http://127.0.0.1:5000` in your browser.

---

## What it does (Phase 1 — v0.1.7)

- **CSV upload** — drag-and-drop with full validation: size, encoding, headers, row/column counts, float coercion, null tolerance
- **Data type gate** — single pre-exploration question (analytical vs. test data); experience level and processor count configured via the persistent global header
- **Data exploration** — scatter plot matrix using up to 2,000 rows, IQR-based outlier overlay, per-column summary statistics displayed below the chart
- **Plot settings panel** — expandable controls: label/tick font size, marker size/opacity/edge color/edge width, figure height/width, major/minor gridlines, marker palette (3 presets), PNG save; all settings persisted to `localStorage`
- **Theme** — light mode default with dark mode toggle; preference persists across sessions and resets cleanly on version upgrade
- **Learning mode** — collapsible concept primers, expanded tooltips, toggle in the global header

---

## Data format

Upload a CSV with:
- One row per data point
- One column per variable (inputs and outputs together)
- All numeric values (int or float)
- A header row with unique column names
- At least 5 rows and 2 columns

---

## Project structure

```
surrogate_tool/
├── run.py                  # Development entry point
├── requirements.txt
├── config/settings.py      # All constants (single source of truth)
├── app/
│   ├── __init__.py         # Flask factory (create_app)
│   ├── state/schema.py     # Canonical STATE dict
│   ├── api/data_api.py     # /api/data/* endpoints
│   ├── api/state_api.py    # /api/state/* endpoints
│   └── data/ingestion.py   # CSV validation pipeline
├── static/
│   ├── js/main.js          # SPA entry point
│   ├── js/charts.js        # Plotly wrapper (only file that calls Plotly.*)
│   └── js/modules/         # Feature modules
└── tests/                  # pytest unit + integration tests
```

See `docs/DEVELOPER.md` for full developer setup and architecture notes.

---

## Production deployment

```bash
gunicorn "app:create_app()"
```

The app runs on a single machine with no external services required. One instance per engineer. All data stays local.

---

## License

Copyright © 2026 Kalki Sharma. All rights reserved.
Licensed for internal use by Lockheed Martin employees only.
See `LICENSE.md` for full terms.
