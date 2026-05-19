// =============================================================================
// surrogate-toolkit
// Copyright (c) 2026 Kalki Sharma. All rights reserved.
// File: static/js/modules/learning_guide.js
// Version: 1.0.0
// Description: Learning Guide modal — three tabs: Glossary, Model Guide,
//              Topics. Opens via the "? Guide" header button. All data fetched
//              from /api/learning/*. No STATE mutation.
// =============================================================================

import { get } from "../api.js";
import { el, clearEl, escHtml } from "../utils.js";

// ── Module state ──────────────────────────────────────────────────────────────

let _cache = {};   // keyed by endpoint string

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
  const tabs = ["glossary", "models", "topics"];
  const tabLabels = { glossary: "Glossary", models: "Model Guide", topics: "Topics" };

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

  if (tab === "glossary") await _renderGlossary(container);
  else if (tab === "models") await _renderModelGuide(container);
  else if (tab === "topics") await _renderTopics(container);
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
