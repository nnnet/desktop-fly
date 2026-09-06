## Purpose

Adds a third zone type alongside sugar and mate. A predator zone
applies a negative heading bias, a temporary speed boost, and an
escape-association teach signal that strengthens Hebbian LTD on
`sens→escape` edges — giving the user a way to challenge the fly
beyond the existing attraction axes.

## ADDED Requirements

### Requirement: Predator zone kind

The system SHALL accept zones with `kind: 'predator'`. Predator zones
MUST be drawn as a red octagon (renderer concern) and SHALL coexist
with sugar and mate zones in the same scene.

#### Scenario: Spawning a predator zone
- **WHEN** the user clicks tray → Game → `Spawn Predator`
- **THEN** a new zone with `kind: 'predator'` appears on the active
  display

#### Scenario: Clear Zones removes predators
- **WHEN** the user clicks tray → Game → `Clear Zones`
- **THEN** every predator zone in the scene is removed

### Requirement: Predator applies negative heading bias

The system SHALL add a negative `foodAttract`-style bias to the fly's
heading whenever a predator is in line of sight, with the sign chosen
so the fly's heading rotates away from the predator. The bias
magnitude SHALL follow the same `falloff(d, range)` shape as sugar
attraction, with `range = 900` scene units.

#### Scenario: Predator to the right pushes the fly left
- **WHEN** a fly with `heading = 0` has a predator at bearing +π/2
- **THEN** the effective heading change per tick is negative
  (rotates the fly left, away from the predator)

#### Scenario: Predator behind the fly is ignored
- **WHEN** a fly has a predator at bearing > range or behind the
  visual cone
- **THEN** the heading bias is 0

### Requirement: Predator proximity boosts flight speed

The system SHALL multiply the fly's walking/flight speed by a factor
≥ 1.0 while the fly is within `range = 900` of any predator. The
multiplier SHALL be `1 + 0.5 * falloff(d, range)`, capped at 1.5.

#### Scenario: Close predator doubles speed
- **WHEN** a fly is within 100 units of a predator
- **THEN** the fly's speed multiplier is approximately 1.45

#### Scenario: Distant predator has no speed effect
- **WHEN** a fly is exactly at the predator's range boundary
- **THEN** the fly's speed multiplier is 1.0

### Requirement: Predator exposure teaches escape

The system SHALL emit an `escapeTeach` signal with magnitude
proportional to predator proximity. The Hebbian plasticity loop
SHALL apply this signal as additional LTD on `sens→escape` edges
for the duration of the exposure.

#### Scenario: Predator exposure decreases sens→escape weight
- **WHEN** a fly spends 10 s within 200 units of a predator with
  plasticity on
- **THEN** the `sens→escape` edge weight is measurably lower than
  before exposure (per `simtest` plasticity probe)

#### Scenario: No exposure leaves sens→escape unchanged
- **WHEN** a fly never enters a predator's range with plasticity on
- **THEN** `sens→escape` weight is unchanged from baseline

### Requirement: Predator zones do not consume on contact

The system SHALL NOT mark a predator zone as `foodReached` (predator
zones have no `foodReached` semantics) and SHALL NOT remove the
predator zone on contact.

#### Scenario: Fly can re-enter a predator zone
- **WHEN** a fly passes through a predator zone and leaves
- **THEN** the predator zone is still present
