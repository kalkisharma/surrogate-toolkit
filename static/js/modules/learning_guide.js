// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/learning_guide.js
// Version: 3.5.26
// Description: Learning Guide modal — six tabs: Glossary, Model Guide,
//              Topics, Exercises, Symbols, Equations. Opens via the "Guide"
//              header button. Exercises tab auto-injects datasets and shows
//              step-by-step guidance with advisory quiz cards.
// =============================================================================

import { get, post } from "../api.js";
import { el, clearEl, escHtml } from "../utils.js";
import { showSuccess, showError } from "../notifications.js";

// ── Module state ──────────────────────────────────────────────────────────────

let _cache = {};           // keyed by endpoint string
let _activeExercise = null; // { id, steps[], currentStep, progress{} }
let _glossaryTermMap = null; // populated on first exercise start; { termName → {term, definition, category} }
let _kwPopover       = null; // single shared keyword definition popover element

// ── Public API ────────────────────────────────────────────────────────────────

export function openGuide(initialTab = "glossary") {
  _removeExisting();
  const overlay = _buildOverlay(initialTab);
  document.body.appendChild(overlay);
  overlay.querySelector(".lg-close-btn").focus();
  document.addEventListener("keydown", _escListener);
}

export function closeGuide() {
  _removeExisting();
}

export function resetExercise() {
  _removeExerciseOverlay();
  _activeExercise = null;
}

// ── Decision-tree runner (exported for inline use in model_config.js) ─────────

export async function runDecisionTree(containerEl, guideName) {
  const resp = await _fetch(`/api/learning/guide/${guideName}`);
  if (!resp.success) {
    containerEl.innerHTML = `<p class="lg-error">Guide unavailable.</p>`;
    return;
  }
  _renderTreeAt(containerEl, resp.nodes, "start");
}

// ── Internal: overlay & modal ──────────────────────────────────────────────────

function _buildOverlay(initialTab) {
  const overlay = el("div", { cls: "lg-overlay" });
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Learning Guide");

  const modal = el("div", { cls: "lg-modal" });

  // Header
  const header = el("div", { cls: "lg-header" });
  header.innerHTML = `<span class="lg-title">Learning Guide</span>`;
  const closeBtn = el("button", { cls: "lg-close-btn", text: "✕", "aria-label": "Close guide" });
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Tabs
  const tabs = ["glossary", "models", "topics", "exercises", "symbols", "equations"];
  const tabLabels = { glossary: "Glossary", models: "Model Guide", topics: "Topics", exercises: "Exercises", symbols: "Symbols", equations: "Equations" };

  const tabBar = el("div", { cls: "lg-tab-bar", role: "tablist" });
  const tabBtns = {};
  for (const t of tabs) {
    const btn = el("button", { cls: `lg-tab-btn${t === initialTab ? " active" : ""}`, text: tabLabels[t] });
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", t === initialTab ? "true" : "false");
    btn.dataset.tab = t;
    tabBar.appendChild(btn);
    tabBtns[t] = btn;
  }
  modal.appendChild(tabBar);

  // Content area
  const content = el("div", { cls: "lg-content" });
  modal.appendChild(content);

  overlay.appendChild(modal);

  // Events
  closeBtn.addEventListener("click", closeGuide);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeGuide(); });

  for (const t of tabs) {
    tabBtns[t].addEventListener("click", () => {
      for (const t2 of tabs) {
        tabBtns[t2].classList.toggle("active", t2 === t);
        tabBtns[t2].setAttribute("aria-selected", t2 === t ? "true" : "false");
      }
      _loadTab(content, t);
    });
  }

  _loadTab(content, initialTab);
  return overlay;
}

// ── Tab loaders ───────────────────────────────────────────────────────────────

async function _loadTab(container, tab) {
  clearEl(container);
  container.innerHTML = `<div class="lg-spinner">Loading…</div>`;

  if (tab === "glossary")        await _renderGlossary(container);
  else if (tab === "models")     await _renderModelGuide(container);
  else if (tab === "topics")     await _renderTopics(container);
  else if (tab === "exercises")  await _renderExercises(container);
  else if (tab === "symbols")    await _renderSymbols(container);
  else if (tab === "equations")  await _renderEquations(container);
}

// ── Glossary ──────────────────────────────────────────────────────────────────

async function _renderGlossary(container) {
  const resp = await _fetch("/api/learning/glossary");
  clearEl(container);
  if (!resp.success) { container.innerHTML = `<p class="lg-error">Could not load glossary.</p>`; return; }

  const terms = resp.terms;
  const categories = [...new Set(terms.map(t => t.category))];

  const searchWrap = el("div", { cls: "lg-search-wrap" });
  const searchInput = el("input", { cls: "lg-search", type: "text", placeholder: "Search terms…", "aria-label": "Search glossary" });
  searchWrap.appendChild(searchInput);
  container.appendChild(searchWrap);

  const body = el("div", { cls: "lg-glossary-body" });
  container.appendChild(body);

  function renderTerms(filter) {
    clearEl(body);
    const lc = filter.toLowerCase();
    for (const cat of categories) {
      const catTerms = terms.filter(t => t.category === cat && (
        !filter || t.term.toLowerCase().includes(lc) || t.definition.toLowerCase().includes(lc)
      ));
      if (!catTerms.length) continue;

      const catEl = el("div", { cls: "lg-glossary-cat" });
      catEl.innerHTML = `<h3 class="lg-cat-heading">${escHtml(cat)}</h3>`;
      for (const t of catTerms) {
        const item = el("div", { cls: "lg-term-item" });
        item.innerHTML = `<span class="lg-term-name">${escHtml(t.term)}</span>
          <span class="lg-term-def">${t.definition}</span>`;
        catEl.appendChild(item);
      }
      body.appendChild(catEl);
    }
    if (!body.children.length) {
      body.innerHTML = `<p class="lg-empty">No terms match "${escHtml(filter)}".</p>`;
    }
  }

  renderTerms("");
  searchInput.addEventListener("input", () => renderTerms(searchInput.value));
}

// ── Model Guide ───────────────────────────────────────────────────────────────

async function _renderModelGuide(container) {
  const resp = await _fetch("/api/learning/models");
  clearEl(container);
  if (!resp.success) { container.innerHTML = `<p class="lg-error">Could not load model guide.</p>`; return; }

  const intro = el("p", { cls: "lg-section-intro",
    text: "Expand any model to see its strengths, weaknesses, and when to use it." });
  container.appendChild(intro);

  for (const m of resp.models) {
    const card = el("div", { cls: "lg-model-card" });
    const toggle = el("button", { cls: "lg-model-toggle" });
    toggle.innerHTML = `<span class="lg-model-name">${escHtml(m.name)}</span>
      <span class="lg-chevron">▸</span>`;
    const body = el("div", { cls: "lg-model-body hidden" });
    body.innerHTML = `
      <p class="lg-model-desc">${m.description}</p>
      <div class="lg-model-cols">
        <div>
          <h4 class="lg-list-head">Strengths</h4>
          <ul class="lg-list">${m.strengths.map(s => `<li>${s}</li>`).join("")}</ul>
        </div>
        <div>
          <h4 class="lg-list-head">Weaknesses</h4>
          <ul class="lg-list lg-list--weak">${m.weaknesses.map(w => `<li>${w}</li>`).join("")}</ul>
        </div>
      </div>
      <p class="lg-model-best"><strong>Best for:</strong> ${m.best_for}</p>
      <p class="lg-model-avoid"><strong>Avoid when:</strong> ${m.avoid_when}</p>`;

    toggle.addEventListener("click", () => {
      const open = !body.classList.contains("hidden");
      body.classList.toggle("hidden", open);
      toggle.querySelector(".lg-chevron").textContent = open ? "▸" : "▾";
    });

    card.appendChild(toggle);
    card.appendChild(body);
    container.appendChild(card);
  }
}

// ── Topics ────────────────────────────────────────────────────────────────────

const _TOPICS = [
  { key: "diagnostics",          label: "Diagnostics & Metrics" },
  { key: "uncertainty",          label: "Uncertainty Quantification" },
  { key: "cv_strategies",        label: "Cross-Validation Strategies" },
  { key: "sensitivity",          label: "Sensitivity Analysis" },
  { key: "active_learning",      label: "Active Learning" },
  { key: "data_cleaning",        label: "Data Cleaning" },
  { key: "input_filtering",      label: "Input Filtering & Dimensionality Reduction" },
  { key: "multifidelity",        label: "Multi-Fidelity Modeling" },
  { key: "model_troubleshooting", label: "Poor Fit? Troubleshooting Guide" },
  { key: "optimization",          label: "Surrogate-Based Optimization" },
];

const _GUIDES = [
  { key: "model_selection",  label: "Model Selection Guide" },
  { key: "cv_selection",     label: "CV Fold Selection Guide" },
  { key: "kernel_selection", label: "Kernel & Hyperparameter Guide" },
];

async function _renderTopics(container) {
  clearEl(container);
  const nav = el("div", { cls: "lg-topics-nav" });
  const contentArea = el("div", { cls: "lg-topics-content" });

  for (const t of _TOPICS) {
    const btn = el("button", { cls: "lg-topic-btn", text: t.label });
    btn.addEventListener("click", () => _showTopic(contentArea, t, nav, btn));
    nav.appendChild(btn);
  }

  const divider = el("div", { cls: "lg-topics-divider", text: "Interactive Guides" });
  nav.appendChild(divider);

  for (const g of _GUIDES) {
    const btn = el("button", { cls: "lg-topic-btn lg-topic-btn--guide", text: g.label });
    btn.addEventListener("click", () => _showGuide(contentArea, g, nav, btn));
    nav.appendChild(btn);
  }

  container.appendChild(nav);
  container.appendChild(contentArea);

  // Auto-load first topic
  if (_TOPICS.length) _showTopic(contentArea, _TOPICS[0], nav, nav.querySelector(".lg-topic-btn"));
}

async function _showTopic(contentArea, topic, nav, activeBtn) {
  _setActive(nav, activeBtn);
  contentArea.innerHTML = `<div class="lg-spinner">Loading…</div>`;

  const resp = await _fetch(`/api/learning/content/${topic.key}`);
  clearEl(contentArea);
  if (!resp.success) { contentArea.innerHTML = `<p class="lg-error">Could not load content.</p>`; return; }

  const heading = el("h2", { cls: "lg-topic-heading", text: topic.label });
  contentArea.appendChild(heading);

  for (const section of resp.sections) {
    const sec = el("div", { cls: "lg-section" });
    sec.innerHTML = `<h3 class="lg-section-title">${escHtml(section.title)}</h3>
      <p class="lg-section-body">${section.body}</p>`;
    contentArea.appendChild(sec);
  }
}

async function _showGuide(contentArea, guide, nav, activeBtn) {
  _setActive(nav, activeBtn);
  contentArea.innerHTML = `<div class="lg-spinner">Loading…</div>`;

  const resp = await _fetch(`/api/learning/guide/${guide.key}`);
  clearEl(contentArea);
  if (!resp.success) { contentArea.innerHTML = `<p class="lg-error">Could not load guide.</p>`; return; }

  const heading = el("h2", { cls: "lg-topic-heading", text: guide.label });
  contentArea.appendChild(heading);
  const desc = el("p", { cls: "lg-section-body",
    text: "Answer the questions below to get a recommendation for your dataset." });
  contentArea.appendChild(desc);

  const treeEl = el("div", { cls: "lg-tree" });
  contentArea.appendChild(treeEl);
  _renderTreeAt(treeEl, resp.nodes, "start");
}

// ── Exercises ─────────────────────────────────────────────────────────────────

const _DIFFICULTY_LABELS = { beginner: "Beginner", intermediate: "Intermediate", expert: "Expert" };

async function _renderExercises(container) {
  clearEl(container);
  container.innerHTML = `<div class="lg-spinner">Loading…</div>`;

  const resp = await get("/api/learning/exercises");
  clearEl(container);
  if (!resp.success) {
    container.innerHTML = `<p class="lg-error">Could not load exercises.</p>`;
    return;
  }

  const intro = el("p", { cls: "lg-section-intro",
    text: "Guided exercises auto-load a synthetic dataset and walk you through the full workflow step by step. Quiz questions are advisory — you can always continue regardless of your answer. Suggested order: complete exercises 1–3 before attempting 4–7. Exercise 6 (PCA) requires reading the 'Input Filtering' topic first. Exercise 7 (Multi-Fidelity) requires switching between two auto-loaded datasets." });
  container.appendChild(intro);

  // Build cards (numbered 1-based)
  const cardEls = resp.exercises.map((ex, i) => _buildExerciseCard(ex, i + 1, container));

  // Filter state
  let activeDiff = "all";
  let activeTag  = "all";

  function applyFilters() {
    cardEls.forEach((card, i) => {
      const ex = resp.exercises[i];
      const diffOk = activeDiff === "all" || ex.difficulty === activeDiff;
      const tagOk  = activeTag  === "all" || (ex.tags || []).includes(activeTag);
      card.style.display = (diffOk && tagOk) ? "" : "none";
    });
  }

  // Unique difficulties and tags in order of first appearance
  const seenDiffs = [], seenTags = [];
  for (const ex of resp.exercises) {
    if (!seenDiffs.includes(ex.difficulty)) seenDiffs.push(ex.difficulty);
    for (const t of (ex.tags || [])) if (!seenTags.includes(t)) seenTags.push(t);
  }

  function makeChip(val, label, getActive, setActive, chipRow) {
    const chip = el("button", { cls: `ex-filter-chip${val === getActive() ? " ex-filter-chip--active" : ""}`, text: label });
    chip.addEventListener("click", () => {
      setActive(val);
      chipRow.querySelectorAll(".ex-filter-chip").forEach(c => c.classList.remove("ex-filter-chip--active"));
      chip.classList.add("ex-filter-chip--active");
      applyFilters();
    });
    return chip;
  }

  const filterBar = el("div", { cls: "ex-filter-bar" });

  // Difficulty row
  const diffRow = el("div", { cls: "ex-filter-row" });
  const diffLabel = el("span", { cls: "ex-filter-label", text: "Difficulty" });
  diffRow.appendChild(diffLabel);
  diffRow.appendChild(makeChip("all", "All", () => activeDiff, v => { activeDiff = v; }, diffRow));
  for (const d of seenDiffs) {
    diffRow.appendChild(makeChip(d, _DIFFICULTY_LABELS[d] || d, () => activeDiff, v => { activeDiff = v; }, diffRow));
  }

  // Topic row
  const tagRow = el("div", { cls: "ex-filter-row" });
  const tagLabel = el("span", { cls: "ex-filter-label", text: "Topic" });
  tagRow.appendChild(tagLabel);
  tagRow.appendChild(makeChip("all", "All", () => activeTag, v => { activeTag = v; }, tagRow));
  for (const t of seenTags) {
    tagRow.appendChild(makeChip(t, _titleCase(t), () => activeTag, v => { activeTag = v; }, tagRow));
  }

  filterBar.appendChild(diffRow);
  filterBar.appendChild(tagRow);
  container.appendChild(filterBar);

  for (const card of cardEls) container.appendChild(card);
}

function _titleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

function _buildExerciseCard(ex, num, listContainer) {
  const statusClass = {
    not_started:  "ex-card__status--todo",
    in_progress:  "ex-card__status--progress",
    complete:     "ex-card__status--done",
  }[ex.status] || "ex-card__status--todo";

  const statusLabel = { not_started: "Not started", in_progress: "In progress", complete: "Complete" }[ex.status] || "";
  const diffClass = ex.difficulty === "beginner" ? "ex-badge--beginner"
                  : ex.difficulty === "expert"   ? "ex-badge--expert"
                  : "ex-badge--intermediate";

  const card = el("div", { cls: "ex-card" });
  const tagsHtml = (ex.tags || []).map(t =>
    `<span class="ex-card__tag">${escHtml(_titleCase(t))}</span>`).join("");

  card.innerHTML = `
    <div class="ex-card__header">
      <span class="ex-card__num">${String(num).padStart(2, "0")}</span>
      <span class="ex-card__title">${escHtml(ex.title)}</span>
      <span class="ex-badge ${diffClass}">${escHtml(_DIFFICULTY_LABELS[ex.difficulty] || ex.difficulty)}</span>
    </div>
    <p class="ex-card__desc">${escHtml(ex.description)}</p>
    ${tagsHtml ? `<div class="ex-card__tags">${tagsHtml}</div>` : ""}
    <div class="ex-card__meta">
      <span class="ex-card__time">~${ex.estimated_minutes} min</span>
      <span class="ex-card__progress">${ex.steps_completed}/${ex.steps_total} steps</span>
      <span class="ex-card__status ${statusClass}">${statusLabel}</span>
    </div>`;

  const startBtn = el("button", { cls: "btn btn-primary ex-card__btn",
    text: ex.status === "complete" ? "Replay" : ex.status === "in_progress" ? "Continue" : "Start Exercise" });
  card.appendChild(startBtn);

  startBtn.addEventListener("click", async () => {
    await _startExercise(ex.id, listContainer);
  });

  return card;
}

async function _startExercise(exerciseId, listContainer) {
  // Confirm if session has data
  const stateResp = await get("/api/state/");
  const hasData = stateResp?.state?.datasets?.primary?.metadata?.filename;
  if (hasData) {
    const confirmed = window.confirm(
      "Starting this exercise will replace your current dataset. Any unsaved model results will be lost. Continue?"
    );
    if (!confirmed) return;
  }

  // Inject dataset
  const startResp = await post(`/api/learning/exercises/${exerciseId}/start`, {});
  if (!startResp.success) {
    showError(`Could not load exercise dataset: ${startResp.message || "Unknown error"}`);
    return;
  }

  // Load full exercise definition
  const exResp = await get(`/api/learning/exercises/${exerciseId}`);
  if (!exResp.success) {
    showError("Could not load exercise steps.");
    return;
  }

  // Pre-load glossary for keyword annotation (served from cache after first call)
  if (!_glossaryTermMap) {
    const glossResp = await _fetch("/api/learning/glossary");
    if (glossResp.success) {
      _glossaryTermMap = Object.fromEntries(glossResp.terms.map(t => [t.term, t]));
    }
  }

  _activeExercise = {
    id:           exerciseId,
    steps:        exResp.exercise.steps,
    currentStep:  0,
    progress:     exResp.progress,
  };

  closeGuide();
  _showExerciseOverlay();
  showSuccess(`Exercise started — dataset '${startResp.metadata.filename}' loaded.`);

  // Rebuild the workflow UI with the injected dataset and refresh the dataset switcher.
  // The exercise:navigate event fired by _showExerciseOverlay will reach activatePanel
  // once _renderExploration sets _activatePanelFn.
  document.dispatchEvent(new CustomEvent("exercise:loaded", { detail: { result: startResp } }));
}

function _getExerciseDataset(exerciseId) {
  // Sync lookup — returns undefined if not cached; acceptable since we only use it for comparison
  const cached = _cache[`/api/learning/exercises/${exerciseId}`];
  return cached?.exercise?.dataset;
}

// ── Exercise overlay (floating card shown above the workflow) ─────────────────

function _showExerciseOverlay() {
  _removeExerciseOverlay();
  if (!_activeExercise) return;

  const ex    = _activeExercise;
  const step  = ex.steps[ex.currentStep];
  const total = ex.steps.length;

  const panel = el("div", { cls: "ex-overlay", id: "ex-overlay" });

  // Step progress dots
  const dots = ex.steps.map((s, i) => {
    const done = ex.progress?.steps_completed?.includes(s.step_num);
    const cur  = i === ex.currentStep;
    return `<span class="ex-dot${cur ? " ex-dot--current" : ""}${done ? " ex-dot--done" : ""}"></span>`;
  }).join("");

  panel.innerHTML = `
    <div class="ex-overlay__header">
      <span class="ex-overlay__title">Step ${step.step_num} of ${total}</span>
      <div class="ex-dots">${dots}</div>
      <button class="ex-overlay__close" aria-label="Close exercise">✕</button>
    </div>
    <div class="ex-overlay__instruction">${step.instruction}</div>`;

  // Quiz card (if present)
  if (step.quiz) {
    panel.appendChild(_buildQuizCard(step, ex));
  }

  // Nav buttons
  const nav = el("div", { cls: "ex-overlay__nav" });
  if (ex.currentStep > 0) {
    const prevBtn = el("button", { cls: "btn btn-secondary ex-nav-btn", text: "← Prev" });
    prevBtn.addEventListener("click", () => _goToStep(ex.currentStep - 1));
    nav.appendChild(prevBtn);
  }
  if (ex.currentStep < total - 1) {
    const nextBtn = el("button", { cls: "btn btn-primary ex-nav-btn", text: "Next →" });
    nextBtn.addEventListener("click", () => _markStepAndAdvance(step.step_num, ex.currentStep + 1));
    nav.appendChild(nextBtn);
  } else {
    const doneBtn = el("button", { cls: "btn btn-primary ex-nav-btn", text: "Finish Exercise" });
    doneBtn.addEventListener("click", () => _markStepAndFinish(step.step_num));
    nav.appendChild(doneBtn);
  }
  panel.appendChild(nav);

  // Annotate glossary keywords in instruction and quiz text
  if (_glossaryTermMap && step.keywords?.length) {
    const instructionEl = panel.querySelector(".ex-overlay__instruction");
    if (instructionEl) _annotateKeywords(instructionEl, step.keywords, _glossaryTermMap);
    const quizEl = panel.querySelector(".ex-quiz");
    if (quizEl) _annotateKeywords(quizEl, step.keywords, _glossaryTermMap);
  }

  panel.addEventListener("click", (e) => {
    const kw = e.target.closest(".kw-link");
    if (kw && _glossaryTermMap) {
      e.stopPropagation();
      _showKwPopover(kw.dataset.term, kw);
    }
  });

  panel.querySelector(".ex-overlay__close").addEventListener("click", () => {
    _hideKwPopover();
    _markStep(step.step_num);
    _removeExerciseOverlay();
  });

  document.body.appendChild(panel);
}

// Deterministic Fisher-Yates shuffle so option order is stable on reload
// but different for each exercise step — breaks the "always B" pattern.
function _shuffleOptions(options, correctIndex, stepNum, exId) {
  let seed = stepNum * 2654435761;
  for (let i = 0; i < exId.length; i++) seed ^= exId.charCodeAt(i) * (i + 1);
  seed = seed >>> 0;

  const indices = options.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return {
    options:     indices.map(i => options[i]),
    correctIdx:  indices.indexOf(correctIndex),
    origIndices: [...indices],
  };
}

function _buildQuizCard(step, ex) {
  const quiz     = step.quiz;
  const saved    = ex.progress?.quiz_answers?.[String(step.step_num)];
  const shuffled = _shuffleOptions(quiz.options, quiz.correct_index, step.step_num, ex.id);

  const card = el("div", { cls: "ex-quiz" });
  card.innerHTML = `<p class="ex-quiz__q">${quiz.question}</p>`;

  const opts = el("div", { cls: "ex-quiz__opts" });
  shuffled.options.forEach((opt, j) => {
    const origIdx = shuffled.origIndices[j];
    const btn = el("button", { cls: "ex-quiz__opt" });
    btn.innerHTML = opt;
    if (saved !== undefined) {
      btn.disabled = true;
      if (j === shuffled.correctIdx) btn.classList.add("ex-quiz__opt--correct");
      else if (origIdx === saved)    btn.classList.add("ex-quiz__opt--wrong");
    }
    btn.addEventListener("click", () => _answerQuiz(card, quiz, origIdx, shuffled, step, ex));
    opts.appendChild(btn);
  });
  card.appendChild(opts);

  if (saved !== undefined) {
    _appendExplanation(card, quiz, saved);
  }

  return card;
}

function _answerQuiz(card, quiz, chosenOrigIdx, shuffled, step, ex) {
  card.querySelectorAll(".ex-quiz__opt").forEach((btn, j) => {
    btn.disabled = true;
    if (j === shuffled.correctIdx)                      btn.classList.add("ex-quiz__opt--correct");
    else if (shuffled.origIndices[j] === chosenOrigIdx) btn.classList.add("ex-quiz__opt--wrong");
  });
  _appendExplanation(card, quiz, chosenOrigIdx);

  post("/api/learning/exercises/progress", {
    exercise_id: ex.id,
    step_num:    step.step_num,
    quiz_answer: chosenOrigIdx,
  }).then(resp => {
    if (resp.success) ex.progress = resp.progress;
  });
}

function _appendExplanation(card, quiz, chosenIdx) {
  const existing = card.querySelector(".ex-quiz__explain");
  if (existing) existing.remove();
  const correct = chosenIdx === quiz.correct_index;
  const explain = el("div", { cls: `ex-quiz__explain${correct ? " ex-quiz__explain--correct" : " ex-quiz__explain--wrong"}` });
  explain.innerHTML = `<strong>${correct ? "Correct." : "Not quite."}</strong> ${quiz.explanation}`;
  card.appendChild(explain);
}

function _goToStep(stepIdx) {
  if (!_activeExercise) return;
  _activeExercise.currentStep = stepIdx;
  _showExerciseOverlay();
  _navigateToStep(_activeExercise.steps[stepIdx]);
}

async function _markStepAndAdvance(stepNum, nextIdx) {
  if (!_activeExercise) return;
  await _markStep(stepNum);
  _goToStep(nextIdx);
}

async function _markStepAndFinish(stepNum) {
  if (!_activeExercise) return;
  await _markStep(stepNum);
  const resp = await get(`/api/learning/exercises/${_activeExercise.id}`);
  if (resp.success) _activeExercise.progress = resp.progress;
  _removeExerciseOverlay();
  showSuccess("Exercise complete!");
  _activeExercise = null;
}

async function _markStep(stepNum) {
  if (!_activeExercise) return;
  const resp = await post("/api/learning/exercises/progress", {
    exercise_id: _activeExercise.id,
    step_num:    stepNum,
  });
  if (resp.success) _activeExercise.progress = resp.progress;
}

function _navigateToStep(step) {
  // Fire a custom event that main.js listens for to navigate the panel router
  const panel = step.target_panel;
  if (panel) {
    document.dispatchEvent(new CustomEvent("exercise:navigate", { detail: { panel } }));
  }
}

function _removeExerciseOverlay() {
  _hideKwPopover();
  document.getElementById("ex-overlay")?.remove();
}

// ── Keyword annotation ────────────────────────────────────────────────────────

function _annotateKeywords(rootEl, keywords, termMap) {
  // Build (matchText → termKey) lookup; longer patterns first to avoid substring conflicts
  const entries = [];
  for (const kw of keywords) {
    if (!termMap[kw]) continue;
    const m = kw.match(/^(.+?)\s*\(([^)]+)\)$/);
    const texts = new Set([kw]);
    if (m) { texts.add(m[1].trim()); texts.add(m[2].trim()); }
    for (const t of texts) entries.push({ text: t, termKey: kw });
  }
  if (!entries.length) return;
  entries.sort((a, b) => b.text.length - a.text.length);

  const matchToTerm = {};
  for (const e of entries) matchToTerm[e.text.toLowerCase()] = e.termKey;

  const pattern = entries.map(e => _escRx(e.text)).join("|");
  const rx = new RegExp(`(?<![a-zA-Z0-9_])(${pattern})(?![a-zA-Z0-9_])`, "gi");

  // Collect text nodes first (modifying DOM during walk breaks the walker)
  const nodes = [];
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      if (p.classList?.contains("kw-link")) return NodeFilter.FILTER_REJECT;
      if (["SCRIPT", "STYLE", "BUTTON"].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    const text = node.nodeValue;
    if (!rx.test(text)) continue;
    rx.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = rx.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const termKey = matchToTerm[m[1].toLowerCase()];
      const span = document.createElement("span");
      span.className = "kw-link";
      span.dataset.term = termKey;
      span.textContent = m[1];
      frag.appendChild(span);
      last = m.index + m[1].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

function _escRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function _getKwPopover() {
  if (!_kwPopover) {
    _kwPopover = document.createElement("div");
    _kwPopover.className = "kw-popover hidden";
    document.body.appendChild(_kwPopover);
    document.addEventListener("click", (e) => {
      if (_kwPopover && !_kwPopover.classList.contains("hidden") &&
          !_kwPopover.contains(e.target) && !e.target.classList.contains("kw-link")) {
        _hideKwPopover();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") _hideKwPopover();
    });
  }
  return _kwPopover;
}

function _showKwPopover(termKey, anchorEl) {
  if (!_glossaryTermMap) return;
  const entry = _glossaryTermMap[termKey];
  if (!entry) return;
  const pop = _getKwPopover();
  pop.innerHTML = `
    <div class="kw-popover__header">
      <span class="kw-popover__term">${escHtml(entry.term)}</span>
      <span class="kw-popover__cat">${escHtml(entry.category)}</span>
      <button class="kw-popover__close" aria-label="Close definition">✕</button>
    </div>
    <p class="kw-popover__def">${escHtml(entry.definition)}</p>`;
  pop.querySelector(".kw-popover__close").addEventListener("click", (e) => {
    e.stopPropagation();
    _hideKwPopover();
  });
  pop.classList.remove("hidden");

  const rect = anchorEl.getBoundingClientRect();
  const popW = 300;
  let left = Math.min(rect.left, window.innerWidth - popW - 8);
  let top  = rect.bottom + 6;
  if (top + 200 > window.innerHeight) top = rect.top - 200 - 6;
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top  = `${top}px`;
}

function _hideKwPopover() {
  _kwPopover?.classList.add("hidden");
}

// ── Symbols ───────────────────────────────────────────────────────────────────

async function _renderSymbols(container) {
  const resp = await _fetch("/api/learning/symbols");
  clearEl(container);
  if (!resp.success) { container.innerHTML = `<p class="lg-error">Could not load symbols.</p>`; return; }

  const intro = el("p", { cls: "lg-section-intro",
    text: "Reference table of symbols, notation, subscripts, superscripts, and abbreviations used throughout the toolkit." });
  container.appendChild(intro);

  const searchWrap = el("div", { cls: "lg-search-wrap" });
  const searchInput = el("input", { cls: "lg-search", type: "text", placeholder: "Search symbols…", "aria-label": "Search symbols" });
  searchWrap.appendChild(searchInput);
  container.appendChild(searchWrap);

  const body = el("div", { cls: "lg-symbols-body" });
  container.appendChild(body);

  function renderSymbols(filter) {
    clearEl(body);
    const lc = filter.toLowerCase();
    let anyVisible = false;
    for (const cat of resp.categories) {
      const entries = filter
        ? cat.entries.filter(e =>
            e.symbol.toLowerCase().includes(lc) ||
            e.name.toLowerCase().includes(lc) ||
            e.meaning.toLowerCase().includes(lc))
        : cat.entries;
      if (!entries.length) continue;
      anyVisible = true;

      const section = el("div", { cls: "lg-sym-section" });
      section.innerHTML = `<h3 class="lg-cat-heading">${escHtml(cat.name)}</h3>`;

      const table = document.createElement("table");
      table.className = "lg-sym-table";
      table.innerHTML = `<thead><tr>
        <th class="lg-sym-col-sym">Symbol</th>
        <th class="lg-sym-col-name">Name</th>
        <th class="lg-sym-col-meaning">Meaning</th>
      </tr></thead>`;
      const tbody = document.createElement("tbody");
      for (const e of entries) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td class="lg-sym-cell-sym">${escHtml(e.symbol)}</td>
          <td class="lg-sym-cell-name">${escHtml(e.name)}</td>
          <td class="lg-sym-cell-meaning">${e.meaning}</td>`;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      section.appendChild(table);
      body.appendChild(section);
    }
    if (!anyVisible) {
      body.innerHTML = `<p class="lg-empty">No symbols match "${escHtml(filter)}".</p>`;
    }
  }

  renderSymbols("");
  searchInput.addEventListener("input", () => renderSymbols(searchInput.value));
}

// ── Equations ─────────────────────────────────────────────────────────────────

async function _renderEquations(container) {
  const resp = await _fetch("/api/learning/equations");
  clearEl(container);
  if (!resp.success) { container.innerHTML = `<p class="lg-error">Could not load equations.</p>`; return; }

  const intro = el("p", { cls: "lg-section-intro",
    text: "Key equations used in surrogate modeling. Symbols are defined in the Symbols tab." });
  container.appendChild(intro);

  for (const eq of resp.equations) {
    const card = el("div", { cls: "lg-eq-card" });

    const nameEl = el("div", { cls: "lg-eq-name", text: eq.name });
    card.appendChild(nameEl);

    const formulaEl = el("div", { cls: "lg-eq-formula" });
    formulaEl.innerHTML = eq.html;
    card.appendChild(formulaEl);

    if (eq.where?.length) {
      const whereEl = el("div", { cls: "lg-eq-where" });
      whereEl.innerHTML = `<span class="lg-eq-where-label">Where:</span>
        <ul class="lg-eq-where-list">${eq.where.map(w => `<li>${w}</li>`).join("")}</ul>`;
      card.appendChild(whereEl);
    }

    if (eq.note) {
      const noteEl = el("div", { cls: "lg-eq-note" });
      noteEl.innerHTML = eq.note;
      card.appendChild(noteEl);
    }

    container.appendChild(card);
  }
}

// ── Decision-tree renderer ────────────────────────────────────────────────────

function _renderTreeAt(container, nodes, nodeId) {
  clearEl(container);
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const node = nodeMap[nodeId];
  if (!node) return;

  if (node.type === "question") {
    const questionEl = el("div", { cls: "lg-tree-question" });
    questionEl.innerHTML = `<p class="lg-tree-q-text">${escHtml(node.text)}</p>`;
    if (node.hint) {
      questionEl.innerHTML += `<p class="lg-tree-hint">${escHtml(node.hint)}</p>`;
    }
    const choicesEl = el("div", { cls: "lg-tree-choices" });
    for (const choice of node.choices) {
      const btn = el("button", { cls: "lg-tree-choice-btn", text: choice.label });
      btn.addEventListener("click", () => _renderTreeAt(container, nodes, choice.next));
      choicesEl.appendChild(btn);
    }
    questionEl.appendChild(choicesEl);
    container.appendChild(questionEl);

  } else if (node.type === "recommendation") {
    const recEl = el("div", { cls: "lg-tree-rec" });
    recEl.innerHTML = `
      <div class="lg-tree-rec-label">Recommendation</div>
      <p class="lg-tree-rec-model">${escHtml(node.text)}</p>
      <p class="lg-tree-rec-reason">${escHtml(node.reason)}</p>`;
    const restartBtn = el("button", { cls: "lg-tree-restart-btn", text: "↩ Start over" });
    restartBtn.addEventListener("click", () => _renderTreeAt(container, nodes, "start"));
    recEl.appendChild(restartBtn);
    container.appendChild(recEl);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _fetch(url) {
  if (_cache[url]) return _cache[url];
  const resp = await get(url);
  if (resp.success) _cache[url] = resp;
  return resp;
}

function _removeExisting() {
  document.querySelector(".lg-overlay")?.remove();
  document.removeEventListener("keydown", _escListener);
}

function _escListener(e) {
  if (e.key === "Escape") closeGuide();
}

function _setActive(nav, activeBtn) {
  nav.querySelectorAll(".lg-topic-btn").forEach(b => b.classList.remove("active"));
  activeBtn.classList.add("active");
}
