# Design — fly-zone-per-kind-behaviour

## Context

`fly-zone-movement` gave every zone the same wander-with-chase
motion. In practice the result felt aimless: the predator did
not "attack", the mate did not "court", and the sugar did not
"tease". Worse, the fly's heading-bias was only applied inside
`fly.updateWalk`, so a fly in `idle` or `flying` ignored zones
entirely (this is the screenshot the user sent: fly on top of
the predator octagon, not reacting).

This change replaces the single motion primitive with **per-kind
state machines** and moves the heading-bias application to the
renderer's per-frame loop, in front of `fly.update()`. The fly
model itself is unchanged; the renderer is the only place that
sees both the sim and the zones.

## Goals / Non-Goals

**Goals**

- Three distinct personalities, visible in the launcher:
  - **Predator**: ambush, then sprint, then rest, repeat.
  - **Mate**: orbit the fly, slow drift, mostly close.
  - **Sugar**: stationary 1–3 s, then flee, then despawn.
- Heading-bias works in every fly state.
- Contact log still fires for the three kinds.

**Non-Goals**

- No new tray items.
- No sim / Fly / FlyModel changes (the heading-bias application
  lives entirely in the renderer; the sim-side bias signal is
  the same as before).
- No new tests beyond per-kind motion unit tests.

## Decisions

### D1. Per-kind state machines in `zone-motion.js`

Three functions, each a state machine, mutate the zone in place
given `dt` and `fly`:

```
predatorStep(z, dt, fly, bounds)  // rest → sprint → rest
mateStep(z, dt, fly, bounds)      // orbit (continuous)
sugarStep(z, dt, fly, bounds)     // tease → flee → removeRequested
```

The generic `stepZoneMotion(z, dt, bounds)` stays for tests.
The renderer's `drawZones` switches on `z.kind` to choose which
helper to call.

### D2. Sugar self-destruct via `removeRequested`

`zone-motion.js` cannot reach into the renderer's scene graph.
The contract is `z.removeRequested = true`; the renderer
checks this flag at the end of `drawZones` and disposes the
mesh + splices the zone out of the array. Symmetric to how
`foodReached` is consumed today.

### D3. Heading-bias applied in `frame()` after sim step

The new `applyZoneHeading(fly, attract)` helper adds
`bias * 1.0 * dt` to `fly.heading`. The renderer calls it
once per frame. The fly model's `updateWalk` no longer
multiplies the same bias a second time (we delete the
existing `if (this.zones) zoneAttract(...)` call inside
`updateWalk` to avoid double-application).

For the `flying` state we multiply the bias by 0.5 to avoid
silently reversing an escape direction. Other states get the
full bias.

### D4. Keep the contact log; it still fires

`foodReached` (sugar inside r) is preserved. The renderer
removes the sugar zone in the same `checkReaches` block as
today. `mateClose` (mate within 60 pt) is preserved.
`predatorAttract != 0` (predator within range) preserves the
predator loom log.

## Risks / Trade-offs

- **Risk:** removing sugar zones quickly could empty the
  scene. → **Mitigation:** the user spawns sugar explicitly;
  if they want a longer-lived sugar they can spawn more often
  or wait for a future change. The spec for "tease" is short
  (1–3 s) by design.
- **Risk:** removing the `updateWalk` zone consumption
  changes the magnitude of the per-state heading bias. →
  **Mitigation:** the bias is now applied uniformly per frame
  in the renderer, and `updateWalk` continues to run for the
  `walking` state (so the existing `walking` / `idle`
  transitions still hold). The single-frame bias of 1.0× is
  roughly equivalent to the old 3.0× in `updateWalk` (the old
  code applied 3.0× per `updateWalk` frame; the new code
  applies 1.0× per frame at the same dt, so the angular
  displacement is ~3× lower — the spec's "throttled" multiplier
  compensates).
- **Risk:** mate orbit could become a chase if the orbit
  target is always re-picked toward the fly. → **Mitigation:**
  the spec requires the angular sector to rotate by ≥ 60 deg
  per repick, so the orbit is visible.

## Migration Plan

- No data migration.
- No new dependencies.
- Rollback: revert this commit. The motion code is
  renderer-only.

## Open Questions

- Should the predator's `rest` phase play an animation cue
  (e.g. dim the octagon) so the user knows it is about to
  attack? → Defer to a UI follow-up.
- Should the sugar's `flee` direction be the reverse of
  `fly-to-zone` (head away from the fly) or random? → The
  spec says reverse; that is the most consistent visual
  cue ("the sugar is running from you").
