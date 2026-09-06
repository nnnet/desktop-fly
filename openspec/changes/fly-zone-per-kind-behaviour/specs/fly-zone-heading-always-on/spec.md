## Purpose

Fixes the "fly ignores zones when not walking" bug by applying
the zone heading-bias in the renderer's per-frame loop, in
addition to the existing `updateWalk` consumption. The fly now
reacts to zones in every state (`walking`, `idle`, `grooming`,
`flying`, `sleeping`).

## ADDED Requirements

### Requirement: Renderer applies zone heading-bias every frame

The system SHALL compute `zoneAttract(fly, zones)` once per frame
for the primary fly and apply the resulting `foodAttract`,
`mateAttract`, `predatorAttract` deltas to `fly.heading` as
`fly.heading += bias * 1.0 * dt`. The renderer SHALL call this
after `signalBuilder.make(sim, dt)` and before
`fly.update(dt, bounds, mouseScene, signals)`.

#### Scenario: Fly heading-bias fires in idle state
- **WHEN** the primary fly is in `state = 'idle'` and a
  predator is within 100 pt
- **THEN** `fly.heading` changes by `predatorAttract * 1.0 * dt`
  on the next frame (i.e. the fly turns away from the predator
  even when not walking)

#### Scenario: Bias is throttled so it does not fight escape
- **WHEN** the primary fly is in `state = 'flying'` and a
  predator is within 100 pt
- **THEN** the heading-bias is applied at most 0.5× (so the
  sustained escape direction is not silently reversed by
  a side-channel heading edit)

### Requirement: Heading-bias is applied after sim step

The system SHALL apply the heading-bias AFTER the sim has stepped
and AFTER the sim-derived `BrainSignals` are computed, but
BEFORE `fly.update(dt, bounds, mouseScene, signals)` so the
fly model's own `updateWalk` consumption sees the same value
(no double-counting — the renderer's per-frame bias replaces
`updateWalk`'s consumption; `updateWalk` no longer multiplies
`foodAttract * 3.0` for the same frame).

#### Scenario: Bias applied between sim step and fly update
- **WHEN** the renderer enters its per-frame loop
- **THEN** `signalBuilder.make(sim, dt)` runs first, then
  `applyZoneHeading(first, attract, dt)`, then
  `fly.update(dt, bounds, mouseScene, signals)`
