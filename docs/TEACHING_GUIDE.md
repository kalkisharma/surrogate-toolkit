# Teaching Guide

**Version:** v3.0.0 | **Last updated:** 2026-05-20

Documents the learning mode system — how it works, how to add new content, and what was delivered in Milestone 3 (Phase 12 experience levels, Phase 13A learning guide). Phase 13B (guided exercises) is deferred to M4.

---

## Overview

The toolkit has two audiences:

1. **Practicing engineers** — want to get results fast; learning content should stay out of their way
2. **Junior engineers / students** — need context on what each step does and why it matters

The learning mode system bridges both. When **Learning Mode** is off, the UI is clean and minimal. When it's on, concept primers, expanded tooltips, and explanatory text appear in-place without leaving the workflow.

---

## Learning mode toggle

Location: global header (top-right).

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

### Current primers

| Step | Primer question |
|---|---|
| Explore | What does this scatter matrix show? |
| Clean | Why remove outliers before training? |
| Designate | What's the difference between inputs and outputs? |
| Normalize | Why normalize inputs? |
| Configure | How do I choose between GPR, RF, and Linear? |
| Results | How do I know if my model is good enough? |
| Predict | What do extrapolation warnings mean? |
| Optimize | What does an objective function do? |
| Interpret | What does sensitivity analysis tell me? |
| Active Learning | When should I run more experiments? |
| Comparison | What does this comparison show? |
| Export | (classification guidance shown inline) |

---

## Experience levels

The global header has an **Level** selector: Beginner / Intermediate / Expert.

Currently this controls:
- Default learning mode state (Beginner defaults to on, Expert defaults to off)
- Stored in `STATE['session']['experience_level']`

**Phase 12** will expand this into a full adaptive system:
- Different default hyperparameter UIs per level (Beginner sees simplified options; Expert sees full grid)
- Additional inline explanations at Beginner level
- Expert level unlocks advanced model options hidden from Beginner/Intermediate

---

## Tooltips

Tooltips are shown on hover over labels, axis names, and metric values.

```javascript
import { registerTooltip } from "../learning_mode.js";

registerTooltip(
  element,          // DOM element to attach to
  "Tooltip text"    // plain text or short HTML
);
```

Tooltips are visible regardless of learning mode — they're always-on context for terms that may be unfamiliar.

---

## Phase 12 — Experience Levels (M3)

Phase 12 will formalize the experience level system:

- **Beginner UI** — simplified gate-style choices; key parameters only; all primers expanded by default; narrative guidance at each step
- **Intermediate UI** — current default; most options visible; primers collapsed by default
- **Expert UI** — all hyperparameters exposed; no gate confirmations; primers hidden; compact layout

Implementation will require:
- `ExperienceAdapter` module that reads `STATE['session']['experience_level']` and returns UI config
- Panel modules check adapter before rendering (show/hide advanced sections)
- Learning mode primers remain fully available at all levels (just collapsed by default for Expert)

---

## Phase 13 — Guided Learning & Exercises (M3)

Phase 13 will add a structured learning track alongside the main workflow:

- **Exercises** — pre-built datasets with known answers (e.g., Ishigami function for sensitivity analysis, Branin function for optimization)
- **Guided mode** — step-by-step instructions overlaid on the normal UI
- **Check points** — validate the engineer's choices against expected answers (e.g., "Does your R² exceed 0.90 for this dataset?")
- **Exercise library** — `app/learning/exercises/` (directory exists; content to be added in Phase 13)

Exercise files will live in `app/learning/exercises/` as JSON or CSV bundles with metadata (name, topic, expected outcomes, hints).
