# Tasks — fly satiety, predator zones, brain-trainer stats, brain state line

Each task includes its verification. Run `pnpm test` from
`linux/` (which transitively runs `windows/test/*` via the
symlinks) and the `simtest`/`behaviortest`/`attracttest` suites
to confirm regressions.

## 1. Satiety — sim/flymodel side

- [x] 1.1 Add `sugarLevel: 0.2` field to the `Fly` struct in `windows/src/flymodel.js` and verify the scaffold test still passes (`cd linux && pnpm test`).
- [x] 1.2 Implement the per-tick decay `sugarLevel *= exp(-dt / 60)` in the fly's `step()` and verify with a unit test in `windows/test/behaviortest.js` asserting `sugarLevel` after 60 s of wall time is within 1% of `0.2 * e^-1`.
- [x] 1.3 Add a `+0.4` (clamped to 1) `sugarLevel` update on `foodReached` and verify with a behavetest scenario that 5 successive eats drive `sugarLevel > 0.9`.
- [x] 1.4 Gate `foodAttract` by zero when `sugarLevel < 0.2` and verify with a behavetest scenario: a satiated fly placed 100 pt from a sugar zone shows `effective foodAttract == 0`.

## 2. Satiety — user-visible behaviour

- [x] 2.1 Confirm the renderer does **not** auto-respawn sugar zones after consumption and verify by inspection of `windows/renderer/overlay.js` and a manual test run (tray → Spawn Sugar Zone → wait for eat → confirm no new sugar appears).
- [x] 2.2 Document the user-spawn-only contract in `linux/README.md` and `docs/ubuntu.md` and verify the new sentence is present in both files.

## 3. Predator zones — sim/attract side

- [x] 3.1 Extend `windows/src/attract.js`: rename `foodAndMateAttract` to `zoneAttract`, accept `kind: 'predator'`, return `predatorAttract` (negative bias) and `speedMul`; keep existing sugar/mate behaviour bit-identical. Verify with the existing `attracttest.js` (14/14 must still pass).
- [x] 3.2 Add the `PREDATOR_RANGE = 900` constant and the speed multiplier `1 + 0.5 * falloff(d, PREDATOR_RANGE)` cap at 1.5. Verify with a new `attracttest` case: a fly 100 pt from a predator has `speedMul ≈ 1.45`.
- [x] 3.3 Add negative-bias cases: predator at +π/2 with fly heading 0 produces `predatorAttract < 0`; predator at range boundary produces 0. Verify with two new `attracttest` cases.
- [x] 3.4 Add `kind: 'predator'` to the zone `foodReached` exclusion list and verify with an `attracttest` case asserting `foodReached === null` for a fly inside a predator zone.

## 4. Predator — teach signal and plasticity

- [x] 4.1 In `windows/src/flymodel.js`, expose an `escapeTeach` field on the per-tick result that scales with predator proximity. Verify with a unit test in `windows/test/simtest.js`: a fly held within 200 pt of a predator for 10 s reports a non-zero `escapeTeach`.
- [x] 4.2 Wire `escapeTeach` into the existing Hebbian step in `windows/renderer/overlay.js` so it adds LTD on `sens→escape` edges while the fly is near a predator. Verify with a simtest plasticity probe: after 30 s of predator exposure with plasticity on, `sens→escape` weight is measurably lower than baseline.
- [x] 4.3 Add a regression guard: after 60 s of continuous predator exposure, `sens→escape` weight SHALL remain above 50% of its baseline. Verify with a new simtest scenario that fails the build if violated.

## 5. Predator — UI integration

- [x] 5.1 Add a `Spawn Predator` item under tray → Game in `linux/main.js` and `windows/main.js` (broadcasting `{ name: 'spawnPredator' }`) and verify by clicking the item in a manual run.
- [x] 5.2 Add the `spawnPredator` command handler in `windows/renderer/overlay.js` next to the existing `spawnSugar`/`spawnMate` and verify with a manual test run.
- [x] 5.3 Render a red octagon mesh for `kind: 'predator'` zones in the overlay scene and verify by visual inspection (snapshot via `pnpm start -- --snapshot=/tmp/pred.png`).
- [x] 5.4 Confirm `Clear Zones` removes predator zones (existing handler iterates over all zones; verify the predator zone is removed in a manual test).

## 6. Brain-trainer memory view

- [x] 6.1 Add a `Memory` tab in `windows/renderer/brain-trainer.html` next to the existing `Lessons` tab and verify both tabs render in a manual trainer-window open.
- [x] 6.2 Implement the file read for `~/.config/desktop-fly/food-memories.json` via the existing `fs` IPC channel exposed by `preload.mjs` and verify by reading the file in the panel and seeing the placeholder text on a fresh install.
- [x] 6.3 Render 20 SVG `<rect>` bars sorted by `|dW|`, coloured green for positive and red for negative, each labelled `pre → post: dW=±0.NNNN` and verify visually with a snapshot of the trainer window after at least 10 plasticity events.
- [x] 6.4 Add the 30 s auto-refresh poll (file mtime change triggers re-read) and verify by writing a new `food-memories.json` from the main process and observing the bars update within 30 s.
- [x] 6.5 Handle the missing/empty snapshot case with the `No learning yet` placeholder and verify by deleting `food-memories.json` and re-opening the trainer.

## 7. Brain state readout

- [x] 7.1 Add a one-line `<div id="state-line">` element to `windows/renderer/brain.html` at the top of the panel and verify it renders in a manual brain-window open.
- [x] 7.2 Extend the `spikes` IPC payload to `{ spikes, state, signals }` (additive — `spikes` field unchanged) and verify by inspecting a renderer log on a fresh run.
- [x] 7.3 Implement the state derivation using the same priority order as `brainBehavior` in `windows/src/flymodel.js` and verify with a behavetest scenario: a stim-then-walk transition shows `walk` within 100 ms.
- [x] 7.4 Render the nine populations (LC4, LPLC2, GF, DNa01, DNa02, DNp09, DNg11, MDN, escW) normalised to [0, 1] with 3-decimal precision and verify visually with a brain-window snapshot during a known stimulus (e.g. loom → GF should read `1.000`, MDN at rest should read `0.000`).
- [x] 7.5 Throttle the readout update to ≤ 10 Hz and verify by reading the renderer's frame log on a 60 fps run: state-line updates per second ≤ 10.

## 8. Documentation

- [x] 8.1 Update `linux/README.md` and `windows/README.md` Game-mode section to mention `Spawn Predator` and satiety (sugar does not respawn; satiated flies ignore sugar) and verify the new lines are present in both files.
- [x] 8.2 Update `docs/ubuntu.md` Brain Trainer section to mention the new `Memory` tab and verify the new sentence is present.
- [x] 8.3 Add a short "Reading the brain window" paragraph to both READMEs describing the state line and the nine numeric rates and verify it is present.

## 9. Verification

- [x] 9.1 Run `cd linux && pnpm test` and verify all four suites pass: `simtest`, `behaviortest`, `attracttest`, `scaffold`.
- [x] 9.2 Run `pnpm install --frozen-lockfile` in `linux/` and verify it succeeds with no warnings (no new dependencies).
- [x] 9.3 Run `openspec validate fly-satiety-predator-brain-trainer-stats` and verify the change validates with no errors.
- [x] 9.4 Run `pnpm start -- --snapshot=/tmp/snapshot.png` in `linux/` and verify the file is a non-zero PNG (manual run; renderer must reach first frame).
