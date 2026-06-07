# User Guide

**Version:** v3.6.8 | **Last updated:** 2026-06-07

A step-by-step walkthrough of the 16-step surrogate modeling workflow.

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

**What it does:** Scatter plot matrix (SPLOM), per-column statistics, distance correlation heatmap, and 2D scatter plot.

- Click any cell in the SPLOM to focus on that pair
- IQR outliers are highlighted in the plot when the outlier overlay is on
- The **Column Selector** lets you filter which columns appear in the SPLOM (max 12)
- The **Stats** section shows mean, std, median, min, max, skewness, and null count per column
- The **Correlate** tab shows a Pearson and distance correlation matrix — useful for spotting redundant inputs before designation

**2D Scatter Plot:** Pick any two columns as X and Y axes. Use the per-column range sliders to filter rows — excluded points are dimmed (not hidden) so you can still see their location in the space. All settings (marker color, opacity, gridlines, font sizes) are adjustable in the settings panel.

**Plot settings (SPLOM):** Click the gear icon to adjust font size, marker style, figure dimensions, gridlines, and color palette.

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

## Step 5 — Subset

**What it does:** Permanently slice the dataset to a region of interest using per-column range filters.

Each column gets a dual-handle min/max slider. The live scatter preview shows which rows are included (solid) vs. excluded (dimmed) before you commit. Click **Apply** to permanently remove the excluded rows from all downstream steps.

**When to use:** Use Subset to restrict the surrogate to a specific operating envelope — e.g., train only on Mach 0.5–0.9 rather than the full 0.2–1.2 range of the dataset. This is different from Clean: Clean removes bad data, Subset focuses the training region.

**Note:** Subset is permanent for the session. Use **Reset** to restore the full cleaned dataset.

---

## Step 6 — Assign

**What it does:** Labels each column as **Input**, **Output**, or **Unused**.

- **Input** — variables you control or observe (features, independent variables)
- **Output** — quantities the surrogate will predict (responses, dependent variables)
- **Unused** — columns excluded from modeling (IDs, timestamps, metadata)

At least one input and one output are required. The designation is saved per dataset — switching datasets and coming back preserves your labels.

---

## Step 7 — Normalize

**What it does:** Scales input columns before training.

| Method | Formula | When to use |
|---|---|---|
| **Min-Max** | (x − min) / (max − min) → [0, 1] | Most cases; GPR and RF are scale-sensitive |
| **Z-Score** | (x − mean) / std | When inputs have very different variances |
| **Log₁₀** | log₁₀(x) applied per column | Right-skewed inputs with positive values spanning orders of magnitude |
| **None** | No scaling | Linear models only; or if data is already scaled |

Normalization is applied to inputs only. Outputs are never scaled — predictions are always in the original output units.

Click **Apply** before advancing to Step 8. A green checkmark in the sidebar confirms normalization is active. Before/after histograms are shown for Log₁₀ to let you confirm the transform had the intended effect.

---

## Step 8 — Filter

**What it does:** Identify and remove redundant or uninformative input columns before training — reducing dimensionality and improving model accuracy.

**Correlation heatmap:** Pearson |r| matrix across all input columns. Pairs with |r| ≥ 0.90 are flagged in the table below. You choose which column of each flagged pair to keep — the tool never auto-removes.

**VIF table:** Variance Inflation Factor per input. Three tiers:
- ✓ < 5 — OK
- ⚠ 5–10 — moderate multicollinearity
- ✗ ≥ 10 — high; pre-unchecked in the input list, but you can override

If Interpret (Step 13) has been run, the table also shows mean Sobol Sₜ alongside VIF — inputs that are both multicollinear AND insensitive are the strongest removal candidates.

**Low-variance flags:** Inputs where the coefficient of variation (std ÷ mean) is near zero — these add no signal to training.

**Input checkboxes:** Full list of inputs with one checkbox each. Flagged inputs are pre-unchecked. Click **Apply** to write your selection back and clear the trained model (retraining required).

**PCA (optional, collapsible):** Projects all inputs into uncorrelated principal components. Pick the number of components, preview the explained-variance bar chart and per-component loadings table, then Apply. Downstream steps (Model, Predict, Active Learning) operate in PC space automatically — the original physical column names are still used for Predict inputs.

This step is optional — you can proceed to Step 9 without visiting Filter.

---

## Step 9 — Model

**What it does:** Select the surrogate model type, set training parameters, and train.

A training summary card at the top shows your current configuration: normalization method, input columns, and output columns. This updates automatically if you return to Normalize and re-apply.

### Model types

| Type | Best for | Notes |
|---|---|---|
| **GPR** (Gaussian Process) | Small datasets (< 5,000 rows), uncertainty quantification | Returns posterior std; supports RBF, Matérn 1.5/2.5, Rational Quadratic kernels; ARD per-dimension length scales |
| **RF** (Random Forest) | Medium datasets, noisy data, non-linear relationships | Fast; tree-variance uncertainty available |
| **Linear** | Simple relationships, interpretability | Ridge regression; no uncertainty estimates |
| **RBF** | Smooth interpolation | scipy RBFInterpolator; thin-plate spline or multiquadric |
| **PCE** | Smooth responses with known input distributions | Polynomial Chaos Expansion; gives Sobol sensitivity indices analytically as a by-product |
| **Ensemble** | Combining model strengths | CV-weighted blend + stacking; slower to train |
| **Multi-Fidelity** | Two datasets at different fidelity levels | **Experimental** — Kennedy-O'Hagan co-kriging; requires two loaded datasets; behavior may differ from other model types |

### Parameters

| Parameter | Default | Range |
|---|---|---|
| Test split | 0.20 | 0.05 – 0.50 |
| CV folds | 5 | 2 – 20 |

### Auto-tune

Click **Auto-tune** to run a GridSearchCV over key hyperparameters (GPR kernel and alpha, RF n_estimators/max_features, Linear Ridge alpha) and automatically populate the best settings.

---

## Step 10 — Results

**What it does:** Shows training diagnostics for the fitted model across four tabs.

**Metrics tab:**
- Test metrics: R², NRMSE (%), MAE on the held-out test set; one row per output with color-coded badges
- CV summary: mean ± std of R² across k folds with per-fold timing
- Model configuration card: model type, kernel, alpha, test split, CV folds, preprocessing mode

**Parity tab:** Predicted vs. actual values; points should hug the diagonal. GPR models show ±1.96σ error bars.

**Residual tab:** Residuals vs. predicted values; should show no systematic pattern.

**Explore tab (Design Space Explorer):**
- *Scatter view* — pick any input as X, any output as Y, and color by predicted value, actual value, residual, or any input. Dual-handle range sliders filter which points are shown (client-side, instant).
- *Contour view* — pick two inputs as X/Y axes and one output for the color contour. Fix remaining inputs via discrete sliders. The contour regenerates 500 ms after any change.

**Interpreting R²:**
- > 0.95 — excellent fit
- 0.85 – 0.95 — good; suitable for most engineering decisions
- 0.70 – 0.85 — caution; predictions carry meaningful uncertainty
- < 0.70 — poor; consider more data, a different model type, or better feature selection

A yellow banner appears if you trained without normalization — return to Step 7, click Apply, then retrain.

---

## Step 11 — Predict

**What it does:** Use the trained surrogate to make predictions.

**Single-point:** Enter values for each input column, click **Predict**. Extrapolation warnings appear when any input is outside the training range (amber at 110%, red at 125%).

**Batch:** Upload a CSV with input columns (outputs optional — if present they're used for validation). Results download as CSV with predicted values appended.

---

## Step 12 — Optimize

**What it does:** Find input combinations that optimize one or more outputs.

### Single-objective

Select an output and direction (minimize or maximize). Optionally add per-input bounds and output constraints. The optimizer (differential evolution) searches the input space and returns the best point found.

### Multi-objective

Select two or more outputs, each with its own direction. The optimizer (NSGA-II) returns a Pareto front — the set of solutions where you cannot improve one objective without degrading another.

**Tip:** For GPR models, a high-uncertainty warning at the optimum means the model has low confidence there. Consider running Step 14 — Sample to gather data in that region first.

---

## Step 13 — Interpret

**What it does:** Understand which inputs drive your outputs and how confident the model is.

### Sobol sensitivity indices

- **S₁ (First-order)** — fraction of output variance explained by that input alone
- **Sₜ (Total-order)** — includes interactions with all other inputs; always ≥ S₁
- High Sₜ, low S₁ → input matters mainly through interactions with others

### OAT curves

Each input is varied from min to max while all others are held at their training median. Shows the shape of the response to each input independently.

### Uncertainty

- **GPR** — native posterior std; 95% CI shown as error bars on parity plots
- **RF** — tree-variance CI (percentile spread across all trees)
- **Linear** — no native uncertainty estimates

---

## Step 14 — Sample (Active Learning)

**What it does:** Recommends where to run your next experiments to maximize model improvement.

**Coverage mode:** Recommends points in under-sampled regions of the input space — maximizes minimum distance to existing training data. Works for all model types; no uncertainty estimates required.

**Objective mode:** Recommends points where the surrogate predicts a good outcome AND has high uncertainty (Expected Improvement). Requires GPR or RF.

**Residual mode:** Recommends points near test-set observations where the model made the largest prediction errors. Each candidate is scored by proximity to high-residual test points, weighted by the residual magnitude. Works for all model types; no uncertainty estimates required.

The recommendation table shows ranked input combinations. Export to CSV to pass to your simulation tool. Up to 5 rounds of recommendations are stored in history.

---

## Step 15 — Compare

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

## Step 16 — Export

**What it does:** Generate a self-contained HTML analysis report and download trained model bundles.

### Report

The report automatically includes all completed workflow steps:
- Dataset summary and column designation
- Cleaning operations applied
- Model configuration and test metrics
- Parity plots (rendered as interactive Plotly charts)
- Sobol sensitivity table (if Step 13 — Interpret was run)
- Active learning history (if Step 14 — Sample was run)
- Full audit trail

### Model export

**Download Model (.zip)** — Full sklearn bundle: `model.joblib`, input/output scalers, a `surrogate.py` wrapper that accepts raw numpy arrays or pandas DataFrames and applies normalization internally, plus `README.txt`. Requires numpy, pandas, joblib, and scikit-learn at prediction time. Works for all model types.

**Export NumPy (.zip)** — Numpy-only bundle: `surrogate.py` with all model weights embedded (Linear) or stored as `.npy` array files (GPR). No scikit-learn or joblib required at prediction time — only numpy. Supported for Linear and GPR models (RBF, Matérn 1.5/2.5, Rational Quadratic kernels). Greyed out for RF and PCE — use the standard bundle for those.

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
| **Cores** | Processor count for parallel operations |
| **Learning mode** | Toggle to show/hide all concept primers |
| **Guide** | Open the Learning Guide (glossary, model guide, topics, exercises) |
| **+ Load File** | Add a second dataset to the session |
| **Save / Open** | Save the entire session to a `.surrogate` file, or restore a previous session |
| **✕ Clear** | Reset all datasets and return to the upload screen |

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| Click sidebar step | Navigate to that step (if unlocked) |
| `‹` / `›` button | Collapse/expand the sidebar |
