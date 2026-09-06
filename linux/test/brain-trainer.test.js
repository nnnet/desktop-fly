// test/brain-trainer.test.js — validate the static lesson sidecar and the
// on-disk lesson files. Lessons ship under data/lessons/*.json (the source
// of truth edited by hand) and as a bundled JSON sidecar
// windows/renderer/lessons.json (consumed by brain-trainer.js). This test
// catches:
//   - missing fields, wrong types
//   - indices that point outside the circuit
//   - strength out of [0, 1] (clamped at stim time, but a >1.0 lesson is
//     almost certainly a typo)
//   - durationMs out of [50, 2000] (the stim API itself accepts anything,
//     but a 0 ms or 60 s lesson is almost certainly a typo)
//
// Bare Node, no Electron. The circuit is read once and used to validate
// every lesson.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '..', '..');
const circuitPath = resolve(project, 'data', 'circuit.json');
const lessonsDir  = resolve(project, 'data', 'lessons');
const sidecarPath = resolve(project, 'windows', 'renderer', 'lessons.json');

const circuit = JSON.parse(readFileSync(circuitPath, 'utf8'));
const circuitN = circuit.neurons.length;

function validateLesson(lesson, where) {
  assert.equal(typeof lesson.name, 'string', `${where}: name must be string`);
  assert.match(lesson.name, /^[a-z0-9._-]+$/i,
    `${where}: name "${lesson.name}" must be [a-z0-9._-]+`);
  assert.ok(Array.isArray(lesson.indices), `${where}: indices must be array`);
  for (const i of lesson.indices) {
    assert.ok(Number.isInteger(i), `${where}: index ${i} is not integer`);
    assert.ok(i >= 0 && i < circuitN,
      `${where}: index ${i} out of circuit bounds (0..${circuitN - 1})`);
  }
  assert.equal(typeof lesson.strength, 'number',
    `${where}: strength must be number`);
  assert.ok(lesson.strength >= 0 && lesson.strength <= 1,
    `${where}: strength ${lesson.strength} out of [0, 1]`);
  assert.equal(typeof lesson.durationMs, 'number',
    `${where}: durationMs must be number`);
  assert.ok(lesson.durationMs >= 50 && lesson.durationMs <= 2000,
    `${where}: durationMs ${lesson.durationMs} out of [50, 2000]`);
}

test('circuit.json loads and has 668 neurons', () => {
  assert.equal(circuitN, 668, 'circuit should have the canonical 668 neurons');
});

test('windows/renderer/lessons.json is valid sidecar', () => {
  if (!existsSync(sidecarPath)) {
    // The sidecar is optional; brain-trainer.js falls back to INLINE_LESSONS
    // if it can't fetch. Skip silently in that case.
    return;
  }
  const list = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  assert.ok(Array.isArray(list) && list.length > 0, 'sidecar must be a non-empty array');
  for (const l of list) validateLesson(l, `sidecar:${l.name || '?'}`);
});

test('data/lessons/*.json: all shipped lessons are valid', () => {
  if (!existsSync(lessonsDir)) {
    // No per-lesson files yet — that's OK, sidecar covers the runtime path.
    return;
  }
  const files = readdirSync(lessonsDir).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 4,
    `expected at least 4 lesson files under data/lessons/, found ${files.length}`);
  for (const f of files) {
    const p = resolve(lessonsDir, f);
    const l = JSON.parse(readFileSync(p, 'utf8'));
    validateLesson(l, `data/lessons/${f}`);
  }
});

test('the four canonical lessons cover distinct roles', () => {
  // loom-escape uses LC4/LPLC2; sugar-forward-walk uses DNp09; turn-left
  // uses DNa01; groom-trigger uses DNg11. Verify the role coverage is
  // real (different roles touched in each lesson) so a future edit that
  // accidentally collapses them all onto "other" gets caught.
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  const roleFor = (idx) => circuit.neurons[idx].role;
  const rolesByLesson = Object.fromEntries(sidecar.map(l =>
    [l.name, new Set(l.indices.map(roleFor))]));
  const all = new Set(Object.values(rolesByLesson).flatMap(s => [...s]));
  // Each lesson must touch a non-"other" role.
  for (const [name, set] of Object.entries(rolesByLesson)) {
    const hasNamed = [...set].some(r => r !== 'other');
    assert.ok(hasNamed, `lesson ${name} only touches "other" neurons`);
  }
  // Together the four lessons should cover at least 3 distinct named roles.
  const namedRoles = [...all].filter(r => r !== 'other');
  assert.ok(namedRoles.length >= 3,
    `expected at least 3 named roles across all lessons, got ${namedRoles.join(',')}`);
});
