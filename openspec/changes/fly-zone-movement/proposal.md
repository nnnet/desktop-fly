## Why

The three game zones (sugar, mate, predator) currently behave inconsistently.
Mate wanders (every 6–12 s to a new random point) but sugar and predator are
static. The fly also appears unresponsive to the zones — users see sugar and
predator land on the screen and the fly walks right past without turning. The
existing attract maths are correct (`attracttest` 24/24), so the issue is
either the renderer not wiring the zones to the fly or the movement being
too slow to provoke a reaction within a session. This change makes all three
zones wander, sometimes toward the fly, and turns the zone into a visible
behavioural trigger so the user can see the predator chase / sugar hunt /
courtship dance in real time.

## What Changes

- **All three zone kinds wander.** Every zone has a target position and a
  lerp speed; the target is repicked every 4–10 s to a random point on the
  active display, with a small bias (≤ 30 % chance) to pick a point within
  ~200 pt of the fly. When the bias fires, the zone chases the fly;
  otherwise it wanders off-screen and back. Sugar has the lowest chase
  probability (≤ 15 %), predator the highest (≤ 40 %), mate in between
  (≤ 25 %).
- **Fly visibly reacts to all three.** Existing wiring already computes
  the bias; this change adds a `console.info` line on first contact per
  zone per fly (rate-limited) and an in-bounds test for `mateClose` and
  `foodReached` that proves the simulator is reading the zones. The
  current visual reaction is preserved: sugar → wing raise + reward
  pulse, mate → wing extension, predator → negative heading + speed
  boost.
- **Tray "Spawn" buttons stay; "Spawn near" added.** New tray entry
  "Spawn Near Fly" places a sugar zone within 200 pt of the fly, for
  fast demo. The original "Spawn Sugar/Predator/Mate" buttons become
  the randomised version (they were already random; we make the chase
  bias explicit and add this deterministic shortcut).
- **No new dependencies, no contract changes** to the connectome, the
  tray IPC, the renderer/preload contract, or the sim API.

## Capabilities

### New Capabilities

- `fly-zone-wander`: every zone kind has a target position and a
  repick loop; the repick distribution includes a "chase the fly"
  branch. Defines the per-kind bias probabilities and the repick
  interval.
- `fly-zone-contact-debug`: rate-limited `console.info` on first
  contact per zone per fly, plus a testable invariant (`foodReached`,
  `mateClose`, `predatorAttract` non-zero) that proves the renderer
  → fly wiring is intact.

### Modified Capabilities

- (none — the existing `fly-satiety`, `fly-predator-zones`,
  `brain-state-readout` specs do not need requirement changes; their
  behaviour is preserved, only the rendering now moves)

## Impact

- `windows/renderer/overlay.js`: `drawZones` and `spawnSugar` /
  `spawnMate` / `spawnPredator` updated. Each zone gets `target`,
  `nextHop`, `speed` fields. `checkReaches` keeps the existing
  food-consume + mateClose + predator proximity logic.
- `windows/src/attract.js`: no change. The zone schema is extended
  with motion fields; `zoneAttract(fly, zones)` is unchanged.
- `linux/main.js`, `windows/main.js`: new tray entry "Spawn Near Fly"
  + the existing Spawn entries (their behaviour is documented as
  "wanders" now, but the code does not change beyond the new entry).
- `docs/ubuntu.md`, `linux/README.md`, `windows/README.md`: the Game
  mode section gets a "Zone motion" paragraph explaining the chase
  bias and what the user should observe.
- `windows/test/attracttest.js`: new test cases for "mating while
  passing through" and "predator ahead of fly" (the existing
  bias-from-static-position cases stay).
- `windows/test/simtest.js` (or a new `behaviortest.js` scenario):
  verify a fly at origin reaches a sugar zone that was placed
  ahead of it and drifting toward the fly within the time budget.
