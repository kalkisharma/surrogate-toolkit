# Teaching Guide

**Version:** v3.5.77 | **Last updated:** 2026-06-04

Documents the live learning mode system — how it works, how to add new content, and what is currently implemented across Phases 12, 13, and 17.

---

## Overview

The toolkit has two audiences:

1. **Practicing engineers** — want to get results fast; learning content should stay out of their way
2. **Junior engineers / students** — need context on what each step does and why it matters

The learning mode system bridges both. When **Learning Mode** is off, the UI is clean and minimal. When it's on, concept primers, expanded tooltips, and explanatory text appear in-place without leaving the workflow.

---

## Learning mode toggle

Location: global header (top-right, **Learning** button).

State is stored in `STATE['session']['learning_mode']` (boolean) and mirrored to `localStorage` so it persists across page refreshes. The toggle fires a `PUT /api/state/session` call to sync to the server.

---

## Concept primers

Primers are expandable info cards that appear just below each panel's section header when learning mode is on.

### Registering a primer

```javascript
import { registerPrimer } from "../learning_mode.js";

// Inside your panel init function:
registerPrimer(
  "unique-id",        // arbitrary key — used to de-duplicate
  anchorEl,           // the element to insert the primer after
  "Question text",    // collapsed label (e.g. "What is normalization?")
  `<p>HTML content</p>` // expanded body — supports full HTML
);
```

The primer is only rendered if learning mode is currently on. If the user toggles learning mode while on the panel, primers appear/disappear without re-initializing the panel.

### Writing good primers

- Lead with a one-sentence plain-English answer to the question in the label
- Use `<strong>` for key terms on first introduction
- Avoid jargon without definition
- Relate to something the engineer already knows ("Like a lookup table, but…")
- Keep it under 5 short paragraphs
- End with a decision tip ("Use GPR if your dataset has < 1,000 rows…")

### Current primers (all 16 steps)

| Step | Primer question |
|---|---|
| Upload | (validation guidance shown inline) |
| Preview | What do the highlighted cells mean? |
| Explore | What does this scatter matrix show? |
| Clean | Why remove outliers before training? |
| Subset | When should I restrict the training region? |
| Assign | What's the difference between inputs and outputs? |
| Normalize | Why normalize inputs? |
| Filter | What is multicollinearity and why does it matter? |
| Model | How do I choose between GPR, RF, and Linear? |
| Results | How do I know if my model is good enough? |
| Predict | What do extrapolation warnings mean? |
| Optimize | What does an objective function do? |
| Interpret | What does sensitivity analysis tell me? |
| Sample | When should I run more experiments? |
| Compare | What does this comparison show? |
| Export | (classification guidance shown inline) |

---

## Experience levels

The global header has a **Level** selector: Beginner / Intermediate / Expert. State is stored in `STATE['session']['experience_level']`.

Current behavior by level:

| Level | Primers | Advanced controls | Notes |
|---|---|---|---|
| **Beginner** | Expanded by default | Hidden | GPR kernel selector hidden; simplified defaults |
| **Intermediate** | Collapsed by default (expandable) | Visible | GPR kernel selector, RF max_depth, extra CV options |
| **Expert** | Collapsed by default | All exposed | Raw STATE viewer accessible; no out-of-range warnings |

Level persists across page reloads. Switching level takes effect immediately — no page reload required.

---

## Tooltips

Tooltips appear on hover over labels, axis names, and metric values. They are visible regardless of learning mode — always-on context for terms that may be unfamiliar.

```javascript
import { registerTooltip } from "../learning_mode.js";

registerTooltip(
  element,          // DOM element to attach to
  "Tooltip text"    // plain text or short HTML
);
```

---

## Learning Guide modal

The **Guide** button in the global header opens a six-tab reference modal available at all experience levels.

### Tab 1 — Glossary

Live-searchable list of 50+ terms across 11 categories (Data Preparation, Model Types, Metrics, Uncertainty, Sensitivity, Active Learning, Optimization, Multi-Fidelity, PCE, Normalization, General).

**Backend:** `GET /api/learning/glossary` — returns all entries from `app/learning/glossary.json`.

**Adding a term:** Add an entry to `app/learning/glossary.json`:
```json
{
  "term": "Surrogate Model",
  "definition": "A fast mathematical approximation of an expensive simulation...",
  "category": "Model Types"
}
```

### Tab 2 — Model Guide

Collapsible cards for each model type (GPR, RF, Linear, RBF, PCE, Kriging, Co-Kriging, Ensemble). Each card shows: description, strengths, weaknesses, best-for, avoid-when.

**Backend:** `GET /api/learning/models` — returns all entries from `app/learning/models.json`.

### Tab 3 — Topics

Sidebar navigation with curated topic articles and interactive decision trees.

**Available topics:**

| Topic key | Content |
|---|---|
| `diagnostics` | R², RMSE, MAE, parity plot patterns, residual patterns, CV vs test |
| `uncertainty` | GPR native posterior, RF tree variance, extrapolation, ensemble proxy |
| `cv_strategies` | k-fold, LOO, GPR-specific, multi-fidelity CV, fold count selection |
| `sensitivity` | Sobol S₁/Sₜ, Saltelli sampling, OAT, tornado chart interpretation |
| `active_learning` | Space-filling vs goal-directed, LHS, EI acquisition, UCB, residual mode |
| `data_cleaning` | Missing values, IQR outlier detection, log-transform, duplicates, correlation |
| `normalization` | Min-Max vs Z-Score vs Log₁₀ decision guide; what happens without normalization |
| `input_filtering` | Pearson r, VIF, low-variance drop, PCA dimensionality reduction, manual vs PCA trade-offs |
| `multifidelity` | When to use MF, Bridge Correction, Co-Kriging, dataset preparation, interpreting MF results |
| `model_troubleshooting` | Reading underfitting/overfitting signals, wrong model choice, high dimensionality, data quality checklist |
| `optimization` | Single vs multi-objective, reading the Pareto front, constraints, when not to use surrogate optimization |
| `model_selection` (decision tree) | 16-node flowchart: GPR vs RF vs Linear by dataset size, dimensionality, smoothness |
| `cv_selection` (decision tree) | 12-node flowchart: fold count by dataset size, model type, auto-tune |
| `kernel_selection` (decision tree) | RBF vs Matérn 1.5/2.5 vs Rational Quadratic selection; optimizer restarts; alpha noise floor |

**Backend:** `GET /api/learning/content/<topic>` — reads from `app/learning/<topic>.json`.

**Adding a topic:**
1. Create `app/learning/<topic>.json` with a `sections` array (each section: `title`, `body` with HTML string)
2. Add `"<topic>": "<topic>.json"` to `_TOPIC_FILES` in `app/api/learning_api.py`
3. Add the topic to the Topics sidebar nav in `static/js/modules/learning_guide.js` `_TOPICS` array

### Tab 4 — Exercises

Structured guided workflows that auto-load synthetic datasets and walk engineers step-by-step through the 16-panel workflow. See the **Exercises** section below for full documentation.

### Tab 5 — Symbols

Searchable reference table of Greek letters, math notation, subscripts/superscripts, and abbreviations used throughout the toolkit.

**Backend:** `GET /api/learning/symbols` — returns entries from `app/learning/symbols.json`.

### Tab 6 — Equations

10 curated equations with HTML-rendered formulas, where-clauses, and engineering notes. Covers: GPR prediction, Matérn kernel, Sobol indices, Expected Improvement, Ridge regression, and others.

**Backend:** `GET /api/learning/equations` — returns entries from `app/learning/equations.json`.

---

## Exercises

### Overview

The Exercises tab presents a library of guided workflow scripts. Each exercise:
- Auto-loads a synthetic dataset (no real program data)
- Walks the engineer panel-by-panel with step instructions
- Includes optional quiz questions at key decision points
- Tracks progress in STATE (survives save/load)

### Exercise list

| ID | Title | Difficulty | Minutes | Dataset |
|---|---|---|---|---|
| `ex_01_basic_gpr` | Your First GPR Surrogate | Beginner | 15 | `simple_quadratic.csv` |
| `ex_02_model_selection` | Choosing the Right Model | Intermediate | 20 | `nonlinear_3d.csv` |
| `ex_03_data_cleaning` | Cleaning a Messy Dataset | Beginner | 20 | `dirty_dataset.csv` |
| `ex_04_sensitivity` | Sobol Sensitivity — Ishigami Function | Intermediate | 25 | `ishigami_5d.csv` |
| `ex_05_active_learning` | Where to Run the Next Experiment | Intermediate | 20 | `sparse_4d.csv` |
| `ex_06_pca_filter` | Correlated Inputs and PCA | Intermediate | 25 | `pca_correlated_6d.csv` |
| `ex_07_multifidelity` | Bridge Correction — LF/HF Fusion | Intermediate | 30 | `multifidelity_lf.csv` + `multifidelity_hf.csv` |
| `ex_08_model_selection` | Model Selection Comparison | Intermediate | 25 | `model_comparison_2d.csv` |
| `ex_09_alpha_regularization` | Alpha Regularization | Intermediate | 20 | `alpha_noisy_2d.csv` |
| `ex_10_optimization` | Surrogate-Based Optimization & Pareto Front | Intermediate | 30 | `aero_pareto_2d.csv` |
| `ex_11_noise_weighting` | Heteroscedastic Noise Weighting | Expert | 25 | `hetero_noise_2d.csv` |
| `ex_12_pce` | PCE and Analytical Sobol Indices | Expert | 25 | `ishigami_5d.csv` |

Synthetic datasets live in `app/learning/datasets/`. They are generated analytically (NumPy) — no real program data. Row counts are sized for fast GPR training (< 10 s).

### Exercise JSON schema

```json
{
  "id": "ex_01_basic_gpr",
  "title": "Your First GPR Surrogate",
  "difficulty": "beginner",
  "estimated_minutes": 15,
  "dataset": "simple_quadratic.csv",
  "steps": [
    {
      "step_num": 1,
      "target_panel": "preview",
      "instruction": "Review the 10-row preview. Note the column names — x1 and x2 are inputs, y is the output.",
      "keywords": ["preview", "column names"],
      "quiz": null
    },
    {
      "step_num": 2,
      "target_panel": "explore",
      "instruction": "Open the scatter matrix. Look at the x1 vs y plot.",
      "keywords": ["scatter matrix", "SPLOM"],
      "quiz": {
        "question": "What does the x1 vs y scatter suggest about their relationship?",
        "options": ["Linear", "Quadratic", "No relationship", "Exponential"],
        "correct_index": 1,
        "explanation": "The curve in the scatter indicates a nonlinear (quadratic) response. A linear model will underfit this data."
      }
    }
  ]
}
```

**Fields:**
- `target_panel` — sidebar step key (e.g. `"preview"`, `"explore"`, `"normalize"`, `"configure"`, `"results"`)
- `keywords` — list of terms linked to glossary entries; rendered as highlighted links in the instruction text
- `quiz` — optional; `null` means no quiz on this step. Quiz answers are advisory — wrong answers never block progress

### Quiz behavior

- Question card appears below the step instruction
- Engineer selects an option → sees correct/incorrect indicator + full explanation
- **Next step** button is always available — no correct answer required to advance
- Quiz answers are stored in `STATE['session']['exercise_progress'][id]['quiz_answers']`

### Progress tracking

```python
STATE['session']['exercise_progress'] = {
  "ex_01_basic_gpr": {
    "steps_completed": [1, 2, 3],
    "quiz_answers": {2: 1, 5: 0},
    "started_at": "2026-06-04T14:30:00Z",
    "completed_at": None
  }
}
```

Progress persists in `.surrogate` save files.

### Backend endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/learning/exercises` | List all exercises with metadata + user progress |
| `GET` | `/api/learning/exercises/<id>` | Full exercise definition (steps + quizzes) |
| `POST` | `/api/learning/exercises/<id>/start` | Inject dataset into STATE; returns upload metadata |
| `POST` | `/api/learning/exercises/progress` | Record step completion and quiz answer |

### Adding a new exercise

1. Create `app/learning/exercises/ex_NN_<name>.json` following the schema above
2. Create or reuse a synthetic dataset in `app/learning/datasets/` (generate with NumPy; document the ground-truth function in a comment)
3. The exercise appears automatically in the Exercises tab — no backend registration required
4. Keep row counts under 300 and input count under 8 for exercises targeting beginners
5. Add the exercise to the table above in this file

---

## Inline learning integration (model selection guide)

In the Model step (Step 9), an inline "Help me choose" collapsible panel is available at Intermediate and Expert levels. It runs the same interactive decision tree as the Topics tab (`model_selection` guide) without opening the Guide modal.

Implemented in `static/js/modules/model_config.js`.

---

## Keyword annotation system

Exercise instruction text supports `keywords` arrays. Words in the instruction that match glossary terms are rendered as clickable inline links — clicking opens the glossary entry in the Guide modal without leaving the exercise.

Implemented in `static/js/modules/learning_guide.js` `_annotateKeywords()`.
