## Purpose

Proves the renderer → fly wiring is intact. Without it, a user
reporting "the fly is not reacting" has no way to tell whether the
sim-side bias is firing or whether the bias is reaching `updateWalk`.
This capability adds a single `console.info` per contact and a
testable invariant per frame.

## ADDED Requirements

### Requirement: First contact per zone per fly is logged

The system SHALL emit a single `console.info` line of the form
`[zone] <kind> <event> id=<zoneId> fly=fly#<flyIndex> d=<dist> bias=<bias>`
the first time a given zone contacts a given fly. `event` is one of
`reach` (sugar inside r), `close` (mate within MATE_CLOSE_DIST), or
`loom` (predator within PREDATOR_RANGE). The log SHALL be rate-limited
to one line per (zoneId, flyIndex) pair for the lifetime of the
session.

#### Scenario: Sugar reach is logged once
- **WHEN** a fly enters a sugar zone for the first time
- **THEN** the renderer logs `[zone] sugar reach id=… fly=… d=… bias=…`
  exactly once

#### Scenario: Re-entering a sugar zone does not re-log
- **WHEN** the fly leaves the sugar zone and re-enters it later
- **THEN** no additional `reach` line is logged

#### Scenario: Predator contact logs once
- **WHEN** a fly first comes within PREDATOR_RANGE of a predator
- **THEN** the renderer logs `[zone] predator loom id=… fly=… d=… bias=…`
  exactly once

### Requirement: Bias is non-zero in the contact frame

The system SHALL guarantee that the per-frame `foodAttract`,
`mateAttract`, or `predatorAttract` value (whichever is relevant for
the zone kind) is non-zero in the same frame the contact log fires.
This is the testable invariant that proves the renderer reads the
zones and the fly model consumes the bias.

#### Scenario: Sugar reach frame has non-zero foodAttract
- **WHEN** the fly's distance to a sugar zone drops below r
- **THEN** the frame's `foodAttract` ≥ 0 (positive bias from the
  reach detection path) AND the sugar zone is in the zones array

#### Scenario: Predator contact frame has non-zero predatorAttract
- **WHEN** the fly's distance to a predator drops below PREDATOR_RANGE
- **THEN** the frame's `predatorAttract` < 0 (negative bias,
  heading away from the predator)

### Requirement: Tray "Spawn Near Fly" entry

The system SHALL add a tray item `Spawn Near Fly` that places a
sugar zone at a random angle within 200 pt of the fly. This is the
deterministic demo entry that the user can use to verify the
sugar-reach behaviour without waiting for the chase-bias branch.

#### Scenario: Spawn Near Fly places a sugar zone close
- **WHEN** the user clicks `Spawn Near Fly` with the fly at (0, 0)
- **THEN** a sugar zone is created within 200 pt of (0, 0)
