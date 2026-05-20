# Surrogate Modeling Toolkit

A dual-purpose surrogate modeling tool for engineers and their teams.

**Practical tool** — load analytical or test data, train validated surrogate models (GPR, Random Forest, Linear), use them for fast predictions, sensitivity analysis, design space optimization, multi-dataset comparison, and automated HTML report generation.

**Teaching tool** — junior engineers learn surrogate modeling concepts through guided workflows, contextual explanations, and a learning mode toggle.

**Current version:** v3.0.0 — Milestone 3 (M3) complete.

---

## Quickstart

```bash
# 1. Create environment (Python 3.9, Anaconda recommended)
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

## What it does

The toolkit guides engineers through a 14-step sidebar workflow:

| Step | Name | Description |
|---|---|---|
| 1 | Upload | CSV upload with full validation (size, encoding, headers, row/column counts) |
| 2 | Preview | 10-row data preview table with null highlighting |
| 3 | Explore | Scatter plot matrix (up to 12 columns), per-column statistics, correlation matrix |
| 4 | Clean | Null imputation, outlier removal (IQR), duplicate removal, log-transform |
| 5 | Designate | Label each column as input, output, or unused |
| 6 | Normalize | Min-max or z-score normalization of input columns |
| 7 | Configure | Select model type (GPR, RF, Linear), test split, CV folds, hyperparameters |
| 8 | Results | Test metrics (R², RMSE, MAE), parity plots, residual plots, CV summary; GPR gets ±1.96σ error bars |
| 9 | Predict | Single-point and batch prediction with extrapolation warnings |
| 10 | Optimize | Single-objective (differential evolution) and multi-objective (NSGA-II/pymoo) optimization |
| 11 | Interpret | Sobol global sensitivity indices, one-at-a-time response curves, GPR/RF uncertainty intervals |
| 12 | Active | Active learning recommendations — coverage mode (uncertainty) and objective mode (expected improvement) |
| 13 | Compare | Side-by-side comparison of two trained surrogates: metrics table, prediction scatter, bias histogram, linear error model |
| 14 | Export | Self-contained HTML analysis report with classification watermark; ITAR/EAR acknowledgment gate; export audit log |

---

## Data format

Upload a CSV with:
- One row per data point
- One column per variable (inputs and outputs together)
- All numeric values (int or float)
- A header row with unique column names
- At least 5 rows and 2 columns

Maximum file size: 500 MB. Maximum 500,000 rows.

---

## Multi-dataset sessions

Load up to 5 datasets in one session using **+ Load File** in the global header. Each dataset gets its own surrogate session (model, results, interpretation). Switch between datasets using the header switcher — the previous dataset's trained model is preserved.

---

## Project structure

```
surrogate-toolkit/
├── run.py                      # Development entry point
├── requirements.txt
├── config/settings.py          # All constants (single source of truth)
├── app/
│   ├── __init__.py             # Flask factory (create_app)
│   ├── state/schema.py         # Canonical STATE dict
│   ├── routes/main.py          # SPA shell route
│   ├── api/                    # Blueprint modules
│   │   ├── data_api.py         # /api/data/*
│   │   ├── state_api.py        # /api/state/*
│   │   ├── model_api.py        # /api/model/*
│   │   ├── prediction_api.py   # /api/predict/*
│   │   ├── active_learning_api.py  # /api/active/*
│   │   ├── optimization_api.py # /api/optimize/*
│   │   ├── comparison_api.py   # /api/comparison/*
│   │   └── export_api.py       # /api/export/*
│   ├── ml/                     # ML modules
│   │   ├── models/             # GPR, RF, Linear surrogate wrappers
│   │   ├── sensitivity/        # Sobol + OAT analyzers
│   │   ├── uncertainty/        # Bootstrap + tree-variance CI
│   │   ├── optimization/       # Single-objective + NSGA-II
│   │   └── active_learning/    # Coverage + objective mode
│   ├── compliance/             # Classification watermarks, audit log
│   ├── report/                 # HTML report generator
│   └── templates/              # Jinja2 templates (index.html, report)
├── static/
│   ├── js/main.js              # SPA entry point + panel router
│   ├── js/charts.js            # Plotly wrapper (only file that calls Plotly.*)
│   ├── js/modules/             # One module per sidebar step
│   └── css/main.css            # All styles
└── tests/                      # pytest unit + integration tests
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
