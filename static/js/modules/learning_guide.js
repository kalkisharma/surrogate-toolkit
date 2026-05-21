// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/learning_guide.js
// Version: 3.1.0
// Description: Learning Guide modal — four tabs: Glossary, Model Guide,
//              Topics, Exercises. Opens via the "? Guide" header button.
//              Exercises tab auto-injects datasets and shows step-by-step
//              guidance with advisory quiz cards.
// =============================================================================

import { get, post } from "../api.js";
import { el, clearEl, escHtml } from "../utils.js";
import { showSuccess, showError } from "../notifications.js";

// ── Module state ──────────────────────────────────────────────────────────────

let _cache = {};           // keyed by endpoint string
let _activeExercise = null; // { id, steps[], currentStep, progress{} }

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
  const tabs = ["glossary", "models", "topics", "exercises"];
  const tabLabels = { glossary: "Glossary", models: "Model Guide", topics: "Topics", exercises: "Exercises" };

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

  if (tab === "glossary")   await _renderGlossary(container);
  else if (tab === "models")    await _renderModelGuide(container);
  else if (tab === "topics")    await _renderTopics(container);
  else if (tab === "exercises") await _renderExercises(container);
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
          <span class="lg-term-def">${escHtml(t.definition)}</span>`;
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
      <p class="lg-model-desc">${escHtml(m.description)}</p>
      <div class="lg-model-cols">
        <div>
          <h4 class="lg-list-head">Strengths</h4>
          <ul class="lg-list">${m.strengths.map(s => `<li>${escHtml(s)}</li>`).join("")}</ul>
        </div>
        <div>
          <h4 class="lg-list-head">Weaknesses</h4>
          <ul class="lg-list lg-list--weak">${m.weaknesses.map(w => `<li>${escHtml(w)}</li>`).join("")}</ul>
        </div>
      </div>
      <p class="lg-model-best"><strong>Best for:</strong> ${escHtml(m.best_for)}</p>
      <p class="lg-model-avoid"><strong>Avoid when:</strong> ${escHtml(m.avoid_when)}</p>`;

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
  { key: "diagnostics",    label: "Diagnostics & Metrics" },
  { key: "uncertainty",    label: "Uncertainty Quantification" },
  { key: "cv_strategies",  label: "Cross-Validation Strategies" },
  { key: "sensitivity",    label: "Sensitivity Analysis" },
  { key: "active_learning", label: "Active Learning" },
  { key: "data_cleaning",  label: "Data Cleaning" },
];

const _GUIDES = [
  { key: "model_selection", label: "Model Selection Guide" },
  { key: "cv_selection",    label: "CV Fold Selection Guide" },
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
      <p class="lg-section-body">${escHtml(section.body)}</p>`;
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
    text: "Guided exercises auto-load a synthetic dataset and walk you through the full workflow step by step. Quiz questions are advisory — you can always continue regardless of your answer." });
  container.appendChild(intro);

  for (const ex of resp.exercises) {
    container.appendChild(_buildExerciseCard(ex, container));
  }
}

function _buildExerciseCard(ex, listContainer) {
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
  card.innerHTML = `
    <div class="ex-card__header">
      <span class="ex-card__title">${escHtml(ex.title)}</span>
      <span class="ex-badge ${diffClass}">${escHtml(_DIFFICULTY_LABELS[ex.difficulty] || ex.difficulty)}</span>
    </div>
    <p class="ex-card__desc">${escHtml(ex.description)}</p>
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
  const hasData = stateResp?.datasets?.primary?.metadata?.filename;
  if (hasData && hasData !== _getExerciseDataset(exerciseId)) {
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

  _activeExercise = {
    id:           exerciseId,
    steps:        exResp.exercise.steps,
    currentStep:  0,
    progress:     exResp.progress,
  };

  closeGuide();
  _showExerciseOverlay();
  showSuccess(`Exercise started — dataset '${startResp.metadata.filename}' loaded.`);

  // Trigger panel navigation for step 0
  _navigateToStep(_activeExercise.steps[0]);
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
    <div class="ex-overlay__instruction">${escHtml(step.instruction)}</div>`;

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

  panel.querySelector(".ex-overlay__close").addEventListener("click", () => {
    _markStep(step.step_num);
    _removeExerciseOverlay();
  });

  document.body.appendChild(panel);
}

function _buildQuizCard(step, ex) {
  const quiz  = step.quiz;
  const saved = ex.progress?.quiz_answers?.[String(step.step_num)];

  const card = el("div", { cls: "ex-quiz" });
  card.innerHTML = `<p class="ex-quiz__q">${escHtml(quiz.question)}</p>`;

  const opts = el("div", { cls: "ex-quiz__opts" });
  quiz.options.forEach((opt, i) => {
    const btn = el("button", { cls: "ex-quiz__opt", text: opt });
    if (saved !== undefined) {
      btn.disabled = true;
      if (i === quiz.correct_index) btn.classList.add("ex-quiz__opt--correct");
      else if (i === saved)          btn.classList.add("ex-quiz__opt--wrong");
    }
    btn.addEventListener("click", () => _answerQuiz(card, quiz, i, step, ex));
    opts.appendChild(btn);
  });
  card.appendChild(opts);

  if (saved !== undefined) {
    _appendExplanation(card, quiz, saved);
  }

  return card;
}

function _answerQuiz(card, quiz, chosenIdx, step, ex) {
  // Disable all buttons and colour correct/wrong
  card.querySelectorAll(".ex-quiz__opt").forEach((btn, i) => {
    btn.disabled = true;
    if (i === quiz.correct_index) btn.classList.add("ex-quiz__opt--correct");
    else if (i === chosenIdx)      btn.classList.add("ex-quiz__opt--wrong");
  });
  _appendExplanation(card, quiz, chosenIdx);

  // Persist answer
  post("/api/learning/exercises/progress", {
    exercise_id: ex.id,
    step_num:    step.step_num,
    quiz_answer: chosenIdx,
  }).then(resp => {
    if (resp.success) ex.progress = resp.progress;
  });
}

function _appendExplanation(card, quiz, chosenIdx) {
  const existing = card.querySelector(".ex-quiz__explain");
  if (existing) existing.remove();
  const correct = chosenIdx === quiz.correct_index;
  const explain = el("div", { cls: `ex-quiz__explain${correct ? " ex-quiz__explain--correct" : " ex-quiz__explain--wrong"}` });
  explain.innerHTML = `<strong>${correct ? "Correct." : "Not quite."}</strong> ${escHtml(quiz.explanation)}`;
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
  document.getElementById("ex-overlay")?.remove();
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
