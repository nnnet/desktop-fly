// attracttest.js — pure-function tests for food/mate heading bias.
// Runs in bare Node, no Electron.
//   node test/attracttest.js

import { foodAndMateAttract } from '../src/attract.js';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { console.log(`PASS  ${name}`); pass++; }
  else { console.log(`FAIL  ${name}`); fail++; }
}
function approx(a, b, tol = 1e-6) { return Math.abs(a - b) < tol; }

const fly = { pos: { x: 0, y: 0 }, heading: 0 };

// 1. No zones -> both biases 0.
{
  const r = foodAndMateAttract(fly, []);
  check('no zones -> foodAttract 0', r.foodAttract === 0);
  check('no zones -> mateAttract 0', r.mateAttract === 0);
  check('no zones -> mateClose false', r.mateClose === false);
}

// 2. Sugar zone to the right of fly (heading=0 → +x): fly already looks
// that way -> attract = 0. With heading=π/2 (facing up) and zone to the
// right (bearing 0), the turn to the right (CW) should be negative.
{
  const f1 = { pos: { x: 0, y: 0 }, heading: 0 };
  const r1 = foodAndMateAttract(f1, [{ kind: 'sugar', x: 200, y: 0, r: 40 }]);
  check('sugar ahead, heading=0 -> foodAttract 0', r1.foodAttract === 0);

  const f2 = { pos: { x: 0, y: 0 }, heading: Math.PI / 2 };
  const r2 = foodAndMateAttract(f2, [{ kind: 'sugar', x: 200, y: 0, r: 40 }]);
  check('sugar right, heading=π/2 -> foodAttract < 0 (turn CW)', r2.foodAttract < 0);
}

// 3. Sugar zone ahead but heading is 180° (facing -x): the fly must turn
// 180° to reach it -> |attract| near max, sign = +π to 0 → CW (negative).
{
  const f = { pos: { x: 0, y: 0 }, heading: Math.PI };
  const r = foodAndMateAttract(f, [{ kind: 'sugar', x: 200, y: 0, r: 40 }]);
  check('sugar ahead, heading=π -> |foodAttract| > 0.5', Math.abs(r.foodAttract) > 0.5);
}

// 4. Sugar directly behind: heading=0, zone at (-x, 0). Turn target is π
// (180°). angleDiff(0, π) wraps to -π, so the fly should turn either way
// (|attract| is 1, sign is implementation-defined). The signal is strong
// enough that the fly reverses, which is the important thing.
{
  const r = foodAndMateAttract(fly, [{ kind: 'sugar', x: -200, y: 0, r: 40 }]);
  check('sugar behind -> |foodAttract| near 1', Math.abs(r.foodAttract) > 0.5);
}

// 5. Sugar close-by: stronger bias than sugar far.
{
  const near = foodAndMateAttract({ pos: { x: 0, y: 0 }, heading: Math.PI / 2 },
    [{ kind: 'sugar', x: 60, y: 0, r: 40 }]);
  const far  = foodAndMateAttract({ pos: { x: 0, y: 0 }, heading: Math.PI / 2 },
    [{ kind: 'sugar', x: 800, y: 0, r: 40 }]);
  check('closer sugar -> stronger |foodAttract|',
    Math.abs(near.foodAttract) > Math.abs(far.foodAttract));
}

// 6. Reach detection: distance < zone.r → foodReached set to that zone's id.
{
  const r = foodAndMateAttract(
    { pos: { x: 35, y: 0 }, heading: 0 },
    [{ id: 7, kind: 'sugar', x: 40, y: 0, r: 30 }],
  );
  check('inside zone -> foodReached = 7', r.foodReached === 7);
}

// 7. Just outside the zone -> foodReached is null.
{
  const r = foodAndMateAttract(
    { pos: { x: 0, y: 0 }, heading: 0 },
    [{ id: 7, kind: 'sugar', x: 200, y: 0, r: 30 }],
  );
  check('outside zone -> foodReached null', r.foodReached === null);
}

// 8. Mate (pheromone) within 60 pt -> mateClose true. With heading=0 and
// mate at (+40, 0) directly ahead, attract = 0 (no turn needed) but
// mateClose is still set.
{
  const r = foodAndMateAttract(
    { pos: { x: 0, y: 0 }, heading: 0 },
    [{ id: 3, kind: 'mate', x: 40, y: 0, r: 60 }],
  );
  check('mate near -> mateClose true', r.mateClose === true);
  check('mate near, ahead -> mateAttract 0 (no turn needed)', r.mateAttract === 0);
}

// 9. Mate and sugar combined: food wins (stronger gradient).
{
  const r = foodAndMateAttract(fly, [
    { id: 1, kind: 'sugar', x: 200, y: 0, r: 40 },
    { id: 2, kind: 'mate',  x: 300, y: 0, r: 80 },
  ]);
  check('mixed -> foodReached null (both far)', r.foodReached === null);
}

// 10. Multiple sugars, only the closest contributes strongest bias.
{
  const r = foodAndMateAttract(fly, [
    { id: 1, kind: 'sugar', x:  100, y: 0, r: 30 },
    { id: 2, kind: 'sugar', x: -200, y: 0, r: 30 },
  ]);
  check('two sugars -> net bias toward closer (positive)', r.foodAttract > 0);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
