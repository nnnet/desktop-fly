## Purpose

Models per-fly hunger as a continuous state that decays over time and is
restored by eating sugar zones. The state gates food attraction so a
recently-fed fly ignores sugar until hunger returns, closing the
behavioural loop between reward and motivation.

## ADDED Requirements

### Requirement: Per-fly sugar level

The system SHALL maintain a `sugarLevel` value ∈ [0, 1] for every fly
in the scene. The initial value at scene start SHALL be 0.2 (hungry).

#### Scenario: New fly starts hungry
- **WHEN** a fly is added to the scene
- **THEN** its `sugarLevel` is 0.2

#### Scenario: Sugar level is always in [0, 1]
- **WHEN** the system reads `sugarLevel` at any time
- **THEN** the value is in the closed interval [0, 1]

### Requirement: Sugar level decays over time

The system SHALL decay every fly's `sugarLevel` toward 0 with a time
constant τ = 60 s, applied per simulation tick. The decay formula SHALL
be `sugarLevel *= exp(-dt / τ)`.

#### Scenario: Decay over 60 seconds
- **WHEN** a fly's `sugarLevel` is 1.0 and no sugar is consumed for 60 s
- **THEN** `sugarLevel` is approximately 0.368 (e^-1)

#### Scenario: Decay toward zero
- **WHEN** `sugarLevel` is 0.05 and no sugar is consumed
- **THEN** `sugarLevel` approaches 0 asymptotically

### Requirement: Eating sugar restores hunger

The system SHALL add 0.4 to a fly's `sugarLevel` each time the fly's
position falls inside a sugar zone. The result SHALL be clamped to 1.

#### Scenario: Eating a single sugar zone
- **WHEN** a fly enters a sugar zone with `sugarLevel = 0.1`
- **THEN** `sugarLevel` becomes 0.5

#### Scenario: Eating at full satiation is clamped
- **WHEN** a fly enters a sugar zone with `sugarLevel = 0.9`
- **THEN** `sugarLevel` becomes 1.0 (not 1.3)

### Requirement: Satiety gates food attraction

The system SHALL multiply the fly's effective `foodAttract` by 0 when
`sugarLevel < 0.2`. Above the threshold, the multiplier SHALL be 1.

#### Scenario: Satiated fly ignores sugar
- **WHEN** `sugarLevel` is 0.5
- **THEN** the fly's effective `foodAttract` is unchanged

#### Scenario: Hungry fly is attracted
- **WHEN** `sugarLevel` is 0.1
- **THEN** the fly's effective `foodAttract` is 0 regardless of zone
  positions

#### Scenario: Threshold crossing restores attraction
- **WHEN** `sugarLevel` falls from 0.25 to 0.18 through decay
- **THEN** the fly begins to head toward visible sugar zones again

### Requirement: Sugar does not respawn automatically

The system SHALL NOT spawn a new sugar zone on its own. The only
source of new sugar zones SHALL be the user's tray `Spawn Sugar Zone`
command.

#### Scenario: Eating does not trigger a respawn
- **WHEN** a fly consumes a sugar zone
- **THEN** no new sugar zone appears on screen

#### Scenario: Tray is the only source
- **WHEN** the user has not clicked `Spawn Sugar Zone` in the tray
- **THEN** the scene contains zero sugar zones
