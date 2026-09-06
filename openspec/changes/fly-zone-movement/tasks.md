# Tasks — fly-zone-wander + fly-zone-contact-debug

Each task lists its verification. The change is small and additive;
the shared sim/behaviour contract is unchanged.

## 1. Zone motion primitive

- [x] 1.1 In `windows/renderer/overlay.js`, refactor `drawZones(t)` so
      every zone gets `target`, `nextHopMs`, `speed`, and `chaseProb`
      fields at spawn time. The `mate` branch already has motion —
      extract the lerp+repick into a `stepZoneMotion(z, t, fly,
      bounds)` helper that all three kinds share. Verify the existing
      14 `attracttest` cases still pass.

- [x] 1.2 In `spawnSugar` / `spawnMate` / `spawnPredator`, set the
      per-kind constants: `speed` (sugar 30, mate 20, predator 50)
      and `chaseProb` (sugar 0.15, mate 0.25, predator 0.40). Verify
      by inspection.

- [x] 1.3 Implement the repick branch in `stepZoneMotion`: roll
      `r ∈ [0, 1)`; if `r < z.chaseProb`, target a point within
      200 pt of the fly (random angle, random distance ≤ 200);
      otherwise a uniform point on the active display with a 60 pt
      edge margin. Verify with a new `attracttest` scenario: 30
      sugar repicks with a controlled `r` sequence, ≥ 3 of the 4
      chase-bias targets are within 200 pt of the fly.

- [x] 1.4 Clamp every zone's position to `±(hw - 60), ±(hh - 60)`
      after every motion tick. Verify by inspection of the
      `stepZoneMotion` code path.

## 2. Contact log

- [x] 2.1 Add a `Set<string>` keyed by `${zoneId}:${flyIndex}` to
      the renderer module scope. On a `foodReached` event in
      `checkReaches`, emit one `console.info` of the form
      `[zone] sugar reach id=N fly=#F d=D bias=B` if the key is
      not yet in the set, then add it. Verify by reading the
      log on a manual run after `pnpm start -- --snapshot=...`.

- [x] 2.2 On `mateClose` (in `checkReaches`), emit
      `[zone] mate close id=N fly=#F d=D bias=B` once per
      (zone, fly). Verify by inspection.

- [x] 2.3 On predator proximity inside `checkReaches`, emit
      `[zone] predator loom id=N fly=#F d=D bias=B` once per
      (zone, fly) the first time the fly enters PREDATOR_RANGE.
      Verify by inspection.

## 3. Tray "Spawn Near Fly"

- [x] 3.1 Add a new `case 'spawnNear'` to the `onCommand` switch
      in `overlay.js`. The handler picks a random angle θ and
      distance d ∈ [50, 200], then calls
      `spawnSugar(first.pos.x + d*cos θ, first.pos.y + d*sin θ)`.
      Verify by reading the code and (manually) clicking the new
      tray entry.

- [x] 3.2 Add the new tray item to `linux/main.js` (Game submenu)
      and `windows/main.js` (Game submenu). The click handler
      broadcasts `{ name: 'spawnNear' }`. Verify by inspection.

## 4. Documentation

- [x] 4.1 Update the Game-mode paragraph in `linux/README.md`,
      `windows/README.md`, and `docs/ubuntu.md` to describe
      the zone motion (sugar 30, mate 20, predator 50 pt/s;
      chase probabilities) and what the user should observe on
      contact (wing raise, reward stim, courtship posture,
      escape bias). Verify by reading the new paragraph in
      each doc.

- [x] 4.2 Document the new `Spawn Near Fly` tray entry in the
      same three docs. Verify by reading.

## 5. Tests

- [x] 5.1 Add a `behaviortest` scenario: a fly at origin, a
      sugar zone spawned 200 pt to the east, and the zone
      drifting toward the fly at 30 pt/s. The fly should reach
      the zone within 8 s. Verify by running `pnpm test` from
      `linux/` and seeing the scenario PASS.

- [x] 5.2 Add an `attracttest` case for the chase branch:
      10 predator repicks with a controlled `r` sequence,
      at least 3 of the 4 r < 0.40 targets are within 200 pt
      of the fly. Verify by `node test/attracttest.js`.

## 6. Verification

- [x] 6.1 `cd linux && pnpm test` — all four suites pass:
      `simtest`, `behaviortest`, `attracttest`, `scaffold`.

- [x] 6.2 `pnpm install --frozen-lockfile` in `linux/` — clean,
      no new dependencies.

- [x] 6.3 `openspec validate fly-zone-movement` — change
      validates with no errors.

- [x] 6.4 `pnpm start -- --snapshot=/tmp/zone.png` then
      `pnpm start -- --brainshot=/tmp/zone-brain.png` — both
      files are non-zero PNGs (manual run; renderer must
      reach first frame).
