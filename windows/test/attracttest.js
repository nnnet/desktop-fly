// attracttest.js — pure-function tests for food/mate/predator heading bias.
// Runs in bare Node, no Electron.
//   node test/attracttest.js

import { zoneAttract, foodAndMateAttract, PREDATOR_RANGE_PT } from '../src/attract.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log(`PASS  ${name}`); pass++; }
  else { console.log(`FAIL  ${name}`); fail++; }
}
function approx(a, b, tol = 1e-6) { return Math.abs(a - b) < tol; }

const fly = { pos: { x: 0, y: 0 }, heading: 0 };

// 1. No zones -> both biases 0.
{
  const r = zoneAttract(fly, []);
  check('no zones -> foodAttract 0', r.foodAttract === 0);
  check('no zones -> mateAttract 0', r.mateAttract === 0);
  check('no zones -> mateClose false', r.mateClose === false);
  check('no zones -> speedMul 1', r.speedMul === 1);
}

// 2. Sugar zone to the right of fly (heading=0 → +x): fly already looks
// that way -> attract = 0. With heading=π/2 (facing up) and zone to the
// right (bearing 0), the turn to the right (CW) should be negative.
{
  const f1 = { pos: { x: 0, y: 0 }, heading: 0 };
  const r1 = zoneAttract(f1, [{ kind: 'sugar', x: 200, y: 0, r: 40 }]);
  check('sugar ahead, heading=0 -> foodAttract 0', r1.foodAttract === 0);

  const f2 = { pos: { x: 0, y: 0 }, heading: Math.PI / 2 };
  const r2 = zoneAttract(f2, [{ kind: 'sugar', x: 200, y: 0, r: 40 }]);
  check('sugar right, heading=π/2 -> foodAttract < 0 (turn CW)', r2.foodAttract < 0);
}

// 3. Sugar zone ahead but heading is 180° (facing -x): the fly must turn
// 180° to reach it -> |attract| near max, sign = +π to 0 → CW (negative).
{
  const f = { pos: { x: 0, y: 0 }, heading: Math.PI };
  const r = zoneAttract(f, [{ kind: 'sugar', x: 200, y: 0, r: 40 }]);
  check('sugar ahead, heading=π -> |foodAttract| > 0.5', Math.abs(r.foodAttract) > 0.5);
}

// 4. Sugar directly behind: heading=0, zone at (-x, 0). Turn target is π
// (180°). angleDiff(0, π) wraps to -π, so the fly should turn either way
// (|attract| is 1, sign is implementation-defined). The signal is strong
// enough that the fly reverses, which is the important thing.
{
  const r = zoneAttract(fly, [{ kind: 'sugar', x: -200, y: 0, r: 40 }]);
  check('sugar behind -> |foodAttract| near 1', Math.abs(r.foodAttract) > 0.5);
}

// 5. Sugar close-by: stronger bias than sugar far.
{
  const near = zoneAttract({ pos: { x: 0, y: 0 }, heading: Math.PI / 2 },
    [{ kind: 'sugar', x: 60, y: 0, r: 40 }]);
  const far  = zoneAttract({ pos: { x: 0, y: 0 }, heading: Math.PI / 2 },
    [{ kind: 'sugar', x: 800, y: 0, r: 40 }]);
  check('closer sugar -> stronger |foodAttract|',
    Math.abs(near.foodAttract) > Math.abs(far.foodAttract));
}

// 6. Reach detection: distance < zone.r → foodReached set to that zone's id.
{
  const r = zoneAttract(
    { pos: { x: 35, y: 0 }, heading: 0 },
    [{ id: 7, kind: 'sugar', x: 40, y: 0, r: 30 }],
  );
  check('inside zone -> foodReached = 7', r.foodReached === 7);
}

// 7. Just outside the zone -> foodReached is null.
{
  const r = zoneAttract(
    { pos: { x: 0, y: 0 }, heading: 0 },
    [{ id: 7, kind: 'sugar', x: 200, y: 0, r: 30 }],
  );
  check('outside zone -> foodReached null', r.foodReached === null);
}

// 8. Mate (pheromone) within 60 pt -> mateClose true. With heading=0 and
// mate at (+40, 0) directly ahead, attract = 0 (no turn needed) but
// mateClose is still set.
{
  const r = zoneAttract(
    { pos: { x: 0, y: 0 }, heading: 0 },
    [{ id: 3, kind: 'mate', x: 40, y: 0, r: 60 }],
  );
  check('mate near -> mateClose true', r.mateClose === true);
  check('mate near, ahead -> mateAttract 0 (no turn needed)', r.mateAttract === 0);
}

// 9. Mate and sugar combined: food wins (stronger gradient).
{
  const r = zoneAttract(fly, [
    { id: 1, kind: 'sugar', x: 200, y: 0, r: 40 },
    { id: 2, kind: 'mate',  x: 300, y: 0, r: 80 },
  ]);
  check('mixed -> foodReached null (both far)', r.foodReached === null);
}

// 10. Multiple sugars, only the closest contributes strongest bias.
{
  const r = zoneAttract(fly, [
    { id: 1, kind: 'sugar', x:  100, y: 0, r: 30 },
    { id: 2, kind: 'sugar', x: -200, y: 0, r: 30 },
  ]);
  check('two sugars -> net bias toward closer (positive)', r.foodAttract > 0);
}

// 11. Predator ahead (at +x, bearing 0) with fly heading 0 -> fly already
// faces the predator, so the sign-of-turn is 0. Move the predator off-axis
// so the heading must turn. Heading 0 (faces +x), predator at (-200, 0)
// (bearing π). The fly must turn CCW (positive attract in sugar
// convention) to face the predator. The sign is INVERTED for predator,
// so the result is NEGATIVE (turn CW, away from the predator at -x).
{
  const r = zoneAttract(
    { pos: { x: 0, y: 0 }, heading: 0 },
    [{ kind: 'predator', x: -200, y: 0, r: 50 }],
  );
  check('predator behind-left, heading=0 -> predatorAttract < 0 (turn away)', r.predatorAttract < 0);
}

// 12. Heading=π/2 (faces +y), predator at bearing 0 (+x). To face the
// predator the fly must turn CW (negative sugar attract). Predator
// inverts the sign: predatorAttract > 0 (turn CCW, away from +x).
{
  const r = zoneAttract(
    { pos: { x: 0, y: 0 }, heading: Math.PI / 2 },
    [{ kind: 'predator', x: 200, y: 0, r: 50 }],
  );
  check('predator right, heading=π/2 -> predatorAttract > 0 (CCW away)', r.predatorAttract > 0);
}

// 13. Predator beyond range -> no effect at all.
{
  const far = PREDATOR_RANGE_PT + 10;
  const r = zoneAttract(
    { pos: { x: 0, y: 0 }, heading: 0 },
    [{ kind: 'predator', x: far, y: 0, r: 50 }],
  );
  check('predator beyond range -> predatorAttract 0', r.predatorAttract === 0);
  check('predator beyond range -> speedMul 1', r.speedMul === 1);
}

// 14. Predator close -> speedMul > 1, capped at 1.5.
{
  const r = zoneAttract(
    { pos: { x: 0, y: 0 }, heading: 0 },
    [{ kind: 'predator', x: 100, y: 0, r: 50 }],
  );
  check('predator close -> speedMul > 1', r.speedMul > 1);
  check('predator close -> speedMul <= 1.5', r.speedMul <= 1.5);
  // At d=100 of range 900: k = 1 - 100/900 = 0.889, k*k = 0.790,
  // speedMul = 1 + 0.5*0.790 = 1.395.
  check('predator close -> speedMul ≈ 1.39', approx(r.speedMul, 1.395, 0.01));
}

// 15. Predator in contact (d=0) -> speedMul = 1.5 (capped), predatorAttract 0
// (heading already at the bearing — no turn needed, but speed boost is maxed).
{
  const r = zoneAttract(
    { pos: { x: 200, y: 0 }, heading: 0 },
    [{ kind: 'predator', x: 200, y: 0, r: 50 }],
  );
  check('predator on top -> speedMul = 1.5', approx(r.speedMul, 1.5, 0.01));
}

// 16. Predator does NOT consume on contact (foodReached stays null).
{
  const r = zoneAttract(
    { pos: { x: 200, y: 0 }, heading: 0 },
    [{ id: 9, kind: 'predator', x: 200, y: 0, r: 50 }],
  );
  check('predator on top -> foodReached null', r.foodReached === null);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
