# Design — fly-zone-wander + fly-zone-contact-debug

## Context

The three game zones in `windows/renderer/overlay.js` (`spawnSugar`,
`spawnMate`, `spawnPredator`) currently have inconsistent motion
behaviour. `spawnMate` already lerps toward a target and repicks
every 6–12 s. `spawnSugar` and `spawnPredator` are static. Even
where motion exists, the `nextHop` interval is 6–12 s with no
chase-the-fly branch, so during a short session the user is
unlikely to see the zones provoke the fly. This change unifies
the motion model and adds a per-kind chase probability.

The attract maths in `windows/src/attract.js` are already correct
(`attracttest` 24/24, no change). The wiring in
`windows/renderer/overlay.js` already calls `zoneAttract(fly, zones)`
and feeds `foodAttract` / `mateAttract` / `predatorAttract` to the
fly's `updateWalk`. The missing piece for the user-reported
"no reaction" is **visibility** — a debug log proves the wiring is
alive, and motion makes the contact happen within a session.

## Goals / Non-Goals

**Goals**

- All three zone kinds share one motion model (target + lerp +
  repick) so the user can predict their behaviour.
- A per-kind chase probability biases the repick distribution so
  the zones occasionally interact with the fly.
- A single `console.info` per contact (per zone × fly) proves the
  renderer → fly wiring is alive in the user's session.
- A new tray entry `Spawn Near Fly` is the deterministic
  short-cut the user can use to verify sugar-reach behaviour
  immediately.

**Non-Goals**

- No new dependencies.
- No changes to `attract.js` (zone schema gains motion fields, but
  the math is unchanged).
- No changes to the connectome, the sim API, the tray IPC, or the
  preload contract (only a new tray entry name).
- No multi-fly selection logic; the chase target is always
  `flies[0]`.

## Decisions

### D1. One motion primitive, three per-kind speeds

`drawZones(t)` walks the zones array and, per zone, lerps the
position toward `z.target` at `z.speed` pt/s. When the wall-clock
exceeds `z.nextHopMs`, repick: roll a random number, compare to
`z.chaseProb`, pick a new target either near the fly or
uniformly on the display. Sugar/mate/predator each set their
`z.speed` and `z.chaseProb` at spawn time.

**Why:** symmetric with the existing `spawnMate` motion — the
refactor is to extract the lerp+repick into a helper and apply it
to all three kinds with their per-kind constants.

### D2. Per-kind chase probability

| kind | speed (pt/s) | chaseProb |
|------|--------------|-----------|
| sugar | 30 | 0.15 |
| mate | 20 | 0.25 |
| predator | 50 | 0.40 |

Predator chases most because the demo is most striking
("the fly gets hunted"). Sugar chases least because
satiety is the slow-burn story. Mate is in between because
courtship is the regular pacing.

**Why:** these numbers are tuned by feel, but they sit inside
ranges that keep the long-run distribution dominated by
"wander off-screen and back" while still producing contacts
every minute or two in a normal session.

### D3. Contact log is rate-limited to (zoneId, flyIndex)

A simple `Set` keyed by `${zoneId}:${flyIndex}` records
contacts already logged. On contact, the renderer looks up the
key, logs if absent, and adds it. The set is per-session (not
persisted) — re-entering the same zone is intentional: the user
should see the wing raise, the reward pulse, or the speed boost,
not a log line every frame.

### D4. Console-based log, not a tray entry

The contact log goes to `console.info` which the renderer
already pipes to main via the `renderer-log` IPC channel
(see `linux/main.js:494-505`). The user can see it in the
terminal where they launched the app. A tray entry would be
heavier and would itself need a "clear" button; console is
the right surface for a debugging affordance that lives in
the launcher anyway.

### D5. Spawn Near Fly: deterministic spawn within 200 pt

The tray entry adds a `cmd: 'spawnNear'` channel. The overlay
handler picks a random angle θ ∈ [0, 2π) and a distance d ∈
[50, 200] pt, computes `fly.pos + (d*cos θ, d*sin θ)`, and calls
`spawnSugar` with the result. No new mesh, no new colour — the
sugar zone behaves identically to the random-spawn one.

## Risks / Trade-offs

- **Risk:** A high chase probability could turn the predator
  into a constant harasser. → **Mitigation:** the per-zone
  speed cap (50 pt/s) limits how close the predator can get
  before the fly has a chance to react, and the existing
  `predatorAttract` heading-bias kicks in as soon as the
  predator is within PREDATOR_RANGE (900 pt), so the fly
  reverses direction long before contact.
- **Risk:** A zone lerping past the display edge looks
  unpolished. → **Mitigation:** the position is clamped to
  `±(hw - 60)` after every tick; targets are also constrained
  to the same window.
- **Risk:** A console.info line per contact is noisy if
  many zones chase. → **Mitigation:** the rate-limit set
  keys on (zoneId, flyIndex); each pair logs once for the
  whole session.

## Migration Plan

- No data migration. Zones are renderer-only; saved memory
  snapshots are unaffected.
- No new dependencies. `node_modules` is unchanged.
- Rollback: revert the change. The renderer is the only
  modified module, and the revert is a single commit.

## Open Questions

- Should the "Spawn Near Fly" be a separate tray item or a
  modifier on the existing "Spawn Sugar" (e.g. shift-click)?
  → Defer to the first run; modifier keys are a UI choice
  the user can iterate on. For now, separate item.
- Should the contact log be visible in the brain window as
  well as the launcher? → Defer; console is enough for v1.
