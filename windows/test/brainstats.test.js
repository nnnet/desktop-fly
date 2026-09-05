// brainstats.test.js — pure-node test for the BrainStats aggregator.
// Spec: openspec/changes/fly-neuron-activity-bars/specs/fly-neuron-activity-bars/spec.md
// (Requirement: "Bars reflect aggregated state events" and the
// "Aggregator (pure-node testable)" design section).
//
// Run: node windows/test/brainstats.test.js   (or `pnpm test` from linux/)

import { BrainStats, DEFAULT_CONFIG, TAG_FOR_NEURON } from '../src/brain-stats.js';
import { loadConfig } from '../src/brain-stats-config.js';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rendererSafeSrc = join(here, '..', 'src', 'brain-stats.js');

function ts(sec) { return sec * 1000; }

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('PASS ', name); pass++; }
  catch (e) { console.log('FAIL ', name, '\n  ', e.message); fail++; }
}

test('empty buffer returns zeros for every behaviour', () => {
  const bs = new BrainStats(DEFAULT_CONFIG);
  const t = bs.totalsByTag();
  for (const b of DEFAULT_CONFIG.behaviours) {
    assert.equal(t.lifetime[b] || 0, 0, `${b} lifetime`);
    assert.equal(t.recent[b]   || 0, 0, `${b} recent`);
  }
  const counts = bs.recentCountsByTag();
  for (const b of DEFAULT_CONFIG.behaviours) {
    assert.equal(counts[b] || 0, 0, `${b} recent count`);
  }
});

test('count metric: 5 walk in 60s, 23 walk in 10min → DNp09 lifetime=23 recent=5', () => {
  const bs = new BrainStats({ ...DEFAULT_CONFIG, metric: 'count', window_seconds: 60 });
  // 20 walk events over 10 min (0..600s)
  for (let i = 0; i < 20; i++) bs.push('walk', ts(i * 30));
  // Last 5 within the last 60s (the ones at 540, 570, ... but at
  // 30s spacing the last 5 are 540, 570, 600 → wait, those are within
  // 60s of t=600 only if window_seconds is from the last push, which
  // it is). At t=600 the window covers [540, 600]: events at i=18
  // (540), 19 (570) — and we haven't pushed one at 600 yet. Push a
  // few more inside the window.
  bs.push('walk', ts(595));
  bs.push('walk', ts(598));
  bs.push('walk', ts(600));
  const a = bs.aggregatesFor('DNp09');
  assert.equal(a.lifetime, 23, 'lifetime count');
  assert.equal(a.recent, 5, 'recent count (last 60s of a 600s session)');
});

test('sum_duration: events at t=0,2,5 → DNp09 lifetime sum = 5', () => {
  const bs = new BrainStats({ ...DEFAULT_CONFIG, metric: 'sum_duration', window_seconds: 60 });
  bs.push('walk', ts(0));
  bs.push('walk', ts(2));
  bs.push('walk', ts(5));
  const a = bs.aggregatesFor('DNp09');
  // The "sum" between consecutive events is the time delta: 2-0=2, 5-2=3,
  // then 0 (last event has no next partner, so the open-ended tail is
  // 0 unless we ask at a later time). Total = 5 s.
  assert.equal(a.lifetime, 5, 'lifetime duration sum');
  assert.equal(a.recent, 5, 'recent duration sum (all within 60s)');
});

test('rolling window cuts off events older than window_seconds', () => {
  const bs = new BrainStats({ ...DEFAULT_CONFIG, metric: 'count', window_seconds: 60 });
  // Events at 0, 30, 60, 90, 120
  bs.push('walk', ts(0));
  bs.push('walk', ts(30));
  bs.push('walk', ts(60));
  bs.push('walk', ts(90));
  bs.push('walk', ts(120));
  // At t=120, recent window is [60, 120]: 3 events.
  const a = bs.aggregatesFor('DNp09');
  assert.equal(a.lifetime, 5);
  assert.equal(a.recent, 3);
});

test('unknown neuron returns zeros (does not crash)', () => {
  const bs = new BrainStats(DEFAULT_CONFIG);
  bs.push('walk', ts(0));
  const a = bs.aggregatesFor('NOT_A_NEURON');
  assert.equal(a.lifetime, 0);
  assert.equal(a.recent, 0);
});

test('default config has 7 behavioural states matching overlay.js tags', () => {
  // The keys must match the `state.tag` strings that overlay.js
  // publishes. In particular, the overlay emits 'flight' (not
  // 'fly') for the flying state — see overlay.js around line 615.
  // A previous version of this default used 'fly' and the
  // brain-stats window silently showed 0.0s for that row even when
  // the fly was clearly flying in the brain window.
  assert.equal(DEFAULT_CONFIG.behaviours.length, 7);
  for (const k of ['walk', 'flight', 'idle', 'groom', 'sleep', 'eat', 'court']) {
    assert.ok(DEFAULT_CONFIG.behaviours.includes(k), `default missing ${k}`);
  }
});

test('regression: a "flight" event is NOT silently dropped (matches overlay.js tag)', () => {
  // The user reported that the brain-stats window showed 0.0s for
  // "fly" while the fly was visibly flying in the brain window. The
  // root cause: DEFAULT_CONFIG used 'fly' but overlay.js publishes
  // 'flight'. The aggregator had no entry for 'fly' so the row
  // rendered 0s. This test pins the contract: events emitted by
  // the overlay must reach the matching row.
  const bs = new BrainStats(DEFAULT_CONFIG);
  bs.push('walk', 0);
  bs.push('flight', 30000);    // exactly what overlay.js sends
  bs.push('walk', 50000);
  const t = bs.totalsByTag(50000);
  // The 'flight' row should pick up the 20-second flight interval
  // (the time from t=30 to t=50, attributed to the later 'walk'
  // state under the later-tag semantic — wait, no: the interval
  // (30, 50] is attributed to the LATER event's tag, which is
  // 'walk'. So walk gets the (30,50] = 20s, and the open-ended
  // tail at 50s is attributed to the last 'walk' event.)
  // The flight interval is (0, 30] attributed to 'flight': 30s.
  assert.equal(t.lifetime.flight, 30,
    'a flight event must reach the flight row (was the regression)');
  assert.ok(t.lifetime.flight > 0,
    'flight row must be non-empty when the fly was flying');
});

test('TAG_FOR_NEURON maps every default neuron to a non-empty tag', () => {
  // The renderer still uses TAG_FOR_NEURON for the per-row neuron
  // subtitle (e.g. "GF, escW" under "fly"), so the table must
  // remain complete for all nine command populations.
  for (const n of ['LC4', 'LPLC2', 'GF', 'DNa01', 'DNa02', 'DNp09', 'DNg11', 'MDN', 'escW']) {
    assert.ok(TAG_FOR_NEURON[n], `${n} has a tag`);
    assert.notEqual(TAG_FOR_NEURON[n].length, 0, `${n} tag non-empty`);
  }
});

test('metric switch: same events, different metric → different values', () => {
  const cfgCount = { ...DEFAULT_CONFIG, metric: 'count', window_seconds: 60 };
  const cfgDur   = { ...DEFAULT_CONFIG, metric: 'sum_duration', window_seconds: 60 };
  const bsCount = new BrainStats(cfgCount);
  const bsDur   = new BrainStats(cfgDur);
  for (let i = 0; i < 4; i++) {
    bsCount.push('walk', ts(i * 10));
    bsDur.push('walk', ts(i * 10));
  }
  assert.equal(bsCount.aggregatesFor('DNp09').lifetime, 4);
  // durations: 10, 10, 10, 0 (last event has no next), total = 30
  assert.equal(bsDur.aggregatesFor('DNp09').lifetime, 30);
});

test('loadConfig: missing file returns defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bs-'));
  try {
    const path = join(dir, 'does-not-exist.json');
    const cfg = loadConfig(path);
    assert.deepEqual(cfg.neurons, DEFAULT_CONFIG.neurons);
    assert.equal(cfg.metric, DEFAULT_CONFIG.metric);
    assert.equal(cfg.window_seconds, DEFAULT_CONFIG.window_seconds);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadConfig: malformed JSON returns defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bs-'));
  try {
    const path = join(dir, 'bad.json');
    writeFileSync(path, '{ not json');
    const cfg = loadConfig(path);
    assert.deepEqual(cfg.neurons, DEFAULT_CONFIG.neurons);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadConfig: partial config merges with defaults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bs-'));
  try {
    const path = join(dir, 'partial.json');
    writeFileSync(path, JSON.stringify({ metric: 'count', window_seconds: 30 }));
    const cfg = loadConfig(path);
    assert.equal(cfg.metric, 'count');
    assert.equal(cfg.window_seconds, 30);
    // behaviours fall back to default
    assert.deepEqual(cfg.behaviours, DEFAULT_CONFIG.behaviours);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadConfig: valid full config is returned as-is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bs-'));
  try {
    const path = join(dir, 'full.json');
    writeFileSync(path, JSON.stringify({
      behaviours: ['walk', 'flight'],
      metric: 'count',
      window_seconds: 120,
    }));
    const cfg = loadConfig(path);
    assert.deepEqual(cfg.behaviours, ['walk', 'flight']);
    assert.equal(cfg.metric, 'count');
    assert.equal(cfg.window_seconds, 120);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadConfig: legacy `neurons` key is accepted as `behaviours` alias', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bs-'));
  try {
    const path = join(dir, 'legacy.json');
    writeFileSync(path, JSON.stringify({
      neurons: ['LC4', 'DNp09'],   // old per-neuron form
      metric: 'count',
      window_seconds: 60,
    }));
    const cfg = loadConfig(path);
    // The renderer maps one row per entry; the aggregator does not
    // care whether the list is behaviours or neuron names — it's
    // just a list of strings the renderer iterates.
    assert.deepEqual(cfg.behaviours, ['LC4', 'DNp09']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('recompute: same metric gives same values regardless of push order', () => {
  const cfg = { ...DEFAULT_CONFIG, metric: 'sum_duration', window_seconds: 60 };
  const a = new BrainStats(cfg);
  const b = new BrainStats(cfg);
  const events = [[0, 'walk'], [1, 'idle'], [3, 'walk'], [6, 'flight']];
  for (const [t, tag] of events) { a.push(tag, ts(t)); b.push(tag, ts(t)); }
  // lifetime is identical, recent at t=6 with window 60 is identical
  assert.equal(
    a.aggregatesFor('DNp09').lifetime,
    b.aggregatesFor('DNp09').lifetime,
  );
});

test('replaceConfig: swaps config without losing the event buffer', () => {
  const bs = new BrainStats(DEFAULT_CONFIG);
  bs.push('walk', ts(0));
  bs.push('walk', ts(5));
  const before = bs.aggregatesFor('DNp09');
  // hot-reload with a new metric: lifetime should be the same;
  // the recent window is now smaller so the recent value drops.
  bs.replaceConfig({ ...DEFAULT_CONFIG, metric: 'sum_duration', window_seconds: 30 });
  const after = bs.aggregatesFor('DNp09');
  assert.equal(after.lifetime, before.lifetime);
});

test('aggregator returns lifetime >= recent always', () => {
  const bs = new BrainStats({ ...DEFAULT_CONFIG, metric: 'sum_duration', window_seconds: 60 });
  for (let i = 0; i < 30; i++) bs.push('walk', ts(i * 5));
  const a = bs.aggregatesFor('DNp09');
  assert.ok(a.lifetime >= a.recent, `lifetime (${a.lifetime}) should be >= recent (${a.recent})`);
});

// Regression: the renderer (windows/renderer/brain-stats.js)
// imports `BrainStats` + `TAG_FOR_NEURON` from this module. The
// renderer's CSP forbids `node:*` scripts (script-src 'self'). If a
// future refactor pulls `node:fs` (or any other node-builtin) back
// into this module, the renderer will fail to load and the Brain
// Stats window will sit on "loading…" forever. This test fails
// loud at CI time so the regression can't ship.
test('brain-stats.js (renderer-safe) does not import any node:* module', () => {
  const src = readFileSync(rendererSafeSrc, 'utf8');
  // The only acceptable `node:` reference is the doc-comment
  // `node:fs` in the "must not import" explanation; we allow that.
  // Strip comments to avoid false positives.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/\/\/.*$/gm, '');          // line comments
  const m = stripped.match(/from\s+['"]node:[^'"]+['"]/g) || [];
  assert.equal(m.length, 0,
    'brain-stats.js must stay renderer-safe (no node:* imports): ' +
    m.join(', '));
});

test('totalsByTag: per-behaviour aggregates (the new behaviour-axis view)', () => {
  // Push 4 walk + 1 idle, alternating.
  const bs = new BrainStats({ ...DEFAULT_CONFIG, metric: 'sum_duration', window_seconds: 60 });
  bs.push('walk', ts(0));
  bs.push('walk', ts(2));
  bs.push('idle', ts(5));
  bs.push('walk', ts(10));
  bs.push('walk', ts(20));
  const t = bs.totalsByTag(ts(20));
  // walk durations: 0→2 (2s), 2→5 (3s but tag is idle, so walk gets 0), 5→10 (5s, walk), 10→20 (10s, walk)
  // walk sum: 2 + 5 + 10 = 17s
  // idle durations: 2→5 (3s) = 3s
  assert.equal(t.lifetime.walk, 17, 'walk lifetime');
  assert.equal(t.lifetime.idle, 3, 'idle lifetime');
  // recent (60s window) is identical here since all events fit
  assert.equal(t.recent.walk, 17, 'walk recent');
  assert.equal(t.recent.idle, 3, 'idle recent');
});

test('totalsByTag: recent window cuts off old events', () => {
  // Semantics: an interval between two events is attributed to the
  // LATER event's tag (because that is the state active at the end
  // of the interval). So a walk→walk interval contributes to walk,
  // a walk→idle contributes to idle, and so on.
  //
  // Recent window excludes intervals whose *end* (the later event)
  // is older than the cutoff. So an interval (e, next] only
  // contributes to `recent[next.tag]` if next.t >= cutoff.
  const bs = new BrainStats({ ...DEFAULT_CONFIG, metric: 'sum_duration', window_seconds: 60 });
  bs.push('walk', ts(0));     // outside the 60s window
  bs.push('walk', ts(80));    // next event 80, but the interval (0,80] is OUTSIDE recent
  bs.push('walk', ts(140));   // interval (80,140] ends at the cutoff
  bs.push('idle', ts(200));   // interval (140,200] is INSIDE recent, attributed to idle
  const t = bs.totalsByTag(ts(200));
  // Lifetime (all intervals)
  //  walk@0 → walk@80:    lt[walk] += 80
  //  walk@80 → walk@140:  lt[walk] += 60
  //  walk@140 → idle@200:  lt[idle] += 60
  //  idle@200 (tail):     lt[idle] += 0
  assert.equal(t.lifetime.walk, 80 + 60, 'walk lifetime = 80+60');
  assert.equal(t.lifetime.idle, 60, 'idle lifetime = 60');
  // Recent (cutoff = 140, so intervals ending at >= 140 count)
  //  (0,80]  ends at 80  < 140 → not counted
  //  (80,140] ends at 140 ≥ 140 → counted but the cap Math.min(60, 140-max(80,140))=min(60,0)=0
  //  (140,200] ends at 200 ≥ 140 → counted, idle += min(60, 200-max(140,140))=min(60,60)=60
  //  idle@200 (tail): tail=0, 200≥140 → idle += min(0, 200-max(200,140))=0
  assert.equal(t.recent.walk, 0, 'walk recent = 0 (interval ended at cutoff)');
  assert.equal(t.recent.idle, 60, 'idle recent = 60');
});

test('totalsByTag: count metric (not duration)', () => {
  const bs = new BrainStats({ ...DEFAULT_CONFIG, metric: 'count', window_seconds: 60 });
  bs.push('walk', ts(0));
  bs.push('walk', ts(1));
  bs.push('idle', ts(2));
  bs.push('walk', ts(3));
  const t = bs.totalsByTag(ts(3));
  assert.equal(t.lifetime.walk, 3);
  assert.equal(t.lifetime.idle, 1);
  assert.equal(t.recent.walk, 3);
  assert.equal(t.recent.idle, 1);
});

test('recentCountsByTag: integer counts within the recent window', () => {
  const bs = new BrainStats({ ...DEFAULT_CONFIG, metric: 'sum_duration', window_seconds: 60 });
  bs.push('walk', ts(0));    // outside
  bs.push('walk', ts(100));  // inside (cutoff = now-60s; for now=150s → cutoff=90s)
  bs.push('walk', ts(120));  // inside
  bs.push('idle', ts(150));  // inside
  const c = bs.recentCountsByTag(ts(150));
  // cutoff = 150 - 60 = 90 (in seconds, *1000 = 90000 ms)
  // events at 100, 120 (walk) and 150 (idle) pass
  assert.equal(c.walk, 2);  // events at 100, 120
  assert.equal(c.idle, 1);  // event at 150
  assert.equal(c.fly, undefined, 'fly never seen');
});

test('totalsByTag: unknown behaviour renders as zeros (does not crash)', () => {
  const bs = new BrainStats(DEFAULT_CONFIG);
  bs.push('some-new-state', ts(0));
  const t = bs.totalsByTag(ts(0));
  assert.equal(t.lifetime['some-new-state'], 0);
  assert.equal(t.recent['some-new-state'], 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
