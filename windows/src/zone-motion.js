// zone-motion.js — pure-function helpers for game-zone motion.
//
// The renderer (windows/renderer/overlay.js) handles the per-frame
// lerp, the mesh updates, and the contact logging. The math —
// target selection, distance clamp, motion integration, per-kind
// state machines — lives here so it can be tested on bare Node
// (no THREE, no Electron, no DOM).
//
// Spec: fly-zone-wander, fly-zone-per-kind-motion.

const ZONE_EDGE_MARGIN = 60;       // pt: keep zones inside the display
const ZONE_CHASE_RANGE = 200;       // pt: max distance from the fly for chase
const ZONE_CHASE_MIN = 50;          // pt: min distance from the fly for chase

// -- Generic helpers --------------------------------------------------------

/**
 * Pick the next target for a zone. The result is clamped to the
 * display window (origin-centred, +Y up). `fly` is the closest fly
 * the zone is aware of; pass null to skip the chase branch.
 *
 * `r` ∈ [0, 1) is a caller-supplied random number (passed in so
 * the test can drive a deterministic sequence). `bounds` is the
 * active display rectangle in scene units: { width, height }.
 */
export function pickZoneTarget(zone, fly, bounds, r) {
  const hw = bounds.width / 2 - ZONE_EDGE_MARGIN;
  const hh = bounds.height / 2 - ZONE_EDGE_MARGIN;
  let x, y;
  if (r < zone.chaseProb && fly) {
    // Caller passes a deterministic angle + distance so tests can
    // assert exact targets. Production callers pass Math.random() for
    // both.
    const angle = zone._angle !== undefined ? zone._angle : Math.random() * Math.PI * 2;
    const dist  = zone._dist  !== undefined ? zone._dist  : (ZONE_CHASE_MIN + Math.random() * (ZONE_CHASE_RANGE - ZONE_CHASE_MIN));
    x = fly.pos.x + dist * Math.cos(angle);
    y = fly.pos.y + dist * Math.sin(angle);
  } else {
    x = (Math.random() * 2 - 1) * hw;
    y = (Math.random() * 2 - 1) * hh;
  }
  // Clamp to display window
  return { x: Math.max(-hw, Math.min(hw, x)), y: Math.max(-hh, Math.min(hh, y)) };
}

/**
 * Step a zone toward its target by `speed` pt/s. Returns the new
 * position. `dt` is in seconds; the caller is expected to use the
 * wall-clock delta so the speed is in real seconds.
 */
export function stepZoneMotion(zone, dt, bounds) {
  const dx = zone.target.x - zone.x;
  const dy = zone.target.y - zone.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 0.5) return { x: zone.x, y: zone.y };
  const step = Math.min(dist, zone.speed * dt);
  return { x: zone.x + (dx / dist) * step, y: zone.y + (dy / dist) * step };
}

// -- Per-kind state machines -----------------------------------------------
//
// Each helper takes the zone, dt, fly, and bounds, and mutates the
// zone in place (x, y, target, plus a per-state timer). Helpers may
// also set zone.removeRequested = true to ask the renderer to
// despawn the zone.

// Predator: ambush → sprint → ambush → ...
//   rest: 4..8 s, no movement.
//   sprint: 50 pt/s toward a target 200..400 pt from the fly, until
//           within 30 pt of the target.
//   On first call the zone is spawned in `rest`; `restUntil` is set
//   to now + 4..8 s. After `rest` expires, we pick a sprint target.
//   After sprint arrival, we transition back to `rest` for 4..8 s.
export function predatorStep(z, dt, fly, bounds) {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (!z.predatorState) {
    z.predatorState = 'rest';
    z.restUntil = now + 4000 + Math.random() * 4000;
  }
  if (z.predatorState === 'rest') {
    if (now >= z.restUntil) {
      // Pick a sprint target 200..400 pt from the fly
      const ang = Math.random() * Math.PI * 2;
      const dist = 200 + Math.random() * 200;
      const hw = bounds.width / 2 - ZONE_EDGE_MARGIN;
      const hh = bounds.height / 2 - ZONE_EDGE_MARGIN;
      z.target.x = Math.max(-hw, Math.min(hw, fly.pos.x + dist * Math.cos(ang)));
      z.target.y = Math.max(-hh, Math.min(hh, fly.pos.y + dist * Math.sin(ang)));
      z.predatorState = 'sprint';
    } else {
      // Stay put — don't move the zone
      return;
    }
  }
  // sprint: lerp toward target
  const next = stepZoneMotion(z, dt, bounds);
  z.x = next.x;
  z.y = next.y;
  if (Math.hypot(z.target.x - z.x, z.target.y - z.y) < 30) {
    z.predatorState = 'rest';
    z.restUntil = now + 4000 + Math.random() * 4000;
  }
}

// Mate: orbit. Repick target every 4..8 s within 200 pt of the fly
// with a different angular sector so the orbit is visible.
export function mateStep(z, dt, fly, bounds) {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (!z.mateState) {
    z.mateState = 'orbit';
    z.nextRepick = 0;
  }
  if (now >= z.nextRepick) {
    // Pick a target within 200 pt of the fly at a different angle
    // than the previous target. We use the existing position as the
    // proxy for the previous target direction.
    const prevAng = z.target ? Math.atan2(z.target.y - fly.pos.y, z.target.x - fly.pos.x) : 0;
    const minDelta = Math.PI / 3;          // 60 deg
    let ang, dist, delta;
    for (let tries = 0; tries < 8; tries++) {
      ang = Math.random() * Math.PI * 2;
      delta = Math.abs(((ang - prevAng + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (delta >= minDelta) break;
    }
    dist = 100 + Math.random() * 100;     // 100..200 pt
    const hw = bounds.width / 2 - ZONE_EDGE_MARGIN;
    const hh = bounds.height / 2 - ZONE_EDGE_MARGIN;
    z.target.x = Math.max(-hw, Math.min(hw, fly.pos.x + dist * Math.cos(ang)));
    z.target.y = Math.max(-hh, Math.min(hh, fly.pos.y + dist * Math.sin(ang)));
    z.nextRepick = now + 4000 + Math.random() * 4000;
  }
  const next = stepZoneMotion(z, dt, bounds);
  z.x = next.x;
  z.y = next.y;
}

// Sugar: tease → flee → despawn.
//   tease: 1.0..3.0 s, stationary. The fly can approach and eat.
//   flee: 2.5..3.5 s, velocity = unit(fly → zone) * 60 pt/s. The
//         sugar is unreachable during flee (the renderer hides
//         foodReached when in flee? — actually we leave the
//         detection in place but sugar disappears soon anyway).
//   done: removeRequested = true.
export function sugarStep(z, dt, fly, bounds) {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (!z.sugarState) {
    z.sugarState = 'tease';
    z.sugarStateUntil = now + 1000 + Math.random() * 2000;
  }
  if (z.sugarState === 'tease') {
    if (now >= z.sugarStateUntil) {
      // pick a flee direction (away from the fly)
      const dx = z.x - fly.pos.x;
      const dy = z.y - fly.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      z.sugarFlee = { dx: dx / d, dy: dy / d };
      z.sugarState = 'flee';
      z.sugarStateUntil = now + 2500 + Math.random() * 1000;
    } else {
      // stay put
      return;
    }
  }
  if (z.sugarState === 'flee') {
    z.x += z.sugarFlee.dx * 60 * dt;
    z.y += z.sugarFlee.dy * 60 * dt;
    // clamp to display window
    const hw = bounds.width / 2 - ZONE_EDGE_MARGIN;
    const hh = bounds.height / 2 - ZONE_EDGE_MARGIN;
    z.x = Math.max(-hw, Math.min(hw, z.x));
    z.y = Math.max(-hh, Math.min(hh, z.y));
    if (now >= z.sugarStateUntil) {
      z.sugarState = 'done';
      z.removeRequested = true;
    }
  }
}
