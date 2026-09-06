## Purpose

Makes every game zone (sugar, mate, predator) move. The motion is
randomised but with a per-kind chance to drift toward the fly so the
user can observe the behavioural trigger within a normal session.

## ADDED Requirements

### Requirement: Every zone has a target and a repick loop

The system SHALL give every spawned zone a `target: {x, y}` field and
a `nextHopMs: number` field. The renderer SHALL lerp the zone's
position toward `target` at a per-kind `speed` (sugar: 30 pt/s, mate:
20 pt/s, predator: 50 pt/s). When the wall-clock time exceeds
`nextHopMs`, the system SHALL repick `target` and reset
`nextHopMs = now + 4000 + Math.random() * 6000`.

#### Scenario: Sugar zone is created with a target
- **WHEN** the user spawns a sugar zone at (x, y)
- **THEN** `z.target = { x, y }` and `z.nextHopMs = now + 4000..10000`

#### Scenario: Sugar zone drifts to its target
- **WHEN** a sugar zone is at (0, 0) and its target is (200, 0)
- **THEN** 1 s later it is at approximately (30, 0)

#### Scenario: Mate repicks target every 4–10 s
- **WHEN** 5 s have passed since the last repick
- **THEN** `target` is replaced with a new random point on the
  active display and `nextHopMs` is reset to 4–10 s in the future

### Requirement: Repick distribution includes a chase-the-fly branch

When the system repicks a zone's target, it SHALL first roll a
random number r ∈ [0, 1) and compare it to the kind's `chaseProb`:
sugar = 0.15, mate = 0.25, predator = 0.40. If r < chaseProb, the
system SHALL pick the target as a point within 200 pt of the fly
(using a random angle + distance ≤ 200). Otherwise the system SHALL
pick a point uniformly inside the active display, clamped to a
margin of 60 pt from the edge.

#### Scenario: Sugar chases the fly (15 % branch)
- **WHEN** 30 repicks of a sugar zone are observed with the fly at
  origin and the roll sequence containing exactly four r < 0.15
- **THEN** at least three of those four targets are within 200 pt of
  the origin

#### Scenario: Predator chases the fly (40 % branch)
- **WHEN** 10 repicks of a predator zone are observed with the fly
  at origin and the roll sequence containing exactly four r < 0.40
- **THEN** at least three of those four targets are within 200 pt of
  the origin

#### Scenario: Off-target repick stays inside the display
- **WHEN** r ≥ chaseProb at repick time
- **THEN** the new target is in `(-hw+60, hw-60) × (-hh+60, hh-60)`
  where hw, hh are half the active display's bounds

### Requirement: Zones stay inside the active display

The system SHALL clamp each zone's position to
`(-hw+margin, hw-margin) × (-hh+margin, hh-margin)` after every
movement tick, with `margin = 60` pt. The system SHALL NOT allow
zones to drift off-screen (which would make the demo invisible to
the user).

#### Scenario: Zone is clamped when its target is off-screen
- **WHEN** the lerp would move a sugar zone past the display edge
- **THEN** the next repick picks a target inside the display and the
  current position is clamped to the margin

### Requirement: Speed differentiates the three kinds

The system SHALL use speed (pt/s) to make the three zone kinds
visually distinct. Defaults: sugar 30, mate 20, predator 50. Faster
predator speed makes the predator "close in" feel real; slower mate
mimics a real courtship orbit.

#### Scenario: Predator is faster than mate
- **WHEN** a sugar zone and a predator zone are spawned with the
  same start position and the same target 100 pt to the right
- **THEN** the predator reaches the target first (it moves at
  50 pt/s vs sugar at 30 pt/s)
