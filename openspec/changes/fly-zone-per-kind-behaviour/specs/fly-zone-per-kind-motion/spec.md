## Purpose

Replaces the uniform "wander with chase-bias" motion with three
distinct per-kind personalities: predator sprints, mate orbits,
sugar teases and flees. The personalities are what the user sees
in the launcher; the heading-bias on the fly comes from
`fly-zone-heading-always-on`.

## ADDED Requirements

### Requirement: Predator sprint behaviour

When the system updates a predator zone, the system SHALL run a
two-state machine (`rest`, `sprint`):
- `rest`: zone is stationary, no target updates. Duration 4–8 s
  (random per zone, deterministic per session). On exit, the
  system picks a point 200–400 pt from the fly as the new
  `target` and transitions to `sprint`.
- `sprint`: zone lerps toward `target` at the predator's
  `speed` (50 pt/s). On arrival (within 30 pt of `target`) the
  zone transitions back to `rest` with a fresh 4–8 s rest
  duration.

#### Scenario: Predator spawns and immediately holds rest
- **WHEN** the user clicks `Spawn Predator` and the predator is
  created
- **THEN** the predator's first 4–8 s are `rest`; its position
  is the spawn point

#### Scenario: Predator sprints toward the fly after rest
- **WHEN** a predator zone's `rest` timer expires
- **THEN** the new `target` is within 200–400 pt of the fly and
  the zone begins lerping toward it

#### Scenario: Predator rests after each sprint
- **WHEN** a predator zone reaches its `target` (within 30 pt)
- **THEN** it transitions to `rest` and stops moving

### Requirement: Mate orbit behaviour

When the system updates a mate zone, the system SHALL keep the
mate within 200 pt of the fly **at least 60 % of the time** and
within 400 pt **at least 85 % of the time** over a 30 s window.
The system SHALL repick the orbit target every 4–8 s; the target
is a point within 200 pt of the fly, in a different angular
sector than the previous target so the orbit is visible.

#### Scenario: Mate is within 200 pt of the fly most of the time
- **WHEN** a mate zone has been alive for 30 s
- **THEN** at least 18 s of that 30 s, the mate's distance to
  the fly was ≤ 200 pt

#### Scenario: Mate's orbit target rotates
- **WHEN** the mate repicks its orbit target
- **THEN** the new target is in a different angular sector
  (delta ≥ 60 deg) from the previous target

### Requirement: Sugar tease-and-flee behaviour

When the system updates a sugar zone, the system SHALL run a
three-state machine (`tease`, `flee`, `done`):
- `tease`: zone is stationary for 1.0–3.0 s (random per zone).
  The fly can approach and consume.
- `flee`: zone moves away from the fly (vector from fly to zone,
  normalised) at 60 pt/s for 2.5–3.5 s. The zone does not
  consume during `flee` (effectively the fly cannot catch it
  once it has started fleeing).
- `done`: the zone removes itself from the scene. The renderer
  SHALL despawn the mesh and remove the zone from the array.

#### Scenario: Sugar teases the fly for 1–3 s
- **WHEN** a sugar zone is spawned or repicks
- **THEN** the zone is stationary for 1.0–3.0 s before
  transitioning to `flee`

#### Scenario: Sugar flees from the fly at 60 pt/s
- **WHEN** a sugar zone is in `flee` state
- **THEN** the zone's velocity vector is the unit vector from
  the fly to the zone, scaled by 60 pt/s

#### Scenario: Sugar removes itself after flee
- **WHEN** a sugar zone has been in `flee` for 2.5–3.5 s
- **THEN** the zone's mesh is removed from the scene and the
  zone is removed from the zones array

### Requirement: All three behaviours reuse the contact log

The existing contact log (`[zone] <kind> <event> id=...`) SHALL
be preserved for the three personalities. `foodReached` (sugar)
MUST be only emitted during the `tease` phase; predator's `loom`
log SHALL fire whenever the fly is in the `predatorAttract`
range regardless of `rest` / `sprint`; mate's `close` log SHALL
fire when the fly is within 60 pt regardless of the orbit phase.

#### Scenario: Sugar reach logs only in tease
- **WHEN** a sugar zone is in `flee` state and the fly is
  inside r
- **THEN** no `[zone] sugar reach` log is emitted

#### Scenario: Predator loom logs in both rest and sprint
- **WHEN** the fly is within 900 pt of a predator
- **THEN** `[zone] predator loom` is emitted regardless of
  whether the predator is in `rest` or `sprint`
