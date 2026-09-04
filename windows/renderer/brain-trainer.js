// brain-trainer.js — optogenetic lesson player for the FlyWire v783 brain.
// Loads the same circuit as brain.js, plus a small library of pre-built
// lessons under data/lessons/*.json. Click "Apply" to fire the lesson;
// the brain window will flash the targeted neurons.
//
// The renderer is read-only: lesson files live on disk and are fetched
// lazily (no preload IPC needed for read). Save/load uses the same
// `flyAPI.lessons:save/load` channels exposed by preload.mjs.

import * as THREE from '../node_modules/three/build/three.module.js';

const api = window.flyAPI;
const lessonsEl = document.getElementById('lessons');
const helpEl = document.getElementById('help');
const entriesEl = document.getElementById('entries');
const statusEl = document.getElementById('status');
const applyBtn = document.getElementById('apply');
const saveBtn = document.getElementById('save');
const loadBtn = document.getElementById('load');

let circuit = null;        // {neurons:[{role,type,side,pos,...}], ...}
let lessons = [];          // [{name, description, indices, strength, durationMs, ...}]
let selected = null;       // currently selected lesson object

function log(kind, text) {
  const el = document.createElement('div');
  el.className = `entry ${kind}`;
  const ts = new Date().toISOString().slice(11, 19);
  el.textContent = `${ts}  ${text}`;
  entriesEl.appendChild(el);
  entriesEl.scrollTop = entriesEl.scrollHeight;
}

function setStatus(text) { statusEl.textContent = text; }

function renderLessonList() {
  // Keep the header (first child) and rebuild below it.
  while (lessonsEl.children.length > 1) lessonsEl.removeChild(lessonsEl.lastChild);
  for (const l of lessons) {
    const row = document.createElement('div');
    row.className = 'lesson' + (selected === l ? ' selected' : '');
    row.dataset.name = l.name;
    const nm = document.createElement('div');
    nm.className = 'name'; nm.textContent = l.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${l.indices.length} neurons · k=${l.strength} · ${l.durationMs}ms`;
    row.appendChild(nm); row.appendChild(meta);
    row.addEventListener('click', () => selectLesson(l));
    lessonsEl.appendChild(row);
  }
}

function selectLesson(l) {
  selected = l;
  renderLessonList();
  renderHelp();
  setStatus(`${l.name} — ${l.indices.length} neurons, ${l.durationMs}ms`);
}

function renderHelp() {
  if (!selected) return;
  helpEl.innerHTML = `
    <h3>${escapeHtml(selected.name)}</h3>
    <p>${escapeHtml(selected.description || '(no description)')}</p>
    <p style="color:#8a96a8">${escapeHtml(selected.rationale || '')}</p>
    <p style="font:11px Consolas,monospace;color:#b8d0ff">
      indices: [${selected.indices.join(', ')}]<br>
      strength: ${selected.strength} &nbsp; durationMs: ${selected.durationMs}
    </p>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function loadCircuit() {
  try {
    const data = await api.getBrainData();
    if (!data || !data.circuit) {
      log('error', 'no circuit data — run etl.py first');
      return;
    }
    circuit = data.circuit;
  } catch (e) {
    log('error', 'circuit load failed: ' + e.message);
  }
}

async function loadLessons() {
  // Lessons ship as a static .json sidecar alongside the renderer so we
  // don't need a new IPC just to read them. The file is bundled by the
  // same path the overlay uses for relative imports.
  try {
    const res = await fetch('./lessons.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    lessons = await res.json();
    renderLessonList();
    log('info', `loaded ${lessons.length} lessons`);
  } catch (e) {
    log('error', 'lessons.json load failed: ' + e.message + ' (using inline defaults)');
    // Inline fallback — keeps the trainer usable even if the static fetch
    // is blocked (e.g. file:// CSP). The four real lessons still ship on
    // disk for editing; this is just the read-back path.
    lessons = INLINE_LESSONS;
    renderLessonList();
  }
}

const INLINE_LESSONS = [
  {
    name: 'loom-escape', description: 'looming detectors (LC4+LPLC2)',
    indices: [0, 1, 2, 5, 6, 7], strength: 0.4, durationMs: 80,
    rationale: 'canonical looming → escape pathway through GF (×6 electrical boost).',
  },
  {
    name: 'sugar-forward-walk', description: 'walk command (DNp09) + sensory pulse',
    indices: [62, 284, 338, 339, 340], strength: 0.25, durationMs: 400,
    rationale: 'tarsal-contact → forward walk. With plasticity on, sens→fwd edge grows.',
  },
  {
    name: 'turn-left', description: 'right steering DNa01 (contralateral turn)',
    indices: [327], strength: 0.3, durationMs: 300,
    rationale: 'right-DNa01 push → turn left via slow-adapted L−R rate diff.',
  },
  {
    name: 'groom-trigger', description: 'groom command (DNg11)',
    indices: [9, 92, 117], strength: 0.3, durationMs: 500,
    rationale: 'canonical grooming command, 0.4 s dwell guard before state switch.',
  },
];

function applySelected() {
  if (!selected) { log('error', 'no lesson selected'); return; }
  if (!circuit) { log('error', 'circuit not loaded yet'); return; }
  // Validate against the circuit.
  for (const i of selected.indices) {
    if (i < 0 || i >= circuit.neurons.length) {
      log('error', `lesson ${selected.name} references out-of-range index ${i}`);
      return;
    }
  }
  api.stimulate({
    indices: selected.indices.slice(),
    strength: selected.strength,
    durationMs: selected.durationMs,
  });
  log('apply', `stim ${selected.indices.length} neurons k=${selected.strength} ${selected.durationMs}ms`);
}

async function saveSelected() {
  if (!selected) { log('error', 'no lesson to save'); return; }
  if (!api.saveLesson) { log('error', 'saveLesson IPC not exposed'); return; }
  try {
    const ok = await api.saveLesson(selected.name, JSON.stringify(selected, null, 2));
    if (ok) log('save', `saved ${selected.name}.json`);
    else log('error', `save failed: ${ok}`);
  } catch (e) {
    log('error', 'save exception: ' + e.message);
  }
}

async function loadOne() {
  if (!selected) { log('error', 'pick a lesson to load first'); return; }
  if (!api.loadLesson) { log('error', 'loadLesson IPC not exposed'); return; }
  try {
    const txt = await api.loadLesson(selected.name);
    if (!txt) { log('error', `no saved file for ${selected.name}`); return; }
    const parsed = JSON.parse(txt);
    Object.assign(selected, parsed);
    renderLessonList();
    renderHelp();
    log('load', `reloaded ${selected.name} from disk`);
  } catch (e) {
    log('error', 'load exception: ' + e.message);
  }
}

applyBtn.addEventListener('click', applySelected);
saveBtn.addEventListener('click', saveSelected);
loadBtn.addEventListener('click', loadOne);

(async () => {
  await loadCircuit();
  await loadLessons();
  if (lessons.length) selectLesson(lessons[0]);
})();
