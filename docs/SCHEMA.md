# STATE Schema Reference

The `STATE` dict is the single source of truth for all session data. It lives in `app/state/schema.py` and is stored in `app.config['STATE']`.

## Top-level keys

| Key                  | Purpose                                               |
|----------------------|-------------------------------------------------------|
| `session`            | Session identity, gates, user preferences             |
| `datasets`           | Primary, secondary, and combined DataFrames + metadata |
| `surrogate_sessions` | Trained model sessions keyed by dataset ref           |
| `active_learning`    | Coverage and objective mode recommendations           |
| `comparison`         | Multi-dataset comparison results                      |
| `predictions`        | Single and batch prediction history                   |
| `processors`         | Processor allocation settings                         |
| `compliance`         | Classification, program, export audit log             |
| `audit`              | Timestamped event log (max 1000 events)               |
| `ui`                 | Active tab, learning mode, notification queue         |

## Critical rules

- `datasets.primary.raw` is written **once** on upload and **never modified**. All processing writes to `datasets.primary.clean`.
- Model history capped at `MAX_MODEL_HISTORY = 10` runs per output.
- Prediction history capped at `MAX_PREDICTION_HISTORY = 20`.
- Audit events capped at `MAX_AUDIT_EVENTS = 1000` per session.
- `temp/` is auto-cleared on session start only.

## Helpers

```python
from app.state.schema import reset_state, get_state, get_state_json_safe

reset_state()            # deep-copies canonical template back into live STATE (in-place)
get_state()              # returns live STATE reference
get_state_json_safe()    # returns STATE with DataFrames replaced by metadata dicts
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

The `GET /api/state/` endpoint uses this to expose STATE to the frontend.

## Full STATE structure

See `app/state/schema.py` for the canonical definition with all default values and inline comments.
