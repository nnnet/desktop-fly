## Why

The previous change `fly-zone-movement` made every zone wander
with a chase-bias. In practice the result felt random and the fly
ignored zones when it was not in the `walking` state
(`updateWalk` is the only place zone heading-bias is applied;
non-walking states skipped it entirely). The user reported
"муха не реагирует на хищника" while standing on top of one.

This change replaces the uniform wander-with-chase with **per-kind
behaviour** that gives each zone a distinct personality:

- **Predator** — ambush: holds position for a few seconds, then
  *sprints* toward the fly at high speed, then rests, then
  sprints again. Always a chase — never a wander.
- **Mate** — orbit: stays near the fly most of the time (within
  250 pt), orbiting it slowly. Drifts away briefly, then returns.
- **Sugar** — tease: appears for a short window, then runs away
  from the fly at high speed for a few seconds, then disappears
  (remove from scene). The user must spawn more if they want
  more. Visible: 1–3 s, then 3 s of flight, then gone.

It also fixes the **state-gating bug**: heading-bias is now
applied in the renderer's per-frame `frame()` loop directly
(via `applyZoneHeading(fly, attract)`), so the fly reacts in
every state, not only `walking`. The bias is added to the fly's
heading with a clamp so it cannot reverse a sustained escape
flight's direction, but otherwise it steers in real time.

## What Changes

- **Three new per-kind motion modes** in
  `windows/src/zone-motion.js`: `predatorStep`, `mateStep`,
  `sugarStep`. Each takes the zone, the fly (for chase / orbit /
  flee), the bounds, and the wall-clock `dt` / `now`, and
  mutates the zone in place.
- **Three new per-kind rest budgets** in the same file:
  predator sprints every 4-8 s for 1.5 s, mate orbits forever
  (no rest), sugar has a 1-3 s window then 3 s flee then
  self-destruct.
- **Renderer wires the new modes** in `windows/renderer/overlay.js`:
  `drawZones(t, dt, fly)` calls the per-kind step instead of the
  generic `stepZoneMotion`.
- **Renderer applies zone heading every frame** in `frame()`:
  a new `applyZoneHeading(fly, attract)` call after the
  `signalBuilder.make(sim, dt)` line. The bias is added to
  `fly.heading` and the fly model continues to apply it through
  `updateWalk` (so non-walking states still get a small bias;
  this is the primary fix for the "fly ignores predator" report).
- **No new tray items**, no new sim code, no new tests beyond
  the per-kind motion unit tests.

## Capabilities

### New Capabilities

- `fly-zone-per-kind-motion`: per-kind motion profiles
  (predator: sprint, mate: orbit, sugar: tease-and-flee). The
  motion update reads the zone's `kind` and `state` to choose
  the next tick's behaviour.
- `fly-zone-heading-always-on`: zone heading-bias is applied
  in the renderer's per-frame loop, not only inside
  `fly.updateWalk`. The bias is throttled so it cannot fight
  a sustained escape flight.

### Modified Capabilities

- (none — `fly-zone-wander` and `fly-zone-contact-debug` remain
  accurate at the level of "every zone has a target and
  contacts are logged")

## Impact

- `windows/src/zone-motion.js` (new functions): three per-kind
  step helpers. Pure functions, no THREE. Tests on bare Node.
- `windows/renderer/overlay.js`: `drawZones` calls the new
  per-kind helpers; `frame()` calls `applyZoneHeading` for the
  primary fly.
- `windows/renderer/overlay.js` checkReaches: `foodReached`
  removes the sugar zone; the per-kind helper can request
  removal via `z.removeRequested = true`.
- `windows/test/zone-motion.test.js`: new scenarios per kind.
- `docs/ubuntu.md`, `linux/README.md`, `windows/README.md`:
  update the Game-mode paragraph to describe the three
  personalities and the per-state heading-bias.
