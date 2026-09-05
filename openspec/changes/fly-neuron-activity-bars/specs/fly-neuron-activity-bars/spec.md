# fly-neuron-activity-bars

## Purpose

Adds a fourth live window that consumes the existing `state` IPC
stream and renders, for each behavioural state (`walk`, `fly`,
`idle`, `groom`, `sleep`, `eat`, `court`), two horizontal bars:
the share of the session's time spent in that state and the share
of the most recent rolling window's time spent in that state. The
two bars make it possible to see which behaviour dominated the
session vs. which behaviour is dominant right now.

## ADDED Requirements

### Requirement: A new Brain Stats window

The system SHALL provide a fourth `BrowserWindow` titled
`Brain Stats — population activity` that shows a bar chart of
per-behaviour activity. The window SHALL be hidden by default and
opened by a tray item `Brain → Show Stats`.

#### Scenario: Tray opens the window
- **WHEN** the user clicks `Brain → Show Stats` in the tray
- **THEN** the `Brain Stats` window appears in the bottom-right of
  the primary display, stacked above the brain window

#### Scenario: Closing the window hides it
- **WHEN** the user clicks the OS title-bar close on the
  `Brain Stats` window
- **THEN** the window is hidden (the app keeps running)

### Requirement: One row per behaviour, with two global-share bars

For each of the seven behavioural states that appear in the
`state` IPC payload (`walk`, `fly`, `idle`, `groom`, `sleep`,
`eat`, `court`), the system SHALL render exactly one row in the
window. The row SHALL show:

- the behaviour name (e.g. `walk`) as the row label,
- a `lifetime share` bar — the fraction of total session time spent
  in that behaviour, expressed as a percentage of the sum of all
  behaviours' lifetime aggregates,
- a `recent share` bar (in a different colour) — the fraction of
  total recent-window time spent in that behaviour, expressed as a
  percentage of the sum of all behaviours' recent aggregates,
- the raw `recent count` (the number of state events of that
  behaviour observed within the rolling recent window) as a
  numeric.

A single column header row SHALL appear once at the top of the
chart with the labels `behaviour`, `lifetime share`,
`recent share`, `recent count`. Per-row `lifetime` / `recent`
captions SHALL NOT be drawn (they would duplicate the column
header and add no information).

#### Scenario: Default list renders seven rows
- **WHEN** the window opens with the default config and at least
  one state event has arrived
- **THEN** the window shows seven rows, one per behaviour, and a
  column header row above them

#### Scenario: Unknown behaviour renders disabled
- **WHEN** the state stream emits a tag that the system does not
  recognise
- **THEN** that row is still rendered (so the user can see
  unfamiliar behaviour appear) but the bars are drawn at width 0
  and the row is greyed out; the renderer does not crash

#### Scenario: Row with no events renders empty bars
- **WHEN** a behaviour has zero events in both the lifetime and
  the recent windows
- **THEN** both bars for that row have width 0% and the count
  reads `0`

### Requirement: Bars are scaled globally, not per row

The two bar widths in each column SHALL be normalised to the sum
of that column across all rows. That is, for the `lifetime share`
column the widths sum to 100% across all behaviours; likewise for
the `recent share` column. This means a behaviour with 0 events
has bars of width 0, and the dominant behaviour fills its share
of the row, not the full row.

#### Scenario: One behaviour dominates the session
- **WHEN** the session is 80% `walk` and 20% `idle` in the
  `sum_duration` metric
- **THEN** the `walk` row's `lifetime share` bar is 80% wide and
  the `idle` row's `lifetime share` bar is 20% wide

#### Scenario: Behaviour trending up
- **WHEN** the recent window is 100% `walk` but the session is
  50% `walk` overall
- **THEN** the `walk` row's `recent share` bar is wider than its
  `lifetime share` bar (recent 100% vs lifetime 50%), even though
  both are scaled globally within their own column

### Requirement: Aggregator exposes per-tag totals

The `BrainStats` class SHALL expose `aggregatesFor(name, now)` for
the existing per-neuron query and a new `totalsByTag(now)` helper
that returns the per-behaviour aggregate summed across all
neurons mapped to that behaviour (the existing `TAG_FOR_NEURON`
mapping may collapse multiple neurons to one behaviour, e.g.
`flight` aggregates `LC4` + `LPLC2` + `GF` + `escW` together).

#### Scenario: Multiple neurons collapsed into one behaviour
- **WHEN** the test pushes events tagged `flight` for both
  `GF` and `LC4` neurons
- **THEN** `totalsByTag('flight')` returns the combined sum
  across both neurons

### Requirement: Configurable behaviour list, metric, and window

The system SHALL read `~/.config/desktop-fly/brain-stats.json` on
window open. The JSON SHALL have the shape:

```json
{ "behaviours": [string], "metric": "count" | "sum_duration",
  "window_seconds": number }
```

The `behaviours` key replaces the older `neurons` key (which is
still accepted as an alias for backwards compatibility). Defaults:
`behaviours` = the seven behavioural states listed in the
Requirement "One row per behaviour" above, `metric` =
`sum_duration`, `window_seconds` = 60.

#### Scenario: Missing config uses defaults
- **WHEN** the config file does not exist
- **THEN** the window renders seven default rows with
  `sum_duration` and a 60 s window

#### Scenario: Config change hot-reloads
- **WHEN** the user edits the config file while the window is open
- **THEN** the next render SHALL use the new values
  (no app restart required, and no crash on a malformed file)

#### Scenario: Legacy `neurons` key still works
- **WHEN** the config file has a `neurons` key (older format)
- **THEN** the renderer treats it as an alias for `behaviours`
  (one row per neuron name) so existing user configs keep working
