// brain-stats.js — renderer for the Brain Stats window.
// Spec: openspec/changes/fly-neuron-activity-bars/specs/fly-neuron-activity-bars/spec.md
//
// Consumes the `state` IPC stream and renders a per-behaviour bar
// chart (walk / fly / idle / groom / sleep / eat / court) with two
// global-share bars per row (lifetime share + recent share) and a
// numeric recent-count column on the right.

import { BrainStats } from '../src/brain-stats.js';

const api = window.flyAPI;

const metaEl   = document.getElementById('meta');
const barsEl   = document.getElementById('bars');
const statusEl = document.getElementById('status');

// Default 7 behaviours that appear in the `state.tag` field. The
// config may override this list (or use the legacy `neurons` key as
// an alias). The renderer always normalises bar widths globally,
// so a behaviour with 0 events shows a width-0 bar.
const DEFAULT_BEHAVIOURS = ['walk', 'fly', 'idle', 'groom', 'sleep', 'eat', 'court'];
// For each behaviour, list the neurons that "drive" it — purely
// cosmetic: shown as a subtitle so the user can see which command
// populations actually contribute to the bar.
const NEURONS_FOR = {
  walk:   'DNa01, DNa02, DNp09, MDN',
  fly:    'GF, escW',
  idle:   '—',
  groom:  'DNg11',
  sleep:  '—',
  eat:    '—',
  court:  '—',
};

let config = null;        // {behaviours, metric, window_seconds}
let stats  = null;        // BrainStats instance
let lastRender = 0;       // throttle to upstream 10 Hz cadence
let configRev  = '';      // serialised config to detect file changes

function fmt(value, isDuration) {
  if (isDuration) return value.toFixed(1) + 's';
  return String(value);
}

function render(now) {
  if (!config || !stats) return;
  if (now - lastRender < 100) return;
  lastRender = now;

  const isDuration = config.metric === 'sum_duration';
  const behaviours = config.behaviours;

  // One pass through the buffer per metric. Both `totalsByTag` and
  // `recentCountsByTag` walk the buffer once, so the cost is the
  // two-pass overhead is acceptable at 10 Hz.
  const t = stats.totalsByTag(performance.now());
  const counts = stats.recentCountsByTag(performance.now());

  // Global share = each behaviour's lifetime sum ÷ total lifetime
  // across all rows (same for recent). The dominant behaviour fills
  // its share of the bar, not the full row.
  const sumLt = behaviours.reduce((s, b) => s + (t.lifetime[b] || 0), 0);
  const sumRt = behaviours.reduce((s, b) => s + (t.recent[b]   || 0), 0);

  // Column header is drawn once, outside the per-row loop. We do
  // it via a separate innerHTML write so the header doesn't re-render
  // 9 times.
  const header =
    '<div class="col-header">' +
      '<div class="label">behaviour</div>' +
      '<div class="col">lifetime share</div>' +
      '<div class="col">recent (' + config.window_seconds + 's)</div>' +
      '<div class="num">recent count</div>' +
    '</div>';

  const parts = [header];
  for (const b of behaviours) {
    const lt = t.lifetime[b] || 0;
    const rt = t.recent[b]   || 0;
    const ltPct = sumLt > 0 ? (lt / sumLt) * 100 : 0;
    const rtPct = sumRt > 0 ? (rt / sumRt) * 100 : 0;
    const known = b in t.lifetime || b in t.recent;
    const count = counts[b] || 0;
    const sub = NEURONS_FOR[b] ? '<span class="sub">' + NEURONS_FOR[b] + '</span>' : '';
    parts.push(
      '<div class="row' + (known ? '' : ' disabled') + '" data-name="' + b + '">' +
        '<div class="name">' + b + sub + '</div>' +
        '<div class="track"><div class="fill lifetime" style="width:' + ltPct.toFixed(1) + '%"></div></div>' +
        '<div class="track"><div class="fill recent"   style="width:' + rtPct.toFixed(1) + '%"></div></div>' +
        '<div class="num">' + (isDuration ? fmt(rt, true) : count) + '</div>' +
      '</div>'
    );
  }
  barsEl.innerHTML = parts.join('');
  statusEl.textContent = 'metric: ' + config.metric +
    '   window: ' + config.window_seconds + 's' +
    '   events: ' + stats.events.length;
}

async function loadConfig() {
  if (!api.brainStats) {
    statusEl.textContent = 'preload bridge missing brainStats() — restart required';
    return;
  }
  try {
    const next = await api.brainStats();
    // The legacy config used the `neurons` key (one row per neuron
    // name); the new spec uses `behaviours` (one row per behavioural
    // state). Accept both — the renderer's defaults handle whichever
    // is present.
    const merged = { behaviours: next.behaviours || next.neurons || DEFAULT_BEHAVIOURS, ...next };
    const rev = JSON.stringify(merged);
    if (rev === configRev) return false;
    configRev = rev;
    config = merged;
    if (!stats) stats = new BrainStats(config);
    else stats.replaceConfig(config);
    metaEl.textContent =
      'behaviours: ' + config.behaviours.length +
      '   metric: ' + config.metric +
      '   window: ' + config.window_seconds + 's';
    return true;
  } catch (err) {
    statusEl.textContent = 'config load failed: ' + (err && err.message || err);
    return false;
  }
}

function start() {
  loadConfig().then(() => render(performance.now()));
  if (api.onState) {
    api.onState((payload) => {
      if (!payload || !payload.tag) return;
      if (stats) stats.push(payload.tag, performance.now());
      render(performance.now());
    });
  }
  setInterval(() => {
    loadConfig().then((changed) => { if (changed) render(performance.now()); });
  }, 1000);
}

start();
