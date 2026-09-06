# Design — fly satiety, predator zones, brain-trainer stats, brain state line

## Context

The current scene loop already maintains per-fly state in
`windows/src/flymodel.js` and a per-frame attract computation in
`windows/src/attract.js`. Sugar and mate zones are uniformly
represented as `{ kind, x, y, r }` and consumed/attracted in the
renderer's animation step (`overlay.js`). Hebbian plasticity is a
snapshotted weight matrix in
`~/.config/desktop-fly/food-memories.json`. The brain window is a
separate `BrowserWindow` receiving `spikes` IPC; the brain-trainer
window is a third `BrowserWindow` with a small lessons UI.

This change adds four orthogonal concerns that all share the
existing IPC plumbing: (1) a per-fly hunger scalar, (2) a new zone
kind, (3) a UI panel that reads the on-disk memory, (4) a
single-line readout in the brain window. The sim, flymodel, and
attract modules are shared across platforms via git-tracked
symlinks from `linux/src/`, so any change there propagates to
both `pnpm test` runs.

## Goals / Non-Goals

**Goals**

- Each new piece of behaviour is testable on bare Node
  (no Electron, no GPU) — they live in `sim.js`/`flymodel.js`/
  `attract.js` modules and are reached by the existing
  `simtest`/`behaviortest`/`attracttest` runners.
- Renderer-side panels are pure DOM/SVG; no new dependencies.
- IPC surface change is additive: one new cmd name
  (`spawnPredator`) and the existing `spikes` channel extended
  with a `state` field for the brain window.
- The fly does **not** spawn sugar on its own (per user direction).

**Non-Goals**

- New sensory modalities (touch, mic, etc.).
- Anything that changes the LIF network or the connectome
  (`data/circuit.json`).
- A new build step (no esbuild/vite); renderer keeps loading the
  three.js scene as a flat ES module.
- Cross-platform overlay-API changes; Linux per-monitor and
  Windows spanning-virtual-desktop models stay as they are.

## Decisions

### D1. Sugar level is a per-fly scalar, not a global

**Decision:** Add `sugarLevel` to the `Fly` struct in
`windows/src/flymodel.js`. The decay step lives in the same
`step()` function that handles other per-tick bookkeeping.

**Why:** Hunger is intrinsic to the fly, not the world. A global
sugarLevel would mean a satiated fly on a separate display still
ignores sugar it has never seen, which is wrong biologically
and wrong for the user-visible demo (each overlay has its own
fly, and they should diverge).

**Alternatives:** Per-zone `sugarRemaining` was considered —
rejected because (a) zones are not per-fly, (b) the user can't
tell which fly ate which.

### D2. Satiety threshold is a single number

**Decision:** Threshold is `0.2`, exposed as a const at the top
of `flymodel.js` (`SUGAR_THRESHOLD`).

**Why:** Easy to tune; a single source of truth the test can
reference.

**Alternatives:** Dynamic threshold (e.g. scaled by arena size)
was considered — rejected as YAGNI.

### D3. Predator uses the same `kind` discriminator as sugar/mate

**Decision:** Zone schema is extended in place to accept
`kind: 'predator'`. `attract.foodAndMateAttract` is renamed
to `attract.zoneAttract` and gains a `predatorAttract` return
field plus a `speedMul` field.

**Why:** Symmetric with the existing pattern; one iteration over
zones; renderer just adds the new field to the wire message.

**Alternatives:** A separate `predatorAttract(fly, predators)`
function was considered — rejected because (a) callers would
have to call two functions per tick, (b) net bias math gets
harder to reason about.

### D4. Predator speed boost lives in `flymodel.step`, not `attract`

**Decision:** The renderer reads `speedMul` from the attract
result and applies it to the fly's `state.walkSpeed` /
`state.flightSpeed` for the tick. The fly model itself does not
absorb the multiplier.

**Why:** Keeps the model contract clean: `flymodel.Fly` doesn't
need to know about zones. The renderer is the only place that
sees both.

### D5. Memory panel reads the file directly, no IPC

**Decision:** The brain-trainer window uses the existing
`fs` access pattern (already exposed via `preload.mjs` IPC) to
read `food-memories.json` on demand and on a 30 s poll.

**Why:** The file is written by the main process at known paths;
adding a new IPC channel for "give me the memory snapshot" is
redundant with what the renderer can already ask for.

**Alternatives:** Push snapshots from main on every save —
rejected because (a) it ties the panel to write events it doesn't
own, (b) the file is small (<10 KB), polling is cheap.

### D6. Brain state line is derived in the renderer, not pushed

**Decision:** The brain window already runs the same
`sim.js` reference (via `getBrainData` + `LIFSim` step). The
readout reads the latest `BrainSignals` and the latest `state`
field from the renderer's per-frame message and computes the
string + numbers at ≤ 10 Hz.

**Why:** The brain window does not own the sim — the overlay
does. Pushing the formatted string would couple the brain
window to the overlay's state model. Reading the same signals
the brain window already gets via `spikes` is straightforward.

**Alternatives:** Send a `state` event alongside `spikes` —
chosen instead. The brain window receives `{ spikes, state,
signals }` and renders the line itself.

### D7. Bar chart is SVG, not canvas

**Decision:** The Memory tab renders 20 bars as inline `<rect>`
SVG elements. Hover shows the exact `dW` to 4 decimals.

**Why:** SVG is declarative, no resize handlers, no
device-pixel-ratio pain, no font metrics. 20 bars × 30 px tall =
600 px panel — well within reasonable memory.

**Alternatives:** Canvas 2D — rejected (overkill for 20
rectangles). WebGL — rejected (no extra GPU work for static
rectangles).

## Risks / Trade-offs

- **Risk:** Satiety threshold could starve a satiated fly into
  no observable behaviour if no new sugar is spawned.
  → **Mitigation:** the existing `walk-drive` baseline remains
  active; the fly still grooms, flees, and rests. The spec
  already states that sugar is user-spawned only.

- **Risk:** Predator's `sens→escape` LTD could erase the
  escape reflex entirely after long exposure.
  → **Mitigation:** the spec scopes the teach signal to the
  duration of exposure; the existing plasticity homeostatic
  decay (α = 1e-7) bounds the drift. Add a simtest probe that
  asserts `sens→escape` weight stays above 50% of baseline
  after 60 s of continuous predator exposure.

- **Risk:** Memory panel reading a stale snapshot during a save
  could yield a partial-JSON parse error.
  → **Mitigation:** read+parse is wrapped in try/catch; the
  panel keeps the last successful render and shows a small
  "refreshing…" hint while the next poll runs.

- **Risk:** Brain state line at 10 Hz could lag fast state
  transitions (escape, land) by up to 100 ms.
  → **Mitigation:** the spec already accepts 100 ms latency
  (existing `stateAge ≥ 0.4 s` dwell guard means the state
  itself is stable for 400 ms; the readout update is well
  within that).

- **Trade-off:** Predator adds one more tray item; tray is
  already long. → accepted; the trainer submenu is a
  precedent for grouping.

## Migration Plan

- No data migration. `food-memories.json` is read with a
  missing-file fallback (already handled by the existing
  loader).
- No new dependencies. `node_modules` content is unchanged.
- Rollback: each capability's change is a small, isolated
  commit on `research/brain-trainer`; reverting any one of
  them is `git revert <sha>`. Tests gate the revert.

## Open Questions

- Predator visual style: solid red octagon vs red ring with
  pulse? The spec only says "red octagon"; the renderer can
  pick. (Defer to implementation.)
- Bar chart orientation: top-to-bottom vs left-to-right?
  (Defer; the spec says horizontal bar — left-to-right is
  conventional for ranked lists.)
