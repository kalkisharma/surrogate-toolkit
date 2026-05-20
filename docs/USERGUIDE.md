# User Guide

**Version:** v3.0.0 | **Last updated:** 2026-05-20

A step-by-step walkthrough of the 14-step surrogate modeling workflow.

---

## Getting started

1. Launch the app: `python run.py`
2. Open `http://127.0.0.1:5000` in your browser
3. Drag-and-drop a CSV file onto the upload zone, or click to browse

---

## Step 1 — Upload

**What it does:** Validates and loads your CSV file.

**Requirements:**
- All numeric values (int or float)
- Header row with unique column names
- At least 5 rows and 2 columns
- Under 500 MB and 500,000 rows

**Tips:**
- Column names become the variable labels throughout the workflow — use descriptive names (e.g., `mach_number`, `lift_coefficient`)
- Missing values (blanks, NaN) are allowed up to 30% per column; beyond that the column is rejected
- You can load up to 5 datasets in one session using **+ Load File** in the header

---

## Step 2 — Preview

**What it does:** Shows the first 10 rows of your data with null values highlighted in amber.

Use this to confirm the file parsed correctly — check that numeric columns didn't get coerced, and that the header row matches your expectations.

---

## Step 3 — Explore

**What it does:** Scatter plot matrix (SPLOM) and per-column statistics.

- Click any cell in the SPLOM to focus on that pair
- IQR outliers are highlighted in the plot when the outlier overlay is on
- The **Column Selector** lets you filter which columns appear in the SPLOM (max 12)
- The **Stats** section shows mean, std, median, min, max, skewness, and null count per column
- The **Correlate** tab shows a Pearson and distance correlation matrix — useful for spotting redundant inputs before designation

**Plot settings:** Click the gear icon to adjust font size, marker style, figure dimensions, gridlines, and color palette.

---

## Step 4 — Clean

**What it does:** Improve data quality before training.

Available operations (applied in order):

| Operation | Options |
|---|---|
| **Nulls** | Drop rows with any null / Mean impute / Median impute |
| **Outliers** | Keep (flag only) / Drop rows (IQR × 1.5) |
| **Duplicates** | Remove exact duplicate rows |
| **Log-transform** | Apply log(1+x) to columns where \|skew\| > 1.0 |

Each operation can be undone individually. **Reset** restores the data to the original upload.

**Tip:** Check the stats panel before and after cleaning to confirm the operation had the intended effect.

---

## Step 5 — Designate

**What it does:** Labels each column as **Input**, **Output**, or **Unused**.

- **Input** — variables you control or observe (features, independent variables)
- **Output** — quantities the surrogate will predict (responses, dependent variables)
- **Unused** — columns excluded from modeling (IDs, timestamps, metadata)

At least one input and one output are required. The designation is saved per dataset — switching datasets and coming back preserves your labels.

---

## Step 6 — Normalize

**What it does:** Scales input columns before training.

| Method | Formula | When to use |
|---|---|---|
| **Min-Max** | (x − min) / (max − min) → [0, 1] | Most cases; GPR and RF are scale-sensitive |
| **Z-Score** | (x − mean) / std | When inputs have very different variances |
| **None** | No scaling | Linear models only; or if data is already scaled |

Normalization is applied to inputs only. Outputs are never scaled — predictions are always in the original output units.

---

## Step 7 — Configure & Train

**What it does:** Select the surrogate model type, set training parameters, and train.

### Model types

| Type | Best for | Notes |
|---|---|---|
| **GPR** (Gaussian Process) | Small datasets (< 5,000 rows), uncertainty quantification | Returns posterior std; slower on large data |
| **RF** (Random Forest) | Medium datasets, noisy data, non-linear relationships | Fast; tree-variance uncertainty available |
| **Linear** | Simple relationships, interpretability | No uncertainty estimates |

### Parameters

| Parameter | Default | Range |
|---|---|---|
| Test split | 0.20 | 0.05 – 0.50 |
| CV folds | 5 | 2 – 20 |

### Auto-tune

Click **Auto-tune** to run a grid search over key hyperparameters (GPR kernel length scale, RF n_estimators/max_features, etc.) and automatically populate the best settings.

---

## Step 8 — Results

**What it does:** Shows training diagnostics for the fitted model.

- **Test metrics** — R², RMSE, MAE on the held-out test set (one row per output)
- **Parity plot** — predicted vs. actual; points should hug the diagonal. GPR models show ±1.96σ error bars
- **Residual plot** — residuals vs. predicted; should show no pattern
- **CV summary** — mean ± std of R² across k folds

**Interpreting R²:**
- > 0.95 — excellent fit
- 0.85 – 0.95 — good; suitable for most engineering decisions
- 0.70 – 0.85 — caution; predictions carry meaningful uncertainty
- < 0.70 — poor; consider more data, different model type, or better features

---

## Step 9 — Predict

**What it does:** Use the trained surrogate to make predictions.

**Single-point:** Enter values for each input column, click **Predict**. Extrapolation warnings appear when any input is outside the training range (caution at 110%, warning at 125%).

**Batch:** Upload a CSV with input columns (outputs optional — if present they're used for validation). Results download as CSV with predicted values appended.

---

## Step 10 — Optimize

**What it does:** Find input combinations that optimize one or more outputs.

### Single-objective

Select an output and direction (minimize or maximize). Optionally add per-input bounds and output constraints. The optimizer (differential evolution) searches the input space and returns the best point found.

### Multi-objective

Select two or more outputs, each with its own direction. The optimizer (NSGA-II) returns a Pareto front — the set of solutions where you cannot improve one objective without degrading another.

**Tip:** For GPR models, a high-uncertainty warning at the optimum means the model has low confidence there. Consider running Active Learning (Step 12) to gather data in that region first.

---

## Step 11 — Interpret

**What it does:** Understand which inputs drive your outputs and how confident the model is.

### Sobol sensitivity indices

- **S₁ (First-order)** — fraction of output variance explained by that input alone
- **Sₜ (Total-order)** — includes interactions with all other inputs; always ≥ S₁
- High Sₜ, low S₁ = input matters mainly through interactions

### OAT curves

Each input is varied from min to max while all others are held at their training median. Shows the shape of the response to each input independently.

### Uncertainty

- **GPR** — native posterior std; 95% CI shown as error bars on parity plots
- **RF** — tree-variance CI (percentile spread across all trees)
- **Linear** — no native uncertainty estimates

---

## Step 12 — Active Learning

**What it does:** Recommends where to run your next experiments to maximize model improvement.

**Coverage mode:** Recommends points in under-sampled regions of the input space (maximizes minimum distance to existing training data).

**Objective mode:** Recommends points where the surrogate predicts a good outcome AND has high uncertainty (Expected Improvement — explores uncertain regions that are likely to beat the current best).

The recommendation table shows ranked points with predicted values and uncertainty scores. Export to CSV to pass to your simulation tool.

---

## Step 13 — Compare

**What it does:** Compare two trained surrogates side-by-side.

Typical use cases:
- GPR vs. RF on the same dataset — which fits better?
- Low-fidelity dataset model vs. high-fidelity dataset model — how large is the systematic bias?

**How it works:**
1. Select Dataset A and Dataset B (both must have trained models)
2. Choose LHS sample count (200 is usually sufficient)
3. Click **Compare** — both models are evaluated at the same Latin Hypercube sample points

**Results:**
- **Metrics table** — R²/RMSE/MAE from each model's own test set, side by side; better values are highlighted
- **Prediction scatter** — Model A vs. Model B at each LHS point; points near the 1:1 diagonal mean the models agree
- **Bias histogram** — distribution of Δ = B − A; mean near zero means global consistency
- **Error model** — linear regression of Δ as a function of inputs; high R² means bias is concentrated in a specific region of the input space

---

## Step 14 — Export

**What it does:** Generate a self-contained HTML analysis report.

The report automatically includes all completed workflow steps:
- Dataset summary and column designation
- Cleaning operations applied
- Model configuration and test metrics
- Parity plots (rendered as interactive Plotly charts)
- Sobol sensitivity table (if interpretation was run)
- Active learning history (if recommendations were generated)
- Full audit trail

### Classification

Set the classification level before generating:

| Level | Watermark | Gate |
|---|---|---|
| Unclassified | Green banner | None |
| CUI | Blue banner | None |
| ITAR | Red banner | Explicit acknowledgment checkbox required |
| EAR | Red banner | Explicit acknowledgment checkbox required |

The report filename includes the classification level and a timestamp. All exports are logged in the audit trail with SHA-256 hash.

---

## Global header controls

| Control | Description |
|---|---|
| **Theme** | Light/dark mode toggle; persists across sessions |
| **Level** | Experience level (Beginner/Intermediate/Expert) — controls primer visibility |
| **Cores** | Processor count for parallel operations |
| **Learning mode** | Toggle to show/hide all concept primers |
| **+ Load File** | Add a second dataset to the session |
| **Save / Open** | Save the entire session to a `.surrogate` file, or restore a previous session |
| **✕ Clear** | Reset all datasets and return to the upload screen |

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| Click sidebar step | Navigate to that step (if unlocked) |
| `‹` / `›` button | Collapse/expand the sidebar |
