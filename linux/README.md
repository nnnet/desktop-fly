# DesktopFly for Linux

The Linux port of DesktopFly: the same 3D fruit fly on a transparent
desktop overlay, driven by the same 1 kHz leaky-integrate-and-fire
simulation of 668 real neurons from the FlyWire connectome (FAFB v783).

The brain is a line-by-line port of `Sim.swift`; the body and behavior
are a line-by-line port of `FlyModel.swift`. Both test suites came
across with them and are the ground truth here just as they are on
macOS.

> Host-install recipes (apt packages, NVIDIA ICD, snap troubleshooting)
> live in [`../docs/ubuntu.md`](../docs/ubuntu.md). This README covers
> the in-tree port itself.

## Why a port and not a rebuild

macOS DesktopFly links `Cocoa` and `SceneKit`, neither of which exists
on Linux; the open-source Swift toolchain ships only stdlib, Foundation
and Dispatch. Everything that draws or touches the system had to be
rewritten; everything that computes came over unchanged in behavior.

| macOS | Linux |
|---|---|
| SceneKit | three.js (WebGL) |
| AppKit `NSPanel`, borderless + `ignoresMouseEvents` | Electron `BrowserWindow`, `transparent` + `setIgnoreMouseEvents` |
| `NSStatusItem` menu bar | `Tray` (systray) |
| `CGWindowListCopyWindowInfo` | `xprop -root _NET_CLIENT_LIST` + per-window `xprop -id` (X11); typed no-op on Wayland v1 |
| `NSEvent` global mouse monitor | X11 `xinput` / `xdotool getmouselocation`; Wayland delegates to the compositor |
| `CGEventSource` idle | `powerMonitor.getSystemIdleTime()` (Electron) |
| `ProcessInfo.thermalState` | CPU load via `/proc/stat` |
| One overlay per display (macOS-style) | One `BrowserWindow` per display, only the active one is shown |

## Run

```sh
pnpm install
pnpm start            # tray icon 🪰; quit from there
pnpm run simtest      # circuit invariants (MUST pass after sim changes)
pnpm run behaviortest # 23 end-to-end sim -> body checks
pnpm run attracttest  # 14 food/mate-attraction math cases
pnpm test             # all of the above + scaffold
```

The suites run on bare Node — three.js builds the fly's scene graph
headlessly, so behavior is testable without a GPU.

`DESKTOPFLY_DEBUG=1 pnpm start` and `ELECTRON_OZONE_PLATFORM_HINT=x11|wayland`
control the verbosity and the platform backend. See [Troubleshooting](#troubleshooting).

### Snapshots

There is no `build` step and no `pnpm run snapshot` script. The two
headless renderers are CLI flags on the main binary:

```sh
pnpm start -- --snapshot=/tmp/fly.png      # 720x720 body render
pnpm start -- --brainshot=/tmp/brain.png   # 720x560 brain render
pnpm start -- --snapshot=out.png --top     # top-down orthographic view
```

## What the fly senses

Everything is poll-only and needs no permission dialog. As on macOS,
the fly learns *when* things happen, never *what*:

- **Cursor** — position and velocity become a looming stimulus, split
  between the two eyes by bearing, fed to 314 LC4/LPLC2 neurons. A
  lunge drives the DNp01 giant fiber and the fly takes off ~4 ms
  later. Fast motion nearby is an air puff on the sensory pathway.
- **Clicks** — a global mouse-button press is a tap on the fly's
  substrate, stimulating sensory neurons with a strength that falls
  off with distance.
- **Windows** — top edges of real windows are walkable ledges; a
  window appearing near the fly is a looming object. Only geometry
  is read: the pixels underneath the fly are never sampled. On X11
  this comes from `xprop` + `wmctrl`; on Wayland v1 it is a no-op
  (see `docs/ubuntu.md` for the future DBus bridge).
- **Typing** — the system idle timer says an input device was touched;
  if the cursor did not move and no button went down, that was the
  keyboard. No key is ever polled individually.
- **Clock and CPU load** — circadian activity curve and an ectotherm's
  tempo.

## Multi-monitor

The overlay is **per-monitor** (macOS-style): one `BrowserWindow` per
display, the active display's overlay is shown and the rest are
hidden to save GPU memory. "Send Fly to Next Display" in the tray
menu rotates the active display and re-anchors the camera.

This is the opposite of the Windows port, which spans the union of
all displays as one giant overlay. Linux compositors do not
consistently composite windowed overlays above every X11/Wayland
surface, so per-display windows are more reliable — and the fly
walking between monitors stays as smooth as a normal scene traversal.

X11 + xrandr work out of the box. Wayland on Mutter (GNOME 46+),
KWin (KDE Plasma 6), and wlroots compositors report logical outputs
through the `UseOzonePlatform` feature flag.

## Customizing the fly

The fly's appearance is configurable at startup and at runtime.

### CLI

```sh
pnpm start -- --fly-theme cyan --fly-size 1.5
FLY_THEME=magenta FLY_SIZE=2.0 pnpm start
```

`--fly-size` is clamped to `[0.3, 5.0]`. Theme names: `orange`
(default), `fruitfly`, `cyan`, `magenta`, `yellow`, `green`.

### Tray

- **Theme** — pick any of the six themes; the swap is instant, no
  restart. The current theme has a ✓ marker.
- **Size** — 0.5x, 1x, 1.5x, 2x, 3x. The current size has a ✓ marker.

## Brain Trainer

Tray → **Brain** → **Open Trainer** opens a 540×420 window with a
list of pre-built optogenetic lessons (loom-escape, sugar-forward-walk,
turn-left, groom-trigger). Click **Apply** to inject current into the
listed neurons; the brain window flashes the targeted neurons.
**Save** writes the pattern to `~/.config/desktop-fly/lessons/<name>.json`,
**Load** reads it back. Lessons are validated by `pnpm run brain-trainer-test`
(separate from `pnpm test` so it can run on its own).

The trainer has a second tab, **Memory**, that reads
`food-memories.json` on demand and on a 30 s poll and renders the
top 20 edges by `|w|` as horizontal bars — green for LTP, red for LTD.
The bar labels show the signed `dW` to 4-decimal precision. The tab
falls back to a `No learning yet — fly has not eaten or fled.`
placeholder when the snapshot is missing or empty.

## Brain Stats (population activity)

Tray → **Brain** → **Show Stats** opens a 360×300 window that
consumes the same `state` IPC stream that drives the brain
window's state line and renders, for each of the 9 command
populations (LC4, LPLC2, GF, DNa01, DNa02, DNp09, DNg11, MDN,
escW), **two horizontal bars**:

- **Lifetime** — the metric value across the whole session
- **Recent** — the same metric over the last `window_seconds`
  (default 60 s)

The metric and the window are read from
`~/.config/desktop-fly/brain-stats.json` (auto-created with
defaults on first launch). The file is hot-reloaded every second —
edit it while the window is open and the next render uses the new
values. Available keys:

```json
{
  "neurons": ["LC4", "LPLC2", "GF", "DNa01", "DNa02", "DNp09", "DNg11", "MDN", "escW"],
  "metric": "sum_duration",
  "window_seconds": 60
}
```

- `metric` — `"count"` (number of state events in the window) or
  `"sum_duration"` (seconds spent in that state).
- `window_seconds` — the rolling window size; set to `0` to
  hide the recent bar.
- `neurons` — any subset or superset of the 9 default names;
  unknown names render a disabled row, they do not crash.

## Game mode (food, mate, predator)

The tray has a **Game** submenu:

- **Spawn Sugar Zone** — drops a yellow circle. Every zone wanders:
  it picks a new target every 4–10 s, lerps toward it at 30 pt/s,
  and 15 % of the repicks aim within 200 pt of the fly. The fly
  orients toward the sugar via a tarsal-contact gradient; on contact
  the sugar disappears, the brain receives a `fwd + groom` reward
  pulse, and Hebbian LTP grows the edges that delivered the success.
  The fly's `sugarLevel` is restored on every eat (sugar is the only
  user-spawnable resource; it never respawns on its own). Above
  `sugarLevel ≥ 0.2` the fly chases sugar; below, the fly ignores it
  and goes hungry until you spawn more.
- **Spawn Near Fly** — drops a sugar zone within 50–200 pt of the
  fly at a random angle. The deterministic demo entry: you can
  verify sugar-reach behaviour immediately, without waiting for the
  random chase-bias branch to fire.
- **Spawn Predator** — drops a red octagon. Wanders at 50 pt/s with
  a 40 % chase-the-fly bias. The fly rotates away from the predator,
  gets a temporary speed boost (up to 1.5× within the predator's
  900 pt range), and the predator proximity feeds an `escapeTeach`
  signal to the sim. With plasticity on, this drives Hebbian LTD
  on the sensory→giant-fiber edges so the fly learns to filter false
  alarms after repeated exposure. Predator zones do not consume on
  contact.
- **Spawn Mate** — drops a slowly-moving pink glow. Wanders at
  20 pt/s with a 25 % chase-the-fly bias. The fly steers toward it;
  close approach (60 pt) fires wing-extension (courtship surrogate).
  The mate never disappears.
- **Clear Zones** — removes all food, mate, and predator zones.

### What you see on contact

The renderer logs a single line per (zone, fly) the first time they
contact — visible in the launcher's terminal:

```
[zone] sugar reach id=7 fly=#0 d=14 bias=0.957
[zone] mate close id=3 fly=#0 d=42 bias=0.218
[zone] predator loom id=11 fly=#0 d=480 bias=-0.182
```

Reactions you should observe on screen:

| Contact | Visible reaction |
|---|---|
| Sugar reach | sugar disappears; brief wing raise (proboscis extension surrogate); brain receives reward pulse on DNp09 (walk) and DNg11 (groom) |
| Mate close | wing raise (courtship posture); wing extension via DNp02/04/11; brain state line shows `court` |
| Predator within 900 pt | fly turns away, speeds up; the predator closes in and the fly accelerates; plasticity window applies Hebbian LTD on sensory→escape edges |

Leave **Enable Hebbian plasticity** on while you hunt sugar and the
brain snapshots its weight matrix to `~/.config/desktop-fly/food-memories.json`
every 30 s. Quit and relaunch and the brain picks up where it left
off. **Reset weights** wipes the file.

## Reading the brain window

The brain window now opens with a thin status bar at the top. The
left side is the current behavioural state in a single word
(`walk`, `flight`, `groom`, `idle`, `sleep`, `eat`, `court`). The
right side is the same nine population rates the rest of the
connectome already exposes, normalised to `[0, 1]` with 3-decimal
precision: `LC4`, `LPLC2`, `GF`, `DNa01`, `DNa02`, `DNp09`, `DNg11`,
`MDN`, `escW`. The readout is throttled to 10 Hz so the DOM does
not churn at 60 fps; transitions still appear within 100 ms.

## Known limits

- On Wayland v1 the `wayland.js` sense is a typed no-op: the fly
  still walks, grooms and flees the cursor, but it cannot walk on
  real window edges. The v2 path is a small DBus daemon over
  `wlr-foreign-toplevel-management-v1` (see `docs/ubuntu.md`).
- Exclusive-fullscreen apps still hide the overlay on most
  compositors; borderless fullscreen is fine.
- This port deliberately has no `koffi` dependency. If a startup
  warning mentions `koffi`, an old `package.json` leaked — re-run
  `pnpm install`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Tray icon 🪰 does not appear | `echo $XDG_CURRENT_DESKTOP`; on headless hosts the tray is hidden |
| Black overlay on X11 | `export ELECTRON_OZONE_PLATFORM_HINT=x11` |
| Black overlay on Wayland | `export ELECTRON_OZONE_PLATFORM_HINT=wayland`; ensure `nvidia_icd.json` is installed |
| `Cannot find module 'koffi'` | koffi is Windows-only; linux/ does not depend on it. Re-run `pnpm install`. |
| `xprop` not found | `apt install x11-utils`; the app still runs, just without window ledges |
| Fly flickers / GPU error | `nvidia-smi` to check the driver; on Optimus laptops, force NVIDIA via `prime-run pnpm start` |
| Tests fail with `EACCES: /dev/dri` | `xvfb-run -a pnpm test` (no real GPU needed) |
| Stuck on the wrong display | Tray → **Send Fly to Next Display** |

## Layout

| file | contents |
|---|---|
| `main.js` | Electron main: per-monitor overlays, brain + trainer + stats windows, tray, environment senses |
| `preload.mjs` | the only main↔renderer bridge (symlink to `../windows/preload.mjs`) |
| `renderer/overlay.js` | `buildScene` + `Coordinator` from `main.swift` (symlinked from `../windows/renderer/`) |
| `renderer/brain.js` | port of `BrainView.swift` |
| `renderer/brain-trainer.js` | optogenetic lesson player |
| `renderer/brain-stats.js` | per-population bar chart (lifetime + recent window) |
| `src/sim.js` | port of `Sim.swift` (`LIFSim`, `SpikeBus`, `BrainSignals`) — symlinked |
| `src/flymodel.js` | port of `FlyModel.swift` (body geometry + behavior) — symlinked |
| `src/attract.js` | sugar/mate attraction math (symlinked) |
| `src/brain-stats.js` | `BrainStats` aggregator + `loadConfig` (symlinked) |
| `src/signals.js` | port of `SignalBuilder` (symlinked) |
| `src/environment.js` | circadian curve, CPU-load tempo (symlinked) |
| `src/data.js` | Node-only JSON loading (symlinked) |
| `src/os.js` | Linux OS senses (xprop/xdotool on X11, no-op on Wayland v1) |
| `src/x11.js`, `src/wayland.js` | backend selectors for `os.js` |
| `src/sense-types.js` | shared sense-result types |
| `src/util.js` | small helpers (symlinked) |
| `test/` | ports of `--simtest` and `--behaviortest` (symlinked) + linux-only `{main,os,ci,scaffold,brain-trainer,snapshot,wayland,x11}.test.js` |

Data comes from `../data/` — the same shipped `brain_points.json` and
`circuit.json`, under the same CC BY-NC 4.0 terms.
