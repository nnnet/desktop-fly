# Design — fly-neuron-activity-bars

## Context

The app already has two `BrowserWindow`s that consume the same
state stream: `brain` (340×300, point cloud + state line) and
`brain-trainer` (540×420, lessons + memory tab). A third small
window that shows historical per-population activity rounds out
the "what is the brain doing?" story without changing the overlay
or the sim.

The state payload (`{ tag, rates }` at 10 Hz, throttled by the
overlay) is exactly the signal we need. The aggregation is purely
client-side: a rolling-window buffer keyed by wall-clock time.

## Goals / Non-Goals

**Goals**

- Pure add: no changes to `overlay.js`, `flymodel.js`, or
  `windows/src/`.
- All aggregation logic is testable on bare Node (no Electron).
- Config is a small JSON file in `app.getPath('userData')` —
  follows the same pattern as `food-memories.json` and the
  per-lesson JSONs.
- The aggregator lives in the **renderer** process. The main
  process is read-only: it just hands the renderer the parsed
  config via `brain-stats:read` and the live `state` IPC stream.
  Closing and reopening the window resets the aggregates — a
  simple, deliberately-bounded lifetime, the same as
  `brain-trainer`'s `Memory` tab.
- Hot-reload of the config: the renderer polls the config every
  second; editing the file while the window is open re-renders
  without a restart.
- Reuse the bar-chart CSS already shipped in `brain-trainer.html`
  so the three "Fly Wire" windows look like siblings.

**Non-Goals**

- No persistence of aggregated values across app restarts. The
  lifetime aggregate resets every time the stats window is opened.
- No per-row drill-down (a click handler would imply a future
  feature like "stimulate this population"); the spec leaves the
  door open but does not implement it.
- No editing UI inside the window — config is a JSON file the
  user edits externally.

## File layout

```
windows/renderer/
  brain-stats.html      # new — bar-chart window body
  brain-stats.js        # new — aggregation + render
linux/main.js           # +createStatsWindow, +ipc handlers
windows/main.js         # +createStatsWindow, +ipc handlers
linux/test/brainstats.test.js  # new — node test for aggregator
```

The renderer is a single `BrowserWindow` per platform. The
config-file watcher lives in the **main process** so that closing
and reopening the window does not reset the aggregated values
(the watcher keeps accumulating between window open events).

`linux/test/brainstats.test.js` is a symlink to
`../../windows/test/brainstats.test.js`, matching the existing
symlink pattern (`simtest.js`, `behaviortest.js`,
`attracttest.js`).

## Config schema

File: `~/.config/desktop-fly/brain-stats.json` (Windows: `%APPDATA%/desktop-fly/`).

```json
{
  "behaviours": ["walk", "fly", "idle", "groom", "sleep", "eat", "court"],
  "metric": "sum_duration",
  "window_seconds": 60
}
```

- `behaviours` (string[]): the behavioural states that appear in
  the `state.tag` field. Defaults to the seven states listed
  above. Unknown tags still render (so the user can see new
  behaviour appear) but with width-0 bars. The legacy `neurons`
  key is accepted as an alias so existing user configs keep
  working — the renderer treats it as a list of neuron names and
  shows one row per entry.
- `metric`: `"count"` or `"sum_duration"`. Default `"sum_duration"`.
- `window_seconds` (number, ≥ 0): the rolling-window size in
  seconds. Default 60. Set to 0 to disable the recent share (the
  `lifetime share` bar still works).

If the file is missing or malformed, the window falls back to the
defaults above and the user is informed in the UI status line.

## Aggregation algorithm

`brain-stats.js` keeps a single in-memory buffer of `{tag, t}`
where `t` is the wall-clock time the payload arrived. The
**lifetime** column uses the full buffer; the **recent** column
uses only entries within `now - window_seconds * 1000`.

For each behaviour in the configured list:

- `count` — number of state events whose `tag` matches the
  behaviour.
- `sum_duration` — sum of `t[i+1] - t[i]` for each pair of
  consecutive events whose `tag` matches; the last event's
  contribution is `now - last_t` (truncated at session start).

The render-time normalisation is **per column, not per row**:

- `lifetime_share[b] = lifetime[b] / sum_b(lifetime[b]) * 100`
- `recent_share[b]   = recent[b]   / sum_b(recent[b])   * 100`

This way the dominant behaviour fills its share of the bar, not
the full row, and the user can compare across rows at a glance.

A column header row (drawn once) shows the labels `behaviour`,
`lifetime share`, `recent share`, `recent count`. Per-row
captions are not drawn — they would duplicate the column header.

The aggregator also exposes a per-neuron `aggregatesFor(name)`
for tests and for the legacy per-neuron rendering path, but the
default UI consumes `totalsByTag` to build the behaviour-axis
view.

## Rollout

The window is opt-in: a new tray item `Stats → Show Brain Stats`
opens it. Closing it via the OS title bar hides it (consistent
with `brain` and `brain-trainer`). No existing behaviour changes.
