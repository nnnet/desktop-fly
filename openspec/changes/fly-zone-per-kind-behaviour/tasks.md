# Tasks — fly-zone-per-kind-behaviour

Each task lists its verification. Run the test suites + a manual
launcher run to confirm the personalities are visible.

## 1. Per-kind motion in zone-motion.js

- [x] 1.1 Add `predatorStep(z, dt, fly, bounds)` in
      `windows/src/zone-motion.js`. Two states (`rest`,
      `sprint`). `rest` for 4–8 s; on exit, set target to
      200–400 pt from the fly. `sprint` lerps at `speed`
      (50 pt/s) toward the target; on arrival (within 30 pt)
      transition back to `rest`. Verify with a unit test:
      a fresh predator is stationary for at least 4 s; after
      4 s the position starts to move; on arrival it stops
      again.

- [x] 1.2 Add `mateStep(z, dt, fly, bounds)`. Continuous
      orbit: repick target every 4–8 s within 200 pt of the
      fly; lerp at 20 pt/s. The target's angular sector must
      differ from the previous target by ≥ 60 deg. Verify
      with a unit test: 30 s of mateStep keeps the mate
      within 200 pt of a stationary fly at least 60 % of the
      time.

- [x] 1.3 Add `sugarStep(z, dt, fly, bounds)`. Three states
      (`tease`, `flee`, `done`). `tease` for 1.0–3.0 s
      (stationary). `flee` for 2.5–3.5 s (velocity = unit
      vector from fly to zone, scaled by 60 pt/s). `done`
      sets `z.removeRequested = true`. Verify with a unit
      test: sugar is stationary in the first second after
      spawn; after tease, the sugar moves away from the fly;
      after flee the sugar requests removal.

## 2. Renderer wires per-kind motion

- [x] 2.1 In `windows/renderer/overlay.js`, change
      `drawZones(t, dt, fly)` to dispatch on `z.kind`:
      `predatorStep` for predator, `mateStep` for mate,
      `sugarStep` for sugar, the generic `stepZone` as
      fallback. After the dispatch, set the mesh position
      (already done today). Verify by reading the new
      `drawZones`.

- [x] 2.2 In `drawZones`, after the per-kind step, check
      `z.removeRequested` and call the existing removal
      helper. Verify by reading the new branch.

- [x] 2.3 Update `stepZoneMotion` in overlay.js to be a
      thin wrapper that calls the kind-dispatched helper.
      Verify by grep that no other call sites exist.

## 3. Heading-bias always-on

- [x] 3.1 Add `applyZoneHeading(fly, attract, dt)` in the
      renderer. Adds `attract.foodAttract * 1.0 * dt +
      attract.mateAttract * 1.0 * dt + attract.predatorAttract
      * 1.0 * dt` to `fly.heading`. In `state === 'flying'`
      multiply the bias by 0.5.

- [x] 3.2 In `frame()`, after `signalBuilder.make(sim, dt)`,
      call `applyZoneHeading(first, attract, dt)`.
      `attract` is computed via `zoneAttract(first, zones)`
      once per frame and cached for the call.

- [x] 3.3 In `windows/src/flymodel.js`, remove the
      `if (this.zones && this.zones.length) zoneAttract(...)`
      block inside `updateWalk` so the bias is not
      double-applied. The renderer is the only place that
      applies it now. Verify with `node test/behaviortest.js`
      (existing tests still pass) and a manual launcher run
      (fly still turns toward sugar).

## 4. Tests

- [x] 4.1 Add per-kind unit tests in
      `windows/test/zone-motion.test.js`:
      - predator: stationary first 4 s, then moves
      - mate: 30 s sample, ≥ 60 % within 200 pt
      - sugar: stationary 1 s after spawn, then moves away,
        then sets `removeRequested = true`

- [x] 4.2 Verify `cd linux && pnpm test` runs all four
      suites green.

## 5. Documentation

- [x] 5.1 Update the Game-mode paragraph in `linux/README.md`,
      `windows/README.md`, and `docs/ubuntu.md` to describe
      the three personalities (predator sprint, mate orbit,
      sugar tease-and-flee). Verify by reading the new
      paragraph in each doc.

- [x] 5.2 Add a note that the heading-bias is applied every
      frame in the renderer, so the fly reacts in every state.
      Verify by reading the new note in each doc.

## 6. Verification

- [x] 6.1 `cd linux && pnpm test` — all four suites pass.

- [x] 6.2 `pnpm install --frozen-lockfile` in `linux/` — clean.

- [x] 6.3 `openspec validate fly-zone-per-kind-behaviour` —
      change validates with no errors.

- [x] 6.4 `pnpm start -- --snapshot=/tmp/perkind.png` — non-zero
      PNG, addFly log appears (renderer must reach first frame).
