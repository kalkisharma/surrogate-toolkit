# STATE Schema Reference

**Version:** v1.6.0 | **Last updated:** 2026-05-15

The `STATE` dict is the single source of truth for all session data. It lives in `app/state/schema.py` and is stored in `app.config['STATE']`.

## Top-level keys

| Key | Purpose |
|---|---|
| `session` | Session identity, gates, user preferences |
| `datasets` | Primary dataset DataFrames + metadata; `_datasets` accumulator for all loaded files |
| `surrogate_sessions` | Active trained model session (primary) |
| `active_learning` | Coverage and objective mode recommendations |
| `comparison` | Schema slot for comparison data (canonical template only — live comparison results use `comparison_cache`) |
| `predictions` | Single and batch prediction history |
| `processors` | Processor allocation settings |
| `compliance` | Classification, program, export audit log |
| `audit` | Timestamped event log (max 1,000 events) |
| `ui` | Active tab, learning mode, notification queue |

## Critical rules

- `datasets.primary.raw` is written **once** on upload and **never modified**. All processing writes to `datasets.primary.clean`.
- `models_dict["runs"]` stores the full results payload for each training run (one entry per run). Capped at `MAX_MODEL_HISTORY = 10`.
- `models_dict["history"]` stores compact per-output entries (one row per output per run). Also capped at `MAX_MODEL_HISTORY`.
- Prediction history capped at `MAX_PREDICTION_HISTORY = 20`.
- Audit events capped at `MAX_AUDIT_EVENTS = 1,000` per session.

## Multi-dataset structure

When multiple datasets are loaded, each dataset entry in `STATE['datasets']['_datasets']` has this shape:

```python
_datasets[key] = {
    "raw":          pd.DataFrame,    # original upload — never mutated
    "clean":        pd.DataFrame,    # after cleaning operations
    "metadata":     dict,            # filename, n_rows, input_columns, output_columns, ...
    "memory_bytes": int,
    "last_accessed": int,            # Unix timestamp
    "surrogate_session": {           # saved when user switches away from this dataset
        "models": dict,              # trained model object + results + history
        "config": dict,              # model_type, test_split, cv_folds, hyperparams
    },
}
```

`STATE['datasets']['active_dataset_key']` holds the key of the currently active dataset.

When the active dataset changes:
1. Current surrogate session is saved to `_datasets[prev_key]["surrogate_session"]`
2. New dataset is mirrored into `STATE['datasets']['primary']`
3. `STATE['surrogate_sessions']['primary']['models']` is loaded from `_datasets[new_key]["surrogate_session"]`

The active dataset's model is always at `STATE['surrogate_sessions']['primary']['models']`.
Non-active datasets' models are at `STATE['datasets']['_datasets'][key]['surrogate_session']['models']`.

## Models dict structure

```python
models_dict = STATE['surrogate_sessions']['primary']['models']

models_dict['trained']        # fitted surrogate model object (BaseSurrogateModel subclass)
models_dict['results']        # full results payload from last train
models_dict['runs']           # list of full results payloads, capped at MAX_MODEL_HISTORY
models_dict['history']        # list of compact {run, output, r2_test, rmse_test, ...} entries
models_dict['interpretation'] # {output_col: {sensitivity, oat, uncertainty}}, set by interpret endpoint
```

## Results dict shape

```python
results = models_dict['results']

results['model_type']       # "gpr" | "rf" | "linear"
results['n_train']          # int
results['n_test']           # int
results['input_columns']    # list[str]
results['output_columns']   # list[str]
results['test_metrics']     # list[{column, r2, rmse, mae}]
results['cv_results']       # {folds, metrics: [...], mean_r2, std_r2, ...}
results['warnings']         # list[str]
results['y_test']           # list[list[float]] — n_test × n_outputs
results['y_pred_test']      # list[list[float]] — n_test × n_outputs
results['test_stds']        # list[list[float]] — GPR only; None otherwise
results['test_inputs']      # list[list[float]] — n_test × n_inputs (for RF uncertainty)
results['input_mins']       # {col: float}
results['input_maxs']       # {col: float}
results['input_means']      # {col: float}
```

## Comparison cache

Live comparison results are stored at `STATE['comparison_cache']['last']` (not in the canonical `comparison` slot). This is a plain dict set by `POST /api/comparison/run` and read by `GET /api/comparison/results`.

## Helpers

```python
from app.state.schema import reset_state, get_state, get_state_json_safe

reset_state()            # deep-copies canonical template back into live STATE (in-place)
get_state()              # returns live STATE reference
get_state_json_safe()    # returns STATE with DataFrames replaced by metadata dicts
```

```python
from app.state.schema import append_audit_event

append_audit_event(state, "event_type", {"key": "value"})
# Appends {timestamp, event_type, detail} to state["audit"]["events"], capped at MAX_AUDIT_EVENTS
```

## JSON-safe serialization

DataFrames cannot be JSON-serialized. `get_state_json_safe()` replaces each DataFrame with:

```json
{
  "_type": "dataframe",
  "shape": [n_rows, n_cols],
  "columns": ["col1", "col2", ...]
}
```

Model objects (BaseSurrogateModel subclasses) are replaced with `model.get_summary()` — a JSON-serializable dict with type, hyperparameters, and fit status.

The `GET /api/state/` endpoint uses this to expose STATE to the frontend.

## Full canonical template

See `app/state/schema.py` for the complete definition with all default values and inline comments.
