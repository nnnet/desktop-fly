## Why

The brain window already shows a single-line numeric readout of the
nine command populations (LC4, LPLC2, GF, DNa01, DNa02, DNp09,
DNg11, MDN, escW) and a current behavioural tag (walk/flight/
groom/idle/sleep/eat/court). But the user cannot answer two
practical questions from that line alone:

1. *How much of each behaviour happened in the last minute versus
   the whole session?* — the readout is instantaneous, it has no
   memory. A brain that "looks calm right now" may have been
   frantically escaping 10 s ago.
2. *How is each population contributing, not just right now?* — the
   readout conflates activity level with the current state. A user
   who wants to study a single population (e.g. DNp09 for walking
   or escW for wing-beat effort) has no per-population historical
   view.

The brain-trainer window's `Memory` tab is the closest existing
analogue: it reads `food-memories.json` and renders horizontal
bars. We want a sibling feature: a third window that consumes the
**live state stream** (not a saved file) and renders the same kind
of bars in real time, split by a configurable rolling window.

## What Changes

- **New `Brain Stats` window**: a 4th Electron `BrowserWindow`,
  bottom-right of the primary display stacked above the brain
  window, dark theme matching the brain / brain-trainer windows.
  Lives in `windows/renderer/brain-stats.html` and `brain-stats.js`.
  Loads `~/.config/desktop-fly/brain-stats.json` at startup to
  learn which neurons to display, the metric mode, and the rolling
  window size. The renderer polls the config every second and
  re-renders on change.
- **Per-population bar chart**: one row per configured neuron. Each
  row has a label and **two horizontal bars side-by-side**:
  - **Lifetime bar** — the metric value across the whole session.
  - **Recent bar** — the metric value over the last `W` seconds
    (configurable, default 60).
  The user can therefore compare "average lifetime behaviour" vs
  "behaviour in the last minute" at a glance.
- **Configurable metric mode**: `count` (number of state events
  in the window) or `sum_duration` (sum of the time spent in that
  state, in seconds). Default `sum_duration`. Same mode is applied
  to both bars.
- **Configurable neuron list**: default is the 9 command populations
  (LC4, LPLC2, GF, DNa01, DNa02, DNp09, DNg11, MDN, escW). The
  user can replace this list in the config file. Unknown neuron
  names render a disabled row with `n/a`.
- **State stream is already in place**: the overlay renderer
  publishes `{ tag, rates }` to the `state` IPC channel at 10 Hz.
  The new window subscribes to the same channel via `flyAPI.onState`
  and aggregates locally — no overlay changes, no sim changes.

## Capabilities

### New

- `fly-neuron-activity-bars`: the new window, the config file, the
  per-window aggregation, the renderer. Spec:
  `openspec/changes/fly-neuron-activity-bars/specs/fly-neuron-activity-bars/spec.md`.

## Out of Scope

- Persisting aggregated values across app restarts (the lifetime
  total resets when the window is reopened).
- Click-to-stimulate from the bar chart.
- Negative-window modes (the rolling window is always positive
  seconds; user can set it to 0 to disable the recent bar).
- Changing the metric mode per bar (both bars use the same mode).
