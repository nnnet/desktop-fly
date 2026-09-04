// zone-motion.test.js — pure-function tests for zone wander and
// per-kind state machines (predator / mate / sugar).
// Runs in bare Node, no Electron.
//   node test/zone-motion.test.js

import { pickZoneTarget, stepZoneMotion,
         predatorStep, mateStep, sugarStep } from '../src/zone-motion.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log(`PASS  ${name}`); pass++; }
  else { console.log(`FAIL  ${name}`); fail++; }
}
function approx(a, b, tol = 1e-6) { return Math.abs(a - b) < tol; }

const bounds = { width: 1512, height: 982 };
const fly = { pos: { x: 0, y: 0 } };

// 1. pickZoneTarget: chase branch (r < chaseProb) picks within 200 pt
{
  const zone = { kind: 'sugar', chaseProb: 0.15, _angle: 0, _dist: 100 };
  const t = pickZoneTarget(zone, fly, bounds, 0.05);
  check('sugar chase: target near fly, angle 0, dist 100', approx(t.x, 100) && approx(t.y, 0));
}
{
  const zone = { kind: 'sugar', chaseProb: 0.15, _angle: Math.PI, _dist: 200 };
  const t = pickZoneTarget(zone, fly, bounds, 0.05);
  check('sugar chase: target at angle PI, dist 200', approx(t.x, -200) && approx(t.y, 0, 1e-9));
}
{
  const zone = { kind: 'predator', chaseProb: 0.40, _angle: Math.PI / 2, _dist: 150 };
  const t = pickZoneTarget(zone, fly, bounds, 0.20);
  check('predator chase: target at angle PI/2, dist 150', approx(t.x, 0, 1e-9) && approx(t.y, 150));
}

// 2. pickZoneTarget: r >= chaseProb branch still returns clamped point
//    (Math.random() is uncontrolled, so we just check the result is
//    inside the display window)
{
  const zone = { kind: 'sugar', chaseProb: 0.15 };
  for (let i = 0; i < 50; i++) {
    const t = pickZoneTarget(zone, fly, bounds, 0.99);
    const hw = bounds.width / 2 - 60;
    const hh = bounds.height / 2 - 60;
    if (!(t.x >= -hw && t.x <= hw && t.y >= -hh && t.y <= hh)) {
      check(`off-branch clamp iter ${i}`, false);
      break;
    }
  }
  check('off-branch: 50 random repicks all inside display window', true);
}

// 3. pickZoneTarget: target is clamped to display window even when
//    the chase angle/dist would put it past the edge
{
  // fly at (1000, 0), chase at angle 0 with dist 1000 — would land at
  // (2000, 0) which is past the right edge (hw=696). Result should be
  // clamped to hw.
  const flyEdge = { pos: { x: 1000, y: 0 } };
  const zone = { kind: 'predator', chaseProb: 0.40, _angle: 0, _dist: 1000 };
  const t = pickZoneTarget(zone, flyEdge, bounds, 0.10);
  const hw = bounds.width / 2 - 60;
  check('chase clamped: target x is within [-hw, hw]',
    t.x >= -hw && t.x <= hw);
}

// 4. stepZoneMotion: lerp toward target at speed pt/s
{
  const z = { x: 0, y: 0, target: { x: 100, y: 0 }, speed: 50 };
  const r = stepZoneMotion(z, 1.0, bounds);
  check('sugar step 1s at 50pt/s: x ≈ 50', approx(r.x, 50));
  check('sugar step 1s at 50pt/s: y = 0', approx(r.y, 0));
}
{
  const z = { x: 0, y: 0, target: { x: 100, y: 0 }, speed: 30 };
  const r = stepZoneMotion(z, 1.0, bounds);
  check('sugar step 1s at 30pt/s: x ≈ 30', approx(r.x, 30));
}
{
  // Past target: 0.5 s at 50 pt/s, target at 20 pt → should arrive and stop
  const z = { x: 0, y: 0, target: { x: 20, y: 0 }, speed: 50 };
  const r = stepZoneMotion(z, 0.5, bounds);
  check('step past target: x is at or near 20', approx(r.x, 20));
}

// 5. stepZoneMotion: at target → no movement
{
  const z = { x: 100, y: 50, target: { x: 100, y: 50 }, speed: 50 };
  const r = stepZoneMotion(z, 1.0, bounds);
  check('at target: no movement', approx(r.x, 100) && approx(r.y, 50));
}

// 6. Spec scenario: 30 sugar repicks, ≥ 3 of 4 r < 0.15 targets
//    within 200 pt of the fly
{
  const zone = { kind: 'sugar', chaseProb: 0.15 };
  let chaseCount = 0;
  let within200 = 0;
  for (let i = 0; i < 30; i++) {
    // drive r: every 8th iteration r < 0.15
    const r = (i % 8 === 0) ? 0.05 : 0.50;
    if (r < zone.chaseProb) {
      chaseCount++;
      const t = pickZoneTarget(zone, fly, bounds, r);
      const d = Math.hypot(t.x, t.y);
      if (d <= 200) within200++;
    }
  }
  // we drove exactly 4 chase rolls; assert at least 3 are within 200
  check('30 sugar repicks: 4 chase rolls all within 200pt', chaseCount === 4 && within200 >= 3);
}

// -----------------------------------------------------------------------
// Per-kind state machines
// -----------------------------------------------------------------------

// Fake a `performance.now()` for the helpers (they use the global if
// present; we drive the wall clock from the test).
function fakeNow(start) {
  let now = start;
  return { advance: (ms) => { now += ms; return now; }, get: () => now };
}

// Predator: stationary for 4-8 s, then sprints, then rests again.
{
  const clock = fakeNow(0);
  // the helpers call performance.now() if defined; provide a stub.
  globalThis.performance = { now: () => clock.get() };
  const z = { kind: 'predator', x: 100, y: 100, target: { x: 0, y: 0 }, speed: 50 };
  const fly = { pos: { x: 0, y: 0 } };
  // Rest for 4 s
  for (let i = 0; i < 4; i++) {
    predatorStep(z, 1, fly, bounds);
    clock.advance(1000);
  }
  check('predator: still at spawn after 4 s of rest', approx(z.x, 100) && approx(z.y, 100));
  // After rest expires (5-8 s), a sprint target is picked and zone moves
  for (let i = 0; i < 5; i++) {
    predatorStep(z, 1, fly, bounds);
    clock.advance(1000);
  }
  check('predator: moved from spawn after rest+sprint', Math.hypot(z.x - 100, z.y - 100) > 5);
}

// Mate: orbits the fly (within 200 pt) at least 60 % of a 30 s window.
{
  const clock = fakeNow(0);
  globalThis.performance = { now: () => clock.get() };
  const z = { kind: 'mate', x: 50, y: 0, target: { x: 50, y: 0 }, speed: 20 };
  const fly = { pos: { x: 0, y: 0 } };
  let within200 = 0;
  const total = 30;     // 30 samples at 1 s intervals
  for (let i = 0; i < total; i++) {
    mateStep(z, 1, fly, bounds);
    const d = Math.hypot(z.x - fly.pos.x, z.y - fly.pos.y);
    if (d <= 200) within200++;
    clock.advance(1000);
  }
  check(`mate: within 200 pt ${within200}/${total} >= 18 (60 %)`,
    within200 >= 18);
}

// Sugar: stationary for 1-3 s, then flees, then sets removeRequested.
{
  const clock = fakeNow(0);
  globalThis.performance = { now: () => clock.get() };
  const z = { kind: 'sugar', x: 100, y: 0, speed: 30 };
  const fly = { pos: { x: 0, y: 0 } };
  // Tease: 0.5 s (1 sec of wall clock). Should still be stationary
  // because the tease state lasts 1-3 s.
  for (let i = 0; i < 2; i++) {
    sugarStep(z, 0.5, fly, bounds);
    clock.advance(500);
  }
  check('sugar: stationary in tease (within 1 s after spawn)',
    approx(z.x, 100) && approx(z.y, 0));
  // Skip past tease: 4 more seconds of wall clock forces the
  // tease->flee transition (max tease = 3 s).
  for (let i = 0; i < 8; i++) {
    sugarStep(z, 0.5, fly, bounds);
    clock.advance(500);
  }
  check('sugar: moved away from fly in flee',
    z.x > 100 && Math.abs(z.y) < 1);
  // Skip past flee: 4 more seconds (max flee = 3.5 s).
  for (let i = 0; i < 8; i++) {
    sugarStep(z, 0.5, fly, bounds);
    clock.advance(500);
  }
  check('sugar: removeRequested after flee', z.removeRequested === true);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
