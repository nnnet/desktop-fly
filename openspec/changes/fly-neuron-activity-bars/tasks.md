# Tasks — fly-neuron-activity-bars

Each task includes its verification. Run `pnpm test` from
`linux/` to confirm regressions.

## 1. Config + persistence

- [x] 1.1 Add a `brainStatsFile()` helper in `linux/main.js` and `windows/main.js` (mirrors `memoriesFile()`) returning `app.getPath('userData')/brain-stats.json` and verify by listing the path with `node -e "console.log(require('path').join(require('os').homedir(), '.config/desktop-fly/brain-stats.json'))"`.
- [x] 1.2 Add an `ipcMain.handle('brain-stats:read', ...)` channel that returns the parsed JSON or the default object on missing/malformed file, and verify by hitting the channel from the renderer with a temporary test script.

## 2. Aggregator (pure-node testable)

- [x] 2.1 Create `windows/src/brain-stats.js` exporting a `BrainStats` class with `push(tag, t)`, `aggregatesFor(name)`, and a static `DEFAULT_CONFIG` (9 neurons, `sum_duration`, 60 s). Verify with `windows/test/brainstats.test.js`:
  - empty buffer returns `{lifetime: 0, recent: 0}` for every neuron
  - 5 `walk` events in 60 s and 23 in 10 min: `DNp09` lifetime=23, recent=5 for `count`
  - the duration sum matches hand-computed (e.g. events at t=0, 2, 5 → sum = 5 s)
  - the rolling window excludes events older than `window_seconds * 1000` ms
- [x] 2.2 Export `TAG_FOR_NEURON` (or `NEURON_TAG` map) and verify with the test that every default neuron has a non-empty tag.
- [x] 2.3 Expose `loadConfig(path)` that reads JSON and falls back to defaults on missing/malformed; verify with a test that writes garbage to the file and asserts the default object is returned.
- [x] 2.4 Expose `BrainStats#replaceConfig(next)` that swaps the config without rebuilding the event buffer, and verify with a test that the lifetime aggregate is preserved across a config hot-reload.

## 3. Window construction (main process)

- [x] 3.1 Add `createStatsWindow(primary, linuxDir)` to `linux/main.js` and `windows/main.js` — 360×300, bottom-right stacked above the brain window, `skipTaskbar: true`, `alwaysOnTop: true`, loads `renderer/brain-stats.html`. Verify by manual open from the tray. *(Windows port intentionally ships the IPC handler only — see M1 note in the design doc; the window construction is Linux-only for this change.)*
- [x] 3.2 Add a tray item `Brain → Show Stats` in `linux/main.js` that toggles the window (show/hide on click) and a `Brain → Hide Stats` when the window is visible. Verify with a manual run.
- [x] 3.3 Wire the `state` IPC channel to also send to `statsWindow` (in addition to `brainWindow`) and verify by opening both windows and confirming both update in real time.
- [x] 3.4 The y-offset of the stats window is named (constants `BRAIN_H`, `PAD`, `GAP`) so the magic number no longer couples to the brain window's height.

## 4. Renderer

- [x] 4.1 Create `windows/renderer/brain-stats.html` with the bar-chart CSS (cloned from `brain-trainer.html#memory`) and a single `<div id="bars">` placeholder. CSP `<meta>` mirrors `brain.html`. Verify the window opens without errors in a manual run.
- [x] 4.2 Create `windows/renderer/brain-stats.js` that:
  - fetches the config via `flyAPI.brainStats()` (new preload bridge) and the default list
  - subscribes to `flyAPI.onState(payload)` and feeds `{tag, t: performance.now()}` to the `BrainStats` aggregator
  - re-renders the bars on every state event (throttled to ≤ 10 Hz, matching the upstream cadence)
  - re-fetches the config every 1 s and re-renders on change
  Verify by manual run and by checking that the DOM has 9 rows.
- [x] 4.3 Add `flyAPI.brainStats()` to `windows/preload.mjs` (the `ipcRenderer.invoke('brain-stats:read')` channel). Verify by `console.log(window.flyAPI.brainStats)` in the renderer.
- [x] 4.4 Visual test: open the window, stimulate the brain with a few clicks, and confirm the bars update. Capture a snapshot via `pnpm start -- --snapshot=/tmp/stats.png` if possible; otherwise rely on the manual run.

## 5. Documentation

- [x] 5.1 Update `linux/README.md` to mention the new window, the tray item, the config file, and the two modes (`count`, `sum_duration`). Verify the new paragraph is present.
- [x] 5.2 Update `docs/ubuntu.md` Brain Trainer section to mention the Stats window and the config file. Verify the new paragraph is present.
- [x] 5.3 Update `windows/README.md` to document that the IPC channel and aggregator are platform-agnostic, but the Stats window itself is currently Linux-only (the Windows port will catch up in a follow-up). Verify the new paragraph is present.

## 6. Verification

- [x] 6.1 Run `cd linux && pnpm test` and verify all five suites pass: `simtest`, `behaviortest`, `attracttest`, `brainstats`, `scaffold`. *(Pre-existing stochastic flakes on `landing is smooth` and `ledge attach + follow window edge` are noted in CLAUDE.md as ~16% baseline noise on unmodified HEAD; not caused by this change.)*
- [x] 6.2 Add `brainstats` to the `test` script in `linux/package.json`. Verify the test ordering matches the others.
- [x] 6.3 Run `openspec validate fly-neuron-activity-bars` and verify the change validates with no errors.
- [x] 6.4 Run `pnpm install --frozen-lockfile` in `linux/` and verify it succeeds with no warnings (no new dependencies).
- [x] 6.5 Update `linux/test/scaffold.test.js` to include `brain-stats.js` in `sharedSrc` and `brainstats.test.js` in `sharedTest` so the symlink contract is enforced for the new files. Verify the scaffold suite still passes.
- [x] 6.6 Manual: open the window via tray, observe the bars fill as the overlay runs `state` events, edit `~/.config/desktop-fly/brain-stats.json` to switch `metric` to `count` and confirm the bars re-render with the new mode.
