## Purpose

Gives the user a single-line status of what the fly is doing *and*
the underlying neural evidence, in the brain window. The state is
derived from the dominant behavioural signal; the numeric rates
expose the populations that drove the decision so the link between
neural activity and behaviour is visible.

## ADDED Requirements

### Requirement: One-line state readout

The system SHALL render, at the top of the brain window, a single
line of text with the fly's current behavioural state. The state
SHALL be one of: `walk`, `flight`, `groom`, `idle`, `sleep`, `eat`,
`court`. The derivation SHALL use the same priority order as
`brainBehavior` in `windows/src/flymodel.js`.

#### Scenario: Fly walking shows "walk"
- **WHEN** the fly's `state` is `walking` and no other transition
  is in progress
- **THEN** the readout shows `walk`

#### Scenario: Fly escaping shows "flight"
- **WHEN** `state` is `flying` with `stateAge ≥ 0.4 s` after a
  loom trigger
- **THEN** the readout shows `flight`

#### Scenario: Fly in idle shows "idle"
- **WHEN** `state` is `idle` and `idleMs` has elapsed without
  input
- **THEN** the readout shows `idle`

### Requirement: Numeric rates for nine populations

The system SHALL render, on the same line as the state (or on the
line immediately below), nine numeric rates corresponding to:
LC4, LPLC2, GF, DNa01, DNa02, DNp09, DNg11, MDN, escW. Each
number SHALL be normalised to [0, 1] (rate / typical_max) and
SHALL be formatted to 3 decimal places.

#### Scenario: Rate formatting
- **WHEN** LC4's smoothed firing rate is 179.5 Hz and its typical
  max is 250 Hz
- **THEN** the readout shows `0.718`

#### Scenario: Zero rate
- **WHEN** GF is silent (no spikes) over the last 4 s
- **THEN** the readout shows `0.000`

#### Scenario: All nine populations visible
- **WHEN** the brain window is open
- **THEN** the readout shows labels and values for all nine
  populations in the order LC4, LPLC2, GF, DNa01, DNa02, DNp09,
  DNg11, MDN, escW

### Requirement: Update cadence

The system SHALL update the readout at most 10 times per second
(≤ 10 Hz) to avoid visual flicker. The state and rates SHALL be
derived from the live `BrainSignals` the renderer already holds.

#### Scenario: Readout tracks rapid state change
- **WHEN** the fly transitions from `walk` to `flight`
- **THEN** the readout shows `flight` within 100 ms of the
  transition

#### Scenario: Readout does not stutter
- **WHEN** the renderer is running at 60 fps
- **THEN** the readout does not change more than 10 times per
  second
