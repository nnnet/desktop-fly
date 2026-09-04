// zone-motion.js — pure-function helpers for game-zone motion.
//
// The renderer (windows/renderer/overlay.js) handles the per-frame
// lerp, the mesh updates, and the contact logging. The math —
// target selection, distance clamp, motion integration — lives here
// so it can be tested on bare Node (no THREE, no Electron, no DOM).
//
// Spec: fly-zone-wander.

const ZONE_EDGE_MARGIN = 60;       // pt: keep zones inside the display
const ZONE_CHASE_RANGE = 200;       // pt: max distance from the fly for chase
const ZONE_CHASE_MIN = 50;          // pt: min distance from the fly for chase

/**
 * Pick the next target for a zone. The result is clamped to the
 * display window (origin-centred, +Y up). `fly` is the closest fly
 * the zone is aware of; pass null to skip the chase branch.
 *
 * `r` ∈ [0, 1) is a caller-supplied random number (passed in so the
 * test can drive a deterministic sequence). `bounds` is the active
 * display rectangle in scene units: { width, height }.
 */
export function pickZoneTarget(zone, fly, bounds, r) {
  const hw = bounds.width / 2 - ZONE_EDGE_MARGIN;
  const hh = bounds.height / 2 - ZONE_EDGE_MARGIN;
  let x, y;
  if (r < zone.chaseProb && fly) {
    // Caller passes a deterministic angle + distance so tests can
    // assert exact targets. Production callers pass Math.random() for
    // both. The renderer module composes this via a wrapper.
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
