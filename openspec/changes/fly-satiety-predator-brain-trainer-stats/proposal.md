## Why

The fly already seeks sugar and mates, supports Hebbian plasticity, and runs
optogenetic lessons — but the user cannot *see* the brain learning, the fly's
hunger never satisfies (sugar is a slot-machine, not a real drive), and the
tray menu offers no way to introduce a third behavioural axis (fear of a
predator). This change closes the loop: eating must change future eating,
training must be visible, and the user must be able to challenge the fly
beyond the cursor/sugar/mate trio.

## What Changes

- **Satiety**: every fly carries a `sugarLevel` ∈ [0, 1] that decays
  toward 0 with τ ≈ 60 s. Eating a sugar zone adds 0.4 (clamped). When
  `sugarLevel < 0.2` the per-fly `foodAttract` is multiplied by 0; the
  fly ignores sugar until it gets hungry again. Sugar does **not**
  respawn automatically — the user is the only source of new zones.
- **Predator zone**: third zone kind alongside `sugar` and `mate`. A
  predator zone applies negative `foodAttract` (heading-bias *away*),
  boosts `speedMul` for the duration of close approach, and tags
  nearby fly spikes with an `escapeTeach` flag so Hebbian LTD on
  `sens→escape` edges fires more strongly than usual. Tray → Game →
  `Spawn Predator` adds a predator; `Clear Zones` removes it.
- **Learning stats panel**: the brain-trainer window gains a
  `Memory` tab that reads `~/.config/desktop-fly/food-memories.json`
  on demand and renders a horizontal bar chart of the top 20 edges
  by absolute `dW`. Bar colour: green (LTP gain) / red (LTD loss).
  Updates whenever a save fires (≤ 30 s cadence) without reload.
- **Brain state line**: the brain window gains a one-line readout at
  the top: `walk | flight | groom | idle | sleep | eat | court` plus
  eight numeric rates for the populations that drive behaviour
  (LC4, LPLC2, GF, DNa01, DNa02, DNp09, DNg11, MDN, escW — the same
  list as `BrainSignals` in `windows/src/signals.js`). Each number
  is normalised to [0, 1] with 3-decimal precision. The state is
  derived from the dominant signal (per the same thresholds
  `brainBehavior` uses for state transitions); the numbers are
  re-derived from the live `BrainSignals` the renderer holds.

## Capabilities

### New Capabilities

- `fly-satiety`: per-fly hunger state that gates food attraction.
  Covers decay rate, eat reward, threshold, and the behavioural
  consequence (food zones become invisible when satiated).
- `fly-predator-zones`: third zone type with negative attraction,
  speed boost, and escape-association teach signal for plasticity.
- `brain-trainer-memory-view`: a renderer-only panel that reads
  Hebbian memory snapshots and renders a top-20 bar chart.
- `brain-state-readout`: a single-line state + numeric rates
  readout in the brain window driven by live `BrainSignals`.

### Modified Capabilities

- (none — the sim contract does not change; new behaviour lives in
  `flymodel.js` + `attract.js` + renderer)

## Impact

- `windows/src/flymodel.js` — add `sugarLevel` field, decay step,
  teach-signal hook on predator proximity.
- `windows/src/attract.js` — accept `kind: 'predator'` zones; apply
  negative heading-bias and `speedMul`; expose `foodAttract` gain
  so the renderer can zero it for satiated flies.
- `windows/renderer/overlay.js` — gate `foodAttract` on
  `fly.sugarLevel`; emit `escapeTeach` events on predator
  proximity; broadcast `state` + `signals` to the brain window
  every animation frame (already on IPC).
- `windows/renderer/brain.html` + `brain.js` — render state line
  + numeric rates panel at the top of the window.
- `windows/renderer/brain-trainer.html` + `brain-trainer.js` —
  add a `Memory` tab with the bar chart.
- `linux/main.js` + `windows/main.js` — add `Spawn Predator` tray
  item; `Clear Zones` already exists and now also clears
  predators. The IPC surface and renderer are shared via the
  symlinked `preload.mjs`, so a new command name is the only main
  change.
- `windows/test/attracttest.js` — add cases for predator
  (negative attract, speed boost, no reach consume).
- `windows/test/behaviortest.js` — add cases for satiety
  (5 eats → `sugarLevel > 0.9` → `foodAttract` near 0; decay over
  60 s brings it back) and predator (close approach → flight).
- `windows/test/simtest.js` — extend plasticity probe with the
  predator teach signal: `sens→escape` LTD should be measurable
  after predator exposure.
- `data/lessons/` — no new lessons; existing trainer is
  sufficient. `lessons.json` is unchanged.

No new dependencies. The renderer already imports `three`; the
new panels are pure DOM/SVG. Tests stay on bare Node.
