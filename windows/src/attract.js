// attract.js — heading-bias and reach-detection for food and mate zones.
// Pure function, no THREE, no Electron, testable in bare Node.
//
// Conventions:
//   - zone = { id?, kind: 'sugar' | 'mate', x, y, r } in scene space.
//     Scene origin is the overlay's center, +Y up (matches flymodel.js).
//   - foodAttract / mateAttract: signed scalar that the fly adds to
//     `heading` as `heading += attract * dt`. Positive = rotate CCW in our
//     three.js scene (so the fly's right is +x when heading=0 and the
//     camera looks down -z).
//   - We use the same angle convention as flymodel.js: heading is the
//     body's bearing in radians, with `dx = cos(heading)`, `dy = sin(heading)`.
//     A zone at bearing θ from the fly should drive `attract` so that
//     `heading += attract * dt` minimizes the angle to θ. That is exactly
//     the wrap-to-[-π,π] signed difference, with a sign flip so that a
//     positive attract rotates the fly toward the zone.
//
// Tuning constants are kept here so the renderer doesn't have to know
// about them: zone-relative distance is folded through a smooth falloff
// that is identical for food and mate except for the gradient strength.

const FOOD_RANGE = 800;       // pt: beyond this, food is invisible to the fly
const MATE_RANGE = 1200;      // pheromone diffuses further
const MATE_CLOSE_DIST = 60;   // pt: trigger courtship (wing extension)

// angleDiff(a, b): how much a must change to equal b, in [-π, π].
function angleDiff(a, b) {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// distance-based strength, normalized to [0, 1] across [0..range].
// (1 - d/range)^2 — strong near, gentle far, no discontinuity at range.
function falloff(d, range) {
  if (d >= range) return 0;
  const k = 1 - d / range;
  return k * k;
}

export function foodAndMateAttract(fly, zones) {
  let foodAttract = 0;
  let mateAttract = 0;
  let mateClose = false;
  let foodReached = null;

  for (const z of zones) {
    const dx = z.x - fly.pos.x;
    const dy = z.y - fly.pos.y;
    const d = Math.hypot(dx, dy);

    if (z.kind === 'sugar') {
      // Reach detection: inside the sugar's radius, the fly consumes it.
      // Caller (the renderer) is expected to remove the zone on a
      // non-null foodReached and is responsible for the visual puff +
      // reward stimulation; we just say which one to consume.
      if (d < z.r) {
        if (foodReached === null) foodReached = z.id ?? null;
        continue;   // don't also attract toward a zone we're already inside
      }
      // Heading: signed turn so heading approaches the bearing of the zone.
      // Strength = falloff (closer = stronger).
      const bearing = Math.atan2(dy, dx);
      const turn = angleDiff(fly.heading, bearing);
      // We want `heading += attract*dt` to move `heading` toward `bearing`.
      // If turn is positive (target is CCW from heading), attract > 0.
      // Magnitude scaled by falloff and capped at 1 rad/s.
      const mag = Math.min(1, falloff(d, FOOD_RANGE));
      const signed = Math.sign(turn) * mag;
      // Sum contributions; the closer zone wins because its falloff is larger.
      foodAttract += signed;
    } else if (z.kind === 'mate') {
      // Mate is a soft gradient, not a goal: even close approach doesn't
      // consume it. The closeness test drives wing extension.
      if (d < MATE_CLOSE_DIST) mateClose = true;
      const bearing = Math.atan2(dy, dx);
      const turn = angleDiff(fly.heading, bearing);
      const mag = Math.min(0.5, falloff(d, MATE_RANGE));
      mateAttract += Math.sign(turn) * mag;
    }
  }

  // Clamp combined magnitude so multiple zones don't blow up heading.
  if (foodAttract > 1) foodAttract = 1;
  if (foodAttract < -1) foodAttract = -1;
  if (mateAttract > 0.5) mateAttract = 0.5;
  if (mateAttract < -0.5) mateAttract = -0.5;

  return { foodAttract, mateAttract, mateClose, foodReached };
}
