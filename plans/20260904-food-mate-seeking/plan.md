# Food-seeking & mate-seeking for DesktopFly

## Goal

Turn DesktopFly from a passive "scared by cursor" desktop pet into a goal-driven agent that:
1. **Hunts sugar** — small floating yellow zones on the desktop; the fly is
   attracted via tarsal-contact gradient and rewarded (proboscis-extension
   surrogate) on reach.
2. **Seeks a mate** — a soft pheromone glow emitted by a slowly-moving
   partner sprite; bilateral gradient steers the fly, wing extension fires
   on close approach.
3. **Learns** — repeated reward deliveries drive Hebbian LTP (already wired
   in `sim.enablePlasticity`); the resulting weight matrix is snapshotted
   to `app.getPath('userData')/food-memories.json` and reloaded on next
   start, so the fly starts each session a little better at finding food.

This is Phase 3 of the research plan
(`plans/reports/research-260903-2254-flybrain-models-and-training.md`),
with Phase 4 (brain monitor) and Phase 5 (full v783) as follow-up.

## Outcome, constraints, non-goals, acceptance

- **Outcome.** User opens the tray → "Game" submenu → "Spawn Sugar Zone" → a
  yellow circle appears on the desktop; the fly orients toward it, walks
  there, and on contact a wing-extend + groom-spike fires, the zone
  disappears, and the brain's `sim.fwd → sim.ascend` edges grow via
  Hebbian LTP. Spawn 3 zones, spawn a partner, watch the fly hunt.
- **Constraints.**
  - All sim-touching code stays in `sim.js` (no forking).
  - Symlink sharing: changes in `windows/src/sim.js` apply to Linux
    automatically; both `npm test` runs must stay green.
  - Per-monitor overlay (Linux) must work — the new sprite code is per-window.
  - Headed and headless (`--snapshot`) builds both work.
  - Don't break the stochastic landing smoothness test (baseline ~16 % flaky).
- **Non-goals.**
  - Full v783 connectome (Phase 5).
  - Brain-monitor rate plots (Phase 4).
  - Multi-fly courtship (no second brain).
  - 3D food mesh / GPU instancing — flat `THREE.Mesh(CircleGeometry)` is fine.
- **Acceptance.**
  - `npm run simtest` PASS with two new phases (food-reward, mate-reward).
  - `npm run behaviortest` PASS or only the known baseline-flaky landing fails.
  - Manual: tray → Game → Spawn Sugar; fly reaches it within 10 s; zone
    disappears; spawn 2nd zone in opposite corner; fly reaches it in <8 s
    after a few training sessions.
  - Manual: `~/.config/desktop-fly/food-memories.json` (Linux) or
    `~/Library/Application Support/desktop-fly/food-memories.json` (mac)
    exists after first reach and is reloaded on next launch.

## Borrow-list from neighbours

| Source | Pattern | What we copy |
|---|---|---|
| **nawrotlab/larvaworld** | 2D food/odor sources in arena | sugar zone = `{x, y, r}` array; pheromone = soft mesh around partner |
| **erojasoficial-byte/fly-brain** | Tarsal contact → GRN → SEZ → proboscis extension; PN → KC → MBON → DN for chemotaxis | `sim.stimulate(sim.sens, k * (1 - d/r))` gradient; on reach `sim.stimulate(sim.fwd, 0.5)` (forward walk) + `sim.groom` (proboscis surrogate) |
| **BAAIWorm (Jessie940611)** | weathervane (gradual curve toward peak) + pirouette (sharp turn on/off gradient) | `s.attract = gradient × (1 - d/r)²`; on overshoot → sharp turn (existing `rnd(-1,1) * WANDER_JITTER` in `flymodel.js:664`) |
| **Cell 2026 male CNS connectome** | sex-specific 4.8 % dimorphic neurons | **out of scope** — Phase 5 only |

## Architecture

```
┌────────────┐       ipc 'cmd'           ┌──────────────────┐
│  Tray      │ ────────────────────────► │ overlay.js (3D)  │
│  Game menu │ { spawnSugar, spawnMate,  │  scene.add(mesh) │
│  Spawn X   │   clearZones,             │  sim.stimulate() │
│  Clear     │   foodReached }           │  onReach(reward) │
└────────────┘                           └────────┬─────────┘
                                                   │  weights
                                          ┌────────▼─────────┐
                                          │ sim.js (LIF)     │
                                          │  plasticity on   │
                                          │  exportWeights() │
                                          └────────┬─────────┘
                                                   │
                                          ┌────────▼─────────┐
                                          │ userData json    │
                                          │  /food-memories  │
                                          └──────────────────┘
```

- **Renderer-owned state**: `zones: [{x, y, r, kind, mesh, bornMs}]` —
  the renderer is the single source of truth for what's on screen;
  the sim doesn't track zones, it only consumes their effect on `sim.sens`.
- **Sim-owned state**: weight matrix + `sim.fwd`/`groom`/`escw` rates.
  Hebbian LTP grows the same edges that are responsible for the
  fly's success at finding food; no separate "memory" array.
- **IPC**: minimal — only spawn/clear commands go main→renderer; the
  renderer is self-contained for reach detection (it already has
  `fly.pos` and `bounds`).

## Critical files to modify

| File | Change | Why |
|---|---|---|
| `windows/src/sim.js` | add `silence()` zone variants? No. Add: nothing — reuse `stimulate()`, `enablePlasticity()`, `exportWeights()`, `importWeights()` (all already there). | Sim layer is feature-complete from Phase 1+2. |
| `windows/src/signals.js` | add `s.foodAttract` (food + mate combined scalar) and `s.mateAttract` (separate, for wing-extend on reach). | New heading-bias source, parallel to `turnBias`. |
| `windows/src/flymodel.js` | in `updateWalk` (line 629) add `this.heading += s.foodAttract * dt;` and mate steer term. Add `onFoodReached` / `onMateReached` callbacks. | Inject attraction into existing heading. |
| `windows/renderer/overlay.js` | new `zones[]` array, `spawnZone()`, `drawZones()` (per-frame `mesh.position.set`), `checkReaches()` (distance < r → reward + remove + IPC notify). New `api.onCommand` cases. | Renderer is owner of visual state. |
| `linux/main.js` | new tray submenu "Game" → "Spawn Sugar", "Spawn Mate", "Clear Zones". Forward as cmd. | Same pattern as existing Trainer submenu. |
| `windows/main.js` | same tray submenu, same cmd. | Same. |
| `windows/preload.mjs` | no change (cmd channel already exposed). | — |
| `windows/test/simtest.js` | add Phase 9 (food reach → sim.fwd rate spikes + sim.groom rate spikes), Phase 10 (mate reach → sim.escw rate spikes). | Ground-truth. |
| `windows/test/behaviortest.js` | add "fly reaches spawned sugar zone" test: spawn zone 200 pt from fly; assert reach within N seconds + sim.fwd rate > 0.3 during. | E2E behavior. |
| `docs/ubuntu.md`, `README.md` | short "Game mode" section. | Discovery. |

## Detailed design

### Sugar zone

- **Spawn**: tray click → main → cmd `spawnSugar {x, y}` → renderer
  picks (x, y) clamped to active display bounds, appends to `zones[]`.
- **Visual**: `THREE.Mesh(CircleGeometry(zone.r), MeshBasicMaterial({color: 0xFFD23F, transparent: true, opacity: 0.65}))`. Soft pulse via `mesh.scale.setScalar(1 + 0.1*sin(t))`.
- **Gradient stimulus (per sim step)**:
  ```js
  for (const z of zones) if (z.kind === 'sugar') {
    const d = distance(fly.pos, z);
    if (d < z.r * 3) sim.sens_stim += 0.05 * (1 - d / (z.r * 3));
  }
  ```
  Implemented as a new sim input `sim.sensStim` similar to `sim.airPuff`.
- **Heading bias**:
  ```js
  s.foodAttract = angleDiff(fly.heading, atan2(z.y - fly.y, z.x - fly.x)) * (1 - d / 800);
  ```
  Capped at 1 rad/s, sign-corrected.
- **Reach** (d < z.r):
  - `sim.stimulate(sim.fwd, 0.5, 300)` — forward walk pump.
  - `sim.stimulate(sim.groom, 0.3, 200)` — proboscis surrogate.
  - Animation: 600 ms wing extend (`wingRaise = 1`) + body droop
    (`scale *= 0.92` then spring back). Reuse existing wing-beat code.
  - Remove zone, fire `foodReached` IPC.
  - If `sim.plasticEnabled` (Phase 2 toggle), the natural LTP
    already grows `sens → fwd` and `sens → groom` edges from the
    co-activation this step caused.

### Mate (pheromone)

- **Spawn**: tray → cmd `spawnMate` → renderer creates one partner
  sprite that lerps to a new random point every 6-12 s. The sprite
  emits a soft glow (CircleGeometry r=180, opacity 0.18, additive).
- **Gradient stimulus**: identical math to sugar but lower strength
  (`0.02 × gradient`). Continuous, never reaches a "goal".
- **Heading bias**: subtle (`s.mateAttract = ... * 0.5 × ...`).
- **Wing extension on close approach** (d < 60): `sim.stimulate(sim.escw, 0.4, 600)` — wing extension as courtship song surrogate.
  - Body anim: brief wing flutter (existing `wingDrive` already does this).
- **No removal** — mate persists; user can Clear Zones to remove.

### Hebbian persistence

- **When to save**: every 30 s while plasticity is on, AND on quit.
  Throttle: 30 s is enough; the LTP rate is 1e-4 × dt so a 30 s
  window accumulates 0.003 per pair, ~50 pair events is enough
  to make a visible behavioral difference.
- **File**: `app.getPath('userData')/food-memories.json`.
  Schema: `{ version: 1, weights: number[], edgesTouched: number,
             savedAt: ISO8601 }`.
- **Load**: at app start, if file exists, call `sim.importWeights(w)`.
  Skip silently if length mismatches the current sim (e.g. data was
  regenerated).
- **Reset**: tray → Trainer ▸ Reset weights (existing) clears the
  file too. Phase 2 already has `sim.resetPlasticity()`; extend
  it to also delete the JSON.

### Tests

- **simtest Phase 9**: spawn sugar sim 200 pt from virtual fly;
  stim sugar zone for 5 s with `sim.sensStim` driven by distance
  function; assert `sim.rateFwd` rises and at least 1 `sim.groom`
  spike.
- **simtest Phase 10**: spawn mate; assert `sim.escw` rate rises
  when mate is within 60 pt equivalent.
- **behaviortest**: new scenario "Fly reaches spawned sugar":
  - Spawn sugar at (200, 0) relative to fly.
  - Run 8 s of sim.
  - Assert: fly's distance to sugar < 50 at some point.
  - Assert: `sim.rateFwd / 10 > 0.3` for > 30 % of the duration
    (the fly was walking).
  - Assert: zone count went 1 → 0 (got consumed).

## Phases (graph)

```yaml
graph:
  - {id: F1, needs: [],        parallel: "",          status: "[x]", files: [signals.js, flymodel.js, overlay.js]}
  - {id: F2, needs: [F1],       parallel: "after-f1",  status: "[ ]", files: [overlay.js]}
  - {id: F3, needs: [F1],       parallel: "after-f1",  status: "[ ]", files: [main.js, linux/main.js]}
  - {id: F4, needs: [F1, F2],   parallel: "",          status: "[ ]", files: [sim.js, overlay.js]}
  - {id: F5, needs: [F1, F2],   parallel: "after-f4",  status: "[ ]", files: [simtest.js, behaviortest.js]}
  - {id: F6, needs: [F4],       parallel: "after-f5",  status: "[ ]", files: [main.js, linux/main.js, docs/]}
```

### F1 `f1-signal-and-heading` — wire food/mate into signals + flymodel
- output: `signals.js` adds `s.foodAttract`/`s.mateAttract`/`s.mateClose`;
  `flymodel.js` consumes them in `updateWalk` heading term.
- acceptance: `simtest` PASS unchanged; renderer unit test
  (Phase 5 below) shows `fly.heading` rotates toward `(200, 0)` when
  `s.foodAttract = 0.5` for 1 s of simulated time.

### F2 `f2-sugar-and-mate-rendering` — 3D sprites + reach detection
- output: `zones[]` array in `overlay.js`; `drawZones()` per frame;
  `checkReaches()` fires reward + animation.
- acceptance: in headed run, tray Game ▸ Spawn Sugar → yellow circle
  visible; fly reaches it within 10 s.

### F3 `f3-tray-and-IPC` — tray submenu + cmd channel
- output: `Game` submenu in `linux/main.js` and `windows/main.js`;
  new cmd cases in `overlay.js#onCommand`.
- acceptance: tray click Spawn Sugar → IPC fires → renderer creates zone.

### F4 `f4-hebbian-persistence` — JSON load/save
- output: `sim.exportWeights()` snapshot every 30 s while plasticity
  enabled; load at start; reset wipes file.
- acceptance: reach sugar → quit → relaunch → assert `importWeights`
  restored (a hash check is enough; no behavioral assertion).

### F5 `f5-tests` — simtest + behaviortest additions
- output: simtest Phases 9, 10; one new behavior scenario.
- acceptance: `npm test` green (or only baseline-flaky landing).

### F6 `f6-docs-and-commit` — docs + branch push
- output: `docs/ubuntu.md` Game section; `README.md` feature list
  updated; branch committed; `git format-patch` ready for upstream.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Sugar stimulus drowns out other senses | `sim.sensStim` is a *new* input channel, not added on top of `sim.airPuff`; cap at 0.3 to leave headroom. |
| Hebbian weights overfit to one zone position | Decay (`alpha=1e-7` default) keeps weights bounded; clamp `[0, 2*w0]` is already in place. |
| Per-monitor sprite not visible on inactive displays | Sprites added to all overlay windows' scenes, but `zones[]` is shared — only the active display's renderer animates them. Hidden displays still see them on switch. |
| Stoch landing smoothness flake | Behavior test for reach does not involve landing; separate scenario. |
| `sim.sensStim` overloads existing `airPuff` math | New field, not aliased; `airPuff` keeps its air-puff identity. |

## Verification

```bash
cd /tmp/desktop-fly
# ground truth
cd linux && node ../windows/test/simtest.js   # all 10 phases PASS
cd linux && node ../windows/test/behaviortest.js  # green or only baseline-flaky
# headed
cd linux && npm start
# tray → Game → Spawn Sugar (yellow circle appears; fly reaches it)
# tray → Trainer → Enable Hebbian plasticity (let it learn)
# quit, restart, observe memory file exists
ls -la ~/.config/desktop-fly/food-memories.json
```

## Out-of-scope (Phase 4/5 follow-up)

- Rate-plot brain monitor (Phase 4).
- Full v783 (Phase 5).
- Multi-fly courtship / dimorphic circuits.
- 3D food mesh / instanced sprites.
- Sound (proboscis buzz, courtship song).
