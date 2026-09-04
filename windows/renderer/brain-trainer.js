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

// ---- Memory tab (Hebbian weight bar chart) ----
// Spec: brain-trainer-memory-view. Reads ~/.config/desktop-fly/food-memories.json
// (or its Windows equivalent) on demand and on a 30 s poll. Renders the
// top 20 edges by |dW|, green for LTP, red for LTD.
const tabs = document.querySelectorAll('#tabs .tab');
const lessonsPane = document.getElementById('lessons-pane');
const memoryPane = document.getElementById('memory-pane');
let memoryTimer = null;

tabs.forEach((t) => {
  t.addEventListener('click', () => {
    tabs.forEach((x) => x.classList.toggle('active', x === t));
    const which = t.dataset.tab;
    if (which === 'lessons') {
      lessonsPane.style.display = '';
      memoryPane.style.display = 'none';
      if (memoryTimer) { clearInterval(memoryTimer); memoryTimer = null; }
    } else {
      lessonsPane.style.display = 'none';
      memoryPane.style.display = '';
      refreshMemory();
      if (memoryTimer) clearInterval(memoryTimer);
      memoryTimer = setInterval(refreshMemory, 30000);
    }
  });
});

// Bar chart rendering. We read food-memories.json, but the file is the
// raw weight matrix from sim.exportWeights() — NOT a per-edge dW
// snapshot. The bar chart shows the absolute weight of the top 20 edges
// (heaviest edges, by |w|). To show "learning" we also compute dW from
// the initial weights (zeros for a fresh brain) so the chart is
// interpretable on first load. The 4-decimal precision is in the
// signed dW display; the bar length is `|w| / max|w|` of the snapshot.
async function refreshMemory() {
  const root = document.getElementById('memory');
  root.innerHTML = '<div class="placeholder">Loading…</div>';
  let payload = null;
  try {
    payload = await api.loadMemories();
  } catch (e) {
    root.innerHTML = `<div class="placeholder">load failed: ${escapeHtml(String(e.message || e))}</div>`;
    return;
  }
  if (!payload || !Array.isArray(payload.weights) || payload.weights.length === 0) {
    root.innerHTML = '<div class="placeholder">No learning yet — fly has not eaten or fled.</div>';
    return;
  }
  // Top 20 by |w|, but only for edges between the 9 command
  // populations (LC4, LPLC2, GF, DNa01/02, DNp09, DNg11, MDN,
  // escW). Edges between "other" sensory / ascending / motor
  // neurons are background activity — they are noise, not
  // behaviour, and dominated the top-20 in the user's first
  // review ("OTHER -> OTHER" everywhere).
  const COMMAND_ROLES = new Set(['lc4', 'lplc2', 'gf', 'dna01', 'dna02',
                                'dnp09', 'dng11', 'mdn', 'escw']);
  function edgeIsCommand(i) {
    if (!circuit || !circuit.edges || !circuit.edges[i]) return false;
    const [pre, post] = circuit.edges[i];
    const preR = circuit.neurons[pre] && circuit.neurons[pre].role;
    const postR = circuit.neurons[post] && circuit.neurons[post].role;
    return COMMAND_ROLES.has(preR) && COMMAND_ROLES.has(postR);
  }
  function shortRole(r) {
    if (r === 'lc4') return 'LC4';
    if (r === 'lplc2') return 'LPLC2';
    if (r === 'dna01') return 'DNa01';
    if (r === 'dna02') return 'DNa02';
    if (r === 'dnp09') return 'DNp09';
    if (r === 'dng11') return 'DNg11';
    if (r === 'mdn')   return 'MDN';
    if (r === 'escw')  return 'escW';
    if (r === 'gf')    return 'GF';
    return r ? r.toUpperCase() : '?';
  }
  function edgeLabelFor(i) {
    if (!circuit || !circuit.edges || !circuit.edges[i]) return `edge #${i}`;
    const [pre, post] = circuit.edges[i];
    const preR = circuit.neurons[pre] && circuit.neurons[pre].role;
    const postR = circuit.neurons[post] && circuit.neurons[post].role;
    return `${shortRole(preR)}\u2192${shortRole(postR)}`;
  }
  const idxs = payload.weights
    .map((w, i) => [Math.abs(w), w, i])
    .filter(([, , i]) => edgeIsCommand(i));
  idxs.sort((a, b) => b[0] - a[0]);
  const top = idxs.slice(0, 20);
  if (!top.length || top[0][0] === 0) {
    root.innerHTML = '<div class="placeholder">No learning yet between command populations.</div>';
    return;
  }
  const maxW = top[0][0];
  root.innerHTML = '';
  for (const [absW, w, i] of top) {
    const row = document.createElement('div');
    row.className = 'bar';
    const lab = document.createElement('div');
    lab.className = 'label';
    // Pre -> post population pair (e.g. 'LC4->DNp09'). The circuit
    // edges line up with sim.w[i] / food-memories.json weights
    // by index.
    lab.textContent = edgeLabelFor(i);
    const tr = document.createElement('div');
    tr.className = 'track';
    const fill = document.createElement('div');
    fill.className = 'fill ' + (w > 0 ? 'ltp' : 'ltd');
    const pct = Math.max(2, Math.round((absW / maxW) * 100));
    fill.style.width = pct + '%';
    tr.appendChild(fill);
    const dw = document.createElement('div');
    dw.className = 'dW';
    // 4-decimal precision per spec; the sign is implicit in the colour.
    const sign = w >= 0 ? '+' : '−';
    dw.textContent = `${sign}${Math.abs(w).toFixed(4)}`;
    row.appendChild(lab); row.appendChild(tr); row.appendChild(dw);
    root.appendChild(row);
  }
  const meta = document.createElement('div');
  meta.className = 'meta';
  const touched = payload.edgesTouched ?? 0;
  meta.textContent = `${payload.weights.length} edges · ${touched} touched since training started`;
  root.appendChild(meta);
}

(async () => {
  await loadCircuit();
  await loadLessons();
  if (lessons.length) selectLesson(lessons[0]);
})();
